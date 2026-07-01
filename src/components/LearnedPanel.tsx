"use client";

import {
  ArrowDownCircle,
  ArrowUpCircle,
  Ban,
  Bell,
  Brain,
  CheckCircle2,
  Clock,
  Flag,
  Lightbulb,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { FeedbackHistoryItem } from "@/lib/feedback-history";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

type SmartRule = {
  id: string;
  ruleText: string;
  isActive: boolean;
  priorityWeight: number;
};

type Suggestion = {
  signature: string;
  ruleText: string;
  reason: string;
  priorityWeight: number;
};

type LoadState = "loading" | "ready" | "error";

type LearnedData = {
  rules: SmartRule[];
  suggestions: Suggestion[];
  history: FeedbackHistoryItem[];
};

type LearnedPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Weight thresholds mirror the feedback loop (see src/lib/feedback.ts): sender
// rules are created at ±100, so anything strongly positive/negative reads as a
// learned sender preference rather than a hand-written rule.
const PRIORITIZE_THRESHOLD = 1;
const IGNORE_THRESHOLD = -1;

// Human-readable label + icon per feedback type, so the "recent corrections"
// list reads as what the user actually taught, not a raw enum. Kept in one map
// so a new feedback type only needs one entry here.
const FEEDBACK_META: Record<
  FeedbackHistoryItem["feedbackType"],
  { label: string; icon: ReactNode; tone: "up" | "down" | "neutral" }
> = {
  correct: { label: "Confirmed correct", icon: <ThumbsUp size={14} />, tone: "up" },
  wrong: { label: "Marked wrong", icon: <ThumbsDown size={14} />, tone: "down" },
  more_like_this: { label: "More like this", icon: <ThumbsUp size={14} />, tone: "up" },
  less_like_this: { label: "Less like this", icon: <ThumbsDown size={14} />, tone: "down" },
  always_prioritize_sender: {
    label: "Always prioritize sender",
    icon: <ArrowUpCircle size={14} />,
    tone: "up",
  },
  usually_ignore_sender: {
    label: "Usually ignore sender",
    icon: <ArrowDownCircle size={14} />,
    tone: "down",
  },
  mark_urgent: { label: "Marked urgent", icon: <Bell size={14} />, tone: "up" },
  not_urgent: { label: "Marked not urgent", icon: <Clock size={14} />, tone: "down" },
  needs_follow_up: { label: "Needs follow-up", icon: <Flag size={14} />, tone: "neutral" },
  no_action_needed: { label: "No action needed", icon: <CheckCircle2 size={14} />, tone: "down" },
  move_to_read_later: { label: "Moved to Read Later", icon: <Clock size={14} />, tone: "neutral" },
  safe_to_ignore: { label: "Safe to ignore", icon: <Ban size={14} />, tone: "down" },
};

function toneClasses(tone: "up" | "down" | "neutral"): string {
  if (tone === "up") {
    return "bg-[var(--accent-soft)] text-[var(--accent)]";
  }
  if (tone === "down") {
    return "bg-[var(--priority-high-soft)] text-[var(--priority-high)]";
  }
  return "bg-[var(--surface-sunken)] text-[var(--ink-700)]";
}

function formatWhen(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "What I've learned" panel. A read-only, right-side Sheet that makes the
 * feedback loop *visible*: it shows the active Smart Rules the app is triaging
 * with, the learned sender preferences derived from them, the recent corrections
 * the user has applied, and any behavioral suggestions still pending. Nothing is
 * editable here (management lives in Settings) — this is the "here's what your
 * feedback taught me" mirror.
 *
 * Fetches on open (and only while open) so the panel always reflects current
 * server state after the user has been giving feedback. All three fetches fail
 * soft: a single failing source shows an inline retry rather than blanking the
 * whole panel.
 */
export function LearnedPanel({ open, onOpenChange }: LearnedPanelProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<LearnedData>({ rules: [], suggestions: [], history: [] });

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [rulesRes, suggestionsRes, historyRes] = await Promise.all([
        fetch("/api/smart-rules"),
        fetch("/api/suggestions"),
        fetch("/api/feedback/history"),
      ]);
      if (!rulesRes.ok) {
        throw new Error(`smart-rules failed (${rulesRes.status})`);
      }
      const { rules } = (await rulesRes.json()) as { rules: SmartRule[] };
      // Suggestions + history are enhancements: a failure there degrades to an
      // empty section rather than failing the whole panel.
      const suggestions = suggestionsRes.ok
        ? ((await suggestionsRes.json()) as { suggestions: Suggestion[] }).suggestions
        : [];
      const history = historyRes.ok
        ? ((await historyRes.json()) as { items: FeedbackHistoryItem[] }).items
        : [];
      setData({ rules, suggestions, history });
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const activeRules = data.rules.filter((rule) => rule.isActive);
  const senderRules = activeRules.filter(
    (rule) =>
      rule.priorityWeight >= PRIORITIZE_THRESHOLD || rule.priorityWeight <= IGNORE_THRESHOLD,
  );

  const hasAnything =
    activeRules.length > 0 || data.suggestions.length > 0 || data.history.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="learned-panel-desc">
        <header className="sticky top-0 z-10 border-b border-[var(--hairline)] bg-[var(--surface)] px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold tracking-tight text-[var(--ink-900)]">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <Brain size={16} />
            </span>
            What I&rsquo;ve learned
          </SheetTitle>
          <SheetDescription id="learned-panel-desc" className="mt-1 text-sm text-[var(--ink-500)]">
            How your feedback is shaping the way your inbox gets triaged.
          </SheetDescription>
        </header>

        <div className="flex flex-col gap-6 px-5 py-5">
          {state === "loading" && <LoadingState />}

          {state === "error" && <ErrorState onRetry={() => void load()} />}

          {state === "ready" && !hasAnything && <EmptyState />}

          {state === "ready" && hasAnything && (
            <>
              <ActiveRulesSection rules={activeRules} />
              <LearnedSendersSection rules={senderRules} />
              <RecentCorrectionsSection history={data.history} />
              <PendingSuggestionsSection suggestions={data.suggestions} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading what I've learned">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-[var(--radius-card)] bg-[var(--surface-sunken)]"
        />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-[var(--priority-high-soft)] bg-[var(--priority-high-soft)] px-4 py-4">
      <p className="text-sm font-medium text-[var(--priority-high)]">
        Couldn&rsquo;t load what I&rsquo;ve learned.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-700)] transition-colors hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        Retry
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
      >
        <Sparkles size={22} />
      </span>
      <p className="text-sm font-medium text-[var(--ink-900)]">Nothing learned yet</p>
      <p className="max-w-xs text-sm leading-relaxed text-[var(--ink-500)]">
        As you correct triage and set sender preferences, what the assistant learns will show up
        here.
      </p>
    </div>
  );
}

type SectionShellProps = {
  icon: ReactNode;
  title: string;
  hint: string;
  count?: number;
  children: ReactNode;
};

function SectionShell({ icon, title, hint, count, children }: SectionShellProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-sunken)] text-[var(--ink-700)]"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--ink-900)]">
            {title}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[0.7rem] font-semibold tabular-nums text-[var(--ink-500)]">
                {count}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[0.8rem] text-[var(--ink-500)]">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ActiveRulesSection({ rules }: { rules: SmartRule[] }) {
  if (rules.length === 0) {
    return null;
  }
  return (
    <SectionShell
      icon={<CheckCircle2 size={16} />}
      title="Active rules"
      hint="Rules the assistant is triaging with right now."
      count={rules.length}
    >
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-4 py-3"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              {rule.priorityWeight >= PRIORITIZE_THRESHOLD ? (
                <ArrowUpCircle size={15} className="text-[var(--accent)]" />
              ) : rule.priorityWeight <= IGNORE_THRESHOLD ? (
                <ArrowDownCircle size={15} className="text-[var(--priority-high)]" />
              ) : (
                <CheckCircle2 size={15} className="text-[var(--ink-500)]" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-sm text-[var(--ink-900)]">{rule.ruleText}</span>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

function LearnedSendersSection({ rules }: { rules: SmartRule[] }) {
  if (rules.length === 0) {
    return null;
  }
  return (
    <SectionShell
      icon={<Sparkles size={16} />}
      title="Learned senders"
      hint="Senders you told me to always prioritize or usually ignore."
      count={rules.length}
    >
      <ul className="flex flex-col gap-2">
        {rules.map((rule) => {
          const prioritize = rule.priorityWeight >= PRIORITIZE_THRESHOLD;
          return (
            <li
              key={rule.id}
              className="flex items-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-4 py-3"
            >
              <span
                aria-hidden="true"
                className={`flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[0.7rem] font-semibold ${
                  prioritize
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "bg-[var(--priority-high-soft)] text-[var(--priority-high)]"
                }`}
              >
                {prioritize ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                {prioritize ? "Prioritize" : "Ignore"}
              </span>
              <span className="min-w-0 flex-1 text-sm text-[var(--ink-700)]">{rule.ruleText}</span>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

function RecentCorrectionsSection({ history }: { history: FeedbackHistoryItem[] }) {
  if (history.length === 0) {
    return null;
  }
  return (
    <SectionShell
      icon={<XCircle size={16} />}
      title="Recent corrections"
      hint="The last adjustments you made. Each one nudges future triage for that sender."
      count={history.length}
    >
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {history.map((item) => {
            const meta = FEEDBACK_META[item.feedbackType];
            const who = item.senderName.trim() === "" ? item.senderEmail : item.senderName;
            const when = formatWhen(item.createdAt);
            return (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${toneClasses(
                    meta.tone,
                  )}`}
                >
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[var(--ink-900)]">
                      {meta.label}
                    </span>
                    {when && (
                      <span className="shrink-0 text-[0.7rem] text-[var(--ink-500)]">{when}</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.8rem] text-[var(--ink-500)]">
                    <span className="text-[var(--ink-700)]">{who}</span>
                    <span className="mx-1.5 text-[var(--hairline)]">·</span>
                    {item.subject}
                  </span>
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </SectionShell>
  );
}

function PendingSuggestionsSection({ suggestions }: { suggestions: Suggestion[] }) {
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <SectionShell
      icon={<Lightbulb size={16} />}
      title="Pending suggestions"
      hint="Patterns I spotted but haven't applied. Approve them in Settings."
      count={suggestions.length}
    >
      <ul className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <li
            key={suggestion.signature}
            className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-dashed border-[var(--hairline)] bg-[var(--surface-raised)] px-4 py-3"
          >
            <p className="text-sm font-medium text-[var(--ink-900)]">{suggestion.reason}</p>
            <p className="rounded-[var(--radius-chip)] bg-[var(--surface)] px-3 py-2 text-[0.8rem] text-[var(--ink-500)]">
              {suggestion.ruleText}
            </p>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
