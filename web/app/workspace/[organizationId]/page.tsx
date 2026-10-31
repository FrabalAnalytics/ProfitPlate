import Link from "next/link";
import { requireMembership } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Arrow, Check } from "@/components/brand";
import { RoleWorkspace } from "@/components/role-workspace";
import { workspaceRole } from "@/lib/workspace-role";
import { roleLabels } from "@/lib/role-labels";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Your workspace" };
export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { organization, membership } = await requireMembership(organizationId);
  const access = await workspaceRole(organizationId);
  if (!["owner", "admin"].includes(membership.role))
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">{organization.name}</p>
            <h1>{roleLabels[access.role] ?? access.role} workspace</h1>
            <p>
              Your daily tasks, with access checked against your current role.
            </p>
          </div>
        </div>
        <RoleWorkspace organizationId={organizationId} />
      </>
    );
  const supabase = await createSupabaseServerClient();
  const [locations, items] = await Promise.all([
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_active", true),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_active", true),
  ]);
  if (locations.error || items.error)
    throw new Error("We could not load your setup progress. Please try again.");
  const completed =
    1 + Number(Boolean(locations.count)) + Number(Boolean(items.count));
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR OPERATING FOUNDATION</p>
          <h1>Welcome to {organization.name}.</h1>
          <p>A shared home for the details behind your restaurant.</p>
        </div>
        <span className="role-pill">
          {membership.role.replaceAll("_", " ")}
        </span>
      </div>
      <RoleWorkspace organizationId={organizationId} />
      <details className="setup-history" open={completed < 3}>
      <summary>{completed === 3 ? "Setup complete · View business details" : "Finish business setup"}</summary>
      <section className="welcome-banner">
        <div>
          <span className="eyebrow">ONE STEP AT A TIME</span>
          <h2>
            Good decisions start
            <br />
            with a clear foundation.
          </h2>
          <p>
            Your business is saved. Build on it with consistent locations and
            item definitions.
          </p>
          <Link
            className="button button-light"
            href={`/workspace/${organizationId}/locations`}
          >
            Manage locations <Arrow />
          </Link>
        </div>
        <div className="foundation-art" aria-hidden="true">
          <span className="art-orbit orbit-one" />
          <span className="art-orbit orbit-two" />
          <div className="art-plate">
            <span>
              P<span>.</span>
            </span>
          </div>
          <span className="art-label">
            <Check />
            Business connected
          </span>
        </div>
      </section>
      <section className="workspace-grid" aria-label="Business setup">
        <div className="panel setup-checklist">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">GETTING ESTABLISHED</p>
              <h2>Your setup checklist</h2>
            </div>
            <span className="completion-label">{completed} of 3</span>
          </div>
          <progress
            className="setup-progress"
            value={completed}
            max={3}
            aria-label="Business setup progress"
          />
          {[
            {
              label: "Create your business",
              detail: "Your name, currency, and time zone are saved.",
              done: true,
              href: `/workspace/${organizationId}/settings`,
            },
            {
              label: "Define your locations",
              detail: `${locations.count || 0} active locations in this business.`,
              done: Boolean(locations.count),
              href: `/workspace/${organizationId}/locations`,
            },
            {
              label: "Build your item catalogue",
              detail: `${items.count || 0} active inventory ${items.count === 1 ? "item" : "items"} defined.`,
              done: Boolean(items.count),
              href: `/workspace/${organizationId}/inventory`,
            },
          ].map((step) => (
            <div className="checklist-row" key={step.label}>
              <span
                className={`checklist-icon ${step.done ? "is-complete" : ""}`}
                aria-hidden="true"
              >
                {step.done ? <Check /> : <span />}
              </span>
              <div>
                <strong>
                  {step.href ? (
                    <Link href={step.href}>{step.label}</Link>
                  ) : (
                    step.label
                  )}
                </strong>
                <p>{step.detail}</p>
              </div>
              <span className={`step-status ${step.done ? "is-complete" : ""}`}>
                {step.done ? "Saved" : "To do"}
              </span>
            </div>
          ))}
          <p className="panel-footnote">
            Your progress is saved to your business and available when you
            return.
          </p>
        </div>
        <aside className="panel business-summary">
          <div className="panel-heading">
            <h2>Business at a glance</h2>
            <span className="summary-symbol" aria-hidden="true">
              ↗
            </span>
          </div>
          <dl>
            <div>
              <dt>Business name</dt>
              <dd>{organization.name}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>
                NGN <span>Nigerian naira</span>
              </dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>Africa/Lagos</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd className="capitalize">
                {membership.role.replaceAll("_", " ")}
              </dd>
            </div>
          </dl>
          <Link
            className="summary-link"
            href={`/workspace/${organizationId}/settings`}
          >
            Business settings <Arrow />
          </Link>
        </aside>
      </section>
      <div className="workspace-note">
        <span aria-hidden="true">◎</span>
        <p>
          A consistent item catalogue and clear locations keep your team working
          from the same information.
        </p>
      </div>
      </details>
    </>
  );
}
