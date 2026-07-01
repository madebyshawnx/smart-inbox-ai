import type { PrismaClient } from "@prisma/client";

/**
 * Shared lookup for Tier 1 email actions (archive / draft). Resolves an internal
 * EmailMessage id to the Gmail message id + thread id the write helpers need.
 *
 * The stored `sourceId` is `gmail:<messageId>` (see gmail.ts normalizeGmailMessage).
 * We strip the `gmail:` prefix here so callers get the bare Gmail id. Emails that
 * are sample fixtures (no `gmail:` prefix) return `gmailMessageId: null`, letting
 * routes fail soft with a clear "not a Gmail message" error instead of calling
 * the Gmail API with a bad id.
 *
 * Prisma is injected so this is unit-testable with a mock.
 */

export type EmailGmailRef = {
  id: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  threadId: string | null;
  // Bare Gmail message id (sourceId with the `gmail:` prefix stripped), or null
  // when the stored message did not originate from Gmail.
  gmailMessageId: string | null;
  // The joined classification, when present — the draft flow needs its summary
  // and recommended next step as trusted triage context.
  classification: {
    summary: string;
    recommendedNextStep: string;
  } | null;
};

const GMAIL_SOURCE_PREFIX = "gmail:";

/** Strip the `gmail:` prefix from a sourceId, or null if it isn't a Gmail id. */
export function extractGmailMessageId(sourceId: string): string | null {
  if (!sourceId.startsWith(GMAIL_SOURCE_PREFIX)) {
    return null;
  }
  const id = sourceId.slice(GMAIL_SOURCE_PREFIX.length);
  return id === "" ? null : id;
}

/**
 * Resolve the internal EmailMessage ids whose classification's suggestedBucket
 * matches the given bucket key. Used by bulk cleanup so the UI can archive an
 * entire bucket (e.g. "safe_to_ignore") by key instead of enumerating ids.
 */
export async function loadEmailIdsByBucket(db: PrismaClient, bucketKey: string): Promise<string[]> {
  const rows = await db.emailMessage.findMany({
    where: { classification: { suggestedBucket: bucketKey } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function loadEmailGmailRef(
  db: PrismaClient,
  emailMessageId: string,
): Promise<EmailGmailRef | null> {
  const row = (await db.emailMessage.findUnique({
    where: { id: emailMessageId },
    include: { classification: true },
  })) as {
    id: string;
    sourceId: string;
    threadId: string | null;
    senderName: string;
    senderEmail: string;
    subject: string;
    bodyText: string;
    receivedAt: Date;
    classification: { summary: string; recommendedNextStep: string } | null;
  } | null;

  if (row === null) {
    return null;
  }

  return {
    id: row.id,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    subject: row.subject,
    bodyText: row.bodyText,
    receivedAt: row.receivedAt,
    threadId: row.threadId,
    gmailMessageId: extractGmailMessageId(row.sourceId),
    classification: row.classification
      ? {
          summary: row.classification.summary,
          recommendedNextStep: row.classification.recommendedNextStep,
        }
      : null,
  };
}
