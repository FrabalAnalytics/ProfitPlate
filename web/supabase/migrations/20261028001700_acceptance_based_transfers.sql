begin;
-- Existing transfers retain their posted ledger; new dispatches reserve source stock.
alter table public.transfer_stock
 add column reserved_on_dispatch boolean not null default false,
 add column rejected_quantity numeric(24,6) not null default 0,
 add column returned_quantity numeric(24,6) not null default 0,
 add constraint transfer_decisions_valid check(returned_quantity>=0 and rejected_quantity>=returned_quantity and received_quantity+rejected_quantity<=quantity);

create function private.reserved_stock(p_org uuid,p_location uuid,p_item uuid) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce(sum(t.quantity-t.received_quantity-t.returned_quantity),0)
 from public.transfer_stock t join public.inventory_documents d on d.id=t.document_id and d.organization_id=t.organization_id
 where t.organization_id=p_org and d.source_location_id=p_location and t.item_id=p_item and t.reserved_on_dispatch;
$$;
revoke all on function private.reserved_stock(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create view public.transfer_reservation_view with(security_invoker=true) as
 select t.organization_id,d.source_location_id as location_id,t.item_id,
 sum(t.quantity-t.received_quantity-t.returned_quantity)::text as reserved_quantity
 from public.transfer_stock t join public.inventory_documents d on d.id=t.document_id and d.organization_id=t.organization_id
 where t.reserved_on_dispatch group by t.organization_id,d.source_location_id,t.item_id;
revoke all on public.transfer_reservation_view from public,anon,authenticated,service_role;
grant select on public.transfer_reservation_view to authenticated;

do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('private.move_stock(public.inventory_documents,uuid,uuid,numeric,text,numeric,boolean,boolean,numeric)'::regprocedure) into definition;
 fragment:='and quantity+p_delta>=0;';
 if position(fragment in definition)=0 then raise exception 'Unexpected stock movement definition';end if;
 definition:=replace(definition,fragment,'and quantity+p_delta>=private.reserved_stock(p_doc.organization_id,p_location,p_item);');execute definition;
 select pg_get_functiondef('private.post_inventory_document(public.inventory_documents)'::regprocedure) into definition;
 fragment:=E'        perform private.move_stock(p_doc,line.item_id,p_doc.source_location_id,-line.quantity,''transfer_dispatch'',cost,false,false);\n        perform private.move_stock(p_doc,line.item_id,null,line.quantity,''transfer_in_transit'',cost,true,false);\n        insert into public.transfer_stock(organization_id,document_id,item_id,quantity,dispatched_unit_cost)\n          values(p_doc.organization_id,p_doc.id,line.item_id,line.quantity,cost);';
 if position(fragment in definition)=0 then raise exception 'Unexpected dispatch definition';end if;
 definition:=replace(definition,fragment,'        if cost is null or not exists(select 1 from public.stock_balances b where b.organization_id=p_doc.organization_id and b.location_id=p_doc.source_location_id and b.item_id=line.item_id and b.quantity-private.reserved_stock(p_doc.organization_id,p_doc.source_location_id,line.item_id)>=line.quantity) then raise exception using errcode=''23514'',message=''Insufficient unreserved source stock'';end if;
        insert into public.transfer_stock(organization_id,document_id,item_id,quantity,dispatched_unit_cost,reserved_on_dispatch)
          values(p_doc.organization_id,p_doc.id,line.item_id,line.quantity,cost,true);');execute definition;
end $$;

create function private.decide_transfer(p_org uuid,p_document uuid,p_actor uuid,p_command text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare doc public.inventory_documents%rowtype;t public.transfer_stock%rowtype;line jsonb;q numeric;cost numeric;seen uuid[]:='{}';
begin
 select * into doc from public.inventory_documents where organization_id=p_org and id=p_document for update;
 if not found or doc.kind<>'transfer' or doc.status<>'dispatched' then raise exception using errcode='22023',message='Dispatched transfer required';end if;
 if p_command='return_transfer' then
  if not private.can_operate(p_org) then raise exception using errcode='42501',message='Store operator must confirm returned goods';end if;
 else
  if not private.can_operate(p_org,doc.destination_location_id) or doc.created_by=p_actor then raise exception using errcode='42501',message='A different receiving operator must accept or reject delivery';end if;
 end if;
 perform private.require_text(p_payload,'reason',500);
 if not exists(select 1 from public.inventory_periods where organization_id=p_org and not is_closed and (now() at time zone 'Africa/Lagos')::date between starts_on and ends_on) then raise exception using errcode='22023',message='Current receiving period must be open';end if;
 if exists(select 1 from public.locations where id in(doc.source_location_id,doc.destination_location_id) and not is_active) then raise exception using errcode='22023',message='Inactive transfer location';end if;
 if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500 then raise exception using errcode='22023',message='Line quantities required';end if;
 doc.event_date:=(now() at time zone 'Africa/Lagos')::date;
 for line in select value from jsonb_array_elements(p_payload->'lines') loop
  if exists(select 1 from jsonb_object_keys(line) k where k not in('item_id','quantity')) then raise exception using errcode='22023',message='Unknown transfer line field';end if;
  select * into t from public.transfer_stock where organization_id=p_org and document_id=doc.id and item_id=(line->>'item_id')::uuid for update;
  if not found or t.item_id=any(seen) then raise exception using errcode='22023',message='Select each dispatched item once';end if;
  seen:=seen||t.item_id;q:=private.decimal_field(line,'quantity',6);
  if p_command='return_transfer' then
   if q>t.rejected_quantity-t.returned_quantity then raise exception using errcode='22023',message='Return exceeds rejected quantity';end if;
   update public.transfer_stock set returned_quantity=returned_quantity+q where document_id=doc.id and item_id=t.item_id;
   if not t.reserved_on_dispatch then
    perform private.move_stock(doc,t.item_id,null,-q,'transfer_transit_returned',t.dispatched_unit_cost,true,false);
    perform private.move_stock(doc,t.item_id,doc.source_location_id,q,'transfer_return',t.dispatched_unit_cost,false,false);
   end if;
  else
   if q>t.quantity-t.received_quantity-t.rejected_quantity then raise exception using errcode='22023',message='Quantity exceeds pending delivery';end if;
   if p_command='reject_transfer' then
    update public.transfer_stock set rejected_quantity=rejected_quantity+q where document_id=doc.id and item_id=t.item_id;
   elsif p_command='receive_transfer' then
    update public.transfer_stock set received_quantity=received_quantity+q where document_id=doc.id and item_id=t.item_id;
    if t.reserved_on_dispatch then
     select average_cost into cost from public.stock_cost_state where organization_id=p_org and item_id=t.item_id;
     perform private.move_stock(doc,t.item_id,doc.source_location_id,-q,'transfer_accepted_out',cost,false,false);
    else
     cost:=t.dispatched_unit_cost;
     perform private.move_stock(doc,t.item_id,null,-q,'transfer_transit_received',cost,true,false);
    end if;
    perform private.move_stock(doc,t.item_id,doc.destination_location_id,q,'transfer_receipt',cost,false,false);
   else raise exception using errcode='22023',message='Invalid transfer decision';end if;
  end if;
 end loop;
 if not exists(select 1 from public.transfer_stock where document_id=doc.id and received_quantity+returned_quantity<quantity) then
  update public.inventory_documents set status='received',received_by=p_actor,received_at=clock_timestamp() where id=doc.id;
 end if;
end $$;
revoke all on function private.decide_transfer(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text;fragment text;start_pos int;end_pos int;begin
 select pg_get_functiondef('public.inventory_command(text,uuid,uuid,jsonb)'::regprocedure) into definition;
 fragment:='when ''receive_transfer'' then array[''id'',''lines'',''reason'']';
 if position(fragment in definition)=0 then raise exception 'Unexpected transfer command fields';end if;
 definition:=replace(definition,fragment,fragment||E'\n    when ''reject_transfer'' then array[''id'',''lines'',''reason'']\n    when ''return_transfer'' then array[''id'',''lines'',''reason'']');
 definition:=replace(definition,'case when p_command=''receive_transfer'' then','case when p_command in (''receive_transfer'',''reject_transfer'') then');
 start_pos:=position(E'  when ''receive_transfer'' then\n' in definition);
 end_pos:=position(E'  end case;\n  v_result:=' in definition);
 if start_pos=0 or end_pos<=start_pos then raise exception 'Unexpected transfer receipt body';end if;
 definition:=left(definition,start_pos-1)||E'  when ''receive_transfer'',''reject_transfer'',''return_transfer'' then\n    perform private.decide_transfer(p_organization_id,doc.id,actor,p_command,p_payload);\n    entity:=doc.id;\n'||substr(definition,end_pos);execute definition;
end $$;

-- Availability excludes dispatched reservations; returned rejections reopen request demand.
create or replace view public.stock_requisition_line_view with(security_invoker=true) as
 select l.id,l.organization_id,l.requisition_id,l.item_id,i.name as item_name,i.sku,
 coalesce(i.stock_unit_label,i.base_uom_code) as unit,l.quantity::text as quantity,
 coalesce(dispatch.quantity,0)::text as dispatched_quantity,(l.quantity-coalesce(dispatch.quantity,0))::text as outstanding_quantity
 from public.stock_requisition_lines l join public.items i on i.id=l.item_id left join lateral(
 select sum(r.quantity-coalesce(t.returned_quantity,0)) as quantity
 from public.requisition_dispatch_lines r join public.inventory_documents d on d.id=r.document_id
 left join public.transfer_stock t on t.document_id=r.document_id and t.item_id=l.item_id
 where r.requisition_line_id=l.id and d.status in('dispatched','received')
 ) dispatch on true;
create or replace view public.requisition_fulfilment_view with(security_invoker=true) as
 select l.*,greatest(0,coalesce(b.quantity,0)-coalesce(res.reserved_quantity::numeric,0))::text as available_source_quantity,
 greatest(0,least(l.outstanding_quantity::numeric,coalesce(b.quantity,0)-coalesce(res.reserved_quantity::numeric,0)))::text as suggested_quantity
 from public.stock_requisition_line_view l join public.stock_requisitions r on r.id=l.requisition_id
 left join public.stock_balances b on b.organization_id=l.organization_id and b.item_id=l.item_id and b.location_id=r.source_location_id
 left join public.transfer_reservation_view res on res.organization_id=l.organization_id and res.item_id=l.item_id and res.location_id=r.source_location_id;

do $$ declare definition text;begin
 select pg_get_viewdef('public.inventory_balance_view'::regclass,true) into definition;
 -- Wrap the established read model so its column order and department protections stay intact.
 execute 'create or replace view public.inventory_balance_view with(security_invoker=true) as select b.*,coalesce(r.reserved_quantity,''0'') as reserved_quantity,(b.quantity::numeric-coalesce(r.reserved_quantity::numeric,0))::text as available_quantity from ('||rtrim(definition,E';\n ')||') b left join public.transfer_reservation_view r on r.organization_id=b.organization_id and r.location_id=b.location_id and r.item_id=b.item_id';
end $$;
create view public.transfer_delivery_view with(security_invoker=true) as
 select t.organization_id,t.document_id,t.item_id,i.name as item_name,
 coalesce(i.stock_unit_label,i.base_uom_code) as unit,t.quantity::text as quantity,
 t.received_quantity::text as received_quantity,t.rejected_quantity::text as rejected_quantity,
 t.returned_quantity::text as returned_quantity,
 (t.quantity-t.received_quantity-t.rejected_quantity)::text as pending_quantity,
 (t.rejected_quantity-t.returned_quantity)::text as awaiting_return_quantity,
 t.reserved_on_dispatch,d.source_location_id,d.destination_location_id,d.created_by,d.status,d.reason,d.created_at,
 src.name as source_name,dst.name as destination_name
 from public.transfer_stock t join public.inventory_documents d on d.id=t.document_id and d.organization_id=t.organization_id
 join public.items i on i.id=t.item_id and i.organization_id=t.organization_id
 join public.locations src on src.id=d.source_location_id join public.locations dst on dst.id=d.destination_location_id;
revoke all on public.transfer_delivery_view from public,anon,authenticated,service_role;
grant select on public.transfer_delivery_view to authenticated;
-- A physical count must not mistake dispatched-but-unaccepted goods for shrinkage.
do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('public.control_command(text,uuid,uuid,jsonb)'::regprocedure) into definition;
 fragment:=' insert into public.stock_count_lines values';
 if position(fragment in definition)=0 then raise exception 'Unexpected count creation definition';end if;
 definition:=replace(definition,fragment,' if private.reserved_stock(p_organization_id,(p_payload->>''location_id'')::uuid,(line->>''item_id'')::uuid)>0 then raise exception using errcode=''23514'',message=''Complete pending deliveries or confirm rejected returns before counting this source item'';end if;'||E'\n'||fragment);
 fragment:=' if exists(select 1 from public.stock_count_lines c join public.inventory_movements m';
 if position(fragment in definition)=0 then raise exception 'Unexpected count approval definition';end if;
 definition:=replace(definition,fragment,' if exists(select 1 from public.stock_count_lines c where c.count_id=rec.id and private.reserved_stock(p_organization_id,rec.location_id,c.item_id)>0) then raise exception using errcode=''23514'',message=''Complete pending deliveries or confirm rejected returns before approving this count'';end if;'||E'\n'||fragment);
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
