import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { applyFeedback } from "@/lib/feedback";
import { ALLOWED_FEEDBACK_TYPES } from "@/lib/persistence";
import { reclassifyStoredBySender } from "@/lib/sync";

const feedbackSchema = z.object({
  emailMessageId: z.string().min(1),
  feedbackType: z.enum(ALLOWED_FEEDBACK_TYPES),
  feedbackNotes: z.string().optional(),
});

/**
 * POST /api/feedback
 *
 * Body: `{ emailMessageId, feedbackType, feedbackNotes? }`. Validated with zod;
 * malformed input returns 400. On success records the feedback, triggers a
 * bounded re-classification of that sender's already-stored mail so the
 * correction visibly takes effect, and returns
 * `{ ok: true, ruleCreated, ruleText, reclassified }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid feedback payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof applyFeedback>>;
  try {
    result = await applyFeedback(prisma, parsed.data);
  } catch {
    return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  }

  // The feedback is now durably saved. Re-classifying the sender's stored mail is
  // a best-effort follow-up: a missing Anthropic key or a model error must NOT
  // turn a successful save into a 500, so failures here are logged and swallowed.
  let reclassified = 0;
  if (result.senderEmail !== null) {
    try {
      const counts = await reclassifyStoredBySender(prisma, result.senderEmail);
      reclassified = counts.reclassified + counts.needsReview;
    } catch (err) {
      console.error("[feedback] reclassifyStoredBySender failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    ruleCreated: result.ruleCreated,
    ruleText: result.ruleText,
    reclassified,
  });
}
