import { afterEach, describe, expect, it, vi } from "vitest";

// loadEmailIdsByBucket resolves a bucket key → internal ids; extractGmailMessageId
// is the REAL pure helper (we want its gmail:/sample: behavior exercised here).
const loadEmailIdsByBucket = vi.fn<(...args: unknown[]) => Promise<string[]>>();
vi.mock("@/lib/email-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email-actions")>("@/lib/email-actions");
  return {
    ...actual,
    loadEmailIdsByBucket: (...args: unknown[]) => loadEmailIdsByBucket(...args),
  };
});

const archiveMessage = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
vi.mock("@/lib/google/gmail-actions", () => ({
  archiveMessage: (...args: unknown[]) => archiveMessage(...args),
}));

vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

// findMany resolves each internal id → its sourceId so the route can map to a
// Gmail id. Each test sets the returned rows.
const findMany = vi.fn<(...args: unknown[]) => Promise<Array<{ id: string; sourceId: string }>>>();
vi.mock("@/lib/db", () => ({
  prisma: { emailMessage: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { POST } from "@/app/api/emails/bulk-archive/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/emails/bulk-archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rowsFor(ids: string[]): Array<{ id: string; sourceId: string }> {
  return ids.map((id) => ({ id, sourceId: `gmail:${id}` }));
}

describe("POST /api/emails/bulk-archive", () => {
  afterEach(() => {
    loadEmailIdsByBucket.mockReset();
    archiveMessage.mockReset();
    archiveMessage.mockResolvedValue(undefined);
    findMany.mockReset();
  });

  it("returns 400 when BOTH ids and bucketKey are provided", async () => {
    const res = await POST(postRequest({ ids: ["a"], bucketKey: "safe_to_ignore" }));
    expect(res.status).toBe(400);
    expect(archiveMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when NEITHER ids nor bucketKey is provided", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(archiveMessage).not.toHaveBeenCalled();
  });

  it("returns 400 when the ids list exceeds the max of 200", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `e${i}`);
    const res = await POST(postRequest({ ids }));
    expect(res.status).toBe(400);
    // Rejected by schema validation before any DB/Gmail work.
    expect(findMany).not.toHaveBeenCalled();
    expect(archiveMessage).not.toHaveBeenCalled();
  });

  it("caps a bucket that resolves to > 200 ids at 200 archives", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `e${i}`);
    loadEmailIdsByBucket.mockResolvedValue(ids);
    findMany.mockResolvedValue(rowsFor(ids.slice(0, 200)));

    const res = await POST(postRequest({ bucketKey: "safe_to_ignore" }));
    const json = (await res.json()) as { archived: number; total: number };

    expect(res.status).toBe(200);
    expect(json.total).toBe(200);
    expect(json.archived).toBe(200);
    expect(archiveMessage).toHaveBeenCalledTimes(200);
  });

  it("counts a per-item failure as an error without aborting the batch", async () => {
    loadEmailIdsByBucket.mockReset();
    findMany.mockResolvedValue(rowsFor(["a", "b", "c"]));
    // Middle item fails; the other two still archive.
    archiveMessage.mockImplementation(async (_token: unknown, gmailId: unknown) => {
      if (gmailId === "b") {
        throw new Error("Gmail API request failed (500)");
      }
    });

    const res = await POST(postRequest({ ids: ["a", "b", "c"] }));
    const json = (await res.json()) as {
      ok: boolean;
      archived: number;
      errors: number;
      skipped: number;
      total: number;
    };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, archived: 2, errors: 1, skipped: 0, total: 3 });
    expect(archiveMessage).toHaveBeenCalledTimes(3);
  });

  it("skips (does not error) non-Gmail sample rows that have no gmail id", async () => {
    findMany.mockResolvedValue([
      { id: "a", sourceId: "gmail:a" },
      { id: "b", sourceId: "sample:1" },
    ]);

    const res = await POST(postRequest({ ids: ["a", "b"] }));
    const json = (await res.json()) as { archived: number; errors: number; skipped: number };

    expect(res.status).toBe(200);
    expect(json.archived).toBe(1);
    expect(json.errors).toBe(0);
    expect(json.skipped).toBe(1);
    expect(archiveMessage).toHaveBeenCalledTimes(1);
  });
});
