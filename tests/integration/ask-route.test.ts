import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskEmail } from "@/lib/ask/answer";

// Mock the model client so importing the route never constructs a real client
// and no network call is made.
vi.mock("@/lib/classification/anthropic-client", () => ({
  createAnthropicClient: () => ({
    async complete() {
      return "unused — answerQuestion is mocked";
    },
  }),
}));

// Mock answerQuestion so the route test asserts orchestration, not prompt shape
// (the prompt shape is covered by ask.test.ts against the real implementation).
const answerQuestionMock = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock("@/lib/ask/answer", () => ({
  answerQuestion: (...args: unknown[]) => answerQuestionMock(...args),
}));

// Mock persistence so the route never touches the database.
const loadClassifiedEmails = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
vi.mock("@/lib/persistence", () => ({
  loadClassifiedEmails: (...args: unknown[]) => loadClassifiedEmails(...args),
}));

// Mock the prisma singleton so importing the route does not construct a client.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/ask/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRow() {
  return {
    message: {
      senderName: "Rachel Kim",
      senderEmail: "rachel@acme.com",
      subject: "Q2 budget",
      receivedAt: new Date("2026-06-25T08:00:00.000Z"),
    },
    classification: {
      summary: "Rachel needs the Q2 budget.",
      whyThisMatters: "Blocked stakeholder.",
      priorityLevel: "high",
      suggestedBucket: "needs_attention",
      recommendedNextStep: "Send the PDF.",
      detectedDeadline: "2026-06-25T17:00:00.000Z",
    },
  };
}

describe("POST /api/ask", () => {
  afterEach(() => {
    answerQuestionMock.mockReset();
    loadClassifiedEmails.mockReset();
  });

  it("returns 200 and the answer for a valid question", async () => {
    loadClassifiedEmails.mockResolvedValue([makeRow()]);
    answerQuestionMock.mockResolvedValue("Rachel is waiting on the Q2 budget.");

    const res = await POST(postRequest({ question: "What's waiting on me?" }));
    const json = (await res.json()) as { answer: string };

    expect(res.status).toBe(200);
    expect(json.answer).toBe("Rachel is waiting on the Q2 budget.");
    expect(answerQuestionMock).toHaveBeenCalledTimes(1);
    // The mapped AskEmail[] is passed as the grounding context.
    const passedEmails = answerQuestionMock.mock.calls[0][0] as AskEmail[];
    expect(passedEmails[0].senderName).toBe("Rachel Kim");
    expect(passedEmails[0].receivedAt).toBe("2026-06-25T08:00:00.000Z");
    // The trusted question is forwarded verbatim.
    expect(answerQuestionMock.mock.calls[0][1]).toBe("What's waiting on me?");
  });

  it("returns 400 for an empty question", async () => {
    loadClassifiedEmails.mockResolvedValue([makeRow()]);

    const res = await POST(postRequest({ question: "" }));

    expect(res.status).toBe(400);
    expect(answerQuestionMock).not.toHaveBeenCalled();
  });

  it("returns the empty-inbox message and does not call the model when nothing is triaged", async () => {
    loadClassifiedEmails.mockResolvedValue([]);

    const res = await POST(postRequest({ question: "What's waiting on me?" }));
    const json = (await res.json()) as { answer: string };

    expect(res.status).toBe(200);
    expect(json.answer).toContain("connect Gmail and sync first");
    expect(answerQuestionMock).not.toHaveBeenCalled();
  });
});
