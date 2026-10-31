-- Metadata only; no customer sales amounts, identities or transactions are returned.
select jsonb_build_object(
 'migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261029001800'),
 'sales_summary_enabled',position('private.sales_document_summary' in pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure))>0,
 'preview_department_scope_retained',position('private.document_read' in pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure))>0,
 'posted_deductions_use_ledger',position('sales_consumption' in pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure))>0,
 'summary_helper_private',not has_function_privilege('authenticated','private.sales_document_summary(public.inventory_documents)','EXECUTE'),
 'anonymous_preview_denied',not has_function_privilege('anon','public.inventory_document_preview(uuid,uuid)','EXECUTE'),
 'evidence_writes_denied',not has_table_privilege('authenticated','public.sales_cost_evidence','UPDATE'),
 'catalogue_items',(select count(*) from public.items)
) as verification;
