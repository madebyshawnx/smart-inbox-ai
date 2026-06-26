import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifyResult, RawEmail } from "@/lib/classification/classify";

// Mock the model client so no network call is made: classifyEmail receives a
// client whose complete() returns a valid classification JSON string.
vi.mock("@/lib/classification/anthropic-client", () => ({
  createAnthropicClient: () => ({
    async complete({ user }: { system: string; user: string }) {
      // Derive the email_id the route fed in so the parsed payload validates.
      const match = user.match(/email_id:\s*(\S+)/);
      const sourceId = match?.[1] ?? "unknown";
      return JSON.stringify({
        email_id: sourceId,
        thread_id: sourceId,
        sender: { name: "Sender", email: "sender@example.com" },
        subject: "Subject",
        summary: "A test summary that is long enough.",
        priority_level: "high",
        urgency_level: "urgent",
        importance_score: 80,
        confidence_score: 90,
        category: "work",
        subcategory: null,
        detected_deadline: null,
        requires_response: true,
        requires_decision: false,
        requires_payment: false,
        requires_scheduling: false,
        needs_follow_up: false,
        waiting_on_reply: false,
        recommended_next_step: "Do the thing.",
        why_this_matters: "It matters because it is a test.",
        risk_if_ignored: null,
        suggested_bucket: "needs_attention",
        safe_to_ignore: false,
        model_version: "claude-sonnet-4-6",
      });
    },
  }),
}));

// Mock persistence so the route never touches the database.
const saveClassifiedEmail = vi
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("msg-id");
vi.mock("@/lib/persistence", () => ({
  saveClassifiedEmail: (...args: unknown[]) => saveClassifiedEmail(...args),
}));

// Mock the prisma singleton so importing the route does not construct a client.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { GET, POST } from "@/app/api/classify/route";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/classify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sampleBody: { emails: RawEmail[] } = {
  emails: [
    {
      sourceId: "test-email-1",
      senderName: "Alice",
      senderEmail: "alice@example.com",
      subject: "Hello",
      bodyText: "First body",
      receivedAt: "2026-06-25T08:00:00Z",
    },
    {
      sourceId: "test-email-2",
      threadId: "thread-2",
      senderName: "Bob",
      senderEmail: "bob@example.com",
      subject: "Hi again",
      bodyText: "Second body",
      receivedAt: "2026-06-25T09:00:00Z",
    },
  ],
};

describe("POST /api/classify", () => {
  afterEach(() => {
    saveClassifiedEmail.mockClear();
  });

  it("classifies each provided email and persists it once per email", async () => {
    const res = await POST(postRequest(sampleBody));
    const json = (await res.json()) as {
      classified: number;
      needsReview: number;
      results: Array<{ sourceId: string; status: string; suggestedBucket: string }>;
    };

    expect(res.status).toBe(200);
    expect(json.classified).toBe(2);
    expect(json.needsReview).toBe(0);
    expect(json.results).toHaveLength(2);
    expect(json.results[0]).toEqual({
      sourceId: "test-email-1",
      status: "classified",
      suggestedBucket: "needs_attention",
    });

    expect(saveClassifiedEmail).toHaveBeenCalledTimes(2);
    // Each call carries (db, raw, result) with the matching sourceId.
    const firstRaw = saveClassifiedEmail.mock.calls[0][1] as RawEmail;
    const firstResult = saveClassifiedEmail.mock.calls[0][2] as ClassifyResult;
    expect(firstRaw.sourceId).toBe("test-email-1");
    expect(firstResult.status).toBe("classified");
  });

  it("GET returns the sample emails available to classify", async () => {
    const res = GET();
    const json = (await res.json()) as { emails: RawEmail[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(json.emails)).toBe(true);
    expect(json.emails.length).toBeGreaterThan(0);
    expect(typeof json.emails[0].sourceId).toBe("string");
  });

  it("returns 400 when `emails` is not an array", async () => {
    const res = await POST(postRequest({ emails: "not-an-array" }));
    expect(res.status).toBe(400);
    expect(saveClassifiedEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when an email is missing required string fields", async () => {
    const res = await POST(postRequest({ emails: [{ sourceId: "x" }] }));
    expect(res.status).toBe(400);
    expect(saveClassifiedEmail).not.toHaveBeenCalled();
  });
});
