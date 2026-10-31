-- Read-only metadata; no account identities or transaction contents.
select jsonb_build_object(
 'migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261028001500'),
 'procurement_authority',pg_get_functiondef('private.can_purchase(uuid)'::regprocedure),
 'read_authority',pg_get_functiondef('private.can_read_vendors(uuid)'::regprocedure),
 'authorization',pg_get_functiondef('private.authorize_business(uuid,text,jsonb)'::regprocedure),
 'catalogue_items',(select count(*) from public.items),
 'anonymous_command_denied',not has_function_privilege('anon','public.business_command(text,uuid,uuid,jsonb)','EXECUTE'),
 'authenticated_command_enabled',has_function_privilege('authenticated','public.business_command(text,uuid,uuid,jsonb)','EXECUTE')
) as verification;
