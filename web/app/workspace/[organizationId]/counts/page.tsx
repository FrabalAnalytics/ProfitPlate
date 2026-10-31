import { formatInventoryNumber } from "@/lib/inventory-format";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
export const instant = false;
export const metadata = { title: "Stock counts" };
export default async function CountsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const access = await workspaceRole(organizationId);
  const db = await createSupabaseServerClient();
  const [counts, lines, items, locations] = await Promise.all([
    db
      .from("stock_counts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("stock_count_line_view")
      .select("*")
      .eq("organization_id", organizationId)
      .limit(25000),
    db
      .from("items")
      .select("id,sku,name,base_uom_code,stock_unit_label")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name")
      .limit(500),
    db
      .from("locations")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
  ]);
  if (counts.error || lines.error || items.error || locations.error)
    throw new Error("Could not load stock counts.");
  const canCount =
    access.canStock ||
    access.roles.some((r) => ["kitchen_lead", "bar_lead"].includes(r));
  const places = locations.data.filter(
    (l) => !access.departmentLocation || l.id === access.departmentLocation,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COUNT. EXPLAIN. RECONCILE.</p>
          <h1>Stock counts and adjustments</h1>
          <p>
            Physical counts preserve the book balance and an exact server
            cutoff. A different Operations Manager approves any adjustment.
          </p>
        </div>
      </div>
      <div className="inventory-sections">
        {canCount && (
          <section className="panel inventory-form-panel">
            <h2>Record a physical count</h2>
            <p className="notice">
              Pause movements for the counted items while counting and until
              approval. If stock moves after the captured cutoff, approval is
              blocked and a new count is required. This is an item count, not a
              declaration that the whole restaurant has been counted. Complete
              pending deliveries or confirm rejected returns before counting the
              affected source items.
            </p>
            <BusinessForm
              organizationId={organizationId}
              intent="create_count"
              fields={[
                {
                  name: "location_id",
                  label: "Count location",
                  value: access.departmentLocation,
                  options: places.map((l) => ({ value: l.id, label: l.name })),
                },
                reasonField,
              ]}
              items={items.data.map((i) => ({
                value: i.id,
                label: `${i.name} (${i.stock_unit_label ?? i.base_uom_code})`,
                keywords: i.sku,
              }))}
              quantityLabel="Physical quantity"
              button="Save count draft"
              help="Enter the measured quantity in stock units, including explicit zero. Missing inventory cost must be established through a controlled opening or receipt before positive adjustments can post."
            />
          </section>
        )}
        <section className="panel">
          <h2>Latest 50 counts</h2>
          <LiveInventoryRefresh />
          {!counts.data.length && <p>No count records yet.</p>}
          {counts.data.map((c) => (
            <article
              className="inventory-document"
              key={c.id}
              aria-label={`Count ${c.reason}`}
            >
              <div className="panel-heading">
                <h3>{c.reason}</h3>
                <span className="role-pill">{c.status}</span>
              </div>
              <p>
                {locations.data.find((l) => l.id === c.location_id)?.name} ·
                Cutoff:{" "}
                {new Date(c.cutoff_at).toLocaleString("en-GB", {
                  timeZone: "Africa/Lagos",
                })}{" "}
                (Lagos)
              </p>
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Book</th>
                      <th>Physical</th>
                      <th>Variance</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.data
                      .filter((l) => l.count_id === c.id)
                      .map((l) => (
                        <tr key={l.item_id}>
                          <td>{l.item_name}</td>
                          <td>{formatInventoryNumber(l.book)}</td>
                          <td>{formatInventoryNumber(l.physical)}</td>
                          <td>{formatInventoryNumber(l.variance)}</td>
                          <td>{l.unit}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {c.status === "draft" && c.created_by === access.userId && (
                <BusinessForm
                  organizationId={organizationId}
                  intent="submit_count"
                  fields={[hiddenField("id", c.id)]}
                  button="Submit count for approval"
                />
              )}
              {c.status === "submitted" && c.created_by === access.userId && (
                <p>
                  Waiting for a different Operations Manager. Self-approval is
                  blocked.
                </p>
              )}
              {c.status === "submitted" &&
                access.isManager &&
                c.created_by !== access.userId && (
                  <div className="inventory-approval">
                    <BusinessForm
                      organizationId={organizationId}
                      intent="approve_count"
                      fields={[hiddenField("id", c.id)]}
                      button="Approve count adjustment"
                    />
                    <details>
                      <summary>Reject count</summary>
                      <BusinessForm
                        organizationId={organizationId}
                        intent="reject_count"
                        fields={[hiddenField("id", c.id), reasonField]}
                        button="Reject count"
                      />
                    </details>
                  </div>
                )}
              {c.decision_reason && <p>{c.decision_reason}</p>}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
