// Disposable SQL verification for the two-email user guide. No hosted credentials/data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {installAuthFixture,applyMigrations} from '../web/scripts/database-test-support.mjs';
const require=createRequire(new URL('../web/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();await installAuthFixture(db);await applyMigrations(db);
const users={A:randomUUID(),B:randomUUID()};let org;
async function login(who){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:users[who],role:'authenticated'})]);await db.exec('set local role authenticated');}
async function call(fn,command,payload={}){return(await db.query(`select public.${fn}($1,$2,$3,$4::jsonb) result`,[command,randomUUID(),org,JSON.stringify(payload)])).rows[0].result;}
const inv=(c,p)=>call('inventory_command',c,p),biz=(c,p)=>call('business_command',c,p);
async function denied(fn){await db.exec('savepoint expected');let e;try{await fn();}catch(error){e=error;}await db.exec('rollback to savepoint expected;release savepoint expected');assert.equal(e?.code,'42501');}
try{
await db.exec('begin');for(const [name,id]of Object.entries(users))await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`guide-${name.toLowerCase()}@test.invalid`]);
await login('A');org=(await call('profitplate_command','bootstrap',{name:'Two-account guide test'})).organization_id;
await db.exec('reset role');await db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'inventory_manager')",[org,users.B]);
await login('A');for(const who of ['A','B'])await inv('appoint_manager',{user_id:users[who],manager_role:'operations_manager'});
await call('control_command','assign_duty',{user_id:users.A,role:'procurement_officer',reason:'Owner acting as Procurement for the two-account test'});
await inv('prepare_areas');const areas=Object.fromEntries((await db.query('select area,location_id from public.operating_areas where organization_id=$1',[org])).rows.map(r=>[r.area,r.location_id]));
const today=(await db.query("select (now() at time zone 'Africa/Lagos')::date::text as d")).rows[0].d;
await inv('create_period',{starts_on:today,ends_on:today});
const item=(await inv('create_item',{sku:'EASY-RICE',name:'Easy Test Rice',category:'raw_material',base_uom_code:'kg'})).id;
const vendor=(await biz('save_vendor',{code:'EASY-SUPPLIER',name:'Easy Test Supplier'})).id;
await biz('save_vendor_item',{vendor_id:vendor,item_id:item,purchase_unit:'bag',base_quantity:'10',quoted_price:'1000',conversion_note:'Fictional test: one bag = 10 kg'});
const order=(await biz('create_purchase_order',{vendor_id:vendor,reason:'EASY-ORDER',lines:[{item_id:item,quantity:'2',unit_cost:'1000'}]})).id;
await biz('submit_purchase_order',{id:order});await denied(()=>biz('approve_purchase_order',{id:order}));
await login('B');await biz('approve_purchase_order',{id:order});
const receipt=(await biz('create_purchase_receipt',{id:order,event_date:today,location_id:areas.main_store,reason:'EASY-DELIVERY',lines:[{item_id:item,quantity:'2',rejected_quantity:'0'}]})).id;
assert.equal((await db.query('select status from public.inventory_documents where id=$1',[receipt])).rows[0].status,'posted');
await login('A');
const transfer=(await inv('create_document',{kind:'transfer',event_date:today,source_location_id:areas.main_store,destination_location_id:areas.kitchen,reason:'EASY-TO-KITCHEN',lines:[{item_id:item,quantity:'10'}]})).id;
await inv('submit_document',{id:transfer});await login('B');await inv('approve_document',{id:transfer});await login('A');await inv('receive_transfer',{id:transfer,reason:'Easy test kitchen acknowledgement',lines:[{item_id:item,quantity:'10'}]});
const recipe=(await inv('create_recipe',{code:'EASY-RECIPE',name:'Easy Rice Meal',kind:'final',standard_output:'1',lines:[{item_id:item,quantity:'2'}]})).id;
await biz('save_menu_item',{code:'EASY-MEAL',name:'Easy Rice Meal',recipe_id:recipe,default_area:'kitchen',revenue_class:'food'});
const sales=(await biz('create_sales_draft',{source_system:'EASY-POS',event_date:today,reason:'EASY-SALES',lines:[{external_id:'EASY-POS-001',menu_code:'EASY-MEAL',location_id:areas.kitchen,quantity:'3',net_sales:'1500'}]})).id;
await inv('submit_document',{id:sales});await login('B');await inv('approve_document',{id:sales});
const report=(await db.query('select public.operating_report($1,$2,$2) result',[org,today])).rows[0].result;
assert.equal(Number(report.sales.net_sales),1500);assert.equal(Number(report.sales.theoretical_cogs),600);assert.equal(Number(report.sales.theoretical_gross_profit),900);assert.equal(Number(report.sales.theoretical_gross_margin_pct),60);assert.equal(report.sales.actual_cogs,null);
const stock=(await db.query('select location_id,quantity::text quantity from public.stock_balances where item_id=$1',[item])).rows;
assert.equal(Number(stock.find(r=>r.location_id===areas.main_store).quantity),10);assert.equal(Number(stock.find(r=>r.location_id===areas.kitchen).quantity),4);
await db.exec('rollback');console.log('PASS: two accounts complete order, separate receiving/approval, transfer/confirmation and sales; stock 10 kg Main Store + 4 kg Kitchen; theoretical COGS NGN 600, GP NGN 900, margin 60%; self-approval denied for both accounts.');
}finally{await db.close();}
