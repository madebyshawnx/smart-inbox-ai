import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { screenSender } from "@/lib/feedback";
import { getAccessToken } from "@/lib/google/tokens";
import { archiveStoredBySender } from "@/lib/sync";

const screenSchema = z.object({
  senderEmail: z.string().email().max(254),
  // Optional display name for a nicer rule text; falls back to the email.
  senderName: z.string().optional(),
  decision: z.enum(["in", "out"]),
  // When true and decision is "out", also archive that sender's existing stored
  // mail (reversible). Ignored for "in".
  archiveExisting: z.boolean().optional(),
});

/**
 * POST /api/senders/screen
 *
 * Body: `{ senderEmail, senderName?, decision: "in" | "out", archiveExisting? }`.
 *
 * Reuses the Smart-Rules machinery — NO new table:
 *  - "in"  → creates a prioritize rule for the sender (deduped).
 *  - "out" → creates an ignore rule for the sender (deduped).
 *
 * When `decision: "out"` and `archiveExisting: true`, the sender's existing
 * stored mail is archived (reversible; best-effort per item). Archiving failures
 * never turn the successful rule write into a 500.
 *
 * Returns `{ ok: true, decision, ruleCreated, ruleText, archived?, archiveErrors? }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = screenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid screen payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { senderEmail, senderName, decision, archiveExisting } = parsed.data;

  // Write the rule first — this is the durable intent. It must succeed even if
  // the optional archive step later fails.
  let result: Awaited<ReturnType<typeof screenSender>>;
  try {
    result = await screenSender(prisma, senderEmail, senderName ?? "", decision);
  } catch (err) {
    console.error(`[senders/screen] decision=${decision} senderEmail=${senderEmail} failed:`, err);
    return NextResponse.json({ error: "Could not screen this sender." }, { status: 500 });
  }

  console.info(
    `[senders/screen] decision=${decision} senderEmail=${senderEmail} ruleCreated=${result.ruleCreated}`,
  );

  // Best-effort bulk archive of existing mail when screening a sender out.
  let archived: number | undefined;
  let archiveErrors: number | undefined;
  if (decision === "out" && archiveExisting === true) {
    try {
      const accessToken = await getAccessToken(prisma);
      const counts = await archiveStoredBySender(prisma, senderEmail, accessToken);
      archived = counts.archived;
      archiveErrors = counts.errors;
      console.info(
        `[senders/screen] archived existing senderEmail=${senderEmail} archived=${counts.archived} errors=${counts.errors}`,
      );
    } catch (err) {
      // Swallow — the screening rule is already saved; archiving is a bonus.
      console.error(
        `[senders/screen] archiveStoredBySender senderEmail=${senderEmail} failed:`,
        err,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    decision,
    ruleCreated: result.ruleCreated,
    ruleText: result.ruleText,
    ...(archived !== undefined ? { archived, archiveErrors } : {}),
  });
}
