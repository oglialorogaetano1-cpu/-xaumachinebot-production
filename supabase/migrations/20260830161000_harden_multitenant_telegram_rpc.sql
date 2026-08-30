create table if not exists private.crm_tenant_runtime_secrets (
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  name text not null,
  secret_sha256 text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, name)
);

insert into private.crm_tenant_runtime_secrets(tenant_id, name, secret_sha256)
select '00000000-0000-4000-8000-000000000001', name, secret_sha256
from private.crm_runtime_secrets
where name='telegram_start_tracking'
on conflict (tenant_id, name) do update set
  secret_sha256=excluded.secret_sha256,
  updated_at=now();

create table if not exists public.crm_public_tenant_config (
  tenant_id uuid primary key references public.crm_tenants(id) on delete cascade,
  tenant_slug text not null unique,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.crm_public_tenant_config enable row level security;
drop policy if exists crm_public_config_read on public.crm_public_tenant_config;
create policy crm_public_config_read on public.crm_public_tenant_config
for select to anon, authenticated using (true);
grant select on public.crm_public_tenant_config to anon, authenticated;

insert into public.crm_public_tenant_config(tenant_id, tenant_slug, config)
select t.id, t.slug,
  jsonb_strip_nulls(jsonb_build_object(
    'welcome_message', i.public_config->'welcome_message',
    'welcome_messages', i.public_config->'welcome_messages',
    'welcome_command', i.public_config->'welcome_command',
    'customer_mode', i.public_config->'customer_mode',
    'customer_commands_enabled', i.public_config->'customer_commands_enabled'
  ))
from public.crm_tenants t
left join public.crm_integrations i on i.tenant_id=t.id and i.provider='telegram'
where t.id='00000000-0000-4000-8000-000000000001'
on conflict (tenant_id) do update set
  tenant_slug=excluded.tenant_slug,
  config=excluded.config,
  updated_at=now();

insert into public.crm_public_tenant_config(tenant_id, tenant_slug, config)
values ('00000000-0000-4000-8000-000000000002', 'demo', '{"welcome_message":"Benvenuto nella demo XAU Machine"}'::jsonb)
on conflict (tenant_id) do nothing;

create or replace function private.crm_sync_public_telegram_config()
returns trigger
language plpgsql
security definer
set search_path=public, pg_temp
as $$
declare
  v_slug text;
begin
  if new.provider <> 'telegram' then
    return new;
  end if;
  select slug into v_slug from public.crm_tenants where id=new.tenant_id;
  insert into public.crm_public_tenant_config(tenant_id, tenant_slug, config, updated_at)
  values (
    new.tenant_id,
    v_slug,
    jsonb_strip_nulls(jsonb_build_object(
      'welcome_message', new.public_config->'welcome_message',
      'welcome_messages', new.public_config->'welcome_messages',
      'welcome_command', new.public_config->'welcome_command',
      'customer_mode', new.public_config->'customer_mode',
      'customer_commands_enabled', new.public_config->'customer_commands_enabled'
    )),
    now()
  )
  on conflict (tenant_id) do update set
    tenant_slug=excluded.tenant_slug,
    config=excluded.config,
    updated_at=now();
  return new;
end;
$$;

revoke all on function private.crm_sync_public_telegram_config() from public, anon, authenticated;
drop trigger if exists crm_sync_public_telegram_config_trigger on public.crm_integrations;
create trigger crm_sync_public_telegram_config_trigger
after insert or update of public_config, provider, tenant_id on public.crm_integrations
for each row execute function private.crm_sync_public_telegram_config();

create or replace function public.crm_get_telegram_welcome()
returns text
language sql
stable
security invoker
set search_path=public, pg_temp
as $$
  select config->>'welcome_message'
  from public.crm_public_tenant_config
  where tenant_slug='xau-machine'
  limit 1;
$$;

create or replace function public.crm_get_telegram_welcome(p_deep_link_code text)
returns text
language sql
stable
security invoker
set search_path=public, pg_temp
as $$
  with cfg as (
    select tenant_id, config
    from public.crm_public_tenant_config
    where tenant_slug='xau-machine'
  ), campaign as (
    select c.language
    from public.crm_campaigns c join cfg on cfg.tenant_id=c.tenant_id
    where c.deep_link_code=coalesce(p_deep_link_code,'tg_direct') and c.active=true
    limit 1
  )
  select coalesce(
    cfg.config->'welcome_messages'->>campaign.language,
    cfg.config->'welcome_messages'->>split_part(campaign.language,'-',1),
    cfg.config->'welcome_messages'->>'it',
    cfg.config->>'welcome_message'
  )
  from cfg left join campaign on true;
$$;

create or replace function public.crm_get_telegram_welcome(p_tenant_slug text, p_deep_link_code text)
returns text
language sql
stable
security invoker
set search_path=public, pg_temp
as $$
  with cfg as (
    select tenant_id, config
    from public.crm_public_tenant_config
    where tenant_slug=coalesce(nullif(p_tenant_slug,''),'xau-machine')
  ), campaign as (
    select c.language
    from public.crm_campaigns c join cfg on cfg.tenant_id=c.tenant_id
    where c.deep_link_code=coalesce(p_deep_link_code,'tg_direct') and c.active=true
    limit 1
  )
  select coalesce(
    cfg.config->'welcome_messages'->>campaign.language,
    cfg.config->'welcome_messages'->>split_part(campaign.language,'-',1),
    cfg.config->'welcome_messages'->>'it',
    cfg.config->>'welcome_message'
  )
  from cfg left join campaign on true;
$$;

grant execute on function public.crm_get_telegram_welcome() to anon, authenticated;
grant execute on function public.crm_get_telegram_welcome(text) to anon, authenticated;
grant execute on function public.crm_get_telegram_welcome(text,text) to anon, authenticated;

create or replace function private.crm_verify_tenant_runtime_secret(p_tenant_id uuid, p_name text, p_secret text)
returns boolean
language sql
stable
security definer
set search_path=private, extensions, pg_temp
as $$
  select exists (
    select 1 from private.crm_tenant_runtime_secrets s
    where s.tenant_id=p_tenant_id and s.name=p_name
      and s.secret_sha256=encode(digest(coalesce(p_secret,''),'sha256'),'hex')
  );
$$;

revoke all on function private.crm_verify_tenant_runtime_secret(uuid,text,text) from public, anon, authenticated;

create or replace function public.crm_track_telegram_start(
  p_secret text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_full_name text,
  p_username text,
  p_deep_link_code text
)
returns uuid
language plpgsql
security definer
set search_path=public, private, extensions, pg_temp
as $$
declare
  v_tenant_id constant uuid := '00000000-0000-4000-8000-000000000001';
  v_campaign public.crm_campaigns%rowtype;
  v_lead_id uuid;
begin
  if not private.crm_verify_tenant_runtime_secret(v_tenant_id,'telegram_start_tracking',p_secret) then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  select * into v_campaign from public.crm_campaigns
  where tenant_id=v_tenant_id and deep_link_code=coalesce(p_deep_link_code,'tg_direct') and active=true;
  if not found then
    select * into v_campaign from public.crm_campaigns
    where tenant_id=v_tenant_id and deep_link_code='tg_direct' and active=true;
  end if;
  insert into public.crm_leads(
    tenant_id,telegram_user_id,telegram_chat_id,full_name,username,language,product,
    campaign_id,first_source,last_source,status,last_contact_at,updated_at
  ) values (
    v_tenant_id,p_telegram_user_id,p_telegram_chat_id,nullif(p_full_name,''),nullif(p_username,''),
    coalesce(v_campaign.language,'it'),'xau_machine',v_campaign.id,
    coalesce(v_campaign.source_channel,'organic'),coalesce(v_campaign.source_channel,'organic'),
    'new',now(),now()
  )
  on conflict(tenant_id,telegram_user_id) do update set
    telegram_chat_id=excluded.telegram_chat_id,
    full_name=coalesce(excluded.full_name,crm_leads.full_name),
    username=coalesce(excluded.username,crm_leads.username),
    language=coalesce(excluded.language,crm_leads.language),
    campaign_id=coalesce(crm_leads.campaign_id,excluded.campaign_id),
    last_source=excluded.last_source,last_contact_at=now(),updated_at=now()
  returning id into v_lead_id;
  return v_lead_id;
end;
$$;

create or replace function public.crm_track_telegram_start(
  p_secret text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_full_name text,
  p_username text,
  p_deep_link_code text,
  p_tenant_slug text
)
returns uuid
language plpgsql
security definer
set search_path=public, private, extensions, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_campaign public.crm_campaigns%rowtype;
  v_lead_id uuid;
begin
  select id into v_tenant_id from public.crm_tenants
  where slug=coalesce(nullif(p_tenant_slug,''),'xau-machine') and status not in ('suspended','cancelled');
  if v_tenant_id is null or not private.crm_verify_tenant_runtime_secret(v_tenant_id,'telegram_start_tracking',p_secret) then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  select * into v_campaign from public.crm_campaigns
  where tenant_id=v_tenant_id and deep_link_code=coalesce(p_deep_link_code,'tg_direct') and active=true;
  if not found then
    select * into v_campaign from public.crm_campaigns
    where tenant_id=v_tenant_id and deep_link_code='tg_direct' and active=true;
  end if;
  insert into public.crm_leads(
    tenant_id,telegram_user_id,telegram_chat_id,full_name,username,language,product,
    campaign_id,first_source,last_source,status,last_contact_at,updated_at
  ) values (
    v_tenant_id,p_telegram_user_id,p_telegram_chat_id,nullif(p_full_name,''),nullif(p_username,''),
    coalesce(v_campaign.language,'it'),'xau_machine',v_campaign.id,
    coalesce(v_campaign.source_channel,'organic'),coalesce(v_campaign.source_channel,'organic'),
    'new',now(),now()
  )
  on conflict(tenant_id,telegram_user_id) do update set
    telegram_chat_id=excluded.telegram_chat_id,
    full_name=coalesce(excluded.full_name,crm_leads.full_name),
    username=coalesce(excluded.username,crm_leads.username),
    language=coalesce(excluded.language,crm_leads.language),
    campaign_id=coalesce(crm_leads.campaign_id,excluded.campaign_id),
    last_source=excluded.last_source,last_contact_at=now(),updated_at=now()
  returning id into v_lead_id;
  return v_lead_id;
end;
$$;

create or replace function public.crm_record_telegram_message(
  p_secret text,
  p_tenant_slug text,
  p_telegram_chat_id bigint,
  p_direction text,
  p_sender_type text,
  p_body text,
  p_external_message_id text default null
)
returns uuid
language plpgsql
security definer
set search_path=public, private, extensions, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_lead_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  if p_direction not in ('inbound','outbound') or p_sender_type not in ('lead','ai','human','system') then
    raise exception 'invalid message classification' using errcode='22023';
  end if;
  select id into v_tenant_id from public.crm_tenants
  where slug=coalesce(nullif(p_tenant_slug,''),'xau-machine') and status not in ('suspended','cancelled');
  if v_tenant_id is null or not private.crm_verify_tenant_runtime_secret(v_tenant_id,'telegram_start_tracking',p_secret) then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  select id into v_lead_id from public.crm_leads
  where tenant_id=v_tenant_id and telegram_chat_id=p_telegram_chat_id;
  if v_lead_id is null then
    insert into public.crm_leads(tenant_id,telegram_chat_id,language,product,first_source,status,last_contact_at)
    values(v_tenant_id,p_telegram_chat_id,'it','xau_machine','organic','new',now())
    returning id into v_lead_id;
  end if;
  select id into v_conversation_id from public.crm_conversations
  where tenant_id=v_tenant_id and lead_id=v_lead_id and channel='telegram' and status='open'
  order by created_at desc limit 1;
  if v_conversation_id is null then
    insert into public.crm_conversations(tenant_id,lead_id,channel,bot_key,status,last_message_at)
    values(v_tenant_id,v_lead_id,'telegram',p_tenant_slug,'open',now())
    returning id into v_conversation_id;
  end if;
  if p_external_message_id is not null then
    select id into v_message_id from public.crm_messages
    where tenant_id=v_tenant_id and external_message_id=p_external_message_id limit 1;
    if v_message_id is not null then return v_message_id; end if;
  end if;
  insert into public.crm_messages(tenant_id,conversation_id,direction,sender_type,body,external_message_id)
  values(v_tenant_id,v_conversation_id,p_direction,p_sender_type,nullif(p_body,''),p_external_message_id)
  returning id into v_message_id;
  update public.crm_conversations set last_message_at=now() where id=v_conversation_id;
  update public.crm_leads set last_contact_at=now(),updated_at=now() where id=v_lead_id;
  return v_message_id;
end;
$$;

create or replace function public.crm_request_human_handoff(
  p_secret text,
  p_tenant_slug text,
  p_telegram_chat_id bigint,
  p_reason text,
  p_priority text default 'high'
)
returns uuid
language plpgsql
security definer
set search_path=public, private, extensions, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_lead_id uuid;
  v_conversation_id uuid;
  v_handoff_id uuid;
begin
  if p_priority not in ('low','medium','high','urgent') then
    raise exception 'invalid priority' using errcode='22023';
  end if;
  select id into v_tenant_id from public.crm_tenants
  where slug=coalesce(nullif(p_tenant_slug,''),'xau-machine') and status not in ('suspended','cancelled');
  if v_tenant_id is null or not private.crm_verify_tenant_runtime_secret(v_tenant_id,'telegram_start_tracking',p_secret) then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  select id into v_lead_id from public.crm_leads
  where tenant_id=v_tenant_id and telegram_chat_id=p_telegram_chat_id;
  if v_lead_id is null then
    raise exception 'lead not found' using errcode='P0002';
  end if;
  select id into v_conversation_id from public.crm_conversations
  where tenant_id=v_tenant_id and lead_id=v_lead_id and channel='telegram'
  order by created_at desc limit 1;
  select id into v_handoff_id from public.crm_human_handoffs
  where tenant_id=v_tenant_id and lead_id=v_lead_id and status in ('open','assigned')
  order by created_at desc limit 1;
  if v_handoff_id is not null then return v_handoff_id; end if;
  insert into public.crm_human_handoffs(tenant_id,lead_id,conversation_id,reason,priority,requested_channel,status)
  values(v_tenant_id,v_lead_id,v_conversation_id,coalesce(nullif(p_reason,''),'Richiesta operatore'),p_priority,'telegram','open')
  returning id into v_handoff_id;
  return v_handoff_id;
end;
$$;

revoke all on function public.crm_track_telegram_start(text,bigint,bigint,text,text,text) from public, authenticated;
revoke all on function public.crm_track_telegram_start(text,bigint,bigint,text,text,text,text) from public, authenticated;
revoke all on function public.crm_record_telegram_message(text,text,bigint,text,text,text,text) from public, authenticated;
revoke all on function public.crm_request_human_handoff(text,text,bigint,text,text) from public, authenticated;
grant execute on function public.crm_track_telegram_start(text,bigint,bigint,text,text,text) to anon;
grant execute on function public.crm_track_telegram_start(text,bigint,bigint,text,text,text,text) to anon;
grant execute on function public.crm_record_telegram_message(text,text,bigint,text,text,text,text) to anon;
grant execute on function public.crm_request_human_handoff(text,text,bigint,text,text) to anon;

