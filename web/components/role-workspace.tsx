import Link from "next/link";
import { workspaceRole } from "@/lib/workspace-role";
import { roleLabels } from "@/lib/role-labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function RoleWorkspace({
  organizationId,
}: {
  organizationId: string;
}) {
  const access = await workspaceRole(organizationId);
  const base = `/workspace/${organizationId}`;
  const db = await createSupabaseServerClient();
  const [stock, requests, orders] = await Promise.all([
    db
      .from("inventory_documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "submitted"),
    db
      .from("stock_requisitions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "submitted"),
    access.canReadVendors
      ? db
          .from("purchase_orders")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "submitted")
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (stock.error || requests.error || orders.error)
    throw new Error("Could not load your daily work queue.");
  let actions: [string, string, string][];
  if (access.isManager)
    actions = [
      [
        "Review approvals",
        "approvals",
        "Stock, waste, production, sales, orders and requisitions in one queue.",
      ],
      [
        "Check stock",
        "inventory?view=stock",
        "Balances by location and current business-wide average costs.",
      ],
      [
        "Follow deliveries",
        "purchasing",
        "Approved orders, partial receipts and outstanding quantities.",
      ],
      [
        "Control periods",
        "inventory?view=controls",
        "Close periods; an Operations Manager can reopen them.",
      ],
    ];
  else if (access.primaryRole === "procurement_officer")
    actions = [
      [
        "Prepare a purchase order",
        "purchasing",
        "Order from an active supplier using verified purchase packs.",
      ],
      [
        "Maintain suppliers",
        "masters?view=vendors",
        "Supplier names, contacts and availability.",
      ],
      [
        "Supplier items and prices",
        "masters?view=vendor_items",
        "Verified packs, supplier item codes and quotations.",
      ],
      [
        "Review stock needs",
        "inventory?view=stock",
        "See stock across locations before buying.",
      ],
    ];
  else if (access.primaryRole === "inventory_manager")
    actions = [
      [
        "Receive ordered goods",
        "purchasing",
        "Confirm what arrived against an approved order.",
      ],
      [
        "Fulfil approved requests",
        "requests",
        "Dispatch available stock and keep outstanding quantities visible.",
      ],
      [
        "Track deliveries",
        "inventory?view=documents",
        "Follow dispatched stock and recipient acknowledgements.",
      ],
      [
        "Record store waste",
        "inventory?view=documents&action=waste",
        "Document a loss for independent manager approval.",
      ],
    ];
  else if (["kitchen_lead", "bar_lead"].includes(access.primaryRole))
    actions = [
      [
        "Request stock",
        "requests",
        "Ask Main Store for the items your department needs.",
      ],
      [
        "Confirm incoming stock",
        "inventory?view=documents",
        "Acknowledge actual received quantities; partial deliveries stay in transit.",
      ],
      [
        access.primaryRole === "kitchen_lead"
          ? "Record production"
          : "View bar stock",
        access.primaryRole === "kitchen_lead"
          ? "inventory?view=documents&action=production"
          : "inventory?view=stock",
        access.primaryRole === "kitchen_lead"
          ? "Scale standard ingredients and declare actual output."
          : "Check the stock available in your location.",
      ],
      [
        "Record waste",
        "inventory?view=documents&action=waste",
        "Record the item, quantity and reason for manager approval.",
      ],
    ];
  else if (access.primaryRole === "accountant")
    actions = [
      [
        "Review stock value",
        "inventory?view=stock",
        "Read balances and valuation without posting stock.",
      ],
      [
        "Review purchase history",
        "purchasing",
        "Inspect approved prices, orders and receipts.",
      ],
      [
        "Trace inventory movements",
        "inventory?view=movements",
        "Follow permanent quantities and values by source document.",
      ],
      [
        "Review recipe costs",
        "inventory?view=recipes",
        "Current ingredient averages, separate from historical production cost.",
      ],
    ];
  else if (access.isOwner)
    actions = [
      [
        "Review business reports",
        "reports",
        "Sales, COGS, food cost, gross margin and evidence readiness.",
      ],
      [
        "Review purchasing",
        "purchasing",
        "Accepted deliveries and outstanding commitments.",
      ],
      [
        "Manage team access",
        "team",
        "Assign working roles and independent approvers.",
      ],
      [
        "Maintain master data",
        "masters",
        "Items, recipes, menus and shared definitions.",
      ],
    ];
  else if (access.canTeam)
    actions = [
      [
        "Manage team access",
        "team",
        "Invite test users and assign their working roles.",
      ],
      [
        "Maintain master data",
        "masters",
        "Items, recipes, suppliers, menus and units.",
      ],
      ["Manage locations", "locations", "Maintain authorized location setup."],
      [
        "Maintain units",
        "masters?view=units",
        "Review measured conversions without stock posting authority.",
      ],
    ];
  else
    actions = [
      [
        "View stock",
        "inventory?view=stock",
        "Read the stock available to your role.",
      ],
      [
        "View movements",
        "inventory?view=movements",
        "Follow posted inventory changes.",
      ],
      [
        "View recipes",
        "inventory?view=recipes",
        "Read shared recipe definitions and costs.",
      ],
    ];
  return (
    <section aria-label="Daily workspace" className="daily-workspace">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">YOUR DAILY WORKSPACE</p>
          <h2>{roleLabels[access.role] ?? access.role}</h2>
        </div>
        <Link className="text-link" href={`${base}/masters`}>
          Master data →
        </Link>
      </div>
      {access.canReports && (
        <div className="inventory-actions">
          <Link className="button button-secondary" href={`${base}/reports`}>
            Daily, weekly and monthly reports
          </Link>
          {(access.canStock || access.departmentLocation) && (
            <Link className="button button-secondary" href={`${base}/counts`}>
              Counts and adjustments
            </Link>
          )}
        </div>
      )}
      <div className="role-action-grid">
        {actions.map(([title, path, detail]) => (
          <Link
            className="panel role-action"
            key={path}
            href={`${base}/${path}`}
          >
            <h2>{title}</h2>
            <p>{detail}</p>
            <span>Open →</span>
          </Link>
        ))}
      </div>
      <div className="role-queue-strip">
        <span>{stock.count ?? 0} stock documents awaiting review</span>
        <span>{requests.count ?? 0} stock requests awaiting review</span>
        {access.canReadVendors && (
          <span>{orders.count ?? 0} purchase orders awaiting review</span>
        )}
      </div>
    </section>
  );
}
