import "server-only";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase/config";

// Clear only this project's session/PKCE cookies, including chunked values.
// This also covers a sign-out that failed before the SDK could remove an expired session.
export async function clearAuthCookies() {
  const store = await cookies();
  const prefix = `sb-${new URL(supabaseConfig().url).hostname.split(".")[0]}-auth-token`;
  const names = [prefix, `${prefix}-code-verifier`, `${prefix}-user`];
  for (const cookie of store.getAll()) {
    if (
      names.some(
        (name) => cookie.name === name || cookie.name.startsWith(`${name}.`),
      )
    )
      store.delete(cookie.name);
  }
  store.delete("pp-password-recovery");
}
