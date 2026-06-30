# Deploying Smart Inbox AI

This takes the app from "runs on localhost" to a real public URL on Vercel.
SQLite can't run on Vercel (serverless, ephemeral filesystem), so production uses
**Postgres**. The recommended path uses Postgres for local dev too (dev/prod
parity), so there's one database engine everywhere.

> Single-user for now. Multi-user auth is a later step — until then, whoever has
> the URL sees the one connected inbox. Keep the deployment private (Vercel
> password protection or don't share the URL).

---

## What's already done (in code)

- `build` runs `prisma generate && next build`; `postinstall` regenerates the
  Prisma client (Vercel needs both).
- Env validation (`src/lib/env.ts`) fails the build fast if `ANTHROPIC_API_KEY`
  is missing.
- Security headers, token encryption, OAuth state cookie `secure` flag (flips on
  in production), token revocation on disconnect, and a delete-my-data endpoint
  are all in place.

## What's left (the steps below)

1. You: create a Postgres database (Neon — free, ~2 min).
2. Me: switch Prisma to Postgres and generate the Postgres migration against it.
3. You: create the Vercel project + set env vars (~5 min).
4. You: add the production redirect URI in Google Cloud.
5. Deploy + verify.

---

## Step 1 — Create a Postgres database (you, ~2 min)

1. Go to https://neon.tech → sign up (free tier is plenty).
2. Create a project (any name, e.g. `smart-inbox`).
3. Copy the **connection string** — it looks like
   `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`.
4. Neon gives a **pooled** and a **direct** connection string. Use the **pooled**
   one for the app (`SMART_INBOX_DATABASE_URL`); keep the direct one handy for
   running migrations.

Paste the connection string back here and I'll do Step 2.

## Step 2 — Switch Prisma to Postgres (me, once you provide the URL)

I will:
- Change `prisma/schema.prisma` datasource `provider` from `sqlite` to
  `postgresql`.
- Delete the SQLite-dialect migrations and generate a fresh initial Postgres
  migration against your Neon DB (`prisma migrate dev`).
- Verify the app + all tests still pass against Postgres locally.

After this your **local** dev also uses Neon (your old SQLite `dev.db` data —
~4 emails + rules — won't carry over; just re-sync after).

## Step 3 — Create the Vercel project (you, ~5 min)

1. Go to https://vercel.com → New Project → import `madebyshawnx/smart-inbox-ai`.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default
   (our `build` script handles Prisma).
3. Under **Environment Variables**, add (Production + Preview):
   - `ANTHROPIC_API_KEY` — your key
   - `SMART_INBOX_DATABASE_URL` — the Neon **pooled** connection string
   - `ENCRYPTION_KEY` — generate a NEW one for prod:
     `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — your existing values
   - `GOOGLE_REDIRECT_URI` — `https://YOUR-APP.vercel.app/api/auth/google/callback`
     (you'll know `YOUR-APP` after the first deploy; update it then redeploy)
   - `CLASSIFICATION_MODEL` — optional (defaults to claude-haiku-4-5)
4. Deploy. Note the assigned domain (e.g. `smart-inbox-xyz.vercel.app`).

## Step 4 — Update Google Cloud for the prod domain (you, ~2 min)

In Google Cloud Console → APIs & Services → Credentials → your OAuth client:
- **Authorized redirect URIs → Add**:
  `https://YOUR-APP.vercel.app/api/auth/google/callback`
- (Keep the localhost one too, for local dev.)
- Make sure `GOOGLE_REDIRECT_URI` in Vercel matches this exactly, then redeploy.

## Step 5 — Deploy & verify

1. Open `https://YOUR-APP.vercel.app`.
2. Connect Gmail (same Testing-mode consent flow), Sync, confirm triage works.
3. Test "Delete all my data" and Disconnect.

---

## Known limits at this stage

- **Single-user.** No login; the app holds one connected account. Don't share the
  URL publicly. Multi-user auth (Auth.js) is the next milestone.
- **Google Testing mode.** `gmail.readonly` is a restricted scope; until the app
  passes Google's verification + CASA security assessment, only added test users
  can connect and refresh tokens expire every 7 days. Fine for you; required
  before opening to real users. See `docs/production-roadmap.md`.
- **Gmail sync is polling** (manual "Sync"). Push via Pub/Sub webhooks is a later
  optimization.
