import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeSuggestions } from "@/lib/suggestions";

// Hand-rolled mock matching exactly the Prisma calls computeSuggestions makes
// (via loadClassifiedEmails + listRules + dismissedSuggestion.findMany). Cast to
// PrismaClient at the call site so we don't implement the full model surface.
function makeMockPrisma() {
  const mock = {
    emailMessage: {
      // Used by loadClassifiedEmails.
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Used by getOrCreateDefaultProfile (called inside listRules).
    priorityProfile: {
      findFirst: vi.fn().mockResolvedValue({ id: "profile-1", name: "Default", isDefault: true }),
      create: vi.fn(),
    },
    // Used by listRules.
    smartRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dismissedSuggestion: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return mock;
}

function asPrisma(mock: ReturnType<typeof makeMockPrisma>): PrismaClient {
  return mock as unknown as PrismaClient;
}

// Build a classified-email row in the shape loadClassifiedEmails returns: the
// emailMessage carries a `classification` relation that the helper splits out.
function makeRow(opts: {
  senderName: string;
  senderEmail: string;
  gmailLabels: string | null;
  priorityLevel: string;
  id: string;
}) {
  return {
    id: opts.id,
    sourceId: `src-${opts.id}`,
    threadId: null,
    senderName: opts.senderName,
    senderEmail: opts.senderEmail,
    subject: "Subject",
    bodyText: "Body",
    receivedAt: new Date("2026-06-25T08:00:00Z"),
    createdAt: new Date("2026-06-25T08:00:00Z"),
    gmailLabels: opts.gmailLabels,
    classification: {
      id: `cls-${opts.id}`,
      emailMessageId: opts.id,
      priorityLevel: opts.priorityLevel,
    },
  };
}

describe("computeSuggestions", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("suggests ignoring an all-read, never-starred, low-priority sender (>= MIN)", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Promo Co",
        senderEmail: "deals@promo.co",
        gmailLabels: JSON.stringify(["INBOX"]),
        priorityLevel: "low",
      }),
      makeRow({
        id: "m2",
        senderName: "Promo Co",
        senderEmail: "deals@promo.co",
        gmailLabels: JSON.stringify(["INBOX"]),
        priorityLevel: "ignore",
      }),
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].ruleText).toBe(
      "Treat emails from Promo Co (deals@promo.co) as low priority unless they are clearly urgent.",
    );
    expect(suggestions[0].priorityWeight).toBe(-100);
    expect(suggestions[0].signature).toBe(suggestions[0].ruleText);
    expect(suggestions[0].reason).toContain("Promo Co");
  });

  it("suggests prioritizing a sender with >= 2 starred/important emails", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Rachel Kim",
        senderEmail: "rachel@acme.com",
        gmailLabels: JSON.stringify(["STARRED", "INBOX"]),
        priorityLevel: "high",
      }),
      makeRow({
        id: "m2",
        senderName: "Rachel Kim",
        senderEmail: "rachel@acme.com",
        gmailLabels: JSON.stringify(["IMPORTANT", "UNREAD"]),
        priorityLevel: "medium",
      }),
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].ruleText).toBe(
      "Always prioritize emails from Rachel Kim (rachel@acme.com).",
    );
    expect(suggestions[0].priorityWeight).toBe(100);
  });

  it("does not suggest for a sender with only one email (below MIN)", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Solo Sender",
        senderEmail: "solo@example.com",
        gmailLabels: JSON.stringify(["STARRED", "IMPORTANT"]),
        priorityLevel: "low",
      }),
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(0);
  });

  it("excludes a suggestion that matches an existing active rule", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Rachel Kim",
        senderEmail: "rachel@acme.com",
        gmailLabels: JSON.stringify(["STARRED"]),
        priorityLevel: "high",
      }),
      makeRow({
        id: "m2",
        senderName: "Rachel Kim",
        senderEmail: "rachel@acme.com",
        gmailLabels: JSON.stringify(["IMPORTANT"]),
        priorityLevel: "high",
      }),
    ]);
    mock.smartRule.findMany.mockResolvedValueOnce([
      {
        id: "rule-1",
        ruleText: "Always prioritize emails from Rachel Kim (rachel@acme.com).",
        isActive: true,
        priorityWeight: 100,
      },
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(0);
  });

  it("excludes a suggestion whose signature was previously dismissed", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Promo Co",
        senderEmail: "deals@promo.co",
        gmailLabels: JSON.stringify(["INBOX"]),
        priorityLevel: "low",
      }),
      makeRow({
        id: "m2",
        senderName: "Promo Co",
        senderEmail: "deals@promo.co",
        gmailLabels: JSON.stringify(["INBOX"]),
        priorityLevel: "low",
      }),
    ]);
    mock.dismissedSuggestion.findMany.mockResolvedValueOnce([
      {
        signature:
          "Treat emails from Promo Co (deals@promo.co) as low priority unless they are clearly urgent.",
      },
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(0);
  });

  it("ignores emails with null gmailLabels (fixtures contribute no signal)", async () => {
    mock.emailMessage.findMany.mockResolvedValueOnce([
      makeRow({
        id: "m1",
        senderName: "Fixture Sender",
        senderEmail: "fixture@example.com",
        gmailLabels: null,
        priorityLevel: "low",
      }),
      makeRow({
        id: "m2",
        senderName: "Fixture Sender",
        senderEmail: "fixture@example.com",
        gmailLabels: null,
        priorityLevel: "ignore",
      }),
    ]);

    const suggestions = await computeSuggestions(asPrisma(mock));

    expect(suggestions).toHaveLength(0);
  });
});
