-- Machine-only importer: reuse the existing scoped bot runtime secret.
-- The exposed wrapper is SECURITY INVOKER; privileged implementation is private.
create table private.puprime_api_reports (
  tenant_id uuid not null references public.crm_tenants(id),
  affiliate_id text not null check (affiliate_id in ('7527073','23217421')),
  report jsonb not null,
  fetched_at timestamptz not null,
  primary key (tenant_id, affiliate_id)
);
alter table private.puprime_api_reports enable row level security;
revoke all on private.puprime_api_reports from public, anon, authenticated;

create function private.crm_sync_puprime_api(p_secret text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant uuid;
  run uuid := (p_payload->>'run_id')::uuid;
  started timestamptz := (p_payload->>'started_at')::timestamptz;
  r jsonb;
  c public.puprime_clienti;
  client_count integer := 0;
  day_count integer := 0;
  day_key text;
  matching_days integer;
  result jsonb;
begin
  select id into tenant from public.crm_tenants
    where slug='xau-machine' and status not in ('suspended','cancelled');
  if tenant is null or not private.crm_verify_tenant_runtime_secret(tenant,'telegram_start_tracking',p_secret) then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  if run is null or started is null or started > now() + interval '5 minutes' then
    raise exception 'invalid run';
  end if;
  perform pg_advisory_xact_lock(hashtext('puprime-hourly-api'));
  select details into result from public.crm_sync_runs where id=run and status='success';
  if found then return result; end if;
  if p_payload->>'status' = 'failed' then
    insert into public.crm_sync_runs(id,tenant_id,source,status,started_at,completed_at,details)
    values(run,tenant,'puprime','failed',started,now(),jsonb_build_object(
      'mode','hourly_api','error_category',left(p_payload->>'error_category',64),'http_status',p_payload->'http_status'))
    on conflict(id) do nothing;
    return jsonb_build_object('status','failed');
  end if;
  if p_payload->>'status' is distinct from 'success'
    or jsonb_typeof(p_payload->'clients') is distinct from 'array'
    or jsonb_typeof(p_payload->'daily') is distinct from 'array'
    or jsonb_typeof(p_payload->'reports'->'7527073') is distinct from 'object'
    or jsonb_typeof(p_payload->'reports'->'23217421') is distinct from 'object'
    or (p_payload->'reports'->'7527073') ? 'error'
    or (p_payload->'reports'->'23217421') ? 'error'
    or jsonb_array_length(p_payload->'clients') > 10000 then
    raise exception 'invalid complete report';
  end if;
  if exists(select 1 from private.puprime_api_reports where tenant_id=tenant and fetched_at>started) then
    raise exception 'stale report';
  end if;
  for r in select value from jsonb_array_elements(p_payload->'clients') loop
    if coalesce(r->>'numero_conto','') !~ '^[0-9]+$'
      or coalesce(r->>'affiliate_id','') not in ('7527073','23217421') then
      raise exception 'invalid account';
    end if;
    -- Merge sparse API fields onto the stored row. Manual/KYC/rebate fields are
    -- deliberately not part of this importer; SQL NULL never clears known data.
    select * into c from public.puprime_clienti where numero_conto=r->>'numero_conto' for update;
    c.numero_conto := r->>'numero_conto';
    c.affiliate_id := r->>'affiliate_id';
    c.id_utente := coalesce(nullif(r->>'id_utente',''),c.id_utente);
    c.nome := coalesce(nullif(r->>'nome',''),c.nome);
    c.email := coalesce(nullif(r->>'email',''),c.email);
    c.piattaforma := coalesce(nullif(r->>'piattaforma',''),c.piattaforma);
    c.valuta_base := coalesce(nullif(r->>'valuta_base',''),c.valuta_base);
    c.fonte_campagna := coalesce(nullif(r->>'fonte_campagna',''),c.fonte_campagna);
    c.saldo := coalesce((r->>'saldo')::numeric,c.saldo);
    c.saldo_conto := coalesce((r->>'saldo_conto')::numeric,c.saldo_conto);
    if r->>'ultimo_deposito_data' is not null and
      (c.ultimo_deposito_data is null or
       (r->>'ultimo_deposito_data')::date >= case
         when c.ultimo_deposito_data ~ '^\d{2}/\d{2}/\d{4}' then to_date(left(c.ultimo_deposito_data,10),'DD/MM/YYYY')
         else left(c.ultimo_deposito_data,10)::date end) then
      c.ultimo_deposito_data := r->>'ultimo_deposito_data';
      c.ultimo_deposito_importo := (r->>'ultimo_deposito_importo')::numeric;
      c.ultimo_deposito_valuta := r->>'ultimo_deposito_valuta';
    end if;
    insert into public.puprime_clienti(numero_conto,affiliate_id,id_utente,nome,email,piattaforma,valuta_base,fonte_campagna,saldo,saldo_conto,
       ultimo_deposito_data,ultimo_deposito_importo,ultimo_deposito_valuta,aggiornato)
    values(c.numero_conto,c.affiliate_id,c.id_utente,c.nome,c.email,c.piattaforma,c.valuta_base,c.fonte_campagna,c.saldo,c.saldo_conto,
       c.ultimo_deposito_data,c.ultimo_deposito_importo,c.ultimo_deposito_valuta,now())
    on conflict(numero_conto) do update set
       affiliate_id=excluded.affiliate_id,id_utente=excluded.id_utente,nome=excluded.nome,email=excluded.email,
       piattaforma=excluded.piattaforma,valuta_base=excluded.valuta_base,fonte_campagna=excluded.fonte_campagna,
       saldo=excluded.saldo,saldo_conto=excluded.saldo_conto,ultimo_deposito_data=excluded.ultimo_deposito_data,
       ultimo_deposito_importo=excluded.ultimo_deposito_importo,ultimo_deposito_valuta=excluded.ultimo_deposito_valuta,aggiornato=now();
    client_count := client_count+1;
  end loop;
  for r in select value from jsonb_array_elements(p_payload->'daily') loop
    -- Respect either existing CRM date representation; never duplicate a date.
    select min(data),count(*) into day_key,matching_days from public.puprime_rebate
       where data in (r->>'data',to_char((r->>'data')::date,'DD/MM/YYYY'));
    if matching_days>1 then raise exception 'ambiguous existing date'; end if;
    day_key := coalesce(day_key,r->>'data');
    insert into public.puprime_rebate(data,depositi_usd,prelievi_usd,depositi_netti_usd,aggiornato)
    values(day_key,(r->>'depositi_usd')::numeric,(r->>'prelievi_usd')::numeric,(r->>'depositi_netti_usd')::numeric,now())
    on conflict(data) do update set depositi_usd=excluded.depositi_usd,prelievi_usd=excluded.prelievi_usd,
       depositi_netti_usd=excluded.depositi_netti_usd,aggiornato=now();
    day_count := day_count+1;
  end loop;
  for r in select jsonb_build_object('ib',key,'report',value) from jsonb_each(p_payload->'reports') loop
    insert into private.puprime_api_reports(tenant_id,affiliate_id,report,fetched_at)
      values(tenant,r->>'ib',r->'report',started)
    on conflict(tenant_id,affiliate_id) do update set report=excluded.report,fetched_at=excluded.fetched_at;
  end loop;
  result := jsonb_build_object('mode','hourly_api','clients',client_count,'days',day_count,
    'counts',p_payload->'counts','rebate_available',false);
  insert into public.crm_sync_runs(id,tenant_id,source,status,started_at,completed_at,details)
  values(run,tenant,'puprime','success',started,now(),result)
  on conflict(id) do update set status='success',completed_at=now(),details=excluded.details;
  return result;
end;
$$;
revoke all on function private.crm_sync_puprime_api(text,jsonb) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.crm_sync_puprime_api(text,jsonb) to anon, authenticated;
create function public.crm_sync_puprime_api(p_secret text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.crm_sync_puprime_api(p_secret,p_payload);
$$;
revoke all on function public.crm_sync_puprime_api(text,jsonb) from public;
grant execute on function public.crm_sync_puprime_api(text,jsonb) to anon, authenticated;
