begin;
alter table public.organization_memberships drop constraint organization_memberships_role_check;
alter table public.organization_memberships add constraint organization_memberships_role_check
  check(role in ('owner','admin','inventory_manager','procurement_officer','kitchen_lead','bar_lead','accountant','viewer'));
alter table public.organization_invitations drop constraint organization_invitations_proposed_role_check;
alter table public.organization_invitations add constraint organization_invitations_proposed_role_check
  check(proposed_role in ('admin','inventory_manager','procurement_officer','kitchen_lead','bar_lead','accountant','viewer'));

create table public.vendors (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'), name text not null check(length(name) between 1 and 160),
  contact_name text check(length(contact_name)<=160), email text check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone text check(length(phone)<=60), address text check(length(address)<=500),
  is_active boolean not null default true, created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,code), unique(organization_id,id)
);
create table public.vendor_items (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,vendor_id uuid not null,item_id uuid not null,
  vendor_sku text check(length(vendor_sku)<=100), purchase_unit text not null check(length(purchase_unit) between 1 and 60),
  base_quantity numeric(24,6) not null check(base_quantity>0), quoted_price numeric(24,8) check(quoted_price>=0),
  conversion_note text not null check(length(conversion_note) between 1 and 500), is_active boolean not null default true,
  updated_at timestamptz not null default now(), unique(organization_id,id), unique(organization_id,vendor_id,item_id),
  foreign key(organization_id,vendor_id) references public.vendors(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),name text not null check(length(name) between 1 and 160),
  recipe_id uuid not null,default_area text not null check(default_area in ('kitchen','bar')),
  is_active boolean not null default true,created_at timestamptz not null default now(),
  unique(organization_id,id),unique(organization_id,code),
  foreign key(organization_id,recipe_id) references public.recipes(organization_id,id) on delete restrict
);

