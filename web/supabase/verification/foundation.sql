-- Read-only deployment verification. No tenant records or credentials are returned.
select jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'migration_applied', exists (
    select 1 from supabase_migrations.schema_migrations where version = '20261027000100'
  ),
  'tables', (
    select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','private')
  ),
  'system_unit_count', (select count(*) from public.units_of_measure),
  'decimal_view_uses_invoker_security', (
    select 'security_invoker=true'=any(c.reloptions) from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='item_conversion_history'
  ),
  'authenticated_command_allowed', has_function_privilege('authenticated','public.profitplate_command(text,uuid,uuid,jsonb)','EXECUTE'),
  'anonymous_command_denied', not has_function_privilege('anon','public.profitplate_command(text,uuid,uuid,jsonb)','EXECUTE'),
  'authenticated_delivery_claim_denied', not has_function_privilege('authenticated','public.claim_invitation_delivery(uuid)','EXECUTE'),
  'service_delivery_claim_allowed', has_function_privilege('service_role','public.claim_invitation_delivery(uuid)','EXECUTE'),
  'direct_application_writes_denied', not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated'),('service_role')) as roles(name)
    where c.relkind='r' and n.nspname in ('public','private')
      and has_table_privilege(roles.name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
  ),
  'owner_constraint_triggers', (
    select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and t.tgname in ('organization_owner_required','membership_owner_required')
      and t.tgdeferrable and t.tginitdeferred
  )
) as foundation_verification;
