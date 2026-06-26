import { EmptyState } from "@/components/EmptyState";
import { SmartInboxDashboard } from "@/components/SmartInboxDashboard";
import { loadDashboardData } from "@/lib/dashboard-data";
import { BUCKET_KEYS } from "@/lib/dashboard-types";

export default async function Home() {
  const data = await loadDashboardData();

  const hasEmails =
    data.brief.totalEmailsReviewed > 0 &&
    BUCKET_KEYS.some((bucketKey) => data.buckets[bucketKey].length > 0);

  return (
    <div className="min-h-full bg-[var(--surface)]">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-10">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--accent)] uppercase">
            Smart Inbox AI
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-4xl">
            Your daily brief
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--ink-500)]">
            What needs your attention, why it matters, and what to do next — triaged for you.
          </p>
        </header>

        <main>{hasEmails ? <SmartInboxDashboard data={data} /> : <EmptyState />}</main>
      </div>
    </div>
  );
}
