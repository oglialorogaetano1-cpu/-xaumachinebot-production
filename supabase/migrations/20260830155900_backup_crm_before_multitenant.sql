create schema if not exists backup_xau_20260830;
revoke all on schema backup_xau_20260830 from public, anon, authenticated;

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
    if to_regclass(format('backup_xau_20260830.%I', t)) is null then
      execute format('create table backup_xau_20260830.%I as table public.%I', t, t);
    end if;
  end loop;
end $$;

create table if not exists backup_xau_20260830.rls_policies as
select * from pg_policies
where schemaname='public' and tablename like 'crm_%';

create table if not exists backup_xau_20260830.constraints as
select conrelid::regclass::text as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace='public'::regnamespace
  and conrelid::regclass::text like 'crm_%';

