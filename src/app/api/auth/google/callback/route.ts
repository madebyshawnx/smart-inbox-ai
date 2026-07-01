import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProfileEmail } from "@/lib/google/gmail";
import { createOAuthClient, exchangeCodeForTokens } from "@/lib/google/oauth";
import { saveConnectedAccount } from "@/lib/google/tokens";

const STATE_COOKIE = "google_oauth_state";

function redirectHome(
  request: Request,
  status: "connected" | "error",
  reason?: string,
): NextResponse {
  const url = new URL(`/?gmail=${status}`, request.url);
  // Surface the real failure reason in the URL so the app can show it on screen
  // (single-user debug aid) instead of forcing a Vercel-logs dig. Truncated.
  if (reason) {
    url.searchParams.set("reason", reason.slice(0, 200));
  }
  const res = NextResponse.redirect(url);
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
    const why = !code
      ? "no_code_from_google"
      : !state
        ? "no_state_from_google"
        : !expectedState
          ? "state_cookie_missing_on_return"
          : "state_mismatch";
    return redirectHome(request, "error", `oauth_state_check_failed:${why}`);
  }

  // Track which phase we're in so a thrown error maps to a STABLE reason code
  // instead of leaking the raw err.message (which can carry tokens, provider
  // internals, or DB/crypto detail) into the redirect URL. Anything outside a
  // known phase falls through to the neutral "unexpected_error".
  let phase: "connect" | "persist" | "unexpected" = "unexpected";
  try {
    phase = "connect";
    const client = createOAuthClient();
    const tokens = await exchangeCodeForTokens(client, code);
    const email = await getProfileEmail(tokens.accessToken);

    // Everything past here is persistence/crypto — a failure is account_save_failed.
    phase = "persist";
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
    // silently bouncing back with ?gmail=error. The URL only ever gets a stable
    // code — never err.message.
    console.error("[auth/google/callback] connect failed:", err);
    const reason =
      phase === "persist"
        ? "account_save_failed"
        : phase === "connect"
          ? "connect_failed"
          : "unexpected_error";
    return redirectHome(request, "error", reason);
  }
}
