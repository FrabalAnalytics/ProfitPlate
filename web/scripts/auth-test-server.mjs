// Loopback-only Supabase protocol fixture. Auth is emulated; RPCs/RLS use real PostgreSQL.
// This script is never imported by the application or used with hosted credentials.
import http from "node:http";
import {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  installAuthFixture,
  applyMigrations,
} from "./database-test-support.mjs";

const db = new PGlite();
await installAuthFixture(db);
await applyMigrations(db);
const signingKey = randomBytes(32);
const users = new Map(),
  codes = new Map(),
  refreshTokens = new Map(),
  revoked = new Set();
const password = "ProfitPlate-test-2026!";
let limits = {
  user: false,
  password: false,
  logout: false,
  account: false,
  refresh: false,
  clockSkewSeconds: 0,
};
let metrics = { user: 0, password: 0, logout: 0, account: 0, refresh: 0 };
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
async function addUser(email, confirmed = true, suppliedPassword = password) {
  const user = {
    id: randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: confirmed ? new Date().toISOString() : null,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
    identities: [],
  };
  users.set(email, { user, password: suppliedPassword });
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)",
    [user.id, email, user.email_confirmed_at],
  );
  return user;
}
const owner = await addUser("owner@profitplate.test");
const other = await addUser("other@profitplate.test");
await addUser("new@profitplate.test");
const staff = await addUser("staff@profitplate.test");
const locationViewer = await addUser("locations-viewer@profitplate.test");
const locationAdmin = await addUser("locations-admin@profitplate.test");
const locationOwner = await addUser("locations-owner@profitplate.test");
const inventoryOwner = await addUser("inventory-owner@profitplate.test");
const inventoryGM = await addUser("inventory-gm@profitplate.test");
const businessUsers = {};
for (const name of [
  "owner",
  "buyer",
  "store",
  "kitchen",
  "bar",
  "gm",
  "recipient",
]) {
  businessUsers[name] = await addUser(`business-${name}@profitplate.test`);
}
await addUser("unverified@profitplate.test", false);
await db.exec("begin");
await db.query(
  "insert into public.organizations(id,name) values($1,'Heritage Kitchen'),($2,'Another Restaurant')",
  [org, otherOrg],
);
await db.query(
  "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
  [org, owner.id, otherOrg, other.id, staff.id],
);
await db.exec("commit");
await db.query(
  "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'viewer'),($1,$3,'admin'),($4,$3,'admin')",
  [otherOrg, locationViewer.id, locationAdmin.id, org],
);
await db.transaction(async (tx) => {
  const workflowOrg = "33333333-3333-4333-8333-333333333333";
  await tx.query(
    "insert into public.organizations(id,name) values($1,'Location Workflow Restaurant')",
    [workflowOrg],
  );
  await tx.query(
    "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'owner')",
    [workflowOrg, locationOwner.id],
  );
});
await db.query(
  "insert into public.locations(organization_id,code,name) values($1,'CENTRAL','Central Kitchen')",
  [otherOrg],
);

await db.transaction(async (tx) => {
  const tenant = "44444444-4444-4444-8444-444444444444";
  await tx.query("insert into public.organizations(id,name) values($1,$2)", [
    tenant,
    "Operational Test Restaurant",
  ]);
  await tx.query(
    "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')",
    [tenant, inventoryOwner.id, inventoryGM.id],
  );
  await tx.query(
    "insert into public.operational_managers values($1,$2,'operations_manager')",
    [tenant, inventoryGM.id],
  );
  await tx.query(
    "insert into public.locations(organization_id,code,name) values($1,'KITCHEN','Kitchen')",
    [tenant],
  );
});

await db.query("select public.import_inventory_catalogue($1,$2,$3,$4::jsonb)", [
  "44444444-4444-4444-8444-444444444444",
  "catalogue-fixture.xlsx",
  "1".repeat(64),
  JSON.stringify([
    {
      source_row: 2,
      sku: "REF-BOTTLE",
      name: "Imported reference bottle",
      category: "raw_material",
      base_uom_code: "each",
      stock_unit_label: "bottle",
      source_unit: "Bottle",
      reference_price: "123.45000000",
      reference_date: "2026-10-20",
      price_status: "provided",
      reference_kind: "purchase_reference",
      source_values: { A: "REF-BOTTLE", E: "123.45" },
    },
    {
      source_row: 3,
      sku: "REF-ZERO",
      name: "Unconfirmed reference pack",
      category: "general",
      base_uom_code: "each",
      stock_unit_label: "pack",
      source_unit: "Pack",
      reference_price: "0.00000000",
      reference_date: "2026-10-20",
      price_status: "zero_unconfirmed",
      reference_kind: "purchase_reference",
      source_values: { A: "REF-ZERO", E: "0" },
    },
  ]),
]);

