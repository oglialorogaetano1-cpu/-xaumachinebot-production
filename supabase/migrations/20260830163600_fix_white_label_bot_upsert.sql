-- Avoid PL/pgSQL output-column ambiguity by naming the unique constraint.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.crm_configure_tenant_bot(uuid,text,text,text,text,text)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    'on conflict(tenant_id,username) do update set',
    'on conflict on constraint crm_tenant_bots_tenant_username_key do update set'
  );
  execute v_definition;
end;
$$;
