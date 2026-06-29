import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeSuggestions } from "@/lib/suggestions";

/**
 * GET /api/suggestions
 *
 * Returns behavioral-learning suggestions as `{ suggestions }`. These are
 * proposed rules only — never auto-applied. On any failure returns a generic
 * 500 so internal details don't leak.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const suggestions = await computeSuggestions(prisma);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "Could not load suggestions." }, { status: 500 });
  }
}
