-- White-label Telegram bot provisioning metadata.
-- The BotFather token is stored in Vault and never returned to the browser.

alter table public.crm_tenant_bots
  add constraint crm_tenant_bots_tenant_username_key unique (tenant_id, username);

create or replace function public.crm_configure_tenant_bot(
  p_tenant_id uuid,
  p_name text,
  p_username text,
  p_bot_token text,
  p_admin_chat_id text default null,
  p_default_language text default 'it'
)
returns table(
  id uuid,
  name text,
  username text,
  mode text,
  status text,
  admin_chat_id text,
  default_language text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=public, private, vault, pg_temp
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_username text := lower(trim(both '@' from trim(coalesce(p_username, ''))));
  v_language text := lower(trim(coalesce(p_default_language, 'it')));
  v_secret_name text;
  v_secret_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1
    from public.crm_tenant_members m
    join public.crm_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id
      and m.user_id=auth.uid()
      and m.status='active'
      and m.role in ('owner','admin')
      and t.status not in ('demo','suspended','cancelled')
  ) then
    raise exception 'tenant admin required' using errcode='42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'invalid bot display name' using errcode='22023';
  end if;
  if v_username !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'invalid Telegram bot username' using errcode='22023';
  end if;
  if coalesce(p_bot_token,'') !~ '^[0-9]{6,15}:[A-Za-z0-9_-]{20,80}$' then
    raise exception 'invalid BotFather token' using errcode='22023';
  end if;
  if v_language !~ '^[a-z]{2}(-[a-z]{2})?$' then
    raise exception 'invalid default language' using errcode='22023';
  end if;

  v_secret_name := 'xau_crm/' || p_tenant_id::text || '/telegram_bot/' || v_username;
  select s.id into v_secret_id from vault.secrets s where s.name=v_secret_name limit 1;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_bot_token, v_secret_name, 'XAU CRM white-label Telegram bot', null);
  else
    perform vault.update_secret(v_secret_id, p_bot_token, v_secret_name, 'XAU CRM white-label Telegram bot', null);
  end if;

  insert into private.crm_tenant_secret_refs(tenant_id,provider,secret_ref,rotated_at)
  values(p_tenant_id,'telegram_bot',v_secret_name,now())
  on conflict(tenant_id,provider,secret_ref) do update set
    key_version=private.crm_tenant_secret_refs.key_version+1,
    rotated_at=now();

  insert into public.crm_tenant_bots(
    tenant_id,name,username,mode,status,secret_ref,admin_chat_id,
    default_language,public_config,updated_at
  ) values (
    p_tenant_id,v_name,'@'||v_username,'white_label','configured',v_secret_name,
    nullif(trim(coalesce(p_admin_chat_id,'')),''),v_language,
    jsonb_build_object('brand_name',v_name,'managed_runtime',true),now()
  )
  on conflict on constraint crm_tenant_bots_tenant_username_key do update set
    name=excluded.name,
    mode='white_label',
    status=case when crm_tenant_bots.status='active' then 'active' else 'configured' end,
    secret_ref=excluded.secret_ref,
    admin_chat_id=excluded.admin_chat_id,
    default_language=excluded.default_language,
    public_config=crm_tenant_bots.public_config || excluded.public_config,
    last_error=null,
    updated_at=now();

  insert into public.crm_integrations(tenant_id,provider,enabled,display_name,connection_status,updated_at,updated_by)
  values(p_tenant_id,'telegram',true,'Telegram white label','configured',now(),auth.uid())
  on conflict(tenant_id,provider) do update set
    enabled=true,display_name='Telegram white label',connection_status='configured',
    last_error=null,updated_at=now(),updated_by=auth.uid();

  insert into public.crm_audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_tenant_id,auth.uid(),'tenant_bot.configured','tenant_bot',v_username,
    jsonb_build_object('username','@'||v_username,'mode','white_label','default_language',v_language));

  return query
  select b.id,b.name,b.username,b.mode,b.status,b.admin_chat_id,b.default_language,b.updated_at
  from public.crm_tenant_bots b
  where b.tenant_id=p_tenant_id and b.username='@'||v_username;
end;
$$;

revoke all on function public.crm_configure_tenant_bot(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.crm_configure_tenant_bot(uuid,text,text,text,text,text) to authenticated;
