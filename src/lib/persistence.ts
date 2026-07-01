import type { PrismaClient } from "@prisma/client";
import type { ClassifyResult, RawEmail } from "./classification/classify";
import type { EmailClassification } from "./classification/schema";

/**
 * Persistence helpers for classified emails and user feedback.
 *
 * Every helper takes the Prisma client as its first argument so callers (and
 * tests) can inject a real client or a mock. This module deliberately does NOT
 * import the `prisma` singleton — keeping it dependency-injected makes the
 * functions trivially unit-testable without a database.
 */

// Feedback types allowed by the master prompt. An unknown type is rejected so a
// typo or a malicious client can't write junk feedback that later skews learning.
export const ALLOWED_FEEDBACK_TYPES = [
  "correct",
  "wrong",
  "more_like_this",
  "less_like_this",
  "always_prioritize_sender",
  "usually_ignore_sender",
  "mark_urgent",
  "not_urgent",
  "needs_follow_up",
  "no_action_needed",
  "move_to_read_later",
  "safe_to_ignore",
] as const;

export type FeedbackType = (typeof ALLOWED_FEEDBACK_TYPES)[number];

export function isAllowedFeedbackType(value: string): value is FeedbackType {
  return (ALLOWED_FEEDBACK_TYPES as readonly string[]).includes(value);
}

// Map the snake_case classification payload onto the camelCase DB columns. Kept
// as one place so the schema↔column mapping never drifts between create paths.
function toClassificationColumns(classification: EmailClassification) {
  return {
    priorityLevel: classification.priority_level,
    urgencyLevel: classification.urgency_level,
    importanceScore: classification.importance_score,
    confidenceScore: classification.confidence_score,
    category: classification.category,
    subcategory: classification.subcategory,
    summary: classification.summary,
    whyThisMatters: classification.why_this_matters,
    recommendedNextStep: classification.recommended_next_step,
    detectedDeadline: classification.detected_deadline,
    requiresResponse: classification.requires_response,
    requiresDecision: classification.requires_decision,
    requiresPayment: classification.requires_payment,
    requiresScheduling: classification.requires_scheduling,
    needsFollowUp: classification.needs_follow_up,
    waitingOnReply: classification.waiting_on_reply,
    riskIfIgnored: classification.risk_if_ignored,
    suggestedBucket: classification.suggested_bucket,
    safeToIgnore: classification.safe_to_ignore,
    modelVersion: classification.model_version,
  };
}

/**
 * Upsert an email and its classification.
 *
 * The email is upserted by its unique `sourceId` so re-running classification on
 * the same fixture/message updates in place instead of erroring on a duplicate.
 * The 1:1 classification is then upserted by `emailMessageId`, so a re-classify
 * overwrites the previous verdict rather than accumulating rows.
 *
 * @returns the EmailMessage id.
 */
export async function saveClassifiedEmail(
  db: PrismaClient,
  raw: RawEmail,
  result: ClassifyResult,
): Promise<string> {
  const receivedAt = new Date(raw.receivedAt);
  const gmailLabels =
    raw.labels !== undefined && raw.labels.length > 0 ? JSON.stringify(raw.labels) : null;

  const message = await db.emailMessage.upsert({
    where: { sourceId: raw.sourceId },
    create: {
      sourceId: raw.sourceId,
      threadId: raw.threadId ?? null,
      senderName: raw.senderName,
      senderEmail: raw.senderEmail,
      subject: raw.subject,
      bodyText: raw.bodyText,
      receivedAt,
      gmailLabels,
    },
    update: {
      threadId: raw.threadId ?? null,
      senderName: raw.senderName,
      senderEmail: raw.senderEmail,
      subject: raw.subject,
      bodyText: raw.bodyText,
      receivedAt,
      gmailLabels,
    },
  });

  const columns = toClassificationColumns(result.classification);

  await db.emailClassification.upsert({
    where: { emailMessageId: message.id },
    create: { emailMessageId: message.id, ...columns },
    update: columns,
  });

  return message.id;
}

/**
 * Of the given source ids, return the set that already has a classification.
 *
 * Used by sync to skip re-classifying emails it has already processed — the LLM
 * is the expensive part, so we never re-decide an email we've already triaged
 * unless the caller explicitly asks for a re-classification.
 */
