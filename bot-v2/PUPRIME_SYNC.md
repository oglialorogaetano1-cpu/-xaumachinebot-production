# PuPrime hourly CRM import

The bot starts the importer from `post_init` when `PUPRIME_SYNC_ENABLED=true`.
It runs once at startup and then at UTC hour boundaries (3600 seconds), without
overlapping calls. Telegram remains a continuously running service. Do not set
a Railway cron schedule on this bot: cron expects the process to exit.

## Production target

- Repository: `oglialorogaetano1-cpu/-xaumachinebot-production`
- Railway project: `33d8a230-3245-49ee-baa9-505fa2aa5607`
- Environment: `cdaaa749-ff76-4f0f-a52c-7a020b26d2b9`
- Service: `77fa28e1-7ae4-4443-8781-27cfe5f66e67` (`xau-machine-bot-live`)
- Supabase: `vtssggkdfwuglmqsyxuo`
- IBs: `7527073`, `23217421`

This branch starts from the deployed revision `235e56c8c9693dff98febe41fe1df2377ed32c64`.
Main contains additional bot changes; deploying main would include those changes.

## Required Railway variables

| Name | Value/source |
| --- | --- |
| `PUPRIME_SYNC_ENABLED` | `true` after the database migration |
| `PUPRIME_SYNC_INTERVAL_SECONDS` | `3600` |
| `PUPRIME_API_URL` | Existing private VPS endpoint, full URL ending in `/ib-data` |
| `PUPRIME_API_TOKEN` | Existing VPS API bearer token, transferred through stdin; never committed |
| `SUPABASE_URL` | Existing project URL |
| `SUPABASE_KEY` | Existing publishable key |
| `CRM_TRACKING_SECRET` | Existing server runtime secret |

Keep start command `python -u app.py`, `/health`, one replica and restart policy
`ALWAYS`. Stage variables with `--skip-deploys`, then deploy the reviewed code.
No broad Supabase service-role credential is added to the bot.

## Database and data contract

Apply `supabase/migrations/20260923222531_puprime_hourly_api_sync.sql` first.
It creates a private snapshot table and a scoped RPC. The public wrapper uses
SECURITY INVOKER. The private implementation uses SECURITY DEFINER to write only
the specified CRM tables after verifying the existing tenant runtime secret;
anonymous/publishable-key requests alone cannot import anything. This is machine
authentication, so an interactive `auth.uid()` is not available.

The entire successful import is one transaction and holds an advisory lock.
Client identity is `numero_conto`. Daily funding identity is the report date;
existing ISO or DD/MM/YYYY dates are reused. Duplicate representations abort the
transaction. Run UUIDs make retries idempotent; older concurrent snapshots are
rejected. A failed or partial IB report does not modify customer/funding data.

The importer updates names, user/account IDs, IB affiliation, available email,
platform, currency, balance and latest deposit. It preserves existing fields
when upstream omits them. It aggregates daily USD funding from both IBs into
`puprime_rebate`; the legacy duplicated top-level IB report is ignored.
Complete source reports, including individual deposits/withdrawals, remain in
`private.puprime_api_reports`, one current snapshot per IB. Raw snapshots are not
accessible through the public Data API. `crm_sync_runs` records counts and status.

The existing VPS endpoint reports a rolling 60-day window. It does not currently
provide rebate/commission values, full historical customer lists, or documented
KYC/account-type enum labels. Those values are not fabricated or overwritten.
`rebate_available=false` records that limitation. Completing rebate synchronization
requires adding rebate data to the upstream API contract and testing its mapping.
The CRM UI is unchanged; transaction detail remains in the private snapshots.

## Verification and operation

Run `python -m unittest discover -s bot-v2 -p test_puprime_sync.py -v`.
Run `python -m py_compile bot-v2/app.py bot-v2/puprime_sync.py`.
With environment variables loaded, `python bot-v2/puprime_sync.py` performs one
real import without starting Telegram. Repeat and check aggregate row counts,
unique account/date constraints, and the new `crm_sync_runs` entries.
Never print variable values, API responses, customer rows or exception bodies.

Observe Railway deployment terminal `SUCCESS`, then `PUPRIME_SYNC_ENABLED` and
`PUPRIME_SYNC_SUCCESS` logs and a successful database run. A healthy Telegram
process alone does not prove the import succeeded. Check failure authentication
with an invalid runtime secret and verify no records changed.

Rollback: set `PUPRIME_SYNC_ENABLED=false` and redeploy/restart the bot. The added
schema can remain unused; rollback never deletes existing CRM data.

## Current validation state

Nine local tests pass. Production migration was rejected by automatic approval
review pending explicit authorization for the schema/function/grant changes.
The migration, database idempotency test, Railway variables and deployment have
not been applied. No production import has run from this implementation.
