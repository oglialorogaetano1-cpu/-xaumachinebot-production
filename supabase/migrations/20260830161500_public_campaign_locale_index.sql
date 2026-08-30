create table if not exists public.crm_public_campaign_locales (
  tenant_id uuid not null references public.crm_tenants(id) on delete cascade,
  deep_link_code text not null,
  language text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, deep_link_code)
);

alter table public.crm_public_campaign_locales enable row level security;
drop policy if exists crm_public_campaign_locales_read on public.crm_public_campaign_locales;
create policy crm_public_campaign_locales_read on public.crm_public_campaign_locales
for select to anon, authenticated using (active=true);
grant select on public.crm_public_campaign_locales to anon, authenticated;

insert into public.crm_public_campaign_locales(tenant_id,deep_link_code,language,active,updated_at)
select tenant_id,deep_link_code,language,active,now()
from public.crm_campaigns
where deep_link_code is not null
on conflict (tenant_id,deep_link_code) do update set
  language=excluded.language,active=excluded.active,updated_at=now();

create or replace function private.crm_sync_public_campaign_locale()
returns trigger
language plpgsql
security definer
set search_path=public, pg_temp
as $$
begin
  if tg_op='DELETE' then
    delete from public.crm_public_campaign_locales
    where tenant_id=old.tenant_id and deep_link_code=old.deep_link_code;
    return old;
  end if;
  if new.deep_link_code is not null then
    insert into public.crm_public_campaign_locales(tenant_id,deep_link_code,language,active,updated_at)
    values(new.tenant_id,new.deep_link_code,new.language,new.active,now())
    on conflict (tenant_id,deep_link_code) do update set
      language=excluded.language,active=excluded.active,updated_at=now();
  end if;
  if tg_op='UPDATE' and old.deep_link_code is distinct from new.deep_link_code and old.deep_link_code is not null then
    delete from public.crm_public_campaign_locales
    where tenant_id=old.tenant_id and deep_link_code=old.deep_link_code;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_sync_public_campaign_locale() from public,anon,authenticated;
drop trigger if exists crm_sync_public_campaign_locale_trigger on public.crm_campaigns;
create trigger crm_sync_public_campaign_locale_trigger
after insert or update of tenant_id,deep_link_code,language,active or delete on public.crm_campaigns
for each row execute function private.crm_sync_public_campaign_locale();

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
    from public.crm_public_campaign_locales c join cfg on cfg.tenant_id=c.tenant_id
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
    from public.crm_public_campaign_locales c join cfg on cfg.tenant_id=c.tenant_id
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

