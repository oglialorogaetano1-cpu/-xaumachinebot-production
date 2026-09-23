create table private.puprime_alert_state (
 tenant_id uuid primary key references public.crm_tenants(id),
 code text, first_seen timestamptz, last_seen timestamptz,
 last_claim timestamptz, claim_id uuid, delivered_at timestamptz
);
alter table private.puprime_alert_state enable row level security;
revoke all on private.puprime_alert_state from public,anon,authenticated;
create function private.crm_puprime_alert(p_secret text,p_code text,p_claim uuid default null,p_delivered boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; s private.puprime_alert_state; eligible boolean;
begin
 select id into t from public.crm_tenants where slug='xau-machine' and status not in ('suspended','cancelled');
 if t is null or not private.crm_verify_tenant_runtime_secret(t,'telegram_start_tracking',p_secret) then
 raise exception 'unauthorized' using errcode='42501'; end if;
 if p_code not in ('healthy','rebate_unavailable','sync_failed','upstream_verification_required') then raise exception 'invalid code'; end if;
 insert into private.puprime_alert_state(tenant_id) values(t) on conflict do nothing;
 select * into s from private.puprime_alert_state where tenant_id=t for update;
 if p_claim is not null then
  if s.claim_id=p_claim then
   update private.puprime_alert_state set delivered_at=case when p_delivered then now() else delivered_at end,
    last_claim=case when p_delivered then last_claim else null end,claim_id=null where tenant_id=t;
  end if;
  return jsonb_build_object('notify',false);
 end if;
 if p_code='healthy' then
  update private.puprime_alert_state set code=null,first_seen=null,last_seen=now() where tenant_id=t;
  return jsonb_build_object('notify',false);
 end if;
 if s.code is distinct from p_code or s.last_seen < now()-interval '2 hours' then s.first_seen:=now(); end if;
 eligible := (p_code<>'rebate_unavailable' or s.first_seen<=now()-interval '45 minutes')
  and (s.delivered_at is null or s.delivered_at<=now()-interval '24 hours')
  and (s.last_claim is null or s.last_claim<=now()-interval '10 minutes');
 update private.puprime_alert_state set code=p_code,first_seen=s.first_seen,last_seen=now(),
  last_claim=case when eligible then now() else last_claim end,
  claim_id=case when eligible then gen_random_uuid() else claim_id end where tenant_id=t returning * into s;
 return jsonb_build_object('notify',eligible,'claim_id',case when eligible then s.claim_id else null end);
end;
$$;
revoke all on function private.crm_puprime_alert(text,text,uuid,boolean) from public;
grant execute on function private.crm_puprime_alert(text,text,uuid,boolean) to anon,authenticated;
create function public.crm_puprime_alert(p_secret text,p_code text,p_claim uuid default null,p_delivered boolean default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.crm_puprime_alert(p_secret,p_code,p_claim,p_delivered);
$$;
revoke all on function public.crm_puprime_alert(text,text,uuid,boolean) from public;
grant execute on function public.crm_puprime_alert(text,text,uuid,boolean) to anon,authenticated;
-- Seed only a continuing, recorded missing-rebate incident; no synthetic runs.
insert into private.puprime_alert_state(tenant_id,code,first_seen,last_seen)
select t.id,'rebate_unavailable',min(r.started_at),max(r.started_at)
from public.crm_tenants t join public.crm_sync_runs r on r.tenant_id=t.id
where t.slug='xau-machine' and r.source='puprime' and r.details->>'mode'='hourly_api'
 and r.status='success' and r.details->>'rebate_available'='false'
 and r.started_at>now()-interval '2 hours'
 and not exists(select 1 from public.crm_sync_runs h where h.tenant_id=t.id
  and h.source='puprime' and h.started_at>r.started_at and h.details->>'rebate_available'='true')
group by t.id having count(*)>=2
on conflict do nothing;
