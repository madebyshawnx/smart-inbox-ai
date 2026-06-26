import { OAuth2Client } from "google-auth-library";

/**
 * Gmail OAuth wiring. Read-only is the narrowest scope that still lets us read
 * message content for classification — we never request send/modify/delete.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const PROVIDER = "google";

export { PROVIDER as GOOGLE_PROVIDER };

export function createOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI) are not set");
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/**
 * Build the consent-screen URL. `access_type: offline` + `prompt: consent` are
 * what make Google return a refresh token (without them you only get a
 * short-lived access token and cannot sync later).
 */
export function buildAuthUrl(client: OAuth2Client, state: string): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });
}

export type ExchangedTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string;
};

/**
 * Exchange an authorization code for tokens. Throws if Google did not return an
 * access token.
 */
export async function exchangeCodeForTokens(
  client: OAuth2Client,
  code: string,
): Promise<ExchangedTokens> {
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? GMAIL_SCOPES.join(" "),
  };
}
