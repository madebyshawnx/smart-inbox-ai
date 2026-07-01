import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailGmailRef } from "@/lib/email-actions";
import type { ParsedListUnsubscribe } from "@/lib/unsubscribe";

const loadEmailGmailRef = vi.fn<(...args: unknown[]) => Promise<EmailGmailRef | null>>();
vi.mock("@/lib/email-actions", () => ({
  loadEmailGmailRef: (...args: unknown[]) => loadEmailGmailRef(...args),
}));

// fetchUnsubscribeInfo returns the parsed header result; performOneClickUnsubscribe
// is the only network write and is asserted to run ONLY on the one-click branch.
const fetchUnsubscribeInfo = vi.fn<(...args: unknown[]) => Promise<ParsedListUnsubscribe>>();
const performOneClickUnsubscribe = vi
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
vi.mock("@/lib/google/gmail-actions", () => ({
  fetchUnsubscribeInfo: (...args: unknown[]) => fetchUnsubscribeInfo(...args),
  performOneClickUnsubscribe: (...args: unknown[]) => performOneClickUnsubscribe(...args),
}));

vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/emails/[id]/unsubscribe/route";

function req(): Request {
  return new Request("http://localhost/api/emails/e1/unsubscribe", { method: "POST" });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function gmailRef(overrides: Partial<EmailGmailRef> = {}): EmailGmailRef {
  return {
    id: "e1",
    senderName: "News",
    senderEmail: "news@example.com",
    subject: "Weekly digest",
    bodyText: "Body",
    receivedAt: new Date("2026-06-25T08:00:00.000Z"),
    threadId: null,
    gmailMessageId: "m1",
    classification: null,
    ...overrides,
  };
}

describe("POST /api/emails/[id]/unsubscribe", () => {
  afterEach(() => {
    loadEmailGmailRef.mockReset();
    fetchUnsubscribeInfo.mockReset();
    performOneClickUnsubscribe.mockClear();
  });

  it("one-click branch: POSTs the https URL and returns method=one-click", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    fetchUnsubscribeInfo.mockResolvedValue({
      httpsUrl: "https://ex.com/u?id=1",
      mailto: "unsub@ex.com",
      oneClick: true,
    });

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; method: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, method: "one-click" });
    expect(performOneClickUnsubscribe).toHaveBeenCalledTimes(1);
    expect(performOneClickUnsubscribe.mock.calls[0][0]).toBe("https://ex.com/u?id=1");
  });

  it("mailto-only branch: never POSTs, returns ok:false with the mailto for the UI", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    fetchUnsubscribeInfo.mockResolvedValue({
      httpsUrl: null,
      mailto: "unsub@ex.com",
      oneClick: false,
    });

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; mailto: string | null };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: false, mailto: "unsub@ex.com" });
    // The app NEVER sends a mailto unsubscribe on the user's behalf.
    expect(performOneClickUnsubscribe).not.toHaveBeenCalled();
  });

  it("https present but not RFC-8058 one-click: falls back to manual (no POST)", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    fetchUnsubscribeInfo.mockResolvedValue({
      httpsUrl: "https://ex.com/u",
      mailto: null,
      oneClick: false,
    });

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; mailto: string | null };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: false, mailto: null });
    expect(performOneClickUnsubscribe).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-Gmail email", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef({ gmailMessageId: null }));

    const res = await POST(req(), ctx("e1"));

    expect(res.status).toBe(400);
    expect(fetchUnsubscribeInfo).not.toHaveBeenCalled();
  });

  it("returns 404 when the email does not exist", async () => {
    loadEmailGmailRef.mockResolvedValue(null);

    const res = await POST(req(), ctx("missing"));

    expect(res.status).toBe(404);
    expect(fetchUnsubscribeInfo).not.toHaveBeenCalled();
  });

  it("fails soft with 502 when the one-click POST throws", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    fetchUnsubscribeInfo.mockResolvedValue({
      httpsUrl: "https://ex.com/u",
      mailto: null,
      oneClick: true,
    });
    performOneClickUnsubscribe.mockRejectedValueOnce(new Error("Unsubscribe request failed (500)"));

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(json.error).not.toContain("500");
  });
});
