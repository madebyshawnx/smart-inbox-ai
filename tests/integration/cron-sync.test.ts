import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncCounts } from "@/lib/sync";

// Mock the prisma singleton so importing the route never constructs a client.
vi.mock("@/lib/db", () => ({ prisma: {} }));

// Mock runSync so the route test asserts wiring/auth, not the sync internals
// (those are covered by sync-lib.test.ts).
const runSync = vi.fn<(...args: unknown[]) => Promise<SyncCounts>>();
vi.mock("@/lib/sync", () => ({
  runSync: (...args: unknown[]) => runSync(...args),
}));

// Mock the connected-account lookup so we can toggle "account / no account".
const getConnectedAccount = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/google/tokens", () => ({
  getConnectedAccount: (...args: unknown[]) => getConnectedAccount(...args),
}));

import { GET } from "@/app/api/cron/sync/route";

const ACCOUNT = { email: "user@example.com", scopes: "gmail.readonly", connectedAt: new Date() };
const COUNTS: SyncCounts = { classified: 3, needsReview: 1, skipped: 2, total: 6 };

function cronRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  return new Request("http://localhost/api/cron/sync", { method: "GET", headers });
}

describe("GET /api/cron/sync", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    runSync.mockReset();
    getConnectedAccount.mockReset();
    getConnectedAccount.mockResolvedValue(ACCOUNT);
    runSync.mockResolvedValue(COUNTS);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      process.env.CRON_SECRET = undefined;
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("returns 401 when CRON_SECRET is set and the auth header is missing", async () => {
    process.env.CRON_SECRET = "topsecret";

    const res = await GET(cronRequest());

    expect(res.status).toBe(401);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is set and the auth header is wrong", async () => {
    process.env.CRON_SECRET = "topsecret";

    const res = await GET(cronRequest("Bearer nope"));

    expect(res.status).toBe(401);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("syncs and returns counts when the Bearer token matches CRON_SECRET", async () => {
    process.env.CRON_SECRET = "topsecret";

    const res = await GET(cronRequest("Bearer topsecret"));
    const json = (await res.json()) as { ok: boolean } & SyncCounts;

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, ...COUNTS });
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("allows the request with no CRON_SECRET set (local/dev)", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(cronRequest());
    const json = (await res.json()) as { ok: boolean } & SyncCounts;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("returns 200 + skipped when no Gmail account is connected", async () => {
    delete process.env.CRON_SECRET;
    getConnectedAccount.mockResolvedValue(null);

    const res = await GET(cronRequest());
    const json = (await res.json()) as { skipped: boolean; reason: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ skipped: true, reason: "no account" });
    expect(runSync).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when runSync throws", async () => {
    delete process.env.CRON_SECRET;
    runSync.mockRejectedValue(new Error("boom"));

    const res = await GET(cronRequest());

    expect(res.status).toBe(500);
  });
});
