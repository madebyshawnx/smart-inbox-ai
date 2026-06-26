import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAuthUrl, createOAuthClient } from "@/lib/google/oauth";

const STATE_COOKIE = "google_oauth_state";

/**
 * GET /api/auth/google/connect
 *
 * Kicks off the OAuth flow: mint a random `state`, stash it in an httpOnly
 * cookie for CSRF protection, and redirect the user to Google's consent screen.
 */
export function GET(): NextResponse {
  let url: string;
  let state: string;
  try {
    state = randomBytes(16).toString("hex");
    url = buildAuthUrl(createOAuthClient(), state);
  } catch {
    return NextResponse.json(
      { error: "Gmail connection is not configured on this server." },
      { status: 500 },
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    // localhost is http in dev; tighten to secure in production over https.
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
