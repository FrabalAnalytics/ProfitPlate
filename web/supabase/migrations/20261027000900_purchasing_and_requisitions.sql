begin;
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  number integer not null check(number>0), vendor_id uuid not null,vendor_name text not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','cancelled')),
  reason text not null check(length(reason) between 1 and 500),expected_date date,
  created_by uuid not null references auth.users(id) on delete restrict,approved_by uuid references auth.users(id) on delete restrict,
  decision_reason text,created_at timestamptz not null default now(),submitted_at timestamptz,approved_at timestamptz,
  check(approved_by is null or approved_by<>created_by),unique(organization_id,id),unique(organization_id,number),
  foreign key(organization_id,vendor_id) references public.vendors(organization_id,id) on delete restrict
);
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,order_id uuid not null,item_id uuid not null,vendor_item_id uuid not null,
  purchase_unit text not null,base_quantity numeric(24,6) not null check(base_quantity>0),
  quantity numeric(24,6) not null check(quantity>0),unit_price numeric(24,8) not null check(unit_price>=0),
  normalized_unit_cost numeric(24,8) not null check(normalized_unit_cost>=0),
  unique(organization_id,id),unique(order_id,item_id),
  foreign key(organization_id,order_id) references public.purchase_orders(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict,
  foreign key(organization_id,vendor_item_id) references public.vendor_items(organization_id,id) on delete restrict
);
create table public.purchase_receipts (
  organization_id uuid not null,document_id uuid primary key,order_id uuid not null,
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,order_id) references public.purchase_orders(organization_id,id) on delete restrict
);
create table public.purchase_receipt_lines (
  organization_id uuid not null,document_id uuid not null,order_line_id uuid not null,
  quantity numeric(24,6) not null check(quantity>0),rejected_quantity numeric(24,6) not null default 0 check(rejected_quantity>=0),
  primary key(document_id,order_line_id),
  foreign key(document_id) references public.purchase_receipts(document_id) on delete restrict,
  foreign key(organization_id,order_line_id) references public.purchase_order_lines(organization_id,id) on delete restrict
);
create table public.stock_requisitions (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete restrict,
  number integer not null check(number>0),source_location_id uuid not null,destination_location_id uuid not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','closed')),
  reason text not null check(length(reason) between 1 and 500),created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,decision_reason text,
  created_at timestamptz not null default now(),submitted_at timestamptz,approved_at timestamptz,
  check(source_location_id<>destination_location_id),check(approved_by is null or approved_by<>created_by),unique(organization_id,id),unique(organization_id,number),
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,destination_location_id) references public.locations(organization_id,id) on delete restrict
);
create table public.stock_requisition_lines (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,requisition_id uuid not null,item_id uuid not null,quantity numeric(24,6) not null check(quantity>0),
  unique(organization_id,id),unique(requisition_id,item_id),
  foreign key(organization_id,requisition_id) references public.stock_requisitions(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.requisition_dispatches (
  organization_id uuid not null,document_id uuid primary key,requisition_id uuid not null,
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,requisition_id) references public.stock_requisitions(organization_id,id) on delete restrict
);
create table public.requisition_dispatch_lines (
  organization_id uuid not null,document_id uuid not null,requisition_line_id uuid not null,quantity numeric(24,6) not null check(quantity>0),
  primary key(document_id,requisition_line_id),
  foreign key(document_id) references public.requisition_dispatches(document_id) on delete restrict,
  foreign key(organization_id,requisition_line_id) references public.stock_requisition_lines(organization_id,id) on delete restrict
);
create table public.sales_menu_sources (
  organization_id uuid not null,document_id uuid not null,source_system text not null,external_id text not null,
  source_menu_code text not null,menu_item_id uuid,
  primary key(document_id,external_id),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,menu_item_id) references public.menu_items(organization_id,id) on delete restrict
);

