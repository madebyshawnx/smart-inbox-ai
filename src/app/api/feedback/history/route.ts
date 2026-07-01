import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadFeedbackHistory } from "@/lib/feedback-history";

/**
 * GET /api/feedback/history
 *
 * Returns the user's most recent feedback as `{ items }`, each joined to the
 * sender + subject it was given against. Read-only; powers the "What I've
 * learned" panel. On any failure returns a generic 500 so internal details
 * don't leak.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const items = await loadFeedbackHistory(prisma);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Could not load feedback history." }, { status: 500 });
  }
}
