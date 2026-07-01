import type { PrismaClient } from "@prisma/client";
import { type FeedbackType, isAllowedFeedbackType } from "./persistence";

/**
 * Read-back of the user's recent feedback for the "What I've learned" panel.
 *
 * Everything else in the feedback loop *writes* into UserFeedback (and derives
 * Smart Rules / per-sender guidance from it); nothing read it back for display.
 * This module is that read path: it joins UserFeedback → EmailMessage so each
 * stored correction can be shown with the sender + subject it was given against.
 *
 * Like the rest of the lib layer the Prisma client is injected so this is
 * trivially unit-testable without a database — this module never imports the
 * `prisma` singleton.
 */

// How many recent corrections the panel shows. Bounded so the query stays cheap
// and the panel never turns into an unbounded audit log.
export const FEEDBACK_HISTORY_LIMIT = 15;

// The shape the UI consumes. Declared explicitly (rather than derived from
// Prisma's payload generics) so the API contract is stable and tests can build
// plain objects that satisfy it.
export type FeedbackHistoryItem = {
  id: string;
  feedbackType: FeedbackType;
  senderName: string;
  senderEmail: string;
  subject: string;
  // ISO string so it serialises cleanly across the API boundary.
  createdAt: string;
};

/**
 * Load the most recent feedback the user has given, newest first, each joined to
 * the email (sender + subject) it was given against.
 *
 * Rows whose email is missing (e.g. deleted) or whose stored `feedbackType` is
 * not a known type are skipped, so the caller always gets well-formed items.
 */
export async function loadFeedbackHistory(
  db: PrismaClient,
  limit: number = FEEDBACK_HISTORY_LIMIT,
): Promise<FeedbackHistoryItem[]> {
  const rows = await db.userFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      feedbackType: true,
      createdAt: true,
      emailMessage: { select: { senderName: true, senderEmail: true, subject: true } },
    },
  });

  const items: FeedbackHistoryItem[] = [];
  for (const row of rows) {
    if (row.emailMessage === null || row.emailMessage === undefined) {
      continue;
    }
    if (!isAllowedFeedbackType(row.feedbackType)) {
      continue;
    }
    items.push({
      id: row.id,
      feedbackType: row.feedbackType,
      senderName: row.emailMessage.senderName,
      senderEmail: row.emailMessage.senderEmail,
      subject: row.emailMessage.subject,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return items;
}