do $$ declare t text; begin
  foreach t in array array['purchase_orders','purchase_order_lines','purchase_receipts','purchase_receipt_lines','stock_requisitions','stock_requisition_lines','requisition_dispatches','requisition_dispatch_lines','sales_menu_sources'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.has_role(organization_id))',t);
    if t not in ('purchase_orders','stock_requisitions') then
      execute format('create trigger immutable before update or delete on public.%I for each row execute function private.deny_changes()',t);
    else
      execute format('create trigger identity_protect before update or delete on public.%I for each row execute function private.protect_record()',t);
    end if;
  end loop;
end $$;
create index purchase_receipt_order on public.purchase_receipts(organization_id,order_id);
create index requisition_dispatch_request on public.requisition_dispatches(organization_id,requisition_id);

create view public.purchase_order_line_view with(security_invoker=true) as
  select l.id,l.organization_id,l.order_id,l.item_id,i.name as item_name,i.sku,l.purchase_unit,l.base_quantity::text as base_quantity,
    coalesce(i.stock_unit_label,i.base_uom_code) as base_unit,l.quantity::text as quantity,l.unit_price::text as unit_price,
    l.normalized_unit_cost::text as normalized_unit_cost,round(l.quantity*l.unit_price,8)::text as line_value,
    coalesce(received.quantity,0)::text as received_quantity,(l.quantity-coalesce(received.quantity,0))::text as outstanding_quantity
  from public.purchase_order_lines l join public.items i on i.id=l.item_id left join lateral(
    select sum(r.quantity) as quantity from public.purchase_receipt_lines r join public.inventory_documents d on d.id=r.document_id
    where r.order_line_id=l.id and d.status='posted'
  ) received on true;
create view public.stock_requisition_line_view with(security_invoker=true) as
  select l.id,l.organization_id,l.requisition_id,l.item_id,i.name as item_name,i.sku,
    coalesce(i.stock_unit_label,i.base_uom_code) as unit,l.quantity::text as quantity,
    coalesce(dispatched.quantity,0)::text as dispatched_quantity,(l.quantity-coalesce(dispatched.quantity,0))::text as outstanding_quantity
  from public.stock_requisition_lines l join public.items i on i.id=l.item_id left join lateral(
    select sum(r.quantity) as quantity from public.requisition_dispatch_lines r join public.inventory_documents d on d.id=r.document_id
    where r.requisition_line_id=l.id and d.status in ('dispatched','received')
  ) dispatched on true;
create view public.purchase_order_summary with(security_invoker=true) as
  select p.*,totals.total_value,totals.line_count,totals.outstanding_lines
  from public.purchase_orders p left join lateral(
    select sum(line_value::numeric)::text as total_value,count(*)::int as line_count,
      count(*) filter(where outstanding_quantity::numeric>0)::int as outstanding_lines
    from public.purchase_order_line_view where order_id=p.id
  ) totals on true;
create view public.requisition_fulfilment_view with(security_invoker=true) as
  select l.*,coalesce(b.quantity,0)::text as available_source_quantity,
    greatest(0,least(l.outstanding_quantity::numeric,coalesce(b.quantity,0)))::text as suggested_quantity
  from public.stock_requisition_line_view l join public.stock_requisitions r on r.id=l.requisition_id
  left join public.stock_balances b on b.organization_id=l.organization_id and b.item_id=l.item_id and b.location_id=r.source_location_id;
revoke all on public.purchase_order_line_view,public.stock_requisition_line_view,public.purchase_order_summary,public.requisition_fulfilment_view from public,anon,authenticated,service_role;
grant select on public.purchase_order_line_view,public.stock_requisition_line_view,public.purchase_order_summary,public.requisition_fulfilment_view to authenticated;

