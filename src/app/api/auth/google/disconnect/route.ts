import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { disconnectAccount } from "@/lib/google/tokens";

/**
 * POST /api/auth/google/disconnect
 *
 * Removes the stored Gmail connection (and its encrypted tokens). Classified
 * emails already in the dashboard are left in place; this only revokes our
 * stored access.
 */
export async function POST(): Promise<NextResponse> {
  try {
    await disconnectAccount(prisma);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not disconnect Gmail." }, { status: 500 });
  }
}
