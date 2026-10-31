import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import type { Database } from "@/lib/database.types";
import { supabaseConfig } from "./config";

export const createSupabaseServerClient = cache(async () => {
  // Auth libraries read time/randomness internally; never execute them in a prefetched static shell.
  await connection();
  const store = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient<Database>(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. Proxy handles refresh before rendering.
        }
      },
    },
  });
});
