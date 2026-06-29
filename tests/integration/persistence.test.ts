import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifyResult, RawEmail } from "@/lib/classification/classify";
import type { EmailClassification } from "@/lib/classification/schema";
import { loadClassifiedEmails, saveClassifiedEmail, saveFeedback } from "@/lib/persistence";

// Hand-rolled mock that matches exactly the Prisma calls the helpers make. Cast
// to PrismaClient at the call site so we don't have to implement the full model.
function makeMockPrisma() {
  const mock = {
    emailMessage: {
      upsert: vi.fn().mockResolvedValue({ id: "msg-1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    emailClassification: {
      upsert: vi.fn().mockResolvedValue({ id: "cls-1" }),
    },
    userFeedback: {
      create: vi.fn().mockResolvedValue({ id: "fb-1" }),
    },
  };
  return mock;
}

function asPrisma(mock: ReturnType<typeof makeMockPrisma>): PrismaClient {
  return mock as unknown as PrismaClient;
}

const rawEmail: RawEmail = {
  sourceId: "fixture-vip-deadline-01",
  threadId: "thread-1",
  senderName: "Rachel Kim",
  senderEmail: "rachel.kim@acmecorp.com",
  subject: "Need the Q2 budget summary before EOD — urgent",
  bodyText: "Please send the Q2 budget before 5pm.",
  receivedAt: "2026-06-25T08:14:22Z",
};

const classification: EmailClassification = {
  email_id: "fixture-vip-deadline-01",
  thread_id: "thread-1",
  sender: { name: "Rachel Kim", email: "rachel.kim@acmecorp.com" },
  subject: "Need the Q2 budget summary before EOD — urgent",
  summary: "Rachel needs the Q2 budget before the board call.",
  priority_level: "high",
  urgency_level: "urgent",
  importance_score: 88,
  confidence_score: 92,
  category: "work_request",
  subcategory: "finance",
  detected_deadline: "2026-06-25T17:00:00Z",
  requires_response: true,
  requires_decision: false,
  requires_payment: false,
  requires_scheduling: false,
  needs_follow_up: true,
  waiting_on_reply: false,
  recommended_next_step: "Send the PDF before 5pm.",
  why_this_matters: "A senior stakeholder is blocked before a board call.",
  risk_if_ignored: "The board call goes ahead without the summary.",
  suggested_bucket: "needs_attention",
  safe_to_ignore: false,
  model_version: "claude-sonnet-4-6",
};

const result: ClassifyResult = { status: "classified", classification };

describe("saveClassifiedEmail", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("upserts the email by sourceId and returns the message id", async () => {
    const id = await saveClassifiedEmail(asPrisma(mock), rawEmail, result);

    expect(id).toBe("msg-1");
    expect(mock.emailMessage.upsert).toHaveBeenCalledTimes(1);
    const arg = mock.emailMessage.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ sourceId: "fixture-vip-deadline-01" });
    expect(arg.create.senderEmail).toBe("rachel.kim@acmecorp.com");
    // receivedAt is coerced from ISO string to a Date.
    expect(arg.create.receivedAt).toBeInstanceOf(Date);
    expect(arg.create.receivedAt.toISOString()).toBe("2026-06-25T08:14:22.000Z");
  });

  it("maps snake_case classification fields to camelCase columns on upsert", async () => {
    await saveClassifiedEmail(asPrisma(mock), rawEmail, result);

    expect(mock.emailClassification.upsert).toHaveBeenCalledTimes(1);
    const arg = mock.emailClassification.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ emailMessageId: "msg-1" });

    const created = arg.create;
    expect(created.emailMessageId).toBe("msg-1");
    expect(created.priorityLevel).toBe("high");
    expect(created.urgencyLevel).toBe("urgent");
    expect(created.importanceScore).toBe(88);
    expect(created.confidenceScore).toBe(92);
    expect(created.whyThisMatters).toBe(classification.why_this_matters);
    expect(created.recommendedNextStep).toBe(classification.recommended_next_step);
    expect(created.detectedDeadline).toBe("2026-06-25T17:00:00Z");
    expect(created.requiresResponse).toBe(true);
    expect(created.needsFollowUp).toBe(true);
    expect(created.waitingOnReply).toBe(false);
    expect(created.suggestedBucket).toBe("needs_attention");
    expect(created.safeToIgnore).toBe(false);
    expect(created.modelVersion).toBe("claude-sonnet-4-6");

    // The update branch carries the same mapped columns (no emailMessageId).
    expect(arg.update.priorityLevel).toBe("high");
  });

  it("passes through a null threadId when the email has none", async () => {
    const { threadId, ...withoutThread } = rawEmail;
    void threadId;
    await saveClassifiedEmail(asPrisma(mock), withoutThread, result);

    const arg = mock.emailMessage.upsert.mock.calls[0][0];
    expect(arg.create.threadId).toBeNull();
  });
});

