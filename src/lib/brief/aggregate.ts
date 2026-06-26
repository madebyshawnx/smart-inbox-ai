import type { EmailClassification } from "../classification/schema";

export type DailyBrief = {
  totalEmailsReviewed: number;
  needsAttentionCount: number;
  followUpCount: number;
  deadlineCount: number;
  moneyOrAccountCount: number;
  waitingOnReplyCount: number;
  readLaterCount: number;
  lowPriorityCount: number;
  safeToIgnoreCount: number;
  needsReviewCount: number;
  topEmails: Array<{
    email_id: string;
    subject: string;
    senderName: string;
    why_this_matters: string;
    importance_score: number;
  }>;
  summary: string;
};

const TOP_EMAIL_LIMIT = 3;

/**
 * Aggregate a list of email classifications into a Daily Email Brief.
 *
 * Pure function over in-memory data: no database access, no side effects.
 * Per-bucket counts are derived from `suggested_bucket`. `topEmails` are the
 * highest-importance items (stable tie-break by input order). The summary is a
 * deterministic, plain-English paragraph built from the actual counts.
 */
export function aggregateBrief(classifications: EmailClassification[]): DailyBrief {
  const countByBucket = (bucket: EmailClassification["suggested_bucket"]): number =>
    classifications.filter((c) => c.suggested_bucket === bucket).length;

  const needsAttentionCount = countByBucket("needs_attention");
  const followUpCount = countByBucket("follow_up_today");
  const deadlineCount = countByBucket("deadlines");
  const moneyOrAccountCount = countByBucket("money_or_account_related");
  const waitingOnReplyCount = countByBucket("waiting_on_reply");
  const readLaterCount = countByBucket("read_later");
  const lowPriorityCount = countByBucket("low_priority");
  const safeToIgnoreCount = countByBucket("safe_to_ignore");
  const needsReviewCount = countByBucket("needs_review");
  const totalEmailsReviewed = classifications.length;

  const topEmails = classifications
    // Preserve original index so equal scores keep input order (stable sort).
    .map((classification, index) => ({ classification, index }))
    .sort((a, b) => {
      if (b.classification.importance_score !== a.classification.importance_score) {
        return b.classification.importance_score - a.classification.importance_score;
      }
      return a.index - b.index;
    })
    .slice(0, TOP_EMAIL_LIMIT)
    .map(({ classification }) => ({
      email_id: classification.email_id,
      subject: classification.subject,
      senderName: classification.sender.name,
      why_this_matters: classification.why_this_matters,
      importance_score: classification.importance_score,
    }));

  const summary = buildSummary({
    totalEmailsReviewed,
    needsAttentionCount,
    deadlineCount,
    moneyOrAccountCount,
    waitingOnReplyCount,
    lowPriorityCount,
    topSubject: topEmails[0]?.subject ?? null,
  });

  return {
    totalEmailsReviewed,
    needsAttentionCount,
    followUpCount,
    deadlineCount,
    moneyOrAccountCount,
    waitingOnReplyCount,
    readLaterCount,
    lowPriorityCount,
    safeToIgnoreCount,
    needsReviewCount,
    topEmails,
    summary,
  };
}

type SummaryInput = {
  totalEmailsReviewed: number;
  needsAttentionCount: number;
  deadlineCount: number;
  moneyOrAccountCount: number;
  waitingOnReplyCount: number;
  lowPriorityCount: number;
  topSubject: string | null;
};

function buildSummary(input: SummaryInput): string {
  if (input.totalEmailsReviewed === 0) {
    return "Reviewed 0 emails. Nothing needs your attention right now.";
  }

  const base =
    `Reviewed ${input.totalEmailsReviewed} emails. ` +
    `${input.needsAttentionCount} need attention, ` +
    `${input.deadlineCount} include deadlines, ` +
    `${input.moneyOrAccountCount} involve money or accounts, ` +
    `${input.waitingOnReplyCount} are waiting on reply, ` +
    `and ${input.lowPriorityCount} appear low priority.`;

  if (input.topSubject !== null) {
    return `${base} The most important item is: ${input.topSubject}.`;
  }

  return base;
}
