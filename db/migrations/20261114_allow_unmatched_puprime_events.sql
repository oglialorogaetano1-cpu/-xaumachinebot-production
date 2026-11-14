-- PU Prime can report an account before that customer has a CRM/Telegram
-- lead.  The event still has a verified PU Prime user ID, so retaining it is
-- necessary for later matching and for the administrator notification flow.
alter table public.crm_puprime_events
  alter column lead_id drop not null;
