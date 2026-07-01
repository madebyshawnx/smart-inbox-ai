import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifyResult, RawEmail } from "@/lib/classification/classify";

// Isolate reclassifyStoredBySender / archiveStoredBySender from Google, the
// model, and the DB. Mirrors sync-lib.test.ts, but exercises the two per-sender
// helpers rather than runSync.

const classifyEmail = vi.fn<(...args: unknown[]) => Promise<ClassifyResult>>();
vi.mock("@/lib/classification/classify", () => ({
  classifyEmail: (...args: unknown[]) => classifyEmail(...args),
}));

const saveClassifiedEmail = vi
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("msg-id");
vi.mock("@/lib/persistence", () => ({
  saveClassifiedEmail: (...args: unknown[]) => saveClassifiedEmail(...args),
}));

vi.mock("@/lib/rules", () => ({
  loadActiveRuleTexts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback-summary", () => ({
  loadSenderFeedbackSummary: vi.fn().mockResolvedValue([]),
  summarizeFeedbackBySender: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/classification/anthropic-client", () => ({
  createAnthropicClient: () => ({
    async complete() {
      return "";
    },
  }),
}));

// archiveMessage is the SAFE reversible write. Assert it's called per Gmail row
// and that a per-item throw is counted, not fatal.
const archiveMessage = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
vi.mock("@/lib/google/gmail-actions", () => ({
  archiveMessage: (...args: unknown[]) => archiveMessage(...args),
}));

vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: vi.fn().mockResolvedValue("tok"),
}));

vi.mock("@/lib/google/gmail", () => ({
  fetchRecentEmails: vi.fn().mockResolvedValue([]),
}));

import {
  archiveStoredBySender,
  RECLASSIFY_BY_SENDER_LIMIT,
  reclassifyStoredBySender,
} from "@/lib/sync";

function classified(): ClassifyResult {
  return {
    status: "classified",
    classification: {
      email_id: "id",
      thread_id: "id",
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
      model_version: "claude-haiku-4-5",
    },
  };
}

function storedRow(sourceId: string, gmailLabels: string | null = null) {
  return {
    sourceId,
    threadId: null,
    senderName: "Sender",
    senderEmail: "sender@example.com",
    subject: "Subject",
    bodyText: "Body",
    receivedAt: new Date("2026-06-25T08:00:00.000Z"),
    gmailLabels,
  };
}

describe("reclassifyStoredBySender", () => {
  afterEach(() => {
    classifyEmail.mockReset();
    saveClassifiedEmail.mockClear();
  });

  it("passes the configured limit to the DB `take` (bounds the reclassify)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { emailMessage: { findMany } } as unknown as PrismaClient;

    await reclassifyStoredBySender(db, "sender@example.com", { limit: 3 });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].take).toBe(3);
    // Zero rows → never classifies or saves.
    expect(classifyEmail).not.toHaveBeenCalled();
    expect(saveClassifiedEmail).not.toHaveBeenCalled();
  });

  it("defaults `take` to RECLASSIFY_BY_SENDER_LIMIT when no limit is given", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { emailMessage: { findMany } } as unknown as PrismaClient;

    await reclassifyStoredBySender(db, "sender@example.com");

    expect(findMany.mock.calls[0][0].take).toBe(RECLASSIFY_BY_SENDER_LIMIT);
  });

  it("tolerates a corrupt gmailLabels JSON blob — classifies without labels, no throw", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        storedRow("gmail:a", "{ not valid json"),
        storedRow("gmail:b", JSON.stringify(["INBOX", 42, "UNREAD"])),
      ]);
    const db = { emailMessage: { findMany } } as unknown as PrismaClient;
    classifyEmail.mockResolvedValue(classified());

    const counts = await reclassifyStoredBySender(db, "sender@example.com");

    expect(counts).toEqual({ reclassified: 2, needsReview: 0, total: 2 });
    // Corrupt blob → labels undefined (not passed through as a broken value).
    const firstEmail = classifyEmail.mock.calls[0][0] as RawEmail;
    expect(firstEmail.labels).toBeUndefined();
    // Non-string entries filtered out of the valid array.
    const secondEmail = classifyEmail.mock.calls[1][0] as RawEmail;
    expect(secondEmail.labels).toEqual(["INBOX", "UNREAD"]);
  });
});

describe("archiveStoredBySender", () => {
  afterEach(() => {
    archiveMessage.mockReset();
    archiveMessage.mockResolvedValue(undefined);
  });

  it("counts a per-item archive failure without aborting the rest", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { sourceId: "gmail:a" },
        { sourceId: "gmail:b" },
        { sourceId: "gmail:c" },
      ]);
    const db = { emailMessage: { findMany } } as unknown as PrismaClient;
    // The middle message fails; a and c still archive.
    archiveMessage.mockImplementation(async (_token: unknown, gmailId: unknown) => {
      if (gmailId === "b") {
        throw new Error("Gmail API request failed (500)");
      }
    });

    const counts = await archiveStoredBySender(db, "sender@example.com", "tok");

    expect(counts).toEqual({ archived: 2, errors: 1, total: 3 });
    expect(archiveMessage).toHaveBeenCalledTimes(3);
  });

  it("skips non-Gmail sample rows without counting them (not archived, not errored)", async () => {
    const findMany = vi.fn().mockResolvedValue([{ sourceId: "gmail:a" }, { sourceId: "sample:1" }]);
    const db = { emailMessage: { findMany } } as unknown as PrismaClient;

    const counts = await archiveStoredBySender(db, "sender@example.com", "tok");

    expect(counts).toEqual({ archived: 1, errors: 0, total: 1 });
    expect(archiveMessage).toHaveBeenCalledTimes(1);
  });
});
