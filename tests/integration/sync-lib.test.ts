import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifyResult, RawEmail } from "@/lib/classification/classify";

// Mock every dependency of runSync so it never touches Google, the network, or a
// real database. Mirrors the mocking style of classify-route.test.ts.

const getAccessToken = vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("tok");
vi.mock("@/lib/google/tokens", () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...args),
}));

const fetchRecentEmails = vi.fn<(...args: unknown[]) => Promise<RawEmail[]>>();
vi.mock("@/lib/google/gmail", () => ({
  fetchRecentEmails: (...args: unknown[]) => fetchRecentEmails(...args),
}));

const findClassifiedSourceIds = vi
  .fn<(...args: unknown[]) => Promise<Set<string>>>()
  .mockResolvedValue(new Set());
const saveClassifiedEmail = vi
  .fn<(...args: unknown[]) => Promise<string>>()
  .mockResolvedValue("msg-id");
vi.mock("@/lib/persistence", () => ({
  findClassifiedSourceIds: (...args: unknown[]) => findClassifiedSourceIds(...args),
  saveClassifiedEmail: (...args: unknown[]) => saveClassifiedEmail(...args),
}));

vi.mock("@/lib/rules", () => ({
  loadActiveRuleTexts: vi.fn().mockResolvedValue([]),
}));

// classifyEmail returns a result keyed off the email's sourceId so we can shape
// per-email statuses in each test.
const classifyEmail = vi.fn<(...args: unknown[]) => Promise<ClassifyResult>>();
vi.mock("@/lib/classification/classify", () => ({
  classifyEmail: (...args: unknown[]) => classifyEmail(...args),
}));

vi.mock("@/lib/classification/anthropic-client", () => ({
  createAnthropicClient: () => ({
    async complete() {
      return "";
    },
  }),
}));

import { runSync } from "@/lib/sync";

const db = {} as PrismaClient;

function email(sourceId: string): RawEmail {
  return {
    sourceId,
    senderName: "Sender",
    senderEmail: "sender@example.com",
    subject: "Subject",
    bodyText: "Body",
    receivedAt: "2026-06-25T08:00:00Z",
  };
}

function result(status: "classified" | "needs_review"): ClassifyResult {
  return {
    status,
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
      suggested_bucket: status === "needs_review" ? "needs_review" : "needs_attention",
      safe_to_ignore: false,
      model_version: "claude-haiku-4-5",
    },
  };
}

describe("runSync", () => {
  afterEach(() => {
    getAccessToken.mockClear();
    fetchRecentEmails.mockClear();
    findClassifiedSourceIds.mockReset();
    findClassifiedSourceIds.mockResolvedValue(new Set());
    saveClassifiedEmail.mockClear();
    classifyEmail.mockReset();
  });

  it("classifies and persists each new email, counting classified vs needs-review", async () => {
    fetchRecentEmails.mockResolvedValue([email("a"), email("b"), email("c")]);
    classifyEmail.mockImplementation(async (...args: unknown[]) =>
      (args[0] as RawEmail).sourceId === "c" ? result("needs_review") : result("classified"),
    );

    const counts = await runSync(db);

    expect(counts).toEqual({ classified: 2, needsReview: 1, skipped: 0, total: 3 });
    expect(saveClassifiedEmail).toHaveBeenCalledTimes(3);
  });

  it("skips already-classified emails and does not re-classify them", async () => {
    fetchRecentEmails.mockResolvedValue([email("a"), email("b"), email("c")]);
    findClassifiedSourceIds.mockResolvedValue(new Set(["a", "b"]));
    classifyEmail.mockResolvedValue(result("classified"));

    const counts = await runSync(db);

    expect(counts).toEqual({ classified: 1, needsReview: 0, skipped: 2, total: 3 });
    expect(classifyEmail).toHaveBeenCalledTimes(1);
    expect(saveClassifiedEmail).toHaveBeenCalledTimes(1);
  });

  it("re-classifies everything when reclassify is true (ignores prior classification)", async () => {
    fetchRecentEmails.mockResolvedValue([email("a"), email("b")]);
    classifyEmail.mockResolvedValue(result("classified"));

    const counts = await runSync(db, { reclassify: true });

    expect(counts).toEqual({ classified: 2, needsReview: 0, skipped: 0, total: 2 });
    // When reclassify is set, the already-classified lookup is skipped entirely.
    expect(findClassifiedSourceIds).not.toHaveBeenCalled();
    expect(classifyEmail).toHaveBeenCalledTimes(2);
  });

  it("returns zeroed counts for an empty inbox without classifying", async () => {
    fetchRecentEmails.mockResolvedValue([]);

    const counts = await runSync(db);

    expect(counts).toEqual({ classified: 0, needsReview: 0, skipped: 0, total: 0 });
    expect(classifyEmail).not.toHaveBeenCalled();
    expect(saveClassifiedEmail).not.toHaveBeenCalled();
  });

  it("returns all-skipped when every fetched email is already classified", async () => {
    fetchRecentEmails.mockResolvedValue([email("a"), email("b")]);
    findClassifiedSourceIds.mockResolvedValue(new Set(["a", "b"]));

    const counts = await runSync(db);

    expect(counts).toEqual({ classified: 0, needsReview: 0, skipped: 2, total: 2 });
    expect(classifyEmail).not.toHaveBeenCalled();
  });
});
