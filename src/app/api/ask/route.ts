import { NextResponse } from "next/server";
import { z } from "zod";
import { type AskEmail, answerQuestion } from "@/lib/ask/answer";
import { createAnthropicClient } from "@/lib/classification/anthropic-client";
import { prisma } from "@/lib/db";
import { type ClassifiedEmailRow, loadClassifiedEmails } from "@/lib/persistence";

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
});

const EMPTY_INBOX_ANSWER = "Your inbox hasn't been triaged yet — connect Gmail and sync first.";

function toAskEmail(row: ClassifiedEmailRow): AskEmail {
  return {
    senderName: row.message.senderName,
    senderEmail: row.message.senderEmail,
    subject: row.message.subject,
    receivedAt: row.message.receivedAt.toISOString(),
    summary: row.classification.summary,
    whyThisMatters: row.classification.whyThisMatters,
    priorityLevel: row.classification.priorityLevel,
    suggestedBucket: row.classification.suggestedBucket,
    recommendedNextStep: row.classification.recommendedNextStep,
    detectedDeadline: row.classification.detectedDeadline,
  };
}

/**
 * POST /api/ask
 *
 * Body: `{ question: string }` (non-empty, max 500 chars). Validated with zod;
 * malformed input returns 400.
 *
 * Loads the user's already-triaged emails and asks the model to answer the
 * question grounded ONLY in those emails. Read-only — no Gmail writes, no new
 * scopes. When nothing has been triaged yet it returns a friendly nudge instead
 * of calling the model. Errors return a generic 500 so the API key and stack
 * traces never leak to the client.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ask your inbox a question (1–500 characters).", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const rows = await loadClassifiedEmails(prisma);
    if (rows.length === 0) {
      return NextResponse.json({ answer: EMPTY_INBOX_ANSWER });
    }

    const emails = rows.map(toAskEmail);
    const answer = await answerQuestion(emails, parsed.data.question, createAnthropicClient());
    return NextResponse.json({ answer });
  } catch {
    // Never surface the underlying error: it can contain the API key or stack.
    return NextResponse.json(
      { error: "Couldn't answer your question. Please try again." },
      { status: 500 },
    );
  }
}
