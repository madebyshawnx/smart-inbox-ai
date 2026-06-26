import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRule,
  deleteRule,
  getOrCreateDefaultProfile,
  listRules,
  loadActiveRuleTexts,
  updateRule,
} from "@/lib/rules";

// Hand-rolled mock that matches exactly the Prisma calls the helpers make. Cast
// to PrismaClient at the call site so we don't have to implement the full model.
function makeMockPrisma() {
  const mock = {
    priorityProfile: {
      findFirst: vi.fn().mockResolvedValue({ id: "profile-1", name: "Default", isDefault: true }),
      create: vi.fn().mockResolvedValue({ id: "profile-new", name: "Default", isDefault: true }),
    },
    smartRule: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "rule-1",
        ruleText: "Prioritize my boss",
        isActive: true,
        priorityWeight: 0,
      }),
      update: vi.fn().mockResolvedValue({
        id: "rule-1",
        ruleText: "Prioritize my boss",
        isActive: false,
        priorityWeight: 5,
      }),
      delete: vi.fn().mockResolvedValue({ id: "rule-1" }),
    },
  };
  return mock;
}

function asPrisma(mock: ReturnType<typeof makeMockPrisma>): PrismaClient {
  return mock as unknown as PrismaClient;
}

describe("getOrCreateDefaultProfile", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("returns the existing default profile when one is found", async () => {
    const profile = await getOrCreateDefaultProfile(asPrisma(mock));

    expect(mock.priorityProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(mock.priorityProfile.findFirst.mock.calls[0][0].where).toEqual({ isDefault: true });
    expect(mock.priorityProfile.create).not.toHaveBeenCalled();
    expect(profile).toEqual({ id: "profile-1", name: "Default", isDefault: true });
  });

  it("creates a default profile when none exists", async () => {
    mock.priorityProfile.findFirst.mockResolvedValueOnce(null);

    const profile = await getOrCreateDefaultProfile(asPrisma(mock));

    expect(mock.priorityProfile.create).toHaveBeenCalledTimes(1);
    const arg = mock.priorityProfile.create.mock.calls[0][0];
    expect(arg.data).toEqual({ name: "Default", isDefault: true });
    expect(profile.isDefault).toBe(true);
    expect(profile.id).toBe("profile-new");
  });
});

describe("listRules", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("queries rules for the default profile ordered by createdAt asc and maps to DTOs", async () => {
    mock.smartRule.findMany.mockResolvedValueOnce([
      {
        id: "rule-a",
        ruleText: "first",
        isActive: true,
        priorityWeight: 0,
        createdAt: new Date(),
        // extra columns must be dropped by the DTO mapping
        priorityProfileId: "profile-1",
      },
    ]);

    const rules = await listRules(asPrisma(mock));

    const arg = mock.smartRule.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ priorityProfileId: "profile-1" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
    expect(rules).toEqual([{ id: "rule-a", ruleText: "first", isActive: true, priorityWeight: 0 }]);
  });
});

describe("createRule", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("rejects empty ruleText without writing", async () => {
    await expect(createRule(asPrisma(mock), { ruleText: "" })).rejects.toThrow(
      /ruleText is required/,
    );
    expect(mock.smartRule.create).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only ruleText without writing", async () => {
    await expect(createRule(asPrisma(mock), { ruleText: "   " })).rejects.toThrow(
      /ruleText is required/,
    );
    expect(mock.smartRule.create).not.toHaveBeenCalled();
  });

  it("rejects ruleText longer than 280 chars without writing", async () => {
    await expect(createRule(asPrisma(mock), { ruleText: "x".repeat(281) })).rejects.toThrow(
      /ruleText too long/,
    );
    expect(mock.smartRule.create).not.toHaveBeenCalled();
  });

  it("creates a valid rule under the default profile with isActive true", async () => {
    const dto = await createRule(asPrisma(mock), {
      ruleText: "  Prioritize my boss  ",
      priorityWeight: 3,
    });

    expect(mock.smartRule.create).toHaveBeenCalledTimes(1);
    const arg = mock.smartRule.create.mock.calls[0][0];
    expect(arg.data).toEqual({
      priorityProfileId: "profile-1",
      ruleText: "Prioritize my boss",
      isActive: true,
      priorityWeight: 3,
    });
    expect(dto).toEqual({
      id: "rule-1",
      ruleText: "Prioritize my boss",
      isActive: true,
      priorityWeight: 0,
    });
  });

  it("defaults priorityWeight to 0 when omitted", async () => {
    await createRule(asPrisma(mock), { ruleText: "Prioritize my boss" });
    expect(mock.smartRule.create.mock.calls[0][0].data.priorityWeight).toBe(0);
  });
});

describe("updateRule", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("applies only the provided fields", async () => {
    await updateRule(asPrisma(mock), "rule-1", { isActive: false, priorityWeight: 5 });

    const arg = mock.smartRule.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "rule-1" });
    expect(arg.data).toEqual({ isActive: false, priorityWeight: 5 });
    expect(arg.data).not.toHaveProperty("ruleText");
  });

  it("re-validates ruleText when present and trims it", async () => {
    await updateRule(asPrisma(mock), "rule-1", { ruleText: "  new text  " });
    expect(mock.smartRule.update.mock.calls[0][0].data.ruleText).toBe("new text");
  });

  it("rejects an invalid ruleText patch without writing", async () => {
    await expect(
      updateRule(asPrisma(mock), "rule-1", { ruleText: "x".repeat(281) }),
    ).rejects.toThrow(/ruleText too long/);
    expect(mock.smartRule.update).not.toHaveBeenCalled();
  });
});

describe("deleteRule", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("deletes the rule by id", async () => {
    await deleteRule(asPrisma(mock), "rule-99");

    expect(mock.smartRule.delete).toHaveBeenCalledTimes(1);
    expect(mock.smartRule.delete.mock.calls[0][0]).toEqual({ where: { id: "rule-99" } });
  });
});

describe("loadActiveRuleTexts", () => {
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
  });

  it("returns only ruleText strings, filtering isActive and ordering by weight desc", async () => {
    mock.smartRule.findMany.mockResolvedValueOnce([
      { ruleText: "high weight", isActive: true, priorityWeight: 10 },
      { ruleText: "low weight", isActive: true, priorityWeight: 1 },
    ]);

    const texts = await loadActiveRuleTexts(asPrisma(mock));

    const arg = mock.smartRule.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ priorityProfileId: "profile-1", isActive: true });
    expect(arg.orderBy).toEqual([{ priorityWeight: "desc" }, { createdAt: "asc" }]);
    expect(texts).toEqual(["high weight", "low weight"]);
  });
});
