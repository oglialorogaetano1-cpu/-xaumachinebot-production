-- XAU Machine CRM SaaS foundation.
-- Additive migration: existing CRM data is assigned to the XAU Machine tenant.

create schema if not exists private;

create table if not exists public.crm_plans (
  code text primary key,
  name text not null,
  description text,
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  currency text not null default 'EUR',
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null,
  status text not null default 'trialing' check (status in ('demo','trialing','active','past_due','grace','suspended','cancelled')),
  plan_code text not null references public.crm_plans(code),
  trial_ends_at timestamptz,
  branding jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_tenant_members (
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','operator','viewer')),
  status text not null default 'active' check (status in ('invited','active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists private.crm_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.crm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  provider text not null default 'manual',
  external_customer_id text,
  external_subscription_id text,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','grace','suspended','cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_subscriptions_provider_external_uidx
  on public.crm_subscriptions(provider, external_subscription_id)
  where external_subscription_id is not null;

create table if not exists public.crm_entitlements (
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  code text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, code)
);

create table if not exists public.crm_tenant_bots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  name text not null,
  username text,
  telegram_bot_id bigint,
  mode text not null default 'shared' check (mode in ('shared','white_label')),
  status text not null default 'not_configured' check (status in ('not_configured','configured','active','paused','error')),
  secret_ref text,
  admin_chat_id text,
  default_language text not null default 'it',
  public_config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.crm_broker_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  provider text not null,
  display_name text not null,
  portal_url text,
  ib_codes text[] not null default '{}',
  sync_interval_seconds integer not null default 1800 check (sync_interval_seconds >= 300),
  status text not null default 'not_configured' check (status in ('not_configured','configured','active','needs_human','error','paused')),
  secret_ref text,
  public_config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, display_name)
);

create table if not exists private.crm_tenant_secret_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  provider text not null,
  secret_ref text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (tenant_id, provider, secret_ref)
);

create table if not exists public.crm_licenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  lead_id uuid,
  product_code text not null,
  license_key_hash text not null unique,
  status text not null default 'active' check (status in ('trialing','active','past_due','suspended','revoked','expired')),
  device_fingerprint text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_usage_monthly (
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  month date not null,
  ai_input_tokens bigint not null default 0 check (ai_input_tokens >= 0),
  ai_output_tokens bigint not null default 0 check (ai_output_tokens >= 0),
  ai_cost numeric(14,6) not null default 0 check (ai_cost >= 0),
  messages_in bigint not null default 0 check (messages_in >= 0),
  messages_out bigint not null default 0 check (messages_out >= 0),
  followups_sent bigint not null default 0 check (followups_sent >= 0),
  calls_started bigint not null default 0 check (calls_started >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, month),
  check (month = date_trunc('month', month)::date)
);

create table if not exists public.crm_subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  provider text not null,
  external_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create unique index if not exists crm_subscription_events_provider_external_uidx
  on public.crm_subscription_events(provider, external_event_id)
  where external_event_id is not null;

create table if not exists public.crm_audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.crm_plans(code, name, description, monthly_price, features)
values
  ('demo', 'Demo', 'Accesso dimostrativo in sola lettura', 0, '{"read_only":true}'::jsonb),
  ('crm', 'CRM', 'CRM, lead, campagne e operatori', 0, '{"crm":true}'::jsonb),
  ('crm_ai', 'CRM + AI', 'CRM, chatbot, traduzione e follow-up', 0, '{"crm":true,"ai":true,"followups":true}'::jsonb),
  ('trading', 'Trading', 'CRM, AI, MT5, screenshot e sala segnali', 0, '{"crm":true,"ai":true,"mt5":true,"signal_room":true}'::jsonb),
  ('full', 'Full', 'CRM, AI, PU Prime, MT5, bot e sala segnali', 0, '{"crm":true,"ai":true,"puprime":true,"mt5":true,"signal_room":true,"integrations":true}'::jsonb),
  ('white_label', 'White label', 'Piattaforma completa personalizzata', 0, '{"crm":true,"ai":true,"puprime":true,"mt5":true,"signal_room":true,"integrations":true,"white_label":true}'::jsonb)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  features = excluded.features,
  updated_at = now();

