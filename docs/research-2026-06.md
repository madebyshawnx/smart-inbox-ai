# Smart Inbox AI — Research & Recommendations (2026-06)

Scope: Next.js 16 (App Router, React 19), TS strict, Prisma 6 + SQLite, Tailwind v4, Biome 2, Zod 4, @anthropic-ai/sdk, google-auth-library (gmail.readonly), Vitest. Single-user, local-only today.

Owner bias: **fewer dependencies**. Items flagged OVERKILL below can be skipped until/unless multi-user.

---

## 1. Inbox UX patterns worth borrowing (kept minimal)

Difficulty = effort to add to *this* stack.

| # | Pattern | What it is | Effort |
|---|---------|-----------|--------|
| 1 | **Command palette (Cmd/Ctrl-K)** | One modal to run any action: compose, search, snooze, jump to bucket, change classification. The single biggest "premium feel" lever in Superhuman/Shortwave. | Easy (`cmdk`) |
| 2 | **j/k navigation + single-key actions** | `j`/`k` move selection, `e` = done/archive, `r` = reply, `/` = search, `g i` = go inbox. No mouse needed. | Easy (`react-hotkeys-hook` + a focus model) |
| 3 | **Split inbox / lanes** | Inbox divided into sections (Important, Other, Newsletters) — you already have priority buckets, so render them as collapsible lanes with counts. | Easy (UI only; data exists) |
| 4 | **Optimistic triage + Undo toast** | Archiving/triaging updates UI instantly; a toast ("Archived — Undo", 5s window) defers/rolls back the mutation. Makes the app feel instant and forgiving. | Medium (optimistic state + `sonner` action toast) |
| 5 | **Snooze / "remind me later"** | Move an email out of inbox until a chosen time. High perceived value; needs a `snoozedUntil` field + a poll/cron to resurface. | Medium (schema + scheduler) |
| 6 | **Read / unread / triaged states with visual weight** | Unread = bold + accent rail; triaged = muted. Hierarchy through weight/color, not just icons. Cheap, big polish payoff. | Easy (CSS/state) |
| 7 | **Inbox-zero / empty-state celebration** | When a lane hits zero, show an intentional empty state (not a blank div). Small dopamine hit that defines premium clients. | Easy |
| 8 | **Keyboard shortcut cheatsheet (`?`)** | Overlay listing shortcuts. Signals "this is a power tool" and aids discovery. | Easy |
| 9 | **Instant local search with highlight** | Filter the loaded list as you type (client-side first), highlight matches. Superhuman's perceived speed is mostly pre-loaded + instant filter. | Easy (client filter) |
| 10 | **Preview/peek without full open** | Two-pane already gives this; add hover prefetch of full body so the reading pane paints with zero spinner. | Medium (prefetch on hover) |

Sources: https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts · https://www.shortwave.com/docs/references/shortcuts/ · https://mobbin.com/explore/screens/e36ea7b5-114b-43ff-84d2-3b3e344bbc7d

**Highest leverage, lowest cost:** #1, #2, #4, #6. These four deliver ~80% of the "fast/premium" feel.

---

## 2. Recommended npm libraries (mapped to this stack)

