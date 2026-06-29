import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConnectedAccount } from "@/lib/google/tokens";

/**
 * GET /api/auth/google/status
 *
 * Reports whether a Gmail account is connected (and which address), so the UI
 * can show connect vs. connected state. Never returns tokens.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const account = await getConnectedAccount(prisma);
    if (account === null) {
      return NextResponse.json({ connected: false });
    }
    return NextResponse.json({
      connected: true,
      email: account.email,
      connectedAt: account.connectedAt,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
