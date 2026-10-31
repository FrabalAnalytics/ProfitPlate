begin;
-- Count labels preserve the stock identity: one bottle/pack/roll is one counted stock unit.
-- No bottle-to-ml, pack-to-piece, or bag-to-kg factor is inferred.
alter table public.items add column stock_unit_label text
  check(stock_unit_label is null or (base_uom_code='each' and stock_unit_label in ('piece','bottle','pack','roll','can','bag','finger','portion','wrap')));
create function private.protect_stock_unit_label() returns trigger language plpgsql set search_path='' as $$
begin
  if new.stock_unit_label is distinct from old.stock_unit_label then
    raise exception using errcode='23514',message='Counted stock identity is immutable';
  end if;
  return new;
end; $$;
create trigger item_stock_unit_label_immutable before update on public.items for each row execute function private.protect_stock_unit_label();
revoke all on function private.protect_stock_unit_label() from public,anon,authenticated,service_role;

create table public.catalogue_imports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  source_name text not null check(length(source_name) between 1 and 160), source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  payload_hash bytea not null,
  initiated_by uuid references auth.users(id) on delete restrict,
  import_origin text not null check(import_origin in ('authenticated_user','database_maintenance')),
  database_session_role text not null,
  row_count integer not null check(row_count between 1 and 2000), inserted_count integer not null, matched_count integer not null,
  imported_at timestamptz not null default clock_timestamp(),
  check(inserted_count>=0 and matched_count>=0 and inserted_count+matched_count=row_count),
  check((import_origin='authenticated_user' and initiated_by is not null) or (import_origin='database_maintenance' and initiated_by is null)),
  unique(organization_id,source_sha256), unique(organization_id,id)
);
create table public.catalogue_import_rows (
  organization_id uuid not null, import_id uuid not null, source_row integer not null check(source_row>1),
  item_id uuid not null, source_sku text not null, source_unit text not null,
  reference_price numeric(24,8) check(reference_price>=0), reference_date date,
  reference_kind text not null check(reference_kind in ('purchase_reference','production_reference')),
  price_status text not null check(price_status in ('provided','missing','zero_unconfirmed')),
  source_values jsonb not null check(jsonb_typeof(source_values)='object'), created_item boolean not null,
  check(((price_status='provided' and reference_price>0) or (price_status='zero_unconfirmed' and reference_price=0) or (price_status='missing' and reference_price is null)) is true),
  primary key(import_id,source_row), unique(import_id,item_id),
  foreign key(organization_id,import_id) references public.catalogue_imports(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create index catalogue_price_lookup on public.catalogue_import_rows(organization_id,item_id,reference_date desc);
alter table public.catalogue_imports enable row level security;
alter table public.catalogue_import_rows enable row level security;
create policy tenant_read on public.catalogue_imports for select to authenticated using(private.has_role(organization_id));
create policy tenant_read on public.catalogue_import_rows for select to authenticated using(private.has_role(organization_id));
revoke all on public.catalogue_imports,public.catalogue_import_rows from public,anon,authenticated,service_role;
grant select on public.catalogue_imports,public.catalogue_import_rows to authenticated;
create trigger catalogue_imports_immutable before update or delete on public.catalogue_imports for each row execute function private.deny_changes();
create trigger catalogue_import_rows_immutable before update or delete on public.catalogue_import_rows for each row execute function private.deny_changes();

create function public.import_inventory_catalogue(p_organization_id uuid,p_source_name text,p_source_sha256 text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; origin text; batch uuid; saved public.catalogue_imports%rowtype; payload_hash bytea;
  row jsonb; item public.items%rowtype; v_sku text; v_name text; category text; unit text; label text;
  price numeric; status text; kind text; day date; inserted integer:=0; matched integer:=0; is_new boolean;
begin
  if auth.uid() is null and session_user in ('postgres','supabase_admin') and current_setting('role',true) in ('none','postgres','supabase_admin') then
    origin:='database_maintenance';
  else
    actor:=private.require_inventory_actor(); origin:='authenticated_user';
    if not private.can_operate(p_organization_id) then raise exception using errcode='42501',message='Inventory editing permission required'; end if;
  end if;
  if p_source_name is null or length(p_source_name) not between 1 and 160 or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 or octet_length(p_rows::text)>2097152 then
    raise exception using errcode='22023',message='Invalid catalogue import envelope';
  end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  if not found then raise exception using errcode='42501',message='Organization access denied'; end if;
  -- Recheck after the tenant lock: waiting operators cannot bypass a committed suspension.
  if actor is not null and not private.can_operate(p_organization_id) then raise exception using errcode='42501',message='Inventory editing permission required'; end if;
  payload_hash:=sha256(convert_to(p_rows::text,'UTF8'));
  select * into saved from public.catalogue_imports where organization_id=p_organization_id and source_sha256=p_source_sha256;
  if found then
    if saved.payload_hash<>payload_hash or saved.source_name<>p_source_name then raise exception using errcode='22023',message='Source identity reused with a different import'; end if;
    return jsonb_build_object('id',saved.id,'organization_id',p_organization_id,'inserted',saved.inserted_count,'matched',saved.matched_count,'rows',saved.row_count,'replayed',true);
  end if;
  -- Validate all rows and resolve existing identities before inserting any batch evidence.
  for row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(row) k where k not in
      ('source_row','sku','name','category','base_uom_code','stock_unit_label','source_unit','reference_price','price_status','reference_kind','reference_date','source_values')) then
      raise exception using errcode='22023',message='Unknown catalogue field';
    end if;
    v_sku:=private.require_text(row,'sku',64); v_name:=private.require_text(row,'name',160);
    category:=private.require_text(row,'category',20); unit:=private.require_text(row,'base_uom_code',8); label:=row->>'stock_unit_label';
    status:=private.require_text(row,'price_status',32); kind:=private.require_text(row,'reference_kind',32);
    if category not in ('raw_material','semi_finished','general') or not exists(select 1 from public.units_of_measure where code=unit)
      or (label is not null and (unit<>'each' or label not in ('piece','bottle','pack','roll','can','bag','finger','portion','wrap')))
      or kind<>(case when category='semi_finished' then 'production_reference' else 'purchase_reference' end) then
      raise exception using errcode='22023',message='Invalid catalogue classification or counted stock unit';
    end if;
    price:=case when row->>'reference_price' is not null then private.decimal_field(row,'reference_price',8,true) end;
    if ((status='provided' and price>0) or (status='zero_unconfirmed' and price=0) or (status='missing' and price is null)) is not true or status not in ('provided','zero_unconfirmed','missing') then
      raise exception using errcode='22023',message='Price status must preserve missing or unconfirmed zero values';
    end if;
    day:=(row->>'reference_date')::date;
    if day>(now() at time zone 'Africa/Lagos')::date then raise exception using errcode='22023',message='Future historical price date'; end if;
    perform private.require_text(row,'source_unit',32);
    if jsonb_typeof(row->'source_values') is distinct from 'object' or (row->>'source_row')::integer<=1 then raise exception using errcode='22023',message='Source row provenance required'; end if;
    select * into item from public.items where organization_id=p_organization_id and lower(public.items.sku)=lower(v_sku);
    if found then
      if item.name<>v_name or item.category<>category or item.base_uom_code<>unit or item.stock_unit_label is distinct from label then
        raise exception using errcode='22023',message='Existing SKU conflicts with the supplied identity';
      end if;
      matched:=matched+1;
    else
      if exists(select 1 from public.items where organization_id=p_organization_id and lower(public.items.name)=lower(v_name)) then raise exception using errcode='23505',message='Existing item name has a different SKU'; end if;
      inserted:=inserted+1;
    end if;
  end loop;
  insert into public.catalogue_imports(organization_id,source_name,source_sha256,payload_hash,initiated_by,import_origin,database_session_role,row_count,inserted_count,matched_count)
    values(p_organization_id,p_source_name,p_source_sha256,payload_hash,actor,origin,session_user,jsonb_array_length(p_rows),inserted,matched) returning id into batch;
  for row in select value from jsonb_array_elements(p_rows) loop
    select * into item from public.items where organization_id=p_organization_id and lower(public.items.sku)=lower(row->>'sku');
    is_new:=not found;
    if is_new then
      insert into public.items(organization_id,sku,name,category,base_uom_code,stock_unit_label)
        values(p_organization_id,row->>'sku',row->>'name',row->>'category',row->>'base_uom_code',row->>'stock_unit_label') returning * into item;
    end if;
    insert into public.catalogue_import_rows(organization_id,import_id,source_row,item_id,source_sku,source_unit,reference_price,reference_date,reference_kind,price_status,source_values,created_item)
      values(p_organization_id,batch,(row->>'source_row')::integer,item.id,row->>'sku',row->>'source_unit',(row->>'reference_price')::numeric,(row->>'reference_date')::date,row->>'reference_kind',row->>'price_status',row->'source_values',is_new);
  end loop;
  if actor is not null then
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
      values(p_organization_id,actor,'catalogue_import','catalogue_import',batch,batch,jsonb_build_object('source_name',p_source_name,'source_sha256',p_source_sha256,'inserted',inserted,'matched',matched));
  end if;
  return jsonb_build_object('id',batch,'organization_id',p_organization_id,'inserted',inserted,'matched',matched,'rows',jsonb_array_length(p_rows),'replayed',false);
end; $$;
revoke all on function public.import_inventory_catalogue(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.import_inventory_catalogue(uuid,text,text,jsonb) to authenticated;

create or replace view public.inventory_item_view with(security_invoker=true) as
  select i.id,i.organization_id,i.sku,i.name,i.category,i.base_uom_code,i.is_active,
    coalesce(purchase.unit_cost::text,case when reference.reference_kind='purchase_reference' and reference.price_status='provided' then reference.reference_price::text end) as last_purchase_unit_cost,
    coalesce(purchase.event_date,case when reference.reference_kind='purchase_reference' then reference.reference_date end) as last_purchase_date,
    case when purchase.document_id is not null then 'posted_receipt' when reference.reference_kind='purchase_reference' then 'imported_reference' end as last_purchase_source,
    reference.price_status as imported_price_status, reference.reference_kind as imported_reference_kind,
    reference.reference_price::text as imported_reference_price,
    coalesce(i.stock_unit_label,i.base_uom_code) as display_unit
  from public.items i
  left join lateral (
    select l.unit_cost,d.event_date,d.id as document_id from public.inventory_document_lines l
    join public.inventory_documents d on d.id=l.document_id and d.organization_id=l.organization_id
    where l.organization_id=i.organization_id and l.item_id=i.id and d.kind='receipt' and d.status='posted'
    order by d.event_date desc,d.posted_at desc,d.id desc limit 1
  ) purchase on true
  left join lateral (
    select r.* from public.catalogue_import_rows r join public.catalogue_imports b on b.id=r.import_id and b.organization_id=r.organization_id
    where r.organization_id=i.organization_id and r.item_id=i.id order by r.reference_date desc nulls last,b.imported_at desc,b.id desc limit 1
  ) reference on true;
create or replace view public.inventory_balance_view with(security_invoker=true) as
  select b.organization_id,b.location_id,l.name as location_name,b.item_id,i.name as item_name,i.sku,i.category,i.base_uom_code,
    b.quantity::text as quantity,s.average_cost::text as average_cost,
    case when s.average_cost is not null then round(b.quantity*s.average_cost,8)::text end as current_value,
    i.last_purchase_unit_cost,i.last_purchase_date,i.last_purchase_source,i.imported_price_status,i.display_unit
  from public.stock_balances b join public.inventory_item_view i on i.id=b.item_id and i.organization_id=b.organization_id
  join public.locations l on l.id=b.location_id
  left join public.stock_cost_state s on s.organization_id=b.organization_id and s.item_id=b.item_id;
create or replace view public.inventory_movement_view with(security_invoker=true) as
  select m.id,m.organization_id,m.document_id,m.item_id,i.sku,i.name as item_name,i.base_uom_code,
    m.location_id,l.name as location_name,m.bucket,m.movement,m.quantity::text as quantity,
    m.unit_cost::text as unit_cost,m.value::text as value,m.event_date,m.posted_at,m.actor_id,
    coalesce(i.stock_unit_label,i.base_uom_code) as display_unit
  from public.inventory_movements m join public.items i on i.id=m.item_id left join public.locations l on l.id=m.location_id;
create or replace function public.inventory_document_preview(p_organization_id uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.inventory_documents%rowtype; rows jsonb;
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  select * into d from public.inventory_documents where organization_id=p_organization_id and id=p_document_id;
  if not found then raise exception using errcode='22023',message='Document not found'; end if;
  if d.kind='production' then
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',coalesce(i.stock_unit_label,i.base_uom_code),
      'quantity',(l.quantity*d.planned_output/v.standard_output)::text,'unit_cost',s.average_cost::text,'location',loc.name)) into rows
      from public.recipe_ingredients l join public.recipe_versions v on v.id=l.version_id join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=l.organization_id and s.item_id=l.item_id
      left join public.locations loc on loc.id=d.source_location_id where l.version_id=d.recipe_version_id;
  elsif d.kind='sales' then
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',coalesce(i.stock_unit_label,i.base_uom_code),
      'quantity',(l.quantity*r.quantity/v.standard_output)::text,'unit_cost',s.average_cost::text,'location',loc.name)) into rows
      from public.sales_import_rows r join public.recipe_versions v on v.id=r.recipe_version_id
      join public.recipe_ingredients l on l.version_id=v.id join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=r.organization_id and s.item_id=l.item_id
      join public.locations loc on loc.id=r.location_id where r.document_id=d.id;
  else
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',coalesce(i.stock_unit_label,i.base_uom_code),'quantity',l.quantity::text,
      'unit_cost',coalesce(l.unit_cost,s.average_cost)::text,'location',loc.name)) into rows
      from public.inventory_document_lines l join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=l.organization_id and s.item_id=l.item_id
      left join public.locations loc on loc.id=coalesce(d.source_location_id,d.destination_location_id) where l.document_id=d.id;
  end if;
  return jsonb_build_object('id',d.id,'lines',coalesce(rows,'[]'::jsonb));
end; $$;
notify pgrst,'reload schema';
commit;
