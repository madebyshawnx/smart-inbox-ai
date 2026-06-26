import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { applyFeedback } from "@/lib/feedback";
import { ALLOWED_FEEDBACK_TYPES } from "@/lib/persistence";

const feedbackSchema = z.object({
  emailMessageId: z.string().min(1),
  feedbackType: z.enum(ALLOWED_FEEDBACK_TYPES),
  feedbackNotes: z.string().optional(),
});

/**
 * POST /api/feedback
 *
 * Body: `{ emailMessageId, feedbackType, feedbackNotes? }`. Validated with zod;
 * malformed input returns 400. On success records the feedback and returns
 * `{ ok: true }`.
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

  try {
    const result = await applyFeedback(prisma, parsed.data);
    return NextResponse.json({
      ok: true,
      ruleCreated: result.ruleCreated,
      ruleText: result.ruleText,
    });
  } catch {
    return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  }
}
