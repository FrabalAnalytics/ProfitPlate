export const salesRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const salesText = (value: unknown) =>
  typeof value === "string" ? value : "Unavailable";
