import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above module-level consts, so the shared mock
// objects must be created inside vi.hoisted() to exist when the factory runs.
// Each deleteMany returns a distinct count so we can assert the reported totals.
const { mockPrisma, revokeAccess } = vi.hoisted(() => ({
  mockPrisma: {
    userFeedback: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    emailClassification: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    emailMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    smartRule: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
    priorityProfile: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
    dismissedSuggestion: { deleteMany: vi.fn().mockResolvedValue({ count: 6 }) },
    dailyEmailBrief: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) },
    connectedAccount: { deleteMany: vi.fn().mockResolvedValue({ count: 8 }) },
  },
  revokeAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// Mock the token-revoke helper so no network call happens.
vi.mock("@/lib/google/tokens", () => ({
  revokeAccess: (...args: unknown[]) => revokeAccess(...args),
}));

import { POST } from "@/app/api/user/delete-data/route";

describe("POST /api/user/delete-data", () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Restore default resolved values cleared by clearAllMocks.
    mockPrisma.userFeedback.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.emailClassification.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.emailMessage.deleteMany.mockResolvedValue({ count: 3 });
    mockPrisma.smartRule.deleteMany.mockResolvedValue({ count: 4 });
    mockPrisma.priorityProfile.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.dismissedSuggestion.deleteMany.mockResolvedValue({ count: 6 });
    mockPrisma.dailyEmailBrief.deleteMany.mockResolvedValue({ count: 7 });
    mockPrisma.connectedAccount.deleteMany.mockResolvedValue({ count: 8 });
    revokeAccess.mockResolvedValue(true);
  });

  it("revokes the Google grant and deletes from every table, returning counts", async () => {
    const res = await POST();
    const json = (await res.json()) as { ok: boolean; deleted: Record<string, number> };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    // Best-effort revoke runs before the deletes.
    expect(revokeAccess).toHaveBeenCalledTimes(1);

    // Every table is wiped exactly once.
    expect(mockPrisma.userFeedback.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailClassification.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailMessage.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.smartRule.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.priorityProfile.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.dismissedSuggestion.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.dailyEmailBrief.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.connectedAccount.deleteMany).toHaveBeenCalledTimes(1);

    expect(json.deleted).toEqual({
      userFeedback: 1,
      emailClassifications: 2,
      emails: 3,
      rules: 4,
      priorityProfiles: 5,
      dismissedSuggestions: 6,
      dailyEmailBriefs: 7,
      connectedAccounts: 8,
    });
  });

  it("returns a generic 500 when a delete throws", async () => {
    mockPrisma.emailMessage.deleteMany.mockRejectedValueOnce(new Error("db down"));

    const res = await POST();
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Could not delete your data.");
  });
});
