import { describe, expect, it } from "vitest";
import { computeUsageStats, SECONDS_SAVED_PER_EMAIL } from "../../src/lib/analytics";
import {
  BUCKET_KEYS,
  type BucketKey,
  type DashboardData,
  type EmailCard,
} from "../../src/lib/dashboard-types";

function makeEmail(id: string, bucket: BucketKey): EmailCard {
  return {
    id,
    sourceId: `src-${id}`,
    threadId: null,
    senderName: "Jane Doe",
    senderEmail: "jane@example.com",
    subject: `Subject ${id}`,
    summary: "Summary.",
    priorityLevel: "medium",
    urgencyLevel: "soon",
    category: "general",
    whyThisMatters: "Because.",
    recommendedNextStep: "Do the thing.",
    detectedDeadline: null,
    riskIfIgnored: null,
    confidenceScore: 80,
    suggestedBucket: bucket,
    receivedAt: "2026-06-25T08:00:00Z",
  };
}

// Build a full buckets map (all nine keys present), filling requested counts.
function makeBuckets(counts: Partial<Record<BucketKey, number>>): DashboardData["buckets"] {
  const buckets = {} as DashboardData["buckets"];
  for (const key of BUCKET_KEYS) {
    const n = counts[key] ?? 0;
    buckets[key] = Array.from({ length: n }, (_, i) => makeEmail(`${key}-${i}`, key));
  }
  return buckets;
}

describe("computeUsageStats", () => {
  it("returns all-zero stats for an empty inbox without dividing by zero", () => {
    const stats = computeUsageStats({ buckets: makeBuckets({}) });

    expect(stats.totalTriaged).toBe(0);
    expect(stats.safeToIgnorePct).toBe(0);
    expect(stats.lowPriorityPct).toBe(0);
    expect(stats.estimatedTimeSavedSeconds).toBe(0);
    expect(stats.estimatedTimeSavedMinutes).toBe(0);
    for (const key of BUCKET_KEYS) {
      expect(stats.perBucket[key]).toBe(0);
    }
  });

  it("counts every bucket and totals them", () => {
    const stats = computeUsageStats({
      buckets: makeBuckets({
        needs_attention: 2,
        read_later: 3,
        safe_to_ignore: 5,
      }),
    });

    expect(stats.totalTriaged).toBe(10);
    expect(stats.perBucket.needs_attention).toBe(2);
    expect(stats.perBucket.read_later).toBe(3);
    expect(stats.perBucket.safe_to_ignore).toBe(5);
    expect(stats.perBucket.deadlines).toBe(0);
  });

  it("computes safe-to-ignore and low-priority percentages to one decimal", () => {
    const stats = computeUsageStats({
      buckets: makeBuckets({
        needs_attention: 1,
        low_priority: 1,
        safe_to_ignore: 1,
      }),
    });

    // 1 of 3 = 33.333... -> 33.3
    expect(stats.safeToIgnorePct).toBe(33.3);
    expect(stats.lowPriorityPct).toBe(33.3);
  });

  it("reports 100% when the whole inbox is safe to ignore", () => {
    const stats = computeUsageStats({ buckets: makeBuckets({ safe_to_ignore: 4 }) });
    expect(stats.safeToIgnorePct).toBe(100);
  });

  it("estimates time saved from the documented per-email assumption", () => {
    const stats = computeUsageStats({
      buckets: makeBuckets({ needs_attention: 2, read_later: 2 }),
    });

    expect(stats.secondsSavedPerEmail).toBe(SECONDS_SAVED_PER_EMAIL);
    expect(stats.estimatedTimeSavedSeconds).toBe(4 * SECONDS_SAVED_PER_EMAIL);
    // 4 * 30s = 120s = 2 min
    expect(stats.estimatedTimeSavedMinutes).toBe(2);
  });

  it("rounds estimated minutes to the nearest whole minute", () => {
    // 5 emails * 30s = 150s = 2.5 min -> rounds to 3 (Math.round half-up).
    const stats = computeUsageStats({ buckets: makeBuckets({ read_later: 5 }) });
    expect(stats.estimatedTimeSavedSeconds).toBe(150);
    expect(stats.estimatedTimeSavedMinutes).toBe(3);
  });
});
