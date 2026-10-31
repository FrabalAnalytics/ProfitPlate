import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { testConnectionString } from "./database-test-support.mjs";
const connectionString = testConnectionString();
const observer = new Client({ connectionString });
await observer.connect();
const connections = new Set();
async function session(actor) {
  const c = new Client({ connectionString });
  await c.connect();
  connections.add(c);
  await c.query("set statement_timeout='10s'");
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: actor,
      role: "authenticated",
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    }),
  ]);
  await c.query("set local role authenticated");
  return c;
}
async function finish(c, commit = true) {
  try {
    await c.query(commit ? "commit" : "rollback");
  } finally {
    await c.end();
    connections.delete(c);
  }
}
const cmd = async (c, command, org, payload = {}, key = randomUUID()) =>
  (
    await c.query(
      "select public.inventory_command($1,$2,$3,$4::jsonb) result",
      [command, key, org, JSON.stringify(payload)],
    )
  ).rows[0].result;
const base = async (c, command, org, payload = {}) =>
  (
    await c.query(
      "select public.profitplate_command($1,$2,$3,$4::jsonb) result",
      [command, randomUUID(), org, JSON.stringify(payload)],
    )
  ).rows[0].result;
const business = async (c, command, org, payload = {}) =>
  (
    await c.query("select public.business_command($1,$2,$3,$4::jsonb) result", [
      command,
      randomUUID(),
      org,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
async function invokeBusiness(actor, command, org, payload) {
  const c = await session(actor);
  try {
    const result = await business(c, command, org, payload);
    await finish(c);
    return result;
  } catch (error) {
    await finish(c, false);
    throw error;
  }
}
async function invoke(actor, command, org, payload) {
  const c = await session(actor);
  try {
    const r = await cmd(c, command, org, payload);
    await finish(c);
    return r;
  } catch (e) {
    await finish(c, false);
    throw e;
  }
}
async function race(a, b, first, second) {
  const value = await first(a);
  const pending = second(b).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let blocked = false;
  for (let i = 0; i < 250; i++) {
    if (
      (
        await observer.query(
          "select wait_event_type from pg_stat_activity where pid=$1",
          [b.processID],
        )
      ).rows[0]?.wait_event_type === "Lock"
    ) {
      blocked = true;
      break;
    }
    await delay(20);
  }
  assert.ok(blocked, "Competing posting must wait for tenant lock");
  await finish(a);
  const r = await pending;
  await finish(b, !r.error);
  return { first: value, ...r };
}
async function fixture() {
  const users = {
    owner: randomUUID(),
    gm: randomUUID(),
    ops: randomUUID(),
    operator: randomUUID(),
  };
  for (const id of Object.values(users))
    await observer.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${id}@inventory-race.test`],
    );
  const ownerSession = await session(users.owner);
  const org = (
    await base(ownerSession, "bootstrap", null, {
      name: "Operational race tenant",
    })
  ).organization_id;
  for (const role of ["inventory_manager", "procurement_officer"])
    await ownerSession.query(
      "select public.control_command('assign_duty',$1,$2,$3::jsonb)",
      [
        randomUUID(),
        org,
        JSON.stringify({
          user_id: users.owner,
          role,
          reason: "Explicit race fixture duty",
        }),
      ],
    );
  await finish(ownerSession);
  for (const [name, role] of [
    ["gm", "viewer"],
    ["ops", "viewer"],
    ["operator", "inventory_manager"],
  ])
    await observer.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [org, users[name], role],
    );
  await invoke(users.owner, "appoint_manager", org, {
    user_id: users.gm,
    manager_role: "operations_manager",
  });
  await invoke(users.owner, "appoint_manager", org, {
    user_id: users.ops,
    manager_role: "operations_manager",
  });
  const today = (
    await observer.query(
      "select (now() at time zone 'Africa/Lagos')::date::text as day",
    )
  ).rows[0].day;
  const period = (
    await invoke(users.gm, "create_period", org, {
      starts_on: today,
      ends_on: today,
    })
  ).id;
  const c = await session(users.owner);
  const loc = (
    await base(c, "create_location", org, { code: "STORE", name: "Store" })
  ).id;
  const kitchen = (
    await base(c, "create_location", org, { code: "KITCHEN", name: "Kitchen" })
  ).id;
  const bar = (
    await base(c, "create_location", org, { code: "BAR", name: "Bar" })
  ).id;
  await finish(c);
  await invoke(users.owner, "configure_areas", org, {
    main_store: loc,
    kitchen,
    bar,
  });
  const item = (
    await invoke(users.operator, "create_item", org, {
      sku: "RICE",
      name: "Rice",
      base_uom_code: "kg",
      category: "raw_material",
    })
  ).id;
  async function document(kind, quantity = "10", location = loc) {
    const id = (
      await invoke(users.operator, "create_document", org, {
        kind,
        event_date: today,
        reason: "Race evidence",
        ...(kind === "receipt"
          ? { destination_location_id: location }
          : { source_location_id: location }),
        lines: [
          {
            item_id: item,
            quantity,
            ...(kind === "receipt" ? { unit_cost: "100" } : {}),
          },
        ],
      })
    ).id;
    await invoke(users.operator, "submit_document", org, { id });
    return id;
  }
  return { users, org, loc, kitchen, item, period, document };
}
let passed = 0;
const test = async (name, fn) => {
  await fn();
  console.log(`PASS inventory race ${++passed}: ${name}`);
};
try {
  await test("concurrent approvals post a receipt exactly once", async () => {
    const f = await fixture();
    const id = await f.document("receipt");
    const r = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) => cmd(c, "approve_document", f.org, { id }),
      (c) => cmd(c, "approve_document", f.org, { id }),
    );
    assert.equal(r.error?.code, "22023");
    assert.equal(
      (
        await observer.query(
          "select count(*)::int n from public.inventory_movements where document_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
  });
  await test("simultaneous identical approval retries return the original result", async () => {
    const f = await fixture();
    const id = await f.document("receipt");
    const key = randomUUID();
    const r = await race(
      await session(f.users.gm),
      await session(f.users.gm),
      (c) => cmd(c, "approve_document", f.org, { id }, key),
      (c) => cmd(c, "approve_document", f.org, { id }, key),
    );
    assert.ifError(r.error);
    assert.deepEqual(r.first, r.value);
  });
  await test("competing stock deductions cannot overdraw the same location", async () => {
    const f = await fixture();
    await invoke(f.users.gm, "approve_document", f.org, {
      id: await f.document("receipt"),
    });
    const a = await f.document("waste", "6"),
      b = await f.document("waste", "6");
    const r = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) => cmd(c, "approve_document", f.org, { id: a }),
      (c) => cmd(c, "approve_document", f.org, { id: b }),
    );
    assert.equal(r.error?.code, "23514");
    assert.equal(
      Number(
        (
          await observer.query(
            "select quantity::text qty from public.stock_balances where item_id=$1",
            [f.item],
          )
        ).rows[0].qty,
      ),
      4,
    );
  });
  await test("period closing wins over a waiting posting", async () => {
    const f = await fixture();
    const id = await f.document("receipt");
    const r = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) =>
        cmd(c, "close_period", f.org, { id: f.period, reason: "Period close" }),
      (c) => cmd(c, "approve_document", f.org, { id }),
    );
    assert.equal(r.error?.code, "22023");
    assert.equal(
      (
        await observer.query(
          "select count(*)::int n from public.inventory_movements where document_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
  });
  await test("suspended manager cannot approve after waiting for the lock", async () => {
    const f = await fixture();
    const id = await f.document("receipt");
    const r = await race(
      await session(f.users.owner),
      await session(f.users.ops),
      (c) =>
        base(c, "suspend_member", f.org, {
          user_id: f.users.ops,
          reason: "Remove access",
        }),
      (c) => cmd(c, "approve_document", f.org, { id }),
    );
    assert.equal(r.error?.code, "42501");
  });
  await test("two imported drafts cannot post the same POS source line twice", async () => {
    const f = await fixture();
    await invoke(f.users.gm, "approve_document", f.org, {
      id: await f.document("receipt", "10", f.kitchen),
    });
    await invoke(f.users.operator, "create_recipe", f.org, {
      code: "DISH",
      name: "Dish",
      kind: "final",
      standard_output: "1",
      lines: [{ item_id: f.item, quantity: "1" }],
    });
    const payload = {
      kind: "sales",
      event_date: (
        await observer.query(
          "select (now() at time zone 'Africa/Lagos')::date::text as day",
        )
      ).rows[0].day,
      reason: "Sales race",
      source_system: "POS",
      lines: [
        {
          external_id: "same-line",
          menu_code: "DISH",
          location_id: f.kitchen,
          quantity: "1",
        },
      ],
    };
    const a = (
        await invoke(f.users.operator, "create_document", f.org, payload)
      ).id,
      b = (await invoke(f.users.operator, "create_document", f.org, payload))
        .id;
    await invoke(f.users.operator, "submit_document", f.org, { id: a });
    await invoke(f.users.operator, "submit_document", f.org, { id: b });
    const r = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) => cmd(c, "approve_document", f.org, { id: a }),
      (c) => cmd(c, "approve_document", f.org, { id: b }),
    );
    assert.equal(r.error?.code, "23505");
    assert.equal(
      Number(
        (
          await observer.query(
            "select quantity::text qty from public.stock_cost_state where item_id=$1",
            [f.item],
          )
        ).rows[0].qty,
      ),
      9,
    );
  });
  await test("concurrent Store acceptances cannot exceed the frozen purchase order", async () => {
    const f = await fixture();
    const vendor = (
      await invokeBusiness(f.users.owner, "save_vendor", f.org, {
        code: "V",
        name: "Race vendor",
      })
    ).id;
    await invokeBusiness(f.users.owner, "save_vendor_item", f.org, {
      vendor_id: vendor,
      item_id: f.item,
      purchase_unit: "bag",
      base_quantity: "10",
      conversion_note: "Measured test pack",
    });
    const po = (
      await invokeBusiness(f.users.owner, "create_purchase_order", f.org, {
        vendor_id: vendor,
        reason: "Race order",
        lines: [{ item_id: f.item, quantity: "1", unit_cost: "1000" }],
      })
    ).id;
    await invokeBusiness(f.users.owner, "submit_purchase_order", f.org, {
      id: po,
    });
    await invokeBusiness(f.users.gm, "approve_purchase_order", f.org, {
      id: po,
    });
    const date = (
      await observer.query(
        "select (now() at time zone 'Africa/Lagos')::date::text as day",
      )
    ).rows[0].day;
    const delivery = {
      id: po,
      event_date: date,
      location_id: f.loc,
      reason: "Race delivery",
      lines: [{ item_id: f.item, quantity: "0.75" }],
    };
    const result = await race(
      await session(f.users.operator),
      await session(f.users.operator),
      (c) => business(c, "create_purchase_receipt", f.org, delivery),
      (c) => business(c, "create_purchase_receipt", f.org, delivery),
    );
    assert.equal(result.error?.code, "23514");
    assert.equal(
      Number(
        (
          await observer.query(
            "select quantity from public.stock_cost_state where item_id=$1",
            [f.item],
          )
        ).rows[0].quantity,
      ),
      7.5,
    );
  });
  await test("concurrent dispatches cannot exceed approved department demand", async () => {
    const f = await fixture();
    await invoke(f.users.gm, "approve_document", f.org, {
      id: await f.document("receipt", "20"),
    });
    const req = (
      await invokeBusiness(f.users.owner, "create_requisition", f.org, {
        destination_location_id: f.kitchen,
        reason: "Race demand",
        lines: [{ item_id: f.item, quantity: "10" }],
      })
    ).id;
    await invokeBusiness(f.users.owner, "submit_requisition", f.org, {
      id: req,
    });
    await invokeBusiness(f.users.gm, "approve_requisition", f.org, { id: req });
    const date = (
      await observer.query(
        "select (now() at time zone 'Africa/Lagos')::date::text as day",
      )
    ).rows[0].day;
    const payload = {
      id: req,
      event_date: date,
      reason: "Race dispatch",
      lines: [{ item_id: f.item, quantity: "6" }],
    };
    const result = await race(
      await session(f.users.operator),
      await session(f.users.owner),
      (c) => business(c, "fulfil_requisition", f.org, payload),
      (c) => business(c, "fulfil_requisition", f.org, payload),
    );
    assert.equal(result.error?.code, "23514");
    assert.equal(
      Number(
        (
          await observer.query(
            "select quantity from public.stock_balances where item_id=$1 and location_id=$2",
            [f.item, f.loc],
          )
        ).rows[0].quantity,
      ),
      20,
    );
  });
  await test("competing reservations cannot spend the same source stock", async () => {
    const f = await fixture();
    await invoke(f.users.gm, "approve_document", f.org, {
      id: await f.document("receipt", "10"),
    });
    const date = (
      await observer.query(
        "select (now() at time zone 'Africa/Lagos')::date::text as day",
      )
    ).rows[0].day;
    const create = async (actor) => {
      const id = (
        await invoke(actor, "create_document", f.org, {
          kind: "transfer",
          event_date: date,
          reason: "Reservation race",
          source_location_id: f.loc,
          destination_location_id: f.kitchen,
          lines: [{ item_id: f.item, quantity: "7" }],
        })
      ).id;
      await invoke(actor, "submit_document", f.org, { id });
      return id;
    };
    const a = await create(f.users.operator),
      b = await create(f.users.owner);
    const result = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) => cmd(c, "approve_document", f.org, { id: a }),
      (c) => cmd(c, "approve_document", f.org, { id: b }),
    );
    assert.equal(result.error?.code, "23514");
    const row = (
      await observer.query(
        "select quantity,reserved_quantity,available_quantity from public.inventory_balance_view where item_id=$1 and location_id=$2",
        [f.item, f.loc],
      )
    ).rows[0];
    assert.equal(Number(row.quantity), 10);
    assert.equal(Number(row.reserved_quantity), 7);
    assert.equal(Number(row.available_quantity), 3);
  });
  await test("competing acceptance and rejection cannot decide the same quantity twice", async () => {
    const f = await fixture();
    await invoke(f.users.gm, "approve_document", f.org, {
      id: await f.document("receipt", "10"),
    });
    const date = (
      await observer.query(
        "select (now() at time zone 'Africa/Lagos')::date::text as day",
      )
    ).rows[0].day;
    const id = (
      await invoke(f.users.operator, "create_document", f.org, {
        kind: "transfer",
        event_date: date,
        reason: "Decision race",
        source_location_id: f.loc,
        destination_location_id: f.kitchen,
        lines: [{ item_id: f.item, quantity: "6" }],
      })
    ).id;
    await invoke(f.users.operator, "submit_document", f.org, { id });
    await invoke(f.users.gm, "approve_document", f.org, { id });
    const payload = {
      id,
      reason: "Concurrent decision",
      lines: [{ item_id: f.item, quantity: "4" }],
    };
    const result = await race(
      await session(f.users.gm),
      await session(f.users.ops),
      (c) => cmd(c, "receive_transfer", f.org, payload),
      (c) => cmd(c, "reject_transfer", f.org, payload),
    );
    assert.equal(result.error?.code, "22023");
    const row = (
      await observer.query(
        "select received_quantity,rejected_quantity from public.transfer_stock where document_id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(
      Number(row.received_quantity) + Number(row.rejected_quantity),
      4,
    );
  });
  console.log(`\n${passed} independent-session inventory races passed.`);
} finally {
  for (const c of connections) {
    try {
      await c.query("rollback");
    } finally {
      await c.end();
    }
  }
  await observer.end();
}
