import type { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Set a valid 32-byte (AES-256) key BEFORE the tokens module (and its crypto
// import) run any encrypt/decrypt. The real crypto runs here on purpose.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

import { encrypt } from "@/lib/crypto";

// The refresh path reaches for the OAuth client. Mock it so no real Google
// client is constructed, while keeping the provider/scope exports the module
// imports alongside createOAuthClient.
const refreshAccessToken = vi.fn();
const setCredentials = vi.fn();
const createOAuthClient = vi.fn(() => ({ setCredentials, refreshAccessToken }));

vi.mock("@/lib/google/oauth", () => ({
  createOAuthClient: () => createOAuthClient(),
  GOOGLE_PROVIDER: "google",
  GMAIL_SCOPES: ["https://www.googleapis.com/auth/gmail.readonly"],
}));

import {
  disconnectAccount,
  getAccessToken,
  getConnectedAccount,
  saveConnectedAccount,
} from "@/lib/google/tokens";

// Hand-rolled Prisma mock exposing only the connectedAccount calls the helpers
// make (mirrors tests/integration/persistence.test.ts).
function makeMockPrisma() {
  const mock = {
    connectedAccount: {
      upsert: vi.fn().mockResolvedValue({ id: "acc-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return mock;
}

function asPrisma(mock: ReturnType<typeof makeMockPrisma>): PrismaClient {
  return mock as unknown as PrismaClient;
}

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
});

describe("saveConnectedAccount", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("upserts and stores the access token encrypted (not as plaintext)", async () => {
    const accessToken = "plaintext-access-token-value";
    await saveConnectedAccount(asPrisma(mock), {
      email: "user@example.com",
      accessToken,
      refreshToken: "plaintext-refresh-token",
      expiryDate: Date.now() + 3_600_000,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });

    expect(mock.connectedAccount.upsert).toHaveBeenCalledTimes(1);
    const arg = mock.connectedAccount.upsert.mock.calls[0][0];
    const stored = arg.create.accessTokenEncrypted as string;

    // Encryption-at-rest: the stored value is the iv:tag:ciphertext envelope,
    // never the plaintext token.
    expect(stored).toContain(":");
    expect(stored).not.toBe(accessToken);
    expect(stored).not.toContain(accessToken);
  });
});

describe("getConnectedAccount", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("returns a redacted summary with no token fields", async () => {
    const connectedAt = new Date("2026-06-01T12:00:00Z");
    mock.connectedAccount.findFirst.mockResolvedValueOnce({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: encrypt("secret-access"),
      refreshTokenEncrypted: encrypt("secret-refresh"),
      tokenExpiry: new Date(Date.now() + 3_600_000),
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      createdAt: connectedAt,
    });

    const summary = await getConnectedAccount(asPrisma(mock));

    expect(summary).toEqual({
      email: "user@example.com",
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      connectedAt,
    });
    // No token fields leak through.
    expect(summary).not.toHaveProperty("accessTokenEncrypted");
    expect(summary).not.toHaveProperty("refreshTokenEncrypted");
    expect(summary).not.toHaveProperty("accessToken");
    expect(summary).not.toHaveProperty("refreshToken");
  });

  it("returns null when no account is connected", async () => {
    mock.connectedAccount.findFirst.mockResolvedValueOnce(null);
    expect(await getConnectedAccount(asPrisma(mock))).toBeNull();
  });
});

describe("getAccessToken", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
    refreshAccessToken.mockReset();
    setCredentials.mockReset();
    createOAuthClient.mockClear();
  });

  it("returns the decrypted access token when the expiry is in the future", async () => {
    mock.connectedAccount.findFirst.mockResolvedValueOnce({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: encrypt("live-token"),
      refreshTokenEncrypted: encrypt("refresh-token"),
      tokenExpiry: new Date(Date.now() + 3_600_000),
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      createdAt: new Date(),
    });

    const token = await getAccessToken(asPrisma(mock));

    expect(token).toBe("live-token");
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes, returns the new token, and persists it when the expiry is in the past", async () => {
    refreshAccessToken.mockResolvedValue({
      credentials: {
        access_token: "new-access",
        expiry_date: Date.now() + 3_600_000,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    mock.connectedAccount.findFirst.mockResolvedValueOnce({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: encrypt("stale-token"),
      refreshTokenEncrypted: encrypt("the-refresh-token"),
      tokenExpiry: new Date(Date.now() - 3_600_000),
      scopes: "https://www.googleapis.com/auth/gmail.readonly",
      createdAt: new Date(),
    });

    const token = await getAccessToken(asPrisma(mock));

    expect(token).toBe("new-access");
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "the-refresh-token" });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    // The refreshed token is persisted via a second upsert.
    expect(mock.connectedAccount.upsert).toHaveBeenCalledTimes(1);
    const arg = mock.connectedAccount.upsert.mock.calls[0][0];
    expect(arg.update.accessTokenEncrypted).toContain(":");
    expect(arg.update.accessTokenEncrypted).not.toContain("new-access");
  });

  it("throws when no account exists", async () => {
    mock.connectedAccount.findFirst.mockResolvedValueOnce(null);
    await expect(getAccessToken(asPrisma(mock))).rejects.toThrow(/No Gmail account is connected/);
  });
});

describe("disconnectAccount", () => {
  it("deletes the Google connected account(s)", async () => {
    const mock = makeMockPrisma();
    await disconnectAccount(asPrisma(mock));

    expect(mock.connectedAccount.deleteMany).toHaveBeenCalledTimes(1);
    const arg = mock.connectedAccount.deleteMany.mock.calls[0][0];
    expect(arg.where).toEqual({ provider: "google" });
  });
});
