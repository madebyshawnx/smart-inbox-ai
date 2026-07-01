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
  filterEmailsByQuery,
  filterSectionsByQuery,
  groupEmailsByThread,
  type ListSection,
  sectionLabel,
} from "../../src/lib/inbox-buckets";

function makeEmail(id: string, bucket: BucketKey, overrides: Partial<EmailCard> = {}): EmailCard {
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
    ...overrides,
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

describe("groupEmailsByThread", () => {
  it("returns no groups for an empty list", () => {
    expect(groupEmailsByThread([])).toEqual([]);
  });

  it("treats a single email as a standalone group of one", () => {
    const email = makeEmail("a", "read_later", { threadId: "T1" });
    const groups = groupEmailsByThread([email]);

    expect(groups).toHaveLength(1);
    expect(groups[0].head).toBe(email);
    expect(groups[0].others).toEqual([]);
    expect(groups[0].count).toBe(1);
    expect(groups[0].threadId).toBe("T1");
  });

  it("keeps null-threadId emails standalone and never groups them together", () => {
    const a = makeEmail("a", "read_later", { threadId: null });
    const b = makeEmail("b", "read_later", { threadId: null });

    const groups = groupEmailsByThread([a, b]);

    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(1);
    expect(groups[1].count).toBe(1);
    // Standalone group falls back to the email id for threadId.
    expect(groups[0].threadId).toBe("a");
    expect(groups[1].threadId).toBe("b");
  });

  it("keeps emails with distinct (unique) threadIds standalone", () => {
    const a = makeEmail("a", "read_later", { threadId: "T1" });
    const b = makeEmail("b", "read_later", { threadId: "T2" });

    const groups = groupEmailsByThread([a, b]);

    expect(groups.map((g) => g.count)).toEqual([1, 1]);
    expect(groups.map((g) => g.threadId)).toEqual(["T1", "T2"]);
  });

  it("groups emails sharing a threadId, newest as head and older in others", () => {
    const newest = makeEmail("newest", "needs_attention", {
      threadId: "T1",
      receivedAt: "2026-06-25T12:00:00Z",
    });
    const middle = makeEmail("middle", "needs_attention", {
      threadId: "T1",
      receivedAt: "2026-06-25T10:00:00Z",
    });
    const oldest = makeEmail("oldest", "needs_attention", {
      threadId: "T1",
      receivedAt: "2026-06-25T08:00:00Z",
    });

    // Feed out of order to prove the sort, not the input order, decides head.
    const groups = groupEmailsByThread([middle, oldest, newest]);

    expect(groups).toHaveLength(1);
    expect(groups[0].head.id).toBe("newest");
    expect(groups[0].others.map((e) => e.id)).toEqual(["middle", "oldest"]);
    expect(groups[0].count).toBe(3);
  });

  it("preserves first-seen thread order across mixed threads and singletons", () => {
    const emails = [
      makeEmail("s1", "read_later", { threadId: null }),
      makeEmail("t1a", "read_later", { threadId: "T1", receivedAt: "2026-06-25T09:00:00Z" }),
      makeEmail("s2", "read_later", { threadId: "T2" }),
      makeEmail("t1b", "read_later", { threadId: "T1", receivedAt: "2026-06-25T11:00:00Z" }),
    ];

    const groups = groupEmailsByThread(emails);

    // T1 first appears at index 1 (via t1a), so it precedes the s2 singleton.
    expect(groups.map((g) => g.head.id)).toEqual(["s1", "t1b", "s2"]);
    expect(groups.map((g) => g.count)).toEqual([1, 2, 1]);
  });

  it("breaks receivedAt ties by input order for a stable head", () => {
    const first = makeEmail("first", "read_later", {
      threadId: "T1",
      receivedAt: "2026-06-25T10:00:00Z",
    });
    const second = makeEmail("second", "read_later", {
      threadId: "T1",
      receivedAt: "2026-06-25T10:00:00Z",
    });

    const groups = groupEmailsByThread([first, second]);

    expect(groups[0].head.id).toBe("first");
    expect(groups[0].others.map((e) => e.id)).toEqual(["second"]);
  });
});

describe("filterEmailsByQuery", () => {
  const inbox = [
    makeEmail("a", "needs_attention", {
      senderName: "Alice Payments",
      senderEmail: "alice@bank.com",
      subject: "Invoice due Friday",
      summary: "Your invoice is ready.",
      category: "billing",
    }),
    makeEmail("b", "read_later", {
      senderName: "Bob Newsletter",
      senderEmail: "bob@news.io",
      subject: "Weekly digest",
      summary: "Top stories this week.",
      category: "updates",
    }),
  ];

  it("returns a copy of everything for an empty query", () => {
    const result = filterEmailsByQuery(inbox, "");
    expect(result).toEqual(inbox);
    expect(result).not.toBe(inbox);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(filterEmailsByQuery(inbox, "   ")).toHaveLength(2);
  });

  it("matches on subject case-insensitively", () => {
    const result = filterEmailsByQuery(inbox, "INVOICE");
    expect(result.map((e) => e.id)).toEqual(["a"]);
  });

  it("matches on senderEmail and category", () => {
    expect(filterEmailsByQuery(inbox, "news.io").map((e) => e.id)).toEqual(["b"]);
    expect(filterEmailsByQuery(inbox, "billing").map((e) => e.id)).toEqual(["a"]);
  });

  it("matches on summary and trims surrounding whitespace", () => {
    expect(filterEmailsByQuery(inbox, "  top stories  ").map((e) => e.id)).toEqual(["b"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterEmailsByQuery(inbox, "zzz-no-match")).toEqual([]);
  });

  it("preserves input order among matches", () => {
    const result = filterEmailsByQuery(inbox, "e");
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("filterSectionsByQuery", () => {
  const sections: ListSection[] = [
    {
      key: "needs_attention",
      label: "Needs Attention",
      emails: [
        makeEmail("a", "needs_attention", { subject: "Invoice due" }),
        makeEmail("b", "needs_attention", { subject: "Random note" }),
      ],
    },
    {
      key: "read_later",
      label: "Read Later",
      emails: [makeEmail("c", "read_later", { subject: "Newsletter" })],
    },
  ];

  it("returns all sections (as copies) for an empty query", () => {
    const result = filterSectionsByQuery(sections, "");
    expect(result).toEqual(sections);
    expect(result[0]).not.toBe(sections[0]);
    expect(result[0].emails).not.toBe(sections[0].emails);
  });

  it("filters emails within sections and drops sections with no matches", () => {
    const result = filterSectionsByQuery(sections, "invoice");

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("needs_attention");
    expect(result[0].emails.map((e) => e.id)).toEqual(["a"]);
  });

  it("returns an empty array when no section has a match", () => {
    expect(filterSectionsByQuery(sections, "zzz-no-match")).toEqual([]);
  });
});
