"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { acceptBusinessInvitation } from "@/app/join/actions";
export function JoinBusinessForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(
    acceptBusinessInvitation,
    {} as { error?: string },
  );
  const [code, setCode] = useState("");
  const id = useId();
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <form className="stack-form" action={action} aria-busy={pending}>
      <input name="request_id" type="hidden" value={requestId} />
      {state.error && (
        <div
          className="notice notice-error"
          role="alert"
          ref={error}
          tabIndex={-1}
        >
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor={id}>Business access code</label>
        <input
          id={id}
          name="code"
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          maxLength={160}
          autoComplete="off"
          required
          readOnly={pending}
        />
        <p className="field-help">
          Paste the full code from your administrator. It is sent securely in
          this form, not in a page address.
        </p>
      </div>
      <button className="button button-primary" disabled={pending}>
        {pending ? "Joining…" : "Join business"}
      </button>
    </form>
  );
}
