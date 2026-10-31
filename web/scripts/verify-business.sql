-- Read-only metadata and aggregate verification; no staff identities or transaction contents.
select jsonb_build_object(
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and c.relname in ('vendors','vendor_items','menu_items','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','stock_requisitions','stock_requisition_lines','requisition_dispatches','requisition_dispatch_lines','sales_menu_sources')),
  'rpc_permissions',(select jsonb_agg(jsonb_build_object('function',p.proname,'security_definer',p.prosecdef,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('business_command','team_directory','operating_people','issue_manual_invitation')),
  'unexpected_write_grants',(select count(*) from information_schema.table_privileges where table_schema='public'
    and table_name in ('vendors','vendor_items','menu_items','purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','stock_requisitions','stock_requisition_lines','requisition_dispatches','requisition_dispatch_lines','sales_menu_sources')
    and grantee in ('anon','authenticated','service_role') and privilege_type<>'SELECT'),
  'procurement_role_supported',(select bool_and(pg_get_constraintdef(oid) like '%procurement_officer%') from pg_constraint where conname in ('organization_memberships_role_check','organization_invitations_proposed_role_check')),
  'catalogue_items',(select count(*) from public.items),
  'recipe_masters',(select jsonb_agg(viewname order by viewname) from pg_views where schemaname='public' and viewname in ('final_recipe_master','sub_recipe_master'))
) as verification;
