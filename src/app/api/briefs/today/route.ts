import { NextResponse } from "next/server";
import { loadDashboardData } from "@/lib/dashboard-data";

/**
 * GET /api/briefs/today
 *
 * Returns the full dashboard payload (daily brief + emails grouped by bucket)
 * built from the persisted classifications. On any failure returns a 500 with a
 * generic message rather than leaking internals.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const data = await loadDashboardData();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not load today's brief." }, { status: 500 });
  }
}
