# Session Handoff — Smart Inbox AI

_Last updated: 2026-07-01 (end of a long build + QA session)._

> This is the single source of truth for resuming cleanly. `docs/operations/*`
> (build_log, qa_checklist, known_issues, roadmap, changelog, decision_log) and
> `docs/engineering/architecture.md` did **not** exist as of this handoff, so
> their essential content is folded in below. Create them from these sections if
> desired.

---

## 1. Project
**Smart Inbox AI** — a Next.js 16 / React 19 / TypeScript / Prisma (Postgres on
Supabase) app that connects to Gmail (read + limited write), classifies email
with an LLM (Anthropic) into priority buckets, and lets the user act on it.
Repo: `C:\Dev\smart-inbox-ai`. GitHub: `madebyshawnx/smart-inbox-ai`.
Workspace folder is named "AI Medical Inbox" but the app as built triages
**general Gmail** (no PHI-specific handling — see Known Issues / Open Questions).

## 2. Current phase / build step
**Feature roadmap Tier 1–3 COMPLETE + full multi-agent QA COMPLETE + code-level
QA hardening COMPLETE.** The next planned project is **multi-user auth +
tenancy** (requires a DB schema migration — NOT started, deliberately gated).
No build is in progress. This session ended on a **handoff-only** request.

## 3. Branch / deploy
- Local working branch: **`_deploy_trigger`** (tracks `origin/main`).
- Pushed to BOTH `origin/main` and `origin/feature/smart-inbox-mvp`, both at
  commit **`0f715b3`**.
- **Vercel deploy model:** the live preview URL
  `https://smart-inbox-ai-git-feature-smart-inbox-mvp-shawn-cyberghost.vercel.app/`
  deploys the **`feature/smart-inbox-mvp`** branch; **`main`** is the production
  branch. Vercel **Hobby** plan will not build a **private** repo — the repo must
  be **public** for deploys to run (or upgrade to Pro). Deployment Protection
  (SSO) currently walls the site.

## 4. Completed this session
- **Fixed connect/sync end-to-end.** Root cause was a bad `ENCRYPTION_KEY`
  (48-byte, must be base64 of 32 bytes) — connect silently failed. Also fixed
  classifier misrouting (relaxed strict `sender.email`; `daily_brief`→read_later)
  and added error surfacing (on-screen banner + logs).
- **Collapsible left-sidebar UX redesign** (rail + list + detail, mobile overlay).
- **Design system A1–A4:** shadcn/Radix foundation, Lucide icons (killed emoji),
  refined tokens/depth, Radix Sheet/DropdownMenu/Tooltip, `motion` transitions,
  polish.
- **Read/unread** inbox row state (persisted).
- **Feedback loop:** all feedback types now shape triage (per-sender guidance
  injected into the classifier) + re-triage on feedback + "What I've learned"
  panel.
- **Tier 1 — email actions:** Gmail write scopes (`modify`+`compose`),
  Archive/Done (reversible + undo), **AI draft replies (create Gmail draft,
  NEVER send)**, reconnect gate.
- **Tier 2:** thread/conversation grouping, real inbox search, usage analytics
  (Insights panel).
- **Tier 3:** unsubscribe (HTTPS one-click only, never mails) + bulk cleanup +
  sender screening (reuses Smart Rules).
- **Full 10-dimension multi-agent QA** → scorecard (verdict BLOCK) → **fixed all
  code-level CRITICAL/HIGH + safe MEDIUM/LOW** (SSRF guard, OAuth error codes,
  DB transactions, honest 500s, reply-draft echo guard, focus traps via new
  Radix Modal, contrast/tap-target/ARIA, perf bounding, +50 tests).

## 5. Partially complete / deferred (not started)
- **Morning-brief email** (Tier 2 remaining) — needs a **Resend** account
  (`RESEND_API_KEY`). Not built.
- **Follow-up reminders** — a notify-only (read-only) version is feasible without
  a migration; not built.
- **QA MEDIUM/LOW backlog** — see Known Issues; notably `InboxWorkspace.tsx` is
  ~1,377 lines (project cap 800) and should be split.

## 6. Files created this session (notable)
Libs: `src/lib/inbox-buckets.ts`, `src/lib/utils.ts`, `src/lib/feedback-summary.ts`,
`src/lib/feedback-history.ts`, `src/lib/analytics.ts`, `src/lib/reply-draft.ts`,
`src/lib/unsubscribe.ts`, `src/lib/unsubscribe-eligibility.ts`,
`src/lib/email-actions.ts`, `src/lib/google/gmail-actions.ts`.
UI: `src/components/LeftRail.tsx`, `LearnedPanel.tsx`, `InsightsPanel.tsx`,
`ActionButtons.tsx`, `useWriteState.ts`, `ui/button.tsx`, `ui/sheet.tsx`,
`ui/dropdown-menu.tsx`, `ui/tooltip.tsx`, `ui/modal.tsx`.
API routes: `src/app/api/emails/[id]/archive`, `.../draft`, `.../unsubscribe`,
`src/app/api/emails/bulk-archive`, `src/app/api/senders/screen`,
`src/app/api/feedback/history`.
Tests: many under `tests/unit/` and `tests/integration/` (route + helper tests).
Docs: `docs/ux-redesign-sidebar.md` (earlier), this handoff.

