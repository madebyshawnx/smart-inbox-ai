import { describe, expect, it } from "vitest";
import {
  emailClassificationSchema,
  parseClassification,
} from "../../src/lib/classification/schema";

const validPayload = {
  email_id: "email-001",
  thread_id: "thread-001",
  sender: { name: "Alice Smith", email: "alice@example.com" },
  subject: "Q3 budget sign-off needed",
  summary: "Alice is requesting sign-off on the Q3 budget before end of week.",
  priority_level: "high",
  urgency_level: "urgent",
  importance_score: 85,
  confidence_score: 90,
  category: "Finance",
  subcategory: "Budget",
  detected_deadline: "2026-06-30",
  requires_response: true,
  requires_decision: true,
  requires_payment: false,
  requires_scheduling: false,
  needs_follow_up: false,
  waiting_on_reply: false,
  recommended_next_step: "Review budget doc and reply with approval or questions.",
  why_this_matters: "Unblocks the finance team from proceeding with Q3 planning.",
  risk_if_ignored: "Budget cycle delayed; finance team blocked.",
  suggested_bucket: "needs_attention",
  safe_to_ignore: false,
  model_version: "gpt-4o-2024-08-06",
};

describe("emailClassificationSchema", () => {
  it("accepts a fully valid payload", () => {
    const result = emailClassificationSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid priority_level value", () => {
    const result = emailClassificationSchema.safeParse({
      ...validPayload,
      priority_level: "critical",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing a required field", () => {
    const { subject: _omitted, ...withoutSubject } = validPayload;
    const result = emailClassificationSchema.safeParse(withoutSubject);
    expect(result.success).toBe(false);
  });

  it("accepts null for detected_deadline and risk_if_ignored", () => {
    const result = emailClassificationSchema.safeParse({
      ...validPayload,
      detected_deadline: null,
      risk_if_ignored: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.detected_deadline).toBeNull();
      expect(result.data.risk_if_ignored).toBeNull();
    }
  });

  it("rejects a non-integer confidence_score", () => {
    const result = emailClassificationSchema.safeParse({
      ...validPayload,
      confidence_score: 87.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a non-canonical sender email (real Gmail From headers are not always RFC emails)", () => {
    // Regression: a strict .email() here used to fail the whole classification
    // and dump otherwise-fine Gmail into Needs Review (CRITICAL-1).
    for (const email of ["HR Compliance Team", "no-reply", "list@", ""]) {
      const result = emailClassificationSchema.safeParse({
        ...validPayload,
        sender: { name: "Sender", email },
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("parseClassification", () => {
  it("returns success:true with data for a valid payload", () => {
    const result = parseClassification(validPayload);
    expect(result.success).toBe(true);
  });

  it("returns success:false with a string error for an invalid payload", () => {
    const result = parseClassification({ ...validPayload, urgency_level: "asap" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
