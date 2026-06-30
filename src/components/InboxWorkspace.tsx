"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2, Menu, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DashboardData, EmailCard } from "@/lib/dashboard-types";
import { buildSections, filterBySelectedBucket, type SelectedBucket } from "@/lib/inbox-buckets";
import { AskInbox } from "./AskInbox";
import { CommandPalette } from "./CommandPalette";
import { ConnectGmailCard } from "./ConnectGmailCard";
import { FeedbackButtons } from "./FeedbackButtons";
import { LeftRail } from "./LeftRail";
import { OnboardingQuestionnaire } from "./OnboardingQuestionnaire";
import { resolvePriorityTier, tierStyle } from "./priority-style";
import { SmartRulesManager } from "./SmartRulesManager";
import { SuggestedRules } from "./SuggestedRules";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { WhyThisMattersPanel } from "./WhyThisMattersPanel";

type InboxWorkspaceProps = {
  data: DashboardData;
  // Whether the user already has at least one Smart Rule. Used to decide whether
  // to auto-open the first-run priority questionnaire. Defaults to true so the
  // questionnaire never auto-opens unless the page explicitly says there are none.
  hasRules?: boolean;
};

// localStorage key recording that the user dismissed (Skip / close) the first-run
// onboarding, so it does not nag on every subsequent visit.
const ONBOARDING_DISMISSED_KEY = "smart-inbox:onboarding-dismissed";
// localStorage key persisting the collapsed state of the left rail.
const RAIL_COLLAPSED_KEY = "smart-inbox:rail-collapsed";

// Derive a tight, single-line brief sentence from the raw counts — not the long
// paragraph. e.g. "2 emails · 1 needs attention · 1 to read".
function buildGlanceBrief(brief: DashboardData["brief"]): string {
  const total = brief.totalEmailsReviewed;
  if (total === 0) {
    return "No emails triaged yet";
  }

  const emailWord = total === 1 ? "email" : "emails";
  const parts: string[] = [`${total} ${emailWord}`];

  const urgent = brief.needsAttentionCount + brief.deadlineCount;
  if (urgent > 0) {
    parts.push(`${urgent} need${urgent === 1 ? "s" : ""} attention`);
  } else {
    parts.push("nothing urgent");
  }

  const toRead = brief.readLaterCount;
  if (toRead > 0) {
    parts.push(`${toRead} to read`);
  }

  const waiting = brief.waitingOnReplyCount;
  if (waiting > 0) {
    parts.push(`${waiting} waiting on reply`);
  }

  return parts.join(" · ");
}