-- Checks run in the same transaction as stock posting, not just when a draft is prepared.
create function private.check_linked_stock_posting() returns trigger language plpgsql security definer set search_path='' as $$
declare header public.purchase_orders%rowtype; line record; received numeric;
begin
  if new.status='posted' and old.status is distinct from new.status then
    if new.kind='receipt' and exists(select 1 from public.purchase_receipts where document_id=new.id) then
      select p.* into header from public.purchase_orders p join public.purchase_receipts r on r.order_id=p.id where r.document_id=new.id for update of p;
      if header.status<>'approved' then raise exception using errcode='22023',message='The purchase order is no longer approved'; end if;
      for line in select r.*,l.quantity as ordered,l.item_id,l.base_quantity,l.normalized_unit_cost from public.purchase_receipt_lines r join public.purchase_order_lines l on l.id=r.order_line_id where r.document_id=new.id loop
        select coalesce(sum(r.quantity),0) into received from public.purchase_receipt_lines r join public.inventory_documents d on d.id=r.document_id where r.order_line_id=line.order_line_id and d.status='posted' and d.id<>new.id;
        if received+line.quantity>line.ordered then raise exception using errcode='23514',message='Receipt exceeds outstanding purchase quantity'; end if;
        if not exists(select 1 from public.inventory_document_lines where document_id=new.id and item_id=line.item_id and quantity=line.quantity*line.base_quantity and unit_cost=line.normalized_unit_cost) then raise exception using errcode='23514',message='Receipt does not match approved purchase quantities and cost'; end if;
      end loop;
    elsif new.kind='sales' and exists(select 1 from public.menu_items where organization_id=new.organization_id) then
      if exists(select 1 from public.sales_import_rows r left join public.sales_menu_sources s on s.document_id=r.document_id and s.external_id=r.external_id
        left join public.menu_items m on m.id=s.menu_item_id left join public.recipe_versions v on v.id=r.recipe_version_id
        where r.document_id=new.id and (s.menu_item_id is null or not m.is_active or m.recipe_id<>v.recipe_id)) then
        raise exception using errcode='22023',message='Sales require active, validated menu mappings';
      end if;
    end if;
  end if;
  return new;
end; $$;
create trigger linked_stock_posting before update on public.inventory_documents for each row execute function private.check_linked_stock_posting();

