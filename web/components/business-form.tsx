import { randomUUID } from "node:crypto";
import { OperationForm, type OperationField } from "./operation-form";
import type { OperationIntent } from "@/app/workspace/[organizationId]/inventory/actions";
export function BusinessForm({
  organizationId,
  intent,
  fields,
  button,
  items,
  help,
  costs = false,
  quantityLabel,
  costLabel,
  rejectedQuantities,
  initialLines,
}: {
  organizationId: string;
  intent: OperationIntent;
  fields: OperationField[];
  button: string;
  items?: { value: string; label: string; keywords?: string }[];
  help?: string;
  costs?: boolean;
  quantityLabel?: string;
  costLabel?: string;
  rejectedQuantities?: boolean;
  initialLines?: { item_id: string; quantity: string; unit_cost?: string }[];
}) {
  return (
    <OperationForm
      key={`${intent}-${fields.find((f) => f.name === "id")?.value ?? ""}`}
      organizationId={organizationId}
      intent={intent}
      requestId={randomUUID()}
      fields={fields}
      button={button}
      items={items}
      lineCosts={costs}
      help={help}
      quantityLabel={quantityLabel}
      costLabel={costLabel}
      rejectedQuantities={rejectedQuantities}
      initialLines={initialLines}
    />
  );
}
export const hiddenField = (name: string, value: string): OperationField => ({
  name,
  label: name,
  type: "hidden",
  value,
});
export const reasonField: OperationField = {
  name: "reason",
  label: "Reason / reference",
  help: "Keep a short, useful explanation for the next person.",
};
export const activeField: OperationField = {
  name: "is_active",
  label: "Status",
  value: "true",
  options: [
    { value: "true", label: "Active" },
    { value: "false", label: "Inactive" },
  ],
};
