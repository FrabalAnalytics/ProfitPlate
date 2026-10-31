begin;
-- Exact decimal strings at the API boundary; no money/quantity round-tripping through JS numbers.
create view public.inventory_balance_view with(security_invoker=true) as
  select b.organization_id,b.location_id,l.name as location_name,b.item_id,i.name as item_name,i.sku,i.category,i.base_uom_code,
    b.quantity::text as quantity,s.average_cost::text as average_cost,
    case when s.average_cost is not null then round(b.quantity*s.average_cost,8)::text end as current_value
  from public.stock_balances b join public.items i on i.id=b.item_id join public.locations l on l.id=b.location_id
  left join public.stock_cost_state s on s.organization_id=b.organization_id and s.item_id=b.item_id;
create view public.inventory_movement_view with(security_invoker=true) as
  select m.id,m.organization_id,m.document_id,m.item_id,i.sku,i.name as item_name,i.base_uom_code,
    m.location_id,l.name as location_name,m.bucket,m.movement,m.quantity::text as quantity,
    m.unit_cost::text as unit_cost,m.value::text as value,m.event_date,m.posted_at,m.actor_id
  from public.inventory_movements m join public.items i on i.id=m.item_id left join public.locations l on l.id=m.location_id;
revoke all on public.inventory_balance_view,public.inventory_movement_view from public,anon,authenticated,service_role;
grant select on public.inventory_balance_view,public.inventory_movement_view to authenticated;

create function private.protect_item_category() returns trigger language plpgsql set search_path='' as $$
begin
  if new.category<>old.category then raise exception using errcode='23514',message='Item category is immutable; create a replacement item'; end if;
  return new;
end; $$;
create trigger item_category_immutable before update on public.items for each row execute function private.protect_item_category();
revoke all on function private.protect_item_category() from public,anon,authenticated,service_role;
create function public.inventory_team_options(p_organization_id uuid)
returns table(user_id uuid,email text,member_role text,manager_role text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id,array['owner','admin']) then raise exception using errcode='42501',message='Team administration required'; end if;
  return query select m.user_id,u.email::text,m.role,o.manager_role from public.organization_memberships m
    join auth.users u on u.id=m.user_id left join public.operational_managers o on o.organization_id=m.organization_id and o.user_id=m.user_id
    where m.organization_id=p_organization_id and m.status='active' and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) order by u.email;
end; $$;
revoke all on function public.inventory_team_options(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_team_options(uuid) to authenticated;
create function public.inventory_document_preview(p_organization_id uuid,p_document_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.inventory_documents%rowtype; rows jsonb;
begin
  perform private.require_inventory_actor();
  if not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied'; end if;
  select * into d from public.inventory_documents where organization_id=p_organization_id and id=p_document_id;
  if not found then raise exception using errcode='22023',message='Document not found'; end if;
  if d.kind='production' then
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',i.base_uom_code,
      'quantity',(l.quantity*d.planned_output/v.standard_output)::text,'unit_cost',s.average_cost::text,'location',loc.name)) into rows
      from public.recipe_ingredients l join public.recipe_versions v on v.id=l.version_id join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=l.organization_id and s.item_id=l.item_id
      left join public.locations loc on loc.id=d.source_location_id where l.version_id=d.recipe_version_id;
  elsif d.kind='sales' then
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',i.base_uom_code,
      'quantity',(l.quantity*r.quantity/v.standard_output)::text,'unit_cost',s.average_cost::text,'location',loc.name)) into rows
      from public.sales_import_rows r join public.recipe_versions v on v.id=r.recipe_version_id
      join public.recipe_ingredients l on l.version_id=v.id join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=r.organization_id and s.item_id=l.item_id
      join public.locations loc on loc.id=r.location_id where r.document_id=d.id;
  else
    select jsonb_agg(jsonb_build_object('item',i.name,'unit',i.base_uom_code,'quantity',l.quantity::text,
      'unit_cost',coalesce(l.unit_cost,s.average_cost)::text,'location',loc.name)) into rows
      from public.inventory_document_lines l join public.items i on i.id=l.item_id
      left join public.stock_cost_state s on s.organization_id=l.organization_id and s.item_id=l.item_id
      left join public.locations loc on loc.id=coalesce(d.source_location_id,d.destination_location_id) where l.document_id=d.id;
  end if;
  return jsonb_build_object('id',d.id,'lines',coalesce(rows,'[]'::jsonb));
end; $$;
revoke all on function public.inventory_document_preview(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_document_preview(uuid,uuid) to authenticated;
commit;
