import "server-only";
import { cache } from "react";
import { requireMembership, requireUser } from "./auth/session";
import { createSupabaseServerClient } from "./supabase/server";
export const workspaceRole = cache(async (organizationId: string) => {
  const { membership } = await requireMembership(organizationId);
  const user = await requireUser();
  const db = await createSupabaseServerClient();
  const [manager, areas, duties] = await Promise.all([
    db
      .from("operational_managers")
      .select("manager_role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("operating_areas")
      .select("area,location_id")
      .eq("organization_id", organizationId),
    db
      .from("additional_role_assignments")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id),
  ]);
  if (manager.error || areas.error || duties.error)
    throw new Error("We could not load your operating permissions.");
  const isManager = Boolean(manager.data);
  const role = manager.data?.manager_role ?? membership.role;
  const roles = [membership.role, ...duties.data.map((d) => d.role)];
  const canStock = roles.includes("inventory_manager") || isManager;
  const canPurchase = roles.includes("procurement_officer");
  const canFinance =
    roles.some((r) => ["owner", "accountant"].includes(r)) || isManager;
  const area =
    !canStock && membership.role === "kitchen_lead"
      ? "kitchen"
      : !canStock && membership.role === "bar_lead"
        ? "bar"
        : undefined;
  return {
    role,
    primaryRole: membership.role,
    isManager,
    isOwner: membership.role === "owner",
    canTeam: ["owner", "admin"].includes(membership.role),
    canStock,
    canPurchase,
    canFinance,
    roles,
    canReports:
      canFinance ||
      canStock ||
      roles.some((r) =>
        ["procurement_officer", "kitchen_lead", "bar_lead", "viewer"].includes(
          r,
        ),
      ),
    canReadVendors: canPurchase || canStock || canFinance,
    departmentLocation: areas.data.find((a) => a.area === area)?.location_id,
    areas: areas.data,
    userId: user.id,
  };
});
