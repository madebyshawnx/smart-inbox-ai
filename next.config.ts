import type { NextConfig } from "next";

// Validate environment variables once, at config load (build/boot). Importing
// this for its side effect makes a missing ANTHROPIC_API_KEY fail fast with a
// clear message instead of surfacing as a runtime error later. A relative path
// is used because the `@/` alias is not resolved when Next loads this config.
import "./src/lib/env";

// Baseline security headers applied to every response. These are the low-risk,
// high-value ones for an app that handles a user's email; a full CSP is a
// production follow-up (it needs per-route nonce work with Next).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
