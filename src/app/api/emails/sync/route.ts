import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAccessToken } from "@/lib/google/tokens";
import { runSync } from "@/lib/sync";

/**
 * POST /api/emails/sync
 *
 * Pull the most recent inbox messages from the connected Gmail account, classify
 * them through the same pipeline as the sample flow (applying the user's Smart
 * Rules), and persist the results. Read-only: nothing is sent, modified, or
 * deleted in the mailbox.
 *
 * The core logic lives in {@link runSync} so the background cron endpoint can
 * reuse it. This route keeps the manual-trigger concerns: request parsing, the
 * "no account connected" 400, and the generic 500.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Optional `{ reclassify: true }` forces a fresh pass over every email (e.g.
  // after the user changes Smart Rules). Default skips already-triaged emails.
  let reclassify = false;
  try {
    const text = await request.text();
    if (text.trim() !== "") {
      const body = JSON.parse(text) as { reclassify?: unknown };
      reclassify = body.reclassify === true;
    }
  } catch {
    // Malformed body is non-fatal; fall back to the default (skip known emails).
  }

  // Surface "no Gmail connected" as a distinct 400 before doing any work, so the
  // UI can prompt the user to connect rather than showing a generic error.
  try {
    await getAccessToken(prisma);
  } catch {
    return NextResponse.json(
      { error: "No Gmail account is connected. Connect Gmail first." },
      { status: 400 },
    );
  }

  try {
    const counts = await runSync(prisma, { reclassify });
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ error: "Could not sync Gmail. Please try again." }, { status: 500 });
  }
}
