import type { PrismaClient } from "@prisma/client";
import type { FeedbackType } from "./persistence";

/**
 * Turn a user's stored feedback into short, trusted guidance lines keyed by
 * sender, so corrective feedback (not just sender-preference rules) can shape
 * future classification.
 *
 * v1 "learning" is explicit, human-readable guidance — the classifier sees
 * plain-English sentences like "You previously marked mail from billing@x.com
 * as urgent", never opaque weights. This keeps every learned behaviour
 * inspectable and overridable, and keeps the boundary clean: these lines are
 * trusted (they come from the user's own actions), so they go in their own
 * tagged prompt section, never mixed with untrusted email content.
 *
 * The core transform here is a PURE function (no DB, no clock) so it is trivially
 * unit-testable; {@link loadSenderFeedbackSummary} is the thin DB adapter.
 */

// A single feedback record flattened with the sender it was given against. This
// is the only shape the pure summariser needs — decoupled from Prisma payloads
// so tests can build plain objects.
export type SenderFeedbackRecord = {
  senderName: string;
  senderEmail: string;
  feedbackType: FeedbackType;
};

// Aggregated, signal-bearing feedback grouped per sender.
type SenderGroup = {
  senderName: string;
  senderEmail: string;
  counts: Map<FeedbackType, number>;
};

// Only feedback types that imply a repeatable triage preference produce guidance.
// `correct` confirms the model was already right (no correction to learn), and
// the sender-preference types (`always_prioritize_sender`/`usually_ignore_sender`)
// already become first-class Smart Rules elsewhere, so they are intentionally
// excluded here to avoid saying the same thing twice to the model.
const GUIDANCE_FEEDBACK_TYPES: ReadonlySet<FeedbackType> = new Set<FeedbackType>([
  "wrong",
  "more_like_this",
  "less_like_this",
  "mark_urgent",
  "not_urgent",
  "needs_follow_up",
  "no_action_needed",
  "move_to_read_later",
  "safe_to_ignore",
]);

// Below this count a single stray click is treated as noise, not a pattern — a
// guidance line is only emitted once the user has repeated the same correction
// for the same sender. Set to 1 so a single explicit correction still counts,
// but the threshold lives in one named place so it can be tightened later.
const MIN_OCCURRENCES_FOR_GUIDANCE = 1;

// Cap how many guidance lines a single sender can contribute, so a noisy sender
// can never flood the prompt and dilute the user's other rules.
const MAX_LINES_PER_SENDER = 3;

function describeSender(senderName: string, senderEmail: string): string {
  const name = senderName.trim();
  return name === "" ? senderEmail : `${name} (${senderEmail})`;
}

// Plain-English phrasing for a learned correction. Written as a statement of past
// user behaviour ("You previously …") so the model treats it as a trusted signal
// about this sender, not as a command it must blindly obey.
function guidanceLine(feedbackType: FeedbackType, sender: string, count: number): string | null {
  const repeated = count > 1 ? ` (${count} times)` : "";
  switch (feedbackType) {
    case "mark_urgent":
      return `You previously marked mail from ${sender} as urgent${repeated}; lean toward higher urgency for this sender.`;
    case "not_urgent":
      return `You previously marked mail from ${sender} as not urgent${repeated}; lean toward lower urgency for this sender.`;
    case "move_to_read_later":
      return `You usually move mail from ${sender} to Read Later${repeated}; this sender is rarely time-sensitive.`;
    case "safe_to_ignore":
      return `You have marked mail from ${sender} as safe to ignore${repeated}; treat this sender as low priority unless clearly urgent.`;
    case "needs_follow_up":
      return `You previously flagged mail from ${sender} as needing follow-up${repeated}; surface it for action rather than hiding it.`;
    case "no_action_needed":
      return `You previously marked mail from ${sender} as needing no action${repeated}; it is unlikely to require a response.`;
    case "more_like_this":
      return `You asked to see more mail like this from ${sender}${repeated}; treat this sender as relevant.`;
    case "less_like_this":
      return `You asked to see less mail like this from ${sender}${repeated}; deprioritise this sender.`;
    case "wrong":
      return `You previously marked the assistant's triage of mail from ${sender} as wrong${repeated}; classify this sender's mail carefully.`;
    default:
      return null;
  }
}

