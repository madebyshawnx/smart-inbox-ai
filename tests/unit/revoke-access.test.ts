import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// decrypt just echoes its input so we can assert the exact token POSTed.
vi.mock("@/lib/crypto", () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

// Avoid the oauth module touching Google env vars at import time.
vi.mock("@/lib/google/oauth", () => ({
  GMAIL_SCOPES: ["https://www.googleapis.com/auth/gmail.readonly"],
  GOOGLE_PROVIDER: "google",
  createOAuthClient: vi.fn(),
}));

import { revokeAccess } from "@/lib/google/tokens";

function dbWithAccount(account: unknown): PrismaClient {
  return {
    connectedAccount: { findFirst: vi.fn().mockResolvedValue(account) },
  } as unknown as PrismaClient;
}

describe("revokeAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("POSTs the refresh token to Google's revoke endpoint, form-encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const db = dbWithAccount({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: "access-tok",
      refreshTokenEncrypted: "refresh-tok",
      tokenExpiry: null,
      scopes: "scope",
      createdAt: new Date(),
    });

    const result = await revokeAccess(db);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // Refresh token is preferred and url-encoded into the body.
    expect(init.body).toBe("token=refresh-tok");
  });

  it("falls back to the access token when no refresh token is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const db = dbWithAccount({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: "access-tok",
      refreshTokenEncrypted: null,
      tokenExpiry: null,
      scopes: "scope",
      createdAt: new Date(),
    });

    await revokeAccess(db);

    expect(fetchMock.mock.calls[0][1].body).toBe("token=access-tok");
  });

  it("resolves false (does not throw) when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const db = dbWithAccount({
      providerAccountId: "user@example.com",
      accessTokenEncrypted: "access-tok",
      refreshTokenEncrypted: "refresh-tok",
      tokenExpiry: null,
      scopes: "scope",
      createdAt: new Date(),
    });

    await expect(revokeAccess(db)).resolves.toBe(false);
  });

  it("resolves false without calling fetch when no account is connected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const db = dbWithAccount(null);

    await expect(revokeAccess(db)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
