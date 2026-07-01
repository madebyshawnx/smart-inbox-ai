import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractGmailMessageId, loadEmailIdsByBucket } from "@/lib/email-actions";
import { archiveMessage } from "@/lib/google/gmail-actions";
import { getAccessToken } from "@/lib/google/tokens";

// Upper bound on how many emails one request may archive. Caps the DB scan, the
// Gmail fan-out, and the blast radius of a single call.
const MAX_BULK_IDS = 200;

// Archive at most this many messages concurrently. Bounds pressure on the Gmail
// API (avoids a 200-wide burst) while staying much faster than fully serial.
const ARCHIVE_CONCURRENCY = 8;

/**
 * Accept EITHER an explicit list of internal email ids OR a bucket key. Exactly
 * one must be provided. A bucket key resolves to every email whose
 * classification lands in that bucket. Explicit id lists are capped at
 * {@link MAX_BULK_IDS}.
 */
const bulkArchiveSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(MAX_BULK_IDS).optional(),
    bucketKey: z.string().min(1).optional(),
  })
  .refine((v) => (v.ids !== undefined) !== (v.bucketKey !== undefined), {
    message: "Provide exactly one of `ids` or `bucketKey`.",
  });

/** Run `worker` over `items` with at most `size` in flight at once. */
async function inBatches<T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

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

  // Cap the resolved set (a bucket can resolve to more than the per-request
  // limit) so the fan-out stays bounded regardless of how ids were supplied.
  if (emailIds.length > MAX_BULK_IDS) {
    emailIds = emailIds.slice(0, MAX_BULK_IDS);
  }

  if (emailIds.length === 0) {
    return NextResponse.json({ ok: true, archived: 0, errors: 0, skipped: 0, total: 0 });
  }

  // Resolve every id to its Gmail id in ONE query (no per-id N+1), then look up
  // each id via a Map. Rows missing (deleted) or non-Gmail (sample fixtures with
  // no gmail: prefix) have no Gmail id and are skipped, not errored.
  let refs: Array<{ id: string; sourceId: string }>;
  try {
    refs = await prisma.emailMessage.findMany({
      where: { id: { in: emailIds } },
      select: { id: true, sourceId: true },
    });
  } catch (err) {
    console.error("[emails/bulk-archive] resolving Gmail refs failed:", err);
    return NextResponse.json({ error: "Couldn't resolve emails to archive." }, { status: 500 });
  }
  const gmailIdById = new Map<string, string | null>(
    refs.map((row) => [row.id, extractGmailMessageId(row.sourceId)]),
  );

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

  // Best-effort per item with BOUNDED concurrency: a single failure is counted
  // and the batch continues.
  await inBatches(emailIds, ARCHIVE_CONCURRENCY, async (emailMessageId) => {
    const gmailMessageId = gmailIdById.get(emailMessageId) ?? null;
    if (gmailMessageId === null) {
      skipped += 1;
      return;
    }
    try {
      await archiveMessage(accessToken, gmailMessageId);
      archived += 1;
    } catch (err) {
      errors += 1;
      console.error(`[emails/bulk-archive] item failed emailMessageId=${emailMessageId}:`, err);
    }
  });

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
