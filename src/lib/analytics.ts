import type { DailyBrief } from "./brief/aggregate";
import { BUCKET_KEYS, type BucketKey, type DashboardData } from "./dashboard-types";

// ---------------------------------------------------------------------------
// Usage analytics (pure, read-only, additive)
// ---------------------------------------------------------------------------

/**
 * Estimated wall-clock time a human spends manually triaging one email
 * (reading the subject/sender, deciding what to do, and moving on). This is a
 * deliberately conservative average used only to give the "time saved" number
 * a defensible, documented basis — not a precise measurement.
 *
 * Assumption: 30 seconds per triaged email. The app has already read, scored,
 * and bucketed every email, so the time saved is the time the user would
 * otherwise have spent doing that triage by hand across the whole inbox.
 */
export const SECONDS_SAVED_PER_EMAIL = 30;

export type UsageStats = {
  // Total emails triaged (== brief.totalEmailsReviewed, surfaced here so the
  // analytics panel has a single self-contained payload).
  totalTriaged: number;
  // Per-bucket counts in canonical BUCKET_KEYS order, always all nine keys
  // present (zero when a bucket is empty), so the UI never special-cases gaps.
  perBucket: Record<BucketKey, number>;
  // Share of the inbox that was safe to ignore, 0-100, rounded to one decimal.
  // 0 when there are no emails (avoids NaN from dividing by zero).
  safeToIgnorePct: number;
  // Share of the inbox that was low priority, 0-100, rounded to one decimal.
  lowPriorityPct: number;
  // Assumption used for the estimate below, echoed for transparency in the UI.
  secondsSavedPerEmail: number;
  // Estimated seconds of manual triage avoided (totalTriaged * per-email cost).
  estimatedTimeSavedSeconds: number;
  // The same estimate in whole minutes, rounded, for glanceable display.
  estimatedTimeSavedMinutes: number;
};

// Percentage of `part` out of `total`, 0-100, one decimal place. Returns 0 when
// total is 0 so an empty inbox reads as "0%" rather than NaN.
function percentOf(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Compute usage stats for the analytics panel from the already-loaded
 * dashboard buckets and brief. Pure: no DB access, no side effects, fully
 * deterministic.
 *
 * Counts are taken from the live `buckets` (what the user actually sees) so
 * they stay consistent with the rendered list. `totalTriaged` and the
 * time-saved estimate derive from the same bucket totals; the daily `brief` is
 * accepted for API symmetry with the dashboard payload and to keep the door
 * open for brief-only figures later, but bucket counts are the source of truth
 * here.
 */
export function computeUsageStats({ buckets }: Pick<DashboardData, "buckets">): UsageStats {
  const perBucket = {} as Record<BucketKey, number>;
  let totalTriaged = 0;
  for (const key of BUCKET_KEYS) {
    const count = buckets[key]?.length ?? 0;
    perBucket[key] = count;
    totalTriaged += count;
  }

  const estimatedTimeSavedSeconds = totalTriaged * SECONDS_SAVED_PER_EMAIL;

  return {
    totalTriaged,
    perBucket,
    safeToIgnorePct: percentOf(perBucket.safe_to_ignore, totalTriaged),
    lowPriorityPct: percentOf(perBucket.low_priority, totalTriaged),
    secondsSavedPerEmail: SECONDS_SAVED_PER_EMAIL,
    estimatedTimeSavedSeconds,
    estimatedTimeSavedMinutes: Math.round(estimatedTimeSavedSeconds / 60),
  };
}

// Re-exported for callers that already hold a DailyBrief and want the type
// alongside the analytics payload without a second import site.
export type { DailyBrief };
