import { readAll } from "@/lib/read-all";
import { ResponsiveTable } from "@/components/responsive-table";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  activeField,
} from "@/components/business-form";
import type { OperationField } from "@/components/operation-form";
export const instant = false;
export const metadata = { title: "Master data" };
export default async function MastersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ view?: string; edit?: string; saved?: string }>;
}) {
  const { organizationId } = await params;
  const access = await workspaceRole(organizationId);
  const { view = "overview", edit, saved } = await searchParams;
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}`;
  const input = (
    name: string,
    label: string,
    value?: string,
    help?: string,
  ): OperationField => ({ name, label, value, help });
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    value?: string,
    optional = false,
  ): OperationField => ({ name, label, options, value, optional });
  let content: React.ReactNode;
  if (view === "vendors") {
    if (!access.canReadVendors) notFound();
    const { data: vendors, error } = await readAll(db
      .from("vendors")
      .select("*", {count:"exact"})
      .eq("organization_id", organizationId)
      .order("name")
      .order("id"));
    if (error) throw new Error("Could not load vendors.");
    const vendor = vendors.find((v) => v.id === edit);
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Vendor master</h2>
          <p className="inventory-intro">
            Supplier identities and contact details. Deactivation preserves
            orders and history.
          </p>
          {vendors.length === 0 ? (
            <p>No vendors yet.</p>
          ) : (
            <ResponsiveTable label="Master records">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Code</th>
                    <th>Contact</th>
                    <th>Status</th>
                    {access.canPurchase && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.code}</td>
                      <td>
                        {v.contact_name}
                        <small>
                          {v.email} {v.phone}
                        </small>
                      </td>
                      <td>{v.is_active ? "Active" : "Inactive"}</td>
                      {access.canPurchase && (
                        <td>
                          <Link
                            className="text-link"
                            href={`${base}/masters?view=vendors&edit=${v.id}`}
                          >
                            Edit {v.name}
                          </Link>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          )}
        </section>
        {access.canPurchase && (
          <section className="panel inventory-form-panel">
            <h2>{vendor ? "Edit vendor" : "Add vendor"}</h2>
            <BusinessForm
              key={vendor?.id ?? "new"}
              organizationId={organizationId}
              intent="save_vendor"
              button="Save vendor"
              fields={[
                ...(vendor ? [hiddenField("id", vendor.id)] : []),
                input("code", "Vendor code", vendor?.code),
                input("name", "Vendor name", vendor?.name),
                {
                  ...input(
                    "contact_name",
                    "Contact name",
                    vendor?.contact_name ?? "",
                  ),
                  optional: true,
                },
                {
                  name: "email",
                  label: "Contact email",
                  type: "email",
                  value: vendor?.email ?? "",
                  optional: true,
                },
                {
                  ...input("phone", "Phone", vendor?.phone ?? ""),
                  optional: true,
                },
                {
                  ...input("address", "Address", vendor?.address ?? ""),
                  optional: true,
                },
                { ...activeField, value: String(vendor?.is_active ?? true) },
              ]}
            />
          </section>
        )}
      </div>
    );
  } else if (view === "vendor_items") {
    if (!access.canReadVendors) notFound();
    const [mappings, vendors, items] = await Promise.all([
      readAll(db
        .from("vendor_item_master")
        .select("*", {count:"exact"})
        .eq("organization_id", organizationId)
        .order("vendor_name")
        .order("item_name")
        .order("id")),
      db
        .from("vendors")
        .select("id,name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
      readAll(db
        .from("items")
        .select("id,name,sku,base_uom_code,stock_unit_label,category", {count:"exact"})
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name")
        .order("id")),
    ]);
    if (mappings.error || vendors.error || items.error)
      throw new Error("Could not load supplier items.");
    const mapping = mappings.data.find((m) => m.id === edit);
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Supplier-item master</h2>
          <p className="inventory-intro">
            Record verified purchase packs explicitly. A supplier quote does not
            change stock, last purchase price or weighted average cost.
          </p>
          <ResponsiveTable label="Master records">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Vendor / item</th>
                  <th>Purchase pack</th>
                  <th>Base quantity</th>
                  <th>Quote (NGN/pack)</th>
                  <th>Status</th>
                  {access.canPurchase && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {mappings.data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.vendor_name}
                      <small>
                        {m.sku} · {m.item_name}
                      </small>
                    </td>
                    <td>{m.purchase_unit}</td>
                    <td>
                      {formatInventoryNumber(m.base_quantity)} {m.base_unit}
                    </td>
                    <td>
                      {m.quoted_price == null
                        ? "Not quoted"
                        : formatAmount(m.quoted_price)}
                    </td>
                    <td>{m.is_active ? "Active" : "Inactive"}</td>
                    {access.canPurchase && (
                      <td>
                        <Link
                          className="text-link"
                          href={`${base}/masters?view=vendor_items&edit=${m.id}`}
                        >
                          Edit mapping
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          {!mappings.data.length && (
            <p className="inventory-empty">
              Add a vendor, then link the items you buy from them.
            </p>
          )}
        </section>
        {access.canPurchase && (
          <section className="panel inventory-form-panel">
            <h2>{mapping ? "Edit supplier item" : "Link a supplier item"}</h2>
            <BusinessForm
              key={mapping?.id ?? "new"}
              organizationId={organizationId}
              intent="save_vendor_item"
              button="Save supplier item"
              help="Example: purchase unit ‘bag’, base quantity ‘50’ means one bag contains 50 of this item's displayed base units. Confirm the supplier specification."
              fields={[
                ...(mapping ? [hiddenField("id", mapping.id)] : []),
                select(
                  "vendor_id",
                  "Vendor",
                  vendors.data.map((v) => ({ value: v.id, label: v.name })),
                  mapping?.vendor_id ?? "",
                ),
                select(
                  "item_id",
                  "Inventory item",
                  items.data
                    .filter((i) => i.category !== "semi_finished")
                    .map((i) => ({
                      value: i.id,
                      label: `${i.sku} · ${i.name} (${i.stock_unit_label ?? i.base_uom_code})`,
                    })),
                  mapping?.item_id ?? "",
                ),
                {
                  ...input(
                    "vendor_sku",
                    "Supplier item code",
                    mapping?.vendor_sku ?? "",
                  ),
                  optional: true,
                },
                input(
                  "purchase_unit",
                  "Purchase unit / pack",
                  mapping?.purchase_unit ?? "",
                ),
                input(
                  "base_quantity",
                  "Base units per purchase unit",
                  mapping?.base_quantity ?? "",
                ),
                {
                  ...input(
                    "quoted_price",
                    "Quoted price per purchase unit (NGN)",
                    mapping?.quoted_price ?? "",
                  ),
                  optional: true,
                },
                input(
                  "conversion_note",
                  "Pack specification / evidence",
                  mapping?.conversion_note ?? "",
                ),
                { ...activeField, value: String(mapping?.is_active ?? true) },
              ]}
            />
          </section>
        )}
      </div>
    );
  } else if (view === "menu") {
    const [menus, recipes] = await Promise.all([
      readAll(db
        .from("menu_items")
        .select("*", {count:"exact"})
        .eq("organization_id", organizationId)
        .order("name")
        .order("id")),
      readAll(db
        .from("final_recipe_master")
        .select("id,name,code", {count:"exact"})
        .eq("organization_id", organizationId)
        .order("name")
        .order("id")),
    ]);
    if (menus.error || recipes.error)
      throw new Error("Could not load menu mapping.");
    const menu = menus.data.find((m) => m.id === edit);
    const canEdit =
      access.canStock ||
      ["kitchen_lead", "bar_lead"].includes(access.primaryRole);
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Menu item master</h2>
          <p className="inventory-intro">
            Map the codes in your sales file to final recipes. Once menu codes
            are configured, imports must use active mappings. Mapping changes do
            not rewrite posted sales; pending drafts must be validated again.
          </p>
          <ResponsiveTable label="Master records">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Menu item / POS code</th>
                  <th>Final recipe</th>
                  <th>Usual location</th>
                  <th>Status</th>
                  {canEdit && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {menus.data.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <small>{m.code}</small>
                    </td>
                    <td>
                      {recipes.data.find((r) => r.id === m.recipe_id)?.name}
                    </td>
                    <td className="capitalize">{m.default_area}</td>
                    <td>{m.is_active ? "Active" : "Inactive"}</td>
                    {canEdit && (
                      <td>
                        <Link
                          href={`${base}/masters?view=menu&edit=${m.id}`}
                          className="text-link"
                        >
                          Edit mapping
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </section>
        {canEdit && (
          <section className="panel inventory-form-panel">
            <h2>{menu ? "Edit menu mapping" : "Add menu mapping"}</h2>
            <BusinessForm
              key={menu?.id ?? "new"}
              organizationId={organizationId}
              intent="save_menu_item"
              button="Save menu mapping"
              fields={[
                ...(menu ? [hiddenField("id", menu.id)] : []),
                input("code", "POS / menu code", menu?.code),
                input("name", "Menu item name", menu?.name),
                select(
                  "revenue_class",
                  "Sales category",
                  [
                    { value: "food", label: "Food" },
                    { value: "beverage", label: "Beverage" },
                    { value: "other", label: "Other" },
                  ],
                  menu?.revenue_class ?? "food",
                ),
                select(
                  "recipe_id",
                  "Final recipe",
                  recipes.data
                    .filter((r) => r.id)
                    .map((r) => ({
                      value: r.id!,
                      label: `${r.code} · ${r.name}`,
                    })),
                  menu?.recipe_id,
                ),
                select(
                  "default_area",
                  "Usual preparation location",
                  [
                    { value: "kitchen", label: "Kitchen" },
                    { value: "bar", label: "Bar" },
                  ],
                  menu?.default_area,
                ),
                { ...activeField, value: String(menu?.is_active ?? true) },
              ]}
            />
          </section>
        )}
      </div>
    );
  } else if (view === "units") {
    const [units, conversions, items] = await Promise.all([
      db.from("units_of_measure").select("code,dimension").order("code"),
      readAll(db
        .from("item_conversion_history")
        .select("*", {count:"exact"})
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .order("id")),
      readAll(db
        .from("items")
        .select("id,name,sku,base_uom_code,stock_unit_label", {count:"exact"})
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name")
        .order("id")),
    ]);
    if (units.error || conversions.error || items.error)
      throw new Error("Could not load units.");
    content = (
      <div className="inventory-sections">
        <section className="panel">
          <h2>Units and conversion master</h2>
          <p className="inventory-intro">
            System units are fixed: {units.data.map((u) => u.code).join(", ")}.
            Bottle, pack, roll and portion labels retain their own counted-stock
            identity. No packaging or density factor is inferred from names.
          </p>
          <ResponsiveTable label="Master records">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Source</th>
                  <th>Factor to base unit</th>
                  <th>Revision</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {conversions.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {items.data.find((i) => i.id === c.item_id)?.name ??
                        c.item_id}
                    </td>
                    <td>{c.source_uom_code}</td>
                    <td>
                      {formatInventoryNumber(c.factor)} {c.target_uom_code}
                    </td>
                    <td>{c.revision}</td>
                    <td>{c.retired_at ? "Retired" : "Active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        </section>
        {["owner", "admin", "inventory_manager"].includes(
          access.primaryRole,
        ) && (
          <section className="panel inventory-form-panel">
            <h2>Add or supersede an item conversion</h2>
            <BusinessForm
              organizationId={organizationId}
              intent="supersede_conversion"
              button="Save conversion revision"
              help="Enter how many base units equal one source unit. Only supported cross-dimensional mappings are allowed; fixed kg/g or litre/ml conversions cannot be overridden."
              fields={[
                select(
                  "item_id",
                  "Item",
                  items.data.map((i) => ({
                    value: i.id,
                    label: `${i.sku} · ${i.name} (base: ${i.stock_unit_label ?? i.base_uom_code})`,
                  })),
                ),
                select(
                  "source_uom_code",
                  "Source unit",
                  units.data.map((u) => ({ value: u.code, label: u.code })),
                ),
                input("factor", "Base units per source unit"),
                input("supporting_note", "Supporting measurement / evidence"),
              ]}
            />
          </section>
        )}
      </div>
    );
  } else {
    const cards = [
      [
        "Items and categories",
        `${base}/inventory?view=items`,
        "The shared raw-material, semi-finished and general-supply catalogue.",
      ],
      [
        "Final recipe master",
        `${base}/inventory?view=final_recipes`,
        "Menu recipes, ingredient quantities and current recipe costs.",
      ],
      [
        "Sub-recipe master",
        `${base}/inventory?view=sub_recipes`,
        "Versioned batch standards linked to semi-finished output SKUs.",
      ],
      [
        "Menu item master",
        `${base}/masters?view=menu`,
        "Sales/POS codes mapped to final recipes.",
      ],
      [
        "Units and conversions",
        `${base}/masters?view=units`,
        "Fixed units, stock labels and measured item conversions.",
      ],
      ...(access.canReadVendors
        ? [
            [
              "Vendor master",
              `${base}/masters?view=vendors`,
              "Supplier identities, contacts and availability.",
            ],
            [
              "Supplier-item master",
              `${base}/masters?view=vendor_items`,
              "Supplier codes, verified pack sizes and quoted prices.",
            ],
          ]
        : []),
    ];
    content = (
      <div className="role-action-grid">
        {cards.map(([name, url, detail]) => (
          <Link className="panel role-action" href={url} key={url}>
            <h2>{name}</h2>
            <p>{detail}</p>
            <span>Open master →</span>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            CONSISTENT DEFINITIONS. DEPENDABLE OPERATIONS.
          </p>
          <h1>Master data</h1>
          <p>Maintain the records your team uses every day.</p>
        </div>
      </div>
      <nav className="inventory-tabs" aria-label="Master data sections">
        <Link href={`${base}/masters`} aria-current={view === "overview" ? "page" : undefined}>Overview</Link>
        {access.canReadVendors && (
          <>
            <Link href={`${base}/masters?view=vendors`} aria-current={view === "vendors" ? "page" : undefined}>Vendors</Link>
            <Link href={`${base}/masters?view=vendor_items`} aria-current={view === "vendor_items" ? "page" : undefined}>
              Supplier items
            </Link>
          </>
        )}
        <Link href={`${base}/inventory?view=final_recipes`}>Final recipes</Link>
        <Link href={`${base}/inventory?view=sub_recipes`}>Sub-recipes</Link>
        <Link href={`${base}/masters?view=menu`} aria-current={view === "menu" ? "page" : undefined}>Menu mapping</Link>
        <Link href={`${base}/masters?view=units`} aria-current={view === "units" ? "page" : undefined}>Units</Link>
      </nav>
      {saved && (
        <p className="notice notice-success location-notice" role="status">
          Master record saved.
        </p>
      )}
      {content}
    </>
  );
}
