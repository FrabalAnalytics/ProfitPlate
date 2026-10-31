"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function WorkspaceNav({
  organizationId,
  access,
}: {
  organizationId: string;
  access?: {
    canTeam: boolean;
    canReadVendors: boolean;
    isManager: boolean;
    canReports?: boolean;
    canAudit?: boolean;
  };
}) {
  const pathname = usePathname();
  const base = `/workspace/${organizationId}`;
  return (
    <nav
      aria-label="Workspace"
      onClick={(event) =>
        event.currentTarget
          .closest("details.mobile-menu")
          ?.removeAttribute("open")
      }
    >
      <p className="nav-group-label">Daily work</p>
      <Link href={base} aria-current={pathname === base ? "page" : undefined}>
        <span aria-hidden="true">◫</span>Overview
      </Link>
      <Link
        href={`${base}/locations`}
        aria-current={
          pathname.startsWith(`${base}/locations`) ? "page" : undefined
        }
      >
        <span aria-hidden="true">⌂</span>Locations
      </Link>
      <Link
        href={`${base}/inventory`}
        aria-current={
          pathname.startsWith(`${base}/inventory`) ||
          pathname.startsWith(`${base}/items/`) ||
          pathname.startsWith(`${base}/recipes/`) ||
          pathname.startsWith(`${base}/sales/`)
            ? "page"
            : undefined
        }
      >
        <span aria-hidden="true">▤</span>Inventory
      </Link>
      <Link
        href={`${base}/requests`}
        aria-current={pathname.endsWith("/requests") ? "page" : undefined}
      >
        <span aria-hidden="true">⇄</span>Stock requests
      </Link>
      {access?.canReadVendors && (
        <Link
          href={`${base}/purchasing`}
          aria-current={pathname.endsWith("/purchasing") ? "page" : undefined}
        >
          <span aria-hidden="true">▣</span>Purchasing
        </Link>
      )}
      {access?.isManager && (
        <Link
          href={`${base}/approvals`}
          aria-current={pathname.endsWith("/approvals") ? "page" : undefined}
        >
          <span aria-hidden="true">✓</span>Approvals
        </Link>
      )}
      <Link
        href={`${base}/counts`}
        aria-current={pathname.endsWith("/counts") ? "page" : undefined}
      >
        <span aria-hidden="true">≡</span>Stock counts
      </Link>
      {access?.canReports && (
        <Link
          href={`${base}/reports`}
          aria-current={pathname.endsWith("/reports") ? "page" : undefined}
        >
          <span aria-hidden="true">▥</span>Reports
        </Link>
      )}
      <p className="nav-group-label">Business records</p>
      <Link
        href={`${base}/masters`}
        aria-current={pathname.endsWith("/masters") ? "page" : undefined}
      >
        <span aria-hidden="true">▦</span>Master data
      </Link>
      {access?.canTeam && (
        <Link
          href={`${base}/team`}
          aria-current={pathname.endsWith("/team") ? "page" : undefined}
        >
          <span aria-hidden="true">♧</span>Team and access
        </Link>
      )}
      {access?.canAudit && <Link href={`${base}/audit`} aria-current={pathname.endsWith("/audit") ? "page" : undefined}><span aria-hidden="true">◷</span>Audit history</Link>}
      <Link
        href={`${base}/settings`}
        aria-current={pathname.endsWith("/settings") ? "page" : undefined}
      >
        <span aria-hidden="true">⚙</span>Business settings
      </Link>
    </nav>
  );
}
