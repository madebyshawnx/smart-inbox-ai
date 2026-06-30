import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Type-safe, validated environment access.
 *
 * This module is the single startup-validation surface: it is imported at the
 * top of `next.config.ts`, so the schema below runs once when Next loads its
 * config at build/boot. A missing `ANTHROPIC_API_KEY` then fails fast with a
 * clear message instead of surfacing as a runtime auth error.
 *
 * Only `ANTHROPIC_API_KEY` is required — Gmail OAuth and `ENCRYPTION_KEY` are
 * optional so the app still boots for the sample-classification flow without
 * Gmail configured. Modules under `src/lib/google/*`, `crypto.ts`, and the
 * Anthropic client deliberately read `process.env.X` directly today; they can
 * migrate to `env.X` later without changing this validation surface.
 */
export const env = createEnv({
  server: {
    ANTHROPIC_API_KEY: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    ENCRYPTION_KEY: z.string().optional(),
    SMART_INBOX_DATABASE_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),
  },
  runtimeEnv: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    SMART_INBOX_DATABASE_URL: process.env.SMART_INBOX_DATABASE_URL,
    CRON_SECRET: process.env.CRON_SECRET,
  },
  // Vitest sets NODE_ENV=test; skipping validation there keeps importing this
  // module (transitively, via next.config or app code) from throwing in tests.
  skipValidation: process.env.NODE_ENV === "test" || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
