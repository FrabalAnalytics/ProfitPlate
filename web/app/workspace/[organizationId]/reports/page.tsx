import { ResponsiveTable } from "@/components/responsive-table";
import { ReportFilters } from "@/components/report-filters";
import { ListControls } from "@/components/list-controls";
import { listState } from "@/lib/list-query";
import styles from "@/components/report-layout.module.css";
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
import {
  readReport,
  money,
  reportPeriod,
  previousReportPeriod,
} from "@/lib/reporting";
export const instant = false;
export const metadata = { title: "Reports" };
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    start?: string;
    end?: string;
    cadence?: string;
    location?: string;
    snapshot?: string;
    saved?: string;
    section?: string;
    page?: string;
    q?: string;
    status?: string;
  }>;
}) {
  const { organizationId } = await params;
  const access = await workspaceRole(organizationId);
  if (!access.canReports) notFound();
  const query = await searchParams;
  const sections = [
    ...[
      ["overview", "Overview"],
      ["inventory", "Inventory details"],
    ],
    ...(access.canFinance ? [["finance", "Finance review"]] : []),
    ["actions", "Actions"],
    ...(access.canFinance ? [["published", "Saved reports"]] : []),
  ];
  const activeSection = query.section ?? "overview";
  if (!sections.some(([key]) => key === activeSection)) notFound();
  const sectionLink = (section: string) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (typeof value === "string" && !["saved", "section", "page", "q", "status"].includes(key))
        search.set(key, value);
    search.set("section", section);
    return `/workspace/${organizationId}/reports?${search}`;
  };
  const list = listState(query);
  const db = await createSupabaseServerClient();
  const base = `/workspace/${organizationId}`;
  const locations = await db
    .from("locations")
    .select("id,name")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  if (locations.error) throw new Error("Could not load report locations.");
  const allowedLocations = locations.data.filter(
    (l) => !access.departmentLocation || l.id === access.departmentLocation,
  );
  if (query.location && !allowedLocations.some((l) => l.id === query.location))
    notFound();
  let period;
  try { period = reportPeriod(query.start, query.end, query.cadence); }
  catch (error) {
    return <div className={styles.report}><div className="page-heading"><h1>Reports</h1></div><ReportFilters key={JSON.stringify(query)} section={activeSection} start={query.start ?? reportPeriod(undefined, undefined, undefined).start} end={query.end} cadence={query.cadence} location={query.location} locations={allowedLocations} wholeBusiness={!access.departmentLocation} error={error instanceof Error ? error.message : "Choose a valid date range."} /></div>;
  }
  let report;
  let selected:
    | { id: string; revision: number; reason: string; created_at: string }
    | undefined;
  if (query.snapshot) {
    const result = await db
      .from("report_snapshots")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", query.snapshot)
      .maybeSingle();
    if (result.error || !result.data) notFound();
    selected = result.data;
    report = readReport(result.data.report);
  } else {
    const result = await db.rpc("operating_report", {
      p_organization_id: organizationId,
      p_starts_on: period.start,
      p_ends_on: period.end,
      ...(query.location ? { p_location_id: query.location } : {}),
    });
    if (result.error)
      throw new Error(
        "Could not generate this report. Select a valid period of at most 367 days.",
      );
    report = readReport(result.data);
  }
  const [snapshots, reconciliations] = access.canFinance
    ? await Promise.all([
        activeSection === "published" ? db
          .from("report_snapshots")
          .select("id,starts_on,ends_on,revision,created_at", { count: "exact" })
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(list.from, list.to) : {data: [], error: null, count: 0},
        activeSection === "finance" ? db
          .from("report_reconciliations")
          .select("*", { count: "exact" })
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(list.from, list.to) : {data: [], error: null, count: 0},
      ])
    : [
        { data: [], error: null, count: 0 },
        { data: [], error: null, count: 0 },
      ];
  if (snapshots.error || reconciliations.error)
    throw new Error("Could not load saved reports.");
  const scope = report.location_id
    ? locations.data.find((l) => l.id === report.location_id)?.name
    : "Whole business, including stock in transit";
  const sales = report.sales;
  const [actionRows, people] = await Promise.all([
    activeSection === "actions" ? db
      .from("management_actions")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(list.from, list.to) : {data: [], error: null, count: 0},
    activeSection === "actions" ? db.rpc("operating_people", { p_organization_id: organizationId }) : {data: [], error: null},
  ]);
  if (actionRows.error || people.error)
    throw new Error("Could not load management actions.");
  let previous: ReturnType<typeof readReport> | undefined;
  const previousPeriod = previousReportPeriod(report.starts_on, report.ends_on);
  if (report.finance && !selected && activeSection === "overview") {
    const result = await db.rpc("operating_report", {
      p_organization_id: organizationId,
      p_starts_on: previousPeriod.start,
      p_ends_on: previousPeriod.end,
      ...(report.location_id ? { p_location_id: report.location_id } : {}),
    });
    if (result.error) throw new Error("Could not load the comparison period.");
    previous = readReport(result.data);
  }
  const dateFields = [
    hiddenField("starts_on", report.starts_on),
    hiddenField("ends_on", report.ends_on),
  ];
  const pct = (value: unknown) =>
    typeof value === "string" ? `${formatAmount(value)}%` : "Unavailable";
  return (
    <div className={styles.report}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVIDENCE BEHIND EVERY FIGURE</p>
          <h1>Reports</h1>
          <p>Daily control, weekly management and monthly review.</p>
        </div>
        <span className="role-pill">
          {selected
            ? `Published · revision ${selected.revision}`
            : "Live report"}{" "}
          · {report.readiness}
        </span>
      </div>
      <ReportFilters key={JSON.stringify(query)} section={activeSection} start={report.starts_on} end={query.end ?? (selected ? report.ends_on : undefined)} cadence={query.cadence} location={report.location_id} locations={allowedLocations} wholeBusiness={!access.departmentLocation} />
      <section className={styles.context} aria-label="Report context">
        <div>
          <h2>
            {report.starts_on} to {report.ends_on}
          </h2>
          <p>{scope} · Africa/Lagos</p>
        </div>
        <div className={styles.evidenceCounts}>
          <span>
            {report.posted_sales_lines} posted sales{" "}
            {report.posted_sales_lines === 1 ? "line" : "lines"}
          </span>
          <span data-warning={report.pending_documents > 0}>
            {report.pending_documents} stock records pending
          </span>
          <span data-warning={report.late_movement_entries > 0}>
            {report.late_movement_entries} late entries
          </span>
        </div>
        <details className={styles.coverage}>
          <summary>Report basis and coverage</summary>
          <p>{report.coverage_note}</p>
          <p>
            Observed{" "}
            {new Date(report.generated_at).toLocaleString("en-GB", {
              timeZone: "Africa/Lagos",
            })}{" "}
            (Lagos) · Formula {report.formula_version}
          </p>
          {selected && (
            <p>
              Publication reason: {selected.reason}. This snapshot is immutable.{" "}
              <Link
                className="text-link"
                href={`${base}/reports?start=${report.starts_on}&end=${report.ends_on}${report.location_id ? `&location=${report.location_id}` : ""}`}
              >
                View current evidence
              </Link>
            </p>
          )}
        </details>
        {selected && access.canFinance && (
          <a
            className="text-link"
            href={`${base}/reports/export?snapshot=${selected.id}`}
          >
            Download spreadsheet (CSV)
          </a>
        )}
      </section>
      <nav className={styles.tabs} aria-label="Report sections">
        {sections.map(([key, label]) => (
          <Link
            key={key}
            href={sectionLink(key)}
            aria-current={activeSection === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {activeSection === "overview" && report.finance && (
        <>
          <section className={styles.metrics} aria-label="Financial overview">
            <section>
              <h2>Net sales</h2>
              <strong>{money(sales?.net_sales)}</strong>
              <p>
                {report.posted_sales_lines} posted sales{" "}
                {report.posted_sales_lines === 1 ? "line" : "lines"}
              </p>
            </section>
            <section>
              <h2>Finance-reconciled COGS</h2>
              <strong>{money(sales?.actual_cogs)}</strong>
              <p>
                {sales?.actual_cogs == null
                  ? "Awaiting approved Finance evidence"
                  : "Approved accounting cost"}
              </p>
            </section>
            <section>
              <h2>Gross profit</h2>
              <strong>{money(sales?.actual_gross_profit)}</strong>
              <p>
                Gross margin <b>{pct(sales?.actual_gross_margin_pct)}</b>
              </p>
            </section>
            <section>
              <h2>Food cost</h2>
              <strong>{money(sales?.actual_food_cost)}</strong>
              <p>
                Food cost / net food sales{" "}
                <b>{pct(sales?.actual_food_cost_pct)}</b>
              </p>
            </section>
          </section>
          <div className={styles.overviewGrid}>
            <section className={styles.card}>
              <h2>Recipe benchmarks</h2>
              <p className={styles.hint}>
                Standard recipe costs captured when sales posted.
              </p>
              <dl className={styles.rows}>
                <div>
                  <dt>
                    <h3>Theoretical COGS</h3>
                  </dt>
                  <dd>{money(sales?.theoretical_cogs)}</dd>
                </div>
                <div>
                  <dt>
                    <h3>Theoretical gross profit</h3>
                  </dt>
                  <dd>{money(sales?.theoretical_gross_profit)}</dd>
                </div>
                <div>
                  <dt>Theoretical gross margin</dt>
                  <dd>{pct(sales?.theoretical_gross_margin_pct)}</dd>
                </div>
                <div>
                  <dt>Theoretical food cost / net food sales</dt>
                  <dd>{pct(sales?.theoretical_food_cost_pct)}</dd>
                </div>
              </dl>
              <details className={styles.coverage}>
                <summary>Cost definitions</summary>
                <p>
                  Standard-quantity inventory depletion cost:{" "}
                  {money(sales?.standard_quantity_inventory_cogs)}. This uses
                  carrying costs; recipe benchmarks use ingredient costs
                  captured at posting. Neither proves actual consumption. Waste
                  is reported separately.
                </p>
              </details>
            </section>
            <section className={styles.card}>
              <h2>Purchasing and losses</h2>
              <dl className={styles.rows}>
                <div>
                  <dt>Accepted purchase receipt value</dt>
                  <dd>{money(report.procurement?.accepted_purchase_value)}</dd>
                </div>
                <div>
                  <dt>Recorded waste value</dt>
                  <dd>{money(report.procurement?.recorded_waste_value)}</dd>
                </div>
                <div>
                  <dt>Signed count adjustment value</dt>
                  <dd>{money(report.procurement?.count_adjustment_value)}</dd>
                </div>
              </dl>
              <details className={styles.coverage}>
                <summary>How to read these figures</summary>
                <p>
                  Receipts are inventory acquisition value, not invoices paid.
                  Count adjustments and documented waste are separate events; do
                  not count a shortage twice.
                </p>
              </details>
              <Link className="text-link" href={sectionLink("inventory")}>
                Review inventory and movements
              </Link>
            </section>
          </div>
        </>
      )}
      {activeSection === "overview" && !report.finance && (
        <section className={styles.card}>
          <h2>Operational overview</h2>
          <p>
            {report.inventory.length} item/location balances ·{" "}
            {report.posted_sales_lines} posted sales lines
          </p>
          <p>
            {report.pending_documents} stock records pending ·{" "}
            {report.late_movement_entries} late movement entries
          </p>
          <Link className="text-link" href={sectionLink("inventory")}>
            Review inventory and movements
          </Link>
        </section>
      )}
      {activeSection === "overview" && previous && (
        <details className={styles.comparison}>
          <summary>Previous-period comparison</summary>
          <p>
            {previous.starts_on} to {previous.ends_on} · {previous.readiness}
          </p>
          <ResponsiveTable label="Report details">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  <th className="numeric">Selected period</th>
                  <th className="numeric">Previous period</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Net sales", "net_sales"],
                  ["Theoretical COGS", "theoretical_cogs"],
                  ["Finance-reconciled COGS", "actual_cogs"],
                  ["Gross profit", "actual_gross_profit"],
                ].map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{money(sales?.[key])}</td>
                    <td>{money(previous.sales?.[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
          <p>
            Unavailable comparison evidence is not treated as zero. Published
            snapshots retain their own selected-period figures; this comparison
            is shown on live drafts.
          </p>
        </details>
      )}
      {activeSection === "inventory" && (
        <div className={styles.inventoryGrid}>
          <section className={styles.card}>
            <h2>Inventory at the reporting cutoff</h2>
            <p>{report.valuation_basis}</p>
            {!report.inventory.length ? (
              <p>No posted inventory evidence for this period and location.</p>
            ) : (
              <ResponsiveTable label="Report details">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Location</th>
                      <th>Unit</th>
                      <th>Opening</th>
                      <th>Closing</th>
                      {report.finance && (
                        <>
                          <th>Opening value (NGN)</th>
                          <th>Closing value (NGN)</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.inventory.map((i, index) => (
                      <tr key={`${i.item_id}-${index}`}>
                        <td>
                          {i.sku} · {i.item}
                        </td>
                        <td>{i.location}</td>
                        <td>{i.unit}</td>
                        <td>{formatInventoryNumber(i.opening)}</td>
                        <td>{formatInventoryNumber(i.closing)}</td>
                        {report.finance && (
                          <>
                            <td>{formatAmount(i.opening_value)}</td>
                            <td>{formatAmount(i.closing_value)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTable>
            )}
          </section>
          <section className="panel">
            <h2>Movement evidence</h2>
            {!report.activity.length && (
              <p>No posted activity in this period.</p>
            )}
            {report.activity.map((a) => (
              <details className="inventory-details" key={a.movement}>
                <summary>
                  {a.movement.replaceAll("_", " ")} · {a.entries} entries{" "}
                  {report.finance ? `· ${money(a.value)}` : ""}
                </summary>
                <p>
                  Signed ledger value: inflows positive, outflows negative.
                  Production and internal transfers are not purchases or sales.
                </p>
                <Link
                  className="text-link"
                  href={`${base}/inventory?view=movements`}
                >
                  Open movement ledger
                </Link>
                <div className="inventory-actions">
                  {a.documents.map((id) => (
                    <Link
                      className="text-link"
                      key={id}
                      href={`${base}/inventory?view=documents&document=${id}`}
                    >
                      View source document {id}
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </div>
      )}
      {activeSection === "actions" && (
        <section className={styles.card}>
          <h2>Live management actions</h2>
          <ListControls query={query} total={actionRows.count ?? 0} label="management actions" searchable={false} />
          <p>
            Assigned findings and follow-up work. Updating an action never posts
            stock or changes a published report.
          </p>
          {actionRows.data.length === 0 && <p>No actions yet.</p>}
          {actionRows.data.map((a) => (
            <article className="inventory-document" key={a.id}>
              <h3>
                {a.title} · {a.priority}
              </h3>
              <p>
                {people.data.find((p) => p.user_id === a.assigned_to)
                  ?.display_name ?? "Team member"}{" "}
                · due {a.due_on} · {a.status}
              </p>
              <p>{a.evidence_reference}</p>
              {a.resolution_note && <p>{a.resolution_note}</p>}
              {(access.canFinance || a.assigned_to === access.userId) && (
                <details>
                  <summary>Update progress</summary>
                  <BusinessForm
                    organizationId={organizationId}
                    intent="update_action"
                    fields={[
                      ...dateFields,
                      hiddenField("id", a.id),
                      {
                        name: "status",
                        label: "Action status",
                        value: a.status,
                        options: [
                          { value: "open", label: "Open" },
                          { value: "in_progress", label: "In progress" },
                          { value: "resolved", label: "Resolved" },
                        ],
                      },
                      reasonField,
                    ]}
                    button="Save action progress"
                  />
                </details>
              )}
            </article>
          ))}
          {access.canFinance && (
            <details className="inventory-details">
              <summary>Create management action</summary>
              <BusinessForm
                organizationId={organizationId}
                intent="create_action"
                fields={[
                  ...dateFields,
                  { name: "title", label: "Action title" },
                  {
                    name: "assigned_to",
                    label: "Action owner",
                    options: people.data.map((p) => ({
                      value: p.user_id,
                      label: p.display_name,
                    })),
                  },
                  {
                    name: "priority",
                    label: "Priority",
                    value: "normal",
                    options: [
                      { value: "normal", label: "Normal" },
                      { value: "high", label: "High" },
                      { value: "urgent", label: "Urgent" },
                    ],
                  },
                  { name: "due_on", label: "Due date", type: "date" },
                  {
                    name: "evidence_reference",
                    label: "Action evidence / finding reference",
                  },
                ]}
                button="Create action"
              />
            </details>
          )}
        </section>
      )}
      {access.canFinance &&
        (activeSection === "finance" || activeSection === "published") && (
          <div className={styles.financeGrid}>
            {activeSection === "published" && (
              <section className={styles.card}>
                <h2>Publish a report snapshot</h2>
                <p>
                  Partial reports may be published with their coverage warnings.
                  New publications for the same dates/location create a new
                  revision and retain earlier versions.
                </p>
                <BusinessForm
                  organizationId={organizationId}
                  intent="publish"
                  fields={[
                    ...dateFields,
                    ...(report.location_id
                      ? [hiddenField("location_id", report.location_id)]
                      : []),
                    reasonField,
                  ]}
                  button="Publish snapshot"
                />
              </section>
            )}
            {activeSection === "finance" &&
              !report.location_id &&
              access.roles.some((r) => ["owner", "accountant"].includes(r)) && (
                <section className={styles.card}>
                  <h2>Submit Finance reconciliation</h2>
                  <p>
                    For completed dates only. Reconcile all POS sales with the
                    imported line count and net revenue. Enter actual accounting
                    COGS supported by a count/cost reconciliation or accounting
                    schedule; the system does not derive it from purchases. A
                    different Operations Manager must approve. Backdated changes
                    invalidate the reconciliation for live reports.
                  </p>
                  <BusinessForm
                    organizationId={organizationId}
                    intent="reconcile"
                    fields={[
                      ...dateFields,
                      {
                        name: "expected_sales_lines",
                        label: "Reconciled POS line count",
                      },
                      {
                        name: "net_sales",
                        label: "Reconciled net sales (NGN)",
                      },
                      { name: "actual_cogs", label: "Actual COGS (NGN)" },
                      {
                        name: "actual_food_cost",
                        label: "Actual food cost (NGN)",
                        optional: true,
                      },
                      {
                        name: "evidence_reference",
                        label: "Supporting evidence reference",
                        help: "Identify the accounting/count reconciliation and where it is retained.",
                      },
                      reasonField,
                    ]}
                    button="Submit reconciliation"
                  />
                </section>
              )}
            {activeSection === "finance" && (
              <section className={styles.card}>
                <h2>Accounting reconciliations</h2>
                <ListControls query={query} total={reconciliations.count ?? 0} label="reconciliations" searchable={false} />
                {!reconciliations.data?.length && (
                  <p>
                    No reconciliations yet. Actual COGS and gross margin remain
                    unavailable.
                  </p>
                )}
                {reconciliations.data?.map((r) => (
                  <details
                    className={styles.record}
                    key={r.id}
                    open={r.status === "submitted"}
                  >
                    <summary>
                      {r.starts_on} to {r.ends_on} · {r.status} · COGS{" "}
                      {money(r.actual_cogs)}
                    </summary>
                    <article className="inventory-document">
                      <h3>
                        {r.starts_on} to {r.ends_on} · {r.status}
                      </h3>
                      <p>
                        Net sales {money(r.net_sales)} · COGS{" "}
                        {money(r.actual_cogs)} · Food cost{" "}
                        {money(r.actual_food_cost)}
                      </p>
                      <p>
                        {r.evidence_reference} · {r.reason}
                      </p>
                      {r.status === "submitted" &&
                        access.isManager &&
                        r.created_by !== access.userId && (
                          <>
                            <BusinessForm
                              organizationId={organizationId}
                              intent="approve_reconciliation"
                              fields={[
                                hiddenField("id", r.id),
                                hiddenField("starts_on", r.starts_on),
                                hiddenField("ends_on", r.ends_on),
                              ]}
                              button="Approve reconciliation"
                            />
                            <details>
                              <summary>Reject reconciliation</summary>
                              <BusinessForm
                                organizationId={organizationId}
                                intent="reject_reconciliation"
                                fields={[
                                  hiddenField("id", r.id),
                                  hiddenField("starts_on", r.starts_on),
                                  hiddenField("ends_on", r.ends_on),
                                  reasonField,
                                ]}
                                button="Reject reconciliation"
                              />
                            </details>
                          </>
                        )}
                      {r.status === "submitted" &&
                        r.created_by === access.userId && (
                          <p>A different Operations Manager must approve.</p>
                        )}
                    </article>
                  </details>
                ))}
              </section>
            )}
            {activeSection === "published" && (
              <section className={styles.card}>
                <h2>Published reports</h2>
                <ListControls query={query} total={snapshots.count ?? 0} label="saved reports" searchable={false} />
                {!snapshots.data?.length && <p>No saved snapshots yet.</p>}
                {snapshots.data?.map((s) => (
                  <article className="inventory-document" key={s.id}>
                    <h3>
                      {s.starts_on} to {s.ends_on} · revision {s.revision}
                    </h3>
                    <div className="inventory-actions">
                      <Link
                        className="text-link"
                        href={`${base}/reports?snapshot=${s.id}&section=overview`}
                      >
                        View saved report
                      </Link>
                      <a
                        className="text-link"
                        href={`${base}/reports/export?snapshot=${s.id}`}
                      >
                        Download spreadsheet (CSV)
                      </a>
                    </div>
                    <small>Snapshot {s.id}</small>
                  </article>
                ))}
              </section>
            )}
          </div>
        )}
    </div>
  );
}
