import asyncio
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

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
    # The legacy .com endpoint currently presents a certificate for another
    # host, which makes automated browser login fail before reaching the IB
    # portal.  The active Client/IB portal uses the .pro login entrypoint.
    "PU_LOGIN_URL", "https://myaccount.puprime.pro/login"
)
# The official API identifies accounts and downstream users, but its documented
# response has no customer-name field.  Names shown in the authenticated IB
# portal are therefore synchronized separately, as a supplement to (never a
# replacement for) the official API identity.
PU_PORTAL_IBS = [
    value.strip()
    for value in os.environ.get("PU_PORTAL_IBS", "").split(",")
    if value.strip()
]
PU_PORTAL_NAME_SYNC_ENABLED = os.environ.get(
    "PU_PORTAL_NAME_SYNC_ENABLED", "true"
).strip().lower() in {"1", "true", "yes", "on"}
INTERVAL = int(os.environ.get("SYNC_INTERVAL_SECONDS", "1800"))
PU_API_BASE_URL = os.environ.get("PU_API_BASE_URL", "https://openapi.puprime.com").rstrip("/")
PU_API_USER_ID = os.environ.get("PU_API_USER_ID", "").strip()
PU_API_SECRET = os.environ.get("PU_API_SECRET", "").strip()
PU_API_LOOKBACK_DAYS = max(1, min(int(os.environ.get("PU_API_LOOKBACK_DAYS", "90")), 90))
# The documented API returns the downstream network for the authenticated IB.
# Keep the IB identity explicit in the CRM record instead of inferring it from
# a customer account number.
# Railway may preserve an old variable as an empty string.  Treat that exactly
# like an unset value so authenticated account rows retain their IB identity.
PU_API_AFFILIATE_ID = os.environ.get("PU_API_AFFILIATE_ID", "").strip() or PU_API_USER_ID
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


def api_date(value):
    """PU Prime accepts server-time dates formatted to seconds."""
    return value.strftime("%Y-%m-%d %H:%M:%S")


def puprime_server_now():
    """The IB API documents a GMT+2 clock that observes summer time."""
    return datetime.now(ZoneInfo("Europe/Athens"))


async def puprime_api_request(session, endpoint, start_time, end_time):
    payload = {
        "userId": int(PU_API_USER_ID),
        "secret": PU_API_SECRET,
        "startTime": api_date(start_time),
        "endTime": api_date(end_time),
    }
    url = PU_API_BASE_URL + endpoint
    async with session.post(url, json=payload) as response:
        body = await response.json(content_type=None)
    if response.status != 200 or not isinstance(body, dict) or body.get("code") != 1:
        # API bodies can contain sensitive operational data. Keep logs useful
        # without persisting raw responses or credentials.
        raise RuntimeError("PU Prime API rejected " + endpoint)
    data = body.get("data")
    return data if isinstance(data, list) else []


def normalize_official_api(account_rows, commission_rows, allocation_rows):
    """Normalize only fields actually documented by PU Prime's IB API.

    Deposit amounts, balances and current attribution are deliberately not
    inferred: the official API documentation says those are not available or
    not authoritative.  A client account present in accountData is still a
    useful verified historical account record under the authenticated IB.
    """
    rows = {}
    for item in account_rows:
        account = str(item.get("account") or "").strip()
        if not account:
            continue
        rows[account] = {
            "numero_conto": account,
            "id_utente": str(item.get("userId") or "").strip(),
            "affiliate_id": PU_API_AFFILIATE_ID,
            "piattaforma": str(item.get("platform") or "").strip(),
            "valuta_base": str(item.get("currency") or "").strip(),
            "tipo_conto": str(item.get("accountType") or "").strip(),
            "attivo": True,
        }
    for item in commission_rows:
        account = str(item.get("account") or "").strip()
        if not account:
            continue
        row = rows.setdefault(account, {
            "numero_conto": account,
            "affiliate_id": PU_API_AFFILIATE_ID,
            "attivo": True,
        })
        for source, target in (("userId", "id_utente"), ("platform", "piattaforma"),
                               ("currency", "valuta_base"), ("accountType", "tipo_conto")):
            value = str(item.get(source) or "").strip()
            if value:
                row[target] = value
        if item.get("commission") is not None:
            row["rebate"] = safe_number(item.get("commission"))
            row["rebate_aggiornato"] = date.today().isoformat()

    # Allocation records are intentionally not converted into deposits.  The
    # CRM receives them as allocation movements and labels them accordingly.
    allocations = []
    for item in allocation_rows:
        allocations.append(
            {
                "account": str(item.get("account") or "").strip(),
                "user_id": str(item.get("userId") or "").strip(),
                "create_time": str(item.get("createTime") or "").strip(),
                "type": str(item.get("type") or "").strip(),
                "content": str(item.get("content") or item.get("details") or "").strip(),
            }
        )
    return list(rows.values()), allocations


