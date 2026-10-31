import Link from "next/link";
import styles from "./sales-review.module.css";
import { formatAmount } from "@/lib/inventory-format";
import {
  salesRecord as record,
  salesText as text,
} from "./sales-review-format";

export function SalesBatchList({
  organizationId,
  batches,
  pendingOnly = false,
}: {
  organizationId: string;
  pendingOnly?: boolean;
  batches: {
    id: string;
    event_date: string;
    reason: string;
    status: string;
    preview: unknown;
  }[];
}) {
  return (
    <section className="panel" aria-label="Sales batches">
      <div className="panel-heading">
        <h2>{pendingOnly ? "Sales awaiting approval" : "Sales batches"}</h2>
        <Link
          className="text-link"
          href={`/workspace/${organizationId}/inventory?view=sales`}
        >
          Import sales
        </Link>
      </div>
      <p className="field-help">
        Open a batch to review its sales and supporting stock deductions.
        Showing the latest {batches.length} batches.
      </p>
      {!batches.length ? (
        <p className="inventory-empty">
          {pendingOnly
            ? "No sales batches awaiting approval."
            : "No sales batches yet."}
        </p>
      ) : (
        <>
          <div className={`inventory-table-wrap ${styles.batchDesktop}`}>
            <table className="inventory-table" aria-label="Sales batches">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Import reference</th>
                  <th>Location</th>
                  <th>Lines</th>
                  <th>Net sales (NGN)</th>
                  <th>Status</th>
                  <th>Uploaded by</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const sales = record(record(b.preview)?.sales);
                  return (
                    <tr key={b.id}>
                      <td>{b.event_date}</td>
                      <td>{b.reason}</td>
                      <td>{text(sales?.locations)}</td>
                      <td>
                        {sales?.line_count == null
                          ? "—"
                          : String(sales.line_count)}
                      </td>
                      <td>
                        {typeof sales?.net_sales === "string"
                          ? formatAmount(sales.net_sales)
                          : "Unavailable"}
                      </td>
                      <td>
                        <span className="role-pill">{b.status}</span>
                      </td>
                      <td>{text(sales?.uploaded_by)}</td>
                      <td>
                        <Link
                          className="text-link"
                          href={`/workspace/${organizationId}/sales/${b.id}`}
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.batchCards}>
            {batches.map((b) => {
              const sales = record(record(b.preview)?.sales);
              return (
                <article
                  key={b.id}
                  aria-label={`Sales batch ${b.reason}`}
                  className={styles.batchCard}
                >
                  <div className="panel-heading">
                    <h3>{b.reason}</h3>
                    <span className="role-pill">{b.status}</span>
                  </div>
                  <p>
                    {b.event_date} · {text(sales?.locations)} ·{" "}
                    {String(sales?.line_count ?? "—")}{" "}
                    {sales?.line_count === 1 ? "line" : "lines"}
                  </p>
                  <p>
                    <strong>
                      NGN{" "}
                      {typeof sales?.net_sales === "string"
                        ? formatAmount(sales.net_sales)
                        : "Unavailable"}
                    </strong>
                  </p>
                  <p>Uploaded by {text(sales?.uploaded_by)}</p>
                  <Link
                    className="text-link"
                    href={`/workspace/${organizationId}/sales/${b.id}`}
                  >
                    Review
                  </Link>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
