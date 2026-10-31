begin;
-- Document-scoped sales review. Store operators can review their import; this does
-- not grant access to business-wide financial reports or finance evidence tables.
create function private.sales_document_summary(p_doc public.inventory_documents) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sale record;ing record;qty numeric;cost numeric;line_cost numeric;net numeric;profit numeric;
 total_net numeric:=0;total_cost numeric:=0;total_qty numeric:=0;count_lines int:=0;
 revenue_complete boolean:=true;cost_complete boolean:=true;line_complete boolean;
 lines jsonb:='[]';warnings jsonb:='[]';uploader text;locations text;needs record;available numeric;
begin
 if not (private.can_finance(p_doc.organization_id) or private.can_operate(p_doc.organization_id)) then return null;end if;
 select coalesce(u.email,'Team member') into uploader from auth.users u where u.id=p_doc.created_by;
 select string_agg(distinct l.name,', ' order by l.name) into locations from public.sales_import_rows s join public.locations l on l.id=s.location_id where s.document_id=p_doc.id;
 for sale in select s.*,v.standard_output,v.revision,r.name as recipe_name,r.code as recipe_code,
  coalesce(m.name,r.name) as menu_name,coalesce(src.source_menu_code,r.code) as menu_code,
  src.menu_item_id,m.is_active as menu_active,m.recipe_id as mapped_recipe_id,v.recipe_id,
  e.net_sales,l.name as location_name,l.is_active as location_active
  from public.sales_import_rows s join public.recipe_versions v on v.id=s.recipe_version_id
  join public.recipes r on r.id=v.recipe_id join public.locations l on l.id=s.location_id
  left join public.sales_menu_sources src on src.document_id=s.document_id and src.external_id=s.external_id
  left join public.menu_items m on m.id=src.menu_item_id
  left join public.sales_revenue_evidence e on e.sales_row_id=s.id
  where s.organization_id=p_doc.organization_id and s.document_id=p_doc.id order by s.external_id
 loop
  line_cost:=0;line_complete:=true;count_lines:=count_lines+1;total_qty:=total_qty+sale.quantity;
  for ing in select i.*,item.is_active from public.recipe_ingredients i join public.items item on item.id=i.item_id where i.version_id=sale.recipe_version_id loop
   qty:=ing.quantity*sale.quantity/sale.standard_output;
   if p_doc.status='posted' then
    select theoretical_cost into cost from public.sales_cost_evidence where sales_row_id=sale.id and item_id=ing.item_id;
   else
    cost:=private.live_item_cost(p_doc.organization_id,ing.item_id);
    if cost is not null then cost:=round(qty*cost,8);end if;
    if qty<>round(qty,6) then warnings:=warnings||jsonb_build_array('Recipe quantities for '||sale.menu_code||' exceed supported stock precision.');end if;
    if not ing.is_active then warnings:=warnings||jsonb_build_array('An ingredient for '||sale.menu_code||' is inactive.');end if;
   end if;
   if cost is null then line_complete:=false;else line_cost:=line_cost+cost;end if;
  end loop;
  if not exists(select 1 from public.recipe_ingredients where version_id=sale.recipe_version_id) then line_complete:=false;end if;
  if not line_complete then
   line_cost:=null;cost_complete:=false;warnings:=warnings||jsonb_build_array('Recipe cost is incomplete for '||sale.menu_code||'.');
  else total_cost:=total_cost+line_cost;end if;
  net:=sale.net_sales;
  if net is null then revenue_complete:=false;warnings:=warnings||jsonb_build_array('Net sales are missing for source line '||sale.external_id||'.');else total_net:=total_net+net;end if;
  if p_doc.status<>'posted' then
   if not sale.location_active then warnings:=warnings||jsonb_build_array('The sales location for '||sale.external_id||' is inactive.');end if;
   if exists(select 1 from public.menu_items where organization_id=p_doc.organization_id) and
      (sale.menu_item_id is null or not coalesce(sale.menu_active,false) or sale.mapped_recipe_id is distinct from sale.recipe_id) then
    warnings:=warnings||jsonb_build_array('Review the missing, inactive or changed menu mapping for '||sale.menu_code||'.');
   end if;
   if exists(select 1 from public.sales_posting_keys k where k.organization_id=p_doc.organization_id and k.source_system=sale.source_system and k.external_id=sale.external_id and k.document_id<>p_doc.id) then
    warnings:=warnings||jsonb_build_array('Source line '||sale.external_id||' was already posted in another sales import.');
   elsif exists(select 1 from public.sales_import_rows s join public.inventory_documents d on d.id=s.document_id where s.organization_id=p_doc.organization_id and s.source_system=sale.source_system and s.external_id=sale.external_id and s.document_id<>p_doc.id and d.status in('draft','submitted')) then
    warnings:=warnings||jsonb_build_array('Source line '||sale.external_id||' also appears in another pending sales import.');
   end if;
  end if;
  profit:=net-line_cost;
  lines:=lines||jsonb_build_array(jsonb_build_object('external_id',sale.external_id,'menu_code',sale.menu_code,'menu_name',sale.menu_name,
   'recipe_name',sale.recipe_name,'recipe_revision',sale.revision,'location',sale.location_name,
   'quantity',sale.quantity::text,'net_sales',net::text,'unit_sales_price',round(net/sale.quantity,8)::text,
   'recipe_cogs',line_cost::text,'gross_profit',profit::text,'gross_margin_pct',round(profit/nullif(net,0)*100,8)::text));
 end loop;
 if p_doc.status<>'posted' then
  for needs in select s.location_id,i.item_id,item.name as item_name,l.name as location_name,
   sum(i.quantity*s.quantity/v.standard_output) as quantity
   from public.sales_import_rows s join public.recipe_versions v on v.id=s.recipe_version_id
   join public.recipe_ingredients i on i.version_id=v.id join public.items item on item.id=i.item_id
   join public.locations l on l.id=s.location_id where s.document_id=p_doc.id
   group by s.location_id,i.item_id,item.name,l.name
  loop
   select coalesce((select quantity from public.stock_balances where organization_id=p_doc.organization_id and location_id=needs.location_id and item_id=needs.item_id),0)-private.reserved_stock(p_doc.organization_id,needs.location_id,needs.item_id) into available;
   if available<needs.quantity then warnings:=warnings||jsonb_build_array('Insufficient available stock: '||needs.item_name||' at '||needs.location_name||'.');end if;
  end loop;
  if not exists(select 1 from public.inventory_periods where organization_id=p_doc.organization_id and p_doc.event_date between starts_on and ends_on and not is_closed) then warnings:=warnings||jsonb_build_array('The sales business date needs an open inventory period.');end if;
  if p_doc.event_date>(now() at time zone 'Africa/Lagos')::date then warnings:=warnings||jsonb_build_array('The sales business date is in the future.');end if;
 end if;
 if count_lines=0 then revenue_complete:=false;cost_complete:=false;warnings:=warnings||jsonb_build_array('No sales lines are available for review.');end if;
 if not revenue_complete then total_net:=null;end if;if not cost_complete then total_cost:=null;end if;
 return jsonb_build_object('posted',p_doc.status='posted','business_date',p_doc.event_date,'reference',p_doc.reason,
  'source_system',p_doc.source_system,'uploaded_by',uploader,'locations',locations,'line_count',count_lines,
  'quantity',total_qty::text,'net_sales',total_net::text,'recipe_cogs',total_cost::text,
  'gross_profit',(total_net-total_cost)::text,'gross_margin_pct',round((total_net-total_cost)/nullif(total_net,0)*100,8)::text,
  'revenue_complete',revenue_complete,'cost_complete',cost_complete,'lines',lines,'warnings',warnings);
end $$;
revoke all on function private.sales_document_summary(public.inventory_documents) from public,anon,authenticated,service_role;

do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure) into definition;
 fragment:='return jsonb_build_object(''id'',d.id,''lines'',coalesce(rows,''[]''::jsonb));';
 if position(fragment in definition)=0 then raise exception 'Unexpected document preview return';end if;
 definition:=replace(definition,fragment,'if d.kind=''sales'' and d.status=''posted'' then
 select jsonb_agg(jsonb_build_object(''item'',i.name,''unit'',coalesce(i.stock_unit_label,i.base_uom_code),''quantity'',abs(m.quantity)::text,''unit_cost'',m.unit_cost::text,''location'',l.name) order by i.name,l.name)
 into rows from public.inventory_movements m join public.items i on i.id=m.item_id join public.locations l on l.id=m.location_id
 where m.document_id=d.id and m.movement=''sales_consumption'' and private.department_location_read(p_organization_id,m.location_id);
 end if;
 return jsonb_build_object(''id'',d.id,''lines'',coalesce(rows,''[]''::jsonb),''sales'',case when d.kind=''sales'' then private.sales_document_summary(d) end);');
 execute definition;
end $$;
notify pgrst,'reload schema';commit;
