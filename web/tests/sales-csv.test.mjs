import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSalesCsv } from "../lib/sales-csv.ts";
test("CSV preserves source identities and supports BOM, CRLF, quotes and reordered columns", () => {
  assert.deepEqual(
    parseSalesCsv(
      '\uFEFFquantity,location,external_id,menu_code\r\n2,"Main, Kitchen","sale""1",PLATE\r\n',
    ),
    [
      {
        quantity: "2",
        location: "Main, Kitchen",
        external_id: 'sale"1',
        menu_code: "PLATE",
      },
    ],
  );
});
test("invalid and ambiguous source lines are rejected before a draft is created", () => {
  const header = "external_id,menu_code,quantity,location\n";
  for (const invalid of [
    "a,PLATE,-1,Kitchen",
    "a,PLATE,0,Kitchen",
    "a,PLATE,1e2,Kitchen",
    "a,PLATE,0.0000001,Kitchen",
    "a,PLATE,1,Kitchen\na,PLATE,1,Bar",
    "a,PLATE,1,Kitchen,EXTRA",
    '"a,PLATE,1,Kitchen',
    '"a"junk,PLATE,1,Kitchen',
    ",PLATE,1,Kitchen",
  ])
    assert.throws(() => parseSalesCsv(header + invalid));
  assert.throws(() =>
    parseSalesCsv("external_id,menu_code,quantity,quantity\na,PLATE,1,Kitchen"),
  );
  assert.throws(() =>
    parseSalesCsv(
      header +
        Array.from({ length: 501 }, (_, i) => `${i},PLATE,1,Kitchen`).join(
          "\n",
        ),
    ),
  );
  assert.throws(() => parseSalesCsv("x".repeat(200001)));
});
test('net revenue preserves exact zero, missing amounts and decimal precision',()=>{
 const h='external_id,menu_code,quantity,location,net_sales\n';
 const rows=parseSalesCsv(h+'a,PLATE,1,Kitchen,1500.25000000\nb,PLATE,1,Kitchen,0\nc,PLATE,1,Kitchen,');
 assert.equal(rows[0].net_sales,'1500.25000000');assert.equal(rows[1].net_sales,'0');assert.equal(rows[2].net_sales,undefined);
 for(const bad of['-1','1e3','NaN','0.000000001','1000000000001'])assert.throws(()=>parseSalesCsv(h+`a,PLATE,1,Kitchen,${bad}`));
});
