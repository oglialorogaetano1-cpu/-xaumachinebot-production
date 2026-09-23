-- Require an actual linked broker account under an allowed IB; contact status alone is insufficient.
create function private.crm_signal_room_has_ib(p_tenant uuid,p_user bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_leads l join public.puprime_clienti p
 on p.numero_conto=l.puprime_account_id
 where l.tenant_id=p_tenant and l.telegram_user_id=p_user
 and p.affiliate_id in ('7527073','23217421'));
$$;
revoke all on function private.crm_signal_room_has_ib(uuid,bigint) from public,anon,authenticated;
create or replace function public.crm_claim_expired_signal_room_members(p_secret text,p_tenant_slug text,p_limit integer default 100)
returns table(event_id uuid,channel_chat_id bigint,telegram_user_id bigint,user_chat_id bigint,full_name text,language text)
language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 select id into t from public.crm_tenants where slug=p_tenant_slug and status not in ('suspended','cancelled');
 if t is null or not private.crm_verify_tenant_runtime_secret(t,'telegram_start_tracking',p_secret) then
 raise exception 'unauthorized' using errcode='42501'; end if;
 -- Do not remove people while the broker import is stale or unavailable.
 if (select count(*) from private.puprime_api_reports where tenant_id=t
 and affiliate_id in ('7527073','23217421') and fetched_at>now()-interval '2 hours')<>2 then
 raise exception 'broker_verification_unavailable'; end if;
 update public.crm_channel_join_events e set
 ib_verified_at=case when private.crm_signal_room_has_ib(t,e.telegram_user_id) then now() else null end,
 moderation_checked_at=now(),updated_at=now()
 where e.tenant_id=t and e.source='signal_room_24h' and e.access_expires_at<=now() and e.removed_at is null;
 return query with due as (
 select e.id from public.crm_channel_join_events e
 where e.tenant_id=t and e.source='signal_room_24h' and e.access_expires_at<=now()
 and e.removed_at is null and e.ib_verified_at is null
 and not exists(select 1 from public.crm_signal_room_allowlist a where a.tenant_id=t and a.telegram_user_id=e.telegram_user_id)
 and (e.moderation_claimed_at is null or e.moderation_claimed_at<now()-interval '10 minutes')
 order by e.access_expires_at limit greatest(1,least(coalesce(p_limit,100),200)) for update skip locked
 ), claimed as (
 update public.crm_channel_join_events e set moderation_claimed_at=now(),moderation_checked_at=now(),updated_at=now()
 from due where e.id=due.id returning e.*)
 select c.id,c.channel_chat_id,c.telegram_user_id,c.user_chat_id,c.full_name,c.language from claimed c;
end;
$$;
create function public.crm_signal_room_removal_allowed(p_secret text,p_event_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.crm_channel_join_events;
begin
 select * into e from public.crm_channel_join_events where id=p_event_id and source='signal_room_24h';
 if e.id is null or not private.crm_verify_tenant_runtime_secret(e.tenant_id,'telegram_start_tracking',p_secret) then
 raise exception 'unauthorized' using errcode='42501'; end if;
 return e.access_expires_at<=now() and e.removed_at is null
 and (select count(*) from private.puprime_api_reports where tenant_id=e.tenant_id and fetched_at>now()-interval '2 hours')=2
 and not private.crm_signal_room_has_ib(e.tenant_id,e.telegram_user_id)
 and not exists(select 1 from public.crm_signal_room_allowlist a where a.tenant_id=e.tenant_id and a.telegram_user_id=e.telegram_user_id);
end;
$$;
revoke all on function public.crm_signal_room_removal_allowed(text,uuid) from public;
grant execute on function public.crm_signal_room_removal_allowed(text,uuid) to anon,authenticated;
