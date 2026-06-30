# Feature Roadmap — Tier 1–3 (build list)

Status of the "make it best-in-class" feature list. Three shipped in the
2026-06-30 sprint (Ask, Onboarding, Auto-sync). The rest is below, each as a
buildable wave with scope, blockers, and effort (S/M/L). Execute one wave per
fresh session at the project's quality bar (tests green every commit).

> **The hard fork:** everything in **Tier 1** needs **Gmail write scopes**
> (`gmail.modify` for archive/label, `gmail.compose`/drafts for replies). That
> is a deliberate product decision and a hard dependency on the *user*:
> - The OAuth scope changes → **every connected user must re-consent** in the
>   browser (cannot be done for them).
> - It flips the app from "read-only / never touches your mail" to "can modify
>   and send" — a real safety-posture change.
> - It triggers a **stricter Google verification** (write scopes are more
>   sensitive than `gmail.readonly`).
> Build the read-only Tier 2/3 items first; only start Tier 1 once the owner
> explicitly commits to write access.

---

## Shipped (this sprint)
- **Ask your inbox** — `/api/ask`, `AskInbox` modal, command-palette entry. AI Q&A over triaged emails (read-only, injection-defended).
- **Onboarding questionnaire** — `/api/onboarding`, `OnboardingQuestionnaire`, auto-opens first run. Maps answers to Smart Rules.
- **Background auto-sync** — `/api/cron/sync` + `vercel.json` daily cron + shared `runSync()`. (Hobby = 1x/day; raise with plan or Gmail Pub/Sub push.)

---

## Tier 2 — remaining (read-only, NO new scopes) — do these next

### Morning brief email — M
Email the daily brief each morning so the user doesn't open the app.
- Needs a transactional email service (Resend recommended). Add `RESEND_API_KEY`.
- New `/api/cron/brief` (reuse the cron-auth pattern) on a daily schedule; builds the brief via `aggregateBrief` over the user's classified emails and sends it.
- Clean HTML email template + a "email me my brief" setting toggle.
- Blocker: Resend signup (user, ~2 min).

### Thread / conversation grouping — M
Group emails by `threadId` (already captured) into conversations in the list/detail. Data-shaping in `dashboard-data.ts` + UI in `InboxWorkspace`. No new scopes.

### Real inbox search — S/M
Search across classified emails (sender/subject/summary). The command palette already lists emails; add `/api/search` or a client filter; for scale, a Postgres text query.

### Usage analytics — S
"Emails triaged, % safe-to-ignore, time saved" view from existing data. Pure read + a small dashboard panel.

---

## Tier 1 — actions (NEEDS GMAIL WRITE SCOPES + user re-consent)

**Prereq wave (do once, before any Tier 1 feature):**
- Add the needed scope(s) to `GMAIL_SCOPES` in `src/lib/google/oauth.ts` (`gmail.modify` covers archive/label/read; add drafts/compose for replies).
- User re-connects Gmail (re-consent). Update the Google verification plan.
- Safety layer: confirmations for destructive actions, an action audit log, and an "undo" window (toast-based) — the product's trust promise depends on it.

### Archive / "Done" — S (after prereq)
`POST /api/emails/:id/archive` -> Gmail `users.messages.modify` removing `INBOX`. One-click on the card. Optimistic UI + undo toast.

### Snooze / Remind me later — M
Store a `snoozeUntil` on the email; hide until then; the daily cron resurfaces due ones. Optionally toggle the `INBOX` label.

### Follow-up reminders — M (can be notify-only in Tier 2)
You already detect `waiting_on_reply`. Track those threads; nudge (in-app + morning email) when one goes stale (>3 days, no reply). Reminding is read-only, so a notify-only version needs no write scope and could ship in Tier 2.

### AI draft replies — L
`gmail.compose`/drafts scope. `POST /api/emails/:id/draft` -> LLM generates a reply (thread-grounded, injection-defended) -> create a **Gmail draft** (never auto-send). UI: "Draft reply" -> editable -> user sends. Sending is its own scope/decision.

---

## Tier 3 — cleanup & breadth

### Unsubscribe / bulk cleanup — M (needs write scope)
Capture the `List-Unsubscribe` header at sync; one-click unsubscribe + bulk-archive newsletters/promotions.

### Sender screening (HEY-style) — M (write scope for routing)
First-time-sender "screen in / out" before they hit the main inbox; remembered per sender. Pairs with Smart Rules.

### Multi-account — L
Connect multiple inboxes (the sibling project's PRD-2). Schema: multiple `ConnectedAccount`s + per-account sync + unified triage. Do after multi-user auth.

### Multi-user auth — L (cross-cutting; from production-roadmap.md)
Per-user data isolation (every table gets `userId`) + login (Supabase Auth fits — we're on Supabase). **The unlock for real multi-tester usage** — until then it's one inbox at a time.

---

## Recommended order
1. **Tier 2 read-only**: morning brief -> follow-up reminders (notify-only) -> thread grouping -> search -> analytics.
2. **Decide on write access.** If yes -> Tier 1 prereq wave (scopes + re-consent + safety/undo) -> archive -> snooze -> draft replies.
3. **Tier 3** as breadth allows; **multi-user auth** when you want concurrent testers.
