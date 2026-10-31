import { ResponsiveTable } from "@/components/responsive-table";
import { SalesBatchList } from "@/components/sales-batch-list";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import { notFound } from "next/navigation";
import Link from "next/link";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
import type { OperationIntent } from "../inventory/actions";
import { money } from "@/lib/reporting";
import { readAll } from "@/lib/read-all";
import { ListControls } from "@/components/list-controls";
import { listState, likeSearch, type ListQuery } from "@/lib/list-query";
export const instant = false;
export const metadata = { title: "Approvals" };
export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<ListQuery>;
}) {
  const { organizationId } = await params;
  const access = await workspaceRole(organizationId);
  if (!access.isManager) notFound();
  const db = await createSupabaseServerClient();
  const query = await searchParams;
  const list = listState(query);
  const [counts, reconciliations] = await Promise.all([
    db
      .from("stock_counts")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("status", "submitted")
      .ilike("reason", likeSearch(list.q)).order("created_at").order("id").range(list.from, list.to),
    db
      .from("report_reconciliations")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("status", "submitted")
      .ilike("reason", likeSearch(list.q)).order("created_at").order("id").range(list.from, list.to),
  ]);
  if (counts.error || reconciliations.error)
    throw new Error("Could not load count and reconciliation approvals.");
  const [stock, orders, requests, people] =
    await Promise.all([
      db
        .from("inventory_documents")
        .select(
          "id,kind,reason,event_date,created_by,planned_output,actual_output", { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .eq("status", "submitted")
        .order("created_at")
        .ilike("reason", likeSearch(list.q)).order("id").range(list.from, list.to),
      db
        .from("purchase_order_summary")
        .select("*", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("status", "submitted")
        .order("created_at")
        .ilike("reason", likeSearch(list.q)).order("id").range(list.from, list.to),
      db
        .from("stock_requisitions")
        .select("*", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("status", "submitted")
        .order("created_at")
        .ilike("reason", likeSearch(list.q)).order("id").range(list.from, list.to),
      db.rpc("operating_people", { p_organization_id: organizationId }),
    ]);
  if (
    stock.error ||
    orders.error ||
    requests.error ||
    people.error
  )
    throw new Error("Could not load approvals.");
  const [countLines, orderLines, requestLines] = await Promise.all([
    counts.data.length ? readAll(db.from("stock_count_line_view").select("*", { count: "exact" }).eq("organization_id", organizationId).in("count_id", counts.data.map(c => c.id)).order("count_id").order("item_id")) : {data: [], error: null},
    orders.data.length ? readAll(db.from("purchase_order_line_view").select("*", { count: "exact" }).eq("organization_id", organizationId).in("order_id", orders.data.map(o => o.id)).order("id")) : {data: [], error: null},
    requests.data.length ? readAll(db.from("stock_requisition_line_view").select("*", { count: "exact" }).eq("organization_id", organizationId).in("requisition_id", requests.data.map(r => r.id)).order("id")) : {data: [], error: null},
  ]);
  if (countLines.error || orderLines.error || requestLines.error || counts.data.some(c => !countLines.data.some(l => l.count_id === c.id)) || requests.data.some(r => !requestLines.data.some(l => l.requisition_id === r.id)) || orders.data.some(o => orderLines.data.filter(l => l.order_id === o.id).length !== o.line_count))
    throw new Error("Complete approval evidence could not be loaded. Refresh before approving.");
  const linked = stock.data.length
    ? await db
        .from("purchase_receipts")
        .select("document_id")
        .eq("organization_id", organizationId)
        .in(
          "document_id",
          stock.data.map((d) => d.id),
        )
    : { data: [], error: null };
  if (linked.error) throw new Error("Could not load receiving references.");
  const purchaseReceiptIds = new Set(linked.data.map((r) => r.document_id));
  const stockRows = stock.data.filter((d) => !purchaseReceiptIds.has(d.id));
  const previews = await Promise.all(
    stockRows.map((d) =>
      db.rpc("inventory_document_preview", {
        p_organization_id: organizationId,
        p_document_id: d.id,
      }),
    ),
  );
  if (previews.some((p) => p.error))
    throw new Error("Could not load approval details.");
  const buttons = (
    id: string,
    creator: string,
    approve: OperationIntent,
    reject: OperationIntent,
    sales = false,
  ) =>
    creator === access.userId ? (
      <p className="field-help">
        You created this submission. Another manager must approve it.
      </p>
    ) : (
      <div className="inventory-approval">
        <BusinessForm
          organizationId={organizationId}
          intent={approve}
          fields={[hiddenField("id", id)]}
          button={
            sales
              ? "Approve sales and post"
              : approve === "approve_document"
                ? "Approve and post"
                : "Approve"
          }
        />
        <details>
          <summary>Reject</summary>
          <BusinessForm
            organizationId={organizationId}
            intent={reject}
            fields={[hiddenField("id", id), reasonField]}
            button="Reject submission"
          />
        </details>
      </div>
    );
  const person = (id: string) =>
    people.data.find((p) => p.user_id === id)?.display_name ??
    "Former team member";
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">REVIEW THE EVIDENCE. KEEP SERVICE MOVING.</p>
          <h1>Approvals</h1>
          <p>Operations Managers review submissions independently. Self-approval is blocked.</p>
        </div>
      </div>
      <LiveInventoryRefresh />
      <ListControls query={query} total={Math.max(counts.count ?? 0, reconciliations.count ?? 0, stock.count ?? 0, orders.count ?? 0, requests.count ?? 0)} label="submissions per group" />
      <div className="inventory-actions">
        <Link
          className="button button-secondary"
          href={`/workspace/${organizationId}/counts`}
        >
          Review count adjustments
        </Link>
        <Link
          className="button button-secondary"
          href={`/workspace/${organizationId}/reports`}
        >
          Review Finance reconciliations
        </Link>
      </div>
      <div className="location-stats">
        <div>
          <span>Stock documents</span>
          <strong>{stockRows.length}</strong>
        </div>
        <div>
          <span>Purchase orders</span>
          <strong>{orders.data.length}</strong>
        </div>
        <div>
          <span>Stock requests</span>
          <strong>{requests.data.length}</strong>
        </div>
      </div>
      <div className="inventory-sections">
        <section className="panel">
          <h2>Count adjustments</h2>
          {!counts.data.length && <p>No counts awaiting approval.</p>}
          {counts.data.map((c) => (
            <details className="approval-card" key={c.id}>
              <summary>
                {c.reason} · {person(c.created_by)}
              </summary>
              <p>
                Cutoff: {c.cutoff_at}. Stock movements after this instant block
                the adjustment and require a new count.
              </p>
              <ResponsiveTable label="Approval evidence">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Book</th>
                      <th>Physical</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countLines.data
                      .filter((l) => l.count_id === c.id)
                      .map((l) => (
                        <tr key={l.item_id}>
                          <td>{l.item_name}</td>
                          <td>
                            {formatInventoryNumber(l.book)} {l.unit}
                          </td>
                          <td>
                            {formatInventoryNumber(l.physical)} {l.unit}
                          </td>
                          <td>
                            {formatInventoryNumber(l.variance)} {l.unit}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </ResponsiveTable>
              {buttons(c.id, c.created_by, "approve_count", "reject_count")}
            </details>
          ))}
        </section>
        <section className="panel">
          <h2>Finance reconciliations</h2>
          {!reconciliations.data.length && (
            <p>No reconciliations awaiting approval.</p>
          )}
          {reconciliations.data.map((r) => (
            <details className="approval-card" key={r.id}>
              <summary>
                {r.starts_on} to {r.ends_on} · {person(r.created_by)}
              </summary>
              <p>
                {r.expected_sales_lines} POS lines · Net sales{" "}
                {money(r.net_sales)} · Actual COGS {money(r.actual_cogs)} ·
                Actual food cost {money(r.actual_food_cost)}
              </p>
              <p>
                {r.evidence_reference} · {r.reason}
              </p>
              <p>
                Approval confirms the supporting accounting evidence. Source
                changes since preparation require a fresh reconciliation.
              </p>
              {buttons(
                r.id,
                r.created_by,
                "approve_reconciliation",
                "reject_reconciliation",
              )}
            </details>
          ))}
        </section>
        <SalesBatchList
          organizationId={organizationId}
          pendingOnly
          batches={stockRows
            .map((d, index) => ({
              ...d,
              status: "submitted",
              preview: previews[index].data,
            }))
            .filter((d) => d.kind === "sales")}
        />
        <section className="panel">
          <h2>Stock, production and waste</h2>
          {!stockRows.some((d) => d.kind !== "sales") && (
            <p className="inventory-empty">
              No stock documents awaiting approval.
            </p>
          )}
          {stockRows.map((d, index) => {
            if (d.kind === "sales") return null;
            const p = previews[index].data;
            const lines =
              p &&
              typeof p === "object" &&
              !Array.isArray(p) &&
              Array.isArray(p.lines)
                ? p.lines
                : [];
            return (
              <details className="approval-card" key={d.id}>
                <summary>
                  <strong className="capitalize">{d.kind}</strong> · {d.reason}
                  <small>
                    {d.event_date} · {person(d.created_by)}
                  </small>
                </summary>
                <ResponsiveTable label="Approval evidence">
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
                      {lines.map((line, index) =>
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
                              {line.unit_cost == null
                                ? "Missing"
                                : formatAmount(String(line.unit_cost))}
                            </td>
                          </tr>
                        ) : null,
                      )}
                    </tbody>
                  </table>
                </ResponsiveTable>
                {d.kind === "production" && (
                  <p>
                    Planned output: {formatInventoryNumber(d.planned_output)} ·
                    Actual output: {formatInventoryNumber(d.actual_output)}
                  </p>
                )}
                {d.kind !== "sales" && (
                  <p className="field-help">
                    Posting rechecks the period, current cost and available
                    stock.
                  </p>
                )}
                {buttons(
                  d.id,
                  d.created_by,
                  "approve_document",
                  "reject_document",
                  d.kind === "sales",
                )}
              </details>
            );
          })}
        </section>
        <section className="panel">
          <h2>Purchase orders</h2>
          {!orders.data.length && (
            <p className="inventory-empty">
              No purchase orders awaiting approval.
            </p>
          )}
          {orders.data.map((p) => (
            <details className="approval-card" key={p.id}>
              <summary>
                <strong>
                  PO-{p.number} · {p.vendor_name}
                </strong>
                <small>
                  NGN {formatAmount(p.total_value)} · {person(p.created_by!)}
                </small>
              </summary>
              <p>{p.reason}</p>
              <ResponsiveTable label="Approval evidence">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Price (NGN)</th>
                      <th>Line value (NGN)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderLines.data
                      .filter((l) => l.order_id === p.id)
                      .map((l) => (
                        <tr key={l.id}>
                          <td>{l.item_name}</td>
                          <td>
                            {formatInventoryNumber(l.quantity)}{" "}
                            {l.purchase_unit}
                          </td>
                          <td>{formatAmount(l.unit_price)}</td>
                          <td>{formatAmount(l.line_value)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </ResponsiveTable>
              {buttons(
                p.id!,
                p.created_by!,
                "approve_purchase_order",
                "reject_purchase_order",
              )}
            </details>
          ))}
        </section>
        <section className="panel">
          <h2>Stock requests</h2>
          {!requests.data.length && (
            <p className="inventory-empty">No requests awaiting approval.</p>
          )}
          {requests.data.map((r) => (
            <details className="approval-card" key={r.id}>
              <summary>
                <strong>
                  REQ-{r.number} · {r.reason}
                </strong>
                <small>{person(r.created_by)}</small>
              </summary>
              <ResponsiveTable label="Approval evidence">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestLines.data
                      .filter((l) => l.requisition_id === r.id)
                      .map((l) => (
                        <tr key={l.id}>
                          <td>{l.item_name}</td>
                          <td>
                            {formatInventoryNumber(l.quantity)} {l.unit}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </ResponsiveTable>
              {buttons(
                r.id,
                r.created_by,
                "approve_requisition",
                "reject_requisition",
              )}
            </details>
          ))}
        </section>
      </div>
    </>
  );
}
