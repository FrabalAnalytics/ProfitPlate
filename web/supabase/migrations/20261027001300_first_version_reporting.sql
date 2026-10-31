begin;
create table public.report_reconciliations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 starts_on date not null,ends_on date not null,source_hash text not null,
 expected_sales_lines integer not null check(expected_sales_lines>=0),net_sales numeric(32,8) not null check(net_sales>=0),
 actual_cogs numeric(32,8) not null check(actual_cogs>=0),actual_food_cost numeric(32,8) check(actual_food_cost>=0 and actual_food_cost<=actual_cogs),
 evidence_reference text not null,reason text not null,created_by uuid not null references auth.users(id),
 status text not null default 'submitted' check(status in ('submitted','approved','rejected')),
 approved_by uuid references auth.users(id),decision_reason text,created_at timestamptz not null default now(),
 check(starts_on<=ends_on),check(approved_by is null or approved_by<>created_by),unique(organization_id,id)
);
create table public.report_snapshots (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 starts_on date not null,ends_on date not null,location_id uuid,revision integer not null check(revision>0),
 previous_id uuid references public.report_snapshots(id),reason text not null,formula_version text not null default '1.0',
 report jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),unique(organization_id,id)
);
create unique index report_revision on public.report_snapshots(organization_id,starts_on,ends_on,coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),revision);
do $$ declare t text;begin
 foreach t in array array['report_reconciliations','report_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_read on public.%I for select to authenticated using(private.can_finance(organization_id))',t);
 end loop;
end $$;
create trigger snapshot_immutable before update or delete on public.report_snapshots for each row execute function private.deny_changes();
create trigger reconciliation_identity before update or delete on public.report_reconciliations for each row execute function private.protect_record();

