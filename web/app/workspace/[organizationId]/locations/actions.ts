"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { isUuid } from "@/lib/auth/validation";
import { runDatabaseCommand } from "@/lib/database-contract";
import { canManageLocations, type LocationFormState } from "@/lib/locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function saveLocation(
  organizationId: string,
  locationId: string | null,
  _state: LocationFormState,
  form: FormData,
): Promise<LocationFormState> {
  const { membership } = await requireMembership(organizationId);
  if (!canManageLocations(membership.role))
    return { error: "Only business owners and admins can manage locations." };

  const rawName = form.get("name");
  const rawCode = form.get("code");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  const requestId = form.get("request_id");
  const status = form.get("status");
  if (!name || name.length > 160)
    return { error: "Enter a location name of 1–160 characters." };
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code))
    return {
      error:
        "Use a code of 1–32 letters, numbers, hyphens, or underscores, starting with a letter or number.",
    };
  if (!isUuid(requestId) || (locationId !== null && !isUuid(locationId)))
    return { error: "Reload this form and try again." };
  if (locationId !== null && status !== "active" && status !== "inactive")
    return { error: "Choose an active or inactive status." };

  const supabase = await createSupabaseServerClient();
  try {
    if (locationId === null) {
      await runDatabaseCommand(
        supabase,
        "create_location",
        organizationId,
        { code, name },
        requestId,
      );
    } else {
      await runDatabaseCommand(
        supabase,
        "update_location",
        organizationId,
        { id: locationId, code, name, is_active: status === "active" },
        requestId,
      );
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23505")
      return {
        error:
          "That location code is already in use in this business. Choose another code, or edit the existing location.",
      };
    if (code === "42501")
      return {
        error:
          "Your access has changed. Reload the page to check your permissions.",
      };
    if (code === "22023")
      return {
        error: "This form could not be applied. Reload the page and try again.",
      };
    return {
      error:
        "We could not confirm the save. Retry with the same details; repeated submissions will not create a second location.",
    };
  }
  const base = `/workspace/${organizationId}`;
  revalidatePath(base);
  revalidatePath(`${base}/locations`);
  if (locationId) revalidatePath(`${base}/locations/${locationId}/edit`);
  redirect(`${base}/locations?saved=${locationId ? "updated" : "created"}`);
}
