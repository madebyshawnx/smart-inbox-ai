import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProfileEmail } from "@/lib/google/gmail";
import { createOAuthClient, exchangeCodeForTokens } from "@/lib/google/oauth";
import { saveConnectedAccount } from "@/lib/google/tokens";

const STATE_COOKIE = "google_oauth_state";

function redirectHome(request: Request, status: "connected" | "error"): NextResponse {
  const res = NextResponse.redirect(new URL(`/?gmail=${status}`, request.url));
  res.cookies.delete(STATE_COOKIE);
  return res;
}

/**
 * GET /api/auth/google/callback
 *
 * Google redirects here with `code` + `state`. We verify `state` against the
 * cookie (CSRF), exchange the code for tokens, record the connected mailbox with
 * its tokens encrypted, then bounce back to the dashboard. Tokens are never put
 * in the URL or logged.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectHome(request, "error");
  }

  try {
    const client = createOAuthClient();
    const tokens = await exchangeCodeForTokens(client, code);
    const email = await getProfileEmail(tokens.accessToken);

    await saveConnectedAccount(prisma, {
      email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiryDate: tokens.expiryDate,
      scope: tokens.scope,
    });

    return redirectHome(request, "connected");
  } catch (err) {
    // Log the real cause (token exchange / profile fetch / token encryption /
    // DB write) so a failed connect is diagnosable in Vercel logs instead of
    // silently bouncing back with ?gmail=error.
    console.error("[auth/google/callback] connect failed:", err);
    return redirectHome(request, "error");
  }
}