function formatTime(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

export function InboxWorkspace({ data, hasRules = true }: InboxWorkspaceProps) {
  // All non-empty buckets (drives the rail nav). The list is filtered from these.
  const sections = useMemo(() => buildSections(data.buckets), [data.buckets]);
  const totalCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.emails.length, 0),
    [sections],
  );

  const [selectedBucket, setSelectedBucket] = useState<SelectedBucket>("all");

  // The sections actually shown in the middle list, narrowed to the selection.
  const visibleSections = useMemo(
    () => filterBySelectedBucket(sections, selectedBucket),
    [sections, selectedBucket],
  );

  // Flatten the visible sections for keyboard navigation + default selection.
  const orderedEmails = useMemo(
    () => visibleSections.flatMap((section) => section.emails),
    [visibleSections],
  );

  const glanceBrief = useMemo(() => buildGlanceBrief(data.brief), [data.brief]);

  const [selectedId, setSelectedId] = useState<string | null>(() => orderedEmails[0]?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Rail collapse (desktop, icon-only strip) — hydrated from localStorage below.
  const [railCollapsed, setRailCollapsed] = useState(false);
  // On narrow screens the rail opens as an overlay rather than sitting inline.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // On narrow screens the detail pane replaces the list once a row is tapped.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // When a Gmail connect fails, the callback returns the real reason; we pin it
  // in a persistent banner (toasts are too easy to miss) until dismissed.
  const [connectError, setConnectError] = useState<string | null>(null);

  const selectedEmail = useMemo(() => {
    if (selectedId === null) {
      return orderedEmails[0] ?? null;
    }
    return orderedEmails.find((email) => email.id === selectedId) ?? orderedEmails[0] ?? null;
  }, [orderedEmails, selectedId]);

  const detailRef = useRef<HTMLElement | null>(null);

  const selectEmail = useCallback((id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }, []);

  // Switching buckets resets the list view: clear selection (the memo falls back
  // to the first email of the new filter) and return to the list on mobile.
  const selectBucket = useCallback((bucket: SelectedBucket) => {
    setSelectedBucket(bucket);
    setSelectedId(null);
    setMobileRailOpen(false);
    setMobileDetailOpen(false);
  }, []);

  // Hydrate + persist the rail collapsed state (client-only; localStorage).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "true") {
        setRailCollapsed(true);
      }
    } catch {
      // Ignore storage failures — default to expanded.
    }
  }, []);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore storage failures — state still applies for this session.
      }
      return next;
    });
  }, []);

  // j/k + arrow navigation through the flat ordered (filtered) list; Enter focuses detail.
  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (orderedEmails.length === 0 || paletteOpen) {
        return;
      }
      const currentIndex = orderedEmails.findIndex((email) => email.id === selectedEmail?.id);
      const moveBy = (delta: number) => {
        event.preventDefault();
        const base = currentIndex === -1 ? 0 : currentIndex;
        const next = Math.min(Math.max(base + delta, 0), orderedEmails.length - 1);
        setSelectedId(orderedEmails[next].id);
      };

      if (event.key === "j" || event.key === "ArrowDown") {
        moveBy(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        moveBy(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        setMobileDetailOpen(true);
        detailRef.current?.focus();
      }
    },
    [orderedEmails, selectedEmail, paletteOpen],
  );

  // Global Cmd/Ctrl+K toggles the command palette. Bound on the window so it
  // fires regardless of focus, including from inside text inputs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Auto-sync once right after Gmail connects. Returning from OAuth lands on
  // `/?gmail=connected`; the user shouldn't have to click Sync to see their
  // first triaged inbox. Periodic refresh after that is handled by the daily
  // Vercel Cron; manual Sync (Settings / command palette) stays available.
  useEffect(() => {
    let flag: string | null = null;
    let reason: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      flag = params.get("gmail");
      reason = params.get("reason");
    } catch {
      flag = null;
    }
    if (!flag) {
      return;
    }
    // Scrub the flag immediately so a refresh doesn't re-trigger the sync.
    window.history.replaceState({}, "", window.location.pathname);

    if (flag === "error") {
      // Pin the failure reason in a persistent banner (toasts are easy to miss).
      setConnectError(reason ?? "unknown (no reason returned)");
      toast.error(
        reason
          ? `Couldn’t connect Gmail — ${reason}`
          : "Couldn’t connect Gmail — please try again.",
        {
          duration: 30000,
        },
      );
      return;
    }
    if (flag !== "connected") {
      return;
    }

    toast.success("Gmail connected — syncing your inbox…");
    fetch("/api/emails/sync", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`sync failed (${res.status})`);
        }
        const result = (await res.json()) as { total?: number };
        const total = result.total ?? 0;
        toast.success(`Synced ${total} email${total === 1 ? "" : "s"}`);
        window.location.reload();
      })
      .catch(() => {
        toast.error("Connected, but the first sync failed. Try Sync in Settings.");
      });
  }, []);

  // First-run: auto-open the priority questionnaire when the user has no rules
  // yet and hasn't already dismissed it. Runs once on mount (client-only, so
  // localStorage is available).
  useEffect(() => {
    if (hasRules) {
      return;
    }
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true";
    } catch {
      // localStorage can throw in private modes; treat as not-dismissed.
      dismissed = false;
    }
    if (!dismissed) {
      setOnboardingOpen(true);
    }
  }, [hasRules]);

  // Closing the questionnaire (Skip, scrim, Escape, or after creating rules) marks
  // it dismissed so it won't auto-open again on the next visit.
  const closeOnboarding = useCallback(() => {
    setOnboardingOpen(false);
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    } catch {
      // Ignore storage failures — worst case the prompt reappears next visit.
    }
  }, []);

  const hasEmails = orderedEmails.length > 0;

  return (
    <div className="flex h-dvh flex-col bg-[var(--surface)] text-[var(--ink-900)]">
      {connectError && (
        <div
          role="alert"
          className="flex items-start gap-3 border-b border-[var(--priority-high)] bg-[var(--priority-high-soft)] px-4 py-3 text-sm text-[var(--priority-high)]"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Gmail connect failed.</strong>{" "}
            <span className="break-words">{connectError}</span>
          </span>
          <button
            type="button"
            onClick={() => setConnectError(null)}
            aria-label="Dismiss error"
            className="flex shrink-0 items-center rounded px-1 py-0.5 hover:bg-[var(--priority-high)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--priority-high)]"
          >
            <X size={15} />
          </button>
        </div>
      )}
      <TopBar glanceBrief={glanceBrief} onOpenMobileRail={() => setMobileRailOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* LEFT RAIL — inline on md+ */}
        <div className="hidden md:flex">
          <LeftRail
            sections={sections}
            selectedBucket={selectedBucket}
            onSelectBucket={selectBucket}
            totalCount={totalCount}
            collapsed={railCollapsed}
            onToggleCollapse={toggleRailCollapsed}
            onOpenAsk={() => setAskOpen(true)}
            onOpenSearch={() => setPaletteOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        {/* LEFT RAIL — overlay on < md */}
        {mobileRailOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileRailOpen(false)}
              className="absolute inset-0 bg-[oklch(20%_0.02_260_/_0.35)]"
            />
            <div className="relative h-full">
              <LeftRail
                sections={sections}
                selectedBucket={selectedBucket}
                onSelectBucket={selectBucket}
                totalCount={totalCount}
                collapsed={false}
                onToggleCollapse={() => setMobileRailOpen(false)}
                onOpenAsk={() => {
                  setMobileRailOpen(false);
                  setAskOpen(true);
                }}
                onOpenSearch={() => {
                  setMobileRailOpen(false);
                  setPaletteOpen(true);
                }}
                onOpenSettings={() => {
                  setMobileRailOpen(false);
                  setSettingsOpen(true);
                }}
              />
            </div>
          </div>
        )}

        {/* LIST PANE */}
        <aside
          aria-label="Triaged emails"
          onKeyDown={handleListKeyDown}
          className={`${
            mobileDetailOpen ? "hidden" : "flex"
          } w-full shrink-0 flex-col border-r border-[var(--hairline)] md:flex md:w-[360px] lg:w-[400px]`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {hasEmails ? (
              <ul className="flex flex-col py-2">
                {visibleSections.map((section) => (
                  <li key={section.key}>
                    <SectionHeader label={section.label} count={section.emails.length} />
                    <ul>
                      {section.emails.map((email) => (
                        <li key={email.id}>
                          <EmailRow
                            email={email}
                            isSelected={email.id === selectedEmail?.id}
                            onSelect={() => selectEmail(email.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-10">
                <p className="text-sm leading-relaxed text-[var(--ink-500)]">
                  No emails to triage yet. Connect Gmail and sync to get started.
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* DETAIL PANE */}
        <main
          ref={detailRef}
          tabIndex={-1}
          aria-label="Email detail"
          className={`${
            mobileDetailOpen ? "flex" : "hidden"
          } min-w-0 flex-1 flex-col overflow-y-auto outline-none md:flex`}
        >
          {selectedEmail ? (
            <EmailDetail email={selectedEmail} onBack={() => setMobileDetailOpen(false)} />
          ) : (
            <EmptyDetail brief={data.brief} />
          )}
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onOpenOnboarding={() => setOnboardingOpen(true)}
      />

      <OnboardingQuestionnaire open={onboardingOpen} onClose={closeOnboarding} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        emails={orderedEmails}
        onSelectEmail={selectEmail}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAsk={() => setAskOpen(true)}
      />

      <AskInbox open={askOpen} onClose={() => setAskOpen(false)} />
    </div>
  );
}

type TopBarProps = {
  glanceBrief: string;
  onOpenMobileRail: () => void;
};

function TopBar({ glanceBrief, onOpenMobileRail }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface-raised)] px-3 sm:px-4">
      {/* Mobile-only: open the rail overlay (Search lives in the rail now). */}
      <button
        type="button"
        onClick={onOpenMobileRail}
        aria-label="Open navigation"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-chip)] text-[var(--ink-700)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] md:hidden"
      >
        <Menu size={18} />
      </button>

      <p className="min-w-0 flex-1 truncate text-sm text-[var(--ink-500)]">{glanceBrief}</p>
    </header>
  );
}

type SectionHeaderProps = {
  label: string;
  count: number;
};

function SectionHeader({ label, count }: SectionHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--surface)]/95 px-5 pt-4 pb-1.5 backdrop-blur">
      <h2 className="text-[0.7rem] font-semibold tracking-[0.12em] text-[var(--ink-500)] uppercase">
        {label}
      </h2>
      <span className="text-[0.7rem] font-medium text-[var(--ink-500)]">{count}</span>
    </div>
  );
}

