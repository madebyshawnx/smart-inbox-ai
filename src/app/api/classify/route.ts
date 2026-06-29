import { NextResponse } from "next/server";
import { createAnthropicClient } from "@/lib/classification/anthropic-client";
import { classifyEmail, type RawEmail } from "@/lib/classification/classify";
import { prisma } from "@/lib/db";
import { saveClassifiedEmail } from "@/lib/persistence";
import { loadActiveRuleTexts } from "@/lib/rules";
import { sampleEmails } from "../../../../tests/fixtures/emails";

// The RawEmail fields that must be present, non-empty strings on any
// client-provided email. `threadId` is optional and validated separately.
const REQUIRED_STRING_FIELDS = [
  "sourceId",
  "senderName",
  "senderEmail",
  "subject",
  "bodyText",
  "receivedAt",
] as const;

function isRawEmail(value: unknown): value is RawEmail {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string" || record[field] === "") {
      return false;
    }
  }
  if (record.threadId !== undefined && typeof record.threadId !== "string") {
    return false;
  }
  return true;
}

function toRawEmail(value: RawEmail): RawEmail {
  return {
    sourceId: value.sourceId,
    threadId: value.threadId,
    senderName: value.senderName,
    senderEmail: value.senderEmail,
    subject: value.subject,
    bodyText: value.bodyText,
    receivedAt: value.receivedAt,
  };
}

/**
 * GET /api/classify
 *
 * Returns the sample emails available to classify, so the client can drive a
 * per-email progress counter by POSTing them one at a time.
 */
export function GET(): NextResponse {
  return NextResponse.json({ emails: sampleEmails.map(toRawEmail) });
}

/**
 * POST /api/classify
 *
 * Body: optional `{ emails?: RawEmail[] }`.
 *   - With `emails`, classifies exactly those (validated) emails.
 *   - Without a body / `emails`, classifies all sample fixtures (dev seed).
 *
 * Each email is classified, then persisted. Returns a compact summary. Errors
 * are caught and returned as a 500 with a generic message so the API key and
 * stack traces never leak to the client.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let emails: RawEmail[];

  try {
    const raw = await request.text();
    if (raw.trim() === "") {
      emails = sampleEmails.map(toRawEmail);
    } else {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
      }

      const provided = (body as { emails?: unknown }).emails;
      if (provided === undefined) {
        emails = sampleEmails.map(toRawEmail);
      } else if (!Array.isArray(provided) || !provided.every(isRawEmail)) {
        return NextResponse.json(
          { error: "`emails` must be an array of valid email objects." },
          { status: 400 },
        );
      } else {
        emails = provided.map(toRawEmail);
      }
    }
  } catch {
    return NextResponse.json({ error: "Could not read request body." }, { status: 400 });
  }

  try {
    const client = createAnthropicClient();

    // The user's trusted priority rules personalize every classification in
    // this run. Loaded once and passed in their own tagged section.
    const rules = await loadActiveRuleTexts(prisma);

    // Classify all emails in parallel — the LLM round-trips are the slow part,
    // so a batch of N runs in roughly the time of one instead of N in series.
    const classifications = await Promise.all(
      emails.map((email) => classifyEmail(email, client, { rules })),
    );

    // Persist sequentially: SQLite serializes writes, so concurrent upserts can
    // contend. The writes are fast, so order them rather than risk a lock.
    let classified = 0;
    let needsReview = 0;
    const results: Array<{ sourceId: string; status: string; suggestedBucket: string }> = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const result = classifications[i];
      await saveClassifiedEmail(prisma, email, result);

      if (result.status === "needs_review") {
        needsReview += 1;
      } else {
        classified += 1;
      }
      results.push({
        sourceId: email.sourceId,
        status: result.status,
        suggestedBucket: result.classification.suggested_bucket,
      });
    }

    return NextResponse.json({ classified, needsReview, results });
  } catch {
    // Never surface the underlying error: it can contain the API key or stack.
    return NextResponse.json(
      { error: "Classification failed. Please try again." },
      { status: 500 },
    );
  }
}
