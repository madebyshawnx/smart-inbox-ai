import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const dismissSchema = z.object({
  signature: z.string().trim().min(1),
});

/**
 * POST /api/suggestions/dismiss
 *
 * Body: `{ signature }`. Records a DismissedSuggestion so the matching
 * suggestion is never proposed again. Idempotent — a duplicate dismissal (unique
 * constraint) is treated as success. Malformed input returns 400.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = dismissSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid dismiss payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await prisma.dismissedSuggestion.create({ data: { signature: parsed.data.signature } });
  } catch {
    // Already dismissed — unique constraint hit, which is a no-op success.
  }

  return NextResponse.json({ ok: true });
}
