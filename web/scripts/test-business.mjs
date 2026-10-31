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
    "buyer",
    "store",
    "kitchen",
    "bar",
    "gm",
    "viewer",
    "accountant",
    "other",
    "recipient",
  ].map((n) => [n, randomUUID()]),
);
let org, areas, item, vendor, po, request, transfer;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function login(name, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: ids[name] ?? null, role }),
  ]);
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec(`set local role ${role}`);
}
const call = async (
  fn,
  command,
  payload = {},
  key = randomUUID(),
  tenant = org,
) =>
  (
    await one(`select public.${fn}($1,$2,$3,$4::jsonb) result`, [
      command,
      key,
      tenant,
      JSON.stringify(payload),
    ])
  ).result;
const master = (c, p = {}, k, t) => call("business_command", c, p, k, t);
const inv = (c, p = {}) => call("inventory_command", c, p);
const base = (c, p = {}, t = org) =>
  call("profitplate_command", c, p, randomUUID(), t);
async function denied(fn, codes = ["42501"]) {
  await db.exec("savepoint expected");
  let e;
  try {
    await fn();
  } catch (error) {
    e = error;
  }
  await db.exec("rollback to savepoint expected;release savepoint expected");
  assert.ok(e, "Expected rejection");
  assert.ok(codes.includes(e.code), `${e.code}: ${e.message}`);
}
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`PASS business ${++passed}: ${name}`);
}
const today = (
  await one("select (now() at time zone 'Africa/Lagos')::date::text as day")
).day;
async function submitReceipt(id) {
  await inv("submit_document", { id });
  await login("gm");
  await inv("approve_document", { id });
}
try {
  await db.exec("begin");
  for (const [n, id] of Object.entries(ids))
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${n}@business.test`],
    );
  await login("owner");
  org = (await base("bootstrap", { name: "Business workflow" }, null))
    .organization_id;
  for (const role of ["inventory_manager", "procurement_officer"])
    await one("select public.control_command('assign_duty',$1,$2,$3::jsonb)", [
      randomUUID(),
      org,
      JSON.stringify({
        user_id: ids.owner,
        role,
        reason: "Explicit test duty",
      }),
    ]);
  await login("other");
  await base("bootstrap", { name: "Foreign business" }, null);
  await db.exec("reset role");
  for (const [n, role] of Object.entries({
    buyer: "procurement_officer",
    store: "inventory_manager",
    kitchen: "kitchen_lead",
    bar: "bar_lead",
    gm: "viewer",
    viewer: "viewer",
    accountant: "accountant",
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
  await inv("appoint_manager", {
    user_id: ids.gm,
    manager_role: "operations_manager",
  });
  await login("gm");
  await inv("create_period", {
    starts_on: today.slice(0, 4) + "-01-01",
    ends_on: today.slice(0, 4) + "-12-31",
  });
  await login("store");
  item = (
    await inv("create_item", {
      sku: "RICE",
      name: "Rice",
      category: "raw_material",
      base_uom_code: "kg",
    })
  ).id;
  await test("Procurement Officer manages vendors, with audited retries and read restrictions", async () => {
    await login("buyer");
    const key = randomUUID();
    const payload = {
      code: "VENDOR",
      name: "Test Vendor",
      email: "vendor@business.test",
      phone: "0000000000",
    };
    const r = await master("save_vendor", payload, key);
    vendor = r.id;
    assert.deepEqual(await master("save_vendor", payload, key), r);
    await denied(
      () => master("save_vendor", { ...payload, name: "Changed" }, key),
      ["22023"],
    );
    await master("save_vendor_item", {
      vendor_id: vendor,
      item_id: item,
      purchase_unit: "bag",
      base_quantity: "10",
      quoted_price: "1000",
      conversion_note: "Verified test bag contains 10 kg.",
    });
    await denied(() =>
      inv("create_document", {
        kind: "receipt",
        event_date: today,
        reason: "Bypass",
        destination_location_id: areas.main_store,
        lines: [{ item_id: item, quantity: "1", unit_cost: "1" }],
      }),
    );
    await login("kitchen");
    assert.equal(
      (await db.query("select * from public.vendors where id=$1", [vendor]))
        .rows.length,
      0,
    );
    await denied(() => master("save_vendor", payload));
    await login("accountant");
    assert.equal(
      (await db.query("select * from public.vendors where id=$1", [vendor]))
        .rows.length,
      1,
    );
    await denied(() => master("save_vendor", payload));
  });
  await test("manual invitations admit only the matching verified account and support Procurement", async () => {
    await login("owner");
    const invitation = (
      await base("invite", {
        email: "recipient@business.test",
        role: "procurement_officer",
      })
    ).id;
    const issued = (
      await one("select public.issue_manual_invitation($1,$2) result", [
        org,
        invitation,
      ])
    ).result;
    const token = issued.code.split(".")[2];
    assert.equal(token.length, 64);
    await denied(
      () =>
        db.query("select public.issue_manual_invitation($1,$2)", [
          org,
          invitation,
        ]),
      ["22023"],
    );
    assert.ok(
      !(
        await one(
          "select details::text data from public.audit_events where entity_id=$1 order by created_at desc limit 1",
          [invitation],
        )
      ).data.includes(token),
    );
    await login("viewer");
    await denied(() => base("accept_invitation", { id: invitation, token }));
    await login("recipient");
    await base("accept_invitation", { id: invitation, token });
    assert.equal(
      (
        await one(
          "select role from public.organization_memberships where organization_id=$1 and user_id=$2",
          [org, ids.recipient],
        )
      ).role,
      "procurement_officer",
    );
    await login("owner");
    const directory = (
      await db.query("select * from public.team_directory($1)", [org])
    ).rows;
    assert.ok(directory.some((r) => r.user_id === ids.recipient));
    await login("buyer");
    await denied(() =>
      db.query("select * from public.team_directory($1)", [org]),
    );
  });
  await test("purchase approvals do not create stock and self-approval has no manager bypass", async () => {
    await login("buyer");
    po = (
      await master("create_purchase_order", {
        vendor_id: vendor,
        reason: "Test PO",
        lines: [{ item_id: item, quantity: "2", unit_cost: "1000" }],
      })
    ).id;
    await master("submit_purchase_order", { id: po });
    await login("owner");
    await inv("appoint_manager", {
      user_id: ids.buyer,
      manager_role: "operations_manager",
    });
    await login("buyer");
    await denied(() => master("approve_purchase_order", { id: po }));
    await login("owner");
    await inv("remove_manager", {
      user_id: ids.buyer,
      reason: "Restore Procurement-only access",
    });
    await login("gm");
    await master("approve_purchase_order", { id: po });
    assert.equal(
      Number(
        (
          await one(
            "select count(*)::int n from public.inventory_movements where organization_id=$1",
            [org],
          )
        ).n,
      ),
      0,
    );
  });
  await test("purchasing needs an explicit Procurement role; managers retain independent review and cancellation", async () => {
    const payload = {
      vendor_id: vendor,
      reason: "Explicit Procurement test",
      lines: [{ item_id: item, quantity: "1", unit_cost: "1000" }],
    };
    await login("gm");
    await denied(() => master("create_purchase_order", payload));
    await denied(() =>
      master("save_vendor", {
        code: "MANAGER-BYPASS",
        name: "Denied supplier",
      }),
    );
    assert.equal(
      (await db.query("select id from public.vendors where id=$1", [vendor]))
        .rows.length,
      1,
    );
    assert.equal(
      (
        await db.query("select id from public.purchase_orders where id=$1", [
          po,
        ])
      ).rows.length,
      1,
    );
    await login("store");
    await denied(() => master("create_purchase_order", payload));
    await login("owner");
    await call("control_command", "remove_duty", {
      user_id: ids.owner,
      role: "procurement_officer",
      reason: "Check Owner oversight is not implicit procurement",
    });
    await denied(() => master("create_purchase_order", payload));
    await call("control_command", "assign_duty", {
      user_id: ids.owner,
      role: "procurement_officer",
      reason: "Restore explicit Owner acting as Procurement",
    });
    await call("control_command", "assign_duty", {
      user_id: ids.gm,
      role: "procurement_officer",
      reason: "Explicit combined Procurement and Operations test",
    });
    await login("gm");
    const key = randomUUID();
    const own = (await master("create_purchase_order", payload, key)).id;
    await master("submit_purchase_order", { id: own });
    await denied(() => master("approve_purchase_order", { id: own }));
    await login("owner");
    await call("control_command", "remove_duty", {
      user_id: ids.gm,
      role: "procurement_officer",
      reason: "Remove temporary procurement authority",
    });
    await login("gm");
    await denied(() => master("create_purchase_order", payload, key));
    await login("buyer");
    const extra = (
      await master("create_purchase_order", {
        ...payload,
        reason: "Cancelled by independent Operations",
      })
    ).id;
    await master("submit_purchase_order", { id: extra });
    await login("gm");
    await master("cancel_purchase_order", {
      id: extra,
      reason: "Operational cancellation of pending order",
    });
    assert.equal(
      (
        await one("select status from public.purchase_orders where id=$1", [
          extra,
        ])
      ).status,
      "cancelled",
    );
  });
  await test("partial receipts use frozen purchase packs and costs, reject over-receipt atomically", async () => {
    await login("buyer");
    const mapping = await one(
      "select id from public.vendor_items where vendor_id=$1",
      [vendor],
    );
    await master("save_vendor_item", {
      id: mapping.id,
      vendor_id: vendor,
      item_id: item,
      purchase_unit: "bag",
      base_quantity: "20",
      quoted_price: "2500",
      conversion_note: "New supplier pack after this order.",
    });
    await denied(() =>
      master("create_purchase_receipt", {
        id: po,
        event_date: today,
        location_id: areas.main_store,
        reason: "Buyer cannot receive",
        lines: [{ item_id: item, quantity: "0.5" }],
      }),
    );
    await login("store");
    const firstKey = randomUUID();
    const firstPayload = {
      id: po,
      event_date: today,
      location_id: areas.main_store,
      reason: "Partial delivery",
      lines: [{ item_id: item, quantity: "0.5", rejected_quantity: "0.25" }],
    };
    const first = (
      await master(
        "create_purchase_receipt",
        {
          id: po,
          event_date: today,
          location_id: areas.main_store,
          reason: "Partial delivery",
          lines: [
            { item_id: item, quantity: "0.5", rejected_quantity: "0.25" },
          ],
        },
        firstKey,
      )
    ).id;
    assert.equal(
      (await master("create_purchase_receipt", firstPayload, firstKey)).id,
      first,
    );
    const header = await one(
      "select status,posting_basis,approved_by,received_by from public.inventory_documents where id=$1",
      [first],
    );
    assert.equal(header.status, "posted");
    assert.equal(header.posting_basis, "approved_purchase_order");
    assert.equal(header.approved_by, null);
    assert.equal(header.received_by, ids.store);
    const state = await one(
      "select quantity::text qty,average_cost::text cost from public.stock_cost_state where item_id=$1",
      [item],
    );
    assert.equal(Number(state.qty), 5);
    assert.equal(Number(state.cost), 100);
    await login("store");
    const second = (
      await master("create_purchase_receipt", {
        id: po,
        event_date: today,
        location_id: areas.main_store,
        reason: "Second delivery",
        lines: [{ item_id: item, quantity: "1" }],
      })
    ).id;
    await denied(
      () =>
        master("create_purchase_receipt", {
          id: po,
          event_date: today,
          location_id: areas.main_store,
          reason: "Excess delivery",
          lines: [{ item_id: item, quantity: "1" }],
        }),
      ["23514"],
    );
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          second,
        ])
      ).status,
      "posted",
    );
    assert.equal(
      Number(
        (
          await one(
            "select quantity::text qty from public.stock_cost_state where item_id=$1",
            [item],
          )
        ).qty,
      ),
      15,
    );
    assert.equal(
      Number(
        (
          await one(
            "select received_quantity from public.purchase_order_line_view where order_id=$1",
            [po],
          )
        ).received_quantity,
      ),
      1.5,
    );
    await login("gm");
    await master("cancel_purchase_order", {
      id: po,
      reason: "Cancel outstanding half bag",
    });
    await login("store");
    await denied(
      () =>
        master("create_purchase_receipt", {
          id: po,
          event_date: today,
          location_id: areas.main_store,
          reason: "Cancelled order",
          lines: [{ item_id: item, quantity: "0.1" }],
        }),
      ["22023"],
    );
  });
  await test("saved PO receiving drafts can be accepted once by their receiver, with cancellation and scope checks", async () => {
    await login("buyer");
    const extra = (
      await master("create_purchase_order", {
        vendor_id: vendor,
        reason: "Legacy receipt compatibility",
        lines: [{ item_id: item, quantity: "1", unit_cost: "2000" }],
      })
    ).id;
    await master("submit_purchase_order", { id: extra });
    await login("gm");
    await master("approve_purchase_order", { id: extra });
    async function legacy(reason) {
      await login("store");
      const id = (
        await inv("create_document", {
          kind: "receipt",
          event_date: today,
          reason,
          destination_location_id: areas.main_store,
          lines: [{ item_id: item, quantity: "5", unit_cost: "100" }],
        })
      ).id;
      // Reproduce a saved pre-migration PO receipt in this disposable fixture only.
      await db.exec("reset role");
      await db.query("insert into public.purchase_receipts values($1,$2,$3)", [
        org,
        id,
        extra,
      ]);
      await db.query(
        "insert into public.purchase_receipt_lines select $1,$2,id,0.25,0 from public.purchase_order_lines where order_id=$3",
        [org, id, extra],
      );
      return id;
    }
    const id = await legacy("Legacy saved delivery");
    await login("gm");
    await denied(() => master("accept_purchase_receipt", { id }));
    await login("store");
    const key = randomUUID();
    await master("accept_purchase_receipt", { id }, key);
    await master("accept_purchase_receipt", { id }, key);
    await master("accept_purchase_receipt", { id });
    const d = await one(
      "select status,posting_basis,approved_by,received_by from public.inventory_documents where id=$1",
      [id],
    );
    assert.equal(d.status, "posted");
    assert.equal(d.posting_basis, "approved_purchase_order");
    assert.equal(d.approved_by, null);
    assert.equal(d.received_by, ids.store);
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.inventory_movements where document_id=$1",
          [id],
        )
      ).n,
      1,
    );
    const stale = await legacy("Cancelled legacy delivery");
    await login("gm");
    await master("cancel_purchase_order", {
      id: extra,
      reason: "Cancel remaining delivery",
    });
    await login("store");
    await denied(
      () => master("accept_purchase_receipt", { id: stale }),
      ["22023"],
    );
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          stale,
        ])
      ).status,
      "draft",
    );
    const direct = (
      await inv("create_document", {
        kind: "receipt",
        event_date: today,
        reason: "Unlinked direct receipt",
        destination_location_id: areas.main_store,
        lines: [{ item_id: item, quantity: "1", unit_cost: "100" }],
      })
    ).id;
    await denied(() => master("accept_purchase_receipt", { id: direct }));
  });
  await test("department requests are approved once and store dispatch stays within approved quantities", async () => {
    await login("bar");
    await denied(() =>
      master("create_requisition", {
        destination_location_id: areas.kitchen,
        reason: "Wrong department",
        lines: [{ item_id: item, quantity: "1" }],
      }),
    );
    await login("kitchen");
    request = (
      await master("create_requisition", {
        destination_location_id: areas.kitchen,
        reason: "Kitchen needs rice",
        lines: [{ item_id: item, quantity: "10" }],
      })
    ).id;
    await master("submit_requisition", { id: request });
    await login("gm");
    await master("approve_requisition", { id: request });
    await denied(() =>
      master("fulfil_requisition", {
        id: request,
        event_date: today,
        reason: "Self dispatch",
        lines: [{ item_id: item, quantity: "1" }],
      }),
    );
    await login("store");
    transfer = (
      await master("fulfil_requisition", {
        id: request,
        event_date: today,
        reason: "Dispatch four kg",
        lines: [{ item_id: item, quantity: "4" }],
      })
    ).id;
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          transfer,
        ])
      ).status,
      "dispatched",
    );
    await denied(
      () =>
        master("fulfil_requisition", {
          id: request,
          event_date: today,
          reason: "Over issue",
          lines: [{ item_id: item, quantity: "7" }],
        }),
      ["23514"],
    );
    await login("kitchen");
    await inv("receive_transfer", {
      id: transfer,
      reason: "Received rice",
      lines: [{ item_id: item, quantity: "4" }],
    });
    assert.equal(
      Number(
        (
          await one(
            "select quantity::text qty from public.stock_balances where item_id=$1 and location_id=$2",
            [item, areas.kitchen],
          )
        ).qty,
      ),
      4,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.stock_balances where organization_id=$1 and location_id=$2",
          [org, areas.main_store],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.stock_cost_state where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    const visible = await one(
      "select average_cost from public.inventory_balance_view where item_id=$1 and location_id=$2",
      [item, areas.kitchen],
    );
    assert.equal(Number(visible.average_cost), 100);
  });
  await test("final/sub-recipe masters and sales mappings retain versions and department scopes", async () => {
    await login("store");
    const semi = (
      await inv("create_item", {
        sku: "SEMI",
        name: "Prepared rice",
        category: "semi_finished",
        base_uom_code: "kg",
      })
    ).id;
    await inv("create_recipe", {
      code: "SUB",
      name: "Sub recipe",
      kind: "sub_recipe",
      output_item_id: semi,
      standard_output: "1",
      lines: [{ item_id: item, quantity: "1" }],
    });
    const final = (
      await inv("create_recipe", {
        code: "FINAL",
        name: "Final recipe",
        kind: "final",
        standard_output: "1",
        lines: [{ item_id: item, quantity: "1" }],
      })
    ).id;
    assert.equal(
      (
        await db.query(
          "select * from public.final_recipe_master where organization_id=$1",
          [org],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.sub_recipe_master where organization_id=$1",
          [org],
        )
      ).rows.length,
      1,
    );
    await master("save_menu_item", {
      code: "MEAL",
      name: "Menu meal",
      recipe_id: final,
      default_area: "kitchen",
    });
    await master("save_menu_item", {
      code: "DRINK",
      name: "Menu drink",
      recipe_id: final,
      default_area: "bar",
    });
    const opening = (
      await inv("create_document", {
        kind: "opening",
        event_date: today,
        reason: "Bar test baseline",
        destination_location_id: areas.bar,
        lines: [{ item_id: item, quantity: "10", unit_cost: "100" }],
      })
    ).id;
    await submitReceipt(opening);
    await login("store");
    const sale = (
      await master("create_sales_draft", {
        source_system: "POS",
        event_date: today,
        reason: "Mixed departments",
        lines: [
          {
            external_id: "K1",
            menu_code: "MEAL",
            location_id: areas.kitchen,
            quantity: "1",
          },
          {
            external_id: "B1",
            menu_code: "DRINK",
            location_id: areas.bar,
            quantity: "1",
          },
        ],
      })
    ).id;
    await submitReceipt(sale);
    await login("kitchen");
    const preview = (
      await one("select public.inventory_document_preview($1,$2) result", [
        org,
        sale,
      ])
    ).result;
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0].location, "Kitchen");
    assert.equal(
      (
        await db.query(
          "select * from public.sales_import_rows where document_id=$1",
          [sale],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.sales_menu_sources where document_id=$1",
          [sale],
        )
      ).rows.length,
      1,
    );
    await login("bar");
    await denied(() =>
      db.query("select public.inventory_document_preview($1,$2)", [
        org,
        transfer,
      ]),
    );
    assert.equal(
      (
        await db.query("select * from public.stock_requisitions where id=$1", [
          request,
        ])
      ).rows.length,
      0,
    );
  });
  await test("foreign IDs, anonymous calls and direct master writes remain denied", async () => {
    await login("other");
    await denied(() =>
      master(
        "save_vendor",
        { code: "BAD", name: "Foreign" },
        randomUUID(),
        org,
      ),
    );
    assert.equal(
      (await db.query("select * from public.vendors where id=$1", [vendor]))
        .rows.length,
      0,
    );
    await login("buyer");
    await denied(() =>
      db.query("update public.vendors set name=$1 where id=$2", [
        "Forged",
        vendor,
      ]),
    );
    await denied(() =>
      db.query("delete from public.purchase_order_lines where order_id=$1", [
        po,
      ]),
    );
    await login(null, "anon");
    await denied(() =>
      master("save_vendor", { code: "BAD", name: "Anonymous" }),
    );
    await login(null, "service_role");
    await denied(() => master("save_vendor", { code: "BAD", name: "Service" }));
  });
  await db.exec("rollback");
  console.log(`\n${passed} business/role workflow scenarios passed.`);
} finally {
  await db.close();
}
