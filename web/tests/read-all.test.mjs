import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll } from '../lib/read-all.ts';
test('complete review reads cross API row caps without gaps', async () => {
  const rows = Array.from({length:1201}, (_, id) => ({id}));
  for (const cap of [37, 200, 1000]) {
    const query = {range: async (from,to) => ({data:rows.slice(from,Math.min(to+1,from+cap)),count:rows.length,error:null})};
    const result = await readAll(query);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, rows);
  }
});
test('a partial review cannot expose actionable rows', async () => {
  const result = await readAll({range:async from => ({data:from===0?[{id:1}]:[],count:200,error:null})});
  assert.ok(result.error);
  assert.deepEqual(result.data, []);
});
test('failed, uncounted and changing evidence reads fail closed', async () => {
  for(const query of [
    {range:async()=>({data:null,count:null,error:new Error('offline')})},
    {range:async()=>({data:[{id:1}],count:null,error:null})},
    {range:async from=>({data:[{id:from}],count:from?3:2,error:null})},
  ]) {
    const result=await readAll(query);assert.ok(result.error);assert.deepEqual(result.data,[]);
  }
});
