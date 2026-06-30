import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadDashboardData } from "@/lib/dashboard-data";
import { BUCKET_KEYS } from "@/lib/dashboard-types";
import type { PersistedClassification, PersistedMessage } from "@/lib/persistence";

type Overrides = Partial<PersistedMessage> & Partial<PersistedClassification>;

// Build a Prisma findMany row (message fields + nested classification) so the
// mock mirrors what `loadClassifiedEmails` consumes.
function makeRow(id: string, bucket: string, importance: number, overrides: Overrides = {}) {
  const message: PersistedMessage = {
    id,
    sourceId: `source-${id}`,
    threadId: null,
    senderName: `Sender ${id}`,
    senderEmail: `${id}@example.com`,
    subject: `Subject ${id}`,
    bodyText: "Body",
    receivedAt: new Date("2026-06-25T08:00:00Z"),
    gmailLabels: null,
    createdAt: new Date("2026-06-25T08:01:00Z"),
    ...overrides,
  };

  const classification: PersistedClassification = {
    id: `cls-${id}`,
    emailMessageId: id,
    priorityLevel: "high",
    urgencyLevel: "urgent",
    importanceScore: importance,
    confidenceScore: 90,
    category: "work",
    subcategory: null,
    summary: `Summary ${id}`,
    whyThisMatters: `Why ${id}`,
    recommendedNextStep: `Step ${id}`,
    detectedDeadline: null,
    requiresResponse: false,
    requiresDecision: false,
    requiresPayment: false,
    requiresScheduling: false,
    needsFollowUp: false,
    waitingOnReply: false,
    riskIfIgnored: null,
    suggestedBucket: bucket,
    safeToIgnore: false,
    modelVersion: "claude-sonnet-4-6",
    createdAt: new Date("2026-06-25T08:01:00Z"),
    ...overrides,
  };

  return { ...message, classification };
}

function mockPrismaReturning(rows: unknown[]): PrismaClient {
  return {
    emailMessage: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient;
}

describe("loadDashboardData", () => {
  it("groups cards into their suggested bucket and keeps every bucket key present", async () => {
    const db = mockPrismaReturning([
      makeRow("a", "needs_attention", 90),
      makeRow("b", "deadlines", 70),
      makeRow("c", "needs_attention", 50),
    ]);

    const data = await loadDashboardData(db);

    // Every bucket exists, even those with no emails.
    for (const key of BUCKET_KEYS) {
      expect(data.buckets[key]).toBeDefined();
      expect(Array.isArray(data.buckets[key])).toBe(true);
    }

    expect(data.buckets.needs_attention).toHaveLength(2);
    expect(data.buckets.deadlines).toHaveLength(1);
    expect(data.buckets.waiting_on_reply).toHaveLength(0);

    // Cards carry the camelCase shape with an ISO receivedAt.
    const card = data.buckets.needs_attention[0];
    expect(card.id).toBe("a");
    expect(card.suggestedBucket).toBe("needs_attention");
    expect(card.receivedAt).toBe("2026-06-25T08:00:00.000Z");
  });

  it("computes brief counts from the reconstructed classification records", async () => {
    const db = mockPrismaReturning([
      makeRow("a", "needs_attention", 90),
      makeRow("b", "deadlines", 70),
      makeRow("c", "needs_attention", 50),
      makeRow("d", "money_or_account_related", 40),
    ]);

    const data = await loadDashboardData(db);

    expect(data.brief.totalEmailsReviewed).toBe(4);
    expect(data.brief.needsAttentionCount).toBe(2);
    expect(data.brief.deadlineCount).toBe(1);
    expect(data.brief.moneyOrAccountCount).toBe(1);
    // Highest importance email surfaces first in topEmails.
    expect(data.brief.topEmails[0].subject).toBe("Subject a");
  });

  it("maps an unknown persisted bucket to needs_review", async () => {
    const db = mockPrismaReturning([makeRow("x", "totally_unknown_bucket", 10)]);

    const data = await loadDashboardData(db);

    expect(data.buckets.needs_review).toHaveLength(1);
    expect(data.brief.needsReviewCount).toBe(1);
  });

  it("routes a daily_brief bucket to read_later instead of burying it in needs_review", async () => {
    // Regression (CRITICAL-2): daily_brief is a model-allowed value but not a
    // real column; it must land in a visible bucket, not Needs Review.
    const db = mockPrismaReturning([makeRow("d", "daily_brief", 30)]);

    const data = await loadDashboardData(db);

    expect(data.buckets.read_later).toHaveLength(1);
    expect(data.buckets.needs_review).toHaveLength(0);
  });

  it("returns all empty buckets and a zero brief when there are no emails", async () => {
    const db = mockPrismaReturning([]);

    const data = await loadDashboardData(db);

    expect(data.brief.totalEmailsReviewed).toBe(0);
    for (const key of BUCKET_KEYS) {
      expect(data.buckets[key]).toHaveLength(0);
    }
  });
});
