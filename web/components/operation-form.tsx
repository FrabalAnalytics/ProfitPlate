"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { formatDecimalInput } from "@/lib/inventory-format";
import {
  operate,
  type OperationIntent,
  type OperationState,
} from "@/app/workspace/[organizationId]/inventory/actions";
export type OperationField = {
  name: string;
  label: string;
  type?: "text" | "date" | "hidden" | "email" | "password";
  value?: string;
  help?: string;
  optional?: boolean;
  options?: { value: string; label: string }[];
};
export function OperationForm({
  organizationId,
  intent,
  requestId,
  fields,
  button,
  items,
  lineCosts = false,
  help,
  quantityLabel = "Quantity",
  costLabel = "Unit cost",
  rejectedQuantities = false,
  initialLines,
}: {
  organizationId: string;
  intent: OperationIntent;
  requestId: string;
  fields: OperationField[];
  button: string;
  items?: { value: string; label: string; keywords?: string }[];
  lineCosts?: boolean;
  help?: string;
  quantityLabel?: string;
  costLabel?: string;
  rejectedQuantities?: boolean;
  initialLines?: { item_id: string; quantity: string; unit_cost?: string }[];
}) {
  const [state, action, pending] = useActionState(
    operate.bind(null, organizationId, intent),
    {} as OperationState,
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        [
          "standard_output",
          "planned_output",
          "actual_output",
          "base_quantity",
          "quoted_price",
          "factor",
        ].includes(f.name)
          ? formatDecimalInput(f.value ?? "", f.name === "quoted_price" ? 2 : 3)
          : (f.value ?? ""),
      ]),
    ),
  );
  const [rows, setRows] = useState(
    (initialLines?.length
      ? initialLines
      : [{ item_id: "", quantity: "", unit_cost: "" }]
    ).map((row) => ({
      ...row,
      quantity: formatDecimalInput(row.quantity),
      unit_cost: formatDecimalInput(row.unit_cost ?? "", 2),
      rejected_quantity: "0",
      search: "",
    })),
  );
  const error = useRef<HTMLDivElement>(null);
  const key = useRef({ id: requestId, fingerprint: "" });
  const formId = useId();
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  function changeRow(
    index: number,
    field:
      "item_id" | "quantity" | "unit_cost" | "rejected_quantity" | "search",
    value: string,
  ) {
    setRows((previous) =>
      previous.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  }
  return (
    <form
      className="stack-form operation-form"
      action={action}
      aria-busy={pending}
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        data.delete("request_id");
        const fingerprint = JSON.stringify([...data.entries()]);
        if (
          key.current.fingerprint &&
          key.current.fingerprint !== fingerprint
        ) {
          const b = crypto.getRandomValues(new Uint8Array(16));
          b[6] = (b[6] & 15) | 64;
          b[8] = (b[8] & 63) | 128;
          const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(
            "",
          );
          key.current.id = [
            h.slice(0, 8),
            h.slice(8, 12),
            h.slice(12, 16),
            h.slice(16, 20),
            h.slice(20),
          ].join("-");
        }
        key.current.fingerprint = fingerprint;
        (
          event.currentTarget.elements.namedItem(
            "request_id",
          ) as HTMLInputElement
        ).value = key.current.id;
      }}
    >
      <input type="hidden" name="request_id" defaultValue={requestId} />
      {state.error && (
        <div
          role="alert"
          className="notice notice-error"
          tabIndex={-1}
          ref={error}
        >
          {state.error}
        </div>
      )}
      {state.invitationCode && (
        <div className="notice notice-success" role="status">
          <strong>Manual access code generated</strong>
          <p>
            No email was sent. Share this code with the intended recipient; they
            must sign in with the invited email and enter it on Join business.
          </p>
          <label htmlFor={`${formId}-invite-code`}>
            Invitation access code
          </label>
          <textarea
            id={`${formId}-invite-code`}
            className="invitation-code"
            readOnly
            value={state.invitationCode}
            onFocus={(event) => event.currentTarget.select()}
          />
          {state.expiresAt && (
            <p>
              Expires:{" "}
              {new Date(state.expiresAt).toLocaleDateString("en-GB", {
                timeZone: "Africa/Lagos",
              })}
            </p>
          )}
        </div>
      )}
      {help && <p className="field-help">{help}</p>}
      {fields
        .filter(
          (field) =>
            !(
              intent === "create_recipe" &&
              field.name === "output_item_id" &&
              values.kind !== "sub_recipe"
            ),
        )
        .map((field) =>
          field.type === "hidden" ? (
            <input
              key={field.name}
              type="hidden"
              name={field.name}
              value={field.value ?? ""}
            />
          ) : (
            <div className="field" key={field.name}>
              <label htmlFor={`${formId}-${field.name}`}>{field.label}</label>
              {field.options ? (
                <select
                  id={`${formId}-${field.name}`}
                  name={field.name}
                  value={values[field.name]}
                  required={!field.optional}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.value })
                  }
                  aria-describedby={
                    field.help ? `${formId}-${field.name}-help` : undefined
                  }
                >
                  <option value="">Select…</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${formId}-${field.name}`}
                  name={field.name}
                  type={field.type ?? "text"}
                  maxLength={field.name === "reason" ? 500 : 160}
                  value={values[field.name]}
                  required={!field.optional}
                  readOnly={pending}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.value })
                  }
                  aria-describedby={
                    field.help ? `${formId}-${field.name}-help` : undefined
                  }
                />
              )}
              {field.help && (
                <p id={`${formId}-${field.name}-help`} className="field-help">
                  {field.help}
                </p>
              )}
            </div>
          ),
        )}
      {items && (
        <fieldset className="operation-lines">
          <legend>Items and quantities</legend>
          {rows.map((row, index) => (
            <div className="operation-line" key={index}>
              <div className="field">
                <label htmlFor={`${formId}-search-${index}`}>
                  Find item {index + 1}
                </label>
                <input
                  id={`${formId}-search-${index}`}
                  type="search"
                  placeholder="Search name or SKU"
                  value={row.search}
                  readOnly={pending}
                  onChange={(event) =>
                    changeRow(index, "search", event.target.value)
                  }
                />
                <label htmlFor={`${formId}-item-${index}`}>
                  Item {index + 1}
                </label>
                <select
                  id={`${formId}-item-${index}`}
                  name="line_item_id"
                  required
                  value={row.item_id}
                  onChange={(e) => changeRow(index, "item_id", e.target.value)}
                >
                  <option value="">Select item…</option>
                  {items
                    .filter(
                      (item) =>
                        item.value === row.item_id ||
                        `${item.label} ${item.keywords ?? ""}`
                          .toLowerCase()
                          .includes(row.search.toLowerCase()),
                    )
                    .map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${formId}-qty-${index}`}>
                  {quantityLabel} {index + 1}
                </label>
                <input
                  id={`${formId}-qty-${index}`}
                  name="line_quantity"
                  inputMode="decimal"
                  required
                  value={row.quantity}
                  readOnly={pending}
                  onChange={(e) => changeRow(index, "quantity", e.target.value)}
                />
              </div>
              {lineCosts && (
                <div className="field">
                  <label htmlFor={`${formId}-cost-${index}`}>
                    {costLabel} {index + 1} (NGN)
                  </label>
                  <input
                    id={`${formId}-cost-${index}`}
                    name="line_unit_cost"
                    inputMode="decimal"
                    required
                    value={row.unit_cost}
                    readOnly={pending}
                    onChange={(e) =>
                      changeRow(index, "unit_cost", e.target.value)
                    }
                  />
                </div>
              )}
              {rejectedQuantities && (
                <div className="field">
                  <label htmlFor={`${formId}-rejected-${index}`}>
                    Rejected quantity {index + 1}
                  </label>
                  <input
                    id={`${formId}-rejected-${index}`}
                    name="line_rejected_quantity"
                    inputMode="decimal"
                    value={row.rejected_quantity}
                    readOnly={pending}
                    onChange={(event) =>
                      changeRow(index, "rejected_quantity", event.target.value)
                    }
                  />
                </div>
              )}
              {rows.length > 1 && (
                <button
                  className="text-link"
                  type="button"
                  disabled={pending}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove item {index + 1}
                </button>
              )}
            </div>
          ))}
          <button
            className="button button-secondary"
            type="button"
            disabled={pending || rows.length >= 200}
            onClick={() =>
              setRows([
                ...rows,
                {
                  item_id: "",
                  quantity: "",
                  unit_cost: "",
                  rejected_quantity: "0",
                  search: "",
                },
              ])
            }
          >
            Add another item
          </button>
        </fieldset>
      )}
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending ? "Saving…" : button}
      </button>
    </form>
  );
}
