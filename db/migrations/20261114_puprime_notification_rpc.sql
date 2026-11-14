-- The Telegram bot must never read crm_puprime_events directly with the
-- public Supabase key.  The table is protected by RLS.  These two narrowly
-- scoped RPCs authenticate with the existing tenant runtime secret instead.

create or replace function private.crm_pull_puprime_notifications(
  p_secret text,
  p_limit integer default 25
) returns table(
  id uuid,
  event_type text,
  id_utente text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  tenant uuid;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  select t.id into tenant
  from public.crm_tenants t
  where t.slug = 'xau-machine' and t.status not in ('suspended', 'cancelled');

  if tenant is null
     or not private.crm_verify_tenant_runtime_secret(
       tenant, 'telegram_start_tracking', p_secret
     ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
  select e.id, e.event_type, e.id_utente, e.payload, e.created_at
  from public.crm_puprime_events e
  where e.tenant_id = tenant
    and e.notified_at is null
    and e.event_type in ('account_opened', 'allocation_in', 'allocation_out', 'copy_activated')
  order by e.created_at asc
  limit safe_limit;
end;
$function$;

create or replace function private.crm_ack_puprime_notification(
  p_secret text,
  p_event_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  tenant uuid;
begin
  select id into tenant
  from public.crm_tenants
  where slug = 'xau-machine' and status not in ('suspended', 'cancelled');

  if tenant is null
     or not private.crm_verify_tenant_runtime_secret(
       tenant, 'telegram_start_tracking', p_secret
     ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.crm_puprime_events
  set notified_at = now()
  where id = p_event_id
    and tenant_id = tenant
    and notified_at is null;

  return found;
end;
$function$;

create or replace function public.crm_pull_puprime_notifications(
  p_secret text,
  p_limit integer default 25
) returns table(
  id uuid,
  event_type text,
  id_utente text,
  payload jsonb,
  created_at timestamptz
)
language sql
set search_path = ''
as $function$
  select * from private.crm_pull_puprime_notifications(p_secret, p_limit);
$function$;

create or replace function public.crm_ack_puprime_notification(
  p_secret text,
  p_event_id uuid
) returns boolean
language sql
set search_path = ''
as $function$
  select private.crm_ack_puprime_notification(p_secret, p_event_id);
$function$;

grant execute on function public.crm_pull_puprime_notifications(text, integer)
  to anon, authenticated, service_role;
grant execute on function public.crm_ack_puprime_notification(text, uuid)
  to anon, authenticated, service_role;
