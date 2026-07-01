import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenSenderResult } from "@/lib/feedback";

// screenSender writes the durable rule; assert the route forwards the right
// decision and returns its result. archiveStoredBySender is the optional bonus.
const screenSender = vi.fn<(...args: unknown[]) => Promise<ScreenSenderResult>>();
vi.mock("@/lib/feedback", () => ({
  screenSender: (...args: unknown[]) => screenSender(...args),
}));

const archiveStoredBySender =
  vi.fn<(...args: unknown[]) => Promise<{ archived: number; errors: number; total: number }>>();
vi.mock("@/lib/sync", () => ({
  archiveStoredBySender: (...args: unknown[]) => archiveStoredBySender(...args),
}));

vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/senders/screen/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/senders/screen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/senders/screen", () => {
  afterEach(() => {
    screenSender.mockReset();
    archiveStoredBySender.mockReset();
  });

  it("decision 'in' creates a prioritize rule (weight > 0), no archiving", async () => {
    screenSender.mockResolvedValue({
      ruleCreated: true,
      ruleText: "Always prioritize emails from Rachel (rachel@example.com).",
      senderEmail: "rachel@example.com",
      priorityWeight: 100,
    });

    const res = await POST(
      postRequest({ senderEmail: "rachel@example.com", senderName: "Rachel", decision: "in" }),
    );
    const json = (await res.json()) as { ok: boolean; decision: string; ruleCreated: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.decision).toBe("in");
    expect(json.ruleCreated).toBe(true);
    // The route forwards the decision verbatim to screenSender.
    expect(screenSender.mock.calls[0][3]).toBe("in");
    // "in" never archives, even if archiveExisting were somehow set.
    expect(archiveStoredBySender).not.toHaveBeenCalled();
  });

  it("decision 'out' creates an ignore rule; no archive unless archiveExisting", async () => {
    screenSender.mockResolvedValue({
      ruleCreated: true,
      ruleText:
        "Treat emails from spam@example.com as low priority unless they are clearly urgent.",
      senderEmail: "spam@example.com",
      priorityWeight: -100,
    });

    const res = await POST(postRequest({ senderEmail: "spam@example.com", decision: "out" }));
    const json = (await res.json()) as { decision: string; archived?: number };

    expect(res.status).toBe(200);
    expect(json.decision).toBe("out");
    expect(screenSender.mock.calls[0][3]).toBe("out");
    expect(archiveStoredBySender).not.toHaveBeenCalled();
    // archive counts are omitted when archiveExisting isn't requested.
    expect(json.archived).toBeUndefined();
  });

  it("decision 'out' + archiveExisting archives existing mail and reports counts", async () => {
    screenSender.mockResolvedValue({
      ruleCreated: true,
      ruleText:
        "Treat emails from spam@example.com as low priority unless they are clearly urgent.",
      senderEmail: "spam@example.com",
      priorityWeight: -100,
    });
    archiveStoredBySender.mockResolvedValue({ archived: 3, errors: 1, total: 4 });

    const res = await POST(
      postRequest({ senderEmail: "spam@example.com", decision: "out", archiveExisting: true }),
    );
    const json = (await res.json()) as { archived: number; archiveErrors: number };

    expect(res.status).toBe(200);
    expect(archiveStoredBySender).toHaveBeenCalledTimes(1);
    expect(json.archived).toBe(3);
    expect(json.archiveErrors).toBe(1);
  });

  it("still returns 200 when the optional archive step throws (rule already saved)", async () => {
    screenSender.mockResolvedValue({
      ruleCreated: true,
      ruleText:
        "Treat emails from spam@example.com as low priority unless they are clearly urgent.",
      senderEmail: "spam@example.com",
      priorityWeight: -100,
    });
    archiveStoredBySender.mockRejectedValueOnce(new Error("Gmail unreachable"));

    const res = await POST(
      postRequest({ senderEmail: "spam@example.com", decision: "out", archiveExisting: true }),
    );
    const json = (await res.json()) as { ok: boolean; archived?: number };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // Archiving failed silently — no counts surfaced, but the rule write stands.
    expect(json.archived).toBeUndefined();
  });

  it("returns 400 for an invalid email and never writes a rule", async () => {
    const res = await POST(postRequest({ senderEmail: "not-an-email", decision: "in" }));

    expect(res.status).toBe(400);
    expect(screenSender).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid decision value", async () => {
    const res = await POST(postRequest({ senderEmail: "a@b.com", decision: "maybe" }));

    expect(res.status).toBe(400);
    expect(screenSender).not.toHaveBeenCalled();
  });

  it("returns 500 (generic) when the rule write itself fails", async () => {
    screenSender.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ senderEmail: "a@b.com", decision: "in" }));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).not.toContain("db down");
  });
});
