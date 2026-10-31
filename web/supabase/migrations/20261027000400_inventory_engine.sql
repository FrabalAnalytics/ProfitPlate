begin;
create table public.inventory_documents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check(kind in ('opening','receipt','transfer','waste','usage','production','sales')),
  status text not null default 'draft' check(status in ('draft','submitted','rejected','posted','dispatched','received')),
  event_date date not null, reason text not null check(length(reason) between 1 and 500),
  source_location_id uuid, destination_location_id uuid,
  recipe_version_id uuid, planned_output numeric(24,6), actual_output numeric(24,6),
  source_system text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  received_by uuid references auth.users(id) on delete restrict,
  rejection_reason text, created_at timestamptz not null default now(),
  submitted_at timestamptz, posted_at timestamptz, received_at timestamptz,
  check(approved_by is null or approved_by<>created_by),
  check(source_location_id is null or destination_location_id is null or source_location_id<>destination_location_id),
  unique(organization_id,id),
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,destination_location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,recipe_version_id) references public.recipe_versions(organization_id,id) on delete restrict
);
create index documents_queue on public.inventory_documents(organization_id,status,created_at,id);
create table public.inventory_document_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null,
  item_id uuid not null, quantity numeric(24,6) not null check(quantity>0),
  unit_cost numeric(24,8) check(unit_cost>=0),
  unique(document_id,item_id), unique(organization_id,id),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.sales_import_rows (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null,
  source_system text not null check(length(source_system) between 1 and 80),
  external_id text not null check(length(external_id) between 1 and 160),
  recipe_version_id uuid not null, location_id uuid not null,
  quantity numeric(24,6) not null check(quantity>0),
  unique(document_id,source_system,external_id),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,recipe_version_id) references public.recipe_versions(organization_id,id) on delete restrict,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);
