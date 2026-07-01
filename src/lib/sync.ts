import type { PrismaClient } from "@prisma/client";
import { createAnthropicClient } from "./classification/anthropic-client";
import { classifyEmail, type RawEmail } from "./classification/classify";
import {
  loadSenderFeedbackSummary,
  type SenderFeedbackRecord,
  summarizeFeedbackBySender,
} from "./feedback-summary";
import { fetchRecentEmails } from "./google/gmail";
import { getAccessToken } from "./google/tokens";
import { type FeedbackType, findClassifiedSourceIds, saveClassifiedEmail } from "./persistence";
import { loadActiveRuleTexts } from "./rules";

// How many of a sender's already-stored emails a single feedback action may
// re-classify. Keeps the post-feedback correction bounded and cheap — the user
// sees their most recent mail from that sender update, without paying to
// re-run the whole inbox on every click.
export const RECLASSIFY_BY_SENDER_LIMIT = 10;

// Keep each sync modest: enough to be useful, small enough to stay fast and
// cheap. Pagination/incremental sync can raise this later.
export const SYNC_LIMIT = 25;

export type SyncCounts = {
  classified: number;
  needsReview: number;
  skipped: number;
  total: number;
};

export type RunSyncOptions = {
  // When true, re-classify every fetched email even if already triaged (e.g.
  // after the user changes Smart Rules). Default skips already-triaged emails.
  reclassify?: boolean;
};

/**
 * Pull the most recent inbox messages from the connected Gmail account, classify
 * them through the same pipeline as the sample flow (applying the user's Smart
 * Rules), and persist the results. Read-only: nothing is sent, modified, or
 * deleted in the mailbox.
 *
 * Shared by the manual sync route (`POST /api/emails/sync`) and the background
 * cron endpoint (`GET /api/cron/sync`). The Prisma client is injected so callers
 * and tests can supply a real client or a mock.
 *
 * Assumes a Gmail account is connected — `getAccessToken` throws if not, and the
 * caller is responsible for translating that into the right response.
 */
export async function runSync(db: PrismaClient, opts: RunSyncOptions = {}): Promise<SyncCounts> {
  const reclassify = opts.reclassify === true;

  const accessToken = await getAccessToken(db);
  const emails = await fetchRecentEmails(accessToken, SYNC_LIMIT);
  if (emails.length === 0) {
    return { classified: 0, needsReview: 0, skipped: 0, total: 0 };
  }

  // Skip emails already triaged so we never pay the LLM to re-decide them,
  // unless the caller forced a re-classification.
  const alreadyClassified = reclassify
    ? new Set<string>()
    : await findClassifiedSourceIds(
        db,
        emails.map((email) => email.sourceId),
      );
  const toClassify = emails.filter((email) => !alreadyClassified.has(email.sourceId));

  if (toClassify.length === 0) {
    return { classified: 0, needsReview: 0, skipped: emails.length, total: emails.length };
  }

  const client = createAnthropicClient();
  const rules = await loadActiveRuleTexts(db);

  // Load every sender's learned feedback guidance once, then hand each email only
  // the lines for ITS sender. Trusted guidance is sender-scoped, so passing an
  // unrelated sender's history would just waste tokens and could mislead.
  const feedbackBySender = await loadFeedbackGuidanceBySender(db);

  const classifications = await Promise.all(
    toClassify.map((email) =>
      classifyEmail(email, client, {
        rules,
        feedbackSummary: feedbackBySender.get(email.senderEmail.toLowerCase()) ?? [],
      }),
    ),
  );

  let classified = 0;
  let needsReview = 0;
  for (let i = 0; i < toClassify.length; i++) {
    const result = classifications[i];
    await saveClassifiedEmail(db, toClassify[i], result);
    if (result.status === "needs_review") {
      needsReview += 1;
    } else {
      classified += 1;
    }
  }

  return {
    classified,
    needsReview,
    skipped: emails.length - toClassify.length,
    total: emails.length,
  };
}

/**
 * Build a map from lowercased sender email → that sender's trusted feedback
 * guidance lines, in one pass over all stored feedback.
 *
 * Done once per sync (rather than a query per email) so a busy inbox doesn't
 * issue N feedback queries. Keyed lowercase because email addresses are
 * case-insensitive and the same sender can appear with different casing.
 */