create function private.can_purchase(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role(p_org,array['owner','admin','procurement_officer','inventory_manager']) or private.is_manager(p_org);
$$;
create function private.can_read_vendors(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.can_purchase(p_org) or private.has_role(p_org,array['accountant']);
$$;
alter table public.vendors enable row level security;
alter table public.vendor_items enable row level security;
alter table public.menu_items enable row level security;
create policy vendor_read on public.vendors for select to authenticated using(private.can_read_vendors(organization_id));
create policy vendor_item_read on public.vendor_items for select to authenticated using(private.can_read_vendors(organization_id));
create policy menu_read on public.menu_items for select to authenticated using(private.has_role(organization_id));
revoke all on public.vendors,public.vendor_items,public.menu_items from public,anon,authenticated,service_role;
grant select on public.vendors,public.vendor_items,public.menu_items to authenticated;
create trigger vendors_protect before update or delete on public.vendors for each row execute function private.protect_record();
create trigger vendor_items_protect before update or delete on public.vendor_items for each row execute function private.protect_record();
create trigger menu_items_protect before update or delete on public.menu_items for each row execute function private.protect_record();

create view public.vendor_item_master with(security_invoker=true) as
  select vi.id,vi.organization_id,vi.vendor_id,v.name as vendor_name,v.code as vendor_code,vi.item_id,i.sku,i.name as item_name,
    coalesce(i.stock_unit_label,i.base_uom_code) as base_unit,vi.vendor_sku,vi.purchase_unit,
    vi.base_quantity::text as base_quantity,vi.quoted_price::text as quoted_price,vi.conversion_note,vi.is_active
  from public.vendor_items vi join public.vendors v on v.id=vi.vendor_id join public.items i on i.id=vi.item_id;
create view public.final_recipe_master with(security_invoker=true) as
  select r.id,r.organization_id,r.code,r.name,v.id as version_id,v.revision,v.standard_output::text as standard_output,v.created_at
  from public.recipes r join lateral(select * from public.recipe_versions where recipe_id=r.id order by revision desc limit 1) v on true where r.kind='final';
create view public.sub_recipe_master with(security_invoker=true) as
  select r.id,r.organization_id,r.code,r.name,r.output_item_id,i.sku as output_sku,
    coalesce(i.stock_unit_label,i.base_uom_code) as output_unit,v.id as version_id,v.revision,v.standard_output::text as standard_output,v.created_at
  from public.recipes r join public.items i on i.id=r.output_item_id join lateral(select * from public.recipe_versions where recipe_id=r.id order by revision desc limit 1) v on true where r.kind='sub_recipe';
revoke all on public.vendor_item_master,public.final_recipe_master,public.sub_recipe_master from public,anon,authenticated,service_role;
grant select on public.vendor_item_master,public.final_recipe_master,public.sub_recipe_master to authenticated;

create function public.team_directory(p_organization_id uuid)
returns table(user_id uuid,email text,member_role text,member_status text,manager_role text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id,array['owner','admin']) then raise exception using errcode='42501',message='Team administration required'; end if;
  return query select m.user_id,case when u.deleted_at is null then u.email::text end,m.role,m.status,o.manager_role
    from public.organization_memberships m join auth.users u on u.id=m.user_id
    left join public.operational_managers o on o.organization_id=m.organization_id and o.user_id=m.user_id
    where m.organization_id=p_organization_id order by m.created_at,m.id;
end; $$;
create function public.operating_people(p_organization_id uuid) returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  return query select m.user_id,coalesce(nullif(split_part(u.email,'@',1),''),'Team member')::text
    from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and u.deleted_at is null;
end; $$;

-- Manual delivery only. The caller receives a credential once; it is never persisted in plaintext.
create function public.issue_manual_invitation(p_organization_id uuid,p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor(); inv public.organization_invitations%rowtype; token text;
begin
  perform 1 from public.organizations where id=p_organization_id for update;
  if not private.has_role(p_organization_id,array['owner','admin']) then raise exception using errcode='42501',message='Team administration required'; end if;
  select * into inv from public.organization_invitations where organization_id=p_organization_id and id=p_invitation_id for update;
  if not found or inv.status<>'pending' or inv.expires_at<=now() or inv.invited_by<>actor then raise exception using errcode='22023',message='Resend the invitation before generating a fresh manual code'; end if;
  if exists(select 1 from private.invitation_secrets where invitation_id=inv.id and token_hash is not null) then raise exception using errcode='22023',message='A code has already been issued; resend to replace it'; end if;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  update private.invitation_secrets set token_hash=sha256(convert_to(token,'UTF8')) where invitation_id=inv.id;
  -- Suppress automatic delivery; no email is sent or marked as delivered.
  update private.invitation_deliveries set state='cancelled',lease_id=null,lease_until=null,last_error_code=null,updated_at=now() where invitation_id=inv.id;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
    values(p_organization_id,actor,'issue_manual_invitation','invitation',inv.id,gen_random_uuid(),jsonb_build_object('method','manual'));
  return jsonb_build_object('code',p_organization_id::text||'.'||inv.id::text||'.'||token,'expires_at',inv.expires_at);
end; $$;

-- Whitelisted envelopes are shared by the master and purchasing implementations.
create function private.business_fields(p_command text) returns text[] language sql immutable set search_path='' as $$
  select case p_command
    when 'save_vendor' then array['id','code','name','contact_name','email','phone','address','is_active']
    when 'save_vendor_item' then array['id','vendor_id','item_id','vendor_sku','purchase_unit','base_quantity','quoted_price','conversion_note','is_active']
    when 'save_menu_item' then array['id','code','name','recipe_id','default_area','is_active']
    when 'create_purchase_order' then array['vendor_id','reason','expected_date','lines']
    when 'submit_purchase_order' then array['id']
    when 'approve_purchase_order' then array['id']
    when 'reject_purchase_order' then array['id','reason']
    when 'cancel_purchase_order' then array['id','reason']
    when 'create_purchase_receipt' then array['id','event_date','location_id','reason','lines']
    when 'create_requisition' then array['destination_location_id','reason','lines']
    when 'submit_requisition' then array['id']
    when 'approve_requisition' then array['id']
    when 'reject_requisition' then array['id','reason']
    when 'close_requisition' then array['id','reason']
    when 'fulfil_requisition' then array['id','event_date','reason','lines']
    when 'create_sales_draft' then array['source_system','event_date','reason','lines']
    else null end;
$$;
create function private.authorize_business(p_org uuid,p_command text,p_payload jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_command in ('save_vendor','save_vendor_item','create_purchase_order','submit_purchase_order','cancel_purchase_order') then
    if not private.can_purchase(p_org) then raise exception using errcode='42501',message='Purchasing permission required'; end if;
  elsif p_command in ('approve_purchase_order','reject_purchase_order','approve_requisition','reject_requisition') then
    if not private.is_manager(p_org) then raise exception using errcode='42501',message='Operations Manager or General Manager required'; end if;
  elsif p_command='save_menu_item' then
    if not (private.can_operate(p_org) or private.has_role(p_org,array['kitchen_lead','bar_lead'])) then raise exception using errcode='42501',message='Recipe management permission required'; end if;
  elsif p_command in ('create_purchase_receipt','fulfil_requisition','create_sales_draft') then
    if not private.can_operate(p_org) then raise exception using errcode='42501',message='Inventory operator required'; end if;
  elsif p_command='create_requisition' then
    if not private.can_operate(p_org,(p_payload->>'destination_location_id')::uuid) then raise exception using errcode='42501',message='Department operating permission required'; end if;
  elsif p_command in ('submit_requisition','close_requisition') then
    if not (private.has_role(p_org,array['owner','admin','inventory_manager','kitchen_lead','bar_lead']) or private.is_manager(p_org)) then raise exception using errcode='42501',message='Operating permission required'; end if;
  else raise exception using errcode='22023',message='Unknown business command'; end if;
end; $$;

create function private.master_mutation(p_org uuid,p_command text,p_payload jsonb,p_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare entity uuid:=(p_payload->>'id')::uuid; active boolean:=true; cost numeric; target uuid;
begin
  if p_payload ? 'is_active' then
    if jsonb_typeof(p_payload->'is_active') is distinct from 'boolean' then raise exception using errcode='22023',message='is_active must be boolean'; end if;
    active:=(p_payload->>'is_active')::boolean;
  end if;
  if p_command='save_vendor' then
    if entity is null then
      insert into public.vendors(organization_id,code,name,contact_name,email,phone,address,is_active,created_by)
        values(p_org,upper(private.require_text(p_payload,'code',32)),private.require_text(p_payload,'name',160),nullif(p_payload->>'contact_name',''),nullif(p_payload->>'email',''),nullif(p_payload->>'phone',''),nullif(p_payload->>'address',''),active,p_actor) returning id into entity;
    else
      update public.vendors set code=upper(private.require_text(p_payload,'code',32)),name=private.require_text(p_payload,'name',160),contact_name=nullif(p_payload->>'contact_name',''),email=nullif(p_payload->>'email',''),phone=nullif(p_payload->>'phone',''),address=nullif(p_payload->>'address',''),is_active=active,updated_at=now() where organization_id=p_org and id=entity;
      if not found then raise exception using errcode='22023',message='Vendor not found'; end if;
    end if;
  elsif p_command='save_vendor_item' then
    if not exists(select 1 from public.vendors where organization_id=p_org and id=(p_payload->>'vendor_id')::uuid and is_active)
      or not exists(select 1 from public.items where organization_id=p_org and id=(p_payload->>'item_id')::uuid and is_active and category<>'semi_finished') then raise exception using errcode='22023',message='Active vendor and purchased stock item required'; end if;
    cost:=case when nullif(p_payload->>'quoted_price','') is not null then private.decimal_field(p_payload,'quoted_price',8,true) end;
    if entity is null then
      insert into public.vendor_items(organization_id,vendor_id,item_id,vendor_sku,purchase_unit,base_quantity,quoted_price,conversion_note,is_active)
        values(p_org,(p_payload->>'vendor_id')::uuid,(p_payload->>'item_id')::uuid,nullif(p_payload->>'vendor_sku',''),private.require_text(p_payload,'purchase_unit',60),private.decimal_field(p_payload,'base_quantity',6),cost,private.require_text(p_payload,'conversion_note',500),active) returning id into entity;
    else
      update public.vendor_items set vendor_sku=nullif(p_payload->>'vendor_sku',''),purchase_unit=private.require_text(p_payload,'purchase_unit',60),base_quantity=private.decimal_field(p_payload,'base_quantity',6),quoted_price=cost,conversion_note=private.require_text(p_payload,'conversion_note',500),is_active=active,updated_at=now()
        where organization_id=p_org and id=entity and vendor_id=(p_payload->>'vendor_id')::uuid and item_id=(p_payload->>'item_id')::uuid;
      if not found then raise exception using errcode='22023',message='Vendor/item identity cannot be reassigned'; end if;
    end if;
  else
    if not exists(select 1 from public.recipes where organization_id=p_org and id=(p_payload->>'recipe_id')::uuid and kind='final') then raise exception using errcode='22023',message='A final recipe is required'; end if;
    if entity is null then
      insert into public.menu_items(organization_id,code,name,recipe_id,default_area,is_active) values(p_org,upper(private.require_text(p_payload,'code',64)),private.require_text(p_payload,'name',160),(p_payload->>'recipe_id')::uuid,private.require_text(p_payload,'default_area',10),active) returning id into entity;
    else
      update public.menu_items set code=upper(private.require_text(p_payload,'code',64)),name=private.require_text(p_payload,'name',160),recipe_id=(p_payload->>'recipe_id')::uuid,default_area=private.require_text(p_payload,'default_area',10),is_active=active where organization_id=p_org and id=entity;
      if not found then raise exception using errcode='22023',message='Menu item not found'; end if;
    end if;
  end if;
  return entity;
end; $$;

create function public.business_command(p_command text,p_request_id uuid,p_organization_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor(); allowed text[]:=private.business_fields(p_command); saved private.command_requests%rowtype;
  digest bytea; v_result jsonb; entity uuid;
begin
  if allowed is null or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144
    or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Invalid business command envelope'; end if;
  perform 1 from public.organizations where id=p_organization_id for update;
  if not found or not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  perform private.authorize_business(p_organization_id,p_command,p_payload);
  digest:=sha256(convert_to(p_payload::text,'UTF8'));
  insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash) values(actor,p_organization_id,'business:'||p_command,p_request_id,digest) on conflict do nothing;
  select * into saved from private.command_requests where actor_id=actor and scope_id=p_organization_id and command='business:'||p_command and request_id=p_request_id for update;
  if saved.payload_hash<>digest then raise exception using errcode='22023',message='Request key reused with different payload'; end if;
  if saved.result is not null then return saved.result; end if;
  if p_command in ('save_vendor','save_vendor_item','save_menu_item') then
    entity:=private.master_mutation(p_organization_id,p_command,p_payload,actor);
    v_result:=jsonb_build_object('id',entity,'organization_id',p_organization_id);
  else
    v_result:=private.purchasing_mutation(p_organization_id,p_command,p_payload,p_request_id,actor);
    entity:=(v_result->>'id')::uuid;
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
    values(p_organization_id,actor,'business:'||p_command,'business',entity,p_request_id,
      case when p_command='save_vendor' then jsonb_build_object('code',p_payload->>'code','name',p_payload->>'name','is_active',p_payload->'is_active') else jsonb_build_object('payload',p_payload,'result',v_result) end);
  update private.command_requests cr set result=v_result where cr.actor_id=actor and cr.scope_id=p_organization_id and cr.command='business:'||p_command and cr.request_id=p_request_id;
  return v_result;
end; $$;
-- Explicit label permits qualified PL/pgSQL locals in SQL statements.
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(uuid,text[]),private.can_read_vendors(uuid) to authenticated;
revoke all on function public.business_command(text,uuid,uuid,jsonb),public.team_directory(uuid),public.issue_manual_invitation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.business_command(text,uuid,uuid,jsonb),public.team_directory(uuid),public.issue_manual_invitation(uuid,uuid) to authenticated;
revoke all on function public.operating_people(uuid) from public,anon,authenticated,service_role;
grant execute on function public.operating_people(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