create table public.sales_posting_keys (
  organization_id uuid not null, source_system text not null, external_id text not null, document_id uuid not null,
  primary key(organization_id,source_system,external_id),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict
);
create table public.stock_balances (
  organization_id uuid not null, location_id uuid not null, item_id uuid not null,
  quantity numeric(24,6) not null default 0 check(quantity>=0),
  primary key(organization_id,location_id,item_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.stock_cost_state (
  organization_id uuid not null, item_id uuid not null,
  quantity numeric(24,6) not null default 0 check(quantity>=0),
  inventory_value numeric(32,8) not null default 0 check(inventory_value>=0),
  average_cost numeric(24,8),
  primary key(organization_id,item_id),
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.transfer_stock (
  organization_id uuid not null, document_id uuid not null, item_id uuid not null,
  quantity numeric(24,6) not null check(quantity>0),
  dispatched_unit_cost numeric(24,8) not null check(dispatched_unit_cost>=0),
  received_quantity numeric(24,6) not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
  primary key(document_id,item_id),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, document_id uuid not null,
  item_id uuid not null, location_id uuid,
  bucket text not null check(bucket in ('on_hand','in_transit')),
  movement text not null, quantity numeric(24,6) not null check(quantity<>0),
  unit_cost numeric(24,8) not null check(unit_cost>=0), value numeric(32,8) not null,
  event_date date not null, posted_at timestamptz not null default now(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  check((bucket='on_hand' and location_id is not null) or (bucket='in_transit' and location_id is null)),
  foreign key(organization_id,document_id) references public.inventory_documents(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);
create index movement_history on public.inventory_movements(organization_id,posted_at desc,id desc);
create index movement_item_location on public.inventory_movements(organization_id,item_id,location_id);
create unique index one_opening_per_item_location on public.inventory_movements(organization_id,item_id,location_id) where movement='opening';

do $$ declare t text; begin
  foreach t in array array['inventory_documents','inventory_document_lines','sales_import_rows','sales_posting_keys','stock_balances','stock_cost_state','transfer_stock','inventory_movements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.has_role(organization_id))',t);
  end loop;
end $$;
create trigger movements_immutable before update or delete on public.inventory_movements for each row execute function private.deny_changes();
create trigger document_lines_immutable before update or delete on public.inventory_document_lines for each row execute function private.deny_changes();
create trigger sales_rows_immutable before update or delete on public.sales_import_rows for each row execute function private.deny_changes();

create function private.live_item_cost(p_org uuid,p_item uuid,p_path uuid[] default '{}') returns numeric
language plpgsql stable security definer set search_path='' as $$
declare c text; v uuid; q numeric; line record; n numeric; total numeric:=0; missing boolean:=false;
begin
  if p_item=any(p_path) or cardinality(p_path)>30 then
    raise exception using errcode='22023',message='Cyclic or excessively nested recipe';
  end if;
  select category into c from public.items where organization_id=p_org and id=p_item;
  if c is null or c='general' then raise exception using errcode='22023',message='Invalid recipe ingredient'; end if;
  if c='raw_material' then
    return (select average_cost from public.stock_cost_state where organization_id=p_org and item_id=p_item);
  end if;
  select rv.id,rv.standard_output into v,q from public.recipes r join public.recipe_versions rv on rv.recipe_id=r.id
    where r.organization_id=p_org and r.output_item_id=p_item order by rv.revision desc limit 1;
  if v is null then return null; end if;
  for line in select * from public.recipe_ingredients where version_id=v loop
    n:=private.live_item_cost(p_org,line.item_id,p_path||p_item);
    if n is null then missing:=true; else total:=total+line.quantity*n; end if;
  end loop;
  if missing then return null; end if;
  return round(total/q,8);
end; $$;

create function public.current_recipe_cost(p_organization_id uuid,p_recipe_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.recipe_versions%rowtype; line record; n numeric; total numeric:=0; missing boolean:=false;
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  select * into v from public.recipe_versions where organization_id=p_organization_id and recipe_id=p_recipe_id order by revision desc limit 1;
  if not found then raise exception using errcode='22023',message='Recipe not found'; end if;
  for line in select * from public.recipe_ingredients where version_id=v.id loop
    n:=private.live_item_cost(p_organization_id,line.item_id);
    if n is null then missing:=true; else total:=total+line.quantity*n; end if;
  end loop;
  return jsonb_build_object('recipe_id',p_recipe_id,'version_id',v.id,'complete',not missing,
    'standard_output',v.standard_output::text,'batch_cost',case when not missing then round(total,8)::text end,
    'unit_cost',case when not missing then round(total/v.standard_output,8)::text end);
end; $$;

-- Only called while holding the tenant lock. Cost state includes all locations and transit.
create function private.move_stock(p_doc public.inventory_documents,p_item uuid,p_location uuid,p_delta numeric,
  p_kind text,p_cost numeric default null,p_transit boolean default false,p_affects_total boolean default true,p_exact_value numeric default null) returns numeric
language plpgsql security definer set search_path='' as $$
declare s public.stock_cost_state%rowtype; cost numeric; val numeric; remaining numeric;
begin
  if p_delta=0 or p_delta<>round(p_delta,6) then raise exception using errcode='22023',message='Unsupported movement precision'; end if;
  insert into public.stock_cost_state(organization_id,item_id) values(p_doc.organization_id,p_item) on conflict do nothing;
  select * into s from public.stock_cost_state where organization_id=p_doc.organization_id and item_id=p_item for update;
  cost:=coalesce(p_cost,s.average_cost);
  if cost is null or cost<0 then raise exception using errcode='22023',message='Inventory cost is missing'; end if;
  cost:=round(cost,8); val:=coalesce(p_exact_value,round(p_delta*cost,8));
  if not p_transit then
    insert into public.stock_balances(organization_id,location_id,item_id) values(p_doc.organization_id,p_location,p_item) on conflict do nothing;
    update public.stock_balances set quantity=quantity+p_delta
      where organization_id=p_doc.organization_id and location_id=p_location and item_id=p_item and quantity+p_delta>=0;
    if not found then raise exception using errcode='23514',message='Insufficient stock at the selected location'; end if;
  end if;
  if p_affects_total then
    remaining:=s.quantity+p_delta;
    if remaining<0 then raise exception using errcode='23514',message='Insufficient business stock'; end if;
    -- Consume the exact residual on final depletion, avoiding rounding dust.
    if remaining=0 and p_delta<0 then val:=-s.inventory_value; end if;
    if s.inventory_value+val<0 then raise exception using errcode='23514',message='Inventory valuation underflow'; end if;
    update public.stock_cost_state set quantity=remaining,inventory_value=s.inventory_value+val,
      average_cost=case when remaining>0 then round((s.inventory_value+val)/remaining,8) else cost end
      where organization_id=p_doc.organization_id and item_id=p_item;
  end if;
  insert into public.inventory_movements(organization_id,document_id,item_id,location_id,bucket,movement,quantity,unit_cost,value,event_date,actor_id)
    values(p_doc.organization_id,p_doc.id,p_item,p_location,case when p_transit then 'in_transit' else 'on_hand' end,p_kind,p_delta,cost,val,p_doc.event_date,auth.uid());
  return abs(val);
end; $$;

create function private.post_inventory_document(p_doc public.inventory_documents) returns void
language plpgsql security definer set search_path='' as $$
declare line record; recipe public.recipes%rowtype; version public.recipe_versions%rowtype;
  cost numeric; total numeric:=0; sales record; q numeric;
begin
  if not exists(select 1 from public.inventory_periods where organization_id=p_doc.organization_id
    and p_doc.event_date between starts_on and ends_on and not is_closed) then
    raise exception using errcode='22023',message='Posting requires an open inventory period';
  end if;
  if p_doc.event_date>(now() at time zone 'Africa/Lagos')::date then
    raise exception using errcode='22023',message='Future inventory events are not allowed';
  end if;
  if exists(select 1 from public.inventory_document_lines l join public.items i on i.id=l.item_id
    where l.document_id=p_doc.id and not i.is_active) or exists(select 1 from public.locations
    where id in (p_doc.source_location_id,p_doc.destination_location_id) and not is_active) then
    raise exception using errcode='22023',message='Inactive item or location';
  end if;
  if p_doc.kind in ('opening','receipt','waste','usage','transfer') then
    for line in select l.*,i.category from public.inventory_document_lines l join public.items i on i.id=l.item_id where document_id=p_doc.id order by l.item_id loop
      if p_doc.kind in ('opening','receipt') then
        if p_doc.kind='receipt' and line.category='semi_finished' then raise exception using errcode='22023',message='Semi-finished stock must be produced in-house'; end if;
        if p_doc.kind='opening' and exists(select 1 from public.inventory_movements where organization_id=p_doc.organization_id and item_id=line.item_id and location_id=p_doc.destination_location_id) then
          raise exception using errcode='22023',message='Opening stock must precede all other movements for this item/location';
        end if;
        perform private.move_stock(p_doc,line.item_id,p_doc.destination_location_id,line.quantity,p_doc.kind,line.unit_cost);
      elsif p_doc.kind in ('waste','usage') then
        if p_doc.kind='usage' and line.category<>'general' then raise exception using errcode='22023',message='Usage documents are for general supplies'; end if;
        perform private.move_stock(p_doc,line.item_id,p_doc.source_location_id,-line.quantity,p_doc.kind);
      else
        select average_cost into cost from public.stock_cost_state where organization_id=p_doc.organization_id and item_id=line.item_id;
        perform private.move_stock(p_doc,line.item_id,p_doc.source_location_id,-line.quantity,'transfer_dispatch',cost,false,false);
        perform private.move_stock(p_doc,line.item_id,null,line.quantity,'transfer_in_transit',cost,true,false);
        insert into public.transfer_stock(organization_id,document_id,item_id,quantity,dispatched_unit_cost)
          values(p_doc.organization_id,p_doc.id,line.item_id,line.quantity,cost);
      end if;
    end loop;
  elsif p_doc.kind='production' then
    select * into version from public.recipe_versions where id=p_doc.recipe_version_id;
    select * into recipe from public.recipes where id=version.recipe_id;
    if recipe.kind<>'sub_recipe' or not exists(select 1 from public.operating_areas where organization_id=p_doc.organization_id and area='kitchen' and location_id=p_doc.source_location_id) then
      raise exception using errcode='22023',message='Production requires a Kitchen sub-recipe';
    end if;
    if not exists(select 1 from public.items where id=recipe.output_item_id and is_active) then raise exception using errcode='22023',message='Inactive production output'; end if;
    for line in select l.*,i.is_active from public.recipe_ingredients l join public.items i on i.id=l.item_id where version_id=version.id order by item_id loop
      if not line.is_active then raise exception using errcode='22023',message='Inactive recipe ingredient'; end if;
      q:=line.quantity*p_doc.planned_output/version.standard_output;
      if q<>round(q,6) then raise exception using errcode='22023',message='Scaled ingredient quantity exceeds precision'; end if;
      total:=total+private.move_stock(p_doc,line.item_id,p_doc.source_location_id,-q,'production_input');
    end loop;
    cost:=round(total/p_doc.actual_output,8);
    perform private.move_stock(p_doc,recipe.output_item_id,p_doc.source_location_id,p_doc.actual_output,'production_output',cost,false,true,total);
  else
    for sales in select s.*,v.standard_output from public.sales_import_rows s join public.recipe_versions v on v.id=s.recipe_version_id where document_id=p_doc.id order by s.id loop
      insert into public.sales_posting_keys values(p_doc.organization_id,sales.source_system,sales.external_id,p_doc.id);
      if not exists(select 1 from public.operating_areas where organization_id=p_doc.organization_id and location_id=sales.location_id and area in ('kitchen','bar'))
        or not exists(select 1 from public.locations where id=sales.location_id and is_active) then raise exception using errcode='22023',message='Sales require an active Kitchen or Bar'; end if;
      for line in select l.*,i.is_active from public.recipe_ingredients l join public.items i on i.id=l.item_id where version_id=sales.recipe_version_id order by item_id loop
        if not line.is_active then raise exception using errcode='22023',message='Inactive sales ingredient'; end if;
        q:=line.quantity*sales.quantity/sales.standard_output;
        if q<>round(q,6) then raise exception using errcode='22023',message='Scaled ingredient quantity exceeds precision'; end if;
        perform private.move_stock(p_doc,line.item_id,sales.location_id,-q,'sales_consumption');
      end loop;
    end loop;
  end if;
end; $$;

create function public.inventory_command(p_command text,p_request_id uuid,p_organization_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor(); v_result jsonb; saved private.command_requests%rowtype;
  hash bytea; allowed text[]; entity uuid; target uuid; loc uuid; dest uuid; kind text; textval text;
  doc public.inventory_documents%rowtype; r public.recipes%rowtype; v uuid; line jsonb; q numeric; n numeric;
  recipeid uuid; versionid uuid; planned numeric; actual numeric; eventdate date; period public.inventory_periods%rowtype; area_row record; candidates integer;
begin
  if p_request_id is null or p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then raise exception using errcode='22023',message='Invalid command envelope'; end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  if not found or not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  allowed:=case p_command
    when 'prepare_areas' then array[]::text[]
    when 'configure_areas' then array['main_store','kitchen','bar']
    when 'appoint_manager' then array['user_id','manager_role']
    when 'remove_manager' then array['user_id','reason']
    when 'create_period' then array['starts_on','ends_on']
    when 'close_period' then array['id','reason']
    when 'reopen_period' then array['id','reason']
    when 'create_item' then array['sku','name','base_uom_code','category']
    when 'create_recipe' then array['code','name','kind','output_item_id','standard_output','lines']
    when 'revise_recipe' then array['id','standard_output','lines']
    when 'create_document' then array['kind','event_date','reason','source_location_id','destination_location_id','recipe_version_id','planned_output','actual_output','source_system','lines']
    when 'submit_document' then array['id']
    when 'approve_document' then array['id']
    when 'reject_document' then array['id','reason']
    when 'receive_transfer' then array['id','lines','reason']
    else null end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown command or payload field'; end if;
  -- Recheck authority before returning any idempotent result.
  if p_command in ('prepare_areas','configure_areas','appoint_manager','remove_manager') then
    if not private.has_role(p_organization_id,array['owner','admin']) then raise exception using errcode='42501',message='Team administration required'; end if;
    if p_command in ('appoint_manager','remove_manager') and not private.has_role(p_organization_id,array['owner']) then raise exception using errcode='42501',message='Only the owner may appoint or remove operational managers'; end if;
  elsif p_command in ('approve_document','reject_document','create_period','close_period') then
    if not private.is_manager(p_organization_id) then raise exception using errcode='42501',message='Operations Manager or General Manager required'; end if;
  elsif p_command='reopen_period' then
    if not private.is_manager(p_organization_id,true) then raise exception using errcode='42501',message='Only the General Manager can reopen a period'; end if;
  elsif p_command in ('create_recipe','revise_recipe','create_item') then
    if not (private.can_operate(p_organization_id) or private.has_role(p_organization_id,array['kitchen_lead'])) then raise exception using errcode='42501',message='Master data editing denied'; end if;
  elsif p_command='create_document' then
    loc:=(p_payload->>'source_location_id')::uuid; dest:=(p_payload->>'destination_location_id')::uuid;
    if not private.can_operate(p_organization_id,coalesce(loc,dest)) then raise exception using errcode='42501',message='Operating permission required'; end if;
  else
    select * into doc from public.inventory_documents where organization_id=p_organization_id and id=(p_payload->>'id')::uuid for update;
    if not found or not private.can_operate(p_organization_id,case when p_command='receive_transfer' then doc.destination_location_id else coalesce(doc.source_location_id,doc.destination_location_id) end) then raise exception using errcode='42501',message='Document access denied'; end if;
  end if;
  hash:=sha256(convert_to(p_payload::text,'UTF8'));
  insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash) values(actor,p_organization_id,'inventory:'||p_command,p_request_id,hash) on conflict do nothing;
  select * into saved from private.command_requests where actor_id=actor and scope_id=p_organization_id and command='inventory:'||p_command and request_id=p_request_id for update;
  if saved.payload_hash<>hash then raise exception using errcode='22023',message='Request key reused with different payload'; end if;
  if saved.result is not null then return saved.result; end if;

  case p_command
  when 'prepare_areas' then
    for area_row in select * from (values ('main_store','MAIN-STORE','Main Store',array['main store','main-store','store']),
      ('kitchen','KITCHEN','Kitchen',array['kitchen','main kitchen','kicthen']),('bar','BAR','Bar',array['bar','main bar'])) a(area,code,name,aliases) loop
      if exists(select 1 from public.operating_areas where organization_id=p_organization_id and area=area_row.area) then continue; end if;
      select count(*),min(id::text)::uuid into candidates,target from public.locations where organization_id=p_organization_id
        and (code=area_row.code or lower(name)=any(area_row.aliases) or (area_row.area='kitchen' and code='MAIN-KITCHEN'));
      if candidates>1 then raise exception using errcode='22023',message='Multiple candidate areas; configure locations explicitly'; end if;
      if target is null then insert into public.locations(organization_id,code,name) values(p_organization_id,area_row.code,area_row.name) returning id into target; end if;
      if not exists(select 1 from public.locations where id=target and is_active) then raise exception using errcode='22023',message='Reactivate the existing operating location first'; end if;
      insert into public.operating_areas values(p_organization_id,area_row.area,target);
    end loop;
    entity:=p_organization_id;
  when 'configure_areas' then
    if (select count(distinct value) from jsonb_each_text(p_payload))<>3 or not(p_payload ?& array['main_store','kitchen','bar']) then raise exception using errcode='22023',message='Three distinct locations are required'; end if;
    if exists(select 1 from public.inventory_movements where organization_id=p_organization_id) then raise exception using errcode='22023',message='Operating areas cannot be remapped after stock posting'; end if;
    delete from public.operating_areas where organization_id=p_organization_id;
    insert into public.operating_areas(organization_id,area,location_id) select p_organization_id,key,value::uuid from jsonb_each_text(p_payload);
    if exists(select 1 from public.operating_areas a join public.locations l on l.id=a.location_id where a.organization_id=p_organization_id and not l.is_active) then raise exception using errcode='22023',message='Active locations required'; end if;
    entity:=p_organization_id;
  when 'appoint_manager' then
    target:=(p_payload->>'user_id')::uuid; textval:=private.require_text(p_payload,'manager_role',32);
    if textval not in ('operations_manager','general_manager') or not exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=target and m.status='active' and u.email_confirmed_at is not null) then raise exception using errcode='22023',message='An active verified member and valid manager role are required'; end if;
    insert into public.operational_managers values(p_organization_id,target,textval) on conflict(organization_id,user_id) do update set manager_role=excluded.manager_role;
    entity:=target;
  when 'remove_manager' then
    target:=(p_payload->>'user_id')::uuid; perform private.require_text(p_payload,'reason',500);
    delete from public.operational_managers where organization_id=p_organization_id and user_id=target;
    entity:=target;
  when 'create_period' then
    eventdate:=(p_payload->>'starts_on')::date;
    if eventdate is null or p_payload->>'ends_on' is null or eventdate>(p_payload->>'ends_on')::date
      or exists(select 1 from public.inventory_periods where organization_id=p_organization_id and starts_on<=(p_payload->>'ends_on')::date and ends_on>=eventdate) then raise exception using errcode='22023',message='Periods must be valid and must not overlap'; end if;
    insert into public.inventory_periods(organization_id,starts_on,ends_on) values(p_organization_id,eventdate,(p_payload->>'ends_on')::date) returning id into entity;
  when 'close_period','reopen_period' then
    perform private.require_text(p_payload,'reason',500);
    update public.inventory_periods set is_closed=(p_command='close_period') where organization_id=p_organization_id and id=(p_payload->>'id')::uuid returning id into entity;
    if entity is null then raise exception using errcode='22023',message='Period not found'; end if;
  when 'create_item' then
    kind:=private.require_text(p_payload,'category',20);
    if kind not in ('raw_material','semi_finished','general') then raise exception using errcode='22023',message='Invalid category'; end if;
    insert into public.items(organization_id,sku,name,base_uom_code,category) values(p_organization_id,private.require_text(p_payload,'sku',64),private.require_text(p_payload,'name',160),private.require_text(p_payload,'base_uom_code',8),kind) returning id into entity;
  when 'create_recipe','revise_recipe' then
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 200 then raise exception using errcode='22023',message='Recipe needs 1–200 ingredients'; end if;
    if p_command='create_recipe' then
      kind:=private.require_text(p_payload,'kind',20); target:=(p_payload->>'output_item_id')::uuid;
      if kind='sub_recipe' and not exists(select 1 from public.items where organization_id=p_organization_id and id=target and category='semi_finished' and is_active) then raise exception using errcode='22023',message='Sub-recipe needs a semi-finished output item'; end if;
      insert into public.recipes(organization_id,code,name,kind,output_item_id) values(p_organization_id,upper(private.require_text(p_payload,'code',64)),private.require_text(p_payload,'name',160),kind,target) returning * into r;
    else
      select * into r from public.recipes where organization_id=p_organization_id and id=(p_payload->>'id')::uuid;
      if not found then raise exception using errcode='22023',message='Recipe not found'; end if;
    end if;
    insert into public.recipe_versions(organization_id,recipe_id,revision,standard_output,created_by)
      select p_organization_id,r.id,coalesce(max(revision),0)+1,private.decimal_field(p_payload,'standard_output',6),actor from public.recipe_versions where recipe_id=r.id returning id into v;
    for line in select value from jsonb_array_elements(p_payload->'lines') loop
      if exists(select 1 from jsonb_object_keys(line) k where k not in ('item_id','quantity')) then raise exception using errcode='22023',message='Unknown ingredient field'; end if;
      target:=(line->>'item_id')::uuid;
      if not exists(select 1 from public.items where organization_id=p_organization_id and id=target and category in ('raw_material','semi_finished') and is_active) then raise exception using errcode='22023',message='Recipe ingredients must be active raw or semi-finished items'; end if;
      insert into public.recipe_ingredients values(p_organization_id,v,target,private.decimal_field(line,'quantity',6));
    end loop;
    if r.output_item_id is not null then perform private.live_item_cost(p_organization_id,r.output_item_id); end if;
    entity:=r.id; v_result:=jsonb_build_object('version_id',v);
  when 'create_document' then
    kind:=private.require_text(p_payload,'kind',20); eventdate:=(p_payload->>'event_date')::date;
    textval:=private.require_text(p_payload,'reason',500);
    if eventdate is null or eventdate>(now() at time zone 'Africa/Lagos')::date then raise exception using errcode='22023',message='Valid event date required'; end if;
    if kind='production' then
      versionid:=(p_payload->>'recipe_version_id')::uuid; planned:=private.decimal_field(p_payload,'planned_output',6); actual:=private.decimal_field(p_payload,'actual_output',6);
      if not exists(select 1 from public.recipe_versions rv join public.recipes rr on rr.id=rv.recipe_id where rv.organization_id=p_organization_id and rv.id=versionid and rr.kind='sub_recipe') then raise exception using errcode='22023',message='Valid sub-recipe version required'; end if;
      if not exists(select 1 from public.operating_areas where organization_id=p_organization_id and area='kitchen' and location_id=loc) then raise exception using errcode='22023',message='Production location must be Kitchen'; end if;
    elsif kind='sales' then
      textval:=upper(private.require_text(p_payload,'source_system',80));
      if not private.can_operate(p_organization_id) then raise exception using errcode='42501',message='Inventory operator required for sales import'; end if;
    elsif kind in ('opening','receipt') then
      if dest is null or loc is not null then raise exception using errcode='22023',message='Receipt destination required'; end if;
    elsif kind in ('waste','usage') then
      if loc is null or dest is not null then raise exception using errcode='22023',message='Source location required'; end if;
    elsif kind='transfer' then
      if loc is null or dest is null or loc=dest then raise exception using errcode='22023',message='Distinct source and destination required'; end if;
    else raise exception using errcode='22023',message='Unsupported document kind'; end if;
    insert into public.inventory_documents(organization_id,kind,event_date,reason,source_location_id,destination_location_id,recipe_version_id,planned_output,actual_output,source_system,created_by)
      values(p_organization_id,kind,eventdate,private.require_text(p_payload,'reason',500),loc,dest,versionid,planned,actual,case when kind='sales' then textval end,actor) returning id into entity;
    if kind<>'production' then
      if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500 then raise exception using errcode='22023',message='Document requires 1–500 lines'; end if;
      for line in select value from jsonb_array_elements(p_payload->'lines') loop
        if kind='sales' then
          if exists(select 1 from jsonb_object_keys(line) k where k not in ('menu_code','external_id','quantity','location_id')) then raise exception using errcode='22023',message='Unknown sales field'; end if;
          loc:=(line->>'location_id')::uuid;
          if exists(select 1 from public.sales_posting_keys where organization_id=p_organization_id and source_system=textval and external_id=line->>'external_id') then raise exception using errcode='23505',message='Sales source line already posted'; end if;
          if not exists(select 1 from public.operating_areas where organization_id=p_organization_id and location_id=loc and area in ('kitchen','bar')) then raise exception using errcode='22023',message='Sales target must be Kitchen or Bar'; end if;
          select rv.id into versionid from public.recipes rr join public.recipe_versions rv on rv.recipe_id=rr.id where rr.organization_id=p_organization_id and rr.code=upper(private.require_text(line,'menu_code',64)) and rr.kind='final' order by rv.revision desc limit 1;
          if versionid is null then raise exception using errcode='22023',message='Unmapped menu item'; end if;
          insert into public.sales_import_rows(organization_id,document_id,source_system,external_id,recipe_version_id,location_id,quantity)
            values(p_organization_id,entity,textval,private.require_text(line,'external_id',160),versionid,loc,private.decimal_field(line,'quantity',6));
        else
          if exists(select 1 from jsonb_object_keys(line) k where k not in ('item_id','quantity','unit_cost')) then raise exception using errcode='22023',message='Unknown stock line field'; end if;
          target:=(line->>'item_id')::uuid;
          if not exists(select 1 from public.items where organization_id=p_organization_id and id=target and is_active) then raise exception using errcode='22023',message='Active business item required'; end if;
          insert into public.inventory_document_lines(organization_id,document_id,item_id,quantity,unit_cost) values(p_organization_id,entity,target,private.decimal_field(line,'quantity',6),case when kind in ('opening','receipt') then private.decimal_field(line,'unit_cost',8,true) end);
        end if;
      end loop;
    end if;
  when 'submit_document' then
    if doc.created_by<>actor or doc.status<>'draft' then raise exception using errcode='42501',message='Only the creator may submit a draft'; end if;
    update public.inventory_documents set status='submitted',submitted_at=now() where id=doc.id;
    entity:=doc.id;
  when 'approve_document','reject_document' then
    select * into doc from public.inventory_documents where organization_id=p_organization_id and id=(p_payload->>'id')::uuid for update;
    if not found or doc.status<>'submitted' then raise exception using errcode='22023',message='Document must be submitted'; end if;
    if doc.created_by=actor then raise exception using errcode='42501',message='Self approval is forbidden'; end if;
    if p_command='reject_document' then
      update public.inventory_documents set status='rejected',approved_by=actor,rejection_reason=private.require_text(p_payload,'reason',500) where id=doc.id;
    else
      perform private.post_inventory_document(doc);
      update public.inventory_documents set status=case when doc.kind='transfer' then 'dispatched' else 'posted' end,approved_by=actor,posted_at=now() where id=doc.id;
    end if;
    entity:=doc.id;
  when 'receive_transfer' then
    if doc.kind<>'transfer' or doc.status<>'dispatched' then raise exception using errcode='22023',message='Dispatched transfer required'; end if;
    if actor=doc.approved_by then raise exception using errcode='42501',message='Dispatcher cannot confirm their own delivery'; end if;
    perform private.require_text(p_payload,'reason',500);
    if not exists(select 1 from public.inventory_periods where organization_id=p_organization_id and not is_closed and (now() at time zone 'Africa/Lagos')::date between starts_on and ends_on) then raise exception using errcode='22023',message='Current receipt period must be open'; end if;
    if not exists(select 1 from public.locations where id=doc.destination_location_id and is_active) then raise exception using errcode='22023',message='Inactive destination'; end if;
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500 then raise exception using errcode='22023',message='Received quantities required'; end if;
    -- Receipt is a new physical event, while retaining the original source document.
    doc.event_date:=(now() at time zone 'Africa/Lagos')::date;
    for line in select value from jsonb_array_elements(p_payload->'lines') loop
      target:=(line->>'item_id')::uuid; q:=private.decimal_field(line,'quantity',6);
      select dispatched_unit_cost into n from public.transfer_stock where document_id=doc.id and item_id=target and received_quantity+q<=quantity for update;
      if not found then raise exception using errcode='22023',message='Received quantity exceeds outstanding transfer'; end if;
      perform private.move_stock(doc,target,null,-q,'transfer_transit_received',n,true,false);
      perform private.move_stock(doc,target,doc.destination_location_id,q,'transfer_receipt',n,false,false);
      update public.transfer_stock set received_quantity=received_quantity+q where document_id=doc.id and item_id=target;
    end loop;
    if not exists(select 1 from public.transfer_stock where document_id=doc.id and received_quantity<quantity) then
      update public.inventory_documents set status='received',received_by=actor,received_at=now() where id=doc.id;
    end if;
    entity:=doc.id;
  end case;
  v_result:=coalesce(v_result,'{}')||jsonb_build_object('id',entity,'organization_id',p_organization_id);
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
    values(p_organization_id,actor,'inventory:'||p_command,'inventory',entity,p_request_id,
      jsonb_build_object('payload',p_payload,'result',v_result));
  update private.command_requests cr set result=v_result where cr.actor_id=actor and cr.scope_id=p_organization_id and cr.command='inventory:'||p_command and cr.request_id=p_request_id;
  return v_result;
end; $$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(uuid,text[]) to authenticated;
revoke all on function public.inventory_command(text,uuid,uuid,jsonb),public.current_recipe_cost(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_command(text,uuid,uuid,jsonb),public.current_recipe_cost(uuid,uuid) to authenticated;
commit;
