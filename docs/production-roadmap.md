# Production Roadmap — Smart Inbox AI

Prioritized path from local single-user prototype to a hosted, multi-user product.
Effort: **S** (<1 day) · **M** (1–3 days) · **L** (1+ week, often partly non-code).
Based on [`research-2026-06.md`](./research-2026-06.md) and the current code.

## What works today (local, single-user)

- [x] LLM classification of emails (Anthropic, deterministic temp 0)
- [x] Gmail read-only sync (`gmail.readonly`, OAuth2, AES-256-GCM encrypted tokens at rest)
- [x] Smart Rules engine + feedback loop (learns from corrections)
- [x] Two-pane inbox UI + command palette (Cmd/Ctrl-K)
- [x] Sample-classification flow boots with only `ANTHROPIC_API_KEY` (no Gmail required)
- [x] Type-safe env validation at boot (`src/lib/env.ts`) + baseline security headers

---

## P0 — Blockers before ANY real user

- [ ] **Multi-user auth** · **L** · Add Auth.js (NextAuth v5) Google provider; request
  `gmail.readonly` as an extra scope, persist tokens via the Prisma adapter `Account` table,
  hand them to `google-auth-library`'s `setCredentials()` for Gmail calls. Set
  `access_type=offline` + `prompt=consent` to get a refresh token.
- [ ] **Per-user data isolation** · **L** · Add `userId` FK to every table (emails, rules,
  feedback, tokens) and scope every query by it. Single-user model has no `userId` today —
  this is a schema migration touching every model. Do it together with auth.
- [ ] **SQLite → Postgres** · **M** · SQLite cannot run on serverless (ephemeral FS). Swap
  `datasource.provider` to `postgresql`, set `DATABASE_URL`, regenerate a fresh initial
  migration (do not reuse SQLite SQL). Watch enums, `DateTime` precision, `LIKE` vs `ILIKE`.
- [ ] **Google OAuth verification + CASA** · **L** (partly non-code) · `gmail.readonly` is a
  *restricted* scope, so production needs brand verification (domain, privacy policy, public
  homepage), an English OAuth demo video, and a CASA security assessment. Tier 1 = free
  self-scan; Tier 2 lab ≈ $540–$1,800/yr; Tier 3 ≈ $4,500/yr (Marketplace). Annual recert.
  Until funded, stay in Testing mode (≤100 users, 7-day token re-consent).
- [ ] **Data deletion + token revocation on disconnect** · **M** · Google Limited-Use requires
  a "Disconnect & delete my data" action that revokes the OAuth token and purges stored
  emails/derived data. Publish a privacy policy disclosing Gmail use + Limited-Use compliance.

---

## P1 — Before real users (reliability & cost)

- [ ] **Deploy to Vercel** · **M** · Add a Prisma pooler/Accelerate (serverless exhausts direct
  connections); set platform env vars (no `.env`); change `GOOGLE_REDIRECT_URI` from
  `localhost` to the prod domain in the Google console. Confirm `.env*` is gitignored.
- [ ] **LLM cost controls** · **M** · Use a cheaper model tier (Haiku-class) for classification;
  prompt-cache the static system prompt; keep the already-built skip-already-classified;
  truncate bodies (header + first N chars); add a per-day token/$ kill-switch + per-call
  token logging. Verify current model IDs/pricing (claude-api skill) before hardcoding.
- [ ] **Error tracking + structured logging** · **S–M** · `pino` JSON logs with token/PII
  redaction now; add Sentry (client+server) once real users exist.
- [ ] **Rate limiting** · **S** · Only meaningful once multi-user. Start with an in-memory/DB
  counter on Gmail-sync frequency and LLM calls; move to Upstash if scaling horizontally.

---

## P2 — Later (scale & polish)

- [ ] **Gmail push via Pub/Sub** · **L** · Replace polling with a Pub/Sub topic + public webhook
  (verify the JWT); handle the 7-day `watch` renewal. Keep polling as the simpler default until
  user count justifies the move.
- [ ] **CSP with nonce headers** · **M** · Add a per-request nonce CSP (no `unsafe-inline`
  scripts) via middleware. Gmail content in the DOM makes a tight CSP worthwhile.
- [ ] **Incremental / paginated sync** · **M** · Move beyond the current 25-message fetch using
  Gmail `historyId` / page tokens for full, resumable sync.
- [ ] **Behavioral-learning suggestions** · **L** · Observe read/archive/star behavior and
  *suggest* Smart Rules for user approval — surfaced suggestions, not a black-box auto-rule.

---

## Recommended order

1. **P0 data + auth foundation:** SQLite→Postgres, then Auth.js + per-user `userId` isolation
   (one combined migration). Nothing ships multi-user without these.
2. **P0 compliance in parallel:** start OAuth verification + CASA early (long, partly non-code);
   build disconnect/delete + privacy policy alongside.
3. **P1 deploy + guardrails:** Vercel + pooler, LLM cost controls, logging/error tracking,
   then rate limiting.
4. **P2 polish:** Pub/Sub push, CSP nonce, paginated sync, behavioral-learning suggestions.
