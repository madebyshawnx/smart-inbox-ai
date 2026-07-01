import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadEmailGmailRef } from "@/lib/email-actions";
import { archiveMessage, unarchiveMessage } from "@/lib/google/gmail-actions";
import { getAccessToken } from "@/lib/google/tokens";

const archiveSchema = z
  .object({
    // When true, this is an UNDO — re-add the INBOX label instead of removing it.
    undo: z.boolean().optional(),
  })
  .optional();

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/emails/[id]/archive
 *
 * Body: `{ undo?: true }`. Archives the email (Gmail: remove the INBOX label) or,
 * with `undo: true`, un-archives it (add INBOX back). Never trashes or deletes.
 *
 * Looks up the email + its Gmail message id from the DB, gets a fresh access
 * token, calls the Gmail modify API, logs an audit line, and fails soft with a
 * clear error. Returns `{ ok: true, action }`.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  // Body is optional; tolerate an empty/absent body (undo defaults to false).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const parsed = archiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid archive payload." }, { status: 400 });
  }
  const undo = parsed.data?.undo === true;
  const action = undo ? "unarchive" : "archive";

  const email = await loadEmailGmailRef(prisma, id).catch(() => null);
  if (email === null) {
    return NextResponse.json({ error: "Email not found." }, { status: 404 });
  }
  if (email.gmailMessageId === null) {
    return NextResponse.json(
      { error: "This email is not a Gmail message and cannot be archived." },
      { status: 400 },
    );
  }

  try {
    const accessToken = await getAccessToken(prisma);
    if (undo) {
      await unarchiveMessage(accessToken, email.gmailMessageId);
    } else {
      await archiveMessage(accessToken, email.gmailMessageId);
    }
    // Server-side audit only (no persistent audit table this wave).
    console.info(
      `[emails/archive] action=${action} emailMessageId=${email.id} gmailMessageId=${email.gmailMessageId}`,
    );
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    console.error(`[emails/archive] action=${action} emailMessageId=${email.id} failed:`, err);
    // Never leak tokens/stack. Nudge toward reconnect since the usual cause is a
    // missing write scope or an expired grant.
    return NextResponse.json(
      { error: "Couldn't update this email in Gmail. Try reconnecting Gmail and retry." },
      { status: 502 },
    );
  }
}
