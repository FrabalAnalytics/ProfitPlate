"""Build an atomic, provenance-recorded maintenance import from a validated manifest.
Generated SQL stays in .tooling and contains business catalogue data, not credentials.
"""
import argparse
import hashlib
import json
import pathlib
import uuid


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=pathlib.Path)
    parser.add_argument('--organization-id', required=True)
    parser.add_argument('--organization-name', required=True)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    tenant = str(uuid.UUID(args.organization_id))
    data = json.loads(args.manifest.read_text(encoding='utf8'))
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if source_hash != data['source_sha256']:
        raise ValueError('Workbook changed after validation. Prepare and review it again.')
    rows = json.dumps(data['rows'], ensure_ascii=False)
    guard = '$import_guard_' + source_hash + '$'
    delimiter = '$catalogue_rows_' + source_hash + '$'
    if guard in rows or delimiter in rows or guard in args.organization_name or guard in data['source_name']:
        raise ValueError('Unsafe SQL delimiter collision.')
    # Exact evidence fingerprints are calculated inside PostgreSQL; they are not emitted.
    tables = ['inventory_documents', 'inventory_document_lines', 'inventory_movements', 'stock_balances', 'stock_cost_state', 'transfer_stock', 'sales_import_rows', 'sales_posting_keys']
    snapshots = ',\n'.join(sql_text(table) + ", (select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public." + table + " t where t.organization_id=tenant)" for table in tables)
    sql = f"""-- Validated workbook SHA-256: {source_hash}
-- All-or-nothing maintenance import. No Auth identity is impersonated.
begin;
set local statement_timeout='60s';
do {guard}
declare tenant uuid:='{tenant}'; prior jsonb; after_stock jsonb; prior_items jsonb; outcome jsonb;
begin
  perform 1 from public.organizations where id=tenant and name={sql_text(args.organization_name)} for update;
  if not found then raise exception 'Expected test restaurant not found'; end if;
  select jsonb_build_object({snapshots}) into prior;
  select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into prior_items from public.items i where organization_id=tenant;
  select public.import_inventory_catalogue(tenant,{sql_text(data['source_name'])},'{source_hash}',{delimiter}{rows}{delimiter}::jsonb) into outcome;
  if (outcome->>'rows')::int<>{len(data['rows'])} then raise exception 'Unexpected import row count'; end if;
  select jsonb_build_object({snapshots}) into after_stock;
  if prior is distinct from after_stock then raise exception 'Import attempted to change operational stock evidence'; end if;
  if exists(select 1 from jsonb_array_elements(prior_items) old_item where not exists(select 1 from public.items i where i.organization_id=tenant and to_jsonb(i)=old_item)) then
    raise exception 'Import attempted to change an existing inventory identity';
  end if;
end;
{guard};
commit;
select jsonb_build_object('source_sha256',b.source_sha256,'source_name',b.source_name,'rows',b.row_count,
  'inserted',b.inserted_count,'matched',b.matched_count,'origin',b.import_origin,
  'total_items',(select count(*) from public.items where organization_id=b.organization_id),
  'categories',(select jsonb_object_agg(category,n) from(select i.category,count(*) as n from public.catalogue_import_rows r join public.items i on i.id=r.item_id where r.import_id=b.id group by i.category) totals),
  'zero_unconfirmed',(select count(*) from public.catalogue_import_rows where import_id=b.id and price_status='zero_unconfirmed'),
  'missing_prices',(select count(*) from public.catalogue_import_rows where import_id=b.id and price_status='missing')) as import_result
from public.catalogue_imports b where b.organization_id='{tenant}' and b.source_sha256='{source_hash}';
"""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(sql, encoding='utf8')
    print(f'Prepared guarded import for {len(data["rows"])} rows. No database changes made.')