async def api_once():
    required = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_KEY,
        "SUPABASE_WORKER_SECRET": SUPABASE_WORKER_SECRET,
        "PU_API_USER_ID": PU_API_USER_ID,
        "PU_API_SECRET": PU_API_SECRET,
    }
    missing = sorted(name for name, value in required.items() if not value)
    if missing:
        raise RuntimeError("missing required API worker settings: " + ",".join(missing))

    end_time = puprime_server_now().replace(microsecond=0)
    start_time = end_time - timedelta(days=PU_API_LOOKBACK_DAYS)
    timeout = ClientTimeout(total=50)
    async with ClientSession(timeout=timeout) as session:
        account_rows = await puprime_api_request(
            session, "/api/ibData/accountData", start_time, end_time
        )
        allocation_rows = await puprime_api_request(
            session, "/api/ibData/allocationData", start_time, end_time
        )
        # Leads have no trading-account identifier, so they cannot safely be
        # joined to a Telegram customer until the CRM has another verified key.
        lead_rows = await puprime_api_request(
            session, "/api/ibData/leadsData", start_time, end_time
        )
        commission_rows = []
        # The documented commission endpoint may only run from 00:00 to 06:00
        # PU Prime server time and at most once per five minutes.
        if 0 <= end_time.hour < 6:
            commission_rows = await puprime_api_request(
                session, "/api/ibData/commissionData", start_time, end_time
            )
    rows, allocations = normalize_official_api(
        account_rows, commission_rows, allocation_rows
    )
    event(
        "PU_OFFICIAL_API",
        accounts=len(account_rows),
        leads=len(lead_rows),
        allocations=len(allocations),
        commissions=len(commission_rows),
        stored_accounts=len(rows),
    )
    return {
        "accounts": rows,
        "allocations": allocations,
        # Keep only structured, documented fields. Leads are not joined to a
        # Telegram client until CRM has another verified identifier.
        "leads": lead_rows,
        "commissions": commission_rows,
    }


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
                "numero_conto",
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
        for source, target in (
            ("id_utente", "id_utente"),
            ("affiliate_id", "affiliate_id"),
            ("piattaforma", "piattaforma"),
            ("valuta_base", "valuta_base"),
            ("tipo_conto", "tipo_conto"),
        ):
            value = str(item.get(source) or "").strip()
            if value:
                current[target] = value[:200]
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
        # The official accountData response is a verified historical account
        # record for this IB even when it does not include the optional
        # downstream user id.  Persist that identity rather than discarding
        # every account until a rebate/deposit-style numeric field appears.
        # This must not be read as a balance, deposit or live attribution.
        if any(
            key in row
            for key in (
                "rebate",
                "saldo",
                "ultimo_deposito_importo",
                "id_utente",
                "affiliate_id",
            )
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


async def sync_official_api(snapshot):
    """Persist official PU Prime data through the verified CRM RPC.

    This endpoint is deliberately separate from the old portal-scraping RPC:
    it does not accept or fabricate deposits, withdrawals, balances, or
    copy-trading subscriptions.
    """
    payload = {
        "run_id": str(uuid.uuid4()),
        "started_at": now_iso(),
        "accounts": snapshot["accounts"],
        "allocations": snapshot["allocations"],
        "leads": snapshot["leads"],
        "commissions": snapshot["commissions"],
    }
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
    }
    if SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + SUPABASE_KEY
    async with ClientSession(timeout=ClientTimeout(total=45)) as session:
        url = SUPABASE_URL + "/rest/v1/rpc/crm_sync_puprime_official_api"
        async with session.post(
            url,
            headers=headers,
            json={"p_secret": SUPABASE_WORKER_SECRET, "p_payload": payload},
        ) as response:
            body = await response.text()
            if response.status not in (200, 201):
                raise RuntimeError(
                    "Supabase official sync HTTP "
                    + str(response.status)
                    + ": "
                    + body[:160]
                )
    result = json.loads(body) if body else {}
    if not isinstance(result, dict) or result.get("status") != "success":
        raise RuntimeError("CRM did not acknowledge official PU Prime sync")
    event(
        "SUPABASE_OFFICIAL_SYNC",
        accounts=result.get("accounts", 0),
        events=result.get("events", 0),
        bootstrap=bool(result.get("bootstrap")),
    )
    return result


