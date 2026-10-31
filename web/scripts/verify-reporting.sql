-- Read-only deployment metadata. No staff identities, financial values or invitation credentials.
select jsonb_build_object(
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'catalogue_items',(select count(*) from public.items),
 'retired_gm_appointments',(select count(*) from public.operational_managers where manager_role='general_manager'),
 'operations_role_constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.operational_managers'::regclass and conname='operational_managers_manager_role_check'),
 'rls',(select jsonb_object_agg(c.relname,c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('additional_role_assignments','sales_revenue_evidence','sales_cost_evidence','stock_counts','stock_count_lines','report_reconciliations','report_snapshots','management_actions')),
 'rpc_permissions',(select jsonb_agg(jsonb_build_object('function',p.proname,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('control_command','operating_report','reporting_command','action_command')),
 'unexpected_write_grants',(select count(*) from information_schema.table_privileges where table_schema='public' and table_name in ('additional_role_assignments','sales_revenue_evidence','sales_cost_evidence','stock_counts','stock_count_lines','report_reconciliations','report_snapshots','management_actions') and grantee in ('anon','authenticated','service_role') and privilege_type<>'SELECT'),
 'snapshot_immutable',(select exists(select 1 from pg_trigger where tgrelid='public.report_snapshots'::regclass and tgname='snapshot_immutable'))
) as verification;
