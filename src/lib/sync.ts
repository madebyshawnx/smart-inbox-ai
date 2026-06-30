import type { PrismaClient } from "@prisma/client";
import { createAnthropicClient } from "./classification/anthropic-client";
import { classifyEmail } from "./classification/classify";
import { fetchRecentEmails } from "./google/gmail";
import { getAccessToken } from "./google/tokens";
import { findClassifiedSourceIds, saveClassifiedEmail } from "./persistence";
import { loadActiveRuleTexts } from "./rules";

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

  const classifications = await Promise.all(
    toClassify.map((email) => classifyEmail(email, client, { rules })),
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
