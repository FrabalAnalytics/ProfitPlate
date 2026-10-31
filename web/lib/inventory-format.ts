/** Round database decimals for display without changing stored precision. */
function formatDecimal(
  value: string | number | null | undefined,
  places: 2 | 3,
): string {
  if (value == null) return "Unavailable";
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;

  const [, sign, whole, fraction = ""] = match;
  let scaled =
    BigInt(whole) * BigInt(places === 3 ? 1000 : 100) +
    BigInt(fraction.padEnd(places, "0").slice(0, places));
  if (fraction.length > places && fraction[places] >= "5") scaled += BigInt(1);
  const digits = scaled.toString().padStart(places + 1, "0");
  return `${sign && scaled !== BigInt(0) ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

type DecimalValue = string | number | null | undefined;
export const formatInventoryNumber = (value: DecimalValue) =>
  formatDecimal(value, 3);
export const formatAmount = (value: DecimalValue) => formatDecimal(value, 2);
export const formatPercentage = (value: DecimalValue) =>
  value == null ? "Unavailable" : `${formatAmount(value)}%`;
export function formatCurrency(value: DecimalValue): string {
  const amount = formatAmount(value);
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (!match) return "Unavailable";
  const [, sign, whole, fraction] = match;
  return `${sign}₦${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/** Remove database padding in editable defaults without rounding a meaningful digit. */
export function formatDecimalInput(value: string, places: 2 | 3 = 3): string {
  return new RegExp(`^-?\\d+(?:\\.\\d{0,${places}}0*)?$`).test(value)
    ? formatDecimal(value, places)
    : value;
}
