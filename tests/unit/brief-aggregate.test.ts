import { describe, expect, it } from "vitest";
import { aggregateBrief } from "../../src/lib/brief/aggregate";
import type { EmailClassification } from "../../src/lib/classification/schema";

/**
 * Returns a fully-valid EmailClassification with sensible defaults.
 * Each test overrides only the fields it cares about.
 */
function makeClassification(overrides: Partial<EmailClassification> = {}): EmailClassification {
  return {
    email_id: "email-1",
    thread_id: "thread-1",
    sender: { name: "Jane Doe", email: "jane@example.com" },
    subject: "Default subject",
    summary: "A short summary of the email.",
    priority_level: "medium",
    urgency_level: "soon",
    importance_score: 50,
    confidence_score: 80,
    category: "general",
    subcategory: null,
    detected_deadline: null,
    requires_response: false,
    requires_decision: false,
    requires_payment: false,
    requires_scheduling: false,
    needs_follow_up: false,
    waiting_on_reply: false,
    recommended_next_step: "No action needed.",
    why_this_matters: "It is relevant to your work.",
    risk_if_ignored: null,
    suggested_bucket: "read_later",
    safe_to_ignore: false,
    model_version: "test-v1",
    ...overrides,
  };
}

describe("aggregateBrief", () => {
  it("returns all-zero counts, empty topEmails, and a 0-email summary for empty input", () => {
    // Arrange
    const classifications: EmailClassification[] = [];

    // Act
    const brief = aggregateBrief(classifications);

    // Assert
    expect(brief.totalEmailsReviewed).toBe(0);
    expect(brief.needsAttentionCount).toBe(0);
    expect(brief.followUpCount).toBe(0);
    expect(brief.deadlineCount).toBe(0);
    expect(brief.moneyOrAccountCount).toBe(0);
    expect(brief.waitingOnReplyCount).toBe(0);
    expect(brief.readLaterCount).toBe(0);
    expect(brief.lowPriorityCount).toBe(0);
    expect(brief.safeToIgnoreCount).toBe(0);
    expect(brief.needsReviewCount).toBe(0);
    expect(brief.topEmails).toEqual([]);
    expect(brief.summary).toContain("0 emails");
  });

  it("counts each bucket correctly for a mixed set", () => {
    // Arrange
    const classifications: EmailClassification[] = [
      makeClassification({ email_id: "a", suggested_bucket: "needs_attention" }),
      makeClassification({ email_id: "b", suggested_bucket: "needs_attention" }),
      makeClassification({ email_id: "c", suggested_bucket: "follow_up_today" }),
      makeClassification({ email_id: "d", suggested_bucket: "deadlines" }),
      makeClassification({ email_id: "e", suggested_bucket: "money_or_account_related" }),
      makeClassification({ email_id: "f", suggested_bucket: "waiting_on_reply" }),
      makeClassification({ email_id: "g", suggested_bucket: "low_priority" }),
      makeClassification({ email_id: "h", suggested_bucket: "safe_to_ignore" }),
    ];

    // Act
    const brief = aggregateBrief(classifications);

    // Assert
    expect(brief.totalEmailsReviewed).toBe(8);
    expect(brief.needsAttentionCount).toBe(2);
    expect(brief.followUpCount).toBe(1);
    expect(brief.deadlineCount).toBe(1);
    expect(brief.moneyOrAccountCount).toBe(1);
    expect(brief.waitingOnReplyCount).toBe(1);
    expect(brief.lowPriorityCount).toBe(1);
    expect(brief.safeToIgnoreCount).toBe(1);
    expect(brief.readLaterCount).toBe(0);
    expect(brief.needsReviewCount).toBe(0);
  });

  it("returns at most the top 3 emails by importance_score in descending order", () => {
    // Arrange
    const classifications: EmailClassification[] = [
      makeClassification({ email_id: "low", importance_score: 10 }),
      makeClassification({ email_id: "high", importance_score: 95 }),
      makeClassification({ email_id: "mid", importance_score: 60 }),
      makeClassification({ email_id: "midlow", importance_score: 40 }),
      makeClassification({ email_id: "top", importance_score: 99 }),
    ];

    // Act
    const brief = aggregateBrief(classifications);

    // Assert
    expect(brief.topEmails).toHaveLength(3);
    expect(brief.topEmails.map((e) => e.email_id)).toEqual(["top", "high", "mid"]);
    expect(brief.topEmails.map((e) => e.importance_score)).toEqual([99, 95, 60]);
  });

  it("maps sender.name to senderName in topEmails", () => {
    // Arrange
    const classifications: EmailClassification[] = [
      makeClassification({
        email_id: "x",
        importance_score: 90,
        sender: { name: "Alice Smith", email: "alice@example.com" },
      }),
    ];

    // Act
    const brief = aggregateBrief(classifications);

    // Assert
    expect(brief.topEmails[0]?.senderName).toBe("Alice Smith");
  });

  it("builds a summary containing the correct total and the top email subject", () => {
    // Arrange
    const classifications: EmailClassification[] = [
      makeClassification({
        email_id: "win",
        subject: "Wire transfer needs approval",
        importance_score: 88,
        suggested_bucket: "money_or_account_related",
      }),
      makeClassification({
        email_id: "other",
        subject: "Weekly newsletter",
        importance_score: 20,
        suggested_bucket: "read_later",
      }),
    ];

    // Act
    const brief = aggregateBrief(classifications);

    // Assert
    expect(brief.summary).toContain("Reviewed 2 emails.");
    expect(brief.summary).toContain("Wire transfer needs approval");
  });
});
