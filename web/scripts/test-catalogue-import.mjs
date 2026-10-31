import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  installAuthFixture,
  applyMigrations,
  testConnectionString,
} from "./database-test-support.mjs";
let db;
if (process.argv.includes("--native")) {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: testConnectionString() });
  await c.connect();
  db = {
    query: (...args) => c.query(...args),
    exec: (sql) => c.query(sql),
    close: () => c.end(),
  };
} else {
  db = new PGlite();
  await installAuthFixture(db);
  await applyMigrations(db);
}
const ids = {
  owner: randomUUID(),
  viewer: randomUUID(),
  operator: randomUUID(),
  gm: randomUUID(),
  other: randomUUID(),
};
let org, otherOrg;
let passed = 0;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const hash = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
async function login(name, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids[name] ?? null, role }),
  ]);
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec(`set local role ${role}`);
}
const base = async (command, payload = {}, tenant = org) =>
  (
    await one("select public.profitplate_command($1,$2,$3,$4::jsonb) result", [
      command,
      randomUUID(),
      tenant,
      JSON.stringify(payload),
    ])
  ).result;
const cmd = async (command, payload = {}) =>
  (
    await one("select public.inventory_command($1,$2,$3,$4::jsonb) result", [
      command,
      randomUUID(),
      org,
      JSON.stringify(payload),
    ])
  ).result;
const load = async (
  rows,
  sourceHash = hash(rows),
  name = "fixture.xlsx",
  tenant = org,
) =>
  (
    await one(
      "select public.import_inventory_catalogue($1,$2,$3,$4::jsonb) result",
      [tenant, name, sourceHash, JSON.stringify(rows)],
    )
  ).result;
const snapshot = async () =>
  one(
    "select (select count(*)::int from public.items) items,(select count(*)::int from public.inventory_documents) documents,(select count(*)::int from public.inventory_movements) movements,(select count(*)::int from public.stock_balances) balances,(select count(*)::int from public.stock_cost_state) costs,(select count(*)::int from public.catalogue_imports) batches",
  );
