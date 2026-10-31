import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { projectRoot } from './database-test-support.mjs';

// Only the local CLI supplies credentials. Never load .env.local or accept a remote URL.
const require=createRequire(import.meta.url);
const child=spawn(process.execPath,[require.resolve('supabase/dist/supabase.js'),'status','--output','json'],{
  cwd:projectRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
if (code!==0) throw new Error('Start the local Supabase stack with npm run db:start first.');
let config;
try { config=JSON.parse(output); } catch { throw new Error('Could not read local Supabase status JSON.'); }
const url=config.API_URL;
if (!url || new URL(url).hostname!=='127.0.0.1' || new URL(url).port!=='54321') throw new Error('Only the disposable local Supabase API is allowed.');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,config.SERVICE_ROLE_KEY,options);
const anonKey=config.ANON_KEY;
assert.ok(anonKey && config.SERVICE_ROLE_KEY,'Local legacy keys are required by this test runner.');
async function identity() {
  const password=randomBytes(24).toString('hex')+'aA1!';const email=`integration-${randomUUID()}@profitplate.test`;
  const created=await service.auth.admin.createUser({email,password,email_confirm:true});
  assert.ifError(created.error);
  const client=createClient(url,anonKey,options);
  assert.ifError((await client.auth.signInWithPassword({email,password})).error);
  return {client,id:created.data.user.id,email};
}
async function cmd(client,name,org,payload,key=randomUUID()) {
  const response=await client.rpc('profitplate_command',{p_command:name,p_request_id:key,p_organization_id:org,p_payload:payload});
  assert.ifError(response.error);return response.data;
}
let n=0;const pass=message=>console.log(`PASS API ${++n}: ${message}`);
const a=await identity(),b=await identity(),recipient=await identity();
const org=(await cmd(a.client,'bootstrap',null,{name:'API integration tenant A'})).organization_id;
const other=(await cmd(b.client,'bootstrap',null,{name:'API integration tenant B'})).organization_id;
assert.notEqual(org,other);pass('real Auth sessions can bootstrap independent tenants');
const item=(await cmd(a.client,'create_item',org,{sku:'API-001',name:'API test item',base_uom_code:'ml'})).id;
const foreign=await b.client.from('items').select('*').eq('id',item);
assert.ifError(foreign.error);assert.deepEqual(foreign.data,[]);pass('PostgREST enforces cross-tenant RLS');
assert.ok((await a.client.from('items').insert({organization_id:org,sku:'FORGED',name:'Forged',base_uom_code:'each'})).error);
assert.ok((await service.from('organizations').insert({name:'Service bypass attempt'})).error);
pass('ordinary and service-role direct mutation grants are denied');
const invite=(await cmd(a.client,'invite',org,{email:recipient.email,role:'viewer'})).id;
assert.ok((await a.client.rpc('claim_invitation_delivery',{p_invitation_id:invite})).error);
const claim=await service.rpc('claim_invitation_delivery',{p_invitation_id:invite});assert.ifError(claim.error);assert.ok(claim.data.token);
pass('only the delivery worker can mint an invitation token');
assert.ok((await b.client.rpc('profitplate_command',{p_command:'accept_invitation',p_request_id:randomUUID(),p_organization_id:org,p_payload:{id:invite,token:claim.data.token}})).error);
await cmd(recipient.client,'accept_invitation',org,{id:invite,token:claim.data.token});
const readable=await recipient.client.from('items').select('id').eq('id',item);assert.ifError(readable.error);assert.equal(readable.data.length,1);
pass('verified matching identity can accept and read shared master data');
await cmd(a.client,'suspend_member',org,{user_id:recipient.id,reason:'Integration suspension'});
const suspended=await recipient.client.from('items').select('*').eq('id',item);assert.ifError(suspended.error);assert.deepEqual(suspended.data,[]);
pass('an existing JWT loses tenant access immediately after suspension');
const audit=await a.client.rpc('search_audit_events',{p_organization_id:org,p_limit:2});assert.ifError(audit.error);assert.equal(audit.data.events.length,2);assert.ok(audit.data.next_cursor);
pass('audit pagination works through the real API');
console.log(`\n${n} local Supabase Auth/PostgREST scenarios passed. Test fixtures remain in this disposable local stack; db:reset clears them.`);
