-- Read-only deployment metadata; no customer identities or transaction values.
select jsonb_build_object(
 'migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261028001600'),
 'posting_basis_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='inventory_documents' and column_name='posting_basis'),
 'accept_command_enabled',position('accept_purchase_receipt' in pg_get_functiondef('private.business_fields(text)'::regprocedure))>0,
 'private_helper_not_exposed',not has_function_privilege('authenticated','private.accept_purchase_receipt(uuid,uuid,uuid)','EXECUTE'),
 'anonymous_commands_denied',not has_function_privilege('anon','public.business_command(text,uuid,uuid,jsonb)','EXECUTE'),
 'pending_view_invoker',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.pending_purchase_receipt_view'::regclass),
 'catalogue_items',(select count(*) from public.items)
) as verification;
