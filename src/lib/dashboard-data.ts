import { aggregateBrief } from "./brief/aggregate";
import type { EmailClassification } from "./classification/schema";
import { BUCKET_KEYS, type BucketKey, type DashboardData, type EmailCard } from "./dashboard-types";
import { prisma } from "./db";
import {
  type ClassifiedEmailRow,
  loadClassifiedEmails,
  type PersistedClassification,
  type PersistedMessage,
} from "./persistence";

// A DB-persisted bucket string is widened to `string`; narrow it back to a known
// BucketKey, falling back to "needs_review" if an unexpected value ever lands in
// the column (fail toward human review, never toward hiding the email).
function toBucketKey(value: string): BucketKey {
  // The model is allowed to answer "daily_brief", but that is the top-of-inbox
  // digest (computed separately by aggregateBrief), NOT a real column. Route
  // those informational emails to Read Later instead of silently burying them
  // in Needs Review via the unknown-value fallback below.
  if (value === "daily_brief") {
    return "read_later";
  }
  return (BUCKET_KEYS as readonly string[]).includes(value) ? (value as BucketKey) : "needs_review";
}

/**
 * Map a persisted message + classification onto the camelCase {@link EmailCard}
 * shape the UI renders. `receivedAt` is serialized to an ISO string so the card
 * is a plain JSON-safe object.
 */
export function mapToEmailCard(
  message: PersistedMessage,
  classification: PersistedClassification,
): EmailCard {
  return {
    id: message.id,
    sourceId: message.sourceId,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    subject: message.subject,
    summary: classification.summary,
    priorityLevel: classification.priorityLevel,
    urgencyLevel: classification.urgencyLevel,
    category: classification.category,
    whyThisMatters: classification.whyThisMatters,
    recommendedNextStep: classification.recommendedNextStep,
    detectedDeadline: classification.detectedDeadline,
    riskIfIgnored: classification.riskIfIgnored,
    confidenceScore: classification.confidenceScore,
    suggestedBucket: toBucketKey(classification.suggestedBucket),
    receivedAt: message.receivedAt.toISOString(),
  };
}

/**
 * Reconstruct the snake_case {@link EmailClassification} record from a persisted
 * row so {@link aggregateBrief} (which consumes EmailClassification[]) can run
 * over the database content without re-calling the model.
 */
export function toClassificationRecord(row: ClassifiedEmailRow): EmailClassification {
  const { message, classification } = row;
  return {
    email_id: message.sourceId,
    thread_id: message.threadId ?? message.sourceId,
    sender: { name: message.senderName, email: message.senderEmail },
    subject: message.subject,
    summary: classification.summary,
    priority_level: classification.priorityLevel as EmailClassification["priority_level"],
    urgency_level: classification.urgencyLevel as EmailClassification["urgency_level"],
    importance_score: classification.importanceScore,
    confidence_score: classification.confidenceScore,
    category: classification.category,
    subcategory: classification.subcategory,
    detected_deadline: classification.detectedDeadline,
    requires_response: classification.requiresResponse,
    requires_decision: classification.requiresDecision,
    requires_payment: classification.requiresPayment,
    requires_scheduling: classification.requiresScheduling,
    needs_follow_up: classification.needsFollowUp,
    waiting_on_reply: classification.waitingOnReply,
    recommended_next_step: classification.recommendedNextStep,
    why_this_matters: classification.whyThisMatters,
    risk_if_ignored: classification.riskIfIgnored,
    suggested_bucket: toBucketKey(classification.suggestedBucket),
    safe_to_ignore: classification.safeToIgnore,
    model_version: classification.modelVersion,
  };
}

// Start every bucket present and empty so the UI can render all nine columns
// even when some have no emails (no special-casing of missing keys downstream).
function emptyBuckets(): Record<BucketKey, EmailCard[]> {
  const buckets = {} as Record<BucketKey, EmailCard[]>;
  for (const key of BUCKET_KEYS) {
    buckets[key] = [];
  }
  return buckets;
}

/**
 * Build the full dashboard payload: emails grouped into their suggested bucket
 * plus the aggregated daily brief. Defaults to the prisma singleton; tests pass
 * a mock client.
 */
export async function loadDashboardData(db = prisma): Promise<DashboardData> {
  const rows = await loadClassifiedEmails(db);

  const buckets = emptyBuckets();
  for (const row of rows) {
    const card = mapToEmailCard(row.message, row.classification);
    buckets[card.suggestedBucket].push(card);
  }

  const brief = aggregateBrief(rows.map(toClassificationRecord));

  return { brief, buckets };
}
