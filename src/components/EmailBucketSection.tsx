import { BUCKET_LABELS, type BucketKey, type EmailCard } from "@/lib/dashboard-types";
import { EmailPriorityCard } from "./EmailPriorityCard";

/** Buckets that should read as more prominent than the quieter, low-signal ones. */
const PROMINENT_BUCKETS: ReadonlySet<BucketKey> = new Set([
  "needs_attention",
  "follow_up_today",
  "deadlines",
]);

type EmailBucketSectionProps = {
  bucketKey: BucketKey;
  emails: EmailCard[];
};

export function EmailBucketSection({ bucketKey, emails }: EmailBucketSectionProps) {
  const isProminent = PROMINENT_BUCKETS.has(bucketKey);
  const headingId = `bucket-${bucketKey}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline gap-2.5">
        <h2
          id={headingId}
          className={
            isProminent
              ? "text-lg font-semibold text-[var(--ink-900)]"
              : "text-base font-medium text-[var(--ink-700)]"
          }
        >
          {BUCKET_LABELS[bucketKey]}
        </h2>
        <span className="rounded-[var(--radius-chip)] bg-[var(--surface-raised)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-500)] tabular-nums ring-1 ring-[var(--hairline)] ring-inset">
          {emails.length}
        </span>
      </div>

      {emails.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-500)]">None right now.</p>
      ) : (
        <div className={`mt-3 grid gap-3 ${isProminent ? "" : "opacity-95"}`}>
          {emails.map((email) => (
            <EmailPriorityCard key={email.id} email={email} />
          ))}
        </div>
      )}
    </section>
  );
}
