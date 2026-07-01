import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasWriteScopes } from "@/lib/google/oauth";
import { getConnectedAccount } from "@/lib/google/tokens";

/**
 * GET /api/auth/google/status
 *
 * Reports whether a Gmail account is connected (and which address), so the UI
 * can show connect vs. connected state. Also reports `canWrite`: whether the
 * stored grant includes BOTH write scopes (gmail.modify + gmail.compose) needed
 * for archive and draft-reply. An account connected before write scopes existed
 * returns `canWrite: false`, so the UI can prompt a reconnect. Never returns
 * tokens or the raw scope string.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const account = await getConnectedAccount(prisma);
    if (account === null) {
      return NextResponse.json({ connected: false, canWrite: false });
    }
    return NextResponse.json({
      connected: true,
      email: account.email,
      connectedAt: account.connectedAt,
      canWrite: hasWriteScopes(account.scopes),
    });
  } catch {
    return NextResponse.json({ connected: false, canWrite: false });
  }
}
