# Smart Inbox AI

An AI-powered daily email brief and smart inbox that surfaces what needs your attention, explains why, and suggests next steps.

## Phase 1 status

Sample-email classification pipeline: upload fixtures → classify with Claude → view smart inbox dashboard. No Gmail OAuth yet.

## Quick start

```bash
cp .env.example .env
# Fill in SMART_INBOX_DATABASE_URL and ANTHROPIC_API_KEY in .env

pnpm install
pnpm exec prisma migrate dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start Next.js development server |
| `pnpm build` | Production build |
| `pnpm test` | Run all Vitest tests |
| `pnpm test:unit` | Unit tests only (`tests/unit/`) |
| `pnpm test:integration` | Integration tests only (`tests/integration/`) |
| `pnpm lint` | Biome lint check |
| `pnpm format` | Biome format (writes changes) |
| `pnpm typecheck` | TypeScript type check (no emit) |
| `pnpm prisma:generate` | Regenerate Prisma client |
| `pnpm prisma:migrate` | Run pending migrations (dev) |

## Architecture

Next.js 16 App Router handles both API routes (classification pipeline, dashboard data) and the React UI. Prisma 6 with SQLite backs local dev; Phase 2 will migrate to Postgres. The Anthropic Claude API classifies each email and the raw JSON response is validated with Zod before being written to the database. Biome handles all linting and formatting; Vitest covers unit and integration tests.

## Design — inbox buckets

- **Needs Attention** — requires a decision or action today
- **Follow Up Today** — you sent something and need to chase it
- **Waiting on Reply** — ball is in their court; watch for response
- **Deadlines** — date-bound commitments or expiring items
- **Money or Account-Related** — invoices, billing, subscriptions
- **Read Later** — useful content with no urgency
- **Low Priority** — FYI items that can wait
- **Safe to Ignore** — newsletters, promos, automated notifications
- **Needs Review** — documents, contracts, or drafts sent for feedback
- **Daily Brief** — digest summary generated each morning

## Security note

Email content is treated as untrusted input; the classifier summarizes and categorizes emails but never follows instructions found inside them.

## What is NOT in v1

No Gmail OAuth, no email sending, no deleting or archiving emails, no auto-archiving, and no work-mode switching.
