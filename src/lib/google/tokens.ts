import type { PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { createOAuthClient, GMAIL_SCOPES, GOOGLE_PROVIDER } from "./oauth";

/**
 * Stores and serves the connected Gmail account's OAuth tokens.
 *
 * Tokens are encrypted at rest (AES-256-GCM via {@link ../crypto}). Every helper
 * takes the Prisma client as its first argument so the logic is unit-testable
 * with a mock and never reaches for the singleton itself.
 */

// Refresh a little before the real expiry so an in-flight sync never races the
// token going stale mid-request.
const EXPIRY_SKEW_MS = 60_000;

export type SaveAccountInput = {
  email: string;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string;
};

export type ConnectedAccountSummary = {
  email: string;
  scopes: string;
  connectedAt: Date;
};

/**
 * Upsert the connected account by (provider, email). A re-connect overwrites the
 * stored tokens. If a re-connect somehow omits a refresh token, the previous one
 * is preserved rather than nulled out.
 */
export async function saveConnectedAccount(
  db: PrismaClient,
  input: SaveAccountInput,
): Promise<void> {
  const accessTokenEncrypted = encrypt(input.accessToken);
  const refreshTokenEncrypted =
    input.refreshToken !== null ? encrypt(input.refreshToken) : undefined;
  const tokenExpiry = input.expiryDate !== null ? new Date(input.expiryDate) : null;

  await db.connectedAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: GOOGLE_PROVIDER,
        providerAccountId: input.email,
      },
    },
    create: {
      provider: GOOGLE_PROVIDER,
      providerAccountId: input.email,
      accessTokenEncrypted,
      refreshTokenEncrypted: refreshTokenEncrypted ?? null,
      tokenExpiry,
      scopes: input.scope,
    },
    update: {
      accessTokenEncrypted,
      tokenExpiry,
      scopes: input.scope,
      // Only overwrite the refresh token when a new one was issued.
      ...(refreshTokenEncrypted !== undefined ? { refreshTokenEncrypted } : {}),
    },
  });
}

type AccountRow = {
  providerAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiry: Date | null;
  scopes: string;
  createdAt: Date;
};

async function findGoogleAccount(db: PrismaClient): Promise<AccountRow | null> {
  const account = (await db.connectedAccount.findFirst({
    where: { provider: GOOGLE_PROVIDER },
    orderBy: { createdAt: "desc" },
  })) as AccountRow | null;
  return account;
}

/** A redacted summary for the UI — never exposes tokens. */
export async function getConnectedAccount(
  db: PrismaClient,
): Promise<ConnectedAccountSummary | null> {
  const account = await findGoogleAccount(db);
  if (account === null) {
    return null;
  }
  return {
    email: account.providerAccountId,
    scopes: account.scopes,
    connectedAt: account.createdAt,
  };
}

/**
 * Best-effort revocation of the connected Google grant. Loads the account,
 * decrypts a token (refresh token preferred — revoking it invalidates the whole
 * grant; falls back to the access token), and POSTs it to Google's revoke
 * endpoint so we don't leave a valid grant dangling after disconnect.
 *
 * Never throws: a network failure, an already-expired token, or a missing
 * account must NOT block the local delete that follows. Returns true only when
 * Google acknowledged the revocation.
 */
export async function revokeAccess(db: PrismaClient): Promise<boolean> {
  try {
    const account = await findGoogleAccount(db);
    if (account === null) {
      return false;
    }

    const encrypted = account.refreshTokenEncrypted ?? account.accessTokenEncrypted;
    const token = decrypt(encrypted);

    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    // Swallow — revocation is best-effort and must never block disconnect.
    return false;
  }
}

export async function disconnectAccount(db: PrismaClient): Promise<void> {
  // Try to revoke the grant with Google first, then always delete locally even
  // if revoke failed (offline / expired token / no account).
  await revokeAccess(db);
  await db.connectedAccount.deleteMany({ where: { provider: GOOGLE_PROVIDER } });
}

function isExpired(expiry: Date | null): boolean {
  if (expiry === null) {
    return true;
  }
  return expiry.getTime() - EXPIRY_SKEW_MS <= Date.now();
}

/**
 * Return a usable access token for the connected account, transparently
 * refreshing (and persisting the refreshed token) when the current one is
 * expired. Throws if no account is connected or no refresh token is available.
 */
export async function getAccessToken(db: PrismaClient): Promise<string> {
  const account = await findGoogleAccount(db);
  if (account === null) {
    throw new Error("No Gmail account is connected");
  }

  if (!isExpired(account.tokenExpiry)) {
    return decrypt(account.accessTokenEncrypted);
  }

  if (account.refreshTokenEncrypted === null) {
    throw new Error("Access token expired and no refresh token is available — reconnect Gmail");
  }

  const refreshToken = decrypt(account.refreshTokenEncrypted);
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Token refresh did not return an access token");
  }

  await saveConnectedAccount(db, {
    email: account.providerAccountId,
    accessToken: credentials.access_token,
    refreshToken: credentials.refresh_token ?? null,
    expiryDate: credentials.expiry_date ?? null,
    scope: credentials.scope ?? account.scopes ?? GMAIL_SCOPES.join(" "),
  });

  return credentials.access_token;
}
