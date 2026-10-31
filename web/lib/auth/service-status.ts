export function isAuthRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    ("status" in error && error.status === 429) ||
    ("code" in error &&
      ["over_request_rate_limit", "over_email_send_rate_limit"].includes(
        String(error.code),
      ))
  );
}
