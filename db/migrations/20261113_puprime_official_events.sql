-- Official PU Prime IB API sync: verified account/allocation events only.
-- The documented API does not expose deposits, withdrawals, balances or
-- copy-trading subscriptions, so this migration intentionally does not infer
-- any of them.

alter table public.crm_puprime_events
  add column if not exists source_key text,
  add column if not exists notified_at timestamptz,
  add column if not exists notification_claim_id uuid,
  add column if not exists notification_claimed_at timestamptz;

create unique index if not exists crm_puprime_events_tenant_source_key_uidx
  on public.crm_puprime_events (tenant_id, source_key)
  where source_key is not null;

create or replace function private.crm_sync_puprime_official_api(
  p_secret text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  tenant uuid;
  run uuid := (p_payload->>'run_id')::uuid;
  started timestamptz := (p_payload->>'started_at')::timestamptz;
  r jsonb;
  existing public.puprime_clienti;
  bootstrap boolean;
  accounts_count integer := 0;
  events_count integer := 0;
  is_new boolean;
  result jsonb;
  account_no text;
  account_user text;
  source text;
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

  if run is null or started is null or started > now() + interval '5 minutes'
     or jsonb_typeof(p_payload->'accounts') is distinct from 'array'
     or jsonb_typeof(p_payload->'allocations') is distinct from 'array'
     or jsonb_typeof(p_payload->'leads') is distinct from 'array'
     or jsonb_typeof(p_payload->'commissions') is distinct from 'array' then
    raise exception 'invalid official API payload';
  end if;

  perform pg_advisory_xact_lock(hashtext('puprime-official-api'));

  select details into result
  from public.crm_sync_runs
  where id = run and status = 'success';
  if found then return result; end if;

  bootstrap := not exists (
    select 1 from public.crm_sync_runs
    where tenant_id = tenant and source = 'puprime-official-api' and status = 'success'
  );

  for r in select value from jsonb_array_elements(p_payload->'accounts') loop
    account_no := nullif(trim(r->>'numero_conto'), '');
    account_user := nullif(trim(r->>'id_utente'), '');
    if account_no is null or account_no !~ '^[0-9]+$' then
      raise exception 'invalid account';
    end if;

    select * into existing
    from public.puprime_clienti
    where numero_conto = account_no
    for update;
    is_new := not found;

    insert into public.puprime_clienti(
      numero_conto, affiliate_id, id_utente, piattaforma, valuta_base, attivo, aggiornato
    ) values (
      account_no,
      nullif(trim(r->>'affiliate_id'), ''),
      coalesce(account_user, existing.id_utente),
      coalesce(nullif(trim(r->>'piattaforma'), ''), existing.piattaforma),
      coalesce(nullif(trim(r->>'valuta_base'), ''), existing.valuta_base),
      true,
      now()
    ) on conflict (numero_conto) do update set
      affiliate_id = coalesce(excluded.affiliate_id, public.puprime_clienti.affiliate_id),
      id_utente = coalesce(excluded.id_utente, public.puprime_clienti.id_utente),
      piattaforma = coalesce(excluded.piattaforma, public.puprime_clienti.piattaforma),
      valuta_base = coalesce(excluded.valuta_base, public.puprime_clienti.valuta_base),
      attivo = true,
      aggiornato = now();
    accounts_count := accounts_count + 1;

    if not bootstrap and is_new then
      source := 'official-account:' || account_no;
      insert into public.crm_puprime_events(
        tenant_id, id_utente, event_type, payload, source_key
      ) values (
        tenant, account_user, 'account_opened',
        jsonb_build_object(
          'account', account_no,
          'platform', nullif(trim(r->>'piattaforma'), ''),
          'currency', nullif(trim(r->>'valuta_base'), ''),
          'account_type', nullif(trim(r->>'tipo_conto'), ''),
          'source', 'puprime_official_api'
        ), source
      ) on conflict (tenant_id, source_key) where source_key is not null do nothing;
      if found then events_count := events_count + 1; end if;
    end if;
  end loop;

  if not bootstrap then
    for r in select value from jsonb_array_elements(p_payload->'allocations') loop
      account_no := nullif(trim(r->>'account'), '');
      account_user := nullif(trim(r->>'user_id'), '');
      source := 'official-allocation:' || coalesce(account_user, '-') || ':' ||
        coalesce(account_no, '-') || ':' || coalesce(r->>'create_time', '-') || ':' ||
        coalesce(r->>'type', '-');
      insert into public.crm_puprime_events(
        tenant_id, id_utente, event_type, payload, source_key
      ) values (
        tenant, account_user,
        case lower(coalesce(r->>'type','')) when 'out' then 'allocation_out' else 'allocation_in' end,
        jsonb_build_object(
          'account', account_no,
          'occurred_at', nullif(r->>'create_time',''),
          'details', nullif(r->>'content',''),
          'source', 'puprime_official_api'
        ), source
      ) on conflict (tenant_id, source_key) where source_key is not null do nothing;
      if found then events_count := events_count + 1; end if;
    end loop;
  end if;

  result := jsonb_build_object(
    'status', 'success',
    'bootstrap', bootstrap,
    'accounts', accounts_count,
    'events', events_count,
    'allocations', jsonb_array_length(p_payload->'allocations'),
    'leads', jsonb_array_length(p_payload->'leads'),
    'commissions', jsonb_array_length(p_payload->'commissions')
  );

  insert into public.crm_sync_runs(
    id, tenant_id, source, status, started_at, completed_at, details
  ) values (
    run, tenant, 'puprime-official-api', 'success', started, now(), result
  ) on conflict (id) do update set
    status = 'success', completed_at = now(), details = excluded.details;

  return result;
end;
$function$;

create or replace function public.crm_sync_puprime_official_api(
  p_secret text,
  p_payload jsonb
) returns jsonb
language sql
set search_path = ''
as $function$
  select private.crm_sync_puprime_official_api(p_secret, p_payload);
$function$;

grant execute on function public.crm_sync_puprime_official_api(text, jsonb)
  to anon, authenticated, service_role;
