import type { EmailCard } from "@/lib/dashboard-types";
import { FeedbackButtons } from "./FeedbackButtons";
import { resolvePriorityTier, tierStyle } from "./priority-style";
import { WhyThisMattersPanel } from "./WhyThisMattersPanel";

type EmailPriorityCardProps = {
  email: EmailCard;
};

function formatDeadline(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * A single classified email. Surfaces sender, subject, the model's reasoning,
 * the recommended action, optional deadline/risk, confidence, and feedback.
 */
export function EmailPriorityCard({ email }: EmailPriorityCardProps) {
  const tier = resolvePriorityTier(email.priorityLevel);
  const { accentVar, softVar } = tierStyle(tier);
  const confidencePct = Math.round(email.confidenceScore * 100);

  return (
    <article
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-5 transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(20,20,40,0.18)]"
      style={{ borderLeftColor: accentVar, borderLeftWidth: "3px" }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--ink-900)]">
            {email.subject}
          </h3>
          <p className="mt-0.5 truncate text-sm text-[var(--ink-500)]">
            <span className="font-medium text-[var(--ink-700)]">{email.senderName}</span>
            <span className="mx-1.5 text-[var(--hairline)]">·</span>
            {email.senderEmail}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="rounded-[var(--radius-chip)] px-2.5 py-1 text-xs font-semibold capitalize"
            style={{ backgroundColor: softVar, color: accentVar }}
          >
            {email.priorityLevel}
          </span>
          <span className="rounded-[var(--radius-chip)] border border-[var(--hairline)] px-2.5 py-1 text-xs font-medium text-[var(--ink-500)] capitalize">
            {email.urgencyLevel}
          </span>
        </div>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-700)]">{email.summary}</p>

      <div className="mt-3">
        <WhyThisMattersPanel text={email.whyThisMatters} />
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-[var(--surface)] px-3 py-2">
          <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase">
            Next step
          </dt>
          <dd className="mt-0.5 text-[var(--ink-700)]">{email.recommendedNextStep}</dd>
        </div>
        {email.detectedDeadline !== null && (
          <div className="rounded-lg bg-[var(--surface)] px-3 py-2">
            <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase">
              Deadline
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--ink-900)]">
              {formatDeadline(email.detectedDeadline)}
            </dd>
          </div>
        )}
        {email.riskIfIgnored !== null && (
          <div className="rounded-lg bg-[var(--priority-high-soft)] px-3 py-2 sm:col-span-2">
            <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--priority-high)] uppercase">
              Risk if ignored
            </dt>
            <dd className="mt-0.5 text-[var(--ink-700)]">{email.riskIfIgnored}</dd>
          </div>
        )}
      </dl>

      <footer className="mt-4 flex flex-col gap-3 border-t border-[var(--hairline)] pt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--ink-500)] capitalize">{email.category}</span>
          <span className="flex items-center gap-1.5 text-xs text-[var(--ink-500)]">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-16 rounded-full bg-[var(--hairline)]"
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${confidencePct}%`, backgroundColor: accentVar }}
              />
            </span>
            {confidencePct}% confidence
          </span>
        </div>
        <FeedbackButtons emailMessageId={email.id} />
      </footer>
    </article>
  );
}
