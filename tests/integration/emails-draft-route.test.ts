import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailGmailRef } from "@/lib/email-actions";

// Mock the email lookup so the route never touches the database.
const loadEmailGmailRef = vi.fn<(...args: unknown[]) => Promise<EmailGmailRef | null>>();
vi.mock("@/lib/email-actions", () => ({
  loadEmailGmailRef: (...args: unknown[]) => loadEmailGmailRef(...args),
}));

// Mock the draft generator so the route asserts orchestration, not prompt shape
// (prompt shape is covered by reply-draft.test.ts against the real code).
const generateReplyDraft = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/reply-draft", () => ({
  generateReplyDraft: (...args: unknown[]) => generateReplyDraft(...args),
}));

// createReplyDraft is the ONLY Gmail write. There is intentionally no `send`
// export to mock — asserting we call drafts.create (never send) is the point.
const createReplyDraft = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/google/gmail-actions", () => ({
  createReplyDraft: (...args: unknown[]) => createReplyDraft(...args),
}));

vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

// Trusted grounding lookups — stubbed empty so drafting works without them.
vi.mock("@/lib/rules", () => ({
  loadActiveRuleTexts: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/feedback-summary", () => ({
  loadSenderFeedbackSummary: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/classification/anthropic-client", () => ({
  createAnthropicClient: () => ({
    async complete() {
      return "unused — generateReplyDraft is mocked";
    },
  }),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/emails/[id]/draft/route";

function req(): Request {
  return new Request("http://localhost/api/emails/e1/draft", { method: "POST" });
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
    bodyText: "Can you send the Q2 budget before the board call?",
    receivedAt: new Date("2026-06-25T08:00:00.000Z"),
    threadId: "t1",
    gmailMessageId: "m1",
    classification: { summary: "Rachel needs the budget.", recommendedNextStep: "Send it." },
    ...overrides,
  };
}

describe("POST /api/emails/[id]/draft", () => {
  afterEach(() => {
    loadEmailGmailRef.mockReset();
    generateReplyDraft.mockReset();
    createReplyDraft.mockReset();
  });

  it("creates a Gmail DRAFT (never sends) and returns the draft id", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    generateReplyDraft.mockResolvedValue({
      subject: "Re: Q2 budget",
      body: "Sending the figures now.",
      modelVersion: "claude",
    });
    createReplyDraft.mockResolvedValue({ draftId: "draft-1", messageId: "msg-1" });

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { ok: boolean; draftId: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, draftId: "draft-1" });

    // The one write is a draft create; the reply threads under the original.
    expect(createReplyDraft).toHaveBeenCalledTimes(1);
    const input = createReplyDraft.mock.calls[0][1] as {
      threadId: string | null;
      to: string;
      inReplyToMessageId: string | null;
    };
    expect(input.threadId).toBe("t1");
    expect(input.to).toBe("rachel@example.com");
    expect(input.inReplyToMessageId).toBe("m1");
  });

  it("returns 400 for a non-Gmail email and never generates or drafts", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef({ gmailMessageId: null }));

    const res = await POST(req(), ctx("e1"));

    expect(res.status).toBe(400);
    expect(generateReplyDraft).not.toHaveBeenCalled();
    expect(createReplyDraft).not.toHaveBeenCalled();
  });

  it("returns 404 when the email does not exist", async () => {
    loadEmailGmailRef.mockResolvedValue(null);

    const res = await POST(req(), ctx("missing"));

    expect(res.status).toBe(404);
    expect(createReplyDraft).not.toHaveBeenCalled();
  });

  it("fails soft with 502 (no key/stack leak) when draft creation throws", async () => {
    loadEmailGmailRef.mockResolvedValue(gmailRef());
    generateReplyDraft.mockResolvedValue({
      subject: "Re: Q2 budget",
      body: "On it.",
      modelVersion: "claude",
    });
    createReplyDraft.mockRejectedValueOnce(new Error("Gmail drafts.create failed (403)"));

    const res = await POST(req(), ctx("e1"));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(json.error).not.toContain("access-token");
    expect(json.error).not.toContain("403");
  });
});
