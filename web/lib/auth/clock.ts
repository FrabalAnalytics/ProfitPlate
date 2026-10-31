import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseConfig } from "@/lib/supabase/config";

type ClockSample = { serverTime: number; monotonicTime: number };
let sample: ClockSample | null = null;
let checkedAt = -Infinity;
let pending: Promise<void> | null = null;

// Shared clock metadata only. No identity, session, token, or permission is cached.
export async function authClockStatus(): Promise<"ok" | "skew" | "unknown"> {
  const cacheMs = process.env.PROFITPLATE_BROWSER_TEST === "1" ? 0 : 30_000;
  if (performance.now() - checkedAt >= cacheMs) {
    pending ??= (async () => {
      const { url, key } = supabaseConfig();
      const probe = new URL("/auth/v1/settings", url);
      probe.searchParams.set("clock_probe", randomUUID());
      const start = performance.now();
      try {
        const response = await fetch(probe, {
          headers: { apikey: key, "Cache-Control": "no-cache" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });
        const serverTime = Date.parse(response.headers.get("date") || "");
        sample =
          response.ok && Number.isFinite(serverTime)
            ? { serverTime, monotonicTime: (start + performance.now()) / 2 }
            : null;
        await response.body?.cancel();
      } catch {
        sample = null;
      }
      checkedAt = performance.now();
    })();
    try {
      await pending;
    } finally {
      pending = null;
    }
  }
  if (!sample) return "unknown";
  const serverNow =
    sample.serverTime + performance.now() - sample.monotonicTime;
  return Math.abs(Date.now() - serverNow) > 120_000 ? "skew" : "ok";
}
