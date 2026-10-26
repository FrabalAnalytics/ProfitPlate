import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(projectRoot, true, { info() {}, error() {} });

async function checkConnection() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("YOUR_PROJECT_REF") || key.includes("YOUR_SUPABASE_ANON_KEY")) {
    throw new Error("Replace the URL and anon key placeholders in .env.local first.");
  }
  if (key.startsWith("sb_secret_")) {
    throw new Error("Use a public anon or publishable key, not a secret key.");
  }
  if (key.split(".").length === 3) {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    if (payload.role === "service_role") {
      throw new Error("Use a public anon key, not a service-role key.");
    }
  }

  // Load the same client module used by the app; no session or data is changed.
  const clientPath = pathToFileURL(path.join(projectRoot, "lib", "supabaseClient.js"));
  const { supabase } = await import(clientPath.href);
  if (!supabase) throw new Error("The Supabase client export is missing.");
  console.log("PASS: App client initialized from .env.local.");

  const authResponse = await fetch(new URL("/auth/v1/settings", url), {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
  });
  console.log(`${authResponse.ok ? "PASS" : "FAIL"}: Auth API returned HTTP ${authResponse.status}.`);
  await authResponse.body?.cancel();

  // The OpenAPI root may require an admin key, so it is not a public-client test.
  // Probe an intentionally nonexistent table through the app's actual SDK client.
  // A PostgREST missing-table error proves the request reached the Data API.
  const { error, status } = await supabase
    .from("__profitplate_connection_probe__")
    .select("*")
    .limit(0)
    .abortSignal(AbortSignal.timeout(15000));

  const dataReached = !error || error.code === "PGRST205" || error.code === "42P01";
  if (dataReached) {
    console.log("PASS: App client reached the Data API using the configured public key.");
    if (error) console.log("INFO: The probe table is intentionally absent; its missing-table response confirms connectivity.");
  } else {
    console.log(`FAIL: Data API returned HTTP ${status}.`);
    if (typeof error.code === "string" && /^[A-Za-z0-9_]+$/.test(error.code)) {
      console.log(`Data API error code: ${error.code}`);
    }
    const safeReason = String(error.message).split(key).join("[REDACTED]")
      .replace(/eyJ[A-Za-z0-9_.-]+/g, "[REDACTED]")
      .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED]");
    console.log(`Data API reason: ${safeReason.slice(0, 300)}`);
  }

  if (!authResponse.ok || !dataReached) {
    console.log("Check the reported error before changing credentials or API permissions.");
    process.exitCode = 1;
    return;
  }
  console.log("Connection check passed. No table rows were read or written.");
  console.log("This checks the app client from local Node, not browser requests, login, or real-table permissions.");
}

checkConnection().catch((error) => {
  if (error.cause?.code || error.name === "TimeoutError" || error.message === "fetch failed") {
    console.error("FAIL: Network request failed (" + (error.cause?.code || error.name) + "). Check your internet, VPN, firewall, and project URL.");
  } else if (error instanceof SyntaxError) {
    console.error("FAIL: Could not parse the client module or API key configuration.");
  } else {
    console.error("FAIL:", error.message);
  }
  process.exitCode = 1;
});
