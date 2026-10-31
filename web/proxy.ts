import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { isAuthRateLimit } from "@/lib/auth/service-status";
import { authClockStatus } from "@/lib/auth/clock";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const finish = (result: NextResponse) => {
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Referrer-Policy", "same-origin");
    return result;
  };
  const statusRedirect = (reason: "clock" | "rate-limit") => {
    const destination = new URL(request.url);
    // Next normalizes loopback URLs to localhost. Preserve a validated numeric loopback host
    // in development so a redirect cannot strand cookies on a different browser origin.
    if (process.env.NODE_ENV === "development") {
      try {
        const incoming = new URL(`http://${request.headers.get("host")}`);
        if (
          ["127.0.0.1", "[::1]"].includes(incoming.hostname) &&
          !incoming.username &&
          !incoming.password &&
          incoming.port === destination.port
        )
          destination.host = incoming.host;
      } catch {
        /* Keep the framework-provided origin. */
      }
    }
    destination.pathname = "/auth/unavailable";
    destination.search = `?reason=${reason}`;
    const result = NextResponse.redirect(destination);
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    return finish(result);
  };
  // Actions authorize themselves. The service-status page must remain reachable during outages.
  if (
    request.method !== "GET" ||
    request.nextUrl.pathname === "/auth/unavailable" ||
    request.nextUrl.pathname === "/auth/callback"
  )
    return finish(response);
  if ((await authClockStatus()) === "skew") return statusRedirect("clock");
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  // Token transport/refresh only: never trust session.user or authorize from this result.
  // Protected reads use a JWT-verified own-account RPC plus current database membership.
  const { error } = await supabase.auth.getSession();
  if (isAuthRateLimit(error)) {
    return statusRedirect("rate-limit");
  }
  return finish(response);
}

export const config = {
  matcher: [
    "/((?!_next/|__nextjs|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
