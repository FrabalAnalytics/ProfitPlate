import { operationNotice } from "@/lib/operation-notice";
import { TransferDelivery } from "@/components/transfer-delivery";
import { formatInventoryNumber } from "@/lib/inventory-format";
import Link from "next/link";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
export const instant = false;
export const metadata = { title: "Stock requests" };
export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ completed?: string }>;
}) {
  const { organizationId } = await params;
  const { completed } = await searchParams;
  const access = await workspaceRole(organizationId);
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}`;
  const [requests, lines, items, locations, deliveries] = await Promise.all([
    db
      .from("stock_requisitions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("requisition_fulfilment_view")
      .select("*")
      .eq("organization_id", organizationId)
      .limit(1000),
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
    db
      .from("transfer_delivery_view")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (
    requests.error ||
    lines.error ||
    items.error ||
    locations.error ||
    deliveries.error
  )
    throw new Error("Could not load stock requests.");
  const canRequest =
    access.canStock ||
    ["kitchen_lead", "bar_lead"].includes(access.primaryRole);
  const destinations = access.areas.filter(
    (a) =>
      ["kitchen", "bar"].includes(a.area) &&
      (!access.departmentLocation ||
        a.location_id === access.departmentLocation),
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ASK. APPROVE. DISPATCH. ACKNOWLEDGE.</p>
          <h1>Stock requests</h1>
          <p>
            Request stock from Main Store and track every outstanding quantity.
          </p>
        </div>
      </div>
      {completed && operationNotice[completed] && (
        <p className="notice notice-success" role="status">
          {operationNotice[completed]}
        </p>
      )}
      <div className="inventory-sections">
        {canRequest && (
          <section className="panel inventory-form-panel">
            <h2>Request stock</h2>
            {destinations.length ? (
              <BusinessForm
                organizationId={organizationId}
                intent="create_requisition"
                fields={[
                  {
                    name: "destination_location_id",
                    label: "Requesting location",
                    value:
                      access.departmentLocation ??
                      (destinations.length === 1
                        ? destinations[0].location_id
                        : ""),
                    options: destinations.map((a) => ({
                      value: a.location_id,
                      label:
                        locations.data.find((l) => l.id === a.location_id)
                          ?.name ?? a.area,
                    })),
                  },
                  reasonField,
                ]}
                items={items.data.map((i) => ({
                  value: i.id,
                  label: `${i.name} (${i.stock_unit_label ?? i.base_uom_code})`,
                  keywords: i.sku,
                }))}
                button="Save request draft"
                help="Quantities are in each item's stock unit. A request or approval does not reserve or move stock."
              />
            ) : (
              <p className="inventory-intro">
                An administrator must configure the operating areas first.
              </p>
            )}
          </section>
        )}
        <section className="panel">
          <h2>Latest 50 requests</h2>
          <LiveInventoryRefresh />
          {!requests.data.length && (
            <p className="inventory-empty">No stock requests yet.</p>
          )}
          {requests.data.map((r) => {
            const requested = lines.data.filter(
              (l) => l.requisition_id === r.id,
            );
            const available = requested.filter(
              (l) => Number(l.suggested_quantity) > 0,
            );
            return (
              <article
                className="inventory-document"
                key={r.id}
                aria-label={`Request ${r.number} ${r.reason}`}
              >
                <div className="panel-heading">
                  <h3>
                    REQ-{r.number} ·{" "}
                    {
                      locations.data.find(
                        (l) => l.id === r.destination_location_id,
                      )?.name
                    }
                  </h3>
                  <span className="role-pill">{r.status}</span>
                </div>
                <p>{r.reason}</p>
                <div className="inventory-table-wrap">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Requested</th>
                        <th>Dispatched</th>
                        <th>Awaiting dispatch</th>
                        {access.canStock && <th>Main Store available</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {requested.map((l) => (
                        <tr key={l.id}>
                          <td>{l.item_name}</td>
                          <td>
                            {formatInventoryNumber(l.quantity)} {l.unit}
                          </td>
                          <td>
                            {formatInventoryNumber(l.dispatched_quantity)}
                          </td>
                          <td>
                            {formatInventoryNumber(l.outstanding_quantity)}
                          </td>
                          {access.canStock && (
                            <td>
                              {formatInventoryNumber(
                                l.available_source_quantity,
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.status === "draft" && r.created_by === access.userId && (
                  <BusinessForm
                    organizationId={organizationId}
                    intent="submit_requisition"
                    fields={[hiddenField("id", r.id)]}
                    button="Submit request"
                  />
                )}
                {r.status === "submitted" && r.created_by === access.userId && (
                  <p className="field-help">
                    Waiting for a different manager. Self-approval is blocked.
                  </p>
                )}
                {r.status === "submitted" &&
                  access.isManager &&
                  r.created_by !== access.userId && (
                    <div className="inventory-approval">
                      <BusinessForm
                        organizationId={organizationId}
                        intent="approve_requisition"
                        fields={[hiddenField("id", r.id)]}
                        button="Approve request"
                      />
                      <details>
                        <summary>Reject request</summary>
                        <BusinessForm
                          organizationId={organizationId}
                          intent="reject_requisition"
                          fields={[hiddenField("id", r.id), reasonField]}
                          button="Reject request"
                        />
                      </details>
                    </div>
                  )}
                {r.status === "approved" &&
                  access.canStock &&
                  r.approved_by !== access.userId &&
                  (available.length ? (
                    <details className="inventory-details">
                      <summary>Dispatch approved stock</summary>
                      <BusinessForm
                        organizationId={organizationId}
                        intent="fulfil_requisition"
                        fields={[
                          hiddenField("id", r.id),
                          {
                            name: "event_date",
                            label: "Dispatch date",
                            type: "date",
                            value: today,
                          },
                          reasonField,
                        ]}
                        items={available.map((l) => ({
                          value: l.item_id!,
                          label: `${l.item_name} (${l.unit})`,
                          keywords: l.sku ?? "",
                        }))}
                        initialLines={available.map((l) => ({
                          item_id: l.item_id!,
                          quantity: l.suggested_quantity!,
                        }))}
                        button="Dispatch entered quantities"
                        help="Prefilled amounts are limited to current available stock and outstanding demand. Review actual quantities. The original manager approval authorizes this dispatch; it reserves stock in Main Store until the receiving department accepts it."
                      />
                    </details>
                  ) : (
                    <p className="field-help">
                      No approved items currently available to dispatch. Receive
                      stock first; quantities are checked again at dispatch.
                    </p>
                  ))}
                {["draft", "submitted", "approved"].includes(r.status) &&
                  (r.created_by === access.userId || access.isManager) && (
                    <details className="inventory-details">
                      <summary>Close remaining demand</summary>
                      <BusinessForm
                        organizationId={organizationId}
                        intent="close_requisition"
                        fields={[hiddenField("id", r.id), reasonField]}
                        button="Close request"
                        help="Cancels the remaining demand. Dispatched quantities remain pending until accepted or rejected and returned."
                      />
                    </details>
                  )}
                {r.status === "approved" && (
                  <p className="field-help">
                    Recipients can accept or reject items below or in{" "}
                    <Link
                      className="text-link"
                      href={`${base}/inventory?view=documents`}
                    >
                      Documents & approvals
                    </Link>
                    .
                  </p>
                )}
              </article>
            );
          })}
        </section>
        <section className="panel">
          <h2>Deliveries and acceptance</h2>
          <p>
            Accept only what arrived in usable condition. Leave undelivered
            quantities pending, or reject them with a reason.
          </p>
          {!deliveries.data.length && (
            <p className="inventory-empty">No dispatched deliveries yet.</p>
          )}
          {[...new Set(deliveries.data.map((d) => d.document_id))]
            .slice(0, 50)
            .map((id) => {
              const rows = deliveries.data.filter((d) => d.document_id === id);
              const d = rows[0];
              return (
                <article
                  className="inventory-document"
                  key={id}
                  aria-label={`Delivery ${d.reason}`}
                >
                  <div className="panel-heading">
                    <h3>
                      {d.source_name} ? {d.destination_name}
                    </h3>
                    <span className="role-pill">{d.status}</span>
                  </div>
                  <p>{d.reason}</p>
                  <TransferDelivery
                    organizationId={organizationId}
                    lines={rows}
                    userId={access.userId}
                    canReceive={
                      access.canStock ||
                      access.departmentLocation === d.destination_location_id
                    }
                    returnTo="requests"
                    canReturn={access.canStock}
                  />
                </article>
              );
            })}
        </section>
      </div>
    </>
  );
}
