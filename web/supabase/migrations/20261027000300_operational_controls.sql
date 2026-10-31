-- Additive operational controls. Existing accounts, locations and item IDs are preserved.
begin;

alter table public.items add column category text not null default 'raw_material'
  check(category in ('raw_material','semi_finished','general'));

create table public.operational_managers (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null,
  manager_role text not null check(manager_role in ('operations_manager','general_manager')),
  primary key(organization_id,user_id),
  foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete restrict
);
create table public.operating_areas (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  area text not null check(area in ('main_store','kitchen','bar')),
  location_id uuid not null,
  primary key(organization_id,area), unique(organization_id,location_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete restrict
);
create table public.inventory_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  starts_on date not null, ends_on date not null, is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  check(starts_on<=ends_on), unique(organization_id,id)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  name text not null check(length(name) between 1 and 160),
  kind text not null check(kind in ('final','sub_recipe')),
  output_item_id uuid,
  check((kind='final' and output_item_id is null) or (kind='sub_recipe' and output_item_id is not null)),
  unique(organization_id,code), unique(organization_id,output_item_id), unique(organization_id,id),
  foreign key(organization_id,output_item_id) references public.items(organization_id,id) on delete restrict
);
create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  recipe_id uuid not null, revision integer not null check(revision>0),
  standard_output numeric(24,6) not null check(standard_output>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(organization_id,id), unique(recipe_id,revision),
  foreign key(organization_id,recipe_id) references public.recipes(organization_id,id) on delete restrict
);
create table public.recipe_ingredients (
  organization_id uuid not null, version_id uuid not null, item_id uuid not null,
  quantity numeric(24,6) not null check(quantity>0),
  primary key(version_id,item_id),
  foreign key(organization_id,version_id) references public.recipe_versions(organization_id,id) on delete restrict,
  foreign key(organization_id,item_id) references public.items(organization_id,id) on delete restrict
);

create function private.is_manager(p_org uuid, p_general_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select private.has_role(p_org) and exists(select 1 from public.operational_managers
    where organization_id=p_org and user_id=auth.uid()
      and (not p_general_only or manager_role='general_manager'));
$$;
create function private.require_inventory_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_actor();
begin
  if not exists(select 1 from auth.users where id=actor and deleted_at is null and (banned_until is null or banned_until<=now())) then
    raise exception using errcode='42501',message='Active verified account required';
  end if;
  return actor;
end; $$;
create function private.can_operate(p_org uuid,p_location uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_manager(p_org) or private.has_role(p_org,array['owner','admin','inventory_manager'])
    or exists(select 1 from public.operating_areas a join public.organization_memberships m on m.organization_id=a.organization_id
      where a.organization_id=p_org and a.location_id=p_location and m.user_id=auth.uid() and m.status='active'
        and ((a.area='kitchen' and m.role='kitchen_lead') or (a.area='bar' and m.role='bar_lead')));
$$;
create function private.decimal_field(p_data jsonb,p_key text,p_scale integer,p_zero boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare v text:=p_data->>p_key; n numeric;
begin
  if jsonb_typeof(p_data->p_key) is distinct from 'string' or v is null
    or length(v)>36 or v !~ '^[0-9]+(\.[0-9]+)?$'
    or (position('.' in v)>0 and length(split_part(v,'.',2))>p_scale) then
    raise exception using errcode='22023',message='Use a plain decimal string with supported precision';
  end if;
  n:=v::numeric;
  if n>1000000000000 or n<0 or (not p_zero and n=0) then
    raise exception using errcode='22023',message='Quantity or cost outside supported range';
  end if;
  return n;
end; $$;

-- No ordinary API writes. Operational functions lock the organization first.
do $$ declare t text; begin
  foreach t in array array['operational_managers','operating_areas','inventory_periods','recipes','recipe_versions','recipe_ingredients'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.has_role(organization_id))',t);
  end loop;
end $$;
create function private.deny_changes() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='Posted evidence and recipe versions are immutable'; end; $$;
create trigger recipe_versions_immutable before update or delete on public.recipe_versions for each row execute function private.deny_changes();
create trigger recipe_ingredients_immutable before update or delete on public.recipe_ingredients for each row execute function private.deny_changes();
revoke all on all functions in schema private from public,anon,authenticated,service_role;
-- SELECT policies require this specific helper; keep private schema inaccessible directly.
grant execute on function private.has_role(uuid,text[]) to authenticated;
commit;
