import { beforeEach, describe, expect, it, vi } from "vitest";

// The route now wraps rule creation in prisma.$transaction(async (tx) => ...).
// Provide a $transaction that invokes the callback with a truthy tx client so
// createRule still receives a non-null client (asserted via expect.anything()).
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({ __tx: true }),
  },
}));

vi.mock("@/lib/rules", () => ({
  createRule: vi.fn(),
}));

import { POST } from "@/app/api/onboarding/route";
import { createRule } from "@/lib/rules";

const mockedCreateRule = vi.mocked(createRule);

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates each rule and returns 201 with the created rules", async () => {
    mockedCreateRule.mockImplementation(async (_db, input) => ({
      id: `rule-${input.ruleText}`,
      ruleText: input.ruleText,
      isActive: true,
      priorityWeight: input.priorityWeight ?? 0,
    }));

    const rules = [
      { ruleText: "Always prioritize emails from boss.", priorityWeight: 100 },
      { ruleText: "Put newsletters into Read Later.", priorityWeight: 0 },
    ];
    const response = await POST(jsonRequest({ rules }));

    expect(response.status).toBe(201);
    const data = (await response.json()) as { created: unknown[] };
    expect(data.created).toHaveLength(2);
    expect(mockedCreateRule).toHaveBeenCalledTimes(2);
    expect(mockedCreateRule).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        ruleText: "Always prioritize emails from boss.",
        priorityWeight: 100,
      }),
    );
    expect(mockedCreateRule).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ ruleText: "Put newsletters into Read Later.", priorityWeight: 0 }),
    );
  });

  it("returns 400 when rules is empty without calling createRule", async () => {
    const response = await POST(jsonRequest({ rules: [] }));

    expect(response.status).toBe(400);
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("returns 400 when rules is missing without calling createRule", async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid rule (empty ruleText)", async () => {
    const response = await POST(jsonRequest({ rules: [{ ruleText: "" }] }));

    expect(response.status).toBe(400);
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const badRequest = new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });

    const response = await POST(badRequest);

    expect(response.status).toBe(400);
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("maps a createRule validation error to 400", async () => {
    mockedCreateRule.mockRejectedValue(new Error("ruleText too long"));

    const response = await POST(jsonRequest({ rules: [{ ruleText: "valid by zod" }] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "ruleText too long" });
  });
});
