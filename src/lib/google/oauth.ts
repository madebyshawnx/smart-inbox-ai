import { OAuth2Client } from "google-auth-library";

/**
 * Gmail OAuth wiring.
 *
 * - `gmail.readonly` lets us read message content for classification.
 * - `gmail.modify` lets us change labels (archive = remove INBOX, un-archive =
 *   add INBOX). It does NOT let us delete/trash — we never call trash/delete.
 * - `gmail.compose` lets us create DRAFT replies. We deliberately never request
 *   `gmail.send`: this app can draft a reply for the user to review, but it can
 *   never send mail on their behalf.
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
];

/**
 * The subset of {@link GMAIL_SCOPES} that grant WRITE access (label changes +
 * draft compose). An account connected before these scopes existed will have
 * only `gmail.readonly` stored, so the UI must prompt a reconnect before any
 * write action. {@link hasWriteScopes} is the pure check used for that gate.
 */
export const GMAIL_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
];

/**
 * Pure predicate: does a stored space-separated scope string include BOTH write
 * scopes? Google stores granted scopes as a single space-separated string (see
 * {@link ExchangedTokens.scope}); this parses that format without any DB or SDK
 * dependency so it is trivially unit-testable and reusable by the status route.
 */
export function hasWriteScopes(scopesString: string): boolean {
  const granted = new Set(scopesString.split(/\s+/).filter((s) => s !== ""));
  return GMAIL_WRITE_SCOPES.every((scope) => granted.has(scope));
}

const PROVIDER = "google";

export { PROVIDER as GOOGLE_PROVIDER };

export function createOAuthClient(): OAuth2Client {
  // Trim to defend against a stray trailing newline/space in the env value
  // (e.g. pasted into a hosting dashboard) — an untrimmed redirect URI causes
  // Google redirect_uri_mismatch.
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
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
