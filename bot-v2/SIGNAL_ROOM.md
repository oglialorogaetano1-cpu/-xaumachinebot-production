# Signal room access enforcement

Production room identity is set with SIGNAL_ROOM_CHAT_ID after verifying the
Telegram room and bot administrator rights. New member events and approval
requests in this room are tracked regardless of invite link. Other rooms are
excluded. The first recorded approval/join starts 24 hours; returning does not
reset that deadline. Polling runs every five minutes.

Eligibility uses a CRM lead's linked account joined to puprime_clienti with
affiliate_id 7527073 or 23217421. A registered text status alone is insufficient.
Eligibility is re-evaluated after expiry and immediately before moderation.
Both broker snapshots must be newer than two hours; otherwise removals pause.
Existing explicit allowlist entries, Telegram administrators and bots are exempt.
Telegram failures are recorded for retry. Removal uses ban then unban to permit
re-entry; an expired returning member is checked again without a new free trial.

Validation: five moderation unit tests, fifteen sync tests, Python compile and
SQL rollback checks of both accepted IBs and rejected foreign IB passed. Bot
administrator permissions can_restrict_members and can_invite_users were verified
with Telegram read-only requests. No real customer was expelled as a test.

Limits: Telegram Bot API cannot enumerate all historical members or recover their
join timestamps. The existing recorded membership tables were empty at audit;
pre-existing members cannot be retroactively timed without a reliable roster.
An older Supabase sweep uses crm_signal_room_members, a separate empty table; this
change does not feed it or change that legacy workflow. Broker snapshots are a
rolling report; disappearing accounts are not automatically treated as proof of
an IB transfer. Identity linkage still depends on the CRM account matching flow.
