import type { DailyBrief } from "@/lib/brief/aggregate";
import { BUCKET_LABELS, type BucketKey } from "@/lib/dashboard-types";
import { resolvePriorityTier, tierStyle } from "./priority-style";

type PriorityMetricsBarProps = {
  brief: DailyBrief;
};

/**
 * Pairs each bucket with its brief count and a priority weight used to tint the
 * chip. Order follows perceived urgency, not BUCKET_KEYS order.
 */
const METRICS: ReadonlyArray<{ key: BucketKey; count: (b: DailyBrief) => number; weight: string }> =
  [
    { key: "needs_attention", count: (b) => b.needsAttentionCount, weight: "high" },
    { key: "deadlines", count: (b) => b.deadlineCount, weight: "high" },
    { key: "follow_up_today", count: (b) => b.followUpCount, weight: "medium" },
    { key: "money_or_account_related", count: (b) => b.moneyOrAccountCount, weight: "medium" },
    { key: "waiting_on_reply", count: (b) => b.waitingOnReplyCount, weight: "medium" },
    { key: "read_later", count: (b) => b.readLaterCount, weight: "low" },
    { key: "low_priority", count: (b) => b.lowPriorityCount, weight: "low" },
    { key: "needs_review", count: (b) => b.needsReviewCount, weight: "medium" },
    { key: "safe_to_ignore", count: (b) => b.safeToIgnoreCount, weight: "ignore" },
  ];

export function PriorityMetricsBar({ brief }: PriorityMetricsBarProps) {
  const chips = METRICS.map((metric) => ({ ...metric, value: metric.count(brief) })).filter(
    (metric) => metric.value > 0,
  );

  if (chips.length === 0) {
    return null;
  }

  return (
    <section aria-label="Inbox counts at a glance">
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const { accentVar, softVar } = tierStyle(resolvePriorityTier(chip.weight));
          return (
            <li key={chip.key}>
              <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface-raised)] py-1 pr-2.5 pl-1.5 text-xs font-medium text-[var(--ink-700)]">
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                  style={{ backgroundColor: softVar, color: accentVar }}
                >
                  {chip.value}
                </span>
                {BUCKET_LABELS[chip.key]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
