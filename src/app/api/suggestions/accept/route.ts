import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ensureActiveRule } from "@/lib/rules";

const acceptSchema = z.object({
  ruleText: z.string().trim().min(1).max(280),
  priorityWeight: z.number().int().optional(),
});

const VALIDATION_MESSAGES = new Set(["ruleText is required", "ruleText too long"]);

/**
 * POST /api/suggestions/accept
 *
 * Body: `{ ruleText, priorityWeight? }`. Creates the Smart Rule (idempotently)
 * AND records a DismissedSuggestion keyed by the ruleText so the same
 * suggestion is never proposed again. Returns `{ ok: true, ruleCreated }`.
 * Malformed input returns 400.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid suggestion payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { created } = await ensureActiveRule(prisma, parsed.data);

    // Record the signature (== ruleText) so the suggestion doesn't resurface.
    // Tolerate a unique-constraint race if it was already recorded.
    try {
      await prisma.dismissedSuggestion.create({ data: { signature: parsed.data.ruleText } });
    } catch {
      // Already dismissed/accepted — nothing more to do.
    }

    return NextResponse.json({ ok: true, ruleCreated: created });
  } catch (error) {
    if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not accept suggestion." }, { status: 500 });
  }
}
