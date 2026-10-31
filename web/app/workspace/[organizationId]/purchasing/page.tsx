import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
import type { OperationField } from "@/components/operation-form";
export const instant = false;
export const metadata = { title: "Purchasing" };
export default async function PurchasingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ vendor?: string; saved?: string; received?: string }>;
}) {
  const { organizationId } = await params;
  const access = await workspaceRole(organizationId);
  if (!access.canReadVendors) notFound();
  const { vendor: selectedVendor, saved, received } = await searchParams;
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}`;
  const pending = await db
    .from("pending_purchase_receipt_view")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("created_by", access.userId)
    .limit(100);
  if (pending.error)
    throw new Error("Could not load pending receiving records.");
  const [vendors, mappings, orders, lines, locations] = await Promise.all([
    db
      .from("vendors")
      .select("id,name,is_active")
      .eq("organization_id", organizationId)
      .order("name")
      .limit(500),
    db
      .from("vendor_item_master")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("item_name")
      .limit(1000),
    db
      .from("purchase_order_summary")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("purchase_order_line_view")
      .select("*")
      .eq("organization_id", organizationId)
      .limit(1000),
    db
      .from("locations")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name"),
  ]);
  if (
    vendors.error ||
    mappings.error ||
    orders.error ||
    lines.error ||
    locations.error
  )
    throw new Error("Could not load purchasing.");
  const vendor = vendors.data.find(
    (v) => v.id === selectedVendor && v.is_active,
  );
  const supplierItems = mappings.data.filter(
    (m) => m.vendor_id === vendor?.id && m.item_id,
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dateField: OperationField = {
    name: "event_date",
    label: "Receiving date",
    type: "date",
    value: today,
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FROM APPROVED ORDER TO VERIFIED DELIVERY</p>
          <h1>Purchasing</h1>
          <p>
            Prepare orders, follow deliveries and keep receiving independent.
          </p>
        </div>
      </div>
      {saved && (
        <p className="notice notice-success location-notice" role="status">
          {received
            ? "Delivery accepted. Stock updated."
            : "Purchasing record saved."}
        </p>
      )}
      <div className="inventory-actions">
        <Link
          className="button button-secondary"
          href={`${base}/masters?view=vendors`}
        >
          Vendor master
        </Link>
        <Link
          className="button button-secondary"
          href={`${base}/masters?view=vendor_items`}
        >
          Supplier items and packs
        </Link>
      </div>
      <div className="inventory-sections">
        {pending.data.length > 0 && (
          <section className="panel">
            <h2>Previously saved deliveries</h2>
            <p>
              These records were saved before immediate receiving was enabled.
              Review the existing record rather than entering the same delivery
              again.
            </p>
            {pending.data.map((r) => (
              <article className="inventory-document" key={r.document_id}>
                <h3>
                  {r.reason} · PO-{r.order_number}
                </h3>
                <p>
                  {r.vendor_name} · {r.status}
                </p>
                <Link
                  className="text-link"
                  href={`${base}/inventory?view=documents&document=${r.document_id}`}
                >
                  Review recorded delivery
                </Link>
              </article>
            ))}
          </section>
        )}
        {access.canPurchase && (
          <section className="panel inventory-form-panel">
            <h2>New purchase order</h2>
            <p className="field-help">
              You are creating this order with your assigned Procurement duty.
              An independent Operations Manager reviews and approves it.
            </p>
            <p className="inventory-intro">
              Choose a vendor, then enter quantities and negotiated prices in
              that supplier’s purchase units. No stock changes until a separate
              receiver records an approved delivery.
            </p>
            <div className="inventory-actions">
              {vendors.data
                .filter((v) => v.is_active)
                .map((v) => (
                  <Link
                    className="button button-secondary"
                    key={v.id}
                    href={`${base}/purchasing?vendor=${v.id}`}
                  >
                    {v.name}
                  </Link>
                ))}
            </div>
            {vendor &&
              (supplierItems.length ? (
                <>
                  <h3>{vendor.name}</h3>
                  <div className="inventory-table-wrap">
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Purchase unit</th>
                          <th>Base units</th>
                          <th>Last quote (NGN)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierItems.map((m) => (
                          <tr key={m.id}>
                            <td>{m.item_name}</td>
                            <td>{m.purchase_unit}</td>
                            <td>
                              {formatInventoryNumber(m.base_quantity)}{" "}
                              {m.base_unit}
                            </td>
                            <td>
                              {m.quoted_price == null
                                ? "Not quoted"
                                : formatAmount(m.quoted_price)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <BusinessForm
                    key={vendor.id}
                    organizationId={organizationId}
                    intent="create_purchase_order"
                    fields={[
                      hiddenField("vendor_id", vendor.id),
                      reasonField,
                      {
                        name: "expected_date",
                        label: "Expected delivery date",
                        type: "date",
                        optional: true,
                      },
                    ]}
                    items={supplierItems.map((m) => ({
                      value: m.item_id!,
                      label: `${m.item_name} · ${m.purchase_unit} (${formatInventoryNumber(m.base_quantity)} ${m.base_unit})`,
                      keywords: m.sku ?? "",
                    }))}
                    costs
                    quantityLabel="Purchase quantity"
                    costLabel="Price per purchase unit"
                    button="Save purchase order draft"
                  />
                </>
              ) : (
                <p className="inventory-empty">
                  Link supplier items and verified pack sizes before ordering
                  from this vendor.
                </p>
              ))}
            {!vendors.data.length && <p>Add a vendor to start.</p>}
          </section>
        )}
        <section className="panel">
          <h2>Latest 50 purchase orders</h2>
          {!selectedVendor && <LiveInventoryRefresh />}
          {orders.data.length === 0 && (
            <p className="inventory-empty">No orders yet.</p>
          )}
          {orders.data.map((order) => {
            const orderLines = lines.data.filter(
              (l) => l.order_id === order.id,
            );
            const outstanding = orderLines.filter(
              (l) => Number(l.outstanding_quantity) > 0,
            );
            const reference = `PO-${order.number}`;
            return (
              <article
                className="inventory-document"
                key={order.id}
                aria-label={`${reference} ${order.vendor_name}`}
              >
                <div className="panel-heading">
                  <h3>
                    {reference} · {order.vendor_name}
                  </h3>
                  <span className="role-pill">
                    {order.status === "approved" &&
                    order.outstanding_lines === 0
                      ? "Fulfilled"
                      : order.status}
                  </span>
                </div>
                <p>{order.reason}</p>
                <p className="field-help">
                  Order value: NGN {formatAmount(order.total_value ?? "0")} ·
                  Expected: {order.expected_date ?? "Not specified"}
                </p>
                <div className="inventory-table-wrap">
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Ordered</th>
                        <th>Price / purchase unit</th>
                        <th>Received</th>
                        <th>Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderLines.map((l) => (
                        <tr key={l.id}>
                          <td>
                            {l.item_name}
                            <small>
                              {formatInventoryNumber(l.base_quantity)}{" "}
                              {l.base_unit} per {l.purchase_unit}
                            </small>
                          </td>
                          <td>
                            {formatInventoryNumber(l.quantity)}{" "}
                            {l.purchase_unit}
                          </td>
                          <td>{formatAmount(l.unit_price)}</td>
                          <td>{formatInventoryNumber(l.received_quantity)}</td>
                          <td>
                            {formatInventoryNumber(l.outstanding_quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {order.status === "draft" &&
                  order.created_by === access.userId && (
                    <BusinessForm
                      organizationId={organizationId}
                      intent="submit_purchase_order"
                      fields={[hiddenField("id", order.id!)]}
                      button="Submit order for approval"
                    />
                  )}
                {order.status === "submitted" &&
                  order.created_by === access.userId && (
                    <p className="field-help">
                      Waiting for a different manager. Self-approval is blocked.
                    </p>
                  )}
                {order.status === "submitted" &&
                  access.isManager &&
                  order.created_by !== access.userId && (
                    <div className="inventory-approval">
                      <BusinessForm
                        organizationId={organizationId}
                        intent="approve_purchase_order"
                        fields={[hiddenField("id", order.id!)]}
                        button="Approve purchase order"
                      />
                      <details>
                        <summary>Reject order</summary>
                        <BusinessForm
                          organizationId={organizationId}
                          intent="reject_purchase_order"
                          fields={[hiddenField("id", order.id!), reasonField]}
                          button="Reject purchase order"
                        />
                      </details>
                    </div>
                  )}
                {order.status === "approved" &&
                  outstanding.length > 0 &&
                  access.canStock &&
                  order.created_by !== access.userId && (
                    <details className="inventory-details">
                      <summary>Record accepted delivery</summary>
                      <BusinessForm
                        organizationId={organizationId}
                        intent="create_purchase_receipt"
                        fields={[
                          hiddenField("id", order.id!),
                          dateField,
                          {
                            name: "location_id",
                            label: "Receiving location",
                            options: locations.data.map((l) => ({
                              value: l.id,
                              label: l.name,
                            })),
                          },
                          reasonField,
                        ]}
                        items={outstanding.map((l) => ({
                          value: l.item_id!,
                          label: `${l.item_name} (${l.purchase_unit})`,
                          keywords: l.sku ?? "",
                        }))}
                        quantityLabel="Accepted purchase quantity"
                        rejectedQuantities
                        button="Accept delivery and update stock"
                        help="Confirm the actual accepted quantities in purchase units. Acceptance posts stock immediately against the approved order, using its frozen pack sizes and prices. Rejected quantities stay out of stock; outstanding deliveries remain visible."
                      />
                    </details>
                  )}
                {["draft", "submitted", "approved"].includes(
                  order.status ?? "",
                ) &&
                  ((order.created_by === access.userId &&
                    order.status !== "approved") ||
                    access.isManager) && (
                    <details className="inventory-details">
                      <summary>Cancel outstanding order</summary>
                      <BusinessForm
                        organizationId={organizationId}
                        intent="cancel_purchase_order"
                        fields={[hiddenField("id", order.id!), reasonField]}
                        button="Cancel order"
                        help="Retains all posted receipts; pending receiving drafts cannot post after cancellation."
                      />
                    </details>
                  )}
              </article>
            );
          })}
        </section>
      </div>
    </>
  );
}
