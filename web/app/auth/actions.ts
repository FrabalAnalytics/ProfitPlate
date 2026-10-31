"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applicationOrigin } from "@/lib/auth/origin";
import { emailFrom, passwordFrom } from "@/lib/auth/validation";
import { requireUser } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/form-state";
import { isAuthRateLimit } from "@/lib/auth/service-status";
import { clearAuthCookies } from "@/lib/auth/clear-cookies";
import { authClockStatus } from "@/lib/auth/clock";

export async function signIn(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const email = emailFrom(form.get("email"));
  const password = passwordFrom(form.get("password"), false);
  if (!email || !password)
    return {
      error: "Enter a valid email address and your password.",
      email: email || "",
    };
  const supabase = await createSupabaseServerClient();
  if ((await authClockStatus()) === "skew")
    return {
      error:
        "The computer running ProfitPlate has an incorrect clock. Synchronize Windows date and time before signing in.",
      email,
    };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Confirm your email before signing in. You can request a new link below."
          : isAuthRateLimit(error)
            ? "The account service is temporarily limiting requests. Wait a few minutes before trying again."
            : error.status === 0 || (error.status && error.status >= 500)
              ? "We could not reach the account service. Please try again shortly."
              : "We could not sign you in. Check your email and password, then try again.",
      email,
    };
  redirect("/workspace");
}

export async function signUp(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const email = emailFrom(form.get("email"));
  const password = passwordFrom(form.get("password"), true);
  if (!email || !password)
    return {
      error: "Enter a valid email and a password of 12–128 characters.",
      email: email || "",
    };
  if (form.get("confirm_password") !== password)
    return { error: "Your passwords do not match.", email };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${applicationOrigin()}/auth/callback` },
  });
  if (error)
    return {
      error:
        error.status === 429
          ? "Please wait before requesting another email."
          : "We could not complete sign-up. Please try again shortly.",
      email,
    };
  redirect("/check-email");
}

export async function requestPasswordReset(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const email = emailFrom(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${applicationOrigin()}/auth/callback`,
  });
  if (error)
    return {
      error:
        "We could not send a reset link. Please wait a little and try again.",
      email,
    };
  return {
    message:
      "If an account exists for this address, a password reset link is on its way.",
    email,
  };
}

export async function resendConfirmation(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const email = emailFrom(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${applicationOrigin()}/auth/callback` },
  });
  if (error)
    return {
      error:
        "Please wait a little before requesting another confirmation email.",
      email,
    };
  return {
    message: "If your account needs confirmation, a new link is on its way.",
    email,
  };
}

export async function updatePassword(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const store = await cookies();
  // A short-lived, server-only marker is set only after a successful recovery callback.
  if (store.get("pp-password-recovery")?.value !== user.id)
    return { error: "Open a new password reset link to continue." };
  const password = passwordFrom(form.get("password"), true);
  if (!password) return { error: "Choose a password of 12–128 characters." };
  if (form.get("confirm_password") !== password)
    return { error: "Your passwords do not match." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error)
    return {
      error:
        "We could not update your password. Request a fresh reset link and try again.",
    };
  store.delete("pp-password-recovery");
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError && !isAuthRateLimit(signOutError))
    return {
      error:
        "Your password changed, but sign-out failed. Please sign out before continuing.",
    };
  await clearAuthCookies();
  redirect("/sign-in?password=updated");
}

export async function signOut(): Promise<void> {
  if ((await authClockStatus()) === "skew") {
    await clearAuthCookies();
    redirect("/auth/unavailable?reason=clock");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  // The installed Auth SDK clears the local session even if remote revocation is rate limited.
  if (error && !isAuthRateLimit(error))
    throw new Error("We could not sign you out. Please try again.");
  await clearAuthCookies();
  redirect("/sign-in");
}

export async function startFreshSignIn(): Promise<void> {
  await clearAuthCookies();
  redirect("/sign-in");
}
