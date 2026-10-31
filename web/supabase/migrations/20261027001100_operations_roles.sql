begin;
-- Preserve existing appointments and audit history while retiring the GM designation.
insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
 select organization_id,null,'migrate_general_manager','operational_manager',user_id,gen_random_uuid(),
 jsonb_build_object('from','general_manager','to','operations_manager') from public.operational_managers where manager_role='general_manager';
update public.operational_managers set manager_role='operations_manager' where manager_role='general_manager';
alter table public.operational_managers drop constraint operational_managers_manager_role_check;
alter table public.operational_managers add constraint operational_managers_manager_role_check check(manager_role='operations_manager');

create table public.additional_role_assignments (
 organization_id uuid not null,user_id uuid not null,role text not null check(role in ('inventory_manager','procurement_officer','accountant')),
 assigned_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(organization_id,user_id,role),
 foreign key(organization_id,user_id) references public.organization_memberships(organization_id,user_id) on delete restrict
);
alter table public.additional_role_assignments enable row level security;
revoke all on public.additional_role_assignments from public,anon,authenticated,service_role;
grant select on public.additional_role_assignments to authenticated;
create policy tenant_read on public.additional_role_assignments for select to authenticated using(private.has_role(organization_id) and (user_id=auth.uid() or private.has_role(organization_id,array['owner','admin'])));

create or replace function private.has_role(p_org uuid,p_roles text[] default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active'
 and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and (p_roles is null or m.role=any(p_roles) or exists(select 1 from public.additional_role_assignments a
 where a.organization_id=m.organization_id and a.user_id=m.user_id and a.role=any(p_roles))));
$$;
create or replace function private.is_manager(p_org uuid,p_general_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_role(p_org) and exists(select 1 from public.operational_managers where organization_id=p_org and user_id=auth.uid() and manager_role='operations_manager');
$$;
create or replace function private.can_operate(p_org uuid,p_location uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_role(p_org,array['inventory_manager']) or private.is_manager(p_org)
 or exists(select 1 from public.operating_areas a where a.organization_id=p_org and a.location_id=p_location
 and ((a.area='kitchen' and private.has_role(p_org,array['kitchen_lead'])) or (a.area='bar' and private.has_role(p_org,array['bar_lead']))));
$$;
create or replace function private.can_purchase(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(p_org,array['procurement_officer']) or private.is_manager(p_org);
$$;
create or replace function private.can_read_vendors(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_purchase(p_org) or private.has_role(p_org,array['owner','inventory_manager','accountant']);
$$;
create or replace function private.department_location_read(p_org uuid,p_location uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_role(p_org) and (private.is_manager(p_org) or private.has_role(p_org,array['owner','inventory_manager','procurement_officer','accountant','viewer'])
 or exists(select 1 from public.operating_areas a where a.organization_id=p_org and a.location_id=p_location
 and ((a.area='kitchen' and private.has_role(p_org,array['kitchen_lead'])) or (a.area='bar' and private.has_role(p_org,array['bar_lead'])))));
$$;
create function private.can_finance(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(p_org,array['owner','accountant']) or private.is_manager(p_org);
$$;
-- Administrator remains a setup role; an additional duty must be explicitly assigned by the owner.
drop policy tenant_read on public.stock_cost_state;
create policy tenant_read on public.stock_cost_state for select to authenticated using(private.department_location_read(organization_id,null));

do $$ declare definition text; begin
 select pg_get_functiondef('public.inventory_command(text,uuid,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'Operations Manager or General Manager required','Operations Manager required');
 definition:=replace(definition,'Only the General Manager can reopen a period','Only an Operations Manager can reopen a period');
 definition:=replace(definition,'textval not in (''operations_manager'',''general_manager'')','textval <> ''operations_manager''');
 execute definition;
 select pg_get_functiondef('private.authorize_business(uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'Operations Manager or General Manager required','Operations Manager required');
 execute definition;
end $$;
-- Item/recipe setup is allowed to an administrator, without granting stock posting.
do $$ declare definition text;begin
 select pg_get_functiondef('public.inventory_command(text,uuid,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'private.has_role(p_organization_id,array[''kitchen_lead''])','private.has_role(p_organization_id,array[''owner'',''admin'',''kitchen_lead''])');
 execute definition;
end $$;
revoke all on function private.can_finance(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_finance(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
