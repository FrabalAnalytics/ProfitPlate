import { ResponsiveTable } from "@/components/responsive-table";
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
import { readAll } from "@/lib/read-all";
import { ListControls } from "@/components/list-controls";
import { listState, likeSearch, recordHref, type ListQuery } from "@/lib/list-query";
import { isUuid } from "@/lib/auth/validation";
import { notFound } from "next/navigation";
export const instant = false;
export const metadata = { title: "Stock requests" };
export default async function RequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<ListQuery & { completed?: string }>;
}) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { completed, record } = query;
  const list = listState(query);
  if (record && !isUuid(record)) notFound();
  const access = await workspaceRole(organizationId);
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}`;
  let requestQuery = db.from("stock_requisitions").select("*", { count: "exact" }).eq("organization_id", organizationId).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (record) requestQuery = requestQuery.eq("id", record);
  else {
    if (list.status) requestQuery = requestQuery.eq("status", list.status);
    if (list.q) requestQuery = /^(?:REQ-)?\d+$/i.test(list.q) ? requestQuery.eq("number", Number(list.q.replace(/^REQ-/i, ""))) : requestQuery.ilike("reason", likeSearch(list.q));
  }
  const [requests, items, locations, deliveries] = await Promise.all([
    requestQuery.range(record ? 0 : list.from, record ? 0 : list.to),
    readAll(db
      .from("items")
      .select("id,sku,name,base_uom_code,stock_unit_label", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name")
      .order("id")),
    db
      .from("locations")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    readAll(db
      .from("transfer_delivery_view")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("document_id").order("item_id")),
  ]);
  if (
    requests.error ||
    items.error ||
    locations.error ||
    deliveries.error
  )
    throw new Error("Could not load stock requests.");
  if (record && !requests.data.length) notFound();
  const lines = record && requests.data.length ? await readAll(db.from("requisition_fulfilment_view").select("*", { count: "exact" }).eq("organization_id", organizationId).eq("requisition_id", record).order("id")) : { data: [], error: null };
  if (lines.error || (record && requests.data.some(r => !lines.data.some(l => l.requisition_id === r.id)))) throw new Error("Complete request details could not be loaded.");
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
        {canRequest && !record && (
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
          <h2>{record ? "Request details" : "Stock requests"}</h2>
          {record ? <Link className="text-link" href={recordHref(`${base}/requests`,query)}>Back to stock requests</Link> : <ListControls query={query} total={requests.count ?? 0} statuses={["draft", "submitted", "approved", "rejected", "closed"]} label="stock requests" />}
          <LiveInventoryRefresh />
          {!requests.data.length && (
            <p className="inventory-empty">No stock requests yet.</p>
          )}
          {!record && <ResponsiveTable label="Stock requests" localControls={false}><table className="inventory-table"><thead><tr><th>Reference</th><th>Requesting location</th><th>Created</th><th>Status</th><th>Action</th></tr></thead><tbody>{requests.data.map(r=><tr key={r.id}><td>REQ-{r.number}<small>{r.reason}</small></td><td>{locations.data.find(l=>l.id===r.destination_location_id)?.name??"Inactive location"}</td><td>{new Date(r.created_at).toLocaleDateString("en-GB",{timeZone:"Africa/Lagos"})}</td><td>{r.status}</td><td><Link className="text-link" href={recordHref(`${base}/requests`,query,r.id)}>Open REQ-{r.number}</Link></td></tr>)}</tbody></table></ResponsiveTable>}
          {(record ? requests.data : []).map((r) => {
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
                {!record && <Link className="text-link" href={`${base}/requests?record=${r.id}`}>Open REQ-{r.number}</Link>}
                <ResponsiveTable label="Request lines">
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
                </ResponsiveTable>
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
                  {d.source_name} → {d.destination_name}
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
