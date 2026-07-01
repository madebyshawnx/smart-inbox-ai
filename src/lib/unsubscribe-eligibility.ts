import type { BucketKey } from "./dashboard-types";

/**
 * Buckets whose mail is low-signal enough that offering a prominent
 * "Unsubscribe" affordance makes sense (newsletters, promotions, and other
 * clutter usually land here).
 */
const UNSUBSCRIBE_PRONE_BUCKETS: ReadonlySet<BucketKey> = new Set([
  "safe_to_ignore",
  "low_priority",
  "read_later",
]);

/**
 * Category substrings that strongly signal bulk / marketing mail regardless of
 * which bucket the classifier chose. Matched case-insensitively.
 */
const UNSUBSCRIBE_PRONE_CATEGORY_HINTS: ReadonlyArray<string> = [
  "newsletter",
  "promo",
  "marketing",
  "digest",
  "notification",
  "update",
  "social",
];

/**
 * Decide whether to surface the "Unsubscribe" action prominently for an email.
 *
 * Pure and side-effect-free. The unsubscribe action itself is always safe to
 * attempt (the API only fetches List-Unsubscribe headers and never sends), so
 * this is purely a UI-emphasis decision: show it up-front for low-signal /
 * bulk-looking mail, and keep it out of the way for everything else.
 */
export function isUnsubscribeProne(bucketKey: BucketKey, category: string): boolean {
  if (UNSUBSCRIBE_PRONE_BUCKETS.has(bucketKey)) {
    return true;
  }
  const normalized = category.toLowerCase();
  return UNSUBSCRIBE_PRONE_CATEGORY_HINTS.some((hint) => normalized.includes(hint));
}