create function public.operating_report(p_organization_id uuid,p_starts_on date,p_ends_on date,p_location_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare finance boolean;v_location uuid:=p_location_id;v_report jsonb;inventory jsonb;activity jsonb;sales jsonb;procurement jsonb;v_hash text;review public.report_reconciliations%rowtype;
 pending integer;late integer;source_ids jsonb;line_count integer;covered integer;food_lines integer;food_covered integer;unclassified integer;net numeric;food_net numeric;standard_cost numeric;theory numeric;food_theory numeric;
begin
 perform private.require_inventory_actor();
 if not private.has_role(p_organization_id) or p_starts_on is null or p_ends_on is null or p_starts_on>p_ends_on or p_ends_on-p_starts_on>366 then raise exception using errcode='22023',message='Select a valid report period of at most 367 days';end if;
 finance:=private.can_finance(p_organization_id);
 if not (finance or private.has_role(p_organization_id,array['inventory_manager','procurement_officer','kitchen_lead','bar_lead','viewer'])) then raise exception using errcode='42501',message='Reporting permission required';end if;
 if v_location is null and not private.department_location_read(p_organization_id,null) then
 select location_id into v_location from public.operating_areas where organization_id=p_organization_id and ((area='kitchen' and private.has_role(p_organization_id,array['kitchen_lead'])) or (area='bar' and private.has_role(p_organization_id,array['bar_lead'])));
 if v_location is null then raise exception using errcode='42501',message='Configure an authorized department first';end if;end if;
 if v_location is not null and (not private.department_location_read(p_organization_id,v_location) or not exists(select 1 from public.locations where organization_id=p_organization_id and id=v_location)) then raise exception using errcode='42501',message='Report location denied';end if;
 -- Historical quantities and values come from immutable movements, never today's balance projection.
 with balances as(select m.item_id,m.location_id,m.bucket,
 sum(m.quantity) filter(where m.event_date<p_starts_on) as opening,sum(m.quantity) as closing,
 sum(m.value) filter(where m.event_date<p_starts_on) as opening_value,sum(m.value) as closing_value
 from public.inventory_movements m where m.organization_id=p_organization_id and m.event_date<=p_ends_on
 and (v_location is null or m.location_id=v_location) group by m.item_id,m.location_id,m.bucket)
 select coalesce(jsonb_agg(jsonb_build_object('item_id',b.item_id,'sku',i.sku,'item',i.name,'category',i.category,'unit',coalesce(i.stock_unit_label,i.base_uom_code),
 'location_id',b.location_id,'location',coalesce(l.name,'In transit'),'bucket',b.bucket,'opening',coalesce(b.opening,0)::text,'closing',b.closing::text,
 'opening_value',case when finance then coalesce(b.opening_value,0)::text end,'closing_value',case when finance then b.closing_value::text end) order by i.name,l.name),'[]') into inventory
 from balances b join public.items i on i.id=b.item_id left join public.locations l on l.id=b.location_id;
 select coalesce(jsonb_agg(t.entry order by t.movement),'[]') into activity from(
 select m.movement,jsonb_build_object('movement',m.movement,'entries',count(*),'value',case when finance then sum(m.value)::text end,
 'documents',jsonb_agg(distinct m.document_id)) as entry
 from public.inventory_movements m where m.organization_id=p_organization_id and m.event_date between p_starts_on and p_ends_on
 and (v_location is null or m.location_id=v_location) group by m.movement)t;
 select count(*),count(*) filter(where r.net_sales is not null),coalesce(sum(r.net_sales),0),
 count(*) filter(where r.revenue_class='food'),count(*) filter(where r.revenue_class='food' and r.net_sales is not null),coalesce(sum(r.net_sales) filter(where r.revenue_class='food'),0),count(*) filter(where r.revenue_class is null or r.revenue_class='unclassified')
 into line_count,covered,net,food_lines,food_covered,food_net,unclassified
 from public.sales_import_rows s join public.inventory_documents d on d.id=s.document_id left join public.sales_revenue_evidence r on r.sales_row_id=s.id
 where s.organization_id=p_organization_id and d.status='posted' and d.event_date between p_starts_on and p_ends_on and (v_location is null or s.location_id=v_location);
 select sum(c.posted_inventory_cost),case when count(*)=count(c.theoretical_cost) then sum(c.theoretical_cost) end,
 case when count(*) filter(where r.revenue_class='food')=count(c.theoretical_cost) filter(where r.revenue_class='food') then sum(c.theoretical_cost) filter(where r.revenue_class='food') end
 into standard_cost,theory,food_theory
 from public.sales_cost_evidence c join public.sales_import_rows s on s.id=c.sales_row_id join public.inventory_documents d on d.id=s.document_id left join public.sales_revenue_evidence r on r.sales_row_id=s.id
 where c.organization_id=p_organization_id and d.status='posted' and d.event_date between p_starts_on and p_ends_on and (v_location is null or s.location_id=v_location);
 -- Full theoretical coverage requires an evidence line for every captured ingredient, including legacy imports.
 if exists(select 1 from public.sales_import_rows s join public.inventory_documents d on d.id=s.document_id join public.recipe_ingredients i on i.version_id=s.recipe_version_id
 left join public.sales_cost_evidence c on c.sales_row_id=s.id and c.item_id=i.item_id
 where s.organization_id=p_organization_id and d.status='posted' and d.event_date between p_starts_on and p_ends_on and (v_location is null or s.location_id=v_location) and c.sales_row_id is null) then theory:=null;standard_cost:=null;food_theory:=null;end if;
 select count(*) into pending from public.inventory_documents d where d.organization_id=p_organization_id and d.status in ('draft','submitted') and d.event_date between p_starts_on and p_ends_on
 and (v_location is null or d.source_location_id=v_location or d.destination_location_id=v_location or exists(select 1 from public.sales_import_rows s where s.document_id=d.id and s.location_id=v_location));
 pending:=pending+(select count(*)::int from public.stock_counts c where c.organization_id=p_organization_id and c.status in ('draft','submitted') and c.event_date between p_starts_on and p_ends_on and (v_location is null or c.location_id=v_location));
 select count(*) into late from public.inventory_movements m where m.organization_id=p_organization_id and m.event_date between p_starts_on and p_ends_on and (v_location is null or m.location_id=v_location) and (m.posted_at at time zone 'Africa/Lagos')::date>m.event_date;
 select jsonb_build_object('movements',coalesce(jsonb_agg(m.id order by m.id),'[]')) into source_ids from public.inventory_movements m where m.organization_id=p_organization_id and m.event_date<=p_ends_on and (v_location is null or m.location_id=v_location);
 v_hash:=encode(sha256(convert_to(jsonb_build_object('sources',source_ids,'inventory',inventory,'activity',activity,'lines',line_count,'covered',covered,'net',net,'theory',theory,'pending',pending)::text,'UTF8')),'hex');
 if finance and v_location is null then select * into review from public.report_reconciliations where organization_id=p_organization_id and starts_on=p_starts_on and ends_on=p_ends_on and status='approved' and source_hash=v_hash order by created_at desc,id desc limit 1;end if;
 if finance then
 select jsonb_build_object('accepted_purchase_value',coalesce(sum(m.value) filter(where m.movement='receipt'),0)::text,
 'recorded_waste_value',(-coalesce(sum(m.value) filter(where m.movement='waste'),0))::text,
 'count_adjustment_value',coalesce(sum(m.value) filter(where m.movement='count_adjustment'),0)::text)
 into procurement from public.inventory_movements m where m.organization_id=p_organization_id and m.event_date between p_starts_on and p_ends_on and (v_location is null or m.location_id=v_location);
 sales:=jsonb_build_object('posted_lines',line_count,'revenue_covered_lines',covered,'observed_net_sales',case when covered>0 then net::text end,'net_sales',case when line_count>0 and covered=line_count then net::text end,
 'food_lines',food_lines,'unclassified_lines',unclassified,'food_net_sales',case when food_lines>0 and food_covered=food_lines and unclassified=0 then food_net::text end,
 'standard_quantity_inventory_cogs',standard_cost::text,'theoretical_cogs',theory::text,'theoretical_food_cost',food_theory::text,
 'theoretical_food_cost_pct',case when food_net>0 and food_covered=food_lines and unclassified=0 and food_theory is not null then round(100*food_theory/food_net,4)::text end,
 'theoretical_gross_profit',case when line_count>0 and covered=line_count and theory is not null then (net-theory)::text end,
 'theoretical_gross_margin_pct',case when net>0 and line_count>0 and covered=line_count and theory is not null then round(100*(net-theory)/net,4)::text end,
 'actual_cogs',review.actual_cogs::text,'actual_food_cost',review.actual_food_cost::text,
 'actual_gross_profit',case when review.id is not null then (net-review.actual_cogs)::text end,
 'actual_gross_margin_pct',case when review.id is not null and net>0 then round(100*(net-review.actual_cogs)/net,4)::text end,
 'actual_food_cost_pct',case when review.id is not null and food_net>0 and food_covered=food_lines and unclassified=0 then round(100*review.actual_food_cost/food_net,4)::text end,
 'reconciliation_id',review.id,'actual_basis','Finance-supplied COGS with supporting evidence and independent Operations approval; not inferred from transfers or purchases.');
 end if;
 v_report:=jsonb_build_object('organization_id',p_organization_id,'starts_on',p_starts_on,'ends_on',p_ends_on,'location_id',v_location,'timezone','Africa/Lagos','generated_at',now(),
 'formula_version','1.0','source_hash',v_hash,'finance',finance,'readiness',case when review.id is not null and pending=0 and p_ends_on<(now() at time zone 'Africa/Lagos')::date then 'reconciled' else 'partial' end,
 'pending_documents',pending,'late_movement_entries',late,'posted_sales_lines',line_count,'inventory',inventory,'activity',activity,'sales',sales,
 'valuation_basis','Immutable posted movement values by business event date; posting-order weighted average. Backdating does not restate historical costs.',
 'coverage_note','Coverage measures imported posted lines only. Complete POS sales and accounting COGS require a matching approved reconciliation. Missing figures are unavailable, never zero.');
 return v_report||jsonb_build_object('procurement',procurement);
end $$;

create function public.reporting_command(p_command text,p_request_id uuid,p_organization_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor();allowed text[];saved private.command_requests%rowtype;hash bytea;v_result jsonb;data jsonb;entity uuid;rec public.report_reconciliations%rowtype;prior public.report_snapshots%rowtype;revision integer;
begin
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then raise exception using errcode='22023',message='Invalid reporting command';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found or not private.can_finance(p_organization_id) then raise exception using errcode='42501',message='Finance reporting permission required';end if;
 allowed:=case p_command when 'reconcile' then array['starts_on','ends_on','expected_sales_lines','net_sales','actual_cogs','actual_food_cost','evidence_reference','reason']
 when 'approve_reconciliation' then array['id'] when 'reject_reconciliation' then array['id','reason']
 when 'publish' then array['starts_on','ends_on','location_id','reason'] when 'export' then array['id'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown reporting field';end if;
 if p_command='reconcile' and not private.has_role(p_organization_id,array['owner','accountant']) then raise exception using errcode='42501',message='Owner or Finance prepares accounting reconciliations';end if;
 if p_command in ('approve_reconciliation','reject_reconciliation') and not private.is_manager(p_organization_id) then raise exception using errcode='42501',message='Operations Manager approval required';end if;
 hash:=sha256(convert_to(p_payload::text,'UTF8'));
 insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash) values(actor,p_organization_id,'report:'||p_command,p_request_id,hash) on conflict do nothing;
 select * into saved from private.command_requests where actor_id=actor and scope_id=p_organization_id and command='report:'||p_command and request_id=p_request_id for update;
 if saved.payload_hash<>hash then raise exception using errcode='22023',message='Request key reused with different payload';end if;if saved.result is not null then return saved.result;end if;
 if p_command='reconcile' then
 data:=public.operating_report(p_organization_id,(p_payload->>'starts_on')::date,(p_payload->>'ends_on')::date);
 if (p_payload->>'ends_on')::date>=(now() at time zone 'Africa/Lagos')::date then raise exception using errcode='22023',message='Reconcile completed business dates only';end if;
 if (data->>'pending_documents')::int>0 or data#>>'{sales,net_sales}' is null or (data->>'posted_sales_lines')::int<>(p_payload->>'expected_sales_lines')::int
 or (data#>>'{sales,net_sales}')::numeric<>private.decimal_field(p_payload,'net_sales',8,true) then raise exception using errcode='23514',message='Reconcile POS line count, net sales and pending documents before submission';end if;
 insert into public.report_reconciliations(organization_id,starts_on,ends_on,source_hash,expected_sales_lines,net_sales,actual_cogs,actual_food_cost,evidence_reference,reason,created_by)
 values(p_organization_id,(p_payload->>'starts_on')::date,(p_payload->>'ends_on')::date,data->>'source_hash',(p_payload->>'expected_sales_lines')::int,private.decimal_field(p_payload,'net_sales',8,true),private.decimal_field(p_payload,'actual_cogs',8,true),case when p_payload ? 'actual_food_cost' then private.decimal_field(p_payload,'actual_food_cost',8,true) end,private.require_text(p_payload,'evidence_reference',500),private.require_text(p_payload,'reason',500),actor) returning id into entity;
 elsif p_command in ('approve_reconciliation','reject_reconciliation') then
 select * into rec from public.report_reconciliations where organization_id=p_organization_id and id=(p_payload->>'id')::uuid for update;
 if not found or rec.status<>'submitted' then raise exception using errcode='22023',message='Submitted reconciliation required';end if;
 if rec.created_by=actor then raise exception using errcode='42501',message='Self approval is forbidden';end if;
 if p_command='approve_reconciliation' then data:=public.operating_report(p_organization_id,rec.starts_on,rec.ends_on);
 if data->>'source_hash'<>rec.source_hash then raise exception using errcode='23514',message='Report evidence changed; submit a fresh reconciliation';end if;end if;
 update public.report_reconciliations set status=case when p_command='approve_reconciliation' then 'approved' else 'rejected' end,approved_by=actor,decision_reason=case when p_command='reject_reconciliation' then private.require_text(p_payload,'reason',500) end where id=rec.id;entity:=rec.id;
 elsif p_command='publish' then
 data:=public.operating_report(p_organization_id,(p_payload->>'starts_on')::date,(p_payload->>'ends_on')::date,(p_payload->>'location_id')::uuid);
 select * into prior from public.report_snapshots where organization_id=p_organization_id and starts_on=(p_payload->>'starts_on')::date and ends_on=(p_payload->>'ends_on')::date and location_id is not distinct from (p_payload->>'location_id')::uuid order by revision desc limit 1;
 revision:=coalesce(prior.revision,0)+1;
 insert into public.report_snapshots(organization_id,starts_on,ends_on,location_id,revision,previous_id,reason,report,created_by) values(p_organization_id,(p_payload->>'starts_on')::date,(p_payload->>'ends_on')::date,(p_payload->>'location_id')::uuid,revision,prior.id,private.require_text(p_payload,'reason',500),data,actor) returning id into entity;
 else
 select id into entity from public.report_snapshots where organization_id=p_organization_id and id=(p_payload->>'id')::uuid;
 if entity is null then raise exception using errcode='42501',message='Snapshot access denied';end if;
 end if;
 v_result:=jsonb_build_object('id',entity,'organization_id',p_organization_id);
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details) values(p_organization_id,actor,'report:'||p_command,'report',entity,p_request_id,p_payload);
 update private.command_requests set result=v_result where actor_id=actor and scope_id=p_organization_id and command='report:'||p_command and request_id=p_request_id;
 return v_result;
end $$;
revoke all on function public.operating_report(uuid,date,date,uuid),public.reporting_command(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.operating_report(uuid,date,date,uuid),public.reporting_command(text,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';commit;
