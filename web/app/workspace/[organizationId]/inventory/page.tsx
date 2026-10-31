import { SalesBatchList } from "@/components/sales-batch-list";
import { redirect } from "next/navigation";
import { operationNotice } from "@/lib/operation-notice";
import { TransferDelivery } from "@/components/transfer-delivery";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireMembership, requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  OperationForm,
  type OperationField,
} from "@/components/operation-form";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
import { SalesImport } from "@/components/sales-import";
import { PurchasePrice } from "@/components/purchase-price";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import type { OperationIntent } from "./actions";
import { workspaceRole } from "@/lib/workspace-role";
export const instant = false;
export const metadata = { title: "Inventory" };
export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    view?: string;
    action?: string;
    saved?: string;
    document?: string;
  }>;
}) {
  const { organizationId } = await params;
  const { membership } = await requireMembership(organizationId);
  const user = await requireUser();
  const access = await workspaceRole(organizationId);
  const { view = "items", action, saved, document } = await searchParams;
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}/inventory`;
  const [itemResult, locationResult, purchaseResult] = await Promise.all([
    db
      .from("items")
      .select("id,sku,name,category,base_uom_code,is_active,stock_unit_label")
      .eq("organization_id", organizationId)
      .order("name")
      .limit(500),
    db
      .from("locations")
      .select("id,name,is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name"),
    db
      .from("inventory_item_view")
      .select(
        "id,last_purchase_unit_cost,last_purchase_date,last_purchase_source,imported_price_status",
      )
      .eq("organization_id", organizationId)
      .order("name")
      .limit(500),
  ]);
  if (itemResult.error || locationResult.error || purchaseResult.error)
    throw new Error("We could not load inventory. Please try again.");
  const items = itemResult.data;
  const purchases = new Map(purchaseResult.data.map((item) => [item.id, item]));
  const locations = locationResult.data;
  const isManager = access.isManager;
  const canEdit =
    ["owner", "admin", "inventory_manager", "kitchen_lead"].includes(
      membership.role,
    ) || isManager;
  const isOperator =
    access.canStock || ["kitchen_lead", "bar_lead"].includes(membership.role);
  const isOwner = membership.role === "owner";
  const isAdmin = isOwner || membership.role === "admin";
  const itemOptions = items
    .filter((i) => i.is_active)
    .map((i) => ({
      value: i.id,
      label: `${i.name} (${i.stock_unit_label ?? i.base_uom_code})`,
      keywords: i.sku,
    }));
  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.name,
  }));
  const field = (
    name: string,
    label: string,
    options?: OperationField["options"],
    help?: string,
  ): OperationField => ({ name, label, options, help });
  const hidden = (name: string, value: string): OperationField => ({
    name,
    label: name,
    type: "hidden",
    value,
  });
  const reason = field(
    "reason",
    "Reason / reference",
    undefined,
    "Required for traceability, including backdated entries.",
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const eventDate: OperationField = {
    name: "event_date",
    label: "Event date",
    type: "date",
    value: today,
  };
  function form(
    intent: OperationIntent,
    fields: OperationField[],
    button: string,
    options?: {
      lines?: boolean;
      costs?: boolean;
      recipe?: boolean;
      help?: string;
    },
  ) {
    return (
      <OperationForm
        key={`${intent}-${fields.find((f) => f.name === "id")?.value ?? action ?? ""}`}
        organizationId={organizationId}
        intent={intent}
        requestId={randomUUID()}
        fields={fields}
        button={button}
        items={
          options?.lines
            ? options.recipe
              ? itemOptions.filter(
                  (o) =>
                    items.find((i) => i.id === o.value)?.category !== "general",
                )
              : itemOptions
            : undefined
        }
        lineCosts={options?.costs}
        help={options?.help}
      />
    );
  }
  let content: React.ReactNode;
  if (view === "controls") {
    const [areas, periods, team] = await Promise.all([
      db
        .from("operating_areas")
        .select("area,location_id")
        .eq("organization_id", organizationId),
      db
        .from("inventory_periods")
        .select("id,starts_on,ends_on,is_closed")
        .eq("organization_id", organizationId)
        .order("starts_on", { ascending: false })
        .limit(50),
      isAdmin
        ? db.rpc("inventory_team_options", {
            p_organization_id: organizationId,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (areas.error || periods.error || team.error)
      throw new Error("We could not load operational controls.");
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Three operating areas</h2>
          <p className="inventory-intro">
            Main Store, Kitchen and Bar. Existing matching locations are reused.
          </p>
          <ul>
            {areas.data.map((a) => (
              <li key={a.area}>
                {a.area.replaceAll("_", " ")}:{" "}
                {locations.find((l) => l.id === a.location_id)?.name ??
                  "Inactive location"}
              </li>
            ))}
          </ul>
          {isAdmin &&
            areas.data.length < 3 &&
            form("prepare_areas", [], "Set up the three areas")}
          {isAdmin && (
            <details className="inventory-details">
              <summary>Choose existing locations manually</summary>
              {form(
                "configure_areas",
                [
                  field("main_store", "Main Store", locationOptions),
                  field("kitchen", "Kitchen", locationOptions),
                  field("bar", "Bar", locationOptions),
                ],
                "Save operating areas",
                {
                  help: "Area mappings are locked after the first stock movement.",
                },
              )}
            </details>
          )}
        </section>
        <section className="panel">
          <h2>Manager appointments</h2>
          <p className="inventory-intro">
            Operations Managers approve any value. Nobody can approve their own
            submission. Appoint at least two different people before operational
            testing.
          </p>
          {team.data?.map((m) => (
            <p key={m.user_id}>
              {m.email} —{" "}
              {m.manager_role?.replaceAll("_", " ") ??
                m.member_role.replaceAll("_", " ")}
            </p>
          ))}
          {isOwner ? (
            form(
              "appoint_manager",
              [
                field(
                  "user_id",
                  "Business member",
                  team.data?.map((m) => ({
                    value: m.user_id,
                    label: m.email ?? m.user_id,
                  })) ?? [],
                ),
                field("manager_role", "Manager role", [
                  { value: "operations_manager", label: "Operations Manager" },
                ]),
              ],
              "Save manager appointment",
            )
          ) : (
            <p className="field-help">
              The business owner appoints operational managers from active
              verified members.
            </p>
          )}
          {isOwner && team.data?.some((m) => m.manager_role) && (
            <details className="inventory-details">
              <summary>Remove a manager appointment</summary>
              {form(
                "remove_manager",
                [
                  field(
                    "user_id",
                    "Manager",
                    team.data
                      .filter((m) => m.manager_role)
                      .map((m) => ({
                        value: m.user_id,
                        label: m.email ?? m.user_id,
                      })),
                  ),
                  reason,
                ],
                "Remove appointment",
              )}
            </details>
          )}
        </section>
        <section className="panel">
          <h2>Inventory periods</h2>
          <p className="inventory-intro">
            Posting requires an open period. Backdated entries require manager
            approval; only an Operations Manager can reopen a closed period.
          </p>
          {isManager &&
            form(
              "create_period",
              [
                { name: "starts_on", label: "Start date", type: "date" },
                { name: "ends_on", label: "End date", type: "date" },
              ],
              "Create open period",
            )}
          {periods.data.map((p) => (
            <div className="inventory-period" key={p.id}>
              <strong>
                {p.starts_on} to {p.ends_on} · {p.is_closed ? "Closed" : "Open"}
              </strong>
              {isManager &&
                (!p.is_closed || access.isManager) &&
                form(
                  p.is_closed ? "reopen_period" : "close_period",
                  [hidden("id", p.id), reason],
                  p.is_closed ? "Reopen period" : "Close period",
                )}
            </div>
          ))}
        </section>
      </div>
    );
  } else if (view === "stock" || view === "movements") {
    if (view === "stock") {
      const { data, error } = await db
        .from("inventory_balance_view")
        .select("*")
        .eq("organization_id", organizationId)
        .order("location_name")
        .order("item_name")
        .limit(500);
      if (error) throw new Error("We could not load stock balances.");
      content = (
        <section className="panel">
          <h2>Stock by location</h2>
          <LiveInventoryRefresh />
          <p className="inventory-intro">
            Current value uses business-wide average cost. Showing up to 500
            item/location balances.
          </p>
          {data.length ? (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Location</th>
                    <th>Quantity</th>
                    <th>Reserved for delivery</th>
                    <th>Available to issue</th>
                    <th>Average cost (NGN)</th>
                    <th>Last purchase price (NGN/base unit)</th>
                    <th>Current value (NGN)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((b) => (
                    <tr key={`${b.location_id}-${b.item_id}`}>
                      <td>{b.item_name}</td>
                      <td>{b.location_name}</td>
                      <td>
                        {formatInventoryNumber(b.quantity!)}{" "}
                        {b.display_unit ?? b.base_uom_code}
                      </td>
                      <td>{formatInventoryNumber(b.reserved_quantity)}</td>
                      <td>{formatInventoryNumber(b.available_quantity)}</td>
                      <td>
                        {b.average_cost == null
                          ? "Missing"
                          : formatAmount(b.average_cost)}
                      </td>
                      <td>
                        <PurchasePrice
                          price={b.last_purchase_unit_cost}
                          source={b.last_purchase_source}
                          status={b.imported_price_status}
                          category={b.category}
                        />
                      </td>
                      <td>
                        {b.current_value == null
                          ? "Incomplete"
                          : formatAmount(b.current_value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="inventory-empty">
              No stock has been posted. Start with independently approved
              opening balances.
            </p>
          )}
        </section>
      );
    } else {
      const { data, error } = await db
        .from("inventory_movement_view")
        .select("*")
        .eq("organization_id", organizationId)
        .order("posted_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100);
      if (error) throw new Error("We could not load inventory movements.");
      content = (
        <section className="panel">
          <h2>Latest 100 inventory movements</h2>
          <LiveInventoryRefresh />
          <p className="inventory-intro">
            Permanent posting history. Event dates and posting times are shown
            separately.
          </p>
          {data.length ? (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Posted</th>
                    <th>Event date</th>
                    <th>Item</th>
                    <th>Location</th>
                    <th>Movement</th>
                    <th>Quantity</th>
                    <th>Value (NGN)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {new Intl.DateTimeFormat("en-GB", {
                          timeZone: "Africa/Lagos",
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(m.posted_at!))}
                      </td>
                      <td>{m.event_date}</td>
                      <td>{m.item_name}</td>
                      <td>{m.location_name ?? "In transit"}</td>
                      <td>{m.movement?.replaceAll("_", " ")}</td>
                      <td>
                        {formatInventoryNumber(m.quantity!)}{" "}
                        {m.display_unit ?? m.base_uom_code}
                      </td>
                      <td>{m.value == null ? "" : formatAmount(m.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="inventory-empty">
              No movements yet. Drafts and pending approvals do not change
              inventory.
            </p>
          )}
        </section>
      );
    }
  } else if (["recipes", "final_recipes", "sub_recipes"].includes(view)) {
    const recipeKind =
      view === "final_recipes"
        ? "final"
        : view === "sub_recipes"
          ? "sub_recipe"
          : undefined;
    let recipeQuery = db
      .from("recipes")
      .select("id,code,name,kind,output_item_id")
      .eq("organization_id", organizationId)
      .order("name")
      .limit(100);
    if (recipeKind) recipeQuery = recipeQuery.eq("kind", recipeKind);
    const { data: recipes, error } = await recipeQuery;
    if (error) throw new Error("We could not load recipes.");
    const costs = await Promise.all(
      recipes.map((r) =>
        db.rpc("current_recipe_cost", {
          p_organization_id: organizationId,
          p_recipe_id: r.id,
        }),
      ),
    );
    if (costs.some((c) => c.error))
      throw new Error("We could not calculate recipe costs.");
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>
            {recipeKind === "final"
              ? "Final recipe master"
              : recipeKind === "sub_recipe"
                ? "Sub-recipe master"
                : "Recipes and live costs"}
          </h2>
          <p className="inventory-intro">
            Final recipes consume their listed ingredients. Stocked sub-recipes
            consume the semi-finished SKU at sale time, without consuming its
            raw ingredients again.
          </p>
          {recipes.length ? (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Recipe / menu code</th>
                    <th>Type</th>
                    <th>Current unit cost (NGN)</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((r, i) => {
                    const cost = costs[i].data;
                    return (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          <small>{r.code}</small>
                        </td>
                        <td>{r.kind.replaceAll("_", " ")}</td>
                        <td>
                          {cost &&
                          typeof cost === "object" &&
                          !Array.isArray(cost) &&
                          cost.complete
                            ? formatAmount(String(cost.unit_cost))
                            : "Incomplete — ingredient costs missing"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="inventory-empty">
              No recipes yet. Define ingredients and semi-finished SKUs first.
            </p>
          )}
        </section>
        {canEdit && (
          <section className="panel inventory-form-panel">
            <h2>Create a recipe</h2>
            {form(
              "create_recipe",
              [
                field("name", "Recipe name"),
                field("code", "Recipe / menu code"),
                recipeKind
                  ? hidden("kind", recipeKind)
                  : field("kind", "Recipe type", [
                      { value: "final", label: "Final recipe" },
                      { value: "sub_recipe", label: "Stocked sub-recipe" },
                    ]),
                {
                  ...field(
                    "output_item_id",
                    "Semi-finished output SKU",
                    itemOptions.filter(
                      (o) =>
                        items.find((i) => i.id === o.value)?.category ===
                        "semi_finished",
                    ),
                    "Choose only for a stocked sub-recipe. Leave blank for a final recipe.",
                  ),
                  optional: true,
                },
                field(
                  "standard_output",
                  "Standard output quantity",
                  undefined,
                  "Portions for a final recipe; base-unit output for a stocked sub-recipe.",
                ),
              ],
              "Save recipe",
              {
                lines: true,
                recipe: true,
                help: "Ingredient quantities are for the entire standard output, in each item’s base unit.",
              },
            )}
          </section>
        )}
        {canEdit && recipes.length > 0 && (
          <section className="panel inventory-form-panel">
            <h2>Create a new recipe version</h2>
            {form(
              "revise_recipe",
              [
                field(
                  "id",
                  "Recipe",
                  recipes.map((r) => ({ value: r.id, label: r.name })),
                ),
                field("standard_output", "Standard output quantity"),
              ],
              "Save new version",
              {
                lines: true,
                recipe: true,
                help: "Enter the full new ingredient list. Existing versions and drafts retain their original quantities.",
              },
            )}
          </section>
        )}
      </div>
    );
  } else if (view === "sales") {
    content = access.canStock ? (
      <SalesImport
        organizationId={organizationId}
        requestId={randomUUID()}
        today={today}
      />
    ) : (
      <section className="panel">
        <p>
          Your role can view inventory. An inventory operator imports sales for
          review.
        </p>
      </section>
    );
  } else if (view === "documents" || view === "batches") {
    let documentQuery = db
      .from("inventory_documents")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (view === "batches") documentQuery = documentQuery.eq("kind", "sales");
    if (document) documentQuery = documentQuery.eq("id", document);
    const [documents, versions, transit] = await Promise.all([
      documentQuery,
      db
        .from("recipe_versions")
        .select("id,recipe_id,revision,standard_output")
        .eq("organization_id", organizationId)
        .order("revision", { ascending: false })
        .limit(500),
      db
        .from("transfer_delivery_view")
        .select("*")
        .eq("organization_id", organizationId)
        .limit(500),
    ]);
    if (documents.error || versions.error || transit.error)
      throw new Error("We could not load stock documents.");
    if (document && documents.data[0]?.kind === "sales")
      redirect(`/workspace/${organizationId}/sales/${documents.data[0].id}`);
    const links = documents.data.length
      ? await db
          .from("purchase_receipts")
          .select("document_id")
          .eq("organization_id", organizationId)
          .in(
            "document_id",
            documents.data.map((d) => d.id),
          )
      : { data: [], error: null };
    if (links.error)
      throw new Error("Could not load purchase receipt references.");
    const purchaseReceiptIds = new Set(links.data.map((r) => r.document_id));
    const previews = await Promise.all(
      documents.data.map((d) =>
        db.rpc("inventory_document_preview", {
          p_organization_id: organizationId,
          p_document_id: d.id,
        }),
      ),
    );
    if (previews.some((p) => p.error))
      throw new Error("We could not load document details for review.");
    const { data: subRecipes, error } = await db
      .from("recipes")
      .select("id,name,kind")
      .eq("organization_id", organizationId)
      .eq("kind", "sub_recipe");
    if (error) throw new Error("We could not load production recipes.");
    const kinds = [
      "opening",
      "receipt",
      "transfer",
      "production",
      "waste",
      "usage",
    ].filter(
      (kind) =>
        access.canStock ||
        ["production", "waste", "usage", "transfer"].includes(kind),
    );
    const kind =
      view === "documents" && kinds.includes(action ?? "") ? action : undefined;
    const fields: OperationField[] = kind
      ? [hidden("kind", kind), eventDate, reason]
      : [];
    if (kind && ["transfer", "production", "waste", "usage"].includes(kind))
      fields.push({
        ...field("source_location_id", "Source location", locationOptions),
        value:
          kind === "production"
            ? access.areas.find((a) => a.area === "kitchen")?.location_id
            : (access.departmentLocation ??
              (access.primaryRole === "inventory_manager"
                ? access.areas.find((a) => a.area === "main_store")?.location_id
                : undefined)),
      });
    if (kind && ["opening", "receipt", "transfer"].includes(kind))
      fields.push({
        ...field(
          "destination_location_id",
          "Destination location",
          locationOptions,
        ),
        value:
          kind === "transfer"
            ? undefined
            : (access.departmentLocation ??
              access.areas.find((a) => a.area === "main_store")?.location_id),
      });
    if (kind === "production")
      fields.push(
        field(
          "recipe_version_id",
          "Production recipe version",
          versions.data
            .filter((v) => subRecipes.some((r) => r.id === v.recipe_id))
            .map((v) => ({
              value: v.id,
              label: `${subRecipes.find((r) => r.id === v.recipe_id)?.name} · version ${v.revision} · standard output ${formatInventoryNumber(v.standard_output)}`,
            })),
        ),
        field(
          "planned_output",
          "Planned output quantity",
          undefined,
          "Standard ingredient quantities scale to this amount.",
        ),
        field(
          "actual_output",
          "Actual declared output quantity",
          undefined,
          "The quantity physically produced and added to Kitchen.",
        ),
      );
    content = (
      <div className="inventory-sections">
        {isOperator && view === "documents" && (
          <div className="inventory-actions">
            {kinds.map((k) => (
              <Link
                key={k}
                className="button button-secondary"
                href={`${base}?view=documents&action=${k}`}
              >
                {k === "usage" ? "General-item usage" : k.replaceAll("_", " ")}
              </Link>
            ))}
          </div>
        )}
        {kind && isOperator && (
          <section className="panel inventory-form-panel">
            <h2>New {kind === "usage" ? "general-item usage" : kind}</h2>
            {form("create_document", fields, "Save draft", {
              lines: kind !== "production",
              costs: ["opening", "receipt"].includes(kind),
              help:
                kind === "production"
                  ? "Kitchen only. Standard inputs are deducted on approval; actual output increases the semi-finished SKU."
                  : "Enter quantities in item base units. Saving a draft does not change stock. Submit it for independent manager approval.",
            })}
          </section>
        )}
        {view === "batches" && <LiveInventoryRefresh />}
        {(view === "batches" || (!kind && !document)) && (
          <SalesBatchList
            organizationId={organizationId}
            batches={documents.data
              .map((d, index) => ({ ...d, preview: previews[index].data }))
              .filter((d) => d.kind === "sales")}
          />
        )}
        {view !== "batches" && (
          <section className="panel">
            <h2>Stock documents</h2>
            {!kind && <LiveInventoryRefresh />}
            <p className="inventory-intro">
              Only a different Operations Manager can approve and post a
              submitted document.
            </p>
            {!documents.data.some((d) => d.kind !== "sales") && (
              <p className="inventory-empty">
                No documents yet. Configure operating areas, managers and
                periods before posting stock.
              </p>
            )}
            {documents.data.map((d, index) =>
              d.kind === "sales" ? null : (
                <article
                  className="inventory-document"
                  key={d.id}
                  aria-label={`${d.kind} ${d.reason}`}
                >
                  <div className="panel-heading">
                    <h3 className="capitalize">
                      {d.kind.replaceAll("_", " ")} · {d.event_date}
                    </h3>
                    <span className="role-pill">{d.status}</span>
                  </div>
                  <p>{d.reason}</p>
                  <p className="field-help">
                    {locations.find((l) => l.id === d.source_location_id)?.name}
                    {d.destination_location_id
                      ? ` → ${locations.find((l) => l.id === d.destination_location_id)?.name}`
                      : ""}{" "}
                    · Reference {d.id.slice(0, 8)}
                  </p>
                  <p className="field-help">
                    Created by {d.created_by.slice(0, 8)}
                    {d.approved_by
                      ? ` · Reviewed by ${d.approved_by.slice(0, 8)}`
                      : ""}
                  </p>
                  <div className="inventory-table-wrap">
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Location</th>
                          <th>Quantity</th>
                          <th>Unit cost (NGN)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const preview = previews[index].data;
                          const lines =
                            preview &&
                            typeof preview === "object" &&
                            !Array.isArray(preview) &&
                            Array.isArray(preview.lines)
                              ? preview.lines
                              : [];
                          return lines.map((line, index) =>
                            line &&
                            typeof line === "object" &&
                            !Array.isArray(line) ? (
                              <tr key={index}>
                                <td>{String(line.item)}</td>
                                <td>{String(line.location ?? "")}</td>
                                <td>
                                  {formatInventoryNumber(String(line.quantity))}{" "}
                                  {String(line.unit)}
                                </td>
                                <td>
                                  {line.unit_cost === null
                                    ? "Missing"
                                    : formatAmount(String(line.unit_cost))}
                                </td>
                              </tr>
                            ) : null,
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                  {d.status === "submitted" && d.kind !== "sales" && (
                    <p className="field-help">
                      {purchaseReceiptIds.has(d.id)
                        ? "This delivery awaits acceptance by its recorded receiver. Its approved purchase order provides the posting authority."
                        : "Preview costs use current averages. Approval rechecks current costs and stock before posting."}
                    </p>
                  )}
                  {d.kind === "receipt" &&
                    d.posting_basis === "approved_purchase_order" &&
                    d.status === "posted" && (
                      <p className="field-help">
                        Store acceptance posted this receipt against its
                        approved purchase order. No second receipt approval was
                        required.
                      </p>
                    )}
                  {purchaseReceiptIds.has(d.id) &&
                    ["draft", "submitted"].includes(d.status) &&
                    d.created_by === user.id &&
                    access.canStock &&
                    form(
                      "accept_purchase_receipt",
                      [hidden("id", d.id)],
                      "Accept delivery and update stock",
                      {
                        help: "Review the saved quantities above. Accept this existing delivery once; it updates stock immediately against its approved order.",
                      },
                    )}
                  {d.kind === "production" && (
                    <p className="field-help">
                      Planned output:{" "}
                      {formatInventoryNumber(String(d.planned_output))} · Actual
                      output: {formatInventoryNumber(String(d.actual_output))}
                    </p>
                  )}
                  {d.status === "draft" &&
                    !purchaseReceiptIds.has(d.id) &&
                    d.created_by === user.id &&
                    form(
                      "submit_document",
                      [hidden("id", d.id)],
                      "Submit for approval",
                    )}
                  {d.status === "submitted" &&
                    d.created_by === user.id &&
                    !purchaseReceiptIds.has(d.id) && (
                      <p className="field-help">
                        Waiting for another manager. Self-approval is blocked.
                      </p>
                    )}
                  {d.status === "submitted" &&
                    isManager &&
                    d.created_by !== user.id && (
                      <div className="inventory-approval">
                        {!purchaseReceiptIds.has(d.id) &&
                          form(
                            "approve_document",
                            [hidden("id", d.id)],
                            d.kind === "sales"
                              ? "Approve sales and post"
                              : "Approve and post",
                          )}
                        <details>
                          <summary>Reject submission</summary>
                          {form(
                            "reject_document",
                            [hidden("id", d.id), reason],
                            "Reject document",
                          )}
                        </details>
                      </div>
                    )}
                  {d.kind === "transfer" && (
                    <TransferDelivery
                      organizationId={organizationId}
                      lines={transit.data.filter((t) => t.document_id === d.id)}
                      userId={user.id}
                      canReceive={
                        access.canStock ||
                        access.departmentLocation === d.destination_location_id
                      }
                      canReturn={access.canStock}
                    />
                  )}
                </article>
              ),
            )}
          </section>
        )}
      </div>
    );
  } else {
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Item catalogue</h2>
          <p className="inventory-intro">
            Three categories, one shared catalogue. Showing up to 500 items.
            Units and categories stay fixed once created. Posted receipt prices
            take priority; imported historical prices are labelled as
            references.
          </p>
          {items.length ? (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Base unit</th>
                    <th>Last purchase price (NGN/base unit)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.sku}</td>
                      <td>{i.category.replaceAll("_", " ")}</td>
                      <td>{i.stock_unit_label ?? i.base_uom_code}</td>
                      <td>
                        <PurchasePrice
                          price={purchases.get(i.id)?.last_purchase_unit_cost}
                          source={purchases.get(i.id)?.last_purchase_source}
                          status={purchases.get(i.id)?.imported_price_status}
                          category={i.category}
                        />
                      </td>
                      <td>{i.is_active ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="inventory-empty">
              Add your first raw material, semi-finished SKU, or general supply.
            </p>
          )}
        </section>
        {canEdit && (
          <section className="panel inventory-form-panel">
            <h2>Add inventory item</h2>
            {form(
              "create_item",
              [
                field("name", "Item name"),
                field("sku", "SKU"),
                field("category", "Category", [
                  { value: "raw_material", label: "Raw material" },
                  { value: "semi_finished", label: "Semi-finished" },
                  { value: "general", label: "General supply" },
                ]),
                field(
                  "base_uom_code",
                  "Base unit",
                  ["g", "kg", "ml", "l", "each", "dozen"].map((u) => ({
                    value: u,
                    label: u,
                  })),
                ),
              ],
              "Add inventory item",
            )}
          </section>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CONTROL WHAT MOVES. KNOW WHAT REMAINS.</p>
          <h1>Inventory</h1>
          <p>
            Shared items, approved movements, and stock across your operating
            areas.
          </p>
        </div>
      </div>
      <nav className="inventory-tabs" aria-label="Inventory sections">
        {[
          ["items", "Items"],
          ["stock", "Stock on hand"],
          ["movements", "Movements"],
          ["recipes", "Recipes"],
          ["documents", "Documents & approvals"],
          ["batches", "Sales batches"],
          ["sales", "Sales import"],
          ["controls", "Operating controls"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`${base}?view=${key}`}
            aria-current={view === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {saved && (
        <p className="notice notice-success location-notice" role="status">
          {operationNotice[saved] ?? "Changes saved successfully."}
        </p>
      )}
      {content}
    </>
  );
}
