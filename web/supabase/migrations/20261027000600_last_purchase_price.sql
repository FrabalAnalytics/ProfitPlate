begin;
create index inventory_item_receipts on public.inventory_document_lines(organization_id,item_id,document_id);

-- Most recent purchase business date; posting time and ID make ties deterministic.
-- A backdated receipt does not replace a newer purchase. All underlying reads retain RLS.
create view public.inventory_item_view with(security_invoker=true) as
  select i.id,i.organization_id,i.sku,i.name,i.category,i.base_uom_code,i.is_active,
    purchase.unit_cost::text as last_purchase_unit_cost,
    purchase.event_date as last_purchase_date
  from public.items i
  left join lateral (
    select l.unit_cost,d.event_date
    from public.inventory_document_lines l
    join public.inventory_documents d on d.id=l.document_id and d.organization_id=l.organization_id
    where l.organization_id=i.organization_id and l.item_id=i.id and d.kind='receipt' and d.status='posted'
    order by d.event_date desc,d.posted_at desc,d.id desc
    limit 1
  ) purchase on true;

create or replace view public.inventory_balance_view with(security_invoker=true) as
  select b.organization_id,b.location_id,l.name as location_name,b.item_id,i.name as item_name,i.sku,i.category,i.base_uom_code,
    b.quantity::text as quantity,s.average_cost::text as average_cost,
    case when s.average_cost is not null then round(b.quantity*s.average_cost,8)::text end as current_value,
    i.last_purchase_unit_cost,i.last_purchase_date
  from public.stock_balances b join public.inventory_item_view i on i.id=b.item_id and i.organization_id=b.organization_id
  join public.locations l on l.id=b.location_id
  left join public.stock_cost_state s on s.organization_id=b.organization_id and s.item_id=b.item_id;
revoke all on public.inventory_item_view from public,anon,authenticated,service_role;
grant select on public.inventory_item_view to authenticated;
notify pgrst,'reload schema';
commit;
