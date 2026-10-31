begin;
-- PO approval authorizes price/quantity. Store acceptance executes the delivery without
-- a second approval; keep the receiver and original PO approval as distinct evidence.
alter table public.inventory_documents add column posting_basis text not null default 'independent_manager'
 check(posting_basis in ('independent_manager','approved_purchase_order'));

create function private.accept_purchase_receipt(p_org uuid,p_document uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare doc public.inventory_documents%rowtype; po public.purchase_orders%rowtype;
begin
 if p_actor is distinct from private.require_inventory_actor() or not private.can_operate(p_org) then raise exception using errcode='42501',message='Inventory receiving permission required';end if;
 select * into doc from public.inventory_documents where organization_id=p_org and id=p_document for update;
 if not found or doc.kind<>'receipt' or doc.created_by<>p_actor then raise exception using errcode='42501',message='Only the recorded receiving operator may accept this delivery';end if;
 select p.* into po from public.purchase_orders p join public.purchase_receipts r on r.organization_id=p.organization_id and r.order_id=p.id where r.organization_id=p_org and r.document_id=doc.id for update of p;
 if not found or po.created_by=p_actor then raise exception using errcode='42501',message='A different receiving operator must confirm this order';end if;
 if doc.status='posted' then return;end if;
 if doc.status not in ('draft','submitted') or po.status<>'approved' then raise exception using errcode='22023',message='An approved order and unposted receiving record are required';end if;
 perform private.post_inventory_document(doc);
 -- No invented second approver: the posted receipt explicitly references approved PO authority.
 update public.inventory_documents set status='posted',posting_basis='approved_purchase_order',
 approved_by=null,received_by=p_actor,received_at=clock_timestamp(),posted_at=clock_timestamp() where id=doc.id;
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
 values(p_org,p_actor,'purchase_receipt_accepted','inventory_document',doc.id,gen_random_uuid(),
 jsonb_build_object('purchase_order_id',po.id,'purchase_order_approved_by',po.approved_by,'posting_basis','approved_purchase_order'));
end $$;
revoke all on function private.accept_purchase_receipt(uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('private.business_fields(text)'::regprocedure) into definition;
 fragment:='when ''create_purchase_receipt'' then';
 if position(fragment in definition)=0 then raise exception 'Unexpected business fields definition';end if;
 definition:=replace(definition,fragment,'when ''accept_purchase_receipt'' then array[''id''] '||fragment);execute definition;
 select pg_get_functiondef('private.authorize_business(uuid,text,jsonb)'::regprocedure) into definition;
 fragment:='(''create_purchase_receipt'',''fulfil_requisition'',''create_sales_draft'')';
 if position(fragment in definition)=0 then raise exception 'Unexpected receipt authorization definition';end if;
 definition:=replace(definition,fragment,'(''create_purchase_receipt'',''accept_purchase_receipt'',''fulfil_requisition'',''create_sales_draft'')');execute definition;
 select pg_get_functiondef('private.purchasing_mutation(uuid,text,jsonb,uuid,uuid)'::regprocedure) into definition;
 fragment:='if p_command=''create_purchase_order'' then';
 if position(fragment in definition)=0 then raise exception 'Unexpected purchasing command definition';end if;
 definition:=replace(definition,fragment,'if p_command=''accept_purchase_receipt'' then
 entity:=(p_payload->>''id'')::uuid;perform private.accept_purchase_receipt(p_org,entity,p_actor);
 elsif p_command=''create_purchase_order'' then');
 fragment:=E'      entity:=doc_id;\n    end if;\n  elsif p_command=''create_requisition'' then';
 if position(fragment in definition)=0 then raise exception 'Unexpected receipt mutation definition';end if;
 definition:=replace(definition,fragment,E'      perform private.accept_purchase_receipt(p_org,doc_id,p_actor);\n'||fragment);execute definition;
end $$;

create view public.pending_purchase_receipt_view with(security_invoker=true) as
 select d.id as document_id,d.organization_id,d.created_by,d.status,d.reason,d.event_date,
 p.id as order_id,p.number as order_number,p.vendor_name,p.status as order_status
 from public.inventory_documents d join public.purchase_receipts r on r.document_id=d.id and r.organization_id=d.organization_id
 join public.purchase_orders p on p.id=r.order_id and p.organization_id=r.organization_id
 where d.status in ('draft','submitted');
revoke all on public.pending_purchase_receipt_view from public,anon,authenticated,service_role;
grant select on public.pending_purchase_receipt_view to authenticated;
notify pgrst,'reload schema';commit;
