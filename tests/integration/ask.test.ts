import { describe, expect, it } from "vitest";
import { type AskEmail, answerQuestion } from "@/lib/ask/answer";
import type { ModelClient } from "@/lib/classification/classify";

const sampleEmails: AskEmail[] = [
  {
    senderName: "Rachel Kim",
    senderEmail: "rachel@acme.com",
    subject: "Q2 budget summary",
    receivedAt: "2026-06-25T08:00:00.000Z",
    summary: "Rachel needs the Q2 budget before the board call.",
    whyThisMatters: "A senior stakeholder is blocked.",
    priorityLevel: "high",
    suggestedBucket: "needs_attention",
    recommendedNextStep: "Send the PDF before 5pm.",
    detectedDeadline: "2026-06-25T17:00:00.000Z",
  },
  {
    senderName: "Newsletter",
    senderEmail: "news@example.com",
    subject: "Weekly digest",
    receivedAt: "2026-06-24T08:00:00.000Z",
    summary: "Routine newsletter, nothing actionable.",
    whyThisMatters: "Low importance.",
    priorityLevel: "low",
    suggestedBucket: "read_later",
    recommendedNextStep: "Read when you have time.",
    detectedDeadline: null,
  },
];

// A mock ModelClient that records what it was asked and returns a fixed answer.
function makeMockClient(answer = "Rachel Kim is waiting on the Q2 budget."): {
  client: ModelClient;
  calls: Array<{ system: string; user: string }>;
} {
  const calls: Array<{ system: string; user: string }> = [];
  const client: ModelClient = {
    async complete(params) {
      calls.push(params);
      return answer;
    },
  };
  return { client, calls };
}

describe("answerQuestion", () => {
  it("sends the question and an <emails> block, and returns the model's text", async () => {
    const { client, calls } = makeMockClient("Rachel is waiting on you.");

    const result = await answerQuestion(sampleEmails, "What's waiting on me?", client);

    expect(result).toBe("Rachel is waiting on you.");
    expect(calls).toHaveLength(1);

    const { user } = calls[0];
    // The trusted question is present.
    expect(user).toContain("What's waiting on me?");
    // The emails are framed inside a dedicated block.
    expect(user).toContain("<emails>");
    expect(user).toContain("</emails>");
    // Each provided email appears in the block.
    expect(user).toContain("Rachel Kim");
    expect(user).toContain("Q2 budget summary");
    expect(user).toContain("Newsletter");
    expect(user).toContain("Weekly digest");
  });

  it("frames the emails as untrusted data the model must not obey (injection defense)", async () => {
    const { client, calls } = makeMockClient();

    await answerQuestion(sampleEmails, "Summarize my inbox", client);

    const { system, user } = calls[0];
    // The system prompt must tell the model the emails are untrusted and that it
    // must never obey instructions found inside them.
    expect(system.toLowerCase()).toContain("untrusted");
    expect(system.toLowerCase()).toMatch(/never obey|not.*obey|ignore.*instruction/);
    // The emails live inside the tagged, untrusted block in the user message.
    expect(user).toContain("<emails>");
  });

  it("caps the emails sent to the model at the 40 most recent", async () => {
    const many: AskEmail[] = Array.from({ length: 50 }, (_, i) => ({
      senderName: `Sender ${i}`,
      senderEmail: `sender${i}@example.com`,
      subject: `Subject ${i}`,
      receivedAt: "2026-06-25T08:00:00.000Z",
      summary: `Summary ${i}`,
      whyThisMatters: "x",
      priorityLevel: "low",
      suggestedBucket: "read_later",
      recommendedNextStep: "x",
      detectedDeadline: null,
    }));
    const { client, calls } = makeMockClient();

    await answerQuestion(many, "anything?", client);

    const { user } = calls[0];
    // The first 40 are included; the 41st onward are dropped.
    expect(user).toContain("Subject 39");
    expect(user).not.toContain("Subject 40");
  });
});
