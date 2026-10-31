import { requireMembership } from "@/lib/auth/session";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Business settings" };
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { organization, membership } = await requireMembership(organizationId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE DETAILS THAT CONNECT YOUR TEAM</p>
          <h1>Business settings</h1>
          <p>Your shared business details and operating defaults.</p>
        </div>
      </div>
      <section className="panel settings-panel">
        <h2>{organization.name}</h2>
        <dl className="settings-list">
          <div>
            <dt>Business name</dt>
            <dd>{organization.name}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>NGN · Nigerian naira</dd>
          </div>
          <div>
            <dt>Business time zone</dt>
            <dd>Africa/Lagos</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd className="capitalize">
              {membership.role.replaceAll("_", " ")}
            </dd>
          </div>
        </dl>
        <p className="panel-footnote">
          Currency and time zone are fixed for this version of ProfitPlate.
        </p>
      </section>
    </>
  );
}
