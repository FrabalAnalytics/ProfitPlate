"use client";

import { useId, useRef, useState } from "react";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import { salesText as text } from "./sales-review-format";
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

function LineDetails({ line }: { line: Record<string, unknown> }) {
  return (
    <details className={styles.lineDetails}>
      <summary>Line details</summary>
      <dl>
        <div>
          <dt>Source line</dt>
          <dd>{text(line.external_id)}</dd>
        </div>
        <div>
          <dt>Unit net price (NGN)</dt>
          <dd>{amount(line.unit_sales_price)}</dd>
        </div>
        <div>
          <dt>Recipe</dt>
          <dd>
            {text(line.recipe_name)} · version {String(line.recipe_revision)}
          </dd>
        </div>
      </dl>
    </details>
  );
}

export function SalesLines({
  lines,
  posted,
  costLabel,
}: {
  lines: Record<string, unknown>[];
  posted: boolean;
  costLabel: string;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [size, setSize] = useState(15);
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const goToPage = (next: number) => {
    setPage(next);
    scroll.current?.scrollTo({ top: 0, left: 0 });
  };
  const locations = [...new Set(lines.map((l) => text(l.location)))].sort();
  const query = search.trim().toLowerCase();
  const filtered = lines.filter(
    (l) =>
      (!location || l.location === location) &&
      [l.menu_name, l.menu_code, l.external_id, l.location].some((value) =>
        text(value).toLowerCase().includes(query),
      ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages - 1);
  const start = current * size;
  const visible = filtered.slice(start, start + size);
  return (
    <div className={styles.lines}>
      {lines.length > 15 && (
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <label htmlFor={`${id}-search`}>Search sales lines</label>
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              placeholder="Menu item, POS code or source line"
              onChange={(e) => {
                setSearch(e.target.value);
                goToPage(0);
              }}
            />
          </div>
          {locations.length > 1 && (
            <div>
              <label htmlFor={`${id}-location`}>Sales location</label>
              <select
                id={`${id}-location`}
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  goToPage(0);
                }}
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-size`}>Lines per page</label>
            <select
              id={`${id}-size`}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                goToPage(0);
              }}
            >
              {[15, 30, 60, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {lines.length > 15 && (
        <p className={styles.coverage}>
          {posted ? "Batch totals cover" : "Approval and batch totals cover"}{" "}
          all {lines.length} imported {lines.length === 1 ? "line" : "lines"},
          including lines on other pages or hidden by filters.
        </p>
      )}
      <div
        ref={scroll}
        className={styles.scrollbox}
        tabIndex={0}
        role="region"
        aria-label="Scrollable sales table"
      >
        <table
          className={`inventory-table ${styles.table}`}
          aria-label="Imported sales lines"
        >
          <thead>
            <tr>
              <th>Menu item / POS code</th>
              <th>Location</th>
              <th>Qty sold</th>
              <th>Net sales (NGN)</th>
              <th>{costLabel} (NGN)</th>
              <th>Gross profit (NGN)</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l, index) => (
              <tr key={`${start}-${index}`}>
                <td>
                  <strong>{text(l.menu_name)}</strong>
                  <small>{text(l.menu_code)}</small>
                  <LineDetails line={l} />
                </td>
                <td>{text(l.location)}</td>
                <td>{quantity(l.quantity)}</td>
                <td>{amount(l.net_sales)}</td>
                <td>{amount(l.recipe_cogs)}</td>
                <td>{amount(l.gross_profit)}</td>
                <td>{percentage(l.gross_margin_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className={styles.mobileRows} aria-label="Imported sales lines">
          {visible.map((line, index) => (
            <li key={`${start}-${index}`} className={styles.mobileRow}>
              <strong className={styles.mobileName}>
                {text(line.menu_name)}
              </strong>
              <p className={styles.mobileMeta}>
                {text(line.menu_code)} · {text(line.location)} · Qty{" "}
                {quantity(line.quantity)}
              </p>
              <dl className={styles.mobileAmounts}>
                {[
                  ["Net sales (NGN)", amount(line.net_sales)],
                  ["Recipe COGS (NGN)", amount(line.recipe_cogs)],
                  ["Gross profit (NGN)", amount(line.gross_profit)],
                  ["Margin", percentage(line.gross_margin_pct)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <LineDetails line={line} />
            </li>
          ))}
        </ul>
        {!visible.length && (
          <p className={styles.empty}>No sales lines match your search.</p>
        )}
      </div>
      {lines.length > 15 && (
        <div className={styles.pagination}>
          <p aria-live="polite">
            {filtered.length
              ? `${start + 1}–${Math.min(start + size, filtered.length)}`
              : "0"}{" "}
            of {filtered.length} matching lines · {lines.length} in batch
          </p>
          <nav aria-label="Sales line pages">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => goToPage(current - 1)}
            >
              Previous
            </button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              disabled={current === pages - 1}
              onClick={() => goToPage(current + 1)}
            >
              Next
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
