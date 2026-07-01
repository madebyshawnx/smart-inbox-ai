import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRule } from "@/lib/rules";

/**
 * POST /api/onboarding
 *
 * Batch-creates the Smart Rules produced by the first-run priority questionnaire.
 * Body: `{ rules: { ruleText, priorityWeight? }[] }`. Validated with zod;
 * malformed input returns 400. Each rule is created via the same `createRule`
 * helper the Smart Rules UI uses, so all the usual validation and default-profile
 * resolution applies. Returns `{ created: SmartRuleDTO[] }` with 201.
 *
 * Creating each rule individually (rather than a single bulk insert) keeps the
 * default-profile resolution and per-rule validation identical to the rest of the
 * app, and the volume here is tiny (a handful of rules at most).
 */

const VALIDATION_MESSAGES = new Set(["ruleText is required", "ruleText too long"]);

const onboardingSchema = z.object({
  rules: z
    .array(
      z.object({
        ruleText: z.string().trim().min(1).max(280),
        priorityWeight: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid onboarding payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // All-or-nothing: create every rule inside one transaction so a mid-loop
    // failure can't leave the user with a half-applied onboarding set. The
    // failing index is logged for diagnosis before the error propagates out.
    const created = await prisma.$transaction(async (tx) => {
      const out: Awaited<ReturnType<typeof createRule>>[] = [];
      for (let i = 0; i < parsed.data.rules.length; i++) {
        try {
          out.push(await createRule(tx as typeof prisma, parsed.data.rules[i]));
        } catch (err) {
          console.error(`[onboarding] createRule failed at index ${i}:`, err);
          throw err;
        }
      }
      return out;
    });
    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not create onboarding rules." }, { status: 500 });
  }
}
