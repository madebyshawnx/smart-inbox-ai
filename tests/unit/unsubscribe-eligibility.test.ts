import { describe, expect, test } from "vitest";
import type { BucketKey } from "@/lib/dashboard-types";
import { isUnsubscribeProne } from "@/lib/unsubscribe-eligibility";

describe("isUnsubscribeProne", () => {
  test("returns true for low-signal buckets regardless of category", () => {
    const lowSignal: BucketKey[] = ["safe_to_ignore", "low_priority", "read_later"];
    for (const bucket of lowSignal) {
      expect(isUnsubscribeProne(bucket, "personal")).toBe(true);
    }
  });

  test("returns true for bulk-looking categories in any bucket", () => {
    expect(isUnsubscribeProne("needs_attention", "Newsletter")).toBe(true);
    expect(isUnsubscribeProne("needs_review", "promotions")).toBe(true);
    expect(isUnsubscribeProne("follow_up_today", "Marketing digest")).toBe(true);
    expect(isUnsubscribeProne("waiting_on_reply", "Social update")).toBe(true);
  });

  test("is case-insensitive on the category hint match", () => {
    expect(isUnsubscribeProne("needs_attention", "PROMO BLAST")).toBe(true);
  });

  test("returns false for high-signal buckets with a non-bulk category", () => {
    expect(isUnsubscribeProne("needs_attention", "personal")).toBe(false);
    expect(isUnsubscribeProne("deadlines", "invoice")).toBe(false);
    expect(isUnsubscribeProne("money_or_account_related", "receipt")).toBe(false);
  });
});
