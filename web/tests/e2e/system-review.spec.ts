import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
const api="http://127.0.0.1:54329", org="55555555-5555-4555-8555-555555555555", base=`/workspace/${org}`;
test.describe.configure({mode:"serial"});
let submittedId="", oldestId="", itemId="", recipeId="", firstVersion="";
async function token(request:APIRequestContext,name:string) {
  const response=await request.post(`${api}/auth/v1/token?grant_type=password`,{data:{email:`business-${name}@profitplate.test`,password:"ProfitPlate-test-2026!"}});
  expect(response.ok()).toBeTruthy(); return (await response.json()).access_token as string;
}
async function command(request:APIRequestContext,access:string,fn:string,operation:string,payload:unknown) {
  const response=await request.post(`${api}/rest/v1/rpc/${fn}`,{headers:{Authorization:`Bearer ${access}`},data:{p_organization_id:org,p_command:operation,p_request_id:randomUUID(),p_payload:payload}});
  expect(response.ok(),`${operation}: ${await response.text()}`).toBeTruthy();return await response.json();
}
async function login(page:Page,email:string,destination:string) {
  await page.goto("/sign-in");await page.getByLabel("Email address",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill("ProfitPlate-test-2026!");await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(destination);
}
test.beforeAll(async({request})=>{
  test.setTimeout(180000);
  const store=await token(request,"store"),buyer=await token(request,"buyer");
  const vendor=await command(request,buyer,"business_command","save_vendor",{code:"REVIEW-VOLUME",name:"Review volume supplier",is_active:true});
  const lines=[];
  for(let n=0;n<200;n++) {
    const item=await command(request,store,"inventory_command","create_item",{sku:`REVIEW-${n}`,name:`Review item ${n}`,category:"raw_material",base_uom_code:"kg"});
    await command(request,buyer,"business_command","save_vendor_item",{vendor_id:vendor.id,item_id:item.id,purchase_unit:"bag",base_quantity:"1",quoted_price:"1",conversion_note:"Disposable regression fixture",is_active:true});
    lines.push({item_id:item.id,quantity:"1",unit_cost:"1"});
  }
  itemId=lines[0].item_id;
  for(let n=0;n<51;n++) {
    const order=await command(request,buyer,"business_command","create_purchase_order",{vendor_id:vendor.id,reason:`Review volume order ${n+1}`,lines:n<6?lines:[lines[0]]});
    if(n===0)oldestId=order.id;
    if(n===5)submittedId=order.id;
  }
  await command(request,buyer,"business_command","submit_purchase_order",{id:submittedId});
  const recipe=await command(request,store,"inventory_command","create_recipe",{code:"REVIEW-RECIPE",name:"Review recipe",kind:"final",standard_output:"2",lines:[{item_id:itemId,quantity:"1.234567"}]});
  recipeId=recipe.id;
  const versions=await request.get(`${api}/rest/v1/recipe_versions?recipe_id=eq.${recipeId}&select=id`,{headers:{Authorization:`Bearer ${store}`}});
  firstVersion=(await versions.json())[0].id;
});
test("complete approval evidence crosses API caps and old orders remain discoverable",async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1440,height:960});
  await login(page,"business-gm@profitplate.test",base);
  await page.goto(`${base}/approvals?q=Review%20volume%20order%206`);
  const card=page.locator("details.approval-card").filter({hasText:"Review volume order 6"});
  await card.locator(":scope > summary").click();
  await card.getByRole("combobox",{name:"Rows per page",exact:true}).selectOption("200");
  await expect(card.getByRole("row")).toHaveCount(201);
  await expect(card.getByRole("cell",{name:"Review item 199",exact:true})).toBeVisible();
  await expect(card.getByRole("button",{name:"Approve",exact:true})).toBeVisible();
  await mkdir(".tooling/previews",{recursive:true});
  await page.screenshot({path:".tooling/previews/review-approval-complete-1440.png",fullPage:true});
  await page.goto(`${base}/purchasing?q=Review%20volume`);
  await expect(page.getByRole("table",{name:"Purchase orders",exact:true}).getByRole("row")).toHaveCount(26);
  await page.screenshot({path:".tooling/previews/review-purchasing-index-1440.png",fullPage:true});
  await page.getByRole("link",{name:"Next page",exact:true}).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation",{name:"purchase orders pages",exact:true})).toContainText("Page 2 of 3");
  await page.getByRole("link",{name:"Next page",exact:true}).click();
  await expect(page).toHaveURL(/page=3/);
  await expect(page.getByRole("navigation",{name:"purchase orders pages",exact:true})).toContainText("Page 3 of 3");
  await expect(page.getByRole("table",{name:"Purchase orders",exact:true})).toContainText("Review volume order 1");
  await page.goto(`${base}/purchasing?record=${oldestId}`);
  await expect(page.getByRole("article")).toContainText("Review volume order 1");
});
test("partial child evidence withholds approval controls",async({page,request})=>{
  await login(page,"business-gm@profitplate.test",base);
  const fault=await request.post(`${api}/__test/incomplete-evidence`,{data:{enabled:true}});
  expect(fault.ok()).toBeTruthy();
  expect(await fault.json()).toEqual({enabled:true});
  try {
    await page.goto(`${base}/approvals?q=Review%20volume%20order%206`);
    await expect(page.getByRole("heading",{name:"We couldn’t load this page.",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Approve",exact:true})).toHaveCount(0);
  }finally{await request.post(`${api}/__test/incomplete-evidence`,{data:{enabled:false}});}
});
test("report cycles, recoverable validation and phone stock cards",async({page})=>{
  const reportBase="/workspace/66666666-6666-4666-8666-666666666666";
  await login(page,"report-owner@profitplate.test",reportBase);
  await page.goto(`${reportBase}/reports?start=2026-10-26&end=2026-10-27`);
  await page.getByLabel("Report cycle",{exact:true}).selectOption("weekly");
  await page.getByRole("button",{name:"View report",exact:true}).click();
  await expect(page.getByRole("region",{name:"Report context",exact:true})).toContainText("2026-10-26 to 2026-11-01");
  await page.goto(`${reportBase}/reports?start=2026-10-31&end=2026-10-01`);
  await expect(page.getByRole("heading",{name:"Reports",exact:true})).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("on or after");
  await expect(page.getByRole("button",{name:"View report",exact:true})).toBeVisible();
  await page.getByLabel("End date (custom range)",{exact:true}).fill("2026-10-31");
  await page.getByRole("button",{name:"View report",exact:true}).click();
  await expect(page.getByRole("region",{name:"Report context",exact:true})).toBeVisible();
  await page.setViewportSize({width:375,height:900});
  await page.goto(`${reportBase}/inventory?view=stock`);
  await expect(page.locator("td.numeric").first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await page.locator(".inventory-table-wrap").evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
  await page.screenshot({path:".tooling/previews/review-stock-375.png",fullPage:true});
});
test("item lifecycle, copied recipe revisions and scoped audit history",async({page,browser})=>{
  test.setTimeout(120000);
  await login(page,"business-store@profitplate.test",base);
  await page.goto(`${base}/items/${itemId}`);
  await page.getByLabel("Item name",{exact:true}).fill("Review maintained item");
  await page.getByLabel("Status",{exact:true}).selectOption("false");
  await page.getByRole("button",{name:"Save item changes",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Item details saved");
  await expect(page.getByRole("heading",{name:"Review maintained item",exact:true})).toBeVisible();
  await page.getByLabel("Status",{exact:true}).selectOption("true");
  await page.getByRole("button",{name:"Save item changes",exact:true}).click();
  await page.goto(`${base}/recipes/${recipeId}`);
  const revision=page.getByRole("heading",{name:"Revise this recipe",exact:true}).locator("..");
  await expect(revision.getByLabel("Quantity 1",{exact:true})).toHaveValue("1.234567");
  await revision.getByLabel("Quantity 1",{exact:true}).fill("2.345678");
  await revision.getByRole("button",{name:"Save new version",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipeId}`));
  await expect(page.locator(".role-pill")).toHaveText("Version 2 · Current");
  await page.goto(`${base}/recipes/${recipeId}?version=${firstVersion}`);
  await expect(page.getByRole("cell",{name:"1.235",exact:true})).toBeVisible();
  await expect(page.getByLabel("Quantity 1",{exact:true})).toHaveValue("1.234567");
  const context=await browser.newContext();
  try {
    const owner=await context.newPage();await login(owner,"business-owner@profitplate.test",base);
    await owner.goto(`${base}/audit?action=update_item`);
    await expect(owner.getByRole("table",{name:"Audit events",exact:true})).toContainText("update item");
    await owner.getByLabel("Action",{exact:true}).fill("unknown_action");await owner.getByRole("button",{name:"Filter audit history",exact:true}).click();
    await expect(owner.getByText("No records yet.",{exact:true})).toBeVisible();
    await owner.goto("/workspace/22222222-2222-4222-8222-222222222222/audit");
    await expect(owner.getByRole("heading",{name:"Audit history",exact:true})).toHaveCount(0);
  }finally{await context.close();}
  await page.goto(`${base}/audit`);
  await expect(page.getByRole("heading",{name:"Audit history",exact:true})).toHaveCount(0);
});
