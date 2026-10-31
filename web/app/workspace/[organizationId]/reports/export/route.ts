import { formatInventoryNumber, formatAmount } from "@/lib/inventory-format";
import { randomUUID } from "node:crypto";
import { requireMembership } from "@/lib/auth/session";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readReport } from "@/lib/reporting";
import { isUuid } from "@/lib/auth/validation";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  await requireMembership(organizationId);
  const access = await workspaceRole(organizationId);
  if (!access.canFinance) return new Response("Access denied", { status: 403 });
  const id = new URL(request.url).searchParams.get("snapshot");
  if (!isUuid(id)) return new Response("Invalid snapshot", { status: 400 });
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("report_snapshots")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data)
    return new Response("Snapshot unavailable", { status: 404 });
  const audit = await db.rpc("reporting_command", {
    p_command: "export",
    p_organization_id: organizationId,
    p_request_id: randomUUID(),
    p_payload: { id },
  });
  if (audit.error)
    return new Response("Export authorization failed", { status: 403 });
  const report = readReport(data.report);
  const rows: unknown[][] = [
    ["ProfitPlate report", data.id],
    ["Revision", data.revision],
    ["Formula", data.formula_version],
    ["Start", data.starts_on],
    ["End", data.ends_on],
    ["Observed at", report.generated_at],
    ["Published at", data.created_at],
    ["Readiness", report.readiness],
    ["Coverage", report.coverage_note],
    [
      "Location filter",
      report.location_id ?? "Whole business including transit",
    ],
    ["Source fingerprint", report.source_hash],
    ["Valuation", report.valuation_basis],
    [],
    ["Metric", "Value"],
  ];
  for (const [k, v] of Object.entries(report.sales ?? {}))
    rows.push([
      k,
      typeof v === "string" ? formatAmount(v) : (v ?? "Unavailable"),
    ]);
  for (const [k, v] of Object.entries(report.procurement ?? {}))
    rows.push([k, formatAmount(v)]);
  rows.push(
    [],
    ["Movement", "Entries", "Signed value NGN", "Source document IDs"],
  );
  for (const a of report.activity)
    rows.push([
      a.movement,
      a.entries,
      formatAmount(a.value),
      a.documents.join(" "),
    ]);
  rows.push(
    [],
    [
      "SKU",
      "Item",
      "Location",
      "Unit",
      "Opening",
      "Closing",
      "Opening value NGN",
      "Closing value NGN",
    ],
  );
  for (const i of report.inventory)
    rows.push([
      i.sku,
      i.item,
      i.location,
      i.unit,
      formatInventoryNumber(i.opening),
      formatInventoryNumber(i.closing),
      formatAmount(i.opening_value),
      formatAmount(i.closing_value),
    ]);
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s) && !/^\-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return new Response(
    "\uFEFF" + rows.map((r) => r.map(escape).join(",")).join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="profitplate-${data.starts_on}-${data.ends_on}-v${data.revision}.csv"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
