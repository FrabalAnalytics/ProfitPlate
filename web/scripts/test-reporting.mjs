import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
    query: (...a) => c.query(...a),
    exec: (s) => c.query(s),
    close: () => c.end(),
  };
} else {
  db = new PGlite();
  await installAuthFixture(db);
  await applyMigrations(db);
}
const ids = Object.fromEntries(
  [
    "owner",
    "admin",
    "store",
    "buyer",
    "kitchen",
    "bar",
    "ops",
    "ops2",
    "finance",
    "other",
  ].map((n) => [n, randomUUID()]),
);
let org, areas, item, recipe, snapshot, reconciliation, goldenSale;
let passed = 0;
const one = async (s, a = []) => (await db.query(s, a)).rows[0];
async function login(name, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids[name] ?? null, role }),
  ]);
  await db.exec(`set local role ${role}`);
}
const cmd = async (fn, c, p = {}, key = randomUUID()) =>
  (
    await one(`select public.${fn}($1,$2,$3,$4::jsonb) result`, [
      c,
      key,
      org,
      JSON.stringify(p),
    ])
  ).result;
const inv = (c, p) => cmd("inventory_command", c, p),
  business = (c, p) => cmd("business_command", c, p),
  control = (c, p, key) => cmd("control_command", c, p, key),
  reporting = (c, p, key) => cmd("reporting_command", c, p, key);
const report = async (start, end = start, location = null) =>
  (
    await one("select public.operating_report($1,$2,$3,$4) result", [
      org,
      start,
      end,
      location,
    ])
  ).result;