create function private.purchasing_mutation(p_org uuid,p_command text,p_payload jsonb,p_key uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entity uuid; po public.purchase_orders%rowtype; req public.stock_requisitions%rowtype; vi public.vendor_items%rowtype;
  row jsonb; line record; quantity numeric; price numeric; base_qty numeric; rejected numeric; outstanding numeric;
  lines jsonb:='[]'; normalized jsonb:='[]'; original jsonb; doc_id uuid; doc public.inventory_documents%rowtype;
  source uuid; destination uuid; menu public.menu_items%rowtype; recipe_code text; mapped boolean; has_menus boolean;
begin
  if p_command='create_purchase_order' then
    if not exists(select 1 from public.vendors where organization_id=p_org and id=(p_payload->>'vendor_id')::uuid and is_active) then raise exception using errcode='22023',message='Active vendor required'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='22023',message='Purchase order requires 1–200 items'; end if;
    insert into public.purchase_orders(organization_id,number,vendor_id,vendor_name,reason,expected_date,created_by)
      select p_org,coalesce((select max(number) from public.purchase_orders where organization_id=p_org),0)+1,v.id,v.name,private.require_text(p_payload,'reason',500),nullif(p_payload->>'expected_date','')::date,p_actor from public.vendors v where v.id=(p_payload->>'vendor_id')::uuid returning id into entity;
    for row in select value from jsonb_array_elements(p_payload->'lines') loop
      if exists(select 1 from jsonb_object_keys(row) k where k not in ('item_id','quantity','unit_cost')) then raise exception using errcode='22023',message='Unknown purchase line field'; end if;
      select * into vi from public.vendor_items where organization_id=p_org and vendor_id=(p_payload->>'vendor_id')::uuid and item_id=(row->>'item_id')::uuid and is_active;
      if not found or not exists(select 1 from public.items where id=vi.item_id and is_active and category<>'semi_finished') then raise exception using errcode='22023',message='Active supplier item mapping required'; end if;
      quantity:=private.decimal_field(row,'quantity',6);price:=private.decimal_field(row,'unit_cost',8,true);base_qty:=quantity*vi.base_quantity;
      if base_qty<>round(base_qty,6) or base_qty>1000000000000 or round(price/vi.base_quantity,8)>1000000000000 then raise exception using errcode='22023',message='Purchase conversion exceeds supported precision'; end if;
      insert into public.purchase_order_lines(organization_id,order_id,item_id,vendor_item_id,purchase_unit,base_quantity,quantity,unit_price,normalized_unit_cost)
        values(p_org,entity,vi.item_id,vi.id,vi.purchase_unit,vi.base_quantity,quantity,price,round(price/vi.base_quantity,8));
    end loop;
  elsif p_command in ('submit_purchase_order','approve_purchase_order','reject_purchase_order','cancel_purchase_order','create_purchase_receipt') then
    select * into po from public.purchase_orders where organization_id=p_org and id=(p_payload->>'id')::uuid for update;
    if not found then raise exception using errcode='22023',message='Purchase order not found'; end if;
    entity:=po.id;
    if p_command='submit_purchase_order' then
      if po.created_by<>p_actor or po.status<>'draft' then raise exception using errcode='42501',message='Only the creator can submit a draft'; end if;
      update public.purchase_orders set status='submitted',submitted_at=now() where id=po.id;
    elsif p_command in ('approve_purchase_order','reject_purchase_order') then
      if po.created_by=p_actor then raise exception using errcode='42501',message='Self approval is forbidden'; end if;
      if po.status<>'submitted' then raise exception using errcode='22023',message='Submitted purchase order required'; end if;
      if p_command='approve_purchase_order' and not exists(select 1 from public.vendors where id=po.vendor_id and is_active) then raise exception using errcode='22023',message='Active vendor required'; end if;
      if p_command='approve_purchase_order' and exists(select 1 from public.purchase_order_lines l join public.items i on i.id=l.item_id join public.vendor_items mapping on mapping.id=l.vendor_item_id where l.order_id=po.id and (not i.is_active or not mapping.is_active)) then raise exception using errcode='22023',message='Active ordered items and supplier mappings required'; end if;
      update public.purchase_orders set status=case when p_command='approve_purchase_order' then 'approved' else 'rejected' end,
        approved_by=p_actor,approved_at=clock_timestamp(),decision_reason=case when p_command='reject_purchase_order' then private.require_text(p_payload,'reason',500) end where id=po.id;
    elsif p_command='cancel_purchase_order' then
      if po.status in ('rejected','cancelled') or (po.status='approved' and not private.is_manager(p_org)) or (po.created_by<>p_actor and not private.is_manager(p_org)) then raise exception using errcode='42501',message='Manager or draft creator cancellation required'; end if;
      update public.purchase_orders set status='cancelled',decision_reason=private.require_text(p_payload,'reason',500) where id=po.id;
    else
      if po.created_by=p_actor then raise exception using errcode='42501',message='A different receiving operator must confirm this order'; end if;
      if po.status<>'approved' then raise exception using errcode='22023',message='Approved purchase order required'; end if;
      if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='22023',message='Accepted purchase quantities required'; end if;
      for row in select value from jsonb_array_elements(p_payload->'lines') loop
        if exists(select 1 from jsonb_object_keys(row) k where k not in ('item_id','quantity','rejected_quantity')) then raise exception using errcode='22023',message='Unknown receiving line field'; end if;
        select * into line from public.purchase_order_lines where order_id=po.id and item_id=(row->>'item_id')::uuid;
        if not found then raise exception using errcode='22023',message='Item is not on the purchase order'; end if;
        quantity:=private.decimal_field(row,'quantity',6);base_qty:=quantity*line.base_quantity;
        if base_qty<>round(base_qty,6) or base_qty>1000000000000 then raise exception using errcode='22023',message='Receipt conversion precision exceeded'; end if;
        select (outstanding_quantity)::numeric into outstanding from public.purchase_order_line_view where id=line.id;
        if quantity>outstanding then raise exception using errcode='23514',message='Receipt exceeds outstanding purchase quantity'; end if;
        lines:=lines||jsonb_build_array(jsonb_build_object('item_id',line.item_id,'quantity',round(base_qty,6)::text,'unit_cost',line.normalized_unit_cost::text));
      end loop;
      doc_id:=(public.inventory_command('create_document',p_key,p_org,jsonb_build_object('kind','receipt','event_date',p_payload->>'event_date','reason',private.require_text(p_payload,'reason',500),'destination_location_id',p_payload->>'location_id','lines',lines))->>'id')::uuid;
      insert into public.purchase_receipts values(p_org,doc_id,po.id);
      for row in select value from jsonb_array_elements(p_payload->'lines') loop
        rejected:=case when row ? 'rejected_quantity' then private.decimal_field(row,'rejected_quantity',6,true) else 0 end;
        insert into public.purchase_receipt_lines select p_org,doc_id,id,private.decimal_field(row,'quantity',6),rejected from public.purchase_order_lines where order_id=po.id and item_id=(row->>'item_id')::uuid;
      end loop;
      entity:=doc_id;
    end if;
  elsif p_command='create_requisition' then
    select location_id into source from public.operating_areas where organization_id=p_org and area='main_store';
    destination:=(p_payload->>'destination_location_id')::uuid;
    if source is null or not exists(select 1 from public.operating_areas where organization_id=p_org and location_id=destination and area in ('kitchen','bar')) then raise exception using errcode='22023',message='Configure Main Store and the requesting department first'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='22023',message='Request needs 1–200 items'; end if;
    insert into public.stock_requisitions(organization_id,number,source_location_id,destination_location_id,reason,created_by)
      select p_org,coalesce(max(number),0)+1,source,destination,private.require_text(p_payload,'reason',500),p_actor from public.stock_requisitions where organization_id=p_org returning id into entity;
    for row in select value from jsonb_array_elements(p_payload->'lines') loop
      if exists(select 1 from jsonb_object_keys(row) k where k not in ('item_id','quantity')) then raise exception using errcode='22023',message='Unknown requisition item field'; end if;
      if not exists(select 1 from public.items where organization_id=p_org and id=(row->>'item_id')::uuid and is_active) then raise exception using errcode='22023',message='Active inventory item required'; end if;
      insert into public.stock_requisition_lines(organization_id,requisition_id,item_id,quantity) values(p_org,entity,(row->>'item_id')::uuid,private.decimal_field(row,'quantity',6));
    end loop;
  elsif p_command in ('submit_requisition','approve_requisition','reject_requisition','fulfil_requisition','close_requisition') then
    select * into req from public.stock_requisitions where organization_id=p_org and id=(p_payload->>'id')::uuid for update;
    if not found then raise exception using errcode='22023',message='Requisition not found'; end if;
    entity:=req.id;
    if p_command='submit_requisition' then
      if req.created_by<>p_actor or req.status<>'draft' then raise exception using errcode='42501',message='Only the requester can submit a draft'; end if;
      update public.stock_requisitions set status='submitted',submitted_at=now() where id=req.id;
    elsif p_command='close_requisition' then
      if req.status in ('rejected','closed') or (req.created_by<>p_actor and not private.is_manager(p_org)) then raise exception using errcode='42501',message='Only the requester or manager may close outstanding demand'; end if;
      update public.stock_requisitions set status='closed',decision_reason=private.require_text(p_payload,'reason',500) where id=req.id;
    elsif p_command in ('approve_requisition','reject_requisition') then
      if req.created_by=p_actor then raise exception using errcode='42501',message='Self approval is forbidden'; end if;
      if req.status<>'submitted' then raise exception using errcode='22023',message='Submitted requisition required'; end if;
      update public.stock_requisitions set status=case when p_command='approve_requisition' then 'approved' else 'rejected' end,
        approved_by=p_actor,approved_at=clock_timestamp(),decision_reason=case when p_command='reject_requisition' then private.require_text(p_payload,'reason',500) end where id=req.id;
    else
      if req.status<>'approved' or not exists(select 1 from public.operational_managers o join public.organization_memberships m on m.organization_id=o.organization_id and m.user_id=o.user_id where o.organization_id=p_org and o.user_id=req.approved_by and m.status='active') then raise exception using errcode='22023',message='Current manager-approved requisition required'; end if;
      if req.approved_by=p_actor then raise exception using errcode='42501',message='The approving manager cannot dispatch their own approval'; end if;
      if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='22023',message='Dispatch quantities required'; end if;
      for row in select value from jsonb_array_elements(p_payload->'lines') loop
        if exists(select 1 from jsonb_object_keys(row) k where k not in ('item_id','quantity')) then raise exception using errcode='22023',message='Unknown dispatch field'; end if;
        select * into line from public.stock_requisition_line_view where requisition_id=req.id and item_id=(row->>'item_id')::uuid;
        if not found then raise exception using errcode='22023',message='Item is not on the requisition'; end if;
        quantity:=private.decimal_field(row,'quantity',6);
        if quantity>line.outstanding_quantity::numeric then raise exception using errcode='23514',message='Dispatch exceeds approved request quantity'; end if;
        lines:=lines||jsonb_build_array(jsonb_build_object('item_id',line.item_id,'quantity',quantity::text));
      end loop;
      doc_id:=(public.inventory_command('create_document',p_key,p_org,jsonb_build_object('kind','transfer','event_date',p_payload->>'event_date','reason',private.require_text(p_payload,'reason',500),'source_location_id',req.source_location_id,'destination_location_id',req.destination_location_id,'lines',lines))->>'id')::uuid;
      perform public.inventory_command('submit_document',p_key,p_org,jsonb_build_object('id',doc_id));
      select * into doc from public.inventory_documents where id=doc_id;
      perform private.post_inventory_document(doc);
      update public.inventory_documents set status='dispatched',approved_by=req.approved_by,posted_at=clock_timestamp() where id=doc_id;
      insert into public.requisition_dispatches values(p_org,doc_id,req.id);
      for row in select value from jsonb_array_elements(p_payload->'lines') loop
        insert into public.requisition_dispatch_lines select p_org,doc_id,id,private.decimal_field(row,'quantity',6) from public.stock_requisition_lines where requisition_id=req.id and item_id=(row->>'item_id')::uuid;
      end loop;
      entity:=doc_id;
    end if;
  elsif p_command='create_sales_draft' then
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500 then raise exception using errcode='22023',message='Sales rows required'; end if;
    select exists(select 1 from public.menu_items where organization_id=p_org) into has_menus;
    for row in select value from jsonb_array_elements(p_payload->'lines') loop
      if exists(select 1 from jsonb_object_keys(row) k where k not in ('menu_code','external_id','quantity','location_id')) then raise exception using errcode='22023',message='Unknown sales field'; end if;
      select * into menu from public.menu_items where organization_id=p_org and code=upper(private.require_text(row,'menu_code',64));
      mapped:=found;
      if has_menus and (not mapped or not menu.is_active) then raise exception using errcode='22023',message='Active menu item mapping required'; end if;
      if mapped then select code into recipe_code from public.recipes where id=menu.recipe_id; else recipe_code:=private.require_text(row,'menu_code',64); end if;
      normalized:=normalized||jsonb_build_array(row||jsonb_build_object('menu_code',recipe_code));
    end loop;
    doc_id:=(public.inventory_command('create_document',p_key,p_org,jsonb_build_object('kind','sales','source_system',p_payload->>'source_system','event_date',p_payload->>'event_date','reason',p_payload->>'reason','lines',normalized))->>'id')::uuid;
    for row in select value from jsonb_array_elements(p_payload->'lines') loop
      select id into source from public.menu_items where organization_id=p_org and code=upper(row->>'menu_code');
      insert into public.sales_menu_sources values(p_org,doc_id,upper(p_payload->>'source_system'),row->>'external_id',row->>'menu_code',source);
    end loop;
    entity:=doc_id;
  else raise exception using errcode='22023',message='Unsupported purchasing command'; end if;
  return jsonb_build_object('id',entity,'organization_id',p_org);
end; $$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(uuid,text[]),private.can_read_vendors(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
