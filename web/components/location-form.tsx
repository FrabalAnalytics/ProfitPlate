"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { saveLocation } from "@/app/workspace/[organizationId]/locations/actions";
import type { LocationFormState } from "@/lib/locations";

// getRandomValues also works on the phone's local HTTP preview origin.
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function LocationForm({
  organizationId,
  requestId,
  location,
}: {
  organizationId: string;
  requestId: string;
  location?: { id: string; name: string; code: string; is_active: boolean };
}) {
  const [state, action, pending] = useActionState(
    saveLocation.bind(null, organizationId, location?.id ?? null),
    {} as LocationFormState,
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [status, setStatus] = useState(
    location?.is_active === false ? "inactive" : "active",
  );
  // Retain the request key for an unchanged retry, even after an uncertain response.
  const request = useRef({ fingerprint: "", id: requestId });
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);
  return (
    <form
      className="stack-form location-form"
      action={action}
      aria-busy={pending}
      onSubmit={(event) => {
        const form = event.currentTarget;
        const data = new FormData(form);
        const fingerprint = JSON.stringify([
          String(data.get("name") ?? "").trim(),
          String(data.get("code") ?? "")
            .trim()
            .toUpperCase(),
          data.get("status"),
        ]);
        if (
          request.current.fingerprint &&
          request.current.fingerprint !== fingerprint
        )
          request.current.id = newRequestId();
        request.current.fingerprint = fingerprint;
        (form.elements.namedItem("request_id") as HTMLInputElement).value =
          request.current.id;
      }}
    >
      <input type="hidden" name="request_id" defaultValue={requestId} />
      {state.error && (
        <div
          className="notice notice-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${formId}-name`}>Location name</label>
        <input
          id={`${formId}-name`}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={160}
          placeholder="e.g. Main Kitchen"
          aria-describedby={`${formId}-name-help`}
          readOnly={pending}
        />
        <p id={`${formId}-name-help`} className="field-help">
          A branch, kitchen, bar, or storeroom your team works with.
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${formId}-code`}>Location code</label>
        <input
          id={`${formId}-code`}
          name="code"
          className="location-code-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"
          placeholder="e.g. MAIN-KITCHEN"
          aria-describedby={`${formId}-code-help`}
          autoCapitalize="characters"
          spellCheck={false}
          readOnly={pending}
        />
        <p id={`${formId}-code-help`} className="field-help">
          A unique short code for this business. Use letters, numbers, hyphens,
          or underscores. Saved in uppercase.
        </p>
      </div>
      {location && (
        <div className="field">
          <label htmlFor={`${formId}-status`}>Status</label>
          <select
            id={`${formId}-status`}
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-describedby={`${formId}-status-help`}
            disabled={pending}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <p id={`${formId}-status-help`} className="field-help">
            Deactivate a location when it is no longer in use. Its saved details
            remain, and you can reactivate it here.
          </p>
        </div>
      )}
      <div className="location-form-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={pending}
        >
          {pending ? "Saving…" : location ? "Save changes" : "Add location"}
        </button>
        <Link
          className="button button-secondary"
          href={`/workspace/${organizationId}/locations`}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
