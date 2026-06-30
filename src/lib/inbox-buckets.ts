import type { PriorityTier } from "@/components/priority-style";
import {
  BUCKET_KEYS,
  BUCKET_LABELS,
  type BucketKey,
  type DashboardData,
  type EmailCard,
} from "./dashboard-types";

// The left rail can show every bucket at once ("all" + the daily brief) or
// filter the list down to a single bucket.
export type SelectedBucket = BucketKey | "all";

// Shorter, glanceable labels for the slim rail/list-section headers. Falls back
// to the canonical BUCKET_LABELS for anything not overridden here.
const SHORT_LABELS: Partial<Record<BucketKey, string>> = {
  money_or_account_related: "Money & Accounts",
  waiting_on_reply: "Waiting on Reply",
  safe_to_ignore: "Safe to Ignore",
};

export function sectionLabel(key: BucketKey): string {
  return SHORT_LABELS[key] ?? BUCKET_LABELS[key];
}

// Maps each bucket onto a priority-color tier so the rail can render a single
// consistent dot per bucket (matching the per-email dots in the list).
const BUCKET_TIER: Record<BucketKey, PriorityTier> = {
  needs_attention: "high",
  follow_up_today: "high",
  deadlines: "high",
  waiting_on_reply: "medium",
  money_or_account_related: "medium",
  read_later: "low",
  low_priority: "low",
  safe_to_ignore: "ignore",
  needs_review: "medium",
};

export function bucketTier(key: BucketKey): PriorityTier {
  return BUCKET_TIER[key];
}

export type ListSection = {
  key: BucketKey;
  label: string;
  emails: ReadonlyArray<EmailCard>;
};

// Build the ordered, non-empty list sections. Empty buckets are omitted
// entirely so the list never shows a "None right now" placeholder.
export function buildSections(buckets: DashboardData["buckets"]): ListSection[] {
  const sections: ListSection[] = [];
  for (const key of BUCKET_KEYS) {
    const emails = buckets[key];
    if (emails.length > 0) {
      sections.push({ key, label: sectionLabel(key), emails });
    }
  }
  return sections;
}

// Narrow the rail's sections to the selected bucket. "all" passes everything
// through unchanged (caller decides whether to also show the brief).
export function filterBySelectedBucket(
  sections: ReadonlyArray<ListSection>,
  selected: SelectedBucket,
): ListSection[] {
  if (selected === "all") {
    return [...sections];
  }
  return sections.filter((section) => section.key === selected);
}
