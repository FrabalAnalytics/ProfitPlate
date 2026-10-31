import { formatCurrency } from "./inventory-format.ts";
export type Report = {
  organization_id: string;
  starts_on: string;
  ends_on: string;
  location_id: string | null;
  generated_at: string;
  formula_version: string;
  source_hash: string;
  finance: boolean;
  readiness: string;
  pending_documents: number;
  late_movement_entries: number;
  posted_sales_lines: number;
  inventory: {
    item_id: string;
    sku: string;
    item: string;
    category: string;
    unit: string;
    location: string;
    opening: string;
    closing: string;
    opening_value: string | null;
    closing_value: string | null;
  }[];
  activity: {
    movement: string;
    entries: number;
    value: string | null;
    documents: string[];
  }[];
  sales: Record<string, string | number | null> | null;
  procurement?: Record<string, string> | null;
  valuation_basis: string;
  coverage_note: string;
};
export function readReport(value: unknown): Report {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("inventory" in value) ||
    !Array.isArray(value.inventory) ||
    !("organization_id" in value)
  )
    throw new Error("Invalid report response.");
  return value as Report;
}
export const money = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? formatCurrency(value)
    : "Unavailable";
export function previousReportPeriod(start: string, end: string) {
  const first = new Date(`${start}T00:00:00Z`),
    last = new Date(`${end}T00:00:00Z`);
  const following = new Date(last);
  following.setUTCDate(following.getUTCDate() + 1);
  if (first.getUTCDate() === 1 && following.getUTCDate() === 1 && first.getUTCFullYear() === last.getUTCFullYear() && first.getUTCMonth() === last.getUTCMonth()) {
    first.setUTCMonth(first.getUTCMonth() - 1);
    last.setUTCDate(0);
  } else {
    const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
    first.setUTCDate(first.getUTCDate() - days);
    last.setUTCDate(last.getUTCDate() - days);
  }
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}
export function reportPeriod(
  start: string | undefined,
  end: string | undefined,
  cadence: string | undefined,
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const valid = (s: string | undefined) =>
    Boolean(
      s &&
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    );
  if (start && !valid(start)) throw new Error("Enter a valid reference or start date.");
  const mode = cadence ?? (end ? "custom" : "daily");
  if (!["daily", "weekly", "monthly", "custom"].includes(mode)) throw new Error("Choose a supported report cycle.");
  if (mode === "custom" && (!end || !valid(end))) throw new Error("Enter a valid end date for the custom range.");
  const reference = valid(start) ? start! : today;
  let first = reference,
    last = mode === "custom" ? end! : reference;
  if (mode !== "custom") {
    const d = new Date(`${reference}T00:00:00Z`);
    if (mode === "weekly") {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      first = d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 6);
      last = d.toISOString().slice(0, 10);
    }
    if (mode === "monthly") {
      d.setUTCDate(1);
      first = d.toISOString().slice(0, 10);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      last = d.toISOString().slice(0, 10);
    }
  }
  if (first > last) throw new Error("The end date must be on or after the start date.");
  if ((Date.parse(last) - Date.parse(first)) / 86400000 > 366) throw new Error("Choose a report range of at most 367 days.");
  return { start: first, end: last };
}
