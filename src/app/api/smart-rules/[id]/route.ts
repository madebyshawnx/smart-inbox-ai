import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { deleteRule, updateRule } from "@/lib/rules";

const updateRuleSchema = z
  .object({
    ruleText: z.string().trim().min(1).max(280).optional(),
    isActive: z.boolean().optional(),
    priorityWeight: z.number().int().optional(),
  })
  .refine(
    (patch) =>
      patch.ruleText !== undefined ||
      patch.isActive !== undefined ||
      patch.priorityWeight !== undefined,
    { message: "At least one field is required." },
  );

const VALIDATION_MESSAGES = new Set(["ruleText is required", "ruleText too long"]);

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/smart-rules/[id]
 *
 * Body: `{ ruleText?, isActive?, priorityWeight? }` with at least one field.
 * Validated with zod; malformed input returns 400. On success updates the rule
 * and returns `{ rule }`. Validation errors thrown by `updateRule` are mapped to
 * 400; everything else returns a generic 500.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = updateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid smart rule payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const rule = await updateRule(prisma, id, parsed.data);
    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not update smart rule." }, { status: 500 });
  }
}

/**
 * DELETE /api/smart-rules/[id]
 *
 * Deletes the rule and returns `{ ok: true }`. On any failure returns a generic
 * 500.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    await deleteRule(prisma, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete smart rule." }, { status: 500 });
  }
}
