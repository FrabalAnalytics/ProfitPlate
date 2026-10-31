"""Read an XLSX catalogue without executing formulas/macros or modifying the source.
Outputs a normalized, reviewable CSV/JSON and issues report inside .tooling.
"""
import argparse
import collections
import csv
import datetime
import decimal
import hashlib
import io
import json
import pathlib
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
UNITS = {'ltr': ('l', None), 'kg': ('kg', None), 'ml': ('ml', None), 'gram': ('g', None),
         'pcs': ('each', 'piece'), 'bottle': ('each', 'bottle'), 'pack': ('each', 'pack'),
         'roll': ('each', 'roll'), 'can': ('each', 'can'), 'bag': ('each', 'bag'),
         'fingers': ('each', 'finger'), 'portion': ('each', 'portion'), 'wrap': ('each', 'wrap')}
CATEGORIES = {'raw material': 'raw_material', 'semi-finished': 'semi_finished', 'general supply': 'general'}


def prepare(source, destination):
    contents = source.read_bytes()
    source_hash = hashlib.sha256(contents).hexdigest()
    issues, rows = [], []
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 20000000:
            raise ValueError('Workbook exceeds the supported uncompressed size.')
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        props = workbook.find('s:workbookPr', NS)
        epoch = datetime.date(1904, 1, 1) if props is not None and props.get('date1904') in ('1', 'true') else datetime.date(1899, 12, 30)
        sheets = workbook.findall('s:sheets/s:sheet', NS)
        if len(sheets) != 1:
            raise ValueError('Select a single catalogue worksheet before importing.')
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in si.findall('.//s:t', NS))
                       for si in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        worksheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        for row in worksheet.findall('s:sheetData/s:row', NS):
            cells = {}
            for cell in row.findall('s:c', NS):
                if cell.find('s:f', NS) is not None:
                    raise ValueError(f'Formula at {cell.get("r")}; supply reviewed literal values.')
                value = cell.find('s:v', NS)
                value = value.text if value is not None else ''
                if cell.get('t') == 's' and value:
                    value = strings[int(value)]
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                cells[re.sub(r'\d', '', cell.get('r'))] = (value or '').strip()
            if int(row.get('r')) == 1:
                if [cells.get(k, '').casefold() for k in 'ABCD'] != ['sku', 'item name', 'category', 'base unit']:
                    raise ValueError('Unexpected catalogue headers.')
                if not cells.get('E'):
                    issues.append({'type': 'missing_header', 'cell': 'E1', 'interpretation': 'last purchase / legacy reference price, per supplied template'})
                continue
            if not any(cells.values()):
                continue
            number = int(row.get('r'))
            sku, name = cells.get('A', ''), cells.get('B', '')
            if not sku or len(sku) > 64 or not name or len(name) > 160:
                raise ValueError(f'Invalid SKU/name at row {number}.')
            category = CATEGORIES.get(cells.get('C', '').casefold())
            unit = UNITS.get(cells.get('D', '').casefold())
            if category is None or unit is None:
                raise ValueError(f'Unmapped category/unit at row {number}.')
            raw_price = cells.get('E', '')
            price, status = None, 'missing'
            if raw_price:
                if not re.fullmatch(r'\d+(\.\d+)?', raw_price):
                    raise ValueError(f'Invalid price at row {number}.')
                original = decimal.Decimal(raw_price)
                if original > decimal.Decimal('1000000000000'):
                    raise ValueError(f'Price exceeds supported range at row {number}.')
                normalized = original.quantize(decimal.Decimal('.00000001'), rounding=decimal.ROUND_HALF_UP)
                price = format(normalized, '.8f')
                status = 'zero_unconfirmed' if normalized == 0 else 'provided'
                if normalized != original:
                    issues.append({'type': 'excel_decimal_normalized', 'row': number, 'sku': sku, 'original': raw_price, 'normalized': price})
            if status != 'provided':
                issues.append({'type': status, 'row': number, 'sku': sku, 'name': name})
            date = cells.get('F', '')
            purchase_date = None
            if date:
                if not date.isdigit():
                    raise ValueError(f'Expected an Excel date serial at row {number}.')
                purchase_date = (epoch + datetime.timedelta(days=int(date))).isoformat()
            if '1000 Kg Per Kg' in name:
                issues.append({'type': 'suspect_package_description', 'row': number, 'sku': sku, 'note': 'Name retained verbatim; no conversion inferred.'})
            rows.append({'source_row': number, 'sku': sku, 'name': name, 'category': category,
                         'base_uom_code': unit[0], 'stock_unit_label': unit[1], 'source_unit': cells.get('D'),
                         'reference_price': price, 'price_status': status,
                         'reference_kind': 'production_reference' if category == 'semi_finished' else 'purchase_reference',
                         'reference_date': purchase_date, 'source_values': {k: cells.get(k, '') for k in 'ABCDEF'}})
    for field in ('sku', 'name'):
        duplicates = [key for key, count in collections.Counter(r[field].casefold() for r in rows).items() if count > 1]
        if duplicates:
            raise ValueError(f'Duplicate {field}: {duplicates}')
    destination.mkdir(parents=True, exist_ok=True)
    payload = {'source_name': source.name, 'source_sha256': source_hash, 'rows': rows}
    (destination / 'validated.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf8')
    with (destination / 'validated.csv').open('w', newline='', encoding='utf8') as handle:
        writer = csv.DictWriter(handle, fieldnames=[key for key in rows[0] if key != 'source_values'])
        writer.writeheader()
        writer.writerows({key: value for key, value in row.items() if key != 'source_values'} for row in rows)
    report = {'source_name': source.name, 'source_sha256': source_hash, 'row_count': len(rows),
              'categories': dict(collections.Counter(r['category'] for r in rows)),
              'price_status': dict(collections.Counter(r['price_status'] for r in rows)),
              'reference_kinds': dict(collections.Counter(r['reference_kind'] for r in rows)), 'issues': issues}
    (destination / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf8')
    print(json.dumps({key: value for key, value in report.items() if key != 'issues'}, indent=2))
    print(f'{len(issues)} review notes saved. Source workbook unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    prepare(args.source, args.output)
