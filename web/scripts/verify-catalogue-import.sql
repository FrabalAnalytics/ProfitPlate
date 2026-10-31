-- Aggregated read-only verification; does not disclose source prices or customer/user identities.
select jsonb_build_object(
  'imports',(select jsonb_agg(jsonb_build_object('source',source_name,'sha256',source_sha256,'rows',row_count,'inserted',inserted_count,'matched',matched_count,'origin',import_origin,'has_authenticated_actor',initiated_by is not null)) from public.catalogue_imports),
  'reference_purchase_prices',(select count(*) from public.inventory_item_view where last_purchase_source='imported_reference' and last_purchase_unit_cost is not null),
  'legacy_production_references',(select count(*) from public.catalogue_import_rows where reference_kind='production_reference'),
  'zero_unconfirmed',(select count(*) from public.catalogue_import_rows where price_status='zero_unconfirmed'),
  'missing_prices',(select count(*) from public.catalogue_import_rows where price_status='missing'),
  'reference_dates',(select jsonb_agg(distinct reference_date) from public.catalogue_import_rows),
  'total_items',(select count(*) from public.items),
  'security_invoker',(select reloptions from pg_class where oid='public.inventory_item_view'::regclass),
  'import_rpc_permissions',jsonb_build_object('anonymous',has_function_privilege('anon','public.import_inventory_catalogue(uuid,text,text,jsonb)','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.import_inventory_catalogue(uuid,text,text,jsonb)','EXECUTE'),
    'service',has_function_privilege('service_role','public.import_inventory_catalogue(uuid,text,text,jsonb)','EXECUTE')),
  'new_table_rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class where oid in ('public.catalogue_imports'::regclass,'public.catalogue_import_rows'::regclass))
) as catalogue_verification;
