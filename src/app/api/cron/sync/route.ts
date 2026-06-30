import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConnectedAccount } from "@/lib/google/tokens";
import { runSync } from "@/lib/sync";

/**
 * GET /api/cron/sync
 *
 * Background auto-sync, invoked by Vercel Cron (see `vercel.json`). Re-syncs the
 * connected Gmail account so the inbox stays fresh without the user clicking
 * "Sync".
 *
 * Auth: when `CRON_SECRET` is set, the request must carry
 * `authorization: Bearer <CRON_SECRET>`. Vercel sends this header automatically
 * for cron invocations when the env var is configured. With no `CRON_SECRET`
 * set (local/dev), the endpoint is open so it can be exercised by hand.
 *
 * The endpoint is deliberately quiet: a missing account returns 200 (cron should
 * not error on an un-connected inbox), and failures return a generic 500 without
 * leaking detail.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret !== undefined && cronSecret !== "") {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Quietly no-op when no inbox is connected — cron firing on an un-connected
  // account is expected, not an error.
  const account = await getConnectedAccount(prisma);
  if (account === null) {
    return NextResponse.json({ skipped: true, reason: "no account" });
  }

  try {
    const counts = await runSync(prisma);
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    console.error("[cron/sync] runSync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