await db.transaction(async (tx) => {
  const tenant = "55555555-5555-4555-8555-555555555555";
  await tx.query("insert into public.organizations(id,name) values($1,$2)", [
    tenant,
    "Business Workflow Test Restaurant",
  ]);
  for (const [name, role] of Object.entries({
    owner: "owner",
    buyer: "procurement_officer",
    store: "inventory_manager",
    kitchen: "kitchen_lead",
    bar: "bar_lead",
    gm: "viewer",
  })) {
    await tx.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [tenant, businessUsers[name].id, role],
    );
  }
  await tx.query("insert into public.operational_managers values($1,$2,$3)", [
    tenant,
    businessUsers.gm.id,
    "operations_manager",
  ]);
  await tx.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: businessUsers.owner.id, role: "authenticated" }),
  ]);
  await tx.exec("set local role authenticated");
  await tx.query(
    "select public.inventory_command('prepare_areas',$1,$2,'{}')",
    [randomUUID(), tenant],
  );
  await tx.query(
    "select public.inventory_command('create_item',$1,$2,$3::jsonb)",
    [
      randomUUID(),
      tenant,
      JSON.stringify({
        sku: "B-RICE",
        name: "Workflow rice",
        category: "raw_material",
        base_uom_code: "kg",
      }),
    ],
  );
  await tx.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: businessUsers.gm.id, role: "authenticated" }),
  ]);
  const year = new Date().getUTCFullYear();
  await tx.query(
    "select public.inventory_command('create_period',$1,$2,$3::jsonb)",
    [
      randomUUID(),
      tenant,
      JSON.stringify({ starts_on: `${year}-01-01`, ends_on: `${year}-12-31` }),
    ],
  );
});

// The inventory regression user deliberately holds an explicit stock duty in this fixture only.
await db.query(
  "insert into public.additional_role_assignments values($1,$2,'inventory_manager',$2,now())",
  ["44444444-4444-4444-8444-444444444444", inventoryOwner.id],
);
const reportingUsers = {};
for (const name of ["owner", "store", "ops", "finance", "admin", "kitchen"])
  reportingUsers[name] = await addUser(`report-${name}@profitplate.test`);
await db.transaction(async (tx) => {
  const tenant = "66666666-6666-4666-8666-666666666666";
  await tx.query("insert into public.organizations(id,name) values($1,$2)", [
    tenant,
    "Reporting Test Restaurant",
  ]);
  for (const [name, role] of Object.entries({
    owner: "owner",
    store: "inventory_manager",
    ops: "viewer",
    finance: "accountant",
    admin: "admin",
    kitchen: "kitchen_lead",
  }))
    await tx.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)",
      [tenant, reportingUsers[name].id, role],
    );
  await tx.query(
    "insert into public.operational_managers values($1,$2,'operations_manager')",
    [tenant, reportingUsers.ops.id],
  );
  const login = async (name) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: reportingUsers[name].id, role: "authenticated" }),
    ]);
  };
  const command = async (fn, c, p = {}) =>
    (
      await tx.query(`select public.${fn}($1,$2,$3,$4::jsonb) result`, [
        c,
        randomUUID(),
        tenant,
        JSON.stringify(p),
      ])
    ).rows[0].result;
  await login("owner");
  await tx.exec("set local role authenticated");
  await command("inventory_command", "prepare_areas");
  const kitchen = (
    await tx.query(
      "select location_id from public.operating_areas where organization_id=$1 and area='kitchen'",
      [tenant],
    )
  ).rows[0].location_id;
  const dates = (
    await tx.query(
      "select (now() at time zone 'Africa/Lagos')::date::text as today,((now() at time zone 'Africa/Lagos')::date-1)::text as yesterday",
    )
  ).rows[0];
  await login("ops");
  await command("inventory_command", "create_period", {
    starts_on: dates.yesterday,
    ends_on: dates.today,
  });
  await login("store");
  const item = (
    await command("inventory_command", "create_item", {
      sku: "REPORT-RICE",
      name: "Reporting rice",
      category: "raw_material",
      base_uom_code: "kg",
    })
  ).id;
  const recipe = (
    await command("inventory_command", "create_recipe", {
      code: "REPORT-PLATE",
      name: "Reporting plate",
      kind: "final",
      standard_output: "1",
      lines: [{ item_id: item, quantity: "2" }],
    })
  ).id;
  await command("business_command", "save_menu_item", {
    code: "REPORT-MEAL",
    name: "Reporting meal",
    recipe_id: recipe,
    default_area: "kitchen",
    revenue_class: "food",
  });
  const receipt = (
    await command("inventory_command", "create_document", {
      kind: "receipt",
      event_date: dates.yesterday,
      destination_location_id: kitchen,
      reason: "Reporting opening receipt",
      lines: [{ item_id: item, quantity: "10", unit_cost: "100" }],
    })
  ).id;
  await command("inventory_command", "submit_document", { id: receipt });
  await login("ops");
  await command("inventory_command", "approve_document", { id: receipt });
});