async def scrape_once():
    required = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_KEY,
        "SUPABASE_WORKER_SECRET": SUPABASE_WORKER_SECRET,
        "PU_EMAIL": PU_EMAIL,
        "PU_PASSWORD": PU_PASSWORD,
    }
    missing = sorted(name for name, value in required.items() if not value)
    if missing:
        raise RuntimeError(f"missing required worker settings: {','.join(missing)}")

    # When no explicit list is configured, read the IB currently selected by
    # the authenticated portal.  This avoids silently querying obsolete,
    # hard-coded IB numbers.
    portal_ibs = PU_PORTAL_IBS or ["current"]
    buckets = {ib: [] for ib in portal_ibs}
    endpoint_counts = {ib: {} for ib in portal_ibs}
    active_ib = {"value": portal_ibs[0]}
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
            async def fill_first_visible(selectors, value, label):
                for selector in selectors:
                    locator = page.locator(selector)
                    for index in range(await locator.count()):
                        candidate = locator.nth(index)
                        try:
                            if await candidate.is_visible():
                                await candidate.fill(value, timeout=10000)
                                return
                        except Exception:
                            continue
                raise RuntimeError(
                    f"PU login field not found: {label}; url={page.url}"
                )

            # PU Prime ha cambiato più volte il markup del login (email/text,
            # name e autocomplete). Prova selettori semantici e fallback visibili.
            await fill_first_visible(
                (
                    'input[type="email"]',
                    'input[autocomplete="username"]',
                    'input[name*="email" i]',
                    'input[name*="user" i]',
                    'input[placeholder*="mail" i]',
                    'input[type="text"]',
                ),
                PU_EMAIL,
                "email/username",
            )
            await fill_first_visible(
                (
                    'input[type="password"]',
                    'input[autocomplete="current-password"]',
                    'input[name*="pass" i]',
                    'input[placeholder*="pass" i]',
                ),
                PU_PASSWORD,
                "password",
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

            for ib in portal_ibs:
                active_ib["value"] = ib
                success = False
                for attempt in (1, 2):
                    before = len(buckets[ib])
                    event("PU_STAGE", stage="ib_start", ib=ib, attempt=attempt)
                    switched = True if ib == "current" else await switch_ib(page, ib)
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
    for ib in portal_ibs:
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
            snapshot = await api_once()
            rows = snapshot["accounts"]
            state["rows_by_ib"] = {PU_API_AFFILIATE_ID or "ib": len(rows)}
            # accountData covers accounts approved in the API date window.
            # An empty window is valid, but must not prevent the authenticated
            # portal from refreshing names for existing clients.
            updated = 0
            if rows:
                result = await sync_official_api(snapshot)
                updated = int(result.get("accounts", 0))
            # The public IB API does not contain the human-readable name.
            # If portal credentials are configured, enrich the exact accounts
            # from the authenticated portal.  This is name-only enrichment:
            # balances, deposits and copy status are never inferred from it.
            portal_updated = 0
            if PU_PORTAL_NAME_SYNC_ENABLED and PU_EMAIL and PU_PASSWORD:
                try:
                    _buckets, portal_rows = await scrape_once()
                    portal_updated = await upsert_rows(portal_rows)
                    event(
                        "PU_PORTAL_NAME_SYNC",
                        portal_rows=len(portal_rows),
                        updated=portal_updated,
                    )
                except Exception as portal_error:
                    # The official account sync remains valid if the visual
                    # portal changes or is temporarily unavailable.
                    event(
                        "PU_PORTAL_NAME_SYNC_FAILED",
                        reason=str(portal_error)[:160],
                    )
            state["last_status"] = "success"
            state["last_updated"] = updated + portal_updated
            state["last_finished"] = now_iso()
            event(
                "PU_SYNC_SUCCESS",
                updated=updated,
                portal_updated=portal_updated,
                accounts=len(rows),
                ib_user_id=PU_API_AFFILIATE_ID,
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
