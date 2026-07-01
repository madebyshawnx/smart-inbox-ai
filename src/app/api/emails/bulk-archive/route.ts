import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadEmailGmailRef, loadEmailIdsByBucket } from "@/lib/email-actions";
import { archiveMessage } from "@/lib/google/gmail-actions";
import { getAccessToken } from "@/lib/google/tokens";

/**
 * Accept EITHER an explicit list of internal email ids OR a bucket key. Exactly
 * one must be provided. A bucket key resolves to every email whose
 * classification lands in that bucket.
 */
const bulkArchiveSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).optional(),
    bucketKey: z.string().min(1).optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.bucketKey !== undefined), {
    message: "Provide exactly one of `ids` or `bucketKey`.",
  });

/**
 * POST /api/emails/bulk-archive
 *
 * Body: `{ ids: string[] }` OR `{ bucketKey: string }`. Archives each resolved
 * email in Gmail (remove INBOX label — reversible, never trashed/deleted).
 * Best-effort per item: one failure never aborts the batch.
 *
 * Returns `{ ok: true, archived, errors, skipped, total }` where `skipped`
 * counts non-Gmail (sample fixture) rows that have no Gmail id.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = bulkArchiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk-archive payload.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Resolve the target internal email ids (explicit list or bucket lookup).
  let emailIds: string[];
  try {
    emailIds =
      parsed.data.ids ?? (await loadEmailIdsByBucket(prisma, parsed.data.bucketKey as string));
  } catch (err) {
    console.error("[emails/bulk-archive] resolving target ids failed:", err);
    return NextResponse.json({ error: "Couldn't resolve emails to archive." }, { status: 500 });
  }

  if (emailIds.length === 0) {
    return NextResponse.json({ ok: true, archived: 0, errors: 0, skipped: 0, total: 0 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(prisma);
  } catch (err) {
    console.error("[emails/bulk-archive] getAccessToken failed:", err);
    return NextResponse.json(
      { error: "Couldn't reach Gmail. Try reconnecting Gmail and retry." },
      { status: 502 },
    );
  }

  let archived = 0;
  let errors = 0;
  let skipped = 0;

  // Best-effort per item: resolve each id to its Gmail id and archive. A single
  // failure is counted and the batch continues.
  await Promise.all(
    emailIds.map(async (emailMessageId) => {
      const email = await loadEmailGmailRef(prisma, emailMessageId).catch(() => null);
      if (email === null || email.gmailMessageId === null) {
        skipped += 1;
        return;
      }
      try {
        await archiveMessage(accessToken, email.gmailMessageId);
        archived += 1;
      } catch (err) {
        errors += 1;
        console.error(`[emails/bulk-archive] item failed emailMessageId=${emailMessageId}:`, err);
      }
    }),
  );

  console.info(
    `[emails/bulk-archive] archived=${archived} errors=${errors} skipped=${skipped} total=${emailIds.length}`,
  );
  return NextResponse.json({
    ok: true,
    archived,
    errors,
    skipped,
    total: emailIds.length,
  });
}
