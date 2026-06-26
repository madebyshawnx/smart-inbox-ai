import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRule, listRules } from "@/lib/rules";

const createRuleSchema = z.object({
  ruleText: z.string().trim().min(1).max(280),
  priorityWeight: z.number().int().optional(),
});

const VALIDATION_MESSAGES = new Set(["ruleText is required", "ruleText too long"]);

/**
 * GET /api/smart-rules
 *
 * Returns all smart rules as `{ rules }`. On any failure returns a generic 500.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const rules = await listRules(prisma);
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ error: "Could not load smart rules." }, { status: 500 });
  }
}

/**
 * POST /api/smart-rules
 *
 * Body: `{ ruleText, priorityWeight? }`. Validated with zod; malformed input
 * returns 400. On success creates the rule and returns `{ rule }` with 201.
 * Validation errors thrown by `createRule` are mapped to 400; everything else
 * returns a generic 500.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid smart rule payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const rule = await createRule(prisma, parsed.data);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not create smart rule." }, { status: 500 });
  }
}