// Stable ordering so the same feedback always yields the same guidance text —
// important for prompt caching and for deterministic tests. Stronger, more
// actionable corrections sort first so they survive the per-sender cap.
const FEEDBACK_PRIORITY: readonly FeedbackType[] = [
  "mark_urgent",
  "needs_follow_up",
  "safe_to_ignore",
  "not_urgent",
  "move_to_read_later",
  "no_action_needed",
  "wrong",
  "less_like_this",
  "more_like_this",
];

function feedbackRank(feedbackType: FeedbackType): number {
  const idx = FEEDBACK_PRIORITY.indexOf(feedbackType);
  return idx === -1 ? FEEDBACK_PRIORITY.length : idx;
}

/**
 * PURE: turn a flat list of sender-attributed feedback into trusted guidance
 * lines, grouped and de-duplicated per sender.
 *
 * - Records whose feedback type carries no triage signal are ignored.
 * - Identical (sender, feedbackType) pairs are aggregated into one line with a
 *   repetition count rather than repeated.
 * - Output is deterministic: senders are ordered by first appearance, and each
 *   sender's lines are ordered by {@link FEEDBACK_PRIORITY}.
 */
export function summarizeFeedbackBySender(records: SenderFeedbackRecord[]): string[] {
  const groups = new Map<string, SenderGroup>();

  for (const record of records) {
    if (!GUIDANCE_FEEDBACK_TYPES.has(record.feedbackType)) {
      continue;
    }
    const key = record.senderEmail.toLowerCase();
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        senderName: record.senderName,
        senderEmail: record.senderEmail,
        counts: new Map(),
      };
      groups.set(key, group);
    }
    group.counts.set(record.feedbackType, (group.counts.get(record.feedbackType) ?? 0) + 1);
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    const sender = describeSender(group.senderName, group.senderEmail);

    const ranked = [...group.counts.entries()]
      .filter(([, count]) => count >= MIN_OCCURRENCES_FOR_GUIDANCE)
      .sort(([a], [b]) => feedbackRank(a) - feedbackRank(b))
      .slice(0, MAX_LINES_PER_SENDER);

    for (const [feedbackType, count] of ranked) {
      const line = guidanceLine(feedbackType, sender, count);
      if (line !== null) {
        lines.push(line);
      }
    }
  }

  return lines;
}

/**
 * Load stored feedback (optionally just for one sender) and summarise it into
 * trusted guidance lines via {@link summarizeFeedbackBySender}.
 *
 * Joins UserFeedback → EmailMessage so each feedback row is attributed to the
 * sender it was given against. When `senderEmail` is provided the query is scoped
 * to that sender (used by the targeted re-classification after new feedback);
 * otherwise it summarises all feedback (used by a full sync).
 *
 * The Prisma client is injected so callers and tests can supply a real client or
 * a mock — this module never imports the `prisma` singleton.
 */
export async function loadSenderFeedbackSummary(
  db: PrismaClient,
  senderEmail?: string,
): Promise<string[]> {
  const rows = await db.userFeedback.findMany({
    where: senderEmail !== undefined ? { emailMessage: { senderEmail } } : undefined,
    select: {
      feedbackType: true,
      emailMessage: { select: { senderName: true, senderEmail: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const records: SenderFeedbackRecord[] = rows
    .filter((row) => row.emailMessage !== null && row.emailMessage !== undefined)
    .map((row) => ({
      senderName: row.emailMessage.senderName,
      senderEmail: row.emailMessage.senderEmail,
      feedbackType: row.feedbackType as FeedbackType,
    }));

  return summarizeFeedbackBySender(records);
}
