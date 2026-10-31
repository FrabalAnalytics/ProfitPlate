import { redirect } from "next/navigation";
import { activeMemberships } from "@/lib/auth/session";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export default async function WorkspaceIndex() {
  const memberships = await activeMemberships();
  const preferred =
    memberships.find((membership) => membership.role === "owner") ||
    memberships[0];
  redirect(preferred ? `/workspace/${preferred.organization_id}` : "/setup");
}
