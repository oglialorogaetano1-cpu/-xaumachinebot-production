"""Hourly import of the private VPS /ib-data contract. No customer data in logs."""
import asyncio
import contextlib
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import logging
import os
import time
import uuid

import httpx

log = logging.getLogger("puprime-sync")
IBS = ("7527073", "23217421")


def failure_category(exc):
    if isinstance(exc, httpx.HTTPStatusError):
        # Inspect only for a fixed classifier; never emit upstream body or URL.
        body = exc.response.text[:16000].lower()
        if any(marker in body for marker in ("cloudflare", "cf-chl-", "just a moment", "captcha")):
            return "upstream_verification_required"
    return type(exc).__name__


def report_health(run_id, rebate_available):
    if not rebate_available:
        log.error("PUPRIME_HEALTH_ERROR run=%s code=rebate_unavailable ibs=%s", run_id, ",".join(IBS))


def number(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("invalid_number") from None
    if not result.is_finite():
        raise ValueError("invalid_number")
    return result


def date_value(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc).date().isoformat()
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()


def normalize(payload):
    """Require both complete reports; preserve absent fields instead of inventing zeros."""
    reports = payload.get("ibReports")
    if not isinstance(reports, dict) or any(ib not in reports for ib in IBS):
        raise ValueError("missing_ib_report")
    clients, daily, counts = {}, {}, {}
    for ib in IBS:
        report = reports[ib]
        if not isinstance(report, dict) or report.get("error"):
            raise ValueError("upstream_ib_error")
        for key in ("openedAccountsDetail", "funding", "deposits", "withdraws"):
            if not isinstance(report.get(key), list) or any(not isinstance(r, dict) for r in report[key]):
                raise ValueError("invalid_report_shape")
        if report.get("openedAccounts") != len(report["openedAccountsDetail"]):
            raise ValueError("incomplete_accounts")
        for field, total in (("deposit", "totalDeposit"), ("withdraw", "totalWithdraw")):
            if abs(sum((number(r[field]) for r in report["funding"]), Decimal(0)) - number(report[total])) > Decimal("0.02"):
                raise ValueError("incomplete_funding")

        def client(row):
            account = str(row.get("mt4Account") or "").strip()
            if not account.isdigit():
                raise ValueError("missing_account")
            if account in clients and clients[account]["affiliate_id"] != ib:
                raise ValueError("account_in_multiple_ibs")
            return clients.setdefault(account, {"numero_conto": account, "affiliate_id": ib})

        for row in report["funding"]:
            target = client(row)
            for src, dest in (("name", "nome"), ("userId", "id_utente"), ("campaignSource", "fonte_campagna")):
                if row.get(src) not in (None, ""):
                    target[dest] = str(row[src])
            day = date_value(row["date"])
            values = daily.setdefault(day, {"data": day, "depositi_usd": Decimal(0), "prelievi_usd": Decimal(0)})
            values["depositi_usd"] += number(row["deposit"])
            values["prelievi_usd"] += number(row["withdraw"])
        for row in report["openedAccountsDetail"]:
            target = client(row)
            for src, dest in (("name", "nome"), ("userId", "id_utente"), ("email", "email"),
                              ("platform", "piattaforma"), ("currency", "valuta_base"), ("campaignSource", "fonte_campagna")):
                if row.get(src) not in (None, ""):
                    target[dest] = str(row[src])
            if row.get("balance") is not None:
                target["saldo"] = target["saldo_conto"] = str(number(row["balance"]))
            # approvedDate is account approval, not customer registration. Numeric
            # type/POI/POA enums have no documented CRM mapping: retained in snapshot.
        for row in report["withdraws"]:
            client(row)
        for row in sorted(report["deposits"], key=lambda r: str(r["updateTime"])):
            target = client(row)
            day = date_value(row["updateTime"])
            if row.get("realName"):
                target.setdefault("nome", str(row["realName"]))
            # A rolling 60-day report cannot establish the first-ever deposit.
            target.update(ultimo_deposito_data=day,
                          ultimo_deposito_importo=str(number(row["amount"])),
                          ultimo_deposito_valuta=row.get("currency"))
        counts[ib] = {k: len(report[k]) for k in ("openedAccountsDetail", "funding", "deposits", "withdraws")}
    for row in daily.values():
        row["depositi_netti_usd"] = row["depositi_usd"] - row["prelievi_usd"]
        for key in ("depositi_usd", "prelievi_usd", "depositi_netti_usd"):
            row[key] = str(row[key])
    return {"clients": list(clients.values()), "daily": list(daily.values()),
            "reports": {ib: reports[ib] for ib in IBS}, "counts": counts,
            "rebate_available": False}


class Sync:
    def __init__(self, bot=None, alert_chat_id=None):
        self.bot = bot
        self.alert_chat_id = alert_chat_id
        self.fallback_alert_at = 0
        self.url = os.environ["PUPRIME_API_URL"]
        self.token = os.environ["PUPRIME_API_TOKEN"]
        self.db = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_KEY"]
        self.secret = os.environ["CRM_TRACKING_SECRET"]
        self.interval = int(os.environ.get("PUPRIME_SYNC_INTERVAL_SECONDS", "3600"))
        if self.interval < 300:
            raise ValueError("sync_interval_too_short")
        self.lock = asyncio.Lock()

    async def alert_rpc(self, client, code, **fields):
        response = await client.post(self.db + "/rest/v1/rpc/crm_puprime_alert",
            headers={"apikey": self.key}, json={"p_secret": self.secret, "p_code": code, **fields})
        response.raise_for_status()
        return response.json()

    async def notify_health(self, client, code):
        if not self.bot or not self.alert_chat_id:
            return
        claim = None
        try:
            state = await self.alert_rpc(client, code)
            if not state.get("notify"):
                return
            claim = state["claim_id"]
        except Exception:
            log.error("PUPRIME_ALERT_STATE_UNAVAILABLE")
            # During a DB outage still notify about failed syncs, at most daily
            # within this process. Durable dedup resumes when DB recovers.
            if code in ("healthy", "rebate_unavailable") or time.time()-self.fallback_alert_at < 86400:
                return
            self.fallback_alert_at = time.time()
        messages = {
            "rebate_unavailable": "I report delle commissioni restano non disponibili. I rebate nel CRM non sono aggiornati; controllare accesso e report PuPrime.",
            "sync_failed": "La sincronizzazione PuPrime è fallita. I dati CRM potrebbero non essere aggiornati. Controllare i log Railway.",
            "upstream_verification_required": "PuPrime richiede una verifica Cloudflare/CAPTCHA. Ripristinare l'accesso nel browser dedicato della VPS.",
        }
        delivered = False
        try:
            await self.bot.send_message(chat_id=self.alert_chat_id,
                text="⚠️ Monitor PuPrime\n"+messages[code]+"\nIB: "+", ".join(IBS)+"\nAvvisi deduplicati per 24 ore.")
            delivered = True
            log.info("PUPRIME_ALERT_SENT code=%s", code)
        except Exception:
            log.error("PUPRIME_ALERT_DELIVERY_FAILED code=%s", code)
        if claim:
            try:
                await self.alert_rpc(client, code, p_claim=claim, p_delivered=delivered)
            except Exception:
                log.error("PUPRIME_ALERT_ACK_FAILED")

    async def rpc(self, client, payload):
        response = await client.post(self.db + "/rest/v1/rpc/crm_sync_puprime_api",
            headers={"apikey": self.key, "Content-Type": "application/json"},
            json={"p_secret": self.secret, "p_payload": payload})
        response.raise_for_status()
        return response.json()

    async def once(self):
        async with self.lock:
            run_id = str(uuid.uuid4())
            started = datetime.now(timezone.utc).isoformat()
            async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15), follow_redirects=False) as client:
                try:
                    response = await client.get(self.url, headers={"Authorization": "Bearer " + self.token})
                    response.raise_for_status()
                    normalized = normalize(response.json())
                    result = await self.rpc(client, {**normalized, "run_id": run_id, "started_at": started, "status": "success"})
                    report_health(run_id, normalized["rebate_available"])
                    await self.notify_health(client, "healthy" if normalized["rebate_available"] else "rebate_unavailable")
                    return result
                except Exception as exc:
                    # Exception strings and HTTP bodies may include tokens/PII.
                    error = failure_category(exc)
                    status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
                    log.error("PUPRIME_HEALTH_ERROR run=%s code=sync_failed category=%s http_status=%s", run_id, error, status)
                    with contextlib.suppress(Exception):
                        await self.rpc(client, {"run_id": run_id, "started_at": started, "status": "failed", "error_category": error, "http_status": status})
                    await self.notify_health(client, "upstream_verification_required" if error == "upstream_verification_required" else "sync_failed")
                    raise RuntimeError("puprime_sync_failed") from None

    async def loop(self):
        log.info("PUPRIME_SYNC_ENABLED interval_seconds=%s ibs=%s", self.interval, ",".join(IBS))
        while True:
            with contextlib.suppress(RuntimeError):
                await self.once()
            # Aligned to wall-clock hours; no overlapping runs or retry storm.
            await asyncio.sleep(self.interval - time.time() % self.interval)


def start(bot=None, alert_chat_id=None):
    if os.environ.get("PUPRIME_SYNC_ENABLED", "false").lower() != "true":
        return None
    return asyncio.create_task(Sync(bot, alert_chat_id).loop(), name="puprime-hourly-sync")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(Sync().once())
