import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Exact addresses owned by this computer; no wildcard origins or CSRF exceptions.
const developmentOrigins = [
  ...new Set([
    "127.0.0.1",
    ...Object.values(networkInterfaces()).flatMap((addresses) =>
      (addresses ?? [])
        .filter((address) => address.family === "IPv4" && !address.internal)
        .map((address) => address.address),
    ),
  ]),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: developmentOrigins,
  // Browser QA must not contend with the developer's running app or build lock.
  distDir: process.env.PROFITPLATE_BROWSER_TEST === "1" ? ".next-e2e" : ".next",
  devIndicators: false,
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        // Keep component CSS Modules under Next's native scoped-CSS handling.
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
