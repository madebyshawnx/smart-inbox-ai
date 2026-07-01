import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFeedback } from "@/lib/feedback";

// Hand-rolled Prisma mock exposing only the calls applyFeedback makes.
function makeDb(overrides?: {
  email?: { senderName: string; senderEmail: string } | null;
  existingRule?: { id: string; ruleText: string; isActive: boolean; priorityWeight: number } | null;
}) {
  const profile = { id: "profile-1", name: "Default", isDefault: true };
  return {
    userFeedback: { create: vi.fn().mockResolvedValue({ id: "fb-1" }) },
    emailMessage: {
      findUnique: vi.fn().mockResolvedValue(overrides?.email ?? null),
    },
    priorityProfile: {
      findFirst: vi.fn().mockResolvedValue(profile),
      create: vi.fn().mockResolvedValue(profile),
    },
    smartRule: {
      findFirst: vi.fn().mockResolvedValue(overrides?.existingRule ?? null),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: "rule-1", isActive: true, priorityWeight: 0, ...data }),
        ),
    },
  };
}

const sender = { senderName: "Rachel Kim", senderEmail: "rachel@acme.com" };

describe("applyFeedback", () => {
  afterEach(() => vi.clearAllMocks());

  it("records non-sender feedback without creating a rule", async () => {
    const db = makeDb();
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "msg-1",
      feedbackType: "correct",
    });

    expect(db.userFeedback.create).toHaveBeenCalledTimes(1);
    expect(db.smartRule.create).not.toHaveBeenCalled();
    // senderEmail is null here because makeDb() returns no email for the lookup.
    expect(result).toEqual({ ruleCreated: false, ruleText: null, senderEmail: null });
  });

  it("attributes non-sender feedback to its sender so it can drive re-classification", async () => {
    const db = makeDb({ email: sender });
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "msg-1",
      feedbackType: "mark_urgent",
    });

    // Corrective feedback creates no rule, but still resolves the sender so the
    // caller can re-classify that sender's stored mail.
    expect(db.smartRule.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      ruleCreated: false,
      ruleText: null,
      senderEmail: "rachel@acme.com",
    });
  });

  it("creates a prioritize rule from always_prioritize_sender feedback", async () => {
    const db = makeDb({ email: sender });
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "msg-1",
      feedbackType: "always_prioritize_sender",
    });

    expect(db.userFeedback.create).toHaveBeenCalledTimes(1);
    expect(db.smartRule.create).toHaveBeenCalledTimes(1);
    expect(result.ruleCreated).toBe(true);
    expect(result.ruleText).toBe("Always prioritize emails from Rachel Kim (rachel@acme.com).");
    // High weight so the rule sorts to the top of the list the classifier sees.
    const created = db.smartRule.create.mock.calls[0][0] as { data: { priorityWeight: number } };
    expect(created.data.priorityWeight).toBeGreaterThan(0);
  });

  it("creates a low-priority rule from usually_ignore_sender feedback", async () => {
    const db = makeDb({ email: sender });
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "msg-1",
      feedbackType: "usually_ignore_sender",
    });

    expect(result.ruleCreated).toBe(true);
    expect(result.ruleText).toContain(
      "Treat emails from Rachel Kim (rachel@acme.com) as low priority",
    );
    const created = db.smartRule.create.mock.calls[0][0] as { data: { priorityWeight: number } };
    expect(created.data.priorityWeight).toBeLessThan(0);
  });

  it("is idempotent: does not duplicate an existing identical active rule", async () => {
    const db = makeDb({
      email: sender,
      existingRule: {
        id: "rule-existing",
        ruleText: "Always prioritize emails from Rachel Kim (rachel@acme.com).",
        isActive: true,
        priorityWeight: 100,
      },
    });
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "msg-1",
      feedbackType: "always_prioritize_sender",
    });

    expect(db.smartRule.create).not.toHaveBeenCalled();
    expect(result.ruleCreated).toBe(false);
  });

  it("saves feedback but creates no rule when the email is missing", async () => {
    const db = makeDb({ email: null });
    const result = await applyFeedback(db as unknown as PrismaClient, {
      emailMessageId: "missing",
      feedbackType: "always_prioritize_sender",
    });

    expect(db.userFeedback.create).toHaveBeenCalledTimes(1);
    expect(db.smartRule.create).not.toHaveBeenCalled();
    expect(result).toEqual({ ruleCreated: false, ruleText: null, senderEmail: null });
  });

  it("rejects an unknown feedback type before any rule work", async () => {
    const db = makeDb({ email: sender });
    await expect(
      applyFeedback(db as unknown as PrismaClient, {
        emailMessageId: "msg-1",
        feedbackType: "bogus",
      }),
    ).rejects.toThrow();
    expect(db.smartRule.create).not.toHaveBeenCalled();
  });
});
