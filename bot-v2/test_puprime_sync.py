import copy
import unittest
from unittest.mock import patch, AsyncMock
import httpx
import puprime_sync as sync


def report(account):
    return {"openedAccounts": 1, "openedAccountsDetail": [
        {"mt4Account": account, "name": "Test", "userId": account+100, "balance": 0, "email": None}],
        "funding": [{"mt4Account": account,"date": "2026-09-23","deposit": 10,"withdraw": 2}],
        "deposits": [{"mt4Account": account,"updateTime": "2026-09-23","amount": 10,"currency":"EUR"}],
        "withdraws": [], "totalDeposit": 10, "totalWithdraw": 2}


def payload():
    r = {"ibReports": {"7527073":report(1),"23217421":report(2)}}
    r.update(report(1))  # Legacy primary report must NOT be counted twice.
    return r


class NormalizeTests(unittest.TestCase):
    def test_combines_both_ibs_once(self):
        r = sync.normalize(payload())
        self.assertEqual(len(r["clients"]),2)
        self.assertEqual(r["daily"][0]["depositi_usd"],"20")
        self.assertEqual(r["daily"][0]["depositi_netti_usd"],"16")

    def test_sparse_fields_zero_balance_no_invented_rebate(self):
        c=sync.normalize(payload())["clients"][0]
        self.assertEqual(c["saldo"],"0")
        for key in ("email","rebate","stato_id","tipo_conto","primo_deposito_data","data_registrazione"):
            self.assertNotIn(key,c)

    def test_incomplete_or_error_reports_rejected(self):
        for mutate in (lambda r:r.pop("23217421"),lambda r:r["23217421"].update(error="private text"),
                       lambda r:r["23217421"].update(openedAccounts=2),lambda r:r["23217421"].update(totalDeposit=100)):
            p=payload(); mutate(p["ibReports"])
            with self.assertRaises(ValueError): sync.normalize(p)

    def test_missing_or_ambiguous_account_rejected(self):
        for acct in (None,1):
            p=payload(); p["ibReports"]["23217421"]["openedAccountsDetail"][0]["mt4Account"]=acct
            with self.assertRaises(ValueError): sync.normalize(p)

    def test_latest_deposit_sorted(self):
        p=payload(); r=p["ibReports"]["7527073"]
        old=copy.deepcopy(r["deposits"][0]);old.update(updateTime="2026-08-01",amount=5)
        r["deposits"].append(old)
        self.assertEqual(sync.normalize(p)["clients"][0]["ultimo_deposito_importo"],"10")

    def test_all_movements_retained_in_snapshot(self):
        p=payload(); self.assertEqual(sync.normalize(p)["reports"],p["ibReports"])

    def test_invalid_money_rejected(self):
        for value in (None,"NaN","Infinity","oops"):
            with self.assertRaises(ValueError): sync.number(value)

    def test_repeat_normalization_identical(self):
        self.assertEqual(sync.normalize(payload()),sync.normalize(payload()))


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    def test_health_is_silent_when_complete(self):
        with self.assertNoLogs("puprime-sync", level="INFO"):
            sync.report_health("test-run", True)

    def test_missing_rebate_is_monitorable(self):
        with self.assertLogs("puprime-sync", level="ERROR") as logs:
            sync.report_health("test-run", False)
        self.assertIn("code=rebate_unavailable", logs.output[0])

    def test_cloudflare_classifier_does_not_expose_body(self):
        response=httpx.Response(503,text="Cloudflare captcha sensitive",request=httpx.Request("GET","https://example.test"))
        with self.assertRaises(httpx.HTTPStatusError) as caught:
            response.raise_for_status()
        self.assertEqual(sync.failure_category(caught.exception),"upstream_verification_required")

    async def test_alert_send_ack_and_dedup(self):
        worker=object.__new__(sync.Sync)
        worker.bot=AsyncMock();worker.alert_chat_id="test-owner"
        worker.alert_rpc=AsyncMock(side_effect=[{"notify":True,"claim_id":"claim"},{}, {"notify":False}])
        await worker.notify_health(None,"rebate_unavailable")
        await worker.notify_health(None,"rebate_unavailable")
        worker.bot.send_message.assert_awaited_once()
        self.assertEqual(worker.alert_rpc.await_args_list[1].kwargs,{"p_claim":"claim","p_delivered":True})

    async def test_delivery_failure_releases_claim(self):
        worker=object.__new__(sync.Sync)
        worker.bot=AsyncMock();worker.bot.send_message.side_effect=RuntimeError("secret")
        worker.alert_chat_id="test-owner"
        worker.alert_rpc=AsyncMock(side_effect=[{"notify":True,"claim_id":"claim"},{}])
        with self.assertLogs("puprime-sync",level="ERROR") as logs:
            await worker.notify_health(None,"sync_failed")
        self.assertNotIn("secret",str(logs.output))
        self.assertFalse(worker.alert_rpc.await_args.kwargs["p_delivered"])

    async def test_healthy_never_sends_and_db_failure_is_throttled(self):
        worker=object.__new__(sync.Sync)
        worker.bot=AsyncMock();worker.alert_chat_id="test-owner";worker.fallback_alert_at=0
        worker.alert_rpc=AsyncMock(side_effect=RuntimeError())
        with self.assertLogs("puprime-sync",level="ERROR"):
            await worker.notify_health(None,"healthy")
            await worker.notify_health(None,"rebate_unavailable")
            worker.bot.send_message.assert_not_awaited()
            await worker.notify_health(None,"sync_failed")
            await worker.notify_health(None,"sync_failed")
        worker.bot.send_message.assert_awaited_once()

    async def test_failure_logs_do_not_leak_body_or_url(self):
        with patch.dict("os.environ",{"PUPRIME_API_URL":"https://example.test/ib-data", "PUPRIME_API_TOKEN":"test-secret",
             "SUPABASE_URL":"https://example.test", "SUPABASE_KEY":"test-key","CRM_TRACKING_SECRET":"test-secret"}):
            worker=sync.Sync()
        calls=[]
        async def handler(request):
            calls.append(request)
            return httpx.Response(500, text="sensitive upstream body") if request.method=="GET" else httpx.Response(200,json={})
        real_client=httpx.AsyncClient
        with patch.object(sync.httpx,"AsyncClient",lambda **kw:real_client(transport=httpx.MockTransport(handler),**kw)):
            with self.assertLogs("puprime-sync",level="WARNING") as logs:
                with self.assertRaisesRegex(RuntimeError,"puprime_sync_failed"):await worker.once()
        self.assertEqual(len(calls),2)
        self.assertNotIn("sensitive",str(logs.output)); self.assertNotIn("test-secret",str(logs.output))


if __name__=="__main__": unittest.main()