export async function findClassifiedSourceIds(
  db: PrismaClient,
  sourceIds: string[],
): Promise<Set<string>> {
  if (sourceIds.length === 0) {
    return new Set();
  }
  const rows = await db.emailMessage.findMany({
    where: { sourceId: { in: sourceIds }, classification: { isNot: null } },
    select: { sourceId: true },
  });
  return new Set(rows.map((row) => row.sourceId));
}

export type SaveFeedbackInput = {
  emailMessageId: string;
  feedbackType: string;
  feedbackNotes?: string;
};

/**
 * Record a single piece of user feedback against an email.
 *
 * Validates `feedbackType` against {@link ALLOWED_FEEDBACK_TYPES} and throws on
 * an unknown value — we fail loudly rather than silently dropping or storing an
 * invalid signal.
 */
export async function saveFeedback(db: PrismaClient, input: SaveFeedbackInput): Promise<void> {
  if (!isAllowedFeedbackType(input.feedbackType)) {
    throw new Error(`unknown feedbackType: ${input.feedbackType}`);
  }

  await db.userFeedback.create({
    data: {
      emailMessageId: input.emailMessageId,
      feedbackType: input.feedbackType,
      feedbackNotes: input.feedbackNotes ?? null,
    },
  });
}

// Persisted shapes consumed by the dashboard layer. Declared explicitly (rather
// than derived from Prisma's payload generics) so downstream code has a stable,
// readable contract and tests can build plain objects that satisfy it.
export type PersistedMessage = {
  id: string;
  sourceId: string;
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  // Gmail labelIds as a JSON string (e.g. '["UNREAD","STARRED"]'), or null for
  // sample fixtures. The signal behavioral learning reads.
  gmailLabels: string | null;
  createdAt: Date;
};

export type PersistedClassification = {
  id: string;
  emailMessageId: string;
  priorityLevel: string;
  urgencyLevel: string;
  importanceScore: number;
  confidenceScore: number;
  category: string;
  subcategory: string | null;
  summary: string;
  whyThisMatters: string;
  recommendedNextStep: string;
  detectedDeadline: string | null;
  requiresResponse: boolean;
  requiresDecision: boolean;
  requiresPayment: boolean;
  requiresScheduling: boolean;
  needsFollowUp: boolean;
  waitingOnReply: boolean;
  riskIfIgnored: string | null;
  suggestedBucket: string;
  safeToIgnore: boolean;
  modelVersion: string;
  createdAt: Date;
};

// The message shape returned by the LIST query. `bodyText` is deliberately
// EXCLUDED: the dashboard/EmailCard and suggestions never render the full body,
// so we neither select nor ship it (data minimization + smaller payloads).
export type ClassifiedListMessage = Omit<PersistedMessage, "bodyText">;

export type ClassifiedEmailRow = {
  message: ClassifiedListMessage;
  classification: PersistedClassification;
};

// Cap the list query. The dashboard and suggestions only need a recent window,
// not the entire history, so we bound the scan (and the payload) to the most
// recent N by receivedAt. reclassifyStoredBySender has its OWN query and is
// unaffected by this limit.
export const CLASSIFIED_LIST_LIMIT = 200;

/**
 * Load recent emails that have a classification, newest first, with the
 * classification relation included. Messages without a classification are
 * excluded at the query level so callers always get a present classification.
 *
 * Bounded to {@link CLASSIFIED_LIST_LIMIT} most-recent rows and selects only the
 * columns the dashboard/suggestions consume — notably NOT `bodyText`.
 */
export async function loadClassifiedEmails(db: PrismaClient): Promise<ClassifiedEmailRow[]> {
  const rows = await db.emailMessage.findMany({
    where: { classification: { isNot: null } },
    // Explicit select excludes bodyText; include the classification relation.
    select: {
      id: true,
      sourceId: true,
      threadId: true,
      senderName: true,
      senderEmail: true,
      subject: true,
      receivedAt: true,
      gmailLabels: true,
      createdAt: true,
      classification: true,
    },
    orderBy: { receivedAt: "desc" },
    take: CLASSIFIED_LIST_LIMIT,
  });

  return rows
    .map((row) => {
      const { classification, ...message } = row as ClassifiedListMessage & {
        classification: PersistedClassification | null;
      };
      if (classification === null) {
        return null;
      }
      return { message, classification };
    })
    .filter((row): row is ClassifiedEmailRow => row !== null);
}
