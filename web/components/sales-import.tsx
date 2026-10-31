"use client";
import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import { useId, useState, useSyncExternalStore } from "react";
import { parseSalesCsv, type ImportedSale } from "@/lib/sales-csv";
import { OperationForm } from "./operation-form";
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export function SalesImport({
  organizationId,
  requestId,
  today,
}: {
  organizationId: string;
  requestId: string;
  today: string;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportedSale[]>([]);
  const [error, setError] = useState("");
  const id = useId();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  return (
    <section className="panel">
      <h2>Import sales</h2>
      <p className="inventory-intro">
        Upload a CSV for one business date. Each row must have a stable, unique
        source line ID. Location must identify Kitchen or Bar. Returns and
        negative quantities require a separate reviewed correction.
      </p>
      <p className="field-help">
        Required columns: external_id, menu_code, quantity, location. Add
        net_sales for reporting: the total net revenue for each line after discounts,
        excluding tax, in NGN. Blank amounts remain unavailable; zero means an
        explicitly free item.
      </p>
      <div className="field">
        <label htmlFor={id}>Sales CSV file</label>
        <input
          id={id}
          type="file"
          disabled={!ready}
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setError("");
            setRows([]);
            setText("");
            if (!file) return;
            if (file.size > 200000) {
              setError("Use a CSV file smaller than 200 KB.");
              return;
            }
            try {
              const csv = await file.text();
              const parsed = parseSalesCsv(csv);
              setText(csv);
              setRows(parsed);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not read this CSV.",
              );
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <>
          <p role="status" className="inventory-intro">
            {rows.length} sales {rows.length === 1 ? "line" : "lines"} ready for
            validation. Save a draft, review its ingredient deductions, then
            submit for independent approval.
          </p>
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Source line</th>
                  <th>Menu code</th>
                  <th>Quantity sold</th>
                  <th>Location</th>
                  <th>Net sales (NGN)</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row) => (
                  <tr key={row.external_id}>
                    <td>{row.external_id}</td>
                    <td>{row.menu_code}</td>
                    <td>{formatInventoryNumber(row.quantity)}</td>
                    <td>{row.location}</td>
                    <td>
                      {row.net_sales == null
                        ? "Not supplied"
                        : formatAmount(row.net_sales)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && (
            <p className="field-help">
              Showing the first 50 rows; all rows will be validated.
            </p>
          )}
          <OperationForm
            organizationId={organizationId}
            intent="import_sales"
            requestId={requestId}
            button="Validate and save sales draft"
            fields={[
              { name: "csv", label: "CSV", type: "hidden", value: text },
              {
                name: "source_system",
                label: "Source system",
                help: "Use the same identifier for every import from this POS, e.g. MAIN-POS.",
              },
              {
                name: "event_date",
                label: "Sales business date",
                type: "date",
                value: today,
              },
              { name: "reason", label: "Import reference / reason" },
            ]}
          />
        </>
      )}
    </section>
  );
}