| Need | Pick | Rationale / caution |
|------|------|--------------------|
| Command palette | **`cmdk`** | De-facto standard, what shadcn `<Command>` wraps. Works with Tailwind v4 + React 19. Caution: ships unstyled — style with your tokens, not stock shadcn look. |
| UI primitives | **Radix UI primitives directly** (copy shadcn components selectively) | shadcn is now Tailwind v4 + React 19 ready (forwardRef removed, `data-slot` styling). Don't add shadcn as a "dependency" — it's copy-in. Pull only the 4-5 primitives you need (Dialog, DropdownMenu, Tooltip, Popover). Caution: after Tailwind v4 upgrade some Radix overlays render transparent until you re-map theme vars — known issue. https://ui.shadcn.com/docs/tailwind-v4 · https://github.com/tailwindlabs/tailwindcss/discussions/17137 |
| Toasts | **`sonner`** | shadcn deprecated its own toast in favor of sonner. Tiny, supports action buttons (perfect for Undo toast pattern). Easy win. https://ui.shadcn.com/docs/changelog |
| Keyboard shortcuts | **`react-hotkeys-hook`** | Small, hook-based, scope support (disable shortcuts while typing in compose). Good fit for j/k + single-key model. |
| Client data fetching/caching | **None for now → SWR if needed.** **TanStack Query = OVERKILL** for single-user local SQLite. | App Router Server Components + server actions already give you fetching + revalidation. Add `swr` *only* if you build heavy client-side optimistic lists. Don't duplicate server state into a client cache yet. |
| Form/validation | **`react-hook-form` + `@hookform/resolvers` + Zod 4** | You already have Zod 4. RHF+zodResolver is the standard. Caution: only warranted once you have real forms (Smart Rule editor, settings). For a 2-field form, native `<form>` + server action is enough — **borderline overkill** until the rule editor lands. |
| Type-safe env vars | **`@t3-oss/env-nextjs`** | Validates env at build/boot with Zod (which you have). Cheap insurance against a missing `ANTHROPIC_API_KEY` / OAuth secret shipping broken. Recommended — low cost, real safety. |
| Date formatting | **`date-fns` v4** | Tree-shakeable, no moment-style baggage. Fine. Alternatively native `Intl.RelativeTimeFormat` for "2h ago" with **zero deps** — prefer this if your date needs are light. |
| Rate limiting | **`@upstash/ratelimit` — OVERKILL now** | Needs Upstash Redis. Single-user local app has no abuse surface. Defer until multi-user/public deploy; then revisit (or use a simpler in-memory/DB limiter first). |
| Error tracking | **`@sentry/nextjs` — defer (P2)** | Genuinely useful once real users exist, but heavy for local single-user. Add at the same time you go multi-user. For now, structured server logs (`pino`) cover you. |

**Strip list for a single-user app:** TanStack Query, Upstash ratelimit, Sentry, and (for now) react-hook-form. Keep: cmdk, sonner, react-hotkeys-hook, @t3-oss/env-nextjs, date-fns (or native Intl), a few copied Radix primitives.

---

## 3. Production-readiness checklist (P0 = blocker, P1 = before real users, P2 = later)

### Auth & multi-user
- **[P1] Move to Auth.js (NextAuth v5) Google provider.** Feasible and recommended. NextAuth's Google provider *is* OAuth2 under the hood; you can request `gmail.readonly` as an additional scope and persist the `access_token` + `refresh_token` in the `Account` table via the Prisma adapter. You then hand those tokens to `google-auth-library`'s `OAuth2Client.setCredentials()` for Gmail calls — keep google-auth-library for Gmail API, let Auth.js own the session/login. Caution: set `access_type=offline` + `prompt=consent` to actually receive a refresh token; store tokens encrypted (see below).
- **[P0-for-multi-user] Per-user data isolation.** Every query must be scoped by `userId`. Today (single-user) there's no `userId` foreign key — adding multi-user means a schema migration touching every model.

