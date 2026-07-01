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

// ---------------------------------------------------------------------------
// Thread grouping (read-only, additive)
// ---------------------------------------------------------------------------

// A conversation: the newest message (`head`) plus its older replies
// (`others`, newest-first). `count` is the total messages in the thread
// (head + others). Singletons and emails with a null/unique threadId become a
// group of size 1 with an empty `others` array, so callers can render every
// group uniformly and thread-unaware rows degrade to exactly today's behavior.
export type ThreadGroup = {
  threadId: string;
  head: EmailCard;
  others: ReadonlyArray<EmailCard>;
  count: number;
};

// Newest-first by receivedAt (ISO 8601 strings sort chronologically as raw
// strings, but parse to be robust to differing offsets/precision).
function receivedAtDesc(a: EmailCard, b: EmailCard): number {
  return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
}

/**
 * Group a bucket's emails into conversations sharing a `threadId`.
 *
 * Pure and deterministic. Emails with a null threadId (or a threadId that no
 * other email shares) stay standalone as a single-item group. Group ordering
 * and singleton ordering both follow the *original input order* of each
 * thread's first-seen email, so a list already sorted newest-first stays
 * newest-first and thread-unaware rendering is unchanged. Within a multi-email
 * group, the newest email becomes `head` and the rest fill `others`
 * (newest-first); ties fall back to input order for stability.
 */
export function groupEmailsByThread(emails: ReadonlyArray<EmailCard>): ThreadGroup[] {
  // Preserve first-seen order of thread keys so output order matches input.
  const order: string[] = [];
  const groups = new Map<string, EmailCard[]>();

  emails.forEach((email, index) => {
    // Null threadId can never collide, so make it unique per-email; a shared
    // threadId groups. Prefix keeps a real threadId from ever colliding with a
    // synthesized standalone key.
    const key = email.threadId ? `t:${email.threadId}` : `s:${email.id}:${index}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(email);
    } else {
      groups.set(key, [email]);
      order.push(key);
    }
  });

  return order.map((key) => {
    const members = groups.get(key) ?? [];
    // Stable newest-first sort: tag with input index, compare by date then index.
    const sorted = members
      .map((email, index) => ({ email, index }))
      .sort((a, b) => {
        const byDate = receivedAtDesc(a.email, b.email);
        return byDate !== 0 ? byDate : a.index - b.index;
      })
      .map(({ email }) => email);

    const [head, ...others] = sorted;
    return {
      threadId: head.threadId ?? head.id,
      head,
      others,
      count: sorted.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Search (read-only, additive)
// ---------------------------------------------------------------------------

// Fields matched by the free-text list search, in the order a human scans them.
const SEARCH_FIELDS: ReadonlyArray<keyof EmailCard> = [
  "senderName",
  "senderEmail",
  "subject",
  "summary",
  "category",
];

function matchesQuery(email: EmailCard, normalizedQuery: string): boolean {
  return SEARCH_FIELDS.some((field) => {
    const value = email[field];
    return typeof value === "string" && value.toLowerCase().includes(normalizedQuery);
  });
}

/**
 * Filter emails by a case-insensitive, trimmed free-text query over
 * senderName, senderEmail, subject, summary, and category.
 *
 * Pure. An empty or whitespace-only query returns a copy of every email
 * (search-inactive). Matching preserves input order.
 */
export function filterEmailsByQuery(emails: ReadonlyArray<EmailCard>, query: string): EmailCard[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return [...emails];
  }
  return emails.filter((email) => matchesQuery(email, normalized));
}

/**
 * Apply {@link filterEmailsByQuery} across every section, dropping sections
 * that end up with no matches so the list never shows an empty header. An
 * empty query returns every section unchanged (as copies).
 */
export function filterSectionsByQuery(
  sections: ReadonlyArray<ListSection>,
  query: string,
): ListSection[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return sections.map((section) => ({ ...section, emails: [...section.emails] }));
  }
  const result: ListSection[] = [];
  for (const section of sections) {
    const emails = filterEmailsByQuery(section.emails, query);
    if (emails.length > 0) {
      result.push({ ...section, emails });
    }
  }
  return result;
}
