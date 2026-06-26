import { BUCKET_KEYS, type DashboardData } from "@/lib/dashboard-types";
import { DailyEmailBriefCard } from "./DailyEmailBriefCard";
import { EmailBucketSection } from "./EmailBucketSection";
import { PriorityMetricsBar } from "./PriorityMetricsBar";

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
