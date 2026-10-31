"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activeMemberships, requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/auth/validation";
import { runDatabaseCommand } from "@/lib/database-contract";
import type { FormState } from "@/lib/auth/form-state";

export async function createOrganization(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  await requireUser();
  const existing = await activeMemberships();
  const owner = existing.find((membership) => membership.role === "owner");
  if (owner) redirect(`/workspace/${owner.organization_id}`);
  const rawName = form.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const requestId = form.get("request_id");
  if (!name || name.length > 160 || !isUuid(requestId))
    return { error: "Enter a business name of 1–160 characters.", name };
  const supabase = await createSupabaseServerClient();
  let organizationId: string;
  try {
    organizationId = (
      await runDatabaseCommand(supabase, "bootstrap", null, { name }, requestId)
    ).organization_id;
  } catch {
    return {
      error:
        "We could not finish setup. Try again; your existing business will be preserved.",
      name,
    };
  }
  redirect(`/workspace/${organizationId}`);
}
