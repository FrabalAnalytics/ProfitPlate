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
  const client = new Client({ connectionString: testConnectionString() });
  await client.connect();
  db = {
    query: (...args) => client.query(...args),
    exec: (sql) => client.query(sql),
    close: () => client.end(),
  };
} else {
  db = new PGlite();
  await installAuthFixture(db);
  await applyMigrations(db);
}
const ids = Object.fromEntries(
  [
    "owner",
    "gm",
    "ops",
    "inventory",
    "kitchen",
    "bar",
    "viewer",
    "outsider",
  ].map((name) => [name, randomUUID()]),
);
const query = (sql, args = []) => db.query(sql, args);
const one = async (sql, args = []) => (await query(sql, args)).rows[0];
async function login(name, role = "authenticated") {
  await db.exec("reset role");
  await query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: ids[name] ?? null,
      role,
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    }),
  ]);
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec(`set local role ${role}`);
}
let org;
let passed = 0;
async function cmd(command, payload = {}, key = randomUUID(), tenant = org) {
  return (
    await one("select public.inventory_command($1,$2,$3,$4::jsonb) as result", [
      command,
      key,
      tenant,
      JSON.stringify(payload),
    ])
  ).result;
}
async function foundation(command, payload = {}, tenant = org) {
  return (
    await one(
      "select public.profitplate_command($1,$2,$3,$4::jsonb) as result",
      [command, randomUUID(), tenant, JSON.stringify(payload)],
    )
  ).result;
}
async function denied(fn, codes = ["42501"]) {
  await db.exec("savepoint expected");
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await db.exec("rollback to savepoint expected; release savepoint expected");
  assert.ok(error, "Expected rejection");
  assert.ok(codes.includes(error.code), `${error.code}: ${error.message}`);
}
async function test(name, fn) {
  await fn();
  console.log(`PASS ${++passed}: ${name}`);
}
let store, kitchen, bar, period, raw, oil, semi, general, sub, final, version;
const today = (
  await one("select (now() at time zone 'Africa/Lagos')::date::text as day")
).day;
async function doc(kind, lines, extra = {}) {
  const payload = {
    kind,
    event_date: today,
    reason: "Test operational evidence",
    ...extra,
  };
  if (lines) payload.lines = lines;
  const id = (await cmd("create_document", payload)).id;
  await cmd("submit_document", { id });
  return id;
}
async function approve(id, manager = "gm") {
  await login(manager);
  await cmd("approve_document", { id });
}
async function balance(item, location) {
  return (
    (
      await one(
        "select quantity::text as qty from public.stock_balances where organization_id=$1 and location_id=$2 and item_id=$3",
        [org, location, item],
      )
    )?.qty ?? "0"
  );
}
async function receipt(item, qty, cost, location = store, kind = "receipt") {
  await login("inventory");
  const id = await doc(
    kind,
    [{ item_id: item, quantity: qty, unit_cost: cost }],
    { destination_location_id: location },
  );
  await approve(id);
  return id;
}
try {
  await db.exec("begin");
  for (const [name, id] of Object.entries(ids))
    await query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${name}@inventory.test`],
    );
  await login("owner");
  org = (await foundation("bootstrap", { name: "Inventory tenant" }, null))
    .organization_id;
  await one("select public.control_command('assign_duty',$1,$2,$3::jsonb)", [
    randomUUID(),
    org,
    JSON.stringify({
      user_id: ids.owner,
      role: "inventory_manager",
      reason: "Explicit test duty",
    }),
  ]);
  await login("outsider");
  await foundation("bootstrap", { name: "Foreign tenant" }, null);
  await db.exec("reset role");
  for (const [name, role] of Object.entries({
    gm: "viewer",
    ops: "viewer",
    inventory: "inventory_manager",
    kitchen: "kitchen_lead",
    bar: "bar_lead",
    viewer: "viewer",
  })) {
    await query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [org, ids[name], role],
    );
  }
  await test("explicit appointments, distinct operating areas and live manager checks", async () => {
    await login("owner");
    store = (
      await foundation("create_location", { code: "STORE", name: "Main Store" })
    ).id;
    kitchen = (
      await foundation("create_location", { code: "KITCHEN", name: "Kitchen" })
    ).id;
    bar = (await foundation("create_location", { code: "BAR", name: "Bar" }))
      .id;
    await cmd("configure_areas", { main_store: store, kitchen, bar });
    await cmd("appoint_manager", {
      user_id: ids.gm,
      manager_role: "operations_manager",
    });
    await cmd("appoint_manager", {
      user_id: ids.ops,
      manager_role: "operations_manager",
    });
    await denied(() =>
      cmd("create_period", { starts_on: "2026-01-01", ends_on: "2026-12-31" }),
    );
    await login("gm");
    period = (
      await cmd("create_period", {
        starts_on: String(Number(today.slice(0, 4)) - 1) + "-01-01",
        ends_on: today.slice(0, 4) + "-12-31",
      })
    ).id;
    await denied(
      () => cmd("create_period", { starts_on: today, ends_on: today }),
      ["22023"],
    );
  });
  await test("three item categories and immutable, nested recipe versions", async () => {
    await login("inventory");
    const add = async (sku, category, base = "kg") =>
      (
        await cmd("create_item", {
          sku,
          name: sku,
          category,
          base_uom_code: base,
        })
      ).id;
    raw = await add("TOMATO", "raw_material");
    oil = await add("OIL", "raw_material", "l");
    semi = await add("SAUCE", "semi_finished");
    general = await add("TISSUE", "general", "each");
    const result = await cmd("create_recipe", {
      code: "SAUCE",
      name: "Sauce",
      kind: "sub_recipe",
      output_item_id: semi,
      standard_output: "4",
      lines: [
        { item_id: raw, quantity: "5" },
        { item_id: oil, quantity: "1" },
      ],
    });
    sub = result.id;
    version = result.version_id;
    final = (
      await cmd("create_recipe", {
        code: "PASTA",
        name: "Final dish",
        kind: "final",
        standard_output: "1",
        lines: [
          { item_id: semi, quantity: "0.1" },
          { item_id: raw, quantity: "0.15" },
        ],
      })
    ).id;
    await denied(
      () =>
        cmd("revise_recipe", {
          id: sub,
          standard_output: "1",
          lines: [{ item_id: semi, quantity: "1" }],
        }),
      ["22023"],
    );
    await denied(
      () =>
        cmd("revise_recipe", {
          id: sub,
          standard_output: "1",
          lines: [{ item_id: general, quantity: "1" }],
        }),
      ["22023"],
    );
    const cost = (
      await one("select public.current_recipe_cost($1,$2) as result", [
        org,
        final,
      ])
    ).result;
    assert.equal(cost.complete, false);
    assert.equal(cost.unit_cost, null);
    await denied(() =>
      query("update public.recipe_versions set standard_output=2 where id=$1", [
        version,
      ]),
    );
  });
  await test("draft/submission do not move stock; self-approval forbidden even for a GM", async () => {
    await login("gm");
    const id = await doc(
      "opening",
      [{ item_id: raw, quantity: "10", unit_cost: "100" }],
      { destination_location_id: store },
    );
    assert.equal(Number(await balance(raw, store)), 0);
    await denied(() => cmd("approve_document", { id }));
    await approve(id, "ops");
    assert.equal(Number(await balance(raw, store)), 10);
  });
  await test("business-wide weighted average and receipts of any value", async () => {
    await receipt(raw, "10", "200");
    await receipt(oil, "10", "400", kitchen, "opening");
    const cost = await one(
      "select quantity::text qty,average_cost::text cost,inventory_value::text value from public.stock_cost_state where item_id=$1",
      [raw],
    );
    assert.equal(Number(cost.qty), 20);
    assert.equal(Number(cost.cost), 150);
    assert.equal(Number(cost.value), 3000);
    await receipt(general, "100", "1000000000", bar, "opening");
    await denied(() => receipt(semi, "1", "50", kitchen), ["22023"]);
  });
  await test("dispatch reserves source stock; acceptance posts stock and is retry-safe", async () => {
    await login("inventory");
    const id = await doc("transfer", [{ item_id: raw, quantity: "12" }], {
      source_location_id: store,
      destination_location_id: kitchen,
    });
    await approve(id);
    assert.equal(Number(await balance(raw, store)), 20);
    assert.equal(
      Number(
        (
          await one(
            "select reserved_quantity from public.inventory_balance_view where item_id=$1 and location_id=$2",
            [raw, store],
          )
        ).reserved_quantity,
      ),
      12,
    );
    await login("inventory");
    assert.equal(Number(await balance(raw, kitchen)), 0);
    await denied(() =>
      cmd("receive_transfer", {
        id,
        reason: "Self receipt",
        lines: [{ item_id: raw, quantity: "12" }],
      }),
    );
    await login("kitchen");
    const key = randomUUID();
    const payload = {
      id,
      reason: "Partial receipt",
      lines: [{ item_id: raw, quantity: "10" }],
    };
    const result = await cmd("receive_transfer", payload, key);
    assert.deepEqual(await cmd("receive_transfer", payload, key), result);
    assert.equal(Number(await balance(raw, kitchen)), 10);
    await cmd("receive_transfer", {
      id,
      reason: "Remaining delivery",
      lines: [{ item_id: raw, quantity: "2" }],
    });
    assert.equal(Number(await balance(raw, kitchen)), 12);
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          id,
        ])
      ).status,
      "received",
    );
    assert.equal(
      Number(
        (
          await one(
            "select sum(quantity)::text qty from public.inventory_movements where item_id=$1 and bucket='in_transit'",
            [raw],
          )
        ).qty,
      ),
      0,
    );
    await login("owner");
    assert.equal(
      Number(
        (
          await one(
            "select quantity::text qty from public.stock_cost_state where item_id=$1",
            [raw],
          )
        ).qty,
      ),
      20,
    );
  });
  await test("partial acceptance, rejection and returned goods preserve reservations and block double spending", async () => {
    await db.exec("savepoint decisions");
    await login("inventory");
    const id = await doc("transfer", [{ item_id: raw, quantity: "5" }], {
      source_location_id: store,
      destination_location_id: kitchen,
    });
    await approve(id);
    await login("inventory");
    const over = await doc("waste", [{ item_id: raw, quantity: "4" }], {
      source_location_id: store,
    });
    await login("gm");
    await denied(() => cmd("approve_document", { id: over }), ["23514"]);
    await login("inventory");
    await denied(
      () =>
        one("select public.control_command('create_count',$1,$2,$3::jsonb)", [
          randomUUID(),
          org,
          JSON.stringify({
            location_id: store,
            reason: "Reserved source count",
            lines: [{ item_id: raw, quantity: "3" }],
          }),
        ]),
      ["23514"],
    );
    await login("bar");
    await denied(() =>
      cmd("receive_transfer", {
        id,
        reason: "Wrong department",
        lines: [{ item_id: raw, quantity: "1" }],
      }),
    );
    await login("kitchen");
    await cmd("receive_transfer", {
      id,
      reason: "Accept usable rice",
      lines: [{ item_id: raw, quantity: "2" }],
    });
    assert.equal(Number(await balance(raw, kitchen)), 14);
    await login("inventory");
    assert.equal(Number(await balance(raw, store)), 6);
    assert.equal(
      Number(
        (
          await one(
            "select available_quantity from public.inventory_balance_view where item_id=$1 and location_id=$2",
            [raw, store],
          )
        ).available_quantity,
      ),
      3,
    );
    await login("kitchen");
    const rejection = {
      id,
      reason: "Damaged package",
      lines: [{ item_id: raw, quantity: "2" }],
    };
    const key = randomUUID();
    await cmd("reject_transfer", rejection, key);
    await cmd("reject_transfer", rejection, key);
    await denied(
      () =>
        cmd("receive_transfer", {
          id,
          reason: "Cannot accept rejected goods",
          lines: [{ item_id: raw, quantity: "2" }],
        }),
      ["22023"],
    );
    await denied(() =>
      cmd("return_transfer", {
        id,
        reason: "Kitchen cannot release store stock",
        lines: [{ item_id: raw, quantity: "1" }],
      }),
    );
    await login("inventory");
    assert.equal(
      Number(
        (
          await one(
            "select reserved_quantity from public.inventory_balance_view where item_id=$1 and location_id=$2",
            [raw, store],
          )
        ).reserved_quantity,
      ),
      3,
    );
    const back = {
      id,
      reason: "Rejected goods physically returned",
      lines: [{ item_id: raw, quantity: "2" }],
    };
    const returnKey = randomUUID();
    await cmd("return_transfer", back, returnKey);
    await cmd("return_transfer", back, returnKey);
    assert.equal(Number(await balance(raw, store)), 6);
    assert.equal(
      Number(
        (
          await one(
            "select reserved_quantity from public.inventory_balance_view where item_id=$1 and location_id=$2",
            [raw, store],
          )
        ).reserved_quantity,
      ),
      1,
    );
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          id,
        ])
      ).status,
      "dispatched",
    );
    await login("kitchen");
    await cmd("receive_transfer", {
      id,
      reason: "Last pending package",
      lines: [{ item_id: raw, quantity: "1" }],
    });
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          id,
        ])
      ).status,
      "received",
    );
    await login("inventory");
    assert.equal(Number(await balance(raw, store)), 5);
    assert.equal(
      Number(
        (
          await one(
            "select quantity from public.stock_cost_state where item_id=$1",
            [raw],
          )
        ).quantity,
      ),
      20,
    );
    await db.exec(
      "rollback to savepoint decisions;release savepoint decisions",
    );
  });
  await test("earlier in-transit deliveries can be partially accepted and returned without rewriting history", async () => {
    await db.exec("savepoint legacy");
    await login("inventory");
    const id = await doc("transfer", [{ item_id: raw, quantity: "3" }], {
      source_location_id: store,
      destination_location_id: kitchen,
    });
    await approve(id);
    await db.exec("reset role");
    await query(
      "update public.transfer_stock set reserved_on_dispatch=false where document_id=$1",
      [id],
    );
    await query(
      "select private.move_stock(d,$2,d.source_location_id,-3,'transfer_dispatch',150,false,false) from public.inventory_documents d where d.id=$1",
      [id, raw],
    );
    await query(
      "select private.move_stock(d,$2,null,3,'transfer_in_transit',150,true,false) from public.inventory_documents d where d.id=$1",
      [id, raw],
    );
    await login("kitchen");
    await cmd("receive_transfer", {
      id,
      reason: "Legacy accepted",
      lines: [{ item_id: raw, quantity: "1" }],
    });
    await cmd("reject_transfer", {
      id,
      reason: "Legacy rejected",
      lines: [{ item_id: raw, quantity: "2" }],
    });
    await login("inventory");
    const before = Number(await balance(raw, store));
    await cmd("return_transfer", {
      id,
      reason: "Legacy physical return",
      lines: [{ item_id: raw, quantity: "2" }],
    });
    assert.equal(Number(await balance(raw, store)), before + 2);
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          id,
        ])
      ).status,
      "received",
    );
    await db.exec("rollback to savepoint legacy;release savepoint legacy");
  });
  await test("production scales standard inputs, posts actual yield, and retains historical batch cost", async () => {
    await login("kitchen");
    const id = await doc("production", null, {
      source_location_id: kitchen,
      recipe_version_id: version,
      planned_output: "8",
      actual_output: "7",
    });
    await approve(id);
    assert.equal(Number(await balance(raw, kitchen)), 2);
    assert.equal(Number(await balance(oil, kitchen)), 8);
    assert.equal(Number(await balance(semi, kitchen)), 7);
    const before = await one(
      "select value::text value from public.inventory_movements where document_id=$1 and movement='production_output'",
      [id],
    );
    assert.ok(Math.abs(Number(before.value) - 2300) < 0.000001);
    const recipeCost = (
      await one("select public.current_recipe_cost($1,$2) result", [org, final])
    ).result;
    assert.equal(recipeCost.complete, true);
    assert.equal(Number(recipeCost.unit_cost), 51.25);
    await receipt(raw, "10", "300");
    const changed = (
      await one("select public.current_recipe_cost($1,$2) result", [org, final])
    ).result;
    assert.ok(Number(changed.unit_cost) > 51.25);
    assert.equal(
      (
        await one(
          "select value::text value from public.inventory_movements where document_id=$1 and movement='production_output'",
          [id],
        )
      ).value,
      before.value,
    );
  });
  await test("sales imports consume their target only and never expand already-produced sauce twice", async () => {
    await login("inventory");
    const id = await doc(
      "sales",
      [
        {
          external_id: "sale-1:line-1",
          menu_code: "PASTA",
          location_id: kitchen,
          quantity: "2",
        },
      ],
      { source_system: "POS" },
    );
    await approve(id);
    assert.equal(Number(await balance(raw, kitchen)), 1.7);
    assert.equal(Number(await balance(semi, kitchen)), 6.8);
    assert.equal(Number(await balance(oil, kitchen)), 8);
    await login("inventory");
    await denied(
      () =>
        doc(
          "sales",
          [
            {
              external_id: "sale-1:line-1",
              menu_code: "PASTA",
              location_id: kitchen,
              quantity: "2",
            },
          ],
          { source_system: "POS" },
        ),
      ["23505"],
    );
    await denied(
      () =>
        doc(
          "sales",
          [
            {
              external_id: "bad",
              menu_code: "UNKNOWN",
              location_id: kitchen,
              quantity: "1",
            },
          ],
          { source_system: "POS" },
        ),
      ["22023"],
    );
    await denied(
      () =>
        doc(
          "sales",
          [
            {
              external_id: "bad-location",
              menu_code: "PASTA",
              location_id: store,
              quantity: "1",
            },
          ],
          { source_system: "POS" },
        ),
      ["22023"],
    );
  });
  await test("waste requires independent approval and is available at all three areas", async () => {
    for (const [item, location] of [
      [raw, store],
      [semi, kitchen],
      [general, bar],
    ]) {
      await login("inventory");
      const before = Number(await balance(item, location));
      const id = await doc("waste", [{ item_id: item, quantity: "0.1" }], {
        source_location_id: location,
      });
      assert.equal(Number(await balance(item, location)), before);
      await approve(id, "ops");
      assert.equal(Number(await balance(item, location)), before - 0.1);
    }
  });
  await test("failed multi-line posting rolls back all movements, approval and balances", async () => {
    await login("inventory");
    const id = await doc(
      "waste",
      [
        { item_id: raw, quantity: "0.1" },
        { item_id: semi, quantity: "999" },
      ],
      { source_location_id: kitchen },
    );
    const before = await balance(raw, kitchen);
    await login("gm");
    await denied(() => cmd("approve_document", { id }), ["23514"]);
    assert.equal(await balance(raw, kitchen), before);
    assert.equal(
      Number(
        (
          await one(
            "select count(*)::int n from public.inventory_movements where document_id=$1",
            [id],
          )
        ).n,
      ),
      0,
    );
    assert.equal(
      (
        await one("select status from public.inventory_documents where id=$1", [
          id,
        ])
      ).status,
      "submitted",
    );
  });
  await test("period locks are rechecked on posting and Operations Managers reopen", async () => {
    await login("inventory");
    const id = await doc("waste", [{ item_id: raw, quantity: "0.1" }], {
      source_location_id: kitchen,
      event_date: today.slice(0, 4) + "-01-01",
    });
    await login("ops");
    await cmd("close_period", {
      id: period,
      reason: "Close for reconciliation",
    });
    await denied(() => cmd("approve_document", { id }), ["22023"]);
    await login("inventory");
    await denied(() =>
      cmd("reopen_period", { id: period, reason: "Not permitted" }),
    );
    await login("gm");
    await cmd("reopen_period", {
      id: period,
      reason: "Authorized correction window",
    });
    await cmd("approve_document", { id });
    assert.equal(
      (
        await one(
          "select event_date::text as day,approved_by from public.inventory_documents where id=$1",
          [id],
        )
      ).day,
      today.slice(0, 4) + "-01-01",
    );
  });
  await test("posting is idempotent and rejects changed payload with the same key", async () => {
    await login("inventory");
    const id = await doc("usage", [{ item_id: general, quantity: "1" }], {
      source_location_id: bar,
    });
    await login("gm");
    const key = randomUUID();
    const result = await cmd("approve_document", { id }, key);
    assert.deepEqual(await cmd("approve_document", { id }, key), result);
    await denied(
      () => cmd("approve_document", { id: randomUUID() }, key),
      ["22023"],
    );
    assert.equal(
      Number(
        (
          await one(
            "select count(*)::int n from public.inventory_movements where document_id=$1",
            [id],
          )
        ).n,
      ),
      1,
    );
  });
  await test("live suspension, foreign IDs, read-only roles and direct ledger writes are denied", async () => {
    await login("inventory");
    const id = await doc("waste", [{ item_id: raw, quantity: "0.1" }], {
      source_location_id: store,
    });
    await db.exec("reset role");
    await query(
      "update public.organization_memberships set status='suspended' where organization_id=$1 and user_id=$2",
      [org, ids.ops],
    );
    await login("ops");
    await denied(() => cmd("approve_document", { id }));
    await login("outsider");
    await denied(() => cmd("approve_document", { id }, randomUUID()));
    assert.equal(
      (
        await query(
          "select * from public.inventory_movements where organization_id=$1",
          [org],
        )
      ).rows.length,
      0,
    );
    await login("viewer");
    await denied(() =>
      cmd("create_document", {
        kind: "waste",
        event_date: today,
        reason: "Denied",
        source_location_id: store,
        lines: [{ item_id: raw, quantity: "1" }],
      }),
    );
    await denied(() =>
      query(
        "update public.stock_balances set quantity=999 where organization_id=$1",
        [org],
      ),
    );
    await denied(() =>
      query("delete from public.inventory_movements where organization_id=$1", [
        org,
      ]),
    );
    await login(null, "anon");
    await denied(() => cmd("approve_document", { id }));
    await login(null, "service_role");
    await denied(() => cmd("approve_document", { id }));
  });
  await test("rejected sales do not reserve source IDs and banned accounts cannot use cost previews", async () => {
    await login("inventory");
    const payload = [
      {
        external_id: "rejected-source",
        menu_code: "PASTA",
        location_id: kitchen,
        quantity: "1",
      },
    ];
    const first = await doc("sales", payload, { source_system: "POS" });
    await login("gm");
    await cmd("reject_document", { id: first, reason: "Correct the import" });
    await login("inventory");
    const replacement = await doc("sales", payload, { source_system: "pos" });
    await approve(replacement);
    await login("inventory");
    await denied(
      () => doc("sales", payload, { source_system: "pos" }),
      ["23505"],
    );
    await db.exec("reset role");
    await query(
      "update auth.users set banned_until=now()+interval '1 hour' where id=$1",
      [ids.inventory],
    );
    await login("inventory");
    await denied(() =>
      query("select public.current_recipe_cost($1,$2)", [org, final]),
    );
    await db.exec("reset role");
    await query("update auth.users set banned_until=null where id=$1", [
      ids.inventory,
    ]);
  });
  await test("last purchase price uses posted receipt dates, preserves zero and remains tenant scoped", async () => {
    await login("inventory");
    const item = (
      await cmd("create_item", {
        sku: "LAST-PRICE",
        name: "Last price test",
        base_uom_code: "kg",
        category: "raw_material",
      })
    ).id;
    await receipt(item, "10", "100", store, "opening");
    await login("owner");
    let record = await one(
      "select last_purchase_unit_cost from public.inventory_item_view where id=$1",
      [item],
    );
    assert.equal(record.last_purchase_unit_cost, null);
    const yesterday = (
      await one(
        "select ((now() at time zone 'Africa/Lagos')::date-1)::text as day",
      )
    ).day;
    const older = (
      await one(
        "select ((now() at time zone 'Africa/Lagos')::date-2)::text as day",
      )
    ).day;
    await login("inventory");
    let id = await doc(
      "receipt",
      [{ item_id: item, quantity: "2", unit_cost: "200" }],
      { destination_location_id: kitchen, event_date: yesterday },
    );
    await approve(id);
    await login("owner");
    record = await one(
      "select last_purchase_unit_cost from public.inventory_item_view where id=$1",
      [item],
    );
    assert.equal(record.last_purchase_unit_cost, "200.00000000");
    // A receipt on today's business date supersedes yesterday's price, including explicit zero cost.
    await receipt(item, "1", "0", kitchen);
    await login("inventory");
    id = await doc(
      "receipt",
      [{ item_id: item, quantity: "1", unit_cost: "900" }],
      { destination_location_id: store, event_date: older },
    );
    await approve(id);
    await login("inventory");
    await doc("receipt", [{ item_id: item, quantity: "1", unit_cost: "999" }], {
      destination_location_id: store,
    });
    await login("owner");
    record = await one(
      "select last_purchase_unit_cost,last_purchase_date::text as day from public.inventory_item_view where id=$1",
      [item],
    );
    assert.equal(record.last_purchase_unit_cost, "0.00000000");
    assert.equal(record.day, today);
    const balancePrice = await one(
      "select last_purchase_unit_cost,average_cost from public.inventory_balance_view where item_id=$1 and location_id=$2",
      [item, store],
    );
    assert.equal(balancePrice.last_purchase_unit_cost, "0.00000000");
    assert.notEqual(balancePrice.average_cost, "0.00000000");
    await login("outsider");
    assert.equal(
      (
        await query("select * from public.inventory_item_view where id=$1", [
          item,
        ])
      ).rows.length,
      0,
    );
    await login(null, "anon");
    await denied(() => query("select * from public.inventory_item_view"));
  });
  await test("ledger reconciles by location and across the business", async () => {
    await login("owner");
    const rows = (
      await query(
        "select b.quantity::text balance,coalesce(sum(m.quantity),0)::text ledger from public.stock_balances b left join public.inventory_movements m on m.organization_id=b.organization_id and m.location_id=b.location_id and m.item_id=b.item_id where b.organization_id=$1 group by b.organization_id,b.location_id,b.item_id,b.quantity",
        [org],
      )
    ).rows;
    for (const row of rows)
      assert.equal(Number(row.balance), Number(row.ledger));
    const costs = (
      await query(
        "select s.quantity::text qty,s.inventory_value::text value,coalesce(sum(m.quantity),0)::text ledger,coalesce(sum(m.value),0)::text ledger_value from public.stock_cost_state s left join public.inventory_movements m on m.organization_id=s.organization_id and m.item_id=s.item_id where s.organization_id=$1 group by s.item_id,s.quantity,s.inventory_value",
        [org],
      )
    ).rows;
    for (const row of costs) {
      assert.equal(Number(row.qty), Number(row.ledger));
      assert.ok(
        Math.abs(Number(row.value) - Number(row.ledger_value)) < 0.000001,
      );
    }
  });
  await db.exec("rollback");
  console.log(`\n${passed} inventory scenarios passed. No hosted data used.`);
} finally {
  await db.close();
}