insert into public.crm_tenants(id, slug, name, status, plan_code, branding)
values
  ('00000000-0000-4000-8000-000000000001', 'xau-machine', 'XAU Machine', 'active', 'full', '{"primary_color":"#d4af37","product_name":"XAU Machine"}'::jsonb),
  ('00000000-0000-4000-8000-000000000002', 'demo', 'XAU Machine Demo', 'demo', 'demo', '{"product_name":"XAU Machine Demo","demo":true}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status,
  plan_code = excluded.plan_code,
  branding = excluded.branding,
  updated_at = now();

insert into private.crm_platform_admins(user_id)
select id from auth.users where lower(email) = 'infogaetano@yahoo.it'
on conflict (user_id) do nothing;

insert into public.crm_tenant_members(tenant_id, user_id, role, status)
select '00000000-0000-4000-8000-000000000001', id, 'owner', 'active'
from auth.users where lower(email) = 'infogaetano@yahoo.it'
on conflict (tenant_id, user_id) do update set role='owner', status='active', updated_at=now();

insert into public.crm_entitlements(tenant_id, code, enabled)
select '00000000-0000-4000-8000-000000000001', code, true
from unnest(array['crm','ai','followups','puprime','mt5','signal_room','integrations','white_label']) code
on conflict (tenant_id, code) do update set enabled=true, updated_at=now();

insert into public.crm_entitlements(tenant_id, code, enabled, config)
values ('00000000-0000-4000-8000-000000000002', 'crm', true, '{"read_only":true}'::jsonb)
on conflict (tenant_id, code) do update set enabled=true, config=excluded.config, updated_at=now();

-- Add tenant ownership to existing CRM tables. The temporary XAU default keeps
-- legacy workers operational until every caller explicitly sends tenant_id.
do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_ad_spend','crm_campaigns','crm_channel_sources','crm_conversations',
    'crm_followup_rules','crm_followups','crm_human_handoffs','crm_integrations',
    'crm_leads','crm_messages','crm_mt5_snapshots','crm_prompt_versions',
    'crm_sync_runs','crm_uploads'
  ] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid', t);
    execute format('update public.%I set tenant_id = $1 where tenant_id is null', t)
      using '00000000-0000-4000-8000-000000000001'::uuid;
    execute format('alter table public.%I alter column tenant_id set default %L::uuid', t, '00000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column tenant_id set not null', t);
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and conname = t || '_tenant_id_fkey'
    ) then
      execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.crm_tenants(id) on delete cascade', t, t || '_tenant_id_fkey');
    end if;
    execute format('create index if not exists %I on public.%I(tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

-- Tenant-scoped uniqueness.
alter table public.crm_campaigns drop constraint if exists crm_campaigns_deep_link_code_key;
alter table public.crm_campaigns add constraint crm_campaigns_tenant_deep_link_key unique (tenant_id, deep_link_code);
alter table public.crm_channel_sources drop constraint if exists crm_channel_sources_campaign_code_key;
alter table public.crm_channel_sources add constraint crm_channel_sources_tenant_campaign_key unique (tenant_id, campaign_code);
alter table public.crm_integrations drop constraint if exists crm_integrations_provider_key;
alter table public.crm_integrations add constraint crm_integrations_tenant_provider_key unique (tenant_id, provider);
alter table public.crm_leads drop constraint if exists crm_leads_telegram_chat_id_key;
alter table public.crm_leads drop constraint if exists crm_leads_telegram_user_id_key;
alter table public.crm_leads add constraint crm_leads_tenant_chat_key unique (tenant_id, telegram_chat_id);
alter table public.crm_leads add constraint crm_leads_tenant_user_key unique (tenant_id, telegram_user_id);
alter table public.crm_uploads drop constraint if exists crm_uploads_storage_path_key;
alter table public.crm_uploads add constraint crm_uploads_tenant_storage_path_key unique (tenant_id, storage_path);

-- Composite relationship keys prevent cross-tenant references.
alter table public.crm_campaigns add constraint crm_campaigns_tenant_id_id_key unique (tenant_id, id);
alter table public.crm_leads add constraint crm_leads_tenant_id_id_key unique (tenant_id, id);
alter table public.crm_conversations add constraint crm_conversations_tenant_id_id_key unique (tenant_id, id);

alter table public.crm_ad_spend drop constraint if exists crm_ad_spend_campaign_id_fkey;
alter table public.crm_ad_spend add constraint crm_ad_spend_tenant_campaign_fkey foreign key (tenant_id, campaign_id) references public.crm_campaigns(tenant_id, id) on delete set null (campaign_id);
alter table public.crm_leads drop constraint if exists crm_leads_campaign_id_fkey;
alter table public.crm_leads add constraint crm_leads_tenant_campaign_fkey foreign key (tenant_id, campaign_id) references public.crm_campaigns(tenant_id, id) on delete set null (campaign_id);
alter table public.crm_conversations drop constraint if exists crm_conversations_lead_id_fkey;
alter table public.crm_conversations add constraint crm_conversations_tenant_lead_fkey foreign key (tenant_id, lead_id) references public.crm_leads(tenant_id, id) on delete cascade;
alter table public.crm_messages drop constraint if exists crm_messages_conversation_id_fkey;
alter table public.crm_messages add constraint crm_messages_tenant_conversation_fkey foreign key (tenant_id, conversation_id) references public.crm_conversations(tenant_id, id) on delete cascade;
alter table public.crm_followups drop constraint if exists crm_followups_lead_id_fkey;
alter table public.crm_followups add constraint crm_followups_tenant_lead_fkey foreign key (tenant_id, lead_id) references public.crm_leads(tenant_id, id) on delete cascade;
alter table public.crm_human_handoffs drop constraint if exists crm_human_handoffs_lead_id_fkey;
alter table public.crm_human_handoffs drop constraint if exists crm_human_handoffs_conversation_id_fkey;
alter table public.crm_human_handoffs add constraint crm_handoffs_tenant_lead_fkey foreign key (tenant_id, lead_id) references public.crm_leads(tenant_id, id) on delete cascade;
alter table public.crm_human_handoffs add constraint crm_handoffs_tenant_conversation_fkey foreign key (tenant_id, conversation_id) references public.crm_conversations(tenant_id, id) on delete set null (conversation_id);
alter table public.crm_licenses add constraint crm_licenses_tenant_lead_fkey foreign key (tenant_id, lead_id) references public.crm_leads(tenant_id, id) on delete set null (lead_id);

-- Safe authorization helpers live outside exposed schemas.
create or replace function private.crm_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = private, auth, pg_temp
as $$
  select exists (
    select 1 from private.crm_platform_admins a
    where a.user_id = (select auth.uid())
  );
$$;

create or replace function private.crm_has_tenant_access(p_tenant_id uuid, p_write boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public, private, auth, pg_temp
as $$
  select private.crm_is_platform_admin() or exists (
    select 1
    from public.crm_tenant_members m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (not p_write or m.role in ('owner','admin','operator'))
  );
$$;

revoke all on function private.crm_is_platform_admin() from public;
revoke all on function private.crm_has_tenant_access(uuid, boolean) from public;
grant usage on schema private to authenticated;
grant execute on function private.crm_is_platform_admin() to authenticated;
grant execute on function private.crm_has_tenant_access(uuid, boolean) to authenticated;

-- Enable RLS for all SaaS and CRM tables.
alter table public.crm_plans enable row level security;
alter table public.crm_tenants enable row level security;
alter table public.crm_tenant_members enable row level security;
alter table public.crm_subscriptions enable row level security;
alter table public.crm_entitlements enable row level security;
alter table public.crm_tenant_bots enable row level security;
alter table public.crm_broker_connections enable row level security;
alter table public.crm_licenses enable row level security;
alter table public.crm_usage_monthly enable row level security;
alter table public.crm_subscription_events enable row level security;
alter table public.crm_audit_log enable row level security;

create policy crm_plans_read on public.crm_plans for select to authenticated using (active or private.crm_is_platform_admin());
create policy crm_plans_admin on public.crm_plans for all to authenticated using (private.crm_is_platform_admin()) with check (private.crm_is_platform_admin());
create policy crm_tenants_read on public.crm_tenants for select to authenticated using (private.crm_has_tenant_access(id, false));
create policy crm_tenants_write on public.crm_tenants for update to authenticated using (private.crm_has_tenant_access(id, true)) with check (private.crm_has_tenant_access(id, true));
create policy crm_members_read on public.crm_tenant_members for select to authenticated using (private.crm_has_tenant_access(tenant_id, false));
create policy crm_members_write on public.crm_tenant_members for all to authenticated using (private.crm_has_tenant_access(tenant_id, true)) with check (private.crm_has_tenant_access(tenant_id, true));

do $$
declare
  t text;
begin
  foreach t in array array[
    'crm_subscriptions','crm_entitlements','crm_tenant_bots','crm_broker_connections',
    'crm_licenses','crm_usage_monthly','crm_subscription_events','crm_audit_log',
    'crm_ad_spend','crm_campaigns','crm_channel_sources','crm_conversations',
    'crm_followup_rules','crm_followups','crm_human_handoffs','crm_integrations',
    'crm_leads','crm_messages','crm_mt5_snapshots','crm_prompt_versions',
    'crm_sync_runs','crm_uploads'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_admin_all on public.%I', t);
    execute format('drop policy if exists crm_tenant_read on public.%I', t);
    execute format('drop policy if exists crm_tenant_insert on public.%I', t);
    execute format('drop policy if exists crm_tenant_update on public.%I', t);
    execute format('drop policy if exists crm_tenant_delete on public.%I', t);
    execute format('create policy crm_tenant_read on public.%I for select to authenticated using (private.crm_has_tenant_access(tenant_id, false))', t);
    execute format('create policy crm_tenant_insert on public.%I for insert to authenticated with check (private.crm_has_tenant_access(tenant_id, true))', t);
    execute format('create policy crm_tenant_update on public.%I for update to authenticated using (private.crm_has_tenant_access(tenant_id, true)) with check (private.crm_has_tenant_access(tenant_id, true))', t);
    execute format('create policy crm_tenant_delete on public.%I for delete to authenticated using (private.crm_has_tenant_access(tenant_id, true))', t);
  end loop;
end $$;

grant select on public.crm_plans to authenticated;
grant select, insert, update, delete on public.crm_tenants, public.crm_tenant_members,
  public.crm_subscriptions, public.crm_entitlements, public.crm_tenant_bots,
  public.crm_broker_connections, public.crm_licenses, public.crm_usage_monthly,
  public.crm_subscription_events, public.crm_audit_log to authenticated;
grant usage, select on sequence public.crm_audit_log_id_seq to authenticated;

-- Demo records are synthetic and remain isolated under the demo tenant.
insert into public.crm_campaigns(tenant_id, name, product, language, source_channel, deep_link_code, active)
values ('00000000-0000-4000-8000-000000000002', 'Demo Italia', 'xau_machine', 'it', 'telegram_demo', 'demo_it', true)
on conflict (tenant_id, deep_link_code) do nothing;

insert into public.crm_leads(id, tenant_id, full_name, language, product, campaign_id, first_source, last_source, status, puprime_status, deposit_total, rebate_total)
select '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002',
  'Cliente Demo', 'it', 'xau_machine', c.id, 'telegram_demo', 'telegram_demo', 'conversation', 'not_checked', 0, 0
from public.crm_campaigns c
where c.tenant_id='00000000-0000-4000-8000-000000000002' and c.deep_link_code='demo_it'
on conflict (id) do nothing;

insert into public.crm_conversations(id, tenant_id, lead_id, channel, bot_key, ai_enabled, status, last_message_at)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000101', 'telegram', 'demo', true, 'open', now())
on conflict (id) do nothing;

insert into public.crm_messages(tenant_id, conversation_id, direction, sender_type, body, external_message_id)
values
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000201', 'inbound', 'lead', 'Vorrei capire come funziona il sistema.', 'demo-in-1'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000201', 'outbound', 'ai', 'Ti spiego volentieri funzionamento, rischi e procedura di registrazione.', 'demo-out-1')
on conflict do nothing;

-- Public tenant-aware context function for the authenticated CRM.
create or replace function public.crm_my_tenants()
returns table (tenant_id uuid, slug text, name text, role text, status text, plan_code text)
language sql
stable
security invoker
set search_path = public, auth, pg_temp
as $$
  select t.id, t.slug, t.name, m.role, t.status, t.plan_code
  from public.crm_tenant_members m
  join public.crm_tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid()) and m.status = 'active'
  order by t.name;
$$;

revoke all on function public.crm_my_tenants() from public;
grant execute on function public.crm_my_tenants() to authenticated;