## 7. Files modified this session (notable)
`src/components/InboxWorkspace.tsx` (heavily), `FeedbackButtons.tsx`,
`CommandPalette.tsx`, `AskInbox.tsx`, `OnboardingQuestionnaire.tsx`,
`ConnectGmailCard.tsx`, `src/app/layout.tsx`, `src/app/globals.css`,
`src/app/page.tsx`, `next.config.ts`, `src/lib/classification/classify.ts` +
`schema.ts`, `src/lib/dashboard-data.ts` + `dashboard-types.ts`,
`src/lib/persistence.ts`, `src/lib/sync.ts`, `src/lib/feedback.ts`,
`src/lib/google/oauth.ts` + `tokens.ts` + `gmail.ts`, several API routes,
`package.json` (+ lucide-react, @radix-ui/*, motion, cva/clsx/tailwind-merge,
tw-animate-css).

## 8. Files that still need work
- `prisma/schema.prisma` — add `userId` FKs (auth/tenancy), `@@index(...)` on FK/
  filter columns, `@@unique([priorityProfileId, ruleText])` on SmartRule.
  **Deferred: any change here migrates the LIVE prod DB.**
- `src/components/InboxWorkspace.tsx` — split (extract EmailRow, EmailDetail,
  ThreadRow, SettingsDrawer, DangerZone) to get under the 800-line cap.
- `.env.local` — **rotate all secrets** (user action, see Blockers).
- `README.md` — status/usage likely stale (not updated this session).

## 9. Commands used
`pnpm typecheck` · `pnpm test` (Vitest) · `pnpm exec biome check --write .` ·
`pnpm build` · `pnpm add <deps>` · `git add/commit/push` (pushed to both
`feature/smart-inbox-mvp` and `main`). Multi-agent **Workflow** runs for each
build wave + the QA. Chrome-devtools MCP for screenshots. Node one-liner to
generate the 32-byte base64 `ENCRYPTION_KEY`.

## 10. QA status
**Gates GREEN:** `tsc --noEmit` clean · Biome clean · **289 tests pass** · `next
build` succeeds · no-send guard clean (no `messages.send` anywhere) ·
`prisma/schema.prisma` untouched.
**QA scorecard verdict: BLOCK** — for any *multi-user / PHI* deployment. Remaining
after hardening: auth/tenancy (CRITICAL), secrets rotation (CRITICAL, user),
DB indexes + SmartRule `@@unique` (HIGH, needs migration), plus a MEDIUM/LOW
backlog (see Known Issues). Good foundations verified: encrypted tokens, layered
injection defenses, never-send, reversible archive, correct Radix dialogs, strict
TS with zero `any`.

## 11. Current git status
**Clean working tree.** Nothing to commit. `origin/main` ==
`origin/feature/smart-inbox-mvp` == `0f715b3`. Recent commits (newest first):
`0f715b3` QA hardening · `4d520f2` Tier 3 · `251ff5b` Tier 2 · `23a37f9`
read/unread · `ab8de5c` Tier 1 · `74cedeb` feedback loop · design A1–A4 ·
connect/sync fixes.

## 12. Known issues (from QA — deduped)
- **CRITICAL — No auth/authorization/tenancy.** All API routes are
  unauthenticated over one shared dataset; `delete-data`/`loadClassifiedEmails`
  are unscoped. Mitigated *today* only by single-user + Vercel Deployment
  Protection. **Disqualifying for multi-user/PHI.**
- **CRITICAL — Live secrets in `.env.local`** (Anthropic key, Google client
  secret, Supabase DB password, `ENCRYPTION_KEY`) inside a OneDrive-synced path.
- **HIGH — No DB indexes**; SmartRule dedupe is a check-then-create race with no
  `@@unique` (both need a migration).
- **MEDIUM/LOW backlog:** `InboxWorkspace.tsx` > 800-line cap; email bodies stored
  plaintext (fine for general mail, must app-layer encrypt + sign BAAs before
  PHI; content also sent to Anthropic/Google with no documented BAA); no rate
  limiting on `/api/classify` + `/api/ask`; CSP is report-only; a few Prisma
  results cast via `as`; minor a11y polish remaining.
- **Ops:** Google OAuth app is in **Testing mode** → refresh tokens expire ~every
  7 days (must reconnect); "open to real users" needs Google verification + CASA.

## 13. Blockers / risks
- **Secret exposure (time-sensitive):** rotate the four secrets NOW; regenerating
  `ENCRYPTION_KEY` invalidates stored Gmail tokens → reconnect Gmail once.
- **Prod DB = the only DB.** `.env.local` points local dev at the **production
  Supabase** DB. Any `prisma migrate`/`db push` hits prod → run migrations
  deliberately, with backups, off-peak, and dedupe before adding `@@unique`.
- **Write actions inactive until reconnect:** OAuth scopes changed
  (`modify`+`compose`); the current token is read-only, so Archive/Draft/
  Unsubscribe/Screen show a "reconnect to enable" prompt until the user
  disconnects + reconnects Gmail.
- **Vercel Hobby + private repo won't build** — keep repo public for deploys or
  go Pro.

## 14. Decisions made
- **Never send email.** Only `drafts.create` + `messages.modify` — no
  `messages.send` anywhere. Unsubscribe acts only on HTTPS one-click (RFC 8058);
  `mailto:` is surfaced to the user, never sent.
- **No schema change during feature waves** — protect the live prod DB; auth,
  indexes, `@@unique`, snooze, and a persistent audit log are batched into a
  planned migration.
- **Feedback → classifier** as plain-English trusted `<sender_feedback_history>`
  lines (inspectable, not opaque weights); re-triage is bounded + best-effort.
- **Archive is reversible** (INBOX label add/remove, never trash) with undo.
- **Multi-agent Workflows** used for each build wave and the QA (map → build →
  verify; parallel reviewers → synthesized scorecard).
- **read/unread + rail-collapse + list-width** persisted to `localStorage`.
- **QA hardening excluded schema-dependent fixes** (deferred to the migration).

## 15. Open questions
1. **Medical/PHI intent?** Folder says "AI Medical Inbox"; app triages general
   Gmail. If PHI is in scope, add app-layer body encryption + BAAs + audit +
   access controls (QA defaulted to the stricter lens).
2. **Single-user or multi-user?** Determines whether the auth project is next.
3. Apply DB indexes + `@@unique` standalone, or fold into the auth migration?
4. Get a **Resend** key for the morning-brief email?

## 16. Next exact step
1. **User:** rotate the four secrets in `.env.local`; then **reconnect Gmail**
   (Disconnect → Connect) to grant write scopes and pick up the new
   `ENCRYPTION_KEY`.
2. **Then (next session):** produce a **multi-user auth + tenancy design + Prisma
   migration plan** (Auth.js or Supabase Auth; `userId` on EmailMessage,
   ConnectedAccount, PriorityProfile, UserFeedback, SmartRule, etc.; scope every
   query + `delete-data`; include the deferred indexes + SmartRule `@@unique`).
   **Review the plan before running anything against the prod DB.**

## 17. Exact prompt to resume in a new session
> Resume Smart Inbox AI at `C:\Dev\smart-inbox-ai`. Read
> `docs/operations/session_handoff.md` first. State: Tier 1–3 + full QA +
> code-level QA hardening are DONE and committed/pushed (`main` ==
> `feature/smart-inbox-mvp` == `0f715b3`); working tree clean; 289 tests +
> typecheck + biome + build all green. Do NOT rebuild shipped features.
> Next project: **multi-user auth + tenancy**. First, produce a design +
> Prisma migration plan (Auth.js/Supabase Auth; add `userId` to EmailMessage,
> ConnectedAccount, PriorityProfile, UserFeedback, SmartRule and scope every
> query + the delete-data wipe; also add the deferred `@@index`es and
> `@@unique([priorityProfileId, ruleText])` on SmartRule) and STOP for my review
> before touching the live Supabase prod DB (local `.env.local` points at prod —
> migrations hit production). Guardrails: never add a Gmail send path; keep all
> tests green; deploy by pushing `feature/smart-inbox-mvp` (repo must be public
> for Vercel Hobby to build). Confirm I've rotated the `.env.local` secrets and
> reconnected Gmail before relying on write actions.

---

## Session-end summary (as requested)
- **What to do next:** (1) *You* rotate `.env.local` secrets + reconnect Gmail.
  (2) Next session: design the **multi-user auth + schema migration** and stop
  for review before touching prod. Do not start new build work now.
- **Commit current work?** No action needed — **everything is already committed
  and pushed** (clean tree; `main` & `feature/smart-inbox-mvp` at `0f715b3`).
- **Is QA passing?** **Gates pass** (289 tests, typecheck, biome, build, no-send,
  schema untouched). The QA **verdict is still BLOCK for multi-user/PHI** because
  auth/tenancy and secret rotation remain — both intentionally out of scope for
  autonomous fixing.
- **Unresolved risks:** (1) live secrets in a synced path — rotate NOW; (2) no
  auth/tenancy — data is world-readable if Deployment Protection is removed
  before auth ships; (3) prod DB is the only DB — migrate carefully; (4) write
  actions need a Gmail reconnect to work.
