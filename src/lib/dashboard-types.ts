import type { DailyBrief } from "./brief/aggregate";

// The 9 inbox buckets shown on the dashboard, in display order. (The brief card
// sits above these; "daily_brief" is not itself a bucket here.)
export const BUCKET_KEYS = [
  "needs_attention",
  "follow_up_today",
  "deadlines",
  "waiting_on_reply",
  "money_or_account_related",
  "read_later",
  "low_priority",
  "safe_to_ignore",
  "needs_review",
] as const;

export type BucketKey = (typeof BUCKET_KEYS)[number];

export const BUCKET_LABELS: Record<BucketKey, string> = {
  needs_attention: "Needs Attention",
  follow_up_today: "Follow Up Today",
  deadlines: "Deadlines",
  waiting_on_reply: "Waiting on Reply",
  money_or_account_related: "Money or Account-Related",
  read_later: "Read Later",
  low_priority: "Low Priority",
  safe_to_ignore: "Safe to Ignore",
  needs_review: "Needs Review",
};

export type EmailCard = {
  id: string;
  sourceId: string;
  // Gmail conversation id shared by every message in a thread. Optional in the
  // persistence layer (older/sample rows may lack it), so null-safe here. Used
  // purely for read-only thread grouping in the list; never groups when null.
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  summary: string;
  priorityLevel: string;
  urgencyLevel: string;
  category: string;
  whyThisMatters: string;
  recommendedNextStep: string;
  detectedDeadline: string | null;
  riskIfIgnored: string | null;
  confidenceScore: number;
  suggestedBucket: BucketKey;
  receivedAt: string;
};

export type DashboardData = {
  brief: DailyBrief;
  buckets: Record<BucketKey, EmailCard[]>;
};
