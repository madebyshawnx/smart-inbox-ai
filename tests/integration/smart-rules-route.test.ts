import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

vi.mock("@/lib/rules", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/smart-rules/[id]/route";
import { GET, POST } from "@/app/api/smart-rules/route";
import { createRule, deleteRule, listRules, updateRule } from "@/lib/rules";

const mockedListRules = vi.mocked(listRules);
const mockedCreateRule = vi.mocked(createRule);
const mockedUpdateRule = vi.mocked(updateRule);
const mockedDeleteRule = vi.mocked(deleteRule);

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/smart-rules", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/smart-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the rules with status 200", async () => {
    const rules = [{ id: "rule-1", ruleText: "flag invoices", isActive: true, priorityWeight: 1 }];
    mockedListRules.mockResolvedValue(rules);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rules });
  });
});

describe("POST /api/smart-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a rule and returns 201 with the rule", async () => {
    const rule = { id: "rule-1", ruleText: "flag invoices", isActive: true, priorityWeight: 0 };
    mockedCreateRule.mockResolvedValue(rule);

    const response = await POST(jsonRequest("POST", { ruleText: "flag invoices" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ rule });
    expect(mockedCreateRule).toHaveBeenCalledTimes(1);
    expect(mockedCreateRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ruleText: "flag invoices" }),
    );
  });

  it("returns 400 for an empty ruleText without calling createRule", async () => {
    const response = await POST(jsonRequest("POST", { ruleText: "" }));

    expect(response.status).toBe(400);
    expect(mockedCreateRule).not.toHaveBeenCalled();
  });

  it("maps a createRule validation error to 400", async () => {
    mockedCreateRule.mockRejectedValue(new Error("ruleText too long"));

    const response = await POST(jsonRequest("POST", { ruleText: "still valid by zod" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "ruleText too long" });
  });
});

describe("PATCH /api/smart-rules/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a rule and returns 200", async () => {
    const rule = { id: "rule-1", ruleText: "updated", isActive: false, priorityWeight: 2 };
    mockedUpdateRule.mockResolvedValue(rule);

    const patch = { ruleText: "updated", isActive: false };
    const response = await PATCH(jsonRequest("PATCH", patch), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rule });
    expect(mockedUpdateRule).toHaveBeenCalledWith(expect.anything(), "rule-1", patch);
  });

  it("returns 400 for an empty patch body", async () => {
    const response = await PATCH(jsonRequest("PATCH", {}), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(response.status).toBe(400);
    expect(mockedUpdateRule).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/smart-rules/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a rule and returns 200 with { ok: true }", async () => {
    mockedDeleteRule.mockResolvedValue(undefined);

    const response = await DELETE(jsonRequest("DELETE", {}), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockedDeleteRule).toHaveBeenCalledWith(expect.anything(), "rule-1");
  });
});