type EmailRowProps = {
  email: EmailCard;
  isSelected: boolean;
  onSelect: () => void;
};

function EmailRow({ email, isSelected, onSelect }: EmailRowProps) {
  const tier = resolvePriorityTier(email.priorityLevel);
  const { accentVar } = tierStyle(tier);
  const time = formatTime(email.receivedAt);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      className={`group relative flex w-full items-start gap-3 px-5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${
        isSelected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-raised)]"
      }`}
    >
      {isSelected && (
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 h-full w-[3px] rounded-r bg-[var(--accent)]"
        />
      )}
      <span
        aria-hidden="true"
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: accentVar }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[0.8rem] ${
              isSelected
                ? "font-semibold text-[var(--ink-900)]"
                : "font-medium text-[var(--ink-700)]"
            }`}
          >
            {email.senderName}
          </span>
          {time && <span className="shrink-0 text-[0.7rem] text-[var(--ink-500)]">{time}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[0.85rem] font-medium text-[var(--ink-900)]">
          {email.subject}
        </span>
        <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-500)] capitalize">
          {email.category}
        </span>
      </span>
    </button>
  );
}

type EmailDetailProps = {
  email: EmailCard;
  onBack: () => void;
};

function EmailDetail({ email, onBack }: EmailDetailProps) {
  const tier = resolvePriorityTier(email.priorityLevel);
  const { accentVar, softVar } = tierStyle(tier);
  // confidenceScore is already a 0-100 percentage; clamp defensively.
  const confidencePct = Math.max(0, Math.min(100, Math.round(email.confidenceScore)));

  return (
    <article className="w-full max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink-500)] transition-colors hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] md:hidden"
      >
        <ArrowLeft size={15} /> Back to inbox
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--ink-900)] sm:text-2xl">
            {email.subject}
          </h1>
          <p className="mt-1 truncate text-sm text-[var(--ink-500)]">
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

      <p className="mt-4 text-sm leading-relaxed text-[var(--ink-700)]">{email.summary}</p>

      <div className="mt-4">
        <WhyThisMattersPanel text={email.whyThisMatters} />
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-3.5 py-3 shadow-[var(--shadow-sm)]">
          <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase">
            Suggested next step
          </dt>
          <dd className="mt-0.5 text-[var(--ink-700)]">{email.recommendedNextStep}</dd>
        </div>
        {email.detectedDeadline !== null && (
          <div className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-3.5 py-3 shadow-[var(--shadow-sm)]">
            <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase">
              Deadline
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--ink-900)]">
              {formatDeadline(email.detectedDeadline)}
            </dd>
          </div>
        )}
        {email.riskIfIgnored !== null && (
          <div className="rounded-lg bg-[var(--priority-high-soft)] px-3 py-2.5 sm:col-span-2">
            <dt className="text-[0.7rem] font-semibold tracking-wide text-[var(--priority-high)] uppercase">
              Risk if ignored
            </dt>
            <dd className="mt-0.5 text-[var(--ink-700)]">{email.riskIfIgnored}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex flex-col gap-3 border-t border-[var(--hairline)] pt-4">
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
      </div>
    </article>
  );
}

type EmptyDetailProps = {
  brief: DashboardData["brief"];
};

function EmptyDetail({ brief }: EmptyDetailProps) {
  const reviewedSomething = brief.totalEmailsReviewed > 0;

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
      >
        <CheckCircle2 size={26} />
      </span>
      <h1 className="mt-4 text-lg font-semibold tracking-tight text-[var(--ink-900)]">
        {reviewedSomething ? "You're all caught up" : "Nothing to triage yet"}
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--ink-500)]">
        {reviewedSomething
          ? "There's nothing in your inbox that needs attention right now."
          : "Connect your Gmail in Settings and run a sync to see your triaged inbox here."}
      </p>
      {!reviewedSomething && (
        <div className="mt-6 w-full max-w-md text-left">
          <ConnectGmailCard />
        </div>
      )}
    </div>
  );
}

type SettingsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenOnboarding: () => void;
};

function SettingsDrawer({ open, onOpenChange, onOpenOnboarding }: SettingsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)] px-5 py-4">
          <SheetTitle className="text-base font-semibold tracking-tight text-[var(--ink-900)]">
            Settings
          </SheetTitle>
        </header>

        <div className="flex flex-col gap-6 px-5 py-5">
          <ConnectGmailCard />
          <SuggestedRules />
          <section aria-labelledby="settings-rules-heading" className="flex flex-col gap-3">
            <div>
              <h3
                id="settings-rules-heading"
                className="text-base font-semibold tracking-tight text-[var(--ink-900)]"
              >
                Smart Rules
              </h3>
              <p className="mt-0.5 text-sm text-[var(--ink-500)]">
                Personalize how your inbox is triaged.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onOpenOnboarding();
              }}
              className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--hairline)] px-3.5 py-2 text-sm font-semibold text-[var(--ink-700)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <Sparkles size={15} /> Set up priorities
            </button>
            <SmartRulesManager />
          </section>

          <DangerZone />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DangerZone() {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    const confirmed = window.confirm(
      "Delete all your data? This permanently removes every triaged email, rule, " +
        "and your Gmail connection. This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch("/api/user/delete-data", { method: "POST" });
      if (!res.ok) {
        throw new Error("delete failed");
      }
      toast.success("All data deleted");
      window.location.reload();
    } catch {
      toast.error("Could not delete your data. Please try again.");
      setDeleting(false);
    }
  }, []);

  return (
    <section
      aria-labelledby="settings-danger-heading"
      className="flex flex-col gap-3 border-t border-[var(--priority-high-soft)] pt-5"
    >
      <div>
        <h3
          id="settings-danger-heading"
          className="text-base font-semibold tracking-tight text-[var(--priority-high)]"
        >
          Danger zone
        </h3>
        <p className="mt-0.5 text-sm text-[var(--ink-500)]">
          Permanently delete everything this app has stored about you.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--priority-high)] px-3.5 py-2 text-sm font-semibold text-[var(--priority-high)] transition-colors hover:bg-[var(--priority-high-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--priority-high)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {deleting ? "Deleting…" : "Delete all my data"}
      </button>
    </section>
  );
}