### Database
- **[P1] SQLite → Postgres migration path (Prisma).** Straightforward: change `datasource.provider` to `postgresql`, set `DATABASE_URL`, then regenerate a fresh initial migration (don't reuse SQLite migration SQL — types differ). Watch for SQLite-only assumptions: no native enums in SQLite (Postgres has them), `DateTime` precision, and case-sensitive `LIKE` vs `ILIKE`. Use a managed Postgres (Neon/Supabase/Vercel Postgres). On serverless, add **Prisma Accelerate or a pooler (PgBouncer)** — serverless functions exhaust direct connections fast.

### Secrets & token encryption
- **[P0] Keep AES-256-GCM token encryption** (already done — good). Ensure: unique IV per encryption, key from env (32 bytes), never log plaintext tokens, rotate key procedure documented. Validate the key is present at boot (t3-env).
- **[P1] Secret management.** Move from `.env` to platform secrets (Vercel env vars / 1Password / Doppler). Never commit `.env`. Confirm `.env*` is gitignored.

### Google OAuth verification (the big one)
- **[P0 to leave "Testing" mode] Brand verification first:** domain ownership via Search Console, OAuth consent screen accurate, public homepage, privacy policy disclosing Gmail data use + Limited Use compliance statement.
- **[P0] OAuth app verification:** app-type justification + an English demo video showing the OAuth flow and how gmail.readonly is used.
- **[P0] CASA security assessment (because gmail.readonly is a *restricted* scope and you access data through a server).** Tiered:
  - **Tier 1** = self-assessment (DAST/SAST self-scan vs OWASP ASVS), no third-party lab. Lowest user-count / lowest sensitivity.
  - **Tier 2** = authorized-lab review, ~$540–$1,800/yr.
  - **Tier 3** = full lab pen-test, ~$4,500/yr, required for Marketplace badge.
  - gmail.readonly (read-only) tends toward the lower tiers vs full Gmail access, but **expect at least a lab-validated assessment for any non-trivial user base**, and **annual recertification** (every 12 months from Letter of Assessment).
  - Reality for a solo dev: staying under the verification threshold = keep the app in **Testing mode** (max 100 test users, refresh-token re-consent every 7 days) until you commit to the verification+CASA spend. This is the single largest gate to "real users."
  - Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification · https://deepstrike.io/blog/google-casa-security-assessment-2025 · https://support.google.com/cloud/answer/13465431

### Rate limiting & abuse
- **[P2] Rate limiting** only matters once multi-user/public. Then: limit per-user Gmail sync frequency and LLM calls. In-memory or DB counter first; Upstash if you scale horizontally.

### LLM cost controls
- **[P1] Cap and meter Anthropic usage.** Concrete: (a) cheapest capable model for classification (Haiku-tier) and reserve larger models for rare deep tasks; (b) truncate email bodies before sending (header + first N chars, strip quoted threads/signatures); (c) **prompt-cache** the static classification system prompt; (d) batch/skip — don't re-classify unchanged emails; (e) per-day token/$ ceiling with a kill-switch; (f) log tokens-in/out per call for cost attribution. See claude-api skill for current model IDs/pricing before hardcoding.

### Logging & error tracking
- **[P1] Structured logging** with `pino` (JSON logs, redact tokens/PII). **[P2] Sentry** for client+server error capture once real users exist.

### Security headers / CSP
- **[P1] Add CSP + security headers** via `next.config` headers or middleware: `Content-Security-Policy` (nonce-based, no `unsafe-inline` scripts), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` locking camera/mic/geo. Gmail data in the DOM makes a tight CSP worthwhile.

### Data deletion / privacy (GDPR-ish + Google Limited Use)
- **[P0 for production] Limited Use compliance:** Google requires you to honor the Limited Use policy for gmail.readonly — no selling data, no ads, no human reading except for security/abuse/with consent, and **delete data on request / on disconnect**. Implement: a "Disconnect & delete my data" action that revokes the token and purges stored emails/derived data. Publish a privacy policy stating this.

### Deployment
- **[P1] Vercel is the path of least resistance** for Next 16, but watch:
  - **Prisma on serverless** needs a connection pooler/Accelerate (above); also set the `prisma generate` postinstall and the right binary targets.
  - **Gmail push (webhooks via Pub/Sub)** needs a public HTTPS endpoint + a Google Cloud Pub/Sub topic; Vercel functions can receive the push but you must verify the JWT and handle the 7-day watch renewal. Alternative: **polling sync** (simpler, no Pub/Sub) for a small user base — recommended first.
  - SQLite does **not** work on Vercel (ephemeral FS) — Postgres migration is a hard prerequisite for any Vercel deploy. Fly.io/Railway with a persistent volume can keep SQLite if you want to defer Postgres, but Postgres is the cleaner long-term call.

---

## 4. Prioritized recommendation

### Top 5 to do FIRST (biggest quality jump, mostly low cost)
1. **Command palette (`cmdk`) + keyboard model (`react-hotkeys-hook`)** — j/k, `e`, `/`, `Cmd-K`. Defines the "fast" feel.
2. **Optimistic triage + Undo toast (`sonner`)** — instant UI with a forgiving 5s undo.
3. **Visual triage states + split-inbox lanes + intentional empty states** — hierarchy via weight/color; render existing priority buckets as collapsible lanes. Pure UI, no new data.
4. **LLM cost controls** — model tiering, body truncation, prompt caching, skip-unchanged, daily ceiling. Protects the unit economics before you scale.
5. **`@t3-oss/env-nextjs` env validation + `pino` structured logging (token-redacted)** — cheap reliability/safety foundation that pays off immediately.

### Top 3 production BLOCKERS before real users
1. **Google OAuth verification + CASA security assessment for gmail.readonly** — without it you're capped at Testing mode (100 users, 7-day token expiry). Largest time/cost gate; plan for Tier 1 self-assessment minimum, possibly Tier 2 lab (~$540–$1,800/yr) + annual recert.
2. **SQLite → Postgres + multi-user auth (Auth.js) with per-user data isolation + encrypted tokens** — required before any shared/hosted deployment; touches the whole schema.
3. **Privacy/Limited-Use compliance: data deletion + token revocation on disconnect, privacy policy, CSP/security headers** — legally and policy required to handle other people's Gmail data.

---

*Compiled 2026-06-29. Verify Google verification specifics and Anthropic model pricing against primary docs at implementation time — both change frequently.*
