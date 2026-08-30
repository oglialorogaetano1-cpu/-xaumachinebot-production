-- Authenticated tenant owners/admins can store integration credentials in
-- Supabase Vault. Secret values are write-only from the CRM and are never
-- returned through this API.

create or replace function public.crm_set_integration_secret(
  p_tenant_id uuid,
  p_provider text,
  p_key text,
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path=public, private, vault, pg_temp
as $$
declare
  v_name text;
  v_secret_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.crm_tenant_members m
    join public.crm_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=auth.uid()
      and m.status='active' and m.role in ('owner','admin')
      and t.status not in ('demo','suspended','cancelled')
  ) then
    raise exception 'tenant admin required' using errcode='42501';
  end if;
  if p_provider not in ('telegram','openai','anthropic','ringover','whatsapp','brevo','puprime','mt5') then
    raise exception 'unsupported provider' using errcode='22023';
  end if;
  if p_key !~ '^[a-z0-9_]{2,60}$' or length(coalesce(p_secret,'')) < 3 then
    raise exception 'invalid secret' using errcode='22023';
  end if;

  v_name := 'xau_crm/' || p_tenant_id::text || '/' || p_provider || '/' || p_key;
  select id into v_secret_id from vault.secrets where name=v_name limit 1;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret, v_name, 'XAU CRM tenant integration', null);
  else
    perform vault.update_secret(v_secret_id, p_secret, v_name, 'XAU CRM tenant integration', null);
  end if;

  insert into private.crm_tenant_secret_refs(tenant_id,provider,secret_ref,rotated_at)
  values(p_tenant_id,p_provider,v_name,now())
  on conflict(tenant_id,provider,secret_ref) do update set
    key_version=private.crm_tenant_secret_refs.key_version+1,
    rotated_at=now();

  insert into public.crm_integrations(tenant_id,provider,enabled,display_name,connection_status,updated_at,updated_by)
  values(p_tenant_id,p_provider,true,initcap(p_provider),'configured',now(),auth.uid())
  on conflict(tenant_id,provider) do update set
    enabled=true,connection_status='configured',last_error=null,updated_at=now(),updated_by=auth.uid();

  insert into public.crm_audit_log(tenant_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_tenant_id,auth.uid(),'integration.secret_rotated','integration',p_provider,jsonb_build_object('key',p_key));
  return true;
end;
$$;

create or replace function public.crm_integration_secret_status(p_tenant_id uuid)
returns table(provider text, configured_keys bigint, last_rotated_at timestamptz)
language sql
stable
security definer
set search_path=public, private, pg_temp
as $$
  select r.provider,count(*)::bigint,max(r.rotated_at)
  from private.crm_tenant_secret_refs r
  where r.tenant_id=p_tenant_id
    and exists (
      select 1 from public.crm_tenant_members m
      where m.tenant_id=r.tenant_id and m.user_id=auth.uid() and m.status='active'
    )
  group by r.provider;
$$;

revoke all on function public.crm_set_integration_secret(uuid,text,text,text) from public,anon;
revoke all on function public.crm_integration_secret_status(uuid) from public,anon;
grant execute on function public.crm_set_integration_secret(uuid,text,text,text) to authenticated;
grant execute on function public.crm_integration_secret_status(uuid) to authenticated;
