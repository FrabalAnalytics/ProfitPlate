import Link from "next/link";
import { Brand } from "@/components/brand";
import { WorkspaceNav } from "@/components/workspace-nav";
import { requireMembership, requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { workspaceRole } from "@/lib/workspace-role";
import { roleLabels } from "@/lib/role-labels";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { organization, membership, memberships } =
    await requireMembership(organizationId);
  const user = await requireUser();
  const access = await workspaceRole(organizationId);
  const supabase = await createSupabaseServerClient();
  const { data: businesses, error } = await supabase
    .from("organizations")
    .select("id,name")
    .in(
      "id",
      memberships.map((m) => m.organization_id),
    );
  if (error)
    throw new Error("We could not load your businesses. Please try again.");
  return (
    <div className="workspace-layout">
      <aside className="sidebar">
        <Brand />
        <div className="business-switch">
          <span className="business-avatar">
            {organization.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{organization.name}</strong>
            <small>Business workspace</small>
          </div>
        </div>
        {businesses.length > 1 && (
          <details className="business-picker">
            <summary>Switch business</summary>
            {businesses.map((business) => (
              <Link key={business.id} href={`/workspace/${business.id}`}>
                {business.name}
              </Link>
            ))}
          </details>
        )}
        <p className="nav-label">WORKSPACE</p>
        <WorkspaceNav organizationId={organizationId} access={access} />
        <div className="sidebar-bottom">
          <div className="account-info">
            <span className="user-avatar">
              {(user.email || "P").charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{user.email}</strong>
              <small>
                {roleLabels[access.role] ??
                  membership.role.replaceAll("_", " ")}
              </small>
            </div>
          </div>
          <Link className="join-business-link" href="/join">
            Join another business
          </Link>
          <form action={signOut}>
            <button className="sidebar-signout" type="submit">
              Sign out <span aria-hidden="true">↗</span>
            </button>
          </form>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-header">
          <span className="desktop-breadcrumb">
            Workspace <span>/</span> {organization.name}
          </span>
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="header-tag">
            <span />
            Your business workspace
          </span>
          <details className="mobile-menu">
            <summary>Menu</summary>
            <div>
              <strong>{organization.name}</strong>
              <WorkspaceNav organizationId={organizationId} access={access} />
              <Link className="text-link" href="/join">
                Join another business
              </Link>
              {businesses.length > 1 &&
                businesses.map((business) => (
                  <Link key={business.id} href={`/workspace/${business.id}`}>
                    {business.name}
                  </Link>
                ))}
              <form action={signOut}>
                <button className="text-link" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </header>
        <main id="main" className="workspace-content">
          {children}
        </main>
        <footer className="workspace-footer">
          ProfitPlate
          <span>
            {organization.currency_code} · {organization.timezone}
          </span>
        </footer>
      </div>
    </div>
  );
}
