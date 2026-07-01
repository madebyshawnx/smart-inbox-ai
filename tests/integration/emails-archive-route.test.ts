import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailGmailRef } from "@/lib/email-actions";

// Mock the email lookup so the route never touches the database. Each test sets
// what loadEmailGmailRef resolves to (a Gmail ref, a non-Gmail ref, or null).
const loadEmailGmailRef = vi.fn<(...args: unknown[]) => Promise<EmailGmailRef | null>>();
vi.mock("@/lib/email-actions", () => ({
  loadEmailGmailRef: (...args: unknown[]) => loadEmailGmailRef(...args),
}));

// Mock the Gmail write helpers so the route asserts which one it called without
// hitting the network. archive → archiveMessage, undo → unarchiveMessage.
const archiveMessage = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const unarchiveMessage = vi
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
vi.mock("@/lib/google/gmail-actions", () => ({
  archiveMessage: (...args: unknown[]) => archiveMessage(...args),
  unarchiveMessage: (...args: unknown[]) => unarchiveMessage(...args),
}));

// Mock the token fetch so the route never runs the real OAuth refresh.
vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

// Mock the prisma singleton so importing the route does not construct a client.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/emails/[id]/archive/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/emails/e1/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function gmailRef(overrides: Partial<EmailGmailRef> = {}): EmailGmailRef {
  return {
    id: "e1",
    senderName: "Rachel Kim",
    senderEmail: "rachel@example.com",
    subject: "Q2 budget",
    bodyText: "Body",
    receivedAt: new Date("2026-06-25T08:00:00.000Z"),
    threadId: "t1",
    gmailMessageId: "m1",
    classification: null,
    ...overrides,
  };
}

describe("POST /api/emails/[id]/archive", () => {
  afterEach(() => {
    loadEmailGmailRef.mockReset();
    archiveMessage.mockClear();
    unarchiveMessage.mockClear();
  });

  it("archives (undo:false) via archiveMessage — never un-archive", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());

    const res = await POST(postRequest({ undo: false }), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; action: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, action: "archive" });
    expect(archiveMessage).toHaveBeenCalledTimes(1);
    expect(archiveMessage.mock.calls[0][1]).toBe("m1");
    expect(unarchiveMessage).not.toHaveBeenCalled();
  });

  it("defaults to archive when the body is absent (undo omitted)", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());

    const res = await POST(postRequest(undefined), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; action: string };

    expect(res.status).toBe(200);
    expect(json.action).toBe("archive");
    expect(archiveMessage).toHaveBeenCalledTimes(1);
    expect(unarchiveMessage).not.toHaveBeenCalled();
  });

  it("un-archives (undo:true) via unarchiveMessage — never archive", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());

    const res = await POST(postRequest({ undo: true }), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; action: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, action: "unarchive" });
    expect(unarchiveMessage).toHaveBeenCalledTimes(1);
    expect(unarchiveMessage.mock.calls[0][1]).toBe("m1");
    expect(archiveMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-Gmail email (no gmail message id)", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef({ gmailMessageId: null }));

    const res = await POST(postRequest({ undo: false }), ctx("e1"));

    expect(res.status).toBe(400);
    expect(archiveMessage).not.toHaveBeenCalled();
    expect(unarchiveMessage).not.toHaveBeenCalled();
  });

  it("returns 404 when the email does not exist", async () => {
    loadEmailGmailRef.mockResolvedValue(null);

    const res = await POST(postRequest({ undo: false }), ctx("missing"));

    expect(res.status).toBe(404);
    expect(archiveMessage).not.toHaveBeenCalled();
    expect(unarchiveMessage).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload shape (undo not a boolean)", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());

    const res = await POST(postRequest({ undo: "yes" }), ctx("e1"));

    expect(res.status).toBe(400);
    expect(loadEmailGmailRef).not.toHaveBeenCalled();
    expect(archiveMessage).not.toHaveBeenCalled();
  });

  it("fails soft with 502 (no token/stack leak) when the Gmail call throws", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    archiveMessage.mockRejectedValueOnce(new Error("Gmail API request failed (403)"));

    const res = await POST(postRequest({ undo: false }), ctx("e1"));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(json.error).not.toContain("access-token");
    expect(json.error).not.toContain("403");
  });
});
