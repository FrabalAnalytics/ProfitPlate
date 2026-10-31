begin;
create function private.department_location_read(p_org uuid,p_location uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_role(p_org) and (
    private.is_manager(p_org) or not private.has_role(p_org,array['kitchen_lead','bar_lead'])
    or exists(select 1 from public.operating_areas a join public.organization_memberships m on m.organization_id=a.organization_id
      where a.organization_id=p_org and a.location_id=p_location and m.user_id=auth.uid() and m.status='active'
        and ((m.role='kitchen_lead' and a.area='kitchen') or (m.role='bar_lead' and a.area='bar')))
  );
$$;
create function private.document_read(p_org uuid,p_document uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_role(p_org) and exists(select 1 from public.inventory_documents d where d.organization_id=p_org and d.id=p_document and (
    private.department_location_read(p_org,d.source_location_id) or private.department_location_read(p_org,d.destination_location_id)
    or exists(select 1 from public.sales_import_rows s where s.document_id=d.id and private.department_location_read(p_org,s.location_id))));
$$;
create function private.requisition_read(p_org uuid,p_request uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_role(p_org) and exists(select 1 from public.stock_requisitions r where r.organization_id=p_org and r.id=p_request
    and (private.department_location_read(p_org,r.source_location_id) or private.department_location_read(p_org,r.destination_location_id)));
$$;
create function private.sales_row_read(p_org uuid,p_document uuid,p_external text) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_role(p_org) and exists(select 1 from public.sales_import_rows s where s.organization_id=p_org and s.document_id=p_document
    and s.external_id=p_external and private.department_location_read(p_org,s.location_id));
$$;
drop policy tenant_read on public.inventory_documents;
create policy tenant_read on public.inventory_documents for select to authenticated using(private.document_read(organization_id,id));
drop policy tenant_read on public.inventory_document_lines;
create policy tenant_read on public.inventory_document_lines for select to authenticated using(private.document_read(organization_id,document_id));
drop policy tenant_read on public.inventory_movements;
create policy tenant_read on public.inventory_movements for select to authenticated using(private.department_location_read(organization_id,location_id) or (bucket='in_transit' and private.document_read(organization_id,document_id)));
drop policy tenant_read on public.stock_balances;
create policy tenant_read on public.stock_balances for select to authenticated using(private.department_location_read(organization_id,location_id));
drop policy tenant_read on public.transfer_stock;
create policy tenant_read on public.transfer_stock for select to authenticated using(private.document_read(organization_id,document_id));
drop policy tenant_read on public.sales_import_rows;
create policy tenant_read on public.sales_import_rows for select to authenticated using(private.department_location_read(organization_id,location_id));
drop policy tenant_read on public.sales_menu_sources;
create policy tenant_read on public.sales_menu_sources for select to authenticated using(private.sales_row_read(organization_id,document_id,external_id));
drop policy tenant_read on public.sales_posting_keys;
create policy tenant_read on public.sales_posting_keys for select to authenticated using(private.sales_row_read(organization_id,document_id,external_id));
drop policy tenant_read on public.stock_cost_state;
create policy tenant_read on public.stock_cost_state for select to authenticated using(private.has_role(organization_id) and (private.is_manager(organization_id) or not private.has_role(organization_id,array['kitchen_lead','bar_lead'])));
do $$ declare t text;begin
  foreach t in array array['purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines'] loop
    execute format('drop policy tenant_read on public.%I',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.can_read_vendors(organization_id))',t);
  end loop;
end $$;
drop policy tenant_read on public.stock_requisitions;
create policy tenant_read on public.stock_requisitions for select to authenticated using(private.requisition_read(organization_id,id));
drop policy tenant_read on public.stock_requisition_lines;
create policy tenant_read on public.stock_requisition_lines for select to authenticated using(private.requisition_read(organization_id,requisition_id));
drop policy tenant_read on public.requisition_dispatches;
create policy tenant_read on public.requisition_dispatches for select to authenticated using(private.requisition_read(organization_id,requisition_id));
drop policy tenant_read on public.requisition_dispatch_lines;
create policy tenant_read on public.requisition_dispatch_lines for select to authenticated using(private.document_read(organization_id,document_id));

-- Share unit costs without exposing the business-wide quantity projection to departments.
create function private.visible_average_cost(p_org uuid,p_item uuid) returns numeric language sql stable security definer set search_path='' as $$
  select average_cost from public.stock_cost_state where organization_id=p_org and item_id=p_item and private.has_role(p_org);
$$;
create or replace view public.inventory_balance_view with(security_invoker=true) as
  select b.organization_id,b.location_id,l.name as location_name,b.item_id,i.name as item_name,i.sku,i.category,i.base_uom_code,
    b.quantity::text as quantity,price.average_cost::text as average_cost,
    case when price.average_cost is not null then round(b.quantity*price.average_cost,8)::text end as current_value,
    i.last_purchase_unit_cost,i.last_purchase_date,i.last_purchase_source,i.imported_price_status,i.display_unit
  from public.stock_balances b join public.inventory_item_view i on i.id=b.item_id and i.organization_id=b.organization_id
  join public.locations l on l.id=b.location_id
  left join lateral(select private.visible_average_cost(b.organization_id,b.item_id) as average_cost) price on true;

-- Keep the established preview body, adding the same department scope as table reads.
do $$ declare definition text; old_fragment text:='if not private.has_role(p_organization_id) then'; begin
  select pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure) into definition;
  if position(old_fragment in definition)=0 then raise exception 'Unexpected document preview definition'; end if;
  definition:=replace(definition,old_fragment,'if not private.document_read(p_organization_id,p_document_id) then');
  if position('where r.document_id=d.id;' in definition)=0 then raise exception 'Unexpected sales preview definition'; end if;
  definition:=replace(definition,'where r.document_id=d.id;','where r.document_id=d.id and private.department_location_read(p_organization_id,r.location_id);');
  execute definition;
end $$;
do $$ declare definition text; fragment text:='elsif p_command=''create_document'' then';begin
  select pg_get_functiondef('public.inventory_command(text,uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(fragment in definition)=0 then raise exception 'Unexpected inventory command definition'; end if;
  definition:=replace(definition,fragment,fragment||E'\n    if p_payload->>''kind'' in (''opening'',''receipt'') and not private.can_operate(p_organization_id) then raise exception using errcode=''42501'',message=''Inventory receiving permission required''; end if;');
  execute definition;
end $$;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(uuid,text[]),private.is_manager(uuid,boolean),private.can_read_vendors(uuid),private.department_location_read(uuid,uuid),private.document_read(uuid,uuid),private.requisition_read(uuid,uuid),private.sales_row_read(uuid,uuid,text),private.visible_average_cost(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
