import Anthropic from "@anthropic-ai/sdk";
import { MODEL_VERSION, type ModelClient } from "./classify";

export type AnthropicModelClientOptions = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

const DEFAULT_MAX_TOKENS = 1024;

/**
 * Real {@link ModelClient} backed by the Anthropic Messages API.
 *
 * If `apiKey` is omitted the Anthropic SDK reads `ANTHROPIC_API_KEY` from the
 * environment itself — we deliberately do not read or validate the env var here,
 * so a missing key surfaces as an auth error at call time rather than at
 * construction time.
 */
export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicModelClientOptions = {}) {
    // Passing `apiKey: undefined` is fine — the SDK falls back to ANTHROPIC_API_KEY.
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? MODEL_VERSION;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(params: { system: string; user: string }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // temperature 0 keeps classification as deterministic as the API allows.
      temperature: 0,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
    });

    // content is a discriminated union of blocks; keep only the text blocks
    // and concatenate them so a multi-block response is handled correctly.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (text.trim() === "") {
      throw new Error("Anthropic response contained no text content");
    }

    return text.trim();
  }
}

/**
 * Factory wrapper around {@link AnthropicModelClient} for callers that prefer a
 * function over a class.
 */
export function createAnthropicClient(opts?: AnthropicModelClientOptions): ModelClient {
  return new AnthropicModelClient(opts);
}
