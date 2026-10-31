import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: process.env.PROFITPLATE_EXTERNAL_TEST_SERVERS === "1" ? undefined : [
    {
      command: "node scripts/auth-test-server.mjs",
      url: "http://127.0.0.1:54329/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/sign-in",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PROFITPLATE_BROWSER_TEST: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-test-public-key",
        APP_URL: "http://127.0.0.1:3100",
      },
    },
  ],
});
