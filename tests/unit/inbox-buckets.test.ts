import { describe, expect, it } from "vitest";
import {
  BUCKET_KEYS,
  type BucketKey,
  type DashboardData,
  type EmailCard,
} from "../../src/lib/dashboard-types";
import {
  bucketTier,
  buildSections,
  filterBySelectedBucket,
  type ListSection,
  sectionLabel,
} from "../../src/lib/inbox-buckets";

function makeEmail(id: string, bucket: BucketKey): EmailCard {
  return {
    id,
    sourceId: `src-${id}`,
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

// Build a buckets map with every key empty, then fill the requested ones.
function makeBuckets(filled: Partial<Record<BucketKey, EmailCard[]>>): DashboardData["buckets"] {
  const buckets = {} as DashboardData["buckets"];
  for (const key of BUCKET_KEYS) {
    buckets[key] = filled[key] ?? [];
  }
  return buckets;
}

describe("buildSections", () => {
  it("returns no sections when all buckets are empty", () => {
    expect(buildSections(makeBuckets({}))).toEqual([]);
  });

  it("omits empty buckets and keeps only non-empty ones", () => {
    const buckets = makeBuckets({
      needs_attention: [makeEmail("a", "needs_attention")],
      read_later: [makeEmail("b", "read_later"), makeEmail("c", "read_later")],
    });

    const sections = buildSections(buckets);

    expect(sections.map((s) => s.key)).toEqual(["needs_attention", "read_later"]);
    expect(sections[1].emails).toHaveLength(2);
  });

  it("orders sections by the canonical BUCKET_KEYS order, not insertion order", () => {
    const buckets = makeBuckets({
      read_later: [makeEmail("b", "read_later")],
      needs_attention: [makeEmail("a", "needs_attention")],
    });

    expect(buildSections(buckets).map((s) => s.key)).toEqual(["needs_attention", "read_later"]);
  });
});

describe("filterBySelectedBucket", () => {
  const sections: ListSection[] = [
    {
      key: "needs_attention",
      label: "Needs Attention",
      emails: [makeEmail("a", "needs_attention")],
    },
    { key: "read_later", label: "Read Later", emails: [makeEmail("b", "read_later")] },
  ];

  it("returns all sections (a copy) when 'all' is selected", () => {
    const result = filterBySelectedBucket(sections, "all");
    expect(result).toEqual(sections);
    expect(result).not.toBe(sections);
  });

  it("returns only the matching section for a specific bucket", () => {
    const result = filterBySelectedBucket(sections, "read_later");
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("read_later");
  });

  it("returns an empty array when the selected bucket has no section", () => {
    expect(filterBySelectedBucket(sections, "deadlines")).toEqual([]);
  });
});

describe("bucketTier", () => {
  it("maps every bucket key to a valid tier", () => {
    for (const key of BUCKET_KEYS) {
      expect(["high", "medium", "low", "ignore"]).toContain(bucketTier(key));
    }
  });

  it("classifies urgent buckets as high and ignore buckets as ignore", () => {
    expect(bucketTier("needs_attention")).toBe("high");
    expect(bucketTier("deadlines")).toBe("high");
    expect(bucketTier("safe_to_ignore")).toBe("ignore");
  });
});

describe("sectionLabel", () => {
  it("uses the short override when present", () => {
    expect(sectionLabel("money_or_account_related")).toBe("Money & Accounts");
  });

  it("falls back to the canonical label otherwise", () => {
    expect(sectionLabel("needs_attention")).toBe("Needs Attention");
  });
});
