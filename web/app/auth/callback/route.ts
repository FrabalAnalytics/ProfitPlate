import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authDestination } from "@/lib/auth/validation";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const destination = authDestination(request.nextUrl.searchParams.get("next"));
  if (code && code.length <= 4096) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // The installed Auth client returns this PKCE hint at runtime, outside its public response type.
      const recovery =
        "redirectType" in data && data.redirectType === "recovery";
      if (recovery)
        (await cookies()).set("pp-password-recovery", data.user.id, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 600,
        });
      const location = recovery
        ? "/update-password"
        : destination === "/update-password"
          ? "/workspace"
          : destination;
      // Relative Location preserves the browser origin without trusting Host/Forwarded headers.
      const response = new NextResponse(null, {
        status: 303,
        headers: { Location: location },
      });
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
  }
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/auth/link-error",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
