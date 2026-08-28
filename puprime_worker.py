import asyncio
import json
import os
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientTimeout, web
from playwright.async_api import (
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

PORT = int(os.environ.get("PORT", "8080"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_WORKER_SECRET = os.environ.get("SUPABASE_WORKER_SECRET", "")
PU_EMAIL = os.environ.get("PU_EMAIL", "")
PU_PASSWORD = os.environ.get("PU_PASSWORD", "")
LOGIN_URL = os.environ.get(
    "PU_LOGIN_URL", "https://myaccount.puprime.com/login"
)
IBS = ["23215978", "23217421", "7527073"]
INTERVAL = int(os.environ.get("SYNC_INTERVAL_SECONDS", "1800"))
KNOWN_ENDPOINTS = (
    "queryRebateVolumeList",
    "queryClientReport",
    "retail_clientsV2",
    "retail_clients",
)

sync_lock = asyncio.Lock()
state = {
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_status": "never",
    "last_updated": 0,
    "rows_by_ib": {},
    "last_error": None,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def event(name, **values):
    print(json.dumps({"event": name, **values}, separators=(",", ":")), flush=True)


def safe_number(value):
    if value is None or value == "":
        return 0.0
    try:
        text = str(value).strip().replace(" ", "")
        if "," in text and "." in text:
            text = text.replace(",", "")
        elif "," in text:
            text = text.replace(",", ".")
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def extract_rows(payload):
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "list", "records", "rows", "items", "content", "result"):
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        nested = extract_rows(value)
        if nested:
            return nested
    return []


def field(item, *names):
    for name in names:
        value = item.get(name)
        if value is not None and str(value).strip() != "":
            return value
    return None


async def click_visible_text(page, labels):
    for label in labels:
        locator = page.get_by_text(label, exact=False)
        for index in range(min(await locator.count(), 12)):
            candidate = locator.nth(index)
            try:
                if await candidate.is_visible():
                    await candidate.click(timeout=5000)
                    return True
            except Exception:
                continue
    return False


async def dismiss_popups(page):
    for _ in range(3):
        for label in ("Salta", "Skip", "Chiudi", "Close", "Not now"):
            try:
                button = page.get_by_role("button", name=label, exact=False)
                if await button.count() and await button.first.is_visible():
                    await button.first.click(timeout=2000)
            except Exception:
                pass
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass
        await asyncio.sleep(0.3)


async def set_month_range(page):
    start_value = date.today().replace(day=1).isoformat()
    end_value = date.today().isoformat()
    date_inputs = []
    inputs = page.locator("input")
    for index in range(min(await inputs.count(), 40)):
        element = inputs.nth(index)
        try:
            if not await element.is_visible():
                continue
            input_type = (await element.get_attribute("type") or "").lower()
            placeholder = (await element.get_attribute("placeholder") or "").lower()
            if input_type == "date" or any(
                token in placeholder
                for token in ("date", "data", "from", "to", "start", "end")
            ):
                date_inputs.append(element)
        except Exception:
            continue

    for index, value in enumerate((start_value, end_value)):
        if index >= len(date_inputs):
            break
        try:
            await date_inputs[index].fill(value, timeout=3000)
        except Exception:
            try:
                await date_inputs[index].evaluate(
                    """(el, value) => {
                        el.removeAttribute('readonly');
                        el.value = value;
                        el.dispatchEvent(new Event('input', {bubbles: true}));
                        el.dispatchEvent(new Event('change', {bubbles: true}));
                    }""",
                    value,
                )
            except Exception:
                pass

    if date_inputs:
        await click_visible_text(
            page,
            ("Cerca", "Search", "Query", "Applica", "Apply", "Conferma", "Confirm"),
        )
        await asyncio.sleep(2)


async def switch_ib(page, ib):
    if await click_visible_text(page, (ib,)):
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            await asyncio.sleep(3)
        return True
    return False


async def navigate_report(page):
    clicked = await click_visible_text(
        page,
        (
            "Rapporto del Conto",
            "Account Report",
            "Client Report",
            "Rapporto conto",
            "Rebate",
            "Commission",
        ),
    )
    if clicked:
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            await asyncio.sleep(3)
    return clicked


async def upsert_rows(rows):
    merged = {}
    for item in rows:
        account = str(
            field(
                item,
                "agentLowAccount",
                "accountNmber",
                "accountNumber",
                "tradeAccount",
                "loginId",
                "uid",
                "account",
                "mtAccount",
            )
            or ""
        ).strip()
        if not account:
            continue

        rebate = safe_number(
            field(
                item,
                "commission",
                "rebate",
                "commissionAmount",
                "rebateAmount",
                "totalCommission",
                "totalRebate",
            )
        )
        balance = safe_number(
            field(item, "accountBalance", "balance", "equity")
        )
        deposit = safe_number(
            field(item, "lastDepositAmount", "depositAmount")
        )
        deposit_date = str(
            field(item, "lastDepositTime", "lastDepositDate") or ""
        ).strip()[:10]
        name = str(
            field(item, "name", "userName", "clientName", "customerName") or ""
        ).strip()

        current = merged.setdefault(account, {"numero_conto": account})
        if name:
            current["nome"] = name[:200]
        if rebate > 0:
            current["rebate"] = rebate
            current["rebate_aggiornato"] = date.today().isoformat()
        if balance > 0:
            current["saldo"] = balance
        if deposit > 0 and deposit_date:
            current["ultimo_deposito_importo"] = deposit
            current["ultimo_deposito_data"] = deposit_date
            current["ultimo_deposito_valuta"] = "USD"

    safe_rows = []
    for row in merged.values():
        if any(
            key in row
            for key in ("rebate", "saldo", "ultimo_deposito_importo")
        ):
            row["attivo"] = True
            safe_rows.append(row)

    if not safe_rows:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Accept-Profile": "api",
        "Content-Profile": "api",
        "x-puprime-worker-secret": SUPABASE_WORKER_SECRET,
    }
    if SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + SUPABASE_KEY

    timeout = ClientTimeout(total=45)
    updated = 0
    async with ClientSession(timeout=timeout) as session:
        for start in range(0, len(safe_rows), 50):
            batch = safe_rows[start : start + 50]
            url = SUPABASE_URL + "/rest/v1/rpc/upsert_puprime_clients"
            async with session.post(
                url, headers=headers, json={"client_rows": batch}
            ) as response:
                body = await response.text()
                if response.status not in (200, 201, 204):
                    raise RuntimeError(
                        "Supabase RPC HTTP "
                        + str(response.status)
                        + ": "
                        + body[:160]
                    )
                try:
                    affected = int(json.loads(body)) if body else len(batch)
                except Exception:
                    affected = len(batch)
                updated += affected
                event("SUPABASE_RPC", batch_rows=len(batch), affected=affected)
    return updated


async def scrape_once():
    required = (
        SUPABASE_URL,
        SUPABASE_KEY,
        SUPABASE_WORKER_SECRET,
        PU_EMAIL,
        PU_PASSWORD,
    )
    if not all(required):
        raise RuntimeError("missing required worker settings")

    buckets = {ib: [] for ib in IBS}
    endpoint_counts = {ib: {} for ib in IBS}
    active_ib = {"value": IBS[0]}
    response_tasks = set()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 1000}
        )
        page = await context.new_page()

        async def handle_response(response):
            try:
                matched = next(
                    (
                        name
                        for name in KNOWN_ENDPOINTS
                        if name.lower() in response.url.lower()
                    ),
                    None,
                )
                if not matched or response.status != 200:
                    return
                content_type = (
                    response.headers.get("content-type") or ""
                ).lower()
                if "json" not in content_type:
                    return
                payload = await response.json()
                rows = extract_rows(payload)
                ib = active_ib["value"]
                endpoint_counts[ib][matched] = (
                    endpoint_counts[ib].get(matched, 0) + len(rows)
                )
                if rows:
                    buckets[ib].extend(rows)
                event(
                    "PU_API",
                    ib=ib,
                    endpoint=matched,
                    status=response.status,
                    items=len(rows),
                    path=urlsplit(response.url).path[-120:],
                )
            except Exception:
                return

        def schedule_response(response):
            task = asyncio.create_task(handle_response(response))
            response_tasks.add(task)
            task.add_done_callback(response_tasks.discard)

        page.on("response", schedule_response)

        try:
            event("PU_STAGE", stage="login_start")
            await page.goto(
                LOGIN_URL, wait_until="domcontentloaded", timeout=30000
            )
            await page.locator('input[type="email"]').first.fill(
                PU_EMAIL, timeout=10000
            )
            await page.locator('input[type="password"]').first.fill(
                PU_PASSWORD, timeout=10000
            )
            clicked = await click_visible_text(
                page, ("Accedi", "Login", "Log in", "Sign in")
            )
            if not clicked:
                await page.locator('button[type="submit"]').first.click(
                    timeout=5000
                )

            try:
                await page.wait_for_url("**/ibportal**", timeout=25000)
            except PlaywrightTimeoutError:
                if "login" in page.url.lower():
                    raise RuntimeError("PU login did not leave login page")

            try:
                await page.wait_for_load_state("networkidle", timeout=12000)
            except Exception:
                await asyncio.sleep(4)
            await dismiss_popups(page)
            event("PU_STAGE", stage="login_ok")

            for ib in IBS:
                active_ib["value"] = ib
                success = False
                for attempt in (1, 2):
                    before = len(buckets[ib])
                    event("PU_STAGE", stage="ib_start", ib=ib, attempt=attempt)
                    switched = await switch_ib(page, ib)
                    if not switched:
                        event(
                            "PU_STAGE",
                            stage="ib_selector_missing",
                            ib=ib,
                            attempt=attempt,
                        )
                    await dismiss_popups(page)
                    await navigate_report(page)
                    await set_month_range(page)
                    try:
                        await page.wait_for_selector(
                            'table, [role="grid"], [class*="table"]',
                            timeout=12000,
                        )
                    except Exception:
                        pass
                    await asyncio.sleep(5)
                    if response_tasks:
                        await asyncio.gather(
                            *list(response_tasks), return_exceptions=True
                        )
                    if len(buckets[ib]) > before:
                        success = True
                        break
                    if attempt == 1:
                        try:
                            await page.reload(
                                wait_until="domcontentloaded", timeout=25000
                            )
                            await asyncio.sleep(4)
                        except Exception:
                            pass
                event(
                    "PU_IB_RESULT",
                    ib=ib,
                    rows=len(buckets[ib]),
                    success=success,
                    endpoints=endpoint_counts[ib],
                )
        finally:
            await browser.close()

    all_rows = []
    for ib in IBS:
        all_rows.extend(buckets[ib])
    return buckets, all_rows