async function denied(fn, codes = ["42501"]) {
  await db.exec("savepoint rejected");
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  await db.exec("rollback to savepoint rejected;release savepoint rejected");
  assert.ok(err, "Expected rejection");
  assert.ok(codes.includes(err.code), `${err.code}: ${err.message}`);
}
async function test(name, fn) {
  await fn();
  console.log(`PASS reporting ${++passed}: ${name}`);
}
const dates = await one(
  "select (now() at time zone 'Africa/Lagos')::date::text as today,((now() at time zone 'Africa/Lagos')::date-1)::text as yesterday,((now() at time zone 'Africa/Lagos')::date-2)::text as earlier",
);
async function post(kind, lines, extra = {}, date = dates.yesterday) {
  await login("store");
  const d = (
    await inv("create_document", {
      kind,
      event_date: date,
      reason: "Reporting fixture",
      lines,
      ...extra,
    })
  ).id;
  await inv("submit_document", { id: d });
  await login("ops");
  await inv("approve_document", { id: d });
  return d;
}
try {
  await db.exec("begin");
  for (const [n, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${n}@reports.test`],
    );
  await login("owner");
  org = (
    await one(
      "select public.profitplate_command('bootstrap',$1,null,$2::jsonb) result",
      [randomUUID(), JSON.stringify({ name: "Reporting tests" })],
    )
  ).result.organization_id;
  await db.exec("reset role");
  for (const [n, role] of Object.entries({
    admin: "admin",
    store: "inventory_manager",
    buyer: "procurement_officer",
    kitchen: "kitchen_lead",
    bar: "bar_lead",
    ops: "viewer",
    ops2: "viewer",
    finance: "accountant",
  }))
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [org, ids[n], role],
    );
  await login("owner");
  await inv("prepare_areas");
  areas = Object.fromEntries(
    (
      await db.query(
        "select area,location_id from public.operating_areas where organization_id=$1",
        [org],
      )
    ).rows.map((r) => [r.area, r.location_id]),
  );
  await test("owner/admin have no implicit stock or purchasing rights; explicit duties are live and audited", async () => {
    for (const n of ["owner", "admin"]) {
      await login(n);
      await denied(() =>
        inv("create_document", {
          kind: "receipt",
          event_date: dates.today,
          destination_location_id: areas.kitchen,
          reason: "Forbidden",
          lines: [],
        }),
      );
      await denied(() =>
        business("save_vendor", { code: "X", name: "Forbidden" }),
      );
    }
    await login("owner");
    await control("assign_duty", {
      user_id: ids.admin,
      role: "inventory_manager",
      reason: "Explicit inventory test assignment",
    });
    await login("admin");
    const probe = (
      await inv("create_item", {
        sku: "PROBE",
        name: "Duty probe",
        category: "general",
        base_uom_code: "each",
      })
    ).id;
    assert.ok(probe);
    await denied(() =>
      control("assign_duty", {
        user_id: ids.admin,
        role: "accountant",
        reason: "Escalation",
      }),
    );
    await login("owner");
    await control("remove_duty", {
      user_id: ids.admin,
      role: "inventory_manager",
      reason: "End explicit test duty",
    });
    await denied(
      () =>
        inv("appoint_manager", {
          user_id: ids.ops,
          manager_role: "general_manager",
        }),
      ["22023"],
    );
    for (const n of ["ops", "ops2"])
      await inv("appoint_manager", {
        user_id: ids[n],
        manager_role: "operations_manager",
      });
  });
  await login("ops");
  await inv("create_period", {
    starts_on: dates.earlier,
    ends_on: dates.today,
  });
  await login("store");
  item = (
    await inv("create_item", {
      sku: "RICE",
      name: "Report rice",
      category: "raw_material",
      base_uom_code: "kg",
    })
  ).id;
  recipe = (
    await inv("create_recipe", {
      code: "PLATE",
      name: "Rice plate",
      kind: "final",
      standard_output: "1",
      lines: [{ item_id: item, quantity: "2" }],
    })
  ).id;
  await business("save_menu_item", {
    code: "MEAL",
    name: "Meal",
    recipe_id: recipe,
    default_area: "kitchen",
    revenue_class: "food",
  });
  await post("receipt", [{ item_id: item, quantity: "10", unit_cost: "100" }], {
    destination_location_id: areas.kitchen,
  });
  await test("sales snapshot exact standard quantities, carrying cost, revenue and recipe margin", async () => {
    await login("store");
    const id = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.yesterday,
        reason: "Golden sales",
        lines: [
          {
            external_id: "SALE-1",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "3",
            net_sales: "1500",
          },
        ],
      })
    ).id;
    goldenSale = id;
    const preview = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        id,
      ])
    ).result;
    assert.equal(Number(preview.sales.net_sales), 1500);
    assert.equal(Number(preview.sales.recipe_cogs), 600);
    assert.equal(Number(preview.sales.gross_profit), 900);
    assert.equal(Number(preview.sales.gross_margin_pct), 60);
    assert.equal(preview.sales.source_system, "POS");
    assert.equal(preview.sales.lines[0].menu_code, "MEAL");
    assert.equal(Number(preview.sales.lines[0].unit_sales_price), 500);
    assert.equal(preview.sales.posted, false);
    assert.deepEqual(preview.sales.warnings, []);
    await login("kitchen");
    const restricted = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        id,
      ])
    ).result;
    assert.equal(restricted.sales, null);
    await login("other");
    await denied(() =>
      one("select public.inventory_document_preview($1,$2) result", [org, id]),
    );
    await login("store");
    await inv("submit_document", { id });
    await login("ops");
    await inv("approve_document", { id });
    const captured = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        id,
      ])
    ).result;
    assert.equal(captured.sales.posted, true);
    assert.equal(Number(captured.sales.recipe_cogs), 600);
    const r = await report(dates.yesterday);
    assert.equal(Number(r.sales.net_sales), 1500);
    assert.equal(Number(r.sales.theoretical_cogs), 600);
    assert.equal(Number(r.sales.standard_quantity_inventory_cogs), 600);
    assert.equal(Number(r.sales.theoretical_gross_profit), 900);
    assert.equal(Number(r.sales.theoretical_gross_margin_pct), 60);
    assert.equal(Number(r.sales.theoretical_food_cost_pct), 40);
    assert.equal(r.sales.actual_cogs, null);
    assert.equal(r.readiness, "partial");
    snapshot = (
      await reporting("publish", {
        starts_on: dates.yesterday,
        ends_on: dates.yesterday,
        reason: "Golden partial report",
      })
    ).id;
  });
  await test("current purchases cannot recalculate historical recipe cost or saved reports", async () => {
    await post(
      "receipt",
      [{ item_id: item, quantity: "10", unit_cost: "200" }],
      { destination_location_id: areas.kitchen },
      dates.today,
    );
    const r = await report(dates.yesterday);
    assert.equal(Number(r.sales.theoretical_cogs), 600);
    assert.equal(Number(r.inventory[0].closing), 4);
    assert.equal(Number(r.inventory[0].closing_value), 400);
    const postedPreview = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        goldenSale,
      ])
    ).result;
    assert.equal(Number(postedPreview.sales.recipe_cogs), 600);
    assert.equal(Number(postedPreview.sales.gross_profit), 900);
    assert.equal(Number(postedPreview.lines[0].unit_cost), 100);
    const saved = (
      await one("select report from public.report_snapshots where id=$1", [
        snapshot,
      ])
    ).report;
    assert.equal(Number(saved.sales.theoretical_cogs), 600);
    await denied(() =>
      db.query("update public.report_snapshots set reason=$1 where id=$2", [
        "Overwrite",
        snapshot,
      ]),
    );
  });
  await test("sales approval warns about missing revenue, duplicate references and combined stock demand without inventing margins", async () => {
    await db.exec("savepoint approval_preview");
    await login("store");
    const duplicate = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.today,
        reason: "Duplicate preview",
        lines: [
          {
            external_id: "REVIEW-DUPLICATE",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "50",
          },
        ],
      })
    ).id;
    const competing=(await business("create_sales_draft",{source_system:"POS",event_date:dates.today,reason:"Competing import",lines:[{external_id:"REVIEW-DUPLICATE",menu_code:"MEAL",location_id:areas.kitchen,quantity:"1",net_sales:"200"}]})).id;
    const pendingPreview=(await one("select public.inventory_document_preview($1,$2) result",[org,duplicate])).result.sales;
    assert.ok(pendingPreview.warnings.some(w=>w.includes("another pending sales import")));
    await inv("submit_document",{id:competing});await login("ops");await inv("approve_document",{id:competing});await login("store");
    const missing = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        duplicate,
      ])
    ).result.sales;
    assert.equal(missing.net_sales, null);
    assert.equal(missing.gross_profit, null);
    assert.equal(missing.gross_margin_pct, null);
    assert.ok(
      missing.warnings.some((w) => w.includes("Net sales are missing")),
    );
    assert.ok(missing.warnings.some((w) => w.includes("already posted")));
    assert.ok(
      missing.warnings.some((w) => w.includes("Insufficient available stock")),
    );
    const zero = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.today,
        reason: "Complimentary preview",
        lines: [
          {
            external_id: "ZERO-PREVIEW",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "1",
            net_sales: "0",
          },
        ],
      })
    ).id;
    const free = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        zero,
      ])
    ).result.sales;
    assert.equal(Number(free.net_sales), 0);
    assert.equal(free.gross_margin_pct, null);
    assert.ok(Number(free.gross_profit) < 0);
    const uncosted = (
      await inv("create_item", {
        sku: "NO-COST",
        name: "Uncosted ingredient",
        category: "raw_material",
        base_uom_code: "kg",
      })
    ).id;
    const noCostRecipe = (
      await inv("create_recipe", {
        code: "NO-COST",
        name: "Uncosted meal",
        kind: "final",
        standard_output: "1",
        lines: [{ item_id: uncosted, quantity: "1" }],
      })
    ).id;
    await business("save_menu_item", {
      code: "NO-COST",
      name: "Uncosted meal",
      recipe_id: noCostRecipe,
      default_area: "kitchen",
      revenue_class: "food",
    });
    const noCost = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.today,
        reason: "Uncosted preview",
        lines: [
          {
            external_id: "NO-COST-PREVIEW",
            menu_code: "NO-COST",
            location_id: areas.kitchen,
            quantity: "1",
            net_sales: "200",
          },
        ],
      })
    ).id;
    const incomplete = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        noCost,
      ])
    ).result.sales;
    assert.equal(incomplete.recipe_cogs, null);
    assert.equal(incomplete.gross_profit, null);
    assert.equal(incomplete.gross_margin_pct, null);
    assert.ok(
      incomplete.warnings.some((w) => w.includes("Recipe cost is incomplete")),
    );
    await db.exec(
      "rollback to savepoint approval_preview;release savepoint approval_preview",
    );
  });
  await test("actual COGS and food cost require matching sales evidence and independent Operations approval", async () => {
    await login("finance");
    const payload = {
      starts_on: dates.yesterday,
      ends_on: dates.yesterday,
      expected_sales_lines: 1,
      net_sales: "1500",
      actual_cogs: "700",
      actual_food_cost: "650",
      evidence_reference:
        "Accounting schedule TEST-001 and stock reconciliation",
      reason: "Completed POS and cost reconciliation",
    };
    await denied(
      () => reporting("reconcile", { ...payload, net_sales: "1600" }),
      ["23514"],
    );
    reconciliation = (await reporting("reconcile", payload)).id;
    await denied(() =>
      reporting("approve_reconciliation", { id: reconciliation }),
    );
    await login("ops");
    await reporting("approve_reconciliation", { id: reconciliation });
    const r = await report(dates.yesterday);
    assert.equal(Number(r.sales.actual_cogs), 700);
    assert.equal(Number(r.sales.actual_gross_profit), 800);
    assert.equal(Number(r.sales.actual_gross_margin_pct), 53.3333);
    assert.equal(Number(r.sales.actual_food_cost_pct), 43.3333);
    assert.equal(r.readiness, "reconciled");
    const newer = (
      await reporting("publish", {
        starts_on: dates.yesterday,
        ends_on: dates.yesterday,
        reason: "Reconciled revision",
      })
    ).id;
    assert.equal(
      (
        await one(
          "select revision,previous_id from public.report_snapshots where id=$1",
          [newer],
        )
      ).previous_id,
      snapshot,
    );
  });
  await test("backdated evidence invalidates live reconciliation but preserves published versions", async () => {
    await post(
      "receipt",
      [{ item_id: item, quantity: "1", unit_cost: "120" }],
      { destination_location_id: areas.kitchen },
    );
    const r = await report(dates.yesterday);
    assert.equal(r.sales.actual_cogs, null);
    assert.equal(r.readiness, "partial");
    const saved = (
      await one("select report from public.report_snapshots where id=$1", [
        snapshot,
      ])
    ).report;
    assert.equal(Number(saved.inventory[0].closing), 4);
  });
  await test("count adjustments are atomic, independently approved, retry-safe and never counted as waste", async () => {
    await login("kitchen");
    const id = (
      await control("create_count", {
        location_id: areas.kitchen,
        reason: "Physical count test",
        lines: [{ item_id: item, quantity: "14" }],
      })
    ).id;
    await control("submit_count", { id });
    await denied(() => control("approve_count", { id }));
    await login("ops");
    const key = randomUUID();
    await control("approve_count", { id }, key);
    await control("approve_count", { id }, key);
    assert.equal(
      Number(
        (
          await one(
            "select quantity from public.stock_balances where item_id=$1 and location_id=$2",
            [item, areas.kitchen],
          )
        ).quantity,
      ),
      14,
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.inventory_movements where item_id=$1 and movement='count_adjustment'",
          [item],
        )
      ).n,
      1,
    );
    await login("kitchen");
    const stale = (
      await control("create_count", {
        location_id: areas.kitchen,
        reason: "Stale count test",
        lines: [{ item_id: item, quantity: "13" }],
      })
    ).id;
    await control("submit_count", { id: stale });
    await post(
      "waste",
      [{ item_id: item, quantity: "1" }],
      { source_location_id: areas.kitchen },
      dates.today,
    );
    await denied(() => control("approve_count", { id: stale }), ["23514"]);
  });
  await test("management findings have scoped owners and audited progress without stock posting", async () => {
    await login("ops");
    const id = (
      await cmd("action_command", "create_action", {
        title: "Investigate counted shortage",
        assigned_to: ids.kitchen,
        priority: "high",
        due_on: dates.today,
        evidence_reference: "Physical count test",
      })
    ).id;
    await login("bar");
    assert.equal(
      (
        await db.query("select * from public.management_actions where id=$1", [
          id,
        ])
      ).rows.length,
      0,
    );
    await denied(() =>
      cmd("action_command", "update_action", {
        id,
        status: "resolved",
        reason: "Not my assignment",
      }),
    );
    await login("kitchen");
    assert.equal(
      (
        await db.query("select * from public.management_actions where id=$1", [
          id,
        ])
      ).rows.length,
      1,
    );
    await cmd("action_command", "update_action", {
      id,
      status: "resolved",
      reason: "Count reviewed with storekeeper; evidence retained",
    });
    assert.equal(
      (
        await one("select status from public.management_actions where id=$1", [
          id,
        ])
      ).status,
      "resolved",
    );
    await denied(() =>
      cmd("action_command", "create_action", {
        title: "Unauthorized finding",
        assigned_to: ids.bar,
        priority: "high",
        due_on: dates.today,
        evidence_reference: "No authority",
      }),
    );
  });
  await test("missing and zero revenue never invent percentage denominators", async () => {
    await login("store");
    const id = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.earlier,
        reason: "Missing revenue",
        lines: [
          {
            external_id: "MISSING",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "0.1",
          },
        ],
      })
    ).id;
    await inv("submit_document", { id });
    await login("ops");
    await inv("approve_document", { id });
    const r = await report(dates.earlier);
    assert.equal(r.sales.net_sales, null);
    assert.equal(r.sales.theoretical_gross_profit, null);
    assert.equal(r.sales.theoretical_gross_margin_pct, null);
    await login("store");
    const free = (
      await business("create_sales_draft", {
        source_system: "POS",
        event_date: dates.today,
        reason: "Complimentary meal",
        lines: [
          {
            external_id: "FREE",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "0.1",
            net_sales: "0",
          },
        ],
      })
    ).id;
    await inv("submit_document", { id: free });
    await login("ops");
    await inv("approve_document", { id: free });
    const zero = await report(dates.today);
    assert.equal(Number(zero.sales.net_sales), 0);
    assert.equal(zero.sales.theoretical_gross_margin_pct, null);
    assert.equal(zero.sales.theoretical_food_cost_pct, null);
  });
  await test("department, administrator and foreign callers cannot read finance evidence or exports", async () => {
    await login("kitchen");
    const r = await report(dates.yesterday);
    assert.equal(r.location_id, areas.kitchen);
    assert.equal(r.sales, null);
    assert.equal(r.finance, false);
    assert.ok(r.inventory.every((i) => i.closing_value === null));
    await denied(() => report(dates.yesterday, dates.yesterday, areas.bar));
    assert.equal(
      (
        await db.query(
          "select * from public.report_snapshots where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    await denied(() => reporting("export", { id: snapshot }));
    await login("admin");
    await denied(() => report(dates.yesterday));
    await login("other");
    await denied(() => report(dates.yesterday), ["22023"]);
    await login(null, "anon");
    await denied(() => report(dates.yesterday));
  });
  await db.exec("rollback");
  console.log(
    `\n${passed} reporting/control scenarios passed. No hosted data used.`,
  );
} finally {
  await db.close();
}
