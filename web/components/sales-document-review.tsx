import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import {
  salesRecord as record,
  salesText as text,
} from "./sales-review-format";
import { SalesLines } from "./sales-lines";
import styles from "./sales-review.module.css";

const amount = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? formatAmount(value)
    : "Unavailable";
const quantity = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? formatInventoryNumber(value)
    : "Unavailable";
const percentage = (value: unknown) =>
  value == null ? "Unavailable" : `${amount(value)}%`;

export function SalesDocumentReview({ preview }: { preview: unknown }) {
  const data = record(preview);
  const sales = record(data?.sales);
  const lines = Array.isArray(sales?.lines)
    ? sales.lines.map(record).filter((l) => l !== null)
    : [];
  const deductions = Array.isArray(data?.lines)
    ? data.lines.map(record).filter((l) => l !== null)
    : [];
  const warnings = Array.isArray(sales?.warnings)
    ? [
        ...new Set(
          sales.warnings.filter((w): w is string => typeof w === "string"),
        ),
      ]
    : [];
  const posted = sales?.posted === true;
  const costLabel = "Recipe COGS";
  return (
    <section className={styles.review} aria-label="Sales review">
      {sales ? (
        <>
          <h3>
            Sales summary{" "}
            <span>
              {String(sales.line_count)} sales{" "}
              {sales.line_count === 1 ? "line" : "lines"}
            </span>
          </h3>
          <dl className={styles.meta}>
            {[
              ["Business date", sales.business_date],
              ["Source system", sales.source_system],
              ["Location", sales.locations],
              ["Uploaded by", sales.uploaded_by],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{text(label)}</dt>
                <dd>{text(value)}</dd>
              </div>
            ))}
          </dl>
          {warnings.length > 0 && (
            <div className={styles.warning} role="alert">
              <strong>Review before approval</strong>
              <ul>
                {warnings.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {warnings.length > 5 && (
                <details>
                  <summary>Show {warnings.length - 5} more warnings</summary>
                  <ul>
                    {warnings.slice(5).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div className={styles.metrics}>
            {[
              ["Net sales", amount(sales.net_sales)],
              [costLabel, amount(sales.recipe_cogs)],
              ["Recipe profit", amount(sales.gross_profit)],
              ["Margin", percentage(sales.gross_margin_pct)],
            ].map(([label, value], index) => (
              <section className={styles.metric} key={label}>
                <h4>
                  {label}
                  {index < 3 ? " (NGN)" : ""}
                </h4>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <details className={styles.footnote}>
            <summary>Cost basis and posting checks</summary>
            <p>
              {posted
                ? "Recipe costs were captured when these sales posted. Later purchases do not change these figures."
                : "Recipe COGS uses standard recipe quantities and current business-wide ingredient costs. Approval rechecks costs, mappings, duplicate source IDs, periods and stock. Sales and stock deductions post together or neither posts."}{" "}
              Finance-reconciled actual COGS is reported separately. Gross
              margin is unavailable when net sales are zero or missing.
            </p>
          </details>
          <SalesLines lines={lines} posted={posted} costLabel={costLabel} />
        </>
      ) : (
        <p className="field-help">
          Sales amounts are visible to authorized sales operators, Finance and
          managers.
        </p>
      )}
      <details className="inventory-details">
        <summary>
          {posted
            ? "Posted inventory deductions"
            : "Expected inventory deductions"}
        </summary>
        <div className={`${styles.scrollbox} ${styles.deductions}`}>
          <table className="inventory-table" aria-label="Ingredient deductions">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Location</th>
                <th>Quantity</th>
                <th>Inventory unit cost (NGN)</th>
              </tr>
            </thead>
            <tbody>
              {deductions.map((l, index) => (
                <tr key={index}>
                  <td>{text(l.item)}</td>
                  <td>{text(l.location)}</td>
                  <td>
                    {quantity(l.quantity)} {text(l.unit)}
                  </td>
                  <td>{amount(l.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
