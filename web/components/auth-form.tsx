"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Arrow } from "./brand";
import type { FormState } from "@/lib/auth/form-state";
import {
  signIn,
  signUp,
  requestPasswordReset,
  resendConfirmation,
  updatePassword,
} from "@/app/auth/actions";

type Mode =
  "sign-in" | "sign-up" | "forgot-password" | "resend" | "update-password";
const actions = {
  "sign-in": signIn,
  "sign-up": signUp,
  "forgot-password": requestPasswordReset,
  resend: resendConfirmation,
  "update-password": updatePassword,
};
const labels: Record<Mode, string> = {
  "sign-in": "Sign in",
  "sign-up": "Create your account",
  "forgot-password": "Send reset link",
  resend: "Send confirmation link",
  "update-password": "Save new password",
};

export function AuthForm({ mode }: { mode: Mode }) {
  const [state, action, pending] = useActionState(
    actions[mode],
    {} as FormState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.message) feedback.current?.focus();
  }, [state]);
  const hasPassword = ["sign-in", "sign-up", "update-password"].includes(mode);
  const newPassword = ["sign-up", "update-password"].includes(mode);
  return (
    <form action={action} className="stack-form" aria-busy={pending}>
      {(state.error || state.message) && (
        <div
          ref={feedback}
          tabIndex={-1}
          className={`notice ${state.error ? "notice-error" : "notice-success"}`}
          role={state.error ? "alert" : "status"}
        >
          {state.error || state.message}
        </div>
      )}
      {mode !== "update-password" && (
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            defaultValue={state.email}
            placeholder="you@yourrestaurant.com"
            required
            disabled={pending}
          />
        </div>
      )}
      {hasPassword && (
        <div className="field">
          <div className="label-row">
            <label htmlFor="password">
              {newPassword ? "New password" : "Password"}
            </label>
            {mode === "sign-in" && (
              <Link href="/forgot-password">Forgot password?</Link>
            )}
          </div>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={newPassword ? "new-password" : "current-password"}
              minLength={newPassword ? 12 : 1}
              maxLength={128}
              aria-describedby={newPassword ? "password-help" : undefined}
              required
              disabled={pending}
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {newPassword && (
            <p className="field-help" id="password-help">
              Use 12–128 characters. A unique passphrase works well.
            </p>
          )}
        </div>
      )}
      {newPassword && (
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            name="confirm_password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            disabled={pending}
          />
        </div>
      )}
      <button
        className="button button-primary button-full"
        type="submit"
        disabled={pending}
      >
        {pending ? "Please wait…" : labels[mode]}
        {pending ? <span className="spinner" /> : <Arrow />}
      </button>
      {mode === "sign-in" && (
        <p className="form-switch">
          New to ProfitPlate? <Link href="/sign-up">Create an account</Link>
        </p>
      )}
      {mode === "sign-up" && (
        <p className="form-switch">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      )}
      {["forgot-password", "resend"].includes(mode) && (
        <p className="form-switch">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      )}
    </form>
  );
}
