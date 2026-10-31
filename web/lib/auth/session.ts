import "server-only";
import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "./validation";
import { isAuthRateLimit } from "./service-status";
import { authClockStatus } from "./clock";

export const currentUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if ((await authClockStatus()) === "skew")
    redirect("/auth/unavailable?reason=clock");
  // Use the session solely for token transport. Its embedded user is never trusted.
  const { data: session, error: sessionError } =
    await supabase.auth.getSession();
  if (isAuthRateLimit(sessionError))
    redirect("/auth/unavailable?reason=rate-limit");
  if (
    sessionError &&
    (sessionError.status === 0 ||
      (sessionError.status && sessionError.status >= 500))
  )
    redirect("/auth/unavailable?reason=connection");
  if (!session.session) return null;
  // PostgREST verifies signature/expiry and the RPC selects only auth.uid()'s live account.
  const { data, error, status } = await supabase
    .rpc("current_account")
    .maybeSingle();
  if (status === 429) redirect("/auth/unavailable?reason=rate-limit");
  if (error) {
    if ([401, 403].includes(status)) return null;
    redirect("/auth/unavailable?reason=connection");
  }
  return data;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!user.email_confirmed_at) redirect("/check-email");
  return user;
}

export const activeMemberships = cache(async () => {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("id, organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at");
  if (error)
    throw new Error(
      "We could not load your business access. Please try again.",
    );
  return data;
});

export const requireMembership = cache(async (organizationId: string) => {
  await requireUser();
  if (!isUuid(organizationId)) notFound();
  const memberships = await activeMemberships();
  const membership = memberships.find(
    (value) => value.organization_id === organizationId,
  );
  if (!membership) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id, name, currency_code, timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error)
    throw new Error("We could not load your business. Please try again.");
  if (!organization) notFound();
  return { membership, organization, memberships };
});
