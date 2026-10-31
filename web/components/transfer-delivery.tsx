import type { Database } from "@/lib/database.types";
import { formatInventoryNumber } from "@/lib/inventory-format";
import { BusinessForm, hiddenField, reasonField } from "./business-form";

export type TransferDeliveryLine =
  Database["public"]["Views"]["transfer_delivery_view"]["Row"];

export function TransferDelivery({
  organizationId,
  lines,
  userId,
  canReceive,
  canReturn,
  returnTo = "inventory",
}: {
  organizationId: string;
  lines: TransferDeliveryLine[];
  userId: string;
  canReceive: boolean;
  canReturn: boolean;
  returnTo?: "inventory" | "requests";
}) {
  const delivery = lines[0];
  if (!delivery) return null;
  const pending = lines.filter((l) => Number(l.pending_quantity) > 0);
  const returns = lines.filter((l) => Number(l.awaiting_return_quantity) > 0);
  const items = (rows: TransferDeliveryLine[]) =>
    rows.map((l) => ({
      value: l.item_id!,
      label: `${l.item_name} (${l.unit})`,
    }));
  return (
    <div>
      <p className="field-help">
        {delivery.reserved_on_dispatch
          ? "Dispatched quantities stay reserved in Store. Only accepted quantities move to the receiving location. Rejected goods stay reserved until Store confirms their return."
          : "This earlier dispatch already moved stock into transit. Accepting it adds stock to the destination; confirming rejected returns restores stock to Store."}
      </p>
      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Dispatched</th>
              <th>Accepted</th>
              <th>Pending acceptance</th>
              <th>Rejected</th>
              <th>Returned to Store</th>
              <th>Awaiting return</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.item_id}>
                <td>{l.item_name}</td>
                <td>
                  {formatInventoryNumber(l.quantity)} {l.unit}
                </td>
                <td>{formatInventoryNumber(l.received_quantity)}</td>
                <td>{formatInventoryNumber(l.pending_quantity)}</td>
                <td>{formatInventoryNumber(l.rejected_quantity)}</td>
                <td>{formatInventoryNumber(l.returned_quantity)}</td>
                <td>{formatInventoryNumber(l.awaiting_return_quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {delivery.status === "dispatched" &&
        canReceive &&
        delivery.created_by !== userId &&
        pending.length > 0 && (
          <>
            <details className="inventory-details">
              <summary>Confirm received quantities</summary>
              <BusinessForm
                organizationId={organizationId}
                intent="receive_transfer"
                fields={[
                  hiddenField("id", delivery.document_id!),
                  hiddenField("return_to", returnTo),
                  reasonField,
                ]}
                items={items(pending)}
                button="Confirm receipt"
                help="Enter only the items and quantities accepted now. Other quantities remain pending. Accepted quantities update both location balances immediately."
              />
            </details>
            <details className="inventory-details">
              <summary>Reject delivery quantities</summary>
              <BusinessForm
                organizationId={organizationId}
                intent="reject_transfer"
                fields={[
                  hiddenField("id", delivery.document_id!),
                  hiddenField("return_to", returnTo),
                  reasonField,
                ]}
                items={items(pending)}
                button="Reject entered quantities"
                help="Give the reason and quantities rejected. Rejection adds nothing to department stock. Store must confirm the returned goods before they become available again."
              />
            </details>
          </>
        )}
      {delivery.status === "dispatched" && canReturn && returns.length > 0 && (
        <details className="inventory-details">
          <summary>Confirm rejected goods returned to Store</summary>
          <BusinessForm
            organizationId={organizationId}
            intent="return_transfer"
            fields={[
              hiddenField("id", delivery.document_id!),
              hiddenField("return_to", returnTo),
              reasonField,
            ]}
            items={items(returns)}
            button="Confirm returned quantities"
            help="Record only rejected goods physically returned now. This releases their reservation and reopens the corresponding unfulfilled request quantity."
          />
        </details>
      )}
    </div>
  );
}
