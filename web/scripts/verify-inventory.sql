-- Read-only hosted verification. No restaurant identities, credentials or transaction contents.
select jsonb_build_object(
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in
    ('operational_managers','operating_areas','inventory_periods','recipes','recipe_versions','recipe_ingredients','inventory_documents','inventory_document_lines','sales_import_rows','sales_posting_keys','stock_balances','stock_cost_state','transfer_stock','inventory_movements')),
  'rpc_permissions',(select jsonb_agg(jsonb_build_object('function',p.proname,'security_definer',p.prosecdef,'settings',p.proconfig,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('inventory_command','current_recipe_cost','inventory_document_preview','inventory_team_options')),
  'api_table_grants',(select jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type))
    from information_schema.table_privileges where table_schema='public' and table_name in
    ('inventory_movements','stock_balances','stock_cost_state','inventory_documents','inventory_document_lines','sales_import_rows','sales_posting_keys','operational_managers')
    and grantee in ('anon','authenticated','service_role'))
) as verification;