async def run_sync():
    async with sync_lock:
        state["running"] = True
        state["last_started"] = now_iso()
        state["last_error"] = None
        event(
            "PU_SYNC_START",
            month_start=date.today().replace(day=1).isoformat(),
            month_end=date.today().isoformat(),
        )
        try:
            buckets, rows = await scrape_once()
            rows_by_ib = {ib: len(buckets[ib]) for ib in IBS}
            state["rows_by_ib"] = rows_by_ib
            if not rows:
                raise RuntimeError(
                    "zero real rows from every IB; database preserved"
                )
            updated = await upsert_rows(rows)
            if updated <= 0:
                raise RuntimeError(
                    "rows captured but no positive values safe to persist"
                )
            state["last_status"] = "success"
            state["last_updated"] = updated
            state["last_finished"] = now_iso()
            event(
                "PU_SYNC_SUCCESS",
                updated=updated,
                ibs_with_rows=sum(1 for value in rows_by_ib.values() if value > 0),
                rows_by_ib=rows_by_ib,
            )
        except Exception as error:
            state["last_status"] = "failed"
            state["last_updated"] = 0
            state["last_error"] = str(error)[:240]
            state["last_finished"] = now_iso()
            event("PU_SYNC_FAILED", reason=str(error)[:160])
        finally:
            state["running"] = False


async def sync_loop():
    await asyncio.sleep(2)
    while True:
        await run_sync()
        await asyncio.sleep(INTERVAL)


async def health(_request):
    return web.json_response(
        {"status": "ok", "service": "puprime-sync-worker", **state}
    )


async def manual_sync(_request):
    if sync_lock.locked():
        return web.json_response(
            {"status": "already_running"}, status=202
        )
    asyncio.create_task(run_sync())
    return web.json_response({"status": "started"}, status=202)


async def main():
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_post("/sync", manual_sync)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", PORT)
    await site.start()
    event("WORKER_READY", port=PORT)
    asyncio.create_task(sync_loop())
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
