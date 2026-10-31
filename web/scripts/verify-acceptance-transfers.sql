-- Metadata-only deployment verification. Never changes restaurant transactions.
select jsonb_build_object(
 'migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261028001700'),
 'new_dispatch_reserves_stock',position('reserved_on_dispatch' in pg_get_functiondef('private.post_inventory_document(public.inventory_documents)'::regprocedure))>0,
 'consumption_checks_reservations',position('private.reserved_stock' in pg_get_functiondef('private.move_stock(public.inventory_documents,uuid,uuid,numeric,text,numeric,boolean,boolean,numeric)'::regprocedure))>0,
 'count_checks_reservations',position('private.reserved_stock' in pg_get_functiondef('public.control_command(text,uuid,uuid,jsonb)'::regprocedure))>0,
 'decision_helper_private',not has_function_privilege('authenticated','private.decide_transfer(uuid,uuid,uuid,text,jsonb)','EXECUTE'),
 'reservation_helper_private',not has_function_privilege('authenticated','private.reserved_stock(uuid,uuid,uuid)','EXECUTE'),
 'delivery_view_invoker',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.transfer_delivery_view'::regclass),
 'reservation_view_invoker',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.transfer_reservation_view'::regclass),
 'ordinary_transfer_writes_denied',not has_table_privilege('authenticated','public.transfer_stock','UPDATE'),
 'anonymous_inventory_commands_denied',not has_function_privilege('anon','public.inventory_command(text,uuid,uuid,jsonb)','EXECUTE'),
 'catalogue_items',(select count(*) from public.items)
) as verification;
