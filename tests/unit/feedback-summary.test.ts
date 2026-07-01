import { describe, expect, it } from "vitest";
import { type SenderFeedbackRecord, summarizeFeedbackBySender } from "@/lib/feedback-summary";

// Build a feedback record with sensible defaults so each test only states what
// it cares about.
function rec(
  feedbackType: SenderFeedbackRecord["feedbackType"],
  overrides: Partial<SenderFeedbackRecord> = {},
): SenderFeedbackRecord {
  return {
    senderName: "Billing Team",
    senderEmail: "billing@acme.com",
    feedbackType,
    ...overrides,
  };
}

describe("summarizeFeedbackBySender", () => {
  it("returns no lines for an empty input", () => {
    expect(summarizeFeedbackBySender([])).toEqual([]);
  });

  it("emits a single trusted guidance line for one corrective feedback", () => {
    const lines = summarizeFeedbackBySender([rec("mark_urgent")]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Billing Team (billing@acme.com)");
    expect(lines[0].toLowerCase()).toContain("urgent");
  });

  it("uses the bare email when the sender name is blank", () => {
    const lines = summarizeFeedbackBySender([
      rec("safe_to_ignore", { senderName: "  ", senderEmail: "noreply@x.com" }),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("noreply@x.com");
    // No empty "()" wrapper when there is no name.
    expect(lines[0]).not.toContain("(noreply@x.com)");
  });

  it("ignores feedback types that carry no triage signal", () => {
    // `correct` confirms the model was right; the sender-preference types are
    // already turned into first-class Smart Rules elsewhere.
    const lines = summarizeFeedbackBySender([
      rec("correct"),
      rec("always_prioritize_sender"),
      rec("usually_ignore_sender"),
    ]);

    expect(lines).toEqual([]);
  });

  it("aggregates repeated identical feedback into one line with a count", () => {
    const lines = summarizeFeedbackBySender([
      rec("move_to_read_later"),
      rec("move_to_read_later"),
      rec("move_to_read_later"),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("(3 times)");
    expect(lines[0]).toContain("Read Later");
  });

  it("does not annotate a single occurrence with a count", () => {
    const lines = summarizeFeedbackBySender([rec("move_to_read_later")]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("times");
  });

  it("groups feedback by sender independently", () => {
    const lines = summarizeFeedbackBySender([
      rec("mark_urgent", { senderName: "Boss", senderEmail: "boss@acme.com" }),
      rec("safe_to_ignore", {
        senderName: "Newsletter",
        senderEmail: "news@promo.com",
      }),
    ]);

    expect(lines).toHaveLength(2);
    expect(
      lines.some((l) => l.includes("boss@acme.com") && l.toLowerCase().includes("urgent")),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes("news@promo.com") && l.toLowerCase().includes("ignore")),
    ).toBe(true);
  });

  it("treats sender emails case-insensitively when grouping", () => {
    const lines = summarizeFeedbackBySender([
      rec("mark_urgent", { senderEmail: "Billing@Acme.com" }),
      rec("mark_urgent", { senderEmail: "billing@acme.com" }),
    ]);

    // Both records collapse into one sender group, so one aggregated line.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("(2 times)");
  });

  it("caps the number of guidance lines for a single noisy sender", () => {
    const lines = summarizeFeedbackBySender([
      rec("mark_urgent"),
      rec("needs_follow_up"),
      rec("safe_to_ignore"),
      rec("not_urgent"),
      rec("move_to_read_later"),
      rec("no_action_needed"),
    ]);

    // Six distinct signal-bearing types for one sender, capped at three lines.
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("orders a sender's lines by correction strength (urgent before low-signal)", () => {
    const lines = summarizeFeedbackBySender([rec("more_like_this"), rec("mark_urgent")]);

    expect(lines).toHaveLength(2);
    // mark_urgent outranks more_like_this, so it comes first.
    expect(lines[0].toLowerCase()).toContain("urgent");
  });

  it("produces deterministic output for the same input", () => {
    const input: SenderFeedbackRecord[] = [
      rec("mark_urgent", { senderEmail: "a@x.com" }),
      rec("safe_to_ignore", { senderEmail: "b@x.com" }),
      rec("needs_follow_up", { senderEmail: "a@x.com" }),
    ];

    expect(summarizeFeedbackBySender(input)).toEqual(summarizeFeedbackBySender(input));
  });

  it("phrases each signal-bearing type as a trusted past-behaviour statement", () => {
    const types: SenderFeedbackRecord["feedbackType"][] = [
      "wrong",
      "more_like_this",
      "less_like_this",
      "mark_urgent",
      "not_urgent",
      "needs_follow_up",
      "no_action_needed",
      "move_to_read_later",
      "safe_to_ignore",
    ];

    for (const type of types) {
      const lines = summarizeFeedbackBySender([rec(type, { senderEmail: `${type}@x.com` })]);
      expect(lines).toHaveLength(1);
      // Every line names the sender so it is unambiguously scoped.
      expect(lines[0]).toContain(`${type}@x.com`);
    }
  });
});
