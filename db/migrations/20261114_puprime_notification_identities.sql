-- Enrich private admin notifications with verified identity information only.
-- The account holder's name comes from the official PU Prime account record.
-- A Telegram username is emitted exclusively through an existing exact event
-- to CRM lead association; never infer a Telegram identity from a name.

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
  select
    e.id,
    e.event_type,
    e.id_utente,
    e.payload || jsonb_strip_nulls(jsonb_build_object(
      'customer_name', coalesce(nullif(e.payload->>'customer_name', ''), pc.nome, l.full_name),
      'telegram_username', coalesce(nullif(l.telegram_username, ''), nullif(l.username, ''))
    )),
    e.created_at
  from public.crm_puprime_events e
  left join public.puprime_clienti pc
    on pc.numero_conto = nullif(e.payload->>'account', '')
  left join public.crm_leads l
    on l.id = e.lead_id
  where e.tenant_id = tenant
    and e.notified_at is null
    and e.event_type in ('account_opened', 'allocation_in', 'allocation_out', 'copy_activated')
  order by e.created_at asc
  limit safe_limit;
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

grant execute on function public.crm_pull_puprime_notifications(text, integer)
  to anon, authenticated, service_role;
