import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTableValues as compare } from '../lib/table-sort.ts';
test('financial tables sort grouped currency and large decimals by exact value',()=>{
  assert.ok(compare('\u20a61,500.00','\u20a6950.00',true)>0);
  assert.ok(compare('9999999999999999.99','10000000000000000.00',true)<0);
  assert.ok(compare('-\u20a61,500.00','-\u20a6950.00',true)<0);
  assert.equal(compare('NGN 1,500.00','1500.0000',true),0);
});
test('quantities and Lagos display dates retain their intended ordering',()=>{
  assert.ok(compare('10.000 kg','2.000 kg',true)>0);
  assert.ok(compare('31/10/2026, 23:59','01/11/2026, 00:01',false)<0);
  assert.ok(compare('02/11/2026','31/10/2026',false)>0);
});