async function denied(fn, codes = ["42501"]) {
  await db.exec("savepoint expected");
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await db.exec("rollback to savepoint expected;release savepoint expected");
  assert.ok(error, "Expected rejection");
  assert.ok(codes.includes(error.code), `${error.code}: ${error.message}`);
}
async function test(name, fn) {
  await fn();
  console.log(`PASS catalogue ${++passed}: ${name}`);
}
const today = (
  await one("select (now() at time zone 'Africa/Lagos')::date::text as day")
).day;
const row = (sku, overrides = {}) => ({
  source_row: 2,
  sku,
  name: sku,
  category: "raw_material",
  base_uom_code: "each",
  stock_unit_label: "bottle",
  source_unit: "Bottle",
  reference_price: "10.00000000",
  price_status: "provided",
  reference_kind: "purchase_reference",
  reference_date: today,
  source_values: { A: sku, E: "10" },
  ...overrides,
});
let batch, item;
try {
  await db.exec("begin");
  for (const [name, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${name}@catalogue.test`],
    );
  await login("owner");
  org = (await base("bootstrap", { name: "Catalogue tenant" }, null))
    .organization_id;
  await login("other");
  otherOrg = (
    await base("bootstrap", { name: "Foreign catalogue tenant" }, null)
  ).organization_id;
  await db.exec("reset role");
  for (const name of ["viewer", "operator", "gm"])
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [org, ids[name], name === "operator" ? "inventory_manager" : "viewer"],
    );
  const rows = [
    row("BOTTLE"),
    row("MISSING", {
      source_row: 3,
      reference_price: null,
      price_status: "missing",
      stock_unit_label: "pack",
    }),
    row("ZERO", {
      source_row: 4,
      reference_price: "0.00000000",
      price_status: "zero_unconfirmed",
    }),
    row("SAUCE", {
      source_row: 5,
      category: "semi_finished",
      reference_kind: "production_reference",
      base_uom_code: "kg",
      stock_unit_label: null,
      source_unit: "Kg",
    }),
  ];
  await test("anonymous, service-role, nonmember and viewer imports are denied", async () => {
    await login(null, "anon");
    await denied(() => load(rows));
    await login(null, "service_role");
    await denied(() => load(rows));
    await login("other");
    await denied(() => load(rows));
    await login("viewer");
    await denied(() => load(rows));
  });
  await test("audited item import preserves counted units and creates no stock or costs", async () => {
    await login("operator");
    const before = await snapshot();
    batch = await load(rows);
    assert.equal(batch.inserted, 4);
    const after = await snapshot();
    assert.equal(after.movements, before.movements);
    assert.equal(after.documents, before.documents);
    assert.equal(after.balances, before.balances);
    assert.equal(after.costs, before.costs);
    const imported = await one(
      "select initiated_by,import_origin from public.catalogue_imports where id=$1",
      [batch.id],
    );
    assert.equal(imported.initiated_by, ids.operator);
    assert.equal(imported.import_origin, "authenticated_user");
    let record = await one(
      "select * from public.inventory_item_view where sku='BOTTLE'",
    );
    item = record.id;
    assert.equal(record.display_unit, "bottle");
    assert.equal(record.base_uom_code, "each");
    assert.equal(record.last_purchase_unit_cost, "10.00000000");
    assert.equal(record.last_purchase_source, "imported_reference");
    record = await one(
      "select * from public.inventory_item_view where sku='ZERO'",
    );
    assert.equal(record.last_purchase_unit_cost, null);
    assert.equal(record.imported_price_status, "zero_unconfirmed");
    record = await one(
      "select * from public.inventory_item_view where sku='MISSING'",
    );
    assert.equal(record.last_purchase_unit_cost, null);
    assert.equal(record.imported_price_status, "missing");
    record = await one(
      "select * from public.inventory_item_view where sku='SAUCE'",
    );
    assert.equal(record.last_purchase_unit_cost, null);
    assert.equal(record.imported_reference_price, "10.00000000");
    assert.equal(record.imported_reference_kind, "production_reference");
  });
  await test("same-file replay is idempotent and altered or conflicting identities fail atomically", async () => {
    const replay = await load(rows);
    assert.equal(replay.id, batch.id);
    assert.equal(replay.replayed, true);
    await denied(() => load([row("DIFFERENT")], hash(rows)), ["22023"]);
    const before = await snapshot();
    await denied(
      () =>
        load([
          row("NEW-ROLL", { source_row: 8, stock_unit_label: "roll" }),
          row("BOTTLE", {
            source_row: 9,
            base_uom_code: "ml",
            stock_unit_label: null,
          }),
        ]),
      ["22023"],
    );
    assert.deepEqual(await snapshot(), before);
    await denied(
      () =>
        load(
          [row("BOTTLE"), row("BOTTLE", { source_row: 3 })],
          hash("duplicate"),
        ),
      ["23505"],
    );
    await denied(
      () => load([row("NULL-PROVIDED", { reference_price: null })]),
      ["22023"],
    );
    await denied(
      () => load([row("FALSE-PURCHASE", { category: "semi_finished" })]),
      ["22023"],
    );
    await denied(() =>
      db.query(
        "update public.catalogue_import_rows set reference_price=999 where import_id=$1",
        [batch.id],
      ),
    );
  });
  await test("posted receipts supersede reference prices without treating references as weighted average", async () => {
    await login("owner");
    await cmd("appoint_manager", {
      user_id: ids.gm,
      manager_role: "operations_manager",
    });
    const location = (
      await base("create_location", { code: "STORE", name: "Store" })
    ).id;
    await login("gm");
    await cmd("create_period", {
      starts_on: String(Number(today.slice(0, 4)) - 1) + "-01-01",
      ends_on: today.slice(0, 4) + "-12-31",
    });
    await login("operator");
    const doc = (
      await cmd("create_document", {
        kind: "receipt",
        event_date: today.slice(0, 4) + "-01-01",
        reason: "Actual supplier receipt",
        destination_location_id: location,
        lines: [{ item_id: item, quantity: "2", unit_cost: "15" }],
      })
    ).id;
    await cmd("submit_document", { id: doc });
    await login("gm");
    await cmd("approve_document", { id: doc });
    const record = await one(
      "select * from public.inventory_item_view where id=$1",
      [item],
    );
    assert.equal(record.last_purchase_source, "posted_receipt");
    assert.equal(record.last_purchase_unit_cost, "15.00000000");
    assert.equal(
      (
        await one(
          "select quantity::text qty,average_cost::text cost from public.stock_cost_state where item_id=$1",
          [item],
        )
      ).cost,
      "15.00000000",
    );
  });
  await test("maintenance provenance records the database session without impersonating a user", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims','{}',true)");
    const before = await snapshot();
    const result = await load([row("MAINTENANCE")]);
    const after = await snapshot();
    assert.equal(after.movements, before.movements);
    assert.equal(after.costs, before.costs);
    const record = await one(
      "select initiated_by,import_origin,database_session_role from public.catalogue_imports where id=$1",
      [result.id],
    );
    assert.equal(record.initiated_by, null);
    assert.equal(record.import_origin, "database_maintenance");
    assert.ok(
      ["postgres", "supabase_admin"].includes(record.database_session_role),
    );
  });
  await test("tenant RLS and live suspensions also protect imports and reference views", async () => {
    await login("other");
    assert.equal(
      (
        await db.query(
          "select * from public.catalogue_import_rows where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.inventory_item_view where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    await login("operator");
    await denied(() =>
      load([row("FOREIGN")], hash("foreign"), "fixture.xlsx", otherOrg),
    );
    await db.exec("reset role");
    await db.query(
      "update public.organization_memberships set status='suspended' where organization_id=$1 and user_id=$2",
      [org, ids.operator],
    );
    await login("operator");
    await denied(() => load(rows));
    await login(null);
    await denied(() => load(rows));
  });
  const manifestIndex = process.argv.indexOf("--manifest");
  if (manifestIndex >= 0)
    await test("actual workbook manifest imports atomically into disposable PostgreSQL", async () => {
      const manifest = JSON.parse(
        await readFile(process.argv[manifestIndex + 1], "utf8"),
      );
      await login("owner");
      const before = await snapshot();
      const result = await load(
        manifest.rows,
        manifest.source_sha256,
        manifest.source_name,
      );
      assert.equal(result.rows, manifest.rows.length);
      assert.equal(result.inserted, manifest.rows.length);
      const after = await snapshot();
      assert.equal(after.movements, before.movements);
      assert.equal(after.documents, before.documents);
      assert.equal(after.costs, before.costs);
    });
  await db.exec("rollback");
  console.log(
    `\n${passed} catalogue import scenarios passed. Hosted data not used.`,
  );
} finally {
  await db.close();
}
