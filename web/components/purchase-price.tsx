import { formatAmount } from "@/lib/inventory-format";

export function PurchasePrice({
  price,
  source,
  status,
  category,
}: {
  price: string | null | undefined;
  source: string | null | undefined;
  status: string | null | undefined;
  category: string | null | undefined;
}) {
  if (category === "semi_finished") return <>Produced in-house</>;
  if (price !== null && price !== undefined)
    return (
      <>
        {formatAmount(price)}
        {source === "imported_reference" && (
          <small className="price-source">Imported reference</small>
        )}
      </>
    );
  if (source === "imported_reference")
    return (
      <>{status === "zero_unconfirmed" ? "Unconfirmed (0)" : "Price missing"}</>
    );
  return <>Not purchased yet</>;
}
