-- Verified daily earnings and current withdrawable balance are different metrics.
create table public.puprime_rebate_giornalieri (
  tenant_id uuid not null references public.crm_tenants(id),
  affiliate_id text not null check (affiliate_id in ('7527073','23217421')),
  data date not null,
  commissioni_usd numeric not null,
  aggiornato timestamptz not null,
  primary key (tenant_id,affiliate_id,data)
);
create table public.puprime_rebate_saldi (
  tenant_id uuid not null references public.crm_tenants(id),
  affiliate_id text not null check (affiliate_id in ('7527073','23217421')),
  saldo_disponibile_usd numeric not null,
  aggiornato timestamptz not null,
  primary key (tenant_id,affiliate_id)
);
alter table public.puprime_rebate_giornalieri enable row level security;
alter table public.puprime_rebate_saldi enable row level security;
revoke all on public.puprime_rebate_giornalieri,public.puprime_rebate_saldi from anon,authenticated;
grant select on public.puprime_rebate_giornalieri,public.puprime_rebate_saldi to authenticated;
create policy rebate_daily_tenant_read on public.puprime_rebate_giornalieri
 for select to authenticated using (private.crm_has_tenant_access(tenant_id,false));
create policy rebate_balance_tenant_read on public.puprime_rebate_saldi
 for select to authenticated using (private.crm_has_tenant_access(tenant_id,false));

create function public.crm_puprime_rebate_summary(p_day date default (now() at time zone 'Europe/Rome')::date)
returns jsonb language sql stable security invoker set search_path='' as $$
 with ibs(affiliate_id) as (values ('7527073'::text),('23217421'::text)),
 metrics as (
 select i.affiliate_id,
   (select sum(r.commissioni_usd) from public.puprime_rebate_giornalieri r
     where r.affiliate_id=i.affiliate_id and r.data=p_day) as daily,
   (select case when count(distinct r.data)=extract(day from p_day)::int
      then sum(r.commissioni_usd) else null end from public.puprime_rebate_giornalieri r
     where r.affiliate_id=i.affiliate_id and r.data between date_trunc('month',p_day)::date and p_day) as monthly,
   (select sum(s.saldo_disponibile_usd) from public.puprime_rebate_saldi s
     where s.affiliate_id=i.affiliate_id) as available_balance,
   (select max(r.aggiornato) from public.puprime_rebate_giornalieri r
     where r.affiliate_id=i.affiliate_id and r.data=p_day) as earnings_updated_at,
   (select max(s.aggiornato) from public.puprime_rebate_saldi s
     where s.affiliate_id=i.affiliate_id) as balance_updated_at
 from ibs i)
 select jsonb_build_object('day',p_day,'month',to_char(p_day,'YYYY-MM'),'timezone','Europe/Rome','currency','USD',
   'daily',case when count(daily)=2 then sum(daily) else null end,
   'monthly',case when count(monthly)=2 then sum(monthly) else null end,
   'available_balance',case when count(available_balance)=2 then sum(available_balance) else null end,
   'ibs',jsonb_agg(to_jsonb(metrics) order by affiliate_id)) from metrics;
$$;
revoke all on function public.crm_puprime_rebate_summary(date) from public,anon;
grant execute on function public.crm_puprime_rebate_summary(date) to authenticated;
