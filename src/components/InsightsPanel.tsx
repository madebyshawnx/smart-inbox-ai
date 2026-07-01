"use client";

import { Clock, Inbox, Layers, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { computeUsageStats } from "@/lib/analytics";
import { BUCKET_KEYS, type DashboardData } from "@/lib/dashboard-types";
import { bucketTier, sectionLabel } from "@/lib/inbox-buckets";
import { tierStyle } from "./priority-style";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

type InsightsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The live (archive-filtered) buckets so the panel's numbers match the list.
  buckets: DashboardData["buckets"];
};

// Turn a whole number of minutes into a compact "1h 5m" / "45m" label.
function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * "Insights" panel. A read-only, right-side Sheet that surfaces usage analytics
 * derived purely from the already-loaded dashboard buckets (no DB, no fetch) via
 * {@link computeUsageStats}. Shows glanceable stat cards plus a per-bucket
 * breakdown bar. Mirrors LearnedPanel's Sheet structure and the app's tokens.
 */
export function InsightsPanel({ open, onOpenChange, buckets }: InsightsPanelProps) {
  const stats = useMemo(() => computeUsageStats({ buckets }), [buckets]);
  const isEmpty = stats.totalTriaged === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="insights-description">
        <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-[var(--hairline)] bg-[var(--surface)] px-5 py-4">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
          >
            <TrendingUp size={17} />
          </span>
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold tracking-tight text-[var(--ink-900)]">
              Insights
            </SheetTitle>
            <SheetDescription
              id="insights-description"
              className="text-[0.8rem] text-[var(--ink-500)]"
            >
              How your inbox has been triaged.
            </SheetDescription>
          </div>
        </header>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-sunken)] text-[var(--ink-500)]"
            >
              <Inbox size={22} />
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--ink-500)]">
              No emails triaged yet. Once you sync your inbox, your usage stats show up here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-5 py-5">
            <StatGrid stats={stats} />
            <BucketBreakdown buckets={buckets} total={stats.totalTriaged} />
            <p className="text-[0.7rem] leading-relaxed text-[var(--ink-500)]">
              Time saved assumes about {stats.secondsSavedPerEmail}s of manual triage avoided per
              email the app has already sorted for you.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type StatGridProps = {
  stats: ReturnType<typeof computeUsageStats>;
};

function StatGrid({ stats }: StatGridProps) {
  const cards: ReadonlyArray<{ key: string; label: string; value: string; icon: React.ReactNode }> =
    [
      {
        key: "triaged",
        label: "Emails triaged",
        value: String(stats.totalTriaged),
        icon: <Inbox size={15} />,
      },
      {
        key: "time",
        label: "Time saved",
        value: formatMinutes(stats.estimatedTimeSavedMinutes),
        icon: <Clock size={15} />,
      },
      {
        key: "ignore",
        label: "Safe to ignore",
        value: `${stats.safeToIgnorePct}%`,
        icon: <Layers size={15} />,
      },
      {
        key: "low",
        label: "Low priority",
        value: `${stats.lowPriorityPct}%`,
        icon: <TrendingUp size={15} />,
      },
    ];

  return (
    <section aria-label="Usage summary">
      <ul className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <li
            key={card.key}
            className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-3.5 py-3 shadow-[var(--shadow-sm)]"
          >
            <span className="flex items-center gap-1.5 text-[var(--ink-500)]">
              <span aria-hidden="true" className="text-[var(--accent)]">
                {card.icon}
              </span>
              <span className="text-[0.7rem] font-semibold tracking-wide uppercase">
                {card.label}
              </span>
            </span>
            <span className="text-2xl font-semibold tracking-tight text-[var(--ink-900)] tabular-nums">
              {card.value}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type BucketBreakdownProps = {
  buckets: DashboardData["buckets"];
  total: number;
};

function BucketBreakdown({ buckets, total }: BucketBreakdownProps) {
  const rows = BUCKET_KEYS.map((key) => ({
    key,
    label: sectionLabel(key),
    count: buckets[key]?.length ?? 0,
    color: tierStyle(bucketTier(key)).accentVar,
  })).filter((row) => row.count > 0);

  return (
    <section aria-labelledby="insights-breakdown-heading" className="flex flex-col gap-3">
      <h3
        id="insights-breakdown-heading"
        className="text-[0.7rem] font-semibold tracking-[0.12em] text-[var(--ink-500)] uppercase"
      >
        Per-bucket breakdown
      </h3>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row, index) => {
          const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[0.8rem] font-medium text-[var(--ink-700)]">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.label}
                </span>
                <span className="shrink-0 text-[0.75rem] font-semibold text-[var(--ink-500)] tabular-nums">
                  {row.count}
                  <span className="ml-1 font-normal">({pct}%)</span>
                </span>
              </div>
              <span
                aria-hidden="true"
                className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
              >
                <motion.span
                  className="block h-full rounded-full"
                  style={{ backgroundColor: row.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut", delay: index * 0.03 }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