function jwt(user, sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      session_id: sessionId,
      amr: [{ method: "password", timestamp: now }],
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", signingKey)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}
function session(user) {
  const refresh = randomBytes(24).toString("hex");
  const access = jwt(user);
  refreshTokens.set(refresh, user.id);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}
function authenticate(req) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const [head, body, sig] = token.split(".");
    const expected = createHmac("sha256", signingKey)
      .update(`${head}.${body}`)
      .digest();
    const supplied = Buffer.from(sig || "", "base64url");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    if (claims.exp < Date.now() / 1000 || revoked.has(claims.session_id))
      return null;
    return claims;
  } catch {
    return null;
  }
}
function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Supabase-Api-Version": "2024-01-01",
    ...extra,
  });
  res.end(
    body === undefined
      ? undefined
      : JSON.stringify(body, (key, value) =>
          ["starts_on", "ends_on", "event_date"].includes(key) &&
          typeof value === "string"
            ? value.slice(0, 10)
            : value,
        ),
  );
}
function userById(id) {
  return [...users.values()].find((entry) => entry.user.id === id)?.user;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:54329");
  try {
    if (url.pathname === "/health") return send(res, 200, { ready: true });
    if (url.pathname === "/__test/legacy-purchase-receipt") {
      const tenant = "55555555-5555-4555-8555-555555555555";
      const id = await db.transaction(async (tx) => {
        const line = (
          await tx.query(
            "select l.*,p.id as purchase_id from public.purchase_orders p join public.purchase_order_lines l on l.order_id=p.id where p.organization_id=$1 and p.status='approved' and p.number=1 limit 1",
            [tenant],
          )
        ).rows[0];
        if (!line) throw new Error("Approved fixture order required");
        const location = (
          await tx.query(
            "select location_id from public.operating_areas where organization_id=$1 and area='main_store'",
            [tenant],
          )
        ).rows[0].location_id;
        const day = (
          await tx.query(
            "select (now() at time zone 'Africa/Lagos')::date::text as day",
          )
        ).rows[0].day;
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({
            sub: businessUsers.store.id,
            role: "authenticated",
          }),
        ]);
        await tx.exec("set local role authenticated");
        const doc = (
          await tx.query(
            "select public.inventory_command('create_document',$1,$2,$3::jsonb) result",
            [
              randomUUID(),
              tenant,
              JSON.stringify({
                kind: "receipt",
                event_date: day,
                reason: "Legacy pending bags",
                destination_location_id: location,
                lines: [
                  {
                    item_id: line.item_id,
                    quantity: String(line.base_quantity),
                    unit_cost: String(line.normalized_unit_cost),
                  },
                ],
              }),
            ],
          )
        ).rows[0].result.id;
        await tx.query(
          "select public.inventory_command('submit_document',$1,$2,$3::jsonb)",
          [randomUUID(), tenant, JSON.stringify({ id: doc })],
        );
        await tx.exec("reset role");
        await tx.query(
          "insert into public.purchase_receipts values($1,$2,$3)",
          [tenant, doc, line.purchase_id],
        );
        await tx.query(
          "insert into public.purchase_receipt_lines values($1,$2,$3,1,0)",
          [tenant, doc, line.id],
        );
        return doc;
      });
      return send(res, 200, { id });
    }
    if (url.pathname === "/auth/v1/.well-known/jwks.json")
      return send(res, 200, { keys: [] });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/__test/auth-limits") {
      limits = {
        user: false,
        password: false,
        logout: false,
        account: false,
        refresh: false,
        clockSkewSeconds: 0,
        ...body,
      };
      if (body.resetMetrics)
        metrics = { user: 0, password: 0, logout: 0, account: 0, refresh: 0 };
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__test/metrics") return send(res, 200, metrics);
    if (url.pathname === "/__test/location-admin-role") {
      await db.query(
        "update public.organization_memberships set role=$1 where user_id=$2 and organization_id=$3",
        [
          body.role === "viewer" ? "viewer" : "admin",
          locationAdmin.id,
          otherOrg,
        ],
      );
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/auth/v1/settings")
      return send(
        res,
        200,
        { external: { email: true } },
        {
          Date: new Date(
            Date.now() + Number(limits.clockSkewSeconds || 0) * 1000,
          ).toUTCString(),
        },
      );
    if (url.pathname === "/__test/confirmation") {
      const entry = [...codes.entries()].find(
        ([, value]) => value.email === url.searchParams.get("email"),
      );
      return send(res, 200, { code: entry?.[0] });
    }
    if (url.pathname === "/__test/suspend") {
      await db.query(
        "update public.organization_memberships set status='suspended' where user_id=$1 and role<>'owner'",
        [staff.id],
      );
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        metrics.password++;
        if (limits.password)
          return send(res, 429, {
            code: "over_request_rate_limit",
            msg: "Request rate limit reached",
          });
        const entry = users.get(body.email);
        if (!entry || body.password !== entry.password)
          return send(res, 400, {
            code: "invalid_credentials",
            msg: "Invalid login credentials",
          });
        if (!entry.user.email_confirmed_at)
          return send(res, 400, {
            code: "email_not_confirmed",
            msg: "Email not confirmed",
          });
        return send(res, 200, session(entry.user));
      }
      if (grant === "refresh_token") {
        metrics.refresh++;
        if (limits.refresh)
          return send(res, 429, {
            code: "over_request_rate_limit",
            msg: "Request rate limit reached",
          });
        const user = userById(refreshTokens.get(body.refresh_token));
        return user
          ? send(res, 200, session(user))
          : send(res, 400, {
              code: "refresh_token_not_found",
              msg: "Invalid refresh token",
            });
      }
      if (grant === "pkce") {
        const challenge = codes.get(body.auth_code);
        if (
          !challenge ||
          createHash("sha256")
            .update(body.code_verifier || "")
            .digest("base64url") !== challenge.challenge
        )
          return send(res, 400, {
            code: "bad_code_verifier",
            msg: "Invalid verification code",
          });
        codes.delete(body.auth_code);
        const user = users.get(challenge.email).user;
        user.email_confirmed_at = new Date().toISOString();
        await db.query(
          "update auth.users set email_confirmed_at=$1 where id=$2",
          [user.email_confirmed_at, user.id],
        );
        return send(res, 200, session(user));
      }
    }
    if (
      ["/auth/v1/signup", "/auth/v1/recover", "/auth/v1/resend"].includes(
        url.pathname,
      )
    ) {
      let entry = users.get(body.email);
      if (!entry && url.pathname.endsWith("/signup")) {
        await addUser(body.email, false, body.password);
        entry = users.get(body.email);
      }
      if (entry)
        codes.set(randomUUID(), {
          email: body.email,
          challenge: body.code_challenge,
        });
      return send(
        res,
        200,
        url.pathname.endsWith("/signup") ? { user: entry?.user } : {},
      );
    }
    const claims = authenticate(req);
    if (!claims)
      return send(res, 401, { code: "bad_jwt", msg: "Invalid session" });
    if (url.pathname === "/auth/v1/user") {
      metrics.user++;
      if (limits.user)
        return send(res, 429, {
          code: "over_request_rate_limit",
          msg: "Request rate limit reached",
        });
      const user = userById(claims.sub);
      if (req.method === "PUT") users.get(user.email).password = body.password;
      return send(res, 200, user);
    }
    if (url.pathname === "/auth/v1/logout") {
      metrics.logout++;
      if (limits.logout)
        return send(res, 429, {
          code: "over_request_rate_limit",
          msg: "Request rate limit reached",
        });
      revoked.add(claims.session_id);
      return send(res, 204);
    }
    if (url.pathname === "/rest/v1/rpc/profitplate_command") {
      const result = await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(claims),
        ]);
        await tx.exec("set local role authenticated");
        return (
          await tx.query(
            "select public.profitplate_command($1,$2,$3,$4::jsonb) as result",
            [
              body.p_command,
              body.p_request_id,
              body.p_organization_id || null,
              JSON.stringify(body.p_payload || {}),
            ],
          )
        ).rows[0].result;
      });
      return send(res, 200, result);
    }
    if (url.pathname === "/rest/v1/rpc/current_account") {
      metrics.account++;
      if (limits.account)
        return send(res, 429, {
          code: "over_request_rate_limit",
          message: "Request rate limit reached",
        });
      const rows = await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(claims),
        ]);
        await tx.exec("set local role authenticated");
        return (await tx.query("select * from public.current_account()")).rows;
      });
      return send(
        res,
        200,
        req.headers.accept?.includes("vnd.pgrst.object")
          ? rows[0] || null
          : rows,
      );
    }
    const rpcName = url.pathname.startsWith("/rest/v1/rpc/")
      ? url.pathname.split("/").at(-1)
      : null;
    if (
      [
        "inventory_command",
        "current_recipe_cost",
        "inventory_document_preview",
        "inventory_team_options",
        "operating_report",
        "control_command",
        "reporting_command",
        "action_command",
        "business_command",
        "team_directory",
        "operating_people",
        "issue_manual_invitation",
      ].includes(rpcName)
    ) {
      const calls = {
        action_command: [
          "select public.action_command($1,$2,$3,$4::jsonb) result",
          [
            body.p_command,
            body.p_request_id,
            body.p_organization_id,
            JSON.stringify(body.p_payload ?? {}),
          ],
        ],
        operating_report: [
          "select public.operating_report($1,$2,$3,$4) result",
          [
            body.p_organization_id,
            body.p_starts_on,
            body.p_ends_on,
            body.p_location_id ?? null,
          ],
        ],
        control_command: [
          "select public.control_command($1,$2,$3,$4::jsonb) result",
          [
            body.p_command,
            body.p_request_id,
            body.p_organization_id,
            JSON.stringify(body.p_payload ?? {}),
          ],
        ],
        reporting_command: [
          "select public.reporting_command($1,$2,$3,$4::jsonb) result",
          [
            body.p_command,
            body.p_request_id,
            body.p_organization_id,
            JSON.stringify(body.p_payload ?? {}),
          ],
        ],
        business_command: [
          "select public.business_command($1,$2,$3,$4::jsonb) result",
          [
            body.p_command,
            body.p_request_id,
            body.p_organization_id,
            JSON.stringify(body.p_payload ?? {}),
          ],
        ],
        team_directory: [
          "select * from public.team_directory($1)",
          [body.p_organization_id],
        ],
        operating_people: [
          "select * from public.operating_people($1)",
          [body.p_organization_id],
        ],
        issue_manual_invitation: [
          "select public.issue_manual_invitation($1,$2) result",
          [body.p_organization_id, body.p_invitation_id],
        ],
        inventory_command: [
          "select public.inventory_command($1,$2,$3,$4::jsonb) result",
          [
            body.p_command,
            body.p_request_id,
            body.p_organization_id,
            JSON.stringify(body.p_payload ?? {}),
          ],
        ],
        current_recipe_cost: [
          "select public.current_recipe_cost($1,$2) result",
          [body.p_organization_id, body.p_recipe_id],
        ],
        inventory_document_preview: [
          "select public.inventory_document_preview($1,$2) result",
          [body.p_organization_id, body.p_document_id],
        ],
        inventory_team_options: [
          "select * from public.inventory_team_options($1)",
          [body.p_organization_id],
        ],
      };
      const [sql, args] = calls[rpcName];
      const result = await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(claims),
        ]);
        await tx.exec("set local role authenticated");
        return (await tx.query(sql, args)).rows;
      });
      return send(
        res,
        200,
        [
          "inventory_team_options",
          "team_directory",
          "operating_people",
        ].includes(rpcName)
          ? result
          : result[0].result,
      );
    }
    const table = url.pathname.split("/").at(-1);
    if (
      [
        "organizations",
        "additional_role_assignments",
        "stock_counts",
        "stock_count_lines",
        "stock_count_line_view",
        "report_reconciliations",
        "report_snapshots",
        "management_actions",
        "sales_revenue_evidence",
        "sales_cost_evidence",
        "organization_invitations",
        "units_of_measure",
        "item_uom_conversions",
        "item_conversion_history",
        "vendors",
        "vendor_items",
        "vendor_item_master",
        "menu_items",
        "final_recipe_master",
        "sub_recipe_master",
        "purchase_orders",
        "purchase_order_summary",
        "purchase_order_lines",
        "purchase_order_line_view",
        "purchase_receipts",
        "pending_purchase_receipt_view",
        "purchase_receipt_lines",
        "stock_requisitions",
        "stock_requisition_lines",
        "stock_requisition_line_view",
        "requisition_fulfilment_view",
        "requisition_dispatches",
        "requisition_dispatch_lines",
        "sales_menu_sources",
        "organization_memberships",
        "locations",
        "items",
        "operating_areas",
        "operational_managers",
        "inventory_periods",
        "recipes",
        "recipe_versions",
        "recipe_ingredients",
        "inventory_documents",
        "inventory_document_lines",
        "sales_import_rows",
        "sales_posting_keys",
        "stock_balances",
        "stock_cost_state",
        "inventory_movements",
        "transfer_stock",
        "transfer_delivery_view",
        "transfer_reservation_view",
        "inventory_balance_view",
        "inventory_item_view",
        "inventory_movement_view",
      ].includes(table) &&
      ["GET", "HEAD"].includes(req.method)
    ) {
      const fields = (url.searchParams.get("select") || "*").split(",");
      if (!fields.every((value) => value === "*" || /^[a-z_]+$/.test(value)))
        return send(res, 400, { code: "BAD_SELECT" });
      const params = [],
        where = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (!/^[a-z_]+$/.test(key))
          return send(res, 400, { code: "BAD_FILTER" });
        if (value.startsWith("eq.")) {
          params.push(value.slice(3));
          where.push(`"${key}"=$${params.length}`);
        } else if (value.startsWith("in.(")) {
          const ids = value.slice(4, -1).split(",");
          const holders = ids.map((id) => {
            params.push(id);
            return `$${params.length}`;
          });
          where.push(`"${key}" in (${holders.join(",")})`);
        }
      }
      const ordering = (url.searchParams.get("order") || "")
        .split(",")
        .filter(Boolean)
        .map((order) => {
          const match = /^([a-z_]+)\.(asc|desc)$/.exec(order);
          if (!match) throw new Error("Invalid ordering");
          return `"${match[1]}" ${match[2]}`;
        });
      const limit = url.searchParams.get("limit");
      if (limit && !/^\d{1,5}$/.test(limit)) throw new Error("Invalid limit");
      const rows = await db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify(claims),
        ]);
        await tx.exec("set local role authenticated");
        return (
          await tx.query(
            `select ${fields.map((f) => (f === "*" ? "*" : `"${f}"`)).join(",")} from public."${table}"${where.length ? ` where ${where.join(" and ")}` : ""}${ordering.length ? ` order by ${ordering.join(",")}` : ""}${limit ? ` limit ${Number(limit)}` : ""}`,
            params,
          )
        ).rows;
      });
      return send(
        res,
        200,
        req.method === "HEAD"
          ? undefined
          : req.headers.accept?.includes("vnd.pgrst.object")
            ? rows[0] || null
            : rows,
        {
          "Content-Range": `${rows.length ? `0-${rows.length - 1}` : "*"}/${rows.length}`,
        },
      );
    }
    return send(res, 404, { code: "NOT_FOUND" });
  } catch (error) {
    return send(res, 400, {
      code: error.code || "FIXTURE_ERROR",
      message: "Test request rejected",
    });
  }
});
server.listen(54329, "127.0.0.1", () =>
  console.log(
    "Local Auth/PostgREST fixture ready on 127.0.0.1:54329; no external email or hosted data access.",
  ),
);
process.on("SIGTERM", () =>
  server.close(() => db.close().then(() => process.exit(0))),
);