describe("saveFeedback", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("creates a UserFeedback row for an allowed feedback type", async () => {
    await saveFeedback(asPrisma(mock), {
      emailMessageId: "msg-1",
      feedbackType: "correct",
      feedbackNotes: "spot on",
    });

    expect(mock.userFeedback.create).toHaveBeenCalledTimes(1);
    const arg = mock.userFeedback.create.mock.calls[0][0];
    expect(arg.data).toEqual({
      emailMessageId: "msg-1",
      feedbackType: "correct",
      feedbackNotes: "spot on",
    });
  });

  it("defaults feedbackNotes to null when omitted", async () => {
    await saveFeedback(asPrisma(mock), {
      emailMessageId: "msg-1",
      feedbackType: "mark_urgent",
    });

    const arg = mock.userFeedback.create.mock.calls[0][0];
    expect(arg.data.feedbackNotes).toBeNull();
  });

  it("throws and does not write for an unknown feedback type", async () => {
    await expect(
      saveFeedback(asPrisma(mock), {
        emailMessageId: "msg-1",
        feedbackType: "totally_made_up",
      }),
    ).rejects.toThrow(/unknown feedbackType/);

    expect(mock.userFeedback.create).not.toHaveBeenCalled();
  });
});

describe("loadClassifiedEmails", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("queries only classified emails, newest first, including the classification", async () => {
    await loadClassifiedEmails(asPrisma(mock));

    expect(mock.emailMessage.findMany).toHaveBeenCalledTimes(1);
    const arg = mock.emailMessage.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ classification: { isNot: null } });
    expect(arg.include).toEqual({ classification: true });
    expect(arg.orderBy).toEqual({ receivedAt: "desc" });
  });

  it("splits each row into { message, classification } and drops null classifications", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      {
        id: "msg-1",
        sourceId: "fixture-vip-deadline-01",
        threadId: "thread-1",
        senderName: "Rachel Kim",
        senderEmail: "rachel.kim@acmecorp.com",
        subject: "Subject",
        bodyText: "Body",
        receivedAt: new Date("2026-06-25T08:14:22Z"),
        createdAt: new Date("2026-06-25T08:15:00Z"),
        classification: {
          id: "cls-1",
          emailMessageId: "msg-1",
          suggestedBucket: "needs_attention",
        },
      },
      {
        id: "msg-2",
        sourceId: "fixture-orphan",
        threadId: null,
        senderName: "Nobody",
        senderEmail: "nobody@example.com",
        subject: "Orphan",
        bodyText: "Body",
        receivedAt: new Date("2026-06-24T00:00:00Z"),
        createdAt: new Date("2026-06-24T00:00:00Z"),
        classification: null,
      },
    ]);

    const rows = await loadClassifiedEmails(asPrisma(mock));

    expect(rows).toHaveLength(1);
    expect(rows[0].message.id).toBe("msg-1");
    expect(rows[0].message).not.toHaveProperty("classification");
    expect(rows[0].classification.id).toBe("cls-1");
  });
});
