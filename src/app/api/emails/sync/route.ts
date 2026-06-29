import { NextResponse } from "next/server";
import { createAnthropicClient } from "@/lib/classification/anthropic-client";
import { classifyEmail } from "@/lib/classification/classify";
import { prisma } from "@/lib/db";
import { fetchRecentEmails } from "@/lib/google/gmail";
import { getAccessToken } from "@/lib/google/tokens";
import { findClassifiedSourceIds, saveClassifiedEmail } from "@/lib/persistence";
import { loadActiveRuleTexts } from "@/lib/rules";

// Keep the first sync modest: enough to be useful, small enough to stay fast
// and cheap. Pagination/incremental sync can raise this later.
const SYNC_LIMIT = 25;

/**
 * POST /api/emails/sync
 *
 * Pull the most recent inbox messages from the connected Gmail account, classify
 * them through the same pipeline as the sample flow (applying the user's Smart
 * Rules), and persist the results. Read-only: nothing is sent, modified, or
 * deleted in the mailbox.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Optional `{ reclassify: true }` forces a fresh pass over every email (e.g.
  // after the user changes Smart Rules). Default skips already-triaged emails.
  let reclassify = false;
  try {
    const text = await request.text();
    if (text.trim() !== "") {
      const body = JSON.parse(text) as { reclassify?: unknown };
      reclassify = body.reclassify === true;
    }
  } catch {
    // Malformed body is non-fatal; fall back to the default (skip known emails).
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(prisma);
  } catch {
    return NextResponse.json(
      { error: "No Gmail account is connected. Connect Gmail first." },
      { status: 400 },
    );
  }

  try {
    const emails = await fetchRecentEmails(accessToken, SYNC_LIMIT);
    if (emails.length === 0) {
      return NextResponse.json({ classified: 0, needsReview: 0, skipped: 0, total: 0 });
    }

    // Skip emails already triaged so we never pay the LLM to re-decide them,
    // unless the caller forced a re-classification.
    const alreadyClassified = reclassify
      ? new Set<string>()
      : await findClassifiedSourceIds(
          prisma,
          emails.map((email) => email.sourceId),
        );
    const toClassify = emails.filter((email) => !alreadyClassified.has(email.sourceId));

    if (toClassify.length === 0) {
      return NextResponse.json({
        classified: 0,
        needsReview: 0,
        skipped: emails.length,
        total: emails.length,
      });
    }

    const client = createAnthropicClient();
    const rules = await loadActiveRuleTexts(prisma);

    const classifications = await Promise.all(
      toClassify.map((email) => classifyEmail(email, client, { rules })),
    );

    let classified = 0;
    let needsReview = 0;
    for (let i = 0; i < toClassify.length; i++) {
      const result = classifications[i];
      await saveClassifiedEmail(prisma, toClassify[i], result);
      if (result.status === "needs_review") {
        needsReview += 1;
      } else {
        classified += 1;
      }
    }

    return NextResponse.json({
      classified,
      needsReview,
      skipped: emails.length - toClassify.length,
      total: emails.length,
    });
  } catch {
    return NextResponse.json({ error: "Could not sync Gmail. Please try again." }, { status: 500 });
  }
}
