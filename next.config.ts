import type { NextConfig } from "next";

// Validate environment variables once, at config load (build/boot). Importing
// this for its side effect makes a missing ANTHROPIC_API_KEY fail fast with a
// clear message instead of surfacing as a runtime error later. A relative path
// is used because the `@/` alias is not resolved when Next loads this config.
import "./src/lib/env";

// Content-Security-Policy shipped in REPORT-ONLY mode first: it surfaces
// violations (so we can tighten the policy against real traffic) without risking
// a broken app. `'unsafe-inline'`/`'unsafe-eval'` on script-src are a concession
// to Next.js's inline runtime bootstrap; a nonce-based enforcing CSP is the
// production follow-up once the report stream is clean.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
]
  .join("; ")
  .concat(";");

// Baseline security headers applied to every response. These are the low-risk,
// high-value ones for an app that handles a user's email, plus a report-only CSP
// so we can graduate to an enforcing policy once violations are understood.
const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
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
