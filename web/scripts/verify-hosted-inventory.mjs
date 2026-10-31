// Read-only API verification, using the application's public key. Never prints keys/data.
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.equal(
  new URL(url).hostname,
  "ndvqzhvnwbemqmwdlckl.supabase.co",
  "Only the linked ProfitPlate project is allowed",
);
assert.ok(key && !key.startsWith("sb_secret_"));
if (key.split(".").length === 3)
  assert.notEqual(
    JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role,
    "service_role",
  );
const client = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
for (const table of [
  "inventory_movements",
  "inventory_balance_view",
  "inventory_item_view",
  "inventory_movement_view",
  "vendors",
  "vendor_item_master",
  "menu_items",
  "final_recipe_master",
  "sub_recipe_master",
  "purchase_order_summary",
  "stock_requisition_line_view",
  'additional_role_assignments','sales_revenue_evidence','sales_cost_evidence','stock_counts','stock_count_line_view','report_reconciliations','report_snapshots','management_actions',
]) {
  const { error } = await client.from(table).select("*").limit(1);
  assert.equal(
    error?.code,
    "42501",
    `Anonymous access must be denied for ${table}`,
  );
}
const { error } = await client.rpc("current_recipe_cost", {
  p_organization_id: "00000000-0000-0000-0000-000000000000",
  p_recipe_id: "00000000-0000-0000-0000-000000000000",
});
assert.equal(error?.code, "42501");
for (const [name, args] of [
  ['operating_report',{p_organization_id:'00000000-0000-0000-0000-000000000000',p_starts_on:'2026-10-01',p_ends_on:'2026-10-02'}],
  ...['control_command','reporting_command','action_command'].map(name=>[name,{p_command:'denied',p_organization_id:'00000000-0000-0000-0000-000000000000',p_request_id:'00000000-0000-4000-8000-000000000000',p_payload:{}}]),
  [
    "business_command",
    {
      p_command: "save_vendor",
      p_request_id: "00000000-0000-4000-8000-000000000000",
      p_organization_id: "00000000-0000-0000-0000-000000000000",
      p_payload: { code: "DENIED", name: "Denied request" },
    },
  ],
  [
    "team_directory",
    { p_organization_id: "00000000-0000-0000-0000-000000000000" },
  ],
  [
    "operating_people",
    { p_organization_id: "00000000-0000-0000-0000-000000000000" },
  ],
  [
    "issue_manual_invitation",
    {
      p_organization_id: "00000000-0000-0000-0000-000000000000",
      p_invitation_id: "00000000-0000-0000-0000-000000000000",
    },
  ],
]) {
  const result = await client.rpc(name, args);
  assert.equal(
    result.error?.code,
    "42501",
    `Anonymous execution must be denied for ${name}`,
  );
}
console.log(
  "Hosted API verified: anonymous inventory, master, purchasing and requisition reads and command/team RPC execution are denied. No restaurant data read or changed.",
);
