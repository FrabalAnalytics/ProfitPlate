"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runDatabaseCommand } from "@/lib/database-contract";
export async function acceptBusinessInvitation(
  _state: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  await requireUser();
  const raw = form.get("code");
  const requestId = form.get("request_id");
  const parts = typeof raw === "string" ? raw.trim().split(".") : [];
  if (
    parts.length !== 3 ||
    !isUuid(parts[0]) ||
    !isUuid(parts[1]) ||
    !/^[0-9a-f]{64}$/.test(parts[2]) ||
    !isUuid(requestId)
  )
    return {
      error:
        "Enter the full access code supplied by your business administrator.",
    };
  const db = await createSupabaseServerClient();
  try {
    await runDatabaseCommand(
      db,
      "accept_invitation",
      parts[0],
      { id: parts[1], token: parts[2] },
      requestId,
    );
  } catch {
    return {
      error:
        "This invitation cannot be accepted. Use the invited, verified email account and check that the code is current.",
    };
  }
  redirect(`/workspace/${parts[0]}`);
}
