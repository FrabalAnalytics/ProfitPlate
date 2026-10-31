export function emailFrom(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

export function passwordFrom(
  value: FormDataEntryValue | null,
  isNew: boolean,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    value.length < (isNew ? 12 : 1)
  )
    return null;
  return value;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

// Email callbacks may only navigate to these application-owned destinations.
export function authDestination(
  value: string | null,
): "/workspace" | "/update-password" {
  return value === "/update-password" ? "/update-password" : "/workspace";
}
