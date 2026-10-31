begin;
-- Purchasing is an explicit duty. An Operations Manager appointment grants review/approval,
-- not permission to raise orders or maintain procurement masters.
create or replace function private.can_purchase(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_role(p_org,array['procurement_officer']);
$$;
create or replace function private.can_read_vendors(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.can_purchase(p_org) or private.is_manager(p_org)
 or private.has_role(p_org,array['owner','inventory_manager','accountant']);
$$;
-- Keep manager cancellation authority distinct from creating/submitting an order.
do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('private.authorize_business(uuid,text,jsonb)'::regprocedure) into definition;
 fragment:='''create_purchase_order'',''submit_purchase_order'',''cancel_purchase_order''';
 if position(fragment in definition)=0 then raise exception 'Unexpected purchasing authorization definition';end if;
 definition:=replace(definition,fragment,'''create_purchase_order'',''submit_purchase_order''');
 fragment:='elsif p_command in (''approve_purchase_order'',''reject_purchase_order'',''approve_requisition'',''reject_requisition'') then';
 if position(fragment in definition)=0 then raise exception 'Unexpected manager approval authorization definition';end if;
 definition:=replace(definition,fragment,
 'elsif p_command=''cancel_purchase_order'' then
 if not (private.can_purchase(p_org) or private.is_manager(p_org)) then raise exception using errcode=''42501'',message=''Procurement or Operations cancellation authority required'';end if;
 '||fragment);
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
