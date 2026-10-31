import { randomUUID } from "node:crypto";
import Link from'next/link';
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { OrganizationForm } from "@/components/organization-form";
import { activeMemberships, requireUser } from "@/lib/auth/session";
import { signOut } from "@/app/auth/actions";

// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Set up your business" };
export default async function SetupPage() {
  await requireUser();
  const memberships = await activeMemberships();
  if (memberships.length)
    redirect(`/workspace/${memberships[0].organization_id}`);
  return (
    <AuthShell step="LET’S SET THE TABLE">
      <span className="step-badge">Business setup</span>
      <h1>A home for your business.</h1>
      <p className="form-intro">
        Start with your business name. Your locations, inventory, and team will
        share this workspace.
      </p>
      <OrganizationForm requestId={randomUUID()} />
      <p className="setup-invite-note">
        Joining an existing business? <Link className="text-link" href="/join">Enter your team access code</Link>.
      </p>
      <form action={signOut}>
        <button type="submit" className="text-link signout-link">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
