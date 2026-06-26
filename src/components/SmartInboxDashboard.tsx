import { BUCKET_KEYS, type DashboardData } from "@/lib/dashboard-types";
import { DailyEmailBriefCard } from "./DailyEmailBriefCard";
import { EmailBucketSection } from "./EmailBucketSection";
import { PriorityMetricsBar } from "./PriorityMetricsBar";
import { SmartRulesManager } from "./SmartRulesManager";

type SmartInboxDashboardProps = {
  data: DashboardData;
};

/**
 * Top-level composition: the daily brief hero, the at-a-glance metrics bar, then
 * every bucket section in canonical BUCKET_KEYS order.
 */
export function SmartInboxDashboard({ data }: SmartInboxDashboardProps) {
  return (
    <div className="flex flex-col gap-8">
      <DailyEmailBriefCard brief={data.brief} />
      <PriorityMetricsBar brief={data.brief} />
      <section aria-labelledby="smart-rules-heading" className="flex flex-col gap-3">
        <div>
          <h2
            id="smart-rules-heading"
            className="text-lg font-semibold tracking-tight text-[var(--ink-900)]"
          >
            Smart Rules
          </h2>
          <p className="mt-0.5 text-sm text-[var(--ink-500)]">
            Plain-English rules that personalize how your inbox is triaged.
          </p>
        </div>
        <SmartRulesManager />
      </section>
      <div className="flex flex-col gap-10">
        {BUCKET_KEYS.map((bucketKey) => (
          <EmailBucketSection
            key={bucketKey}
            bucketKey={bucketKey}
            emails={data.buckets[bucketKey]}
          />
        ))}
      </div>
    </div>
  );
}
