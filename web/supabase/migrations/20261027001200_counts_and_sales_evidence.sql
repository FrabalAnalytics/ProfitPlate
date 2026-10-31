begin;
-- Counts compare actual movement instants, including multiple commands inside one transaction.
alter table public.inventory_movements alter column posted_at set default clock_timestamp();
alter table public.menu_items add column revenue_class text not null default 'food' check(revenue_class in ('food','beverage','other'));
update public.menu_items set revenue_class='beverage' where default_area='bar';
create table public.sales_revenue_evidence (
 organization_id uuid not null,sales_row_id uuid primary key,net_sales numeric(24,8) check(net_sales>=0),
 revenue_class text not null check(revenue_class in ('food','beverage','other','unclassified')),
 foreign key(sales_row_id) references public.sales_import_rows(id) on delete restrict,
 foreign key(organization_id) references public.organizations(id)
);
create table public.sales_cost_evidence (
 organization_id uuid not null,sales_row_id uuid not null,item_id uuid not null,
 quantity numeric(24,6) not null,posted_inventory_cost numeric(32,8) not null check(posted_inventory_cost>=0),
 theoretical_cost numeric(32,8) check(theoretical_cost>=0),primary key(sales_row_id,item_id),
 foreign key(sales_row_id) references public.sales_import_rows(id),
 foreign key(organization_id,item_id) references public.items(organization_id,id)
);
-- Capture both valuation cost and current recipe replacement cost at posting, never on report refresh.
do $$ declare definition text;fragment text:='perform private.move_stock(p_doc,line.item_id,sales.location_id,-q,''sales_consumption'');';begin
 select pg_get_functiondef('private.post_inventory_document(public.inventory_documents)'::regprocedure) into definition;
 if position(fragment in definition)=0 then raise exception 'Unexpected sales posting implementation';end if;
 definition:=replace(definition,fragment,
 'cost:=private.live_item_cost(p_doc.organization_id,line.item_id); total:=private.move_stock(p_doc,line.item_id,sales.location_id,-q,''sales_consumption'');
 insert into public.sales_cost_evidence(organization_id,sales_row_id,item_id,quantity,posted_inventory_cost,theoretical_cost)
 values(p_doc.organization_id,sales.id,line.item_id,q,total,case when cost is not null then round(q*cost,8) end);');
 execute definition;
end $$;
-- Extend validated sales import while retaining the existing inventory parser and its duplicate checks.
do $$ declare definition text;fragment text;begin
 select pg_get_functiondef('private.purchasing_mutation(uuid,text,jsonb,uuid,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'''menu_code'',''external_id'',''quantity'',''location_id''','''menu_code'',''external_id'',''quantity'',''location_id'',''net_sales''');
 definition:=replace(definition,'row||jsonb_build_object(''menu_code'',recipe_code)','(row-''net_sales'')||jsonb_build_object(''menu_code'',recipe_code)');
 fragment:='insert into public.sales_menu_sources values(p_org,doc_id,upper(p_payload->>''source_system''),row->>''external_id'',row->>''menu_code'',source);';
 if position(fragment in definition)=0 then raise exception 'Unexpected sales import implementation';end if;
 definition:=replace(definition,fragment,fragment||'
 insert into public.sales_revenue_evidence(organization_id,sales_row_id,net_sales,revenue_class)
 select p_org,s.id,case when row ? ''net_sales'' then private.decimal_field(row,''net_sales'',8,true) end,coalesce(m.revenue_class,''unclassified'')
 from public.sales_import_rows s left join public.menu_items m on m.id=source where s.document_id=doc_id and s.external_id=row->>''external_id'';');
 execute definition;
 -- Menu classification is explicit and editable; historical evidence retains its original class.
 select pg_get_functiondef('private.business_fields(text)'::regprocedure) into definition;
 definition:=replace(definition,'''default_area'',''is_active''','''default_area'',''is_active'',''revenue_class''');execute definition;
 select pg_get_functiondef('private.master_mutation(uuid,text,jsonb,uuid)'::regprocedure) into definition;
 fragment:='else raise exception using errcode=''22023'',message=''Unknown master command'';';
 -- Keep the known function body intact and update classification after its validated mutation.
 if position('return entity;' in definition)=0 then raise exception 'Unexpected master implementation';end if;
 definition:=replace(definition,'return entity;','if p_command=''save_menu_item'' and p_payload ? ''revenue_class'' then
 update public.menu_items set revenue_class=private.require_text(p_payload,''revenue_class'',20) where id=entity;end if; return entity;');
 execute definition;
end $$;

alter table public.inventory_documents drop constraint inventory_documents_kind_check;
alter table public.inventory_documents add constraint inventory_documents_kind_check check(kind in ('opening','receipt','transfer','waste','usage','production','sales','count_adjustment'));
create table public.stock_counts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,
 reason text not null,cutoff_at timestamptz not null default clock_timestamp(),event_date date not null,
 status text not null default 'draft' check(status in ('draft','submitted','posted','rejected')),
 created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),decision_reason text,
 document_id uuid references public.inventory_documents(id),created_at timestamptz not null default now(),
 unique(organization_id,id),check(approved_by is null or approved_by<>created_by),
 foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create table public.stock_count_lines (
 organization_id uuid not null,count_id uuid not null,item_id uuid not null,
 book_quantity numeric(24,6) not null check(book_quantity>=0),physical_quantity numeric(24,6) not null check(physical_quantity>=0),
 primary key(count_id,item_id),foreign key(organization_id,count_id) references public.stock_counts(organization_id,id),
 foreign key(organization_id,item_id) references public.items(organization_id,id)
);
create view public.stock_count_line_view with(security_invoker=true) as
 select c.*,i.name as item_name,i.sku,coalesce(i.stock_unit_label,i.base_uom_code) as unit,
 c.book_quantity::text as book,c.physical_quantity::text as physical,(c.physical_quantity-c.book_quantity)::text as variance
 from public.stock_count_lines c join public.items i on i.id=c.item_id;
revoke all on public.stock_count_line_view from public,anon,authenticated,service_role;grant select on public.stock_count_line_view to authenticated;
do $$ declare t text;begin
 foreach t in array array['sales_revenue_evidence','sales_cost_evidence','stock_counts','stock_count_lines'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 if t in ('sales_revenue_evidence','sales_cost_evidence') then
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.can_finance(organization_id))',t);
 else
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.has_role(organization_id) and exists(select 1 from public.stock_counts c where c.id=%s and private.department_location_read(c.organization_id,c.location_id)))',t,case when t='stock_counts' then 'stock_counts.id' else 'count_id' end);
 end if;
 if t<>'stock_counts' then execute format('create trigger immutable before update or delete on public.%I for each row execute function private.deny_changes()',t);end if;
 end loop;
end $$;
-- Avoid a recursive RLS policy on the count header itself.
drop policy tenant_read on public.stock_counts;
create policy tenant_read on public.stock_counts for select to authenticated using(private.department_location_read(organization_id,location_id));
create trigger count_identity before update or delete on public.stock_counts for each row execute function private.protect_record();
do $$ declare definition text;fragment text:='if d.kind=''production'' then';begin
 select pg_get_functiondef('public.inventory_document_preview(uuid,uuid)'::regprocedure) into definition;
 if position(fragment in definition)=0 then raise exception 'Unexpected preview implementation';end if;
 definition:=replace(definition,fragment,'if d.kind=''count_adjustment'' then
 select jsonb_agg(jsonb_build_object(''item'',i.name,''unit'',coalesce(i.stock_unit_label,i.base_uom_code),''quantity'',(c.physical_quantity-c.book_quantity)::text,''unit_cost'',m.unit_cost::text,''location'',l.name)) into rows
 from public.stock_count_lines c join public.stock_counts h on h.id=c.count_id join public.items i on i.id=c.item_id join public.locations l on l.id=h.location_id
 left join public.inventory_movements m on m.document_id=d.id and m.item_id=c.item_id where h.document_id=d.id;
 elsif d.kind=''production'' then');execute definition;
end $$;

create function public.control_command(p_command text,p_request_id uuid,p_organization_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor();entity uuid;rec public.stock_counts%rowtype;line jsonb;row record;doc public.inventory_documents%rowtype;
 delta numeric;allowed text[];saved private.command_requests%rowtype;hash bytea;v_result jsonb;cost numeric;
begin
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then raise exception using errcode='22023',message='Invalid control command';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found or not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied';end if;
 allowed:=case p_command when 'assign_duty' then array['user_id','role','reason'] when 'remove_duty' then array['user_id','role','reason']
 when 'create_count' then array['location_id','reason','lines'] when 'submit_count' then array['id'] when 'approve_count' then array['id'] when 'reject_count' then array['id','reason'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown control field';end if;
 if p_command in ('assign_duty','remove_duty') then
 if not private.has_role(p_organization_id,array['owner']) then raise exception using errcode='42501',message='Only the owner assigns additional operational duties';end if;
 elsif p_command in ('approve_count','reject_count') then
 if not private.is_manager(p_organization_id) then raise exception using errcode='42501',message='Operations Manager required';end if;
 elsif p_command='create_count' then
 if not private.can_operate(p_organization_id,(p_payload->>'location_id')::uuid) then raise exception using errcode='42501',message='Count permission denied';end if;
 else
 select * into rec from public.stock_counts where organization_id=p_organization_id and id=(p_payload->>'id')::uuid;
 if not found or not private.can_operate(p_organization_id,rec.location_id) then raise exception using errcode='42501',message='Count permission denied';end if;
 end if;
 hash:=sha256(convert_to(p_payload::text,'UTF8'));
 insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash) values(actor,p_organization_id,'control:'||p_command,p_request_id,hash) on conflict do nothing;
 select * into saved from private.command_requests where actor_id=actor and scope_id=p_organization_id and command='control:'||p_command and request_id=p_request_id for update;
 if saved.payload_hash<>hash then raise exception using errcode='22023',message='Request key reused with different payload';end if;
 if saved.result is not null then return saved.result;end if;
 if p_command in ('assign_duty','remove_duty') then
 entity:=(p_payload->>'user_id')::uuid;perform private.require_text(p_payload,'reason',500);
 if not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=entity and status='active') then raise exception using errcode='22023',message='Active member required';end if;
 if p_payload->>'role' not in ('inventory_manager','procurement_officer','accountant') then raise exception using errcode='22023',message='Invalid additional duty';end if;
 if p_command='assign_duty' then insert into public.additional_role_assignments values(p_organization_id,entity,p_payload->>'role',actor,now()) on conflict do nothing;
 else delete from public.additional_role_assignments where organization_id=p_organization_id and user_id=entity and role=p_payload->>'role';end if;
 elsif p_command='create_count' then
 if not exists(select 1 from public.locations where organization_id=p_organization_id and id=(p_payload->>'location_id')::uuid and is_active) then raise exception using errcode='22023',message='Active count location required';end if;
 if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500 then raise exception using errcode='22023',message='Count 1 to 500 items';end if;
 insert into public.stock_counts(organization_id,location_id,reason,event_date,created_by) values(p_organization_id,(p_payload->>'location_id')::uuid,private.require_text(p_payload,'reason',500),(now() at time zone 'Africa/Lagos')::date,actor) returning id into entity;
 for line in select value from jsonb_array_elements(p_payload->'lines') loop
 if exists(select 1 from jsonb_object_keys(line) k where k not in ('item_id','quantity')) or not exists(select 1 from public.items where organization_id=p_organization_id and id=(line->>'item_id')::uuid and is_active) then raise exception using errcode='22023',message='Active count item required';end if;
 insert into public.stock_count_lines values(p_organization_id,entity,(line->>'item_id')::uuid,coalesce((select quantity from public.stock_balances where organization_id=p_organization_id and location_id=(p_payload->>'location_id')::uuid and item_id=(line->>'item_id')::uuid),0),private.decimal_field(line,'quantity',6,true));
 end loop;
 else
 select * into rec from public.stock_counts where organization_id=p_organization_id and id=(p_payload->>'id')::uuid for update;
 if not found then raise exception using errcode='22023',message='Count not found';end if;entity:=rec.id;
 if p_command='submit_count' then
 if rec.status<>'draft' or rec.created_by<>actor then raise exception using errcode='42501',message='Only the counter can submit their draft';end if;
 update public.stock_counts set status='submitted' where id=rec.id;
 else
 if rec.created_by=actor then raise exception using errcode='42501',message='Self approval is forbidden';end if;
 if rec.status<>'submitted' then raise exception using errcode='22023',message='Submitted count required';end if;
 if p_command='reject_count' then update public.stock_counts set status='rejected',approved_by=actor,decision_reason=private.require_text(p_payload,'reason',500) where id=rec.id;
 else
 if exists(select 1 from public.stock_count_lines c join public.inventory_movements m on m.item_id=c.item_id and m.location_id=rec.location_id where c.count_id=rec.id and m.organization_id=p_organization_id and m.posted_at>rec.cutoff_at) then raise exception using errcode='23514',message='Stock moved after the count cutoff; recount before adjustment';end if;
 if not exists(select 1 from public.inventory_periods where organization_id=p_organization_id and not is_closed and rec.event_date between starts_on and ends_on) then raise exception using errcode='22023',message='Posting requires an open inventory period';end if;
 insert into public.inventory_documents(organization_id,kind,event_date,reason,source_location_id,created_by) values(p_organization_id,'count_adjustment',rec.event_date,rec.reason,rec.location_id,rec.created_by) returning * into doc;
 for row in select * from public.stock_count_lines where count_id=rec.id order by item_id loop
 delta:=row.physical_quantity-row.book_quantity;
 if delta<>0 then
 select average_cost into cost from public.stock_cost_state where organization_id=p_organization_id and item_id=row.item_id;
 perform private.move_stock(doc,row.item_id,rec.location_id,delta,'count_adjustment',cost);
 end if;end loop;
 update public.inventory_documents set status='posted',approved_by=actor,posted_at=clock_timestamp() where id=doc.id;
 update public.stock_counts set status='posted',approved_by=actor,document_id=doc.id where id=rec.id;
 end if;end if;
 end if;
 v_result:=jsonb_build_object('id',entity,'organization_id',p_organization_id);
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details) values(p_organization_id,actor,p_command,'operational_control',entity,p_request_id,p_payload);
 update private.command_requests set result=v_result where actor_id=actor and scope_id=p_organization_id and command='control:'||p_command and request_id=p_request_id;
 return v_result;
end $$;
revoke all on function public.control_command(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.control_command(text,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';commit;
