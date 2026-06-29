import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK so no real network call or API key is ever required.
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMock };
    constructor(public opts: unknown) {}
  }
  return { default: MockAnthropic };
});

import {
  AnthropicModelClient,
  createAnthropicClient,
} from "../../src/lib/classification/anthropic-client";
import { MODEL_VERSION } from "../../src/lib/classification/classify";

describe("AnthropicModelClient", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("concatenates and trims text blocks from the response", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: '  {"a":' },
        { type: "text", text: "1}  " },
      ],
    });

    const client = new AnthropicModelClient({ apiKey: "test-key" });
    const result = await client.complete({ system: "sys", user: "usr" });

    expect(result).toBe('{"a":1}');
  });

  it("passes model, max_tokens, and temperature 0 to the API", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const client = createAnthropicClient({ apiKey: "k", maxTokens: 512 });
    await client.complete({ system: "S", user: "U" });

    expect(createMock).toHaveBeenCalledWith({
      model: MODEL_VERSION,
      max_tokens: 512,
      temperature: 0,
      system: "S",
      messages: [{ role: "user", content: "U" }],
    });
  });

  it("ignores non-text content blocks", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "tool_use", id: "t1", name: "x", input: {} },
        { type: "text", text: "kept" },
      ],
    });

    const client = new AnthropicModelClient({ apiKey: "k" });
    expect(await client.complete({ system: "s", user: "u" })).toBe("kept");
  });

  it("throws when the response has no text content", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
    });

    const client = new AnthropicModelClient({ apiKey: "k" });
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow(
      "Anthropic response contained no text content",
    );
  });
});