async function loadFeedbackGuidanceBySender(db: PrismaClient): Promise<Map<string, string[]>> {
  const rows = await db.userFeedback.findMany({
    select: {
      feedbackType: true,
      emailMessage: { select: { senderName: true, senderEmail: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group raw records by sender, then summarise each sender's records on their
  // own so every guidance line is correctly scoped to one sender.
  const recordsBySender = new Map<string, SenderFeedbackRecord[]>();
  for (const row of rows) {
    const message = row.emailMessage;
    if (message === null || message === undefined) {
      continue;
    }
    const key = message.senderEmail.toLowerCase();
    const list = recordsBySender.get(key) ?? [];
    // The classifier-allowed feedback types are a subset of FeedbackType; the
    // summariser ignores any type that carries no triage signal, so an
    // unexpected stored value is filtered there rather than throwing here.
    list.push({
      senderName: message.senderName,
      senderEmail: message.senderEmail,
      feedbackType: row.feedbackType as FeedbackType,
    });
    recordsBySender.set(key, list);
  }

  const guidanceBySender = new Map<string, string[]>();
  for (const [key, records] of recordsBySender) {
    const lines = summarizeFeedbackBySender(records);
    if (lines.length > 0) {
      guidanceBySender.set(key, lines);
    }
  }
  return guidanceBySender;
}

// Reconstruct the classifier's RawEmail input from a stored EmailMessage row, so
// a re-classification re-runs the exact same pipeline a fresh sync would.
function toRawEmail(row: {
  sourceId: string;
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  gmailLabels: string | null;
}): RawEmail {
  let labels: string[] | undefined;
  if (row.gmailLabels !== null) {
    try {
      const parsed = JSON.parse(row.gmailLabels);
      if (Array.isArray(parsed)) {
        labels = parsed.filter((l): l is string => typeof l === "string");
      }
    } catch {
      // A corrupt labels blob is non-fatal; classify without labels.
    }
  }
  return {
    sourceId: row.sourceId,
    threadId: row.threadId ?? undefined,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    subject: row.subject,
    bodyText: row.bodyText,
    receivedAt: row.receivedAt.toISOString(),
    labels,
  };
}

export type ReclassifyBySenderCounts = {
  reclassified: number;
  needsReview: number;
  total: number;
};

/**
 * Re-classify a bounded set of a sender's ALREADY-STORED emails, in place.
 *
 * Called right after the user gives feedback on a sender so the correction
 * visibly takes effect: the freshly-updated Smart Rules and the sender's learned
 * feedback guidance are both fed back through the classifier, and the stored
 * classifications are overwritten. Unlike {@link runSync} this never touches
 * Gmail — it only re-decides emails already in the database — and it is capped at
 * {@link RECLASSIFY_BY_SENDER_LIMIT} so a single click stays cheap.
 *
 * Best-effort: if no Anthropic key is configured or the model errors, the caller
 * (the feedback route) should swallow the failure so saving feedback still
 * succeeds. The Prisma client and the model client are injected for testability.
 */
export async function reclassifyStoredBySender(
  db: PrismaClient,
  senderEmail: string,
  opts: { client?: ReturnType<typeof createAnthropicClient>; limit?: number } = {},
): Promise<ReclassifyBySenderCounts> {
  const limit = opts.limit ?? RECLASSIFY_BY_SENDER_LIMIT;

  const rows = await db.emailMessage.findMany({
    where: { senderEmail, classification: { isNot: null } },
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      sourceId: true,
      threadId: true,
      senderName: true,
      senderEmail: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      gmailLabels: true,
    },
  });

  if (rows.length === 0) {
    return { reclassified: 0, needsReview: 0, total: 0 };
  }

  const client = opts.client ?? createAnthropicClient();
  const rules = await loadActiveRuleTexts(db);
  const feedbackSummary = await loadSenderFeedbackSummary(db, senderEmail);

  const emails = rows.map(toRawEmail);
  const classifications = await Promise.all(
    emails.map((email) => classifyEmail(email, client, { rules, feedbackSummary })),
  );

  let reclassified = 0;
  let needsReview = 0;
  for (let i = 0; i < emails.length; i++) {
    const result = classifications[i];
    await saveClassifiedEmail(db, emails[i], result);
    if (result.status === "needs_review") {
      needsReview += 1;
    } else {
      reclassified += 1;
    }
  }

  return { reclassified, needsReview, total: emails.length };
}
