"use client";
import { useActionState, useEffect, useRef } from "react";
import { createOrganization } from "@/app/setup/actions";
import { Arrow } from "./brand";
import type { FormState } from "@/lib/auth/form-state";

export function OrganizationForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(
    createOrganization,
    {} as FormState,
  );
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <form className="stack-form" action={action} aria-busy={pending}>
      <input name="request_id" type="hidden" value={requestId} />
      {state.error && (
        <div
          ref={error}
          tabIndex={-1}
          className="notice notice-error"
          role="alert"
        >
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="business-name">Business name</label>
        <input
          id="business-name"
          name="name"
          maxLength={160}
          autoComplete="organization"
          placeholder="e.g. Heritage Kitchen"
          defaultValue={state.name}
          required
          disabled={pending}
        />
        <p className="field-help">
          The name your team will see across your workspace.
        </p>
      </div>
      <div className="defaults-panel">
        <div>
          <span>Currency</span>
          <strong>NGN · Nigerian naira</strong>
        </div>
        <div>
          <span>Business time zone</span>
          <strong>Africa/Lagos</strong>
        </div>
        <p>These are the default settings for this version of ProfitPlate.</p>
      </div>
      <button
        className="button button-primary button-full"
        type="submit"
        disabled={pending}
      >
        {pending ? "Creating your workspace…" : "Create workspace"}
        {pending ? <span className="spinner" /> : <Arrow />}
      </button>
    </form>
  );
}
