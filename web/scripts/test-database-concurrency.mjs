import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { testConnectionString } from './database-test-support.mjs';

const connectionString=testConnectionString();
const observer=new Client({connectionString}); await observer.connect();
const connections=new Set();
async function session(actor,role='authenticated') {
  const client=new Client({connectionString}); await client.connect(); connections.add(client);
  await client.query("set statement_timeout='10s'");
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role,amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}]})]);
  assert.ok(['authenticated','service_role'].includes(role));
  await client.query(`set local role ${role}`);
  return client;
}
async function finish(client,commit=true) {
  try { await client.query(commit?'commit':'rollback'); } finally { await client.end(); connections.delete(client); }
}
async function cmd(client,name,org,payload,key=randomUUID()) {
  return (await client.query('select public.profitplate_command($1,$2,$3,$4::jsonb) as result',[name,key,org,JSON.stringify(payload)])).rows[0].result;
}
async function invoke(actor,name,org,payload,key) {
  const client=await session(actor);
  try { const result=await cmd(client,name,org,payload,key); await finish(client); return result; }
  catch (error) { if(connections.has(client)) await finish(client,false); throw error; }
}
async function user() {
  const id=randomUUID();
  await observer.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${id}@profitplate.test`]);
  return id;
}
async function organization() { const owner=await user(); const org=(await invoke(owner,'bootstrap',null,{name:'Concurrency tenant'})).organization_id; return {owner,org}; }
async function member(org,role='viewer') { const id=await user(); await observer.query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[org,id,role]); return id; }
async function blocked(client) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    const row=(await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[client.processID])).rows[0];
    if (row?.wait_event_type==='Lock') return;
    await delay(20);
  }
  throw new Error('Expected a competing session to wait for a database lock');
}
async function race(first,second,firstAction,secondAction) {
  const result=await firstAction(first);
  // Capture rejection immediately so it cannot become an unhandled promise rejection.
  const pending=secondAction(second).then(value=>({value}),error=>({error}));
  await blocked(second);
  await finish(first);
  const outcome=await pending;
  await finish(second,!outcome.error);
  return {result,...outcome};
}
let passed=0;
async function test(name,fn) { await fn(); console.log(`PASS race ${++passed}: ${name}`); }
try {
  await test('simultaneous bootstrap retries return one organization and audit event',async()=>{
    const actor=await user(),key=randomUUID();
    const result=await race(await session(actor),await session(actor),
      c=>cmd(c,'bootstrap',null,{name:'Retry tenant'},key),c=>cmd(c,'bootstrap',null,{name:'Retry tenant'},key));
    assert.ifError(result.error); assert.deepEqual(result.result,result.value);
    assert.equal((await observer.query('select count(*)::int as n from public.audit_events where request_id=$1',[key])).rows[0].n,1);
  });
  await test('competing ownership transfers preserve one owner',async()=>{
    const {owner,org}=await organization();const a=await member(org),b=await member(org);
    const result=await race(await session(owner),await session(owner),
      c=>cmd(c,'transfer_ownership',org,{user_id:a,reason:'First transfer'}),c=>cmd(c,'transfer_ownership',org,{user_id:b,reason:'Competing transfer'}));
    assert.equal(result.error?.code,'42501');
    assert.equal((await observer.query("select user_id from public.organization_memberships where organization_id=$1 and role='owner'",[org])).rows[0].user_id,a);
  });
  await test('cross-organization transfers cannot give one user two owned organizations',async()=>{
    const a=await organization(),b=await organization(),recipient=await member(a.org);
    await observer.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'viewer')",[b.org,recipient]);
    const result=await race(await session(a.owner),await session(b.owner),
      c=>cmd(c,'transfer_ownership',a.org,{user_id:recipient,reason:'First transfer'}),c=>cmd(c,'transfer_ownership',b.org,{user_id:recipient,reason:'Competing transfer'}));
    assert.equal(result.error?.code,'23514');
    assert.equal((await observer.query("select count(*)::int as n from public.organization_memberships where user_id=$1 and role='owner'",[recipient])).rows[0].n,1);
  });
  async function invitationFixture() {
    const {owner,org}=await organization(),recipient=await user();
    const invite=(await invoke(owner,'invite',org,{email:`${recipient}@profitplate.test`,role:'viewer'})).id;
    const worker=await session(null,'service_role');
    const delivery=(await worker.query('select public.claim_invitation_delivery($1) as result',[invite])).rows[0].result;
    await finish(worker);
    return {owner,org,recipient,invite,token:delivery.token};
  }
  await test('accept wins before revoke: one membership and no contradictory revocation',async()=>{
    const {owner,org,recipient,invite,token}=await invitationFixture();
    const result=await race(await session(recipient),await session(owner),
      c=>cmd(c,'accept_invitation',org,{id:invite,token}),c=>cmd(c,'revoke_invitation',org,{id:invite,reason:'Race'}));
    assert.equal(result.error?.code,'22023');
    assert.equal((await observer.query('select status from public.organization_invitations where id=$1',[invite])).rows[0].status,'accepted');
  });
  await test('revoke wins before accept: no membership is granted',async()=>{
    const {owner,org,recipient,invite,token}=await invitationFixture();
    const result=await race(await session(owner),await session(recipient),
      c=>cmd(c,'revoke_invitation',org,{id:invite,reason:'Race'}),c=>cmd(c,'accept_invitation',org,{id:invite,token}));
    assert.equal(result.error?.code,'42501');
    assert.equal((await observer.query('select count(*)::int as n from public.organization_memberships where organization_id=$1 and user_id=$2',[org,recipient])).rows[0].n,0);
  });
  await test('competing conversion changes retain both revisions and one active mapping',async()=>{
    const {owner,org}=await organization();
    const item=(await invoke(owner,'create_item',org,{sku:'BOTTLE',name:'Bottle',base_uom_code:'ml'})).id;
    const result=await race(await session(owner),await session(owner),
      c=>cmd(c,'supersede_conversion',org,{item_id:item,source_uom_code:'each',factor:'700'}),c=>cmd(c,'supersede_conversion',org,{item_id:item,source_uom_code:'each',factor:'750'}));
    assert.ifError(result.error);
    const rows=(await observer.query('select revision,retired_at from public.item_conversion_revisions where item_id=$1 order by revision',[item])).rows;
    assert.equal(rows.length,2);assert.ok(rows[0].retired_at);assert.equal(rows[1].retired_at,null);
  });
  await test('a waiting write rechecks membership after suspension commits',async()=>{
    const {owner,org}=await organization(); const inventory=await member(org,'inventory_manager');
    const result=await race(await session(owner),await session(inventory),
      c=>cmd(c,'suspend_member',org,{user_id:inventory,reason:'Suspend access'}),c=>cmd(c,'create_item',org,{sku:'DENIED',name:'Denied',base_uom_code:'each'}));
    assert.equal(result.error?.code,'42501');
    assert.equal((await observer.query('select count(*)::int as n from public.items where organization_id=$1',[org])).rows[0].n,0);
  });
  await test('simultaneous delivery workers receive only one active lease/token',async()=>{
    const {owner,org}=await organization();const recipient=await user();
    const id=(await invoke(owner,'invite',org,{email:`${recipient}@profitplate.test`,role:'viewer'})).id;
    const result=await race(await session(null,'service_role'),await session(null,'service_role'),
      c=>c.query('select public.claim_invitation_delivery($1) as result',[id]),c=>c.query('select public.claim_invitation_delivery($1) as result',[id]));
    assert.ifError(result.error);assert.ok(result.result.rows[0].result.token);assert.equal(result.value.rows[0].result,null);
  });
  console.log(`\n${passed} independent-session concurrency scenarios passed.`);
} finally {
  for (const client of connections) { try { await client.query('rollback'); } finally { await client.end(); } }
  await observer.end();
}
