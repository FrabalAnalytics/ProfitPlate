import { readAll } from "@/lib/read-all";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { workspaceRole } from "@/lib/workspace-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { memberRoleOptions, roleLabels } from "@/lib/role-labels";
export const instant = false;
export const metadata = { title: "Team and access" };
export default async function TeamPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  await requireMembership(organizationId);
  const access = await workspaceRole(organizationId);
  if (!access.canTeam) notFound();
  const db = await createSupabaseServerClient();
  const [directory, invitations, duties] = await Promise.all([
    db.rpc("team_directory", { p_organization_id: organizationId }),
    readAll(db
      .from("organization_invitations")
      .select("id,recipient_email,proposed_role,status,expires_at", {count:"exact"})
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id")),
    db
      .from("additional_role_assignments")
      .select("user_id,role")
      .eq("organization_id", organizationId),
  ]);
  if (directory.error || invitations.error || duties.error)
    throw new Error("We could not load team access.");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE RIGHT ACCESS FOR EACH PERSON</p>
          <h1>Team and access</h1>
          <p>Invite team members, assign working roles and manage access.</p>
        </div>
      </div>
      <div className="inventory-sections">
        {access.isOwner && (
          <section className="panel inventory-form-panel">
            <h2>Additional operational duties</h2>
            <p>
              Owner and Administrator do not automatically post stock or buy
              goods. Assign an explicit Inventory, Procurement or Finance duty
              when one person covers multiple functions. Operations Manager
              appointments remain separate; self-approval stays blocked.
            </p>
            <BusinessForm
              organizationId={organizationId}
              intent="assign_duty"
              fields={[
                {
                  name: "user_id",
                  label: "Duty holder",
                  options: directory.data
                    .filter((m) => m.member_status === "active")
                    .map((m) => ({
                      value: m.user_id,
                      label: m.email ?? "Team member",
                    })),
                },
                {
                  name: "role",
                  label: "Additional duty",
                  options: [
                    {
                      value: "inventory_manager",
                      label: "Inventory / Storekeeper",
                    },
                    {
                      value: "procurement_officer",
                      label: "Procurement Officer",
                    },
                    { value: "accountant", label: "Finance" },
                  ],
                },
                reasonField,
              ]}
              button="Assign additional duty"
            />
            {duties.data.map((d) => (
              <details
                className="inventory-details"
                key={`${d.user_id}-${d.role}`}
              >
                <summary>
                  {directory.data.find((m) => m.user_id === d.user_id)?.email} ·{" "}
                  {roleLabels[d.role]}
                </summary>
                <BusinessForm
                  organizationId={organizationId}
                  intent="remove_duty"
                  fields={[
                    hiddenField("user_id", d.user_id),
                    hiddenField("role", d.role),
                    reasonField,
                  ]}
                  button="Remove additional duty"
                />
              </details>
            ))}
          </section>
        )}
        <section className="panel inventory-form-panel">
          <h2>Invite a team member</h2>
          <p className="inventory-intro">
            No email is sent. Generate a manual access code and share it with
            the intended team member. They sign in with the invited email, then
            enter the code at{" "}
            <Link className="text-link" href="/join">
              Join business
            </Link>
            .
          </p>
          <BusinessForm
            organizationId={organizationId}
            intent="invite_member"
            button="Generate invitation code"
            fields={[
              { name: "email", label: "Invited email", type: "email" },
              {
                name: "role",
                label: "Working role",
                options: memberRoleOptions,
              },
            ]}
          />
        </section>
        <section className="panel">
          <h2>Team members</h2>
          {directory.data.map((member) => (
            <article
              className="inventory-document"
              key={member.user_id}
              aria-label={member.email ?? "Former member"}
            >
              <div className="panel-heading">
                <h3>{member.email ?? "Former member"}</h3>
                <span className="role-pill">{member.member_status}</span>
              </div>
              <p>
                {roleLabels[member.manager_role ?? member.member_role] ??
                  member.member_role}
              </p>
              {member.member_role !== "owner" &&
                member.user_id !== access.userId && (
                  <details className="inventory-details">
                    <summary>Manage this member</summary>
                    <BusinessForm
                      organizationId={organizationId}
                      intent="change_member_role"
                      fields={[
                        hiddenField("user_id", member.user_id),
                        {
                          name: "role",
                          label: "Working role",
                          value: member.member_role,
                          options: memberRoleOptions,
                        },
                        reasonField,
                      ]}
                      button="Change working role"
                    />
                    <BusinessForm
                      organizationId={organizationId}
                      intent={
                        member.member_status === "active"
                          ? "suspend_member"
                          : "reactivate_member"
                      }
                      fields={[
                        hiddenField("user_id", member.user_id),
                        reasonField,
                      ]}
                      button={
                        member.member_status === "active"
                          ? "Suspend access"
                          : "Reactivate access"
                      }
                    />
                    {member.manager_role && (
                      <p className="field-help">
                        This manager appointment is separate from the working
                        role. Suspension blocks all access; the owner can remove
                        appointments below.
                      </p>
                    )}
                  </details>
                )}
            </article>
          ))}
        </section>
        {access.isOwner && (
          <section className="panel inventory-form-panel">
            <h2>Manager appointments</h2>
            <BusinessForm
              organizationId={organizationId}
              intent="appoint_manager"
              button="Appoint manager"
              fields={[
                hiddenField("return_to", "team"),
                {
                  name: "user_id",
                  label: "Active team member",
                  options: directory.data
                    .filter((m) => m.member_status === "active" && m.email)
                    .map((m) => ({ value: m.user_id, label: m.email! })),
                },
                {
                  name: "manager_role",
                  label: "Manager role",
                  options: [
                    {
                      value: "operations_manager",
                      label: "Operations Manager",
                    },
                  ],
                },
              ]}
            />
            <p className="field-help">
              Operations Managers approve any value. Nobody can approve their
              own submission. Only an Operations Manager can reopen a closed
              period.
            </p>
            {directory.data
              .filter((m) => m.manager_role)
              .map((m) => (
                <details className="inventory-details" key={m.user_id}>
                  <summary>Remove {m.email}’s manager appointment</summary>
                  <BusinessForm
                    organizationId={organizationId}
                    intent="remove_manager"
                    fields={[
                      hiddenField("return_to", "team"),
                      hiddenField("user_id", m.user_id),
                      reasonField,
                    ]}
                    button="Remove appointment"
                  />
                </details>
              ))}
          </section>
        )}
        <section className="panel">
          <h2>Invitations</h2>
          {invitations.data.length === 0 && (
            <p className="inventory-empty">No invitations yet.</p>
          )}
          {invitations.data.map((inv) => (
            <article className="inventory-document" key={inv.id}>
              <h3>{inv.recipient_email}</h3>
              <p>
                {roleLabels[inv.proposed_role]} · {inv.status} · expires{" "}
                {new Date(inv.expires_at).toLocaleDateString("en-GB", {
                  timeZone: "Africa/Lagos",
                })}
              </p>
              {["pending", "expired"].includes(inv.status) && (
                <details className="inventory-details">
                  <summary>Replace or revoke access code</summary>
                  <BusinessForm
                    organizationId={organizationId}
                    intent="replace_invitation"
                    fields={[hiddenField("id", inv.id)]}
                    button="Replace access code"
                    help="Replaces any previous code; no email will be sent."
                  />
                  <BusinessForm
                    organizationId={organizationId}
                    intent="revoke_invitation"
                    fields={[hiddenField("id", inv.id), reasonField]}
                    button="Revoke invitation"
                  />
                </details>
              )}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
