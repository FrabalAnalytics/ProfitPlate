import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { installAuthFixture, applyMigrations, testConnectionString } from './database-test-support.mjs';

const local = process.argv.includes('--local');
const native = process.argv.includes('--native');
let db;
if (local || native) {
  const { Client } = await import('pg');
  // Never use app environment credentials: tests are for a disposable loopback DB only.
  const client = new Client({ connectionString: native ? testConnectionString() : 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await client.connect();
  db = { query: (sql, params) => client.query(sql, params), exec: (sql) => client.query(sql), close: () => client.end() };
} else {
  db = new PGlite();
  await installAuthFixture(db);
  await applyMigrations(db);
}
let passed = 0;
const query = (sql, params = []) => db.query(sql, params);
async function one(sql, params = []) { return (await query(sql, params)).rows[0]; }
async function login(user, role = 'authenticated', recent = true) {
  await db.exec('reset role');
  const claims = { sub: user, role, amr: [{ method: 'password', timestamp: Math.floor(Date.now()/1000) - (recent ? 0 : 3600) }] };
  await query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
  // Role is chosen from this fixed test-only set, never user input.
  assert.ok(['authenticated','anon','service_role'].includes(role));
  await db.exec(`set local role ${role}`);
}
async function admin() { await db.exec('reset role'); }
async function command(name, org, payload = {}, key = randomUUID()) {
  return (await one('select public.profitplate_command($1,$2,$3,$4::jsonb) as result', [name,key,org,JSON.stringify(payload)])).result;
}
async function denied(action, codes = ['42501']) {
  await db.exec('savepoint expected_failure');
  let error;
  try { await action(); } catch (e) { error = e; }
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  assert.ok(error, 'Expected database rejection');
  assert.ok(codes.includes(error.code), `Expected ${codes.join('/')} but got ${error.code}: ${error.message}`);
}
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${String(passed).padStart(2, '0')}: ${name}`);
}
const users = Object.fromEntries(['owner','other','admin','inventory','kitchen','bar','accountant','viewer','recipient','unverified','candidate','outsider'].map(k=>[k,randomUUID()]));
const email = (name) => `${name}-${users[name]}@profitplate.test`;
let org, otherOrg, item, location, revision, invitation, token, lease;
try {
  await db.exec('begin');
  for (const [name,id] of Object.entries(users)) {
    await query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)', [id,email(name),name==='unverified'?null:new Date().toISOString()]);
  }
  await test('anonymous and unverified callers cannot bootstrap', async () => {
    await login(null,'anon'); await denied(()=>command('bootstrap',null,{name:'Denied'}));
    await login(users.unverified); await denied(()=>command('bootstrap',null,{name:'Denied'}));
  });
  await test('bootstrap is atomic, retry-safe, and creates one owner', async () => {
    await login(users.owner);
    const key=randomUUID(); const result=await command('bootstrap',null,{name:'Tenant A'},key); org=result.organization_id;
    assert.deepEqual(await command('bootstrap',null,{name:'Tenant A'},key),result);
    await denied(()=>command('bootstrap',null,{name:'Different'},key),['22023']);
    await denied(()=>command('bootstrap',null,{name:'Second'}),['23514']);
    await admin(); await db.exec('set constraints all immediate; set constraints all deferred');
    assert.equal((await one("select count(*)::int as n from public.audit_events where organization_id=$1 and action='bootstrap'",[org])).n,1);
    await login(users.other); otherOrg=(await command('bootstrap',null,{name:'Tenant B'})).organization_id;
  });
  await test('own-account lookup is private, current, and excludes banned/deleted identities', async () => {
    await login(users.owner);
    const rows=(await query('select * from public.current_account()')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].id,users.owner);assert.equal(rows[0].email,email('owner'));
    await login(null,'anon');await denied(()=>query('select * from public.current_account()'));
    await login(null,'service_role');await denied(()=>query('select * from public.current_account()'));
    await admin();await query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[users.owner]);
    await login(users.owner);assert.equal((await query('select * from public.current_account()')).rows.length,0);
    await admin();await query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[users.owner]);
    await login(users.owner);assert.equal((await query('select * from public.current_account()')).rows.length,0);
    await admin();await query('update auth.users set deleted_at=null where id=$1',[users.owner]);
    await login(users.owner);
  });
  await test('fixed organization defaults and system units are seeded', async () => {
    await login(users.owner);
    const row=await one('select currency_code,timezone from public.organizations where id=$1',[org]);
    assert.deepEqual(row,{currency_code:'NGN',timezone:'Africa/Lagos'});
    assert.equal((await query('select * from public.units_of_measure')).rows.length,6);
    await denied(()=>command('update_organization',org,{name:'A',currency_code:'USD'}),['22023']);
  });
  await test('master creation normalizes codes and enforces tenant-local uniqueness', async () => {
    await login(users.owner);
    location=(await command('create_location',org,{code:'\t main \n',name:' Main store '})).id;
    assert.equal((await one('select code from public.locations where id=$1',[location])).code,'MAIN');
    item=(await command('create_item',org,{sku:'\t OIL-001 \n',name:'Bottled oil',base_uom_code:'ml'})).id;
    await denied(()=>command('create_item',org,{sku:'oil-001',name:'Duplicate SKU',base_uom_code:'ml'}),['23505']);
    await denied(()=>command('create_item',org,{sku:'OIL-002',name:' bottled OIL ',base_uom_code:'ml'}),['23505']);
    await login(users.other);
    await command('create_item',otherOrg,{sku:'OIL-001',name:'Bottled oil',base_uom_code:'ml'});
  });
  await test('guessed foreign IDs cannot read or mutate another tenant', async () => {
    await login(users.other);
    assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,0);
    assert.equal((await query('select * from public.locations where id=$1',[location])).rows.length,0);
    assert.equal((await query('select * from public.organizations where id=$1',[org])).rows.length,0);
    assert.equal((await query('select * from public.audit_events where organization_id=$1',[org])).rows.length,0);
    await denied(()=>command('update_item',org,{id:item,sku:'HACK',name:'HACK',is_active:true}));
    await denied(()=>command('update_item',otherOrg,{id:item,sku:'HACK',name:'HACK',is_active:true}),['22023']);
  });
  await test('all direct application writes and worker RPC access are denied', async () => {
    await login(users.owner);
    for (const table of ['organizations','organization_memberships','locations','units_of_measure','items','item_conversion_revisions','organization_invitations','audit_events']) {
      await denied(()=>query(`delete from public.${table}`));
    }
    await denied(()=>query('select * from private.command_requests'));
    await denied(()=>query('select public.claim_invitation_delivery($1)',[randomUUID()]));
    await denied(()=>query('select private.require_actor()'));
  });
  await test('exactly one owner is required even for privileged SQL', async () => {
    await admin();
    await denied(async()=>{
      await query("insert into public.organizations(name) values('Ownerless')");
      await db.exec('set constraints all immediate');
    },['23514']);
    await denied(async()=>{
      await query("update public.organization_memberships set role='admin' where organization_id=$1 and role='owner'",[org]);
      await db.exec('set constraints all immediate');
    },['23514']);
    await denied(()=>query('delete from auth.users where id=$1',[users.owner]),['23503','23001']);
  });
  await test('identities, base unit, and inactive SKU reservations are enforced', async () => {
    await admin();
    await denied(()=>query("update public.items set base_uom_code='kg' where id=$1",[item]),['23514']);
    await denied(()=>query('update public.items set organization_id=$1 where id=$2',[otherOrg,item]),['23514']);
    await denied(()=>query('delete from public.items where id=$1',[item]));
    await login(users.owner);
    await command('update_item',org,{id:item,sku:'OIL-001',name:'Bottled oil',is_active:false});
    await denied(()=>command('create_item',org,{sku:'oil-001',name:'Replacement',base_uom_code:'ml'}),['23505']);
    await command('update_item',org,{id:item,sku:'OIL-001',name:'Bottled oil',is_active:true});
  });
  await test('conversion revisions preserve history and allow one active source mapping', async () => {
    revision=(await command('supersede_conversion',org,{item_id:item,source_uom_code:'each',factor:'700'})).id;
    const next=(await command('supersede_conversion',org,{item_id:item,source_uom_code:'each',factor:'750'})).id;
    const rows=(await query('select id,factor::text,retired_at from public.item_conversion_revisions where item_id=$1 order by revision',[item])).rows;
    assert.equal(rows.length,2); assert.ok(rows[0].retired_at); assert.equal(rows[1].retired_at,null);
    assert.equal(rows[0].factor,'700.000000000000'); assert.equal(rows[1].id,next);
    const safe=await one('select factor from public.item_conversion_history where id=$1',[next]);
    assert.equal(typeof safe.factor,'string');
    await login(users.other);
    assert.equal((await query('select * from public.item_conversion_history where item_id=$1',[item])).rows.length,0);
    await admin();
    await denied(()=>query('update public.item_conversion_revisions set factor=800 where id=$1',[revision]),['23514']);
    await denied(()=>query('update public.item_conversion_revisions set retired_at=null where id=$1',[revision]),['23514']);
    await denied(()=>query('delete from public.item_conversion_revisions where id=$1',[revision]));
    await denied(()=>query("insert into public.item_conversion_revisions(organization_id,item_id,source_uom_code,target_uom_code,factor,revision,created_by) values($1,$2,'each','ml',800,3,$3)",[org,item,users.owner]),['23505']);
    await denied(()=>query("insert into public.item_conversion_revisions(organization_id,item_id,source_uom_code,target_uom_code,factor,revision,created_by) values($1,$2,'g','ml',800,3,$3)",[otherOrg,item,users.owner]),['23514','23503']);
  });
  await test('invalid, ambiguous, rounded, and unsupported conversion factors fail', async () => {
    await login(users.owner);
    for (const factor of ['0','-1','1000000001','NaN','1.0000000000001','1e3']) {
      await denied(()=>command('supersede_conversion',org,{item_id:item,source_uom_code:'each',factor}),['22023','23514']);
    }
    await denied(()=>command('supersede_conversion',org,{item_id:item,source_uom_code:'each',factor:700}),['22023']);
    await denied(()=>command('supersede_conversion',org,{item_id:item,source_uom_code:'l',factor:'1000'}),['23514']);
    await denied(()=>command('supersede_conversion',org,{item_id:item,source_uom_code:'ml',factor:'1'}),['23514']);
    await denied(()=>command('supersede_conversion',org,{item_id:item,source_uom_code:'g',factor:'1'}),['23514']);
    await command('supersede_conversion',org,{item_id:item,source_uom_code:'g',factor:'1.1',supporting_note:'Measured density for this item'});
  });
  await test('role matrix permits shared reads and restricts editing/team/audit access', async () => {
    await admin();
    for (const name of ['admin','inventory','kitchen','bar','accountant','viewer','candidate']) {
      const role={inventory:'inventory_manager',kitchen:'kitchen_lead',bar:'bar_lead',candidate:'viewer'}[name]??name;
      await query('insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',[org,users[name],role]);
    }
    for (const name of ['admin','inventory','kitchen','bar','accountant','viewer']) {
      await login(users[name]);
      assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,1);
      assert.equal((await query('select * from public.item_conversion_revisions where id=$1',[revision])).rows.length,1);
      const canAudit=['admin','accountant'].includes(name);
      assert.equal((await query('select * from public.audit_events where organization_id=$1',[org])).rows.length>0,canAudit);
      const canTeam=name==='admin';
      assert.equal((await query('select * from public.organization_memberships where organization_id=$1',[org])).rows.length>1,canTeam);
      if (!['admin','inventory'].includes(name)) await denied(()=>command('create_item',org,{sku:`DENIED-${name}`,name,base_uom_code:'each'}));
      if (!canTeam) await denied(()=>command('create_location',org,{code:'DENIED',name:'Denied'}));
    }
    await login(users.inventory); await command('create_item',org,{sku:'INV-001',name:'Inventory-managed item',base_uom_code:'g'});
  });
  await test('invites grant no access and store no plaintext token', async () => {
    await login(users.owner);
    invitation=(await command('invite',org,{email:email('recipient').toUpperCase(),role:'viewer'})).id;
    await denied(()=>command('invite',org,{email:email('recipient'),role:'viewer'}),['23505']);
    await denied(()=>command('invite',org,{email:email('outsider'),role:'owner'}),['23514']);
    await login(users.recipient);
    assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,0);
    assert.equal((await query('select * from public.organization_invitations where id=$1',[invitation])).rows.length,0);
    await login(null,'service_role');
    const jobs=(await query('select * from public.pending_invitation_deliveries()')).rows;
    assert.ok(jobs.some(j=>j.invitation_id===invitation));
    const delivery=(await one('select public.claim_invitation_delivery($1) as result',[invitation])).result;
    token=delivery.token; lease=delivery.lease_id;
    assert.equal(token.length,64);
    assert.equal((await one('select public.claim_invitation_delivery($1) as result',[invitation])).result,null);
    await denied(()=>query('select * from private.invitation_secrets'));
    assert.equal((await one('select public.complete_invitation_delivery($1,$2,false,$3) as result',[invitation,lease,'PROVIDER_TIMEOUT'])).result,true);
    await login(users.owner);
    const status=(await query('select * from public.invitation_delivery_status($1)',[org])).rows.find(r=>r.invitation_id===invitation);
    assert.equal(status.state,'failed');
  });
  await test('resend rotates credentials and stale delivery completions cannot win', async () => {
    await command('resend_invitation',org,{id:invitation});
    await login(users.recipient);
    await denied(()=>command('accept_invitation',org,{id:invitation,token}));
    await login(null,'service_role');
    const delivery=(await one('select public.claim_invitation_delivery($1) as result',[invitation])).result;
    assert.notEqual(delivery.token,token); token=delivery.token;
    assert.equal((await one('select public.complete_invitation_delivery($1,$2,true) as result',[invitation,lease])).result,false);
    assert.equal((await one('select public.complete_invitation_delivery($1,$2,true) as result',[invitation,delivery.lease_id])).result,true);
  });
  await test('wrong identity, invalid token, and unverified identity cannot accept', async () => {
    await login(users.outsider); await denied(()=>command('accept_invitation',org,{id:invitation,token}));
    await login(users.recipient); await denied(()=>command('accept_invitation',org,{id:invitation,token:'invalid'}));
    await login(users.unverified); await denied(()=>command('accept_invitation',org,{id:invitation,token}));
  });
  await test('acceptance and subsequent retries create one membership and one audit event', async () => {
    await login(users.recipient);
    const key=randomUUID(); const result=await command('accept_invitation',org,{id:invitation,token},key);
    assert.deepEqual(await command('accept_invitation',org,{id:invitation,token},key),result);
    assert.deepEqual(await command('accept_invitation',org,{id:invitation,token}),result);
    assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,1);
    await admin();
    assert.equal((await one("select count(*)::int as n from public.audit_events where entity_id=$1 and action='accept_invitation'",[invitation])).n,1);
    const persisted=JSON.stringify((await query('select * from private.command_requests')).rows);
    assert.ok(!persisted.includes(token));
    assert.ok(!JSON.stringify((await query('select * from public.audit_events')).rows).includes(email('recipient')));
  });
  async function inviteAndClaim(name, inviter=users.owner) {
    await login(inviter); const id=(await command('invite',org,{email:email(name),role:'viewer'})).id;
    await login(null,'service_role'); const result=(await one('select public.claim_invitation_delivery($1) as result',[id])).result;
    return {id,token:result.token};
  }
  await test('revocation prevents acceptance even with a previously valid token', async () => {
    const invite=await inviteAndClaim('outsider');
    await login(users.owner); await command('revoke_invitation',org,{id:invite.id,reason:'Sent in error'});
    await login(users.outsider); await denied(()=>command('accept_invitation',org,invite));
  });
  await test('expiry is checked during acceptance without a cleanup job', async () => {
    const invite=await inviteAndClaim('outsider');
    await admin(); await query("update public.organization_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[invite.id]);
    await login(users.outsider); await denied(()=>command('accept_invitation',org,invite));
    await admin(); await query("update public.organization_invitations set status='expired' where id=$1",[invite.id]);
  });
  await test('loss of inviter authority prevents acceptance', async () => {
    const invite=await inviteAndClaim('outsider',users.admin);
    await login(users.owner); await command('change_member_role',org,{user_id:users.admin,role:'viewer',reason:'Role changed'});
    await login(users.outsider); await denied(()=>command('accept_invitation',org,invite));
    await login(users.owner); await command('change_member_role',org,{user_id:users.admin,role:'admin',reason:'Restore administration'});
    await command('revoke_invitation',org,{id:invite.id,reason:'Test complete'});
  });
  await test('suspension removes access and cannot be bypassed through invitation', async () => {
    await login(users.owner); await command('suspend_member',org,{user_id:users.recipient,reason:'Access review'});
    await login(users.recipient);
    assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,0);
    await denied(()=>command('create_item',org,{sku:'NO',name:'No',base_uom_code:'each'}));
    await login(users.owner);
    await denied(()=>command('invite',org,{email:email('recipient'),role:'viewer'}),['22023']);
    await command('reactivate_member',org,{user_id:users.recipient,reason:'Review completed'});
    await login(users.recipient); assert.equal((await query('select * from public.items where id=$1',[item])).rows.length,1);
  });
  await test('a previously issued invitation cannot reactivate an existing suspended membership', async () => {
    const invite=await inviteAndClaim('outsider');
    await admin();
    await query("insert into public.organization_memberships(organization_id,user_id,role,status) values($1,$2,'viewer','suspended')",[org,users.outsider]);
    await login(users.outsider); await denied(()=>command('accept_invitation',org,invite));
    await login(users.owner); await command('revoke_invitation',org,{id:invite.id,reason:'Existing suspension preserved'});
  });
  await test('location editing and conversion retirement are audited and preserve history', async () => {
    await login(users.owner);
    await command('update_location',org,{id:location,code:' main ',name:'Renamed store',is_active:false});
    assert.equal((await one('select is_active from public.locations where id=$1',[location])).is_active,false);
    const active=await one("select id from public.item_conversion_revisions where item_id=$1 and source_uom_code='each' and retired_at is null",[item]);
    await command('retire_conversion',org,{id:active.id,reason:'Pack definition retired'});
    assert.ok((await one('select retired_at from public.item_conversion_revisions where id=$1',[active.id])).retired_at);
    const audit=await one("select details from public.audit_events where entity_id=$1 and action='update_location'",[location]);
    assert.equal(audit.details.before.name,'Main store');assert.equal(audit.details.after.name,'Renamed store');
  });
  await test('admins cannot alter ownership, the owner, or their own membership', async () => {
    await login(users.admin);
    await denied(()=>command('suspend_member',org,{user_id:users.owner,reason:'Denied'}));
    await denied(()=>command('change_member_role',org,{user_id:users.admin,role:'viewer',reason:'Denied'}));
    await denied(()=>command('change_member_role',org,{user_id:users.viewer,role:'owner',reason:'Denied'}));
    await denied(()=>command('transfer_ownership',org,{user_id:users.viewer,reason:'Denied'}));
  });
  await test('ownership transfer rejects stale reauthentication and existing owners', async () => {
    await login(users.owner,'authenticated',false);
    await denied(()=>command('transfer_ownership',org,{user_id:users.candidate,reason:'Transfer'}));
    await admin(); await query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'admin')",[org,users.other]);
    await login(users.owner);
    await denied(()=>command('transfer_ownership',org,{user_id:users.other,reason:'Transfer'}),['23514']);
    assert.equal((await one("select user_id from public.organization_memberships where organization_id=$1 and role='owner'",[org])).user_id,users.owner);
  });
  await test('valid transfer is atomic and retry-safe with the former owner demoted', async () => {
    const key=randomUUID(),payload={user_id:users.candidate,reason:'Appoint new owner'};
    const result=await command('transfer_ownership',org,payload,key);
    assert.deepEqual(await command('transfer_ownership',org,payload,key),result);
    await admin(); await db.exec('set constraints all immediate; set constraints all deferred');
    assert.equal((await one("select user_id from public.organization_memberships where organization_id=$1 and role='owner'",[org])).user_id,users.candidate);
    assert.equal((await one('select role from public.organization_memberships where organization_id=$1 and user_id=$2',[org,users.owner])).role,'admin');
  });
  await test('audit actor cannot be forged and events cannot be edited or deleted', async () => {
    await login(users.candidate);
    await denied(()=>command('update_organization',org,{name:'Spoofed',actor_id:users.other}),['22023']);
    const key=randomUUID(); await command('update_organization',org,{name:'Renamed restaurant'},key);
    const event=await one('select * from public.audit_events where request_id=$1',[key]);
    assert.equal(event.actor_id,users.candidate);
    await admin();
    await denied(()=>query("update public.audit_events set action='forged' where id=$1",[event.id]));
    await denied(()=>query('delete from public.audit_events where id=$1',[event.id]));
  });
  await test('every foundation table has RLS and there are no public mutation grants', async () => {
    await admin();
    const rows=(await query("select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('organizations','organization_memberships','locations','units_of_measure','items','item_conversion_revisions','organization_invitations','audit_events')))")).rows;
    assert.equal(rows.length,11); assert.ok(rows.every(r=>r.relrowsecurity));
    for (const role of ['anon','authenticated','service_role']) {
      const privileges=await one("select has_table_privilege($1,'public.items','INSERT,UPDATE,DELETE') as writable",[role]);
      assert.equal(privileges.writable,false);
    }
  });
  await test('audit search has stable tenant-scoped pagination and filters', async () => {
    await login(users.candidate);
    const ids=new Set(); let cursor=null;
    do {
      const page=(await one('select public.search_audit_events($1,3,$2) as result',[org,cursor])).result;
      assert.ok(page.events.length<=3);
      for (const event of page.events) { assert.equal(event.organization_id,org); assert.ok(!ids.has(event.id)); ids.add(event.id); }
      cursor=page.next_cursor;
    } while (cursor);
    assert.equal(ids.size,(await one('select count(*)::int as n from public.audit_events where organization_id=$1',[org])).n);
    const filtered=(await one("select public.search_audit_events($1,p_action=>'bootstrap') as result",[org])).result;
    assert.equal(filtered.events.length,1);
    await denied(()=>query('select public.search_audit_events($1)',[otherOrg]));
    const foreignFilter=(await one('select public.search_audit_events($1,p_entity_id=>$2) as result',[org,otherOrg])).result;
    assert.equal(foreignFilter.events.length,0);
    await denied(()=>query("select public.search_audit_events($1,p_cursor=>'invalid')",[org]),['22023']);
    await login(users.viewer); await denied(()=>query('select public.search_audit_events($1)',[org]));
  });
  console.log(`\n${passed} database scenarios passed (${local?'local Supabase PostgreSQL':native?'native PostgreSQL 17':'isolated PostgreSQL / PGlite'}).`);
  if (!local) console.log('Auth is emulated; hosted Auth/PostgREST and independent-session concurrency remain separate integration checks.');
} finally {
  await db.exec('rollback');
  await db.close();
}
