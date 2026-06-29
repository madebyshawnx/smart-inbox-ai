import type { DailyBrief } from "@/lib/brief/aggregate";

type DailyEmailBriefCardProps = {
  brief: DailyBrief;
};

/**
 * Compact count callouts shown inside the brief hero. Only the headline buckets
 * appear here; the full set lives in PriorityMetricsBar below the hero.
 */
const HERO_METRICS: ReadonlyArray<{ label: string; value: (b: DailyBrief) => number }> = [
  { label: "Reviewed", value: (b) => b.totalEmailsReviewed },
  { label: "Needs attention", value: (b) => b.needsAttentionCount },
  { label: "Deadlines", value: (b) => b.deadlineCount },
  { label: "Money / account", value: (b) => b.moneyOrAccountCount },
  { label: "Waiting on reply", value: (b) => b.waitingOnReplyCount },
];

export function DailyEmailBriefCard({ brief }: DailyEmailBriefCardProps) {
  const topEmails = brief.topEmails.slice(0, 3);

  return (
    <section
      aria-labelledby="daily-brief-heading"
      className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-6 shadow-[0_12px_40px_-20px_rgba(20,20,60,0.25)] sm:p-8"
    >
      <p className="text-xs font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
        Daily brief
      </p>
      <h2
        id="daily-brief-heading"
        className="mt-2 max-w-3xl text-2xl leading-snug font-semibold text-balance text-[var(--ink-900)] sm:text-3xl"
      >
        {brief.summary}
      </h2>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-t border-[var(--hairline)] pt-5">
        {HERO_METRICS.map((metric) => (
          <div key={metric.label}>
            <dt className="text-[0.7rem] font-medium tracking-wide text-[var(--ink-500)] uppercase">
              {metric.label}
            </dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-[var(--ink-900)]">
              {metric.value(brief)}
            </dd>
          </div>
        ))}
      </dl>

      {topEmails.length > 0 && (
        <div className="mt-6 border-t border-[var(--hairline)] pt-5">
          <p className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase">
            Top priorities
          </p>
          <ol className="mt-3 flex flex-col gap-3">
            {topEmails.map((email, index) => (
              <li key={email.email_id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)] tabular-nums"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ink-900)]">{email.subject}</p>
                  <p className="text-xs text-[var(--ink-500)]">{email.senderName}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink-700)]">
                    {email.why_this_matters}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
