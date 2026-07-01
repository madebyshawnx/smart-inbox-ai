"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Menu,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { BucketKey, DashboardData, EmailCard } from "@/lib/dashboard-types";
import {
  buildSections,
  filterBySelectedBucket,
  filterSectionsByQuery,
  groupEmailsByThread,
  type ListSection,
  type SelectedBucket,
  type ThreadGroup,
} from "@/lib/inbox-buckets";
import { ActionButtons } from "./ActionButtons";
import { AskInbox } from "./AskInbox";
import { CommandPalette } from "./CommandPalette";
import { ConnectGmailCard } from "./ConnectGmailCard";
import { FeedbackButtons } from "./FeedbackButtons";
import { InsightsPanel } from "./InsightsPanel";
import { LearnedPanel } from "./LearnedPanel";
import { LeftRail } from "./LeftRail";
import { OnboardingQuestionnaire } from "./OnboardingQuestionnaire";
import { resolvePriorityTier, tierStyle } from "./priority-style";
import { SmartRulesManager } from "./SmartRulesManager";
import { SuggestedRules } from "./SuggestedRules";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
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
// localStorage key + bounds for the user-draggable list-pane width (px).
const LIST_WIDTH_KEY = "smart-inbox:list-width";
const LIST_WIDTH_MIN = 300;
const LIST_WIDTH_MAX = 640;
const LIST_WIDTH_DEFAULT = 380;
// localStorage key: ids of emails the user has opened (shown as "read"/muted).
const VIEWED_KEY = "smart-inbox:viewed-ids";

// Low-signal buckets that get a per-section "Archive all" affordance. Cleaning
// these out in one action is the whole point of the bucket; higher-signal
// buckets deliberately have no bulk sweep so nothing important is cleared en masse.
const BULK_ARCHIVE_BUCKETS: ReadonlySet<BucketKey> = new Set([
  "safe_to_ignore",
  "low_priority",
  "read_later",
]);

// How long the bulk "Undo" toast stays actionable.
const BULK_UNDO_WINDOW_MS = 8000;

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
  // Emails optimistically removed from the list (archived). Kept client-side only
  // this wave — no schema change — so undo simply drops the id back out of the set
  // and the server-rendered data reappears. A hard reload also clears it.
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => new Set());

  const archiveEmail = useCallback((id: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const restoreEmail = useCallback((id: string) => {
    setArchivedIds((prev) => {
      if (!prev.has(id)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Optimistically archive/restore a whole set of ids at once (bulk cleanup).
  const archiveMany = useCallback((ids: ReadonlyArray<string>) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const restoreMany = useCallback((ids: ReadonlyArray<string>) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Per-bucket "Archive all": confirm, optimistically clear the section, POST the
  // explicit ids to the bulk-archive route, and offer an undo that restores them.
  // Reversible end to end (bulk-archive only removes the INBOX label).
  const bulkArchiveBucket = useCallback(
    async (label: string, ids: ReadonlyArray<string>) => {
      if (ids.length === 0) {
        return;
      }
      const confirmed = window.confirm(
        `Archive all ${ids.length} email${ids.length === 1 ? "" : "s"} in “${label}”? ` +
          "They’re removed from your inbox in Gmail — reversible, never deleted.",
      );
      if (!confirmed) {
        return;
      }

      // Optimistic: clear the whole section immediately.
      archiveMany(ids);
      try {
        const res = await fetch("/api/emails/bulk-archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          throw new Error(`bulk archive failed (${res.status})`);
        }
        const data = (await res.json()) as { archived?: number };
        const archived = data.archived ?? ids.length;
        toast.success(`Archived ${archived} email${archived === 1 ? "" : "s"}`, {
          description: `Cleared “${label}” from your inbox.`,
          duration: BULK_UNDO_WINDOW_MS,
          action: {
            label: "Undo",
            onClick: () => {
              // Restore the list instantly, then un-archive each in Gmail
              // (re-add the INBOX label) via the reversible per-email route.
              restoreMany(ids);
              void Promise.all(
                ids.map((id) =>
                  fetch(`/api/emails/${id}/archive`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ undo: true }),
                  }).catch(() => null),
                ),
              );
            },
          },
        });
      } catch {
        restoreMany(ids);
        toast.error("Couldn’t archive these — try reconnecting Gmail.");
      }
    },
    [archiveMany, restoreMany],
  );

  // Buckets with optimistically-archived emails filtered out.
  const liveBuckets = useMemo(() => {
    if (archivedIds.size === 0) {
      return data.buckets;
    }
    const entries = Object.entries(data.buckets).map(([key, emails]) => [
      key,
      emails.filter((email) => !archivedIds.has(email.id)),
    ]);
    return Object.fromEntries(entries) as DashboardData["buckets"];
  }, [data.buckets, archivedIds]);

  // All non-empty buckets (drives the rail nav). The list is filtered from these.
  const sections = useMemo(() => buildSections(liveBuckets), [liveBuckets]);
  const totalCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.emails.length, 0),
    [sections],
  );

  const [selectedBucket, setSelectedBucket] = useState<SelectedBucket>("all");
  // Free-text list search. Filters the visible sections in-place (pure helper);
  // an empty query is search-inactive and shows everything.
  const [searchQuery, setSearchQuery] = useState("");

  // The sections actually shown in the middle list: narrowed to the selected
  // bucket, then filtered by the free-text query (empty query = everything).
  const visibleSections = useMemo(
    () => filterSectionsByQuery(filterBySelectedBucket(sections, selectedBucket), searchQuery),
    [sections, selectedBucket, searchQuery],
  );

  // Flatten the visible sections for keyboard navigation + default selection.
  const orderedEmails = useMemo(
    () => visibleSections.flatMap((section) => section.emails),
    [visibleSections],
  );

  const glanceBrief = useMemo(() => buildGlanceBrief(data.brief), [data.brief]);

  const [selectedId, setSelectedId] = useState<string | null>(() => orderedEmails[0]?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [learnedOpen, setLearnedOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // Thread ids the user has expanded to reveal older replies. Collapsed by
  // default; singletons are never in this set (they render as flat rows).
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<string>>(() => new Set());

  const toggleThread = useCallback((threadId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);
  // Rail collapse (desktop, icon-only strip) — hydrated from localStorage below.
  const [railCollapsed, setRailCollapsed] = useState(false);
  // On narrow screens the rail opens as an overlay rather than sitting inline.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // On narrow screens the detail pane replaces the list once a row is tapped.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // When a Gmail connect fails, the callback returns the real reason; we pin it
  // in a persistent banner (toasts are too easy to miss) until dismissed.
  const [connectError, setConnectError] = useState<string | null>(null);
  // User-draggable width of the middle list pane (desktop). Ref mirrors state so
  // the pointer-move handler reads the latest without re-binding listeners.
  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);
  const listWidthRef = useRef(LIST_WIDTH_DEFAULT);
  // Emails the user has opened — rendered as "read" (muted) so reviewed items are
  // visually distinct from unread ones. Persisted so it survives sync/feedback reloads.
  const [viewedIds, setViewedIds] = useState<ReadonlySet<string>>(() => new Set());

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
    // Mark as read (opened) and persist so reviewed items stay muted across reloads.
    setViewedIds((prev) => {
      if (prev.has(id)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(id);
      try {
        window.localStorage.setItem(VIEWED_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore storage failures — read state still applies for this session.
      }
      return next;
    });
  }, []);

  // Switching buckets resets the list view: clear selection (the memo falls back
  // to the first email of the new filter) and return to the list on mobile.
  const selectBucket = useCallback((bucket: SelectedBucket) => {
    setSelectedBucket(bucket);
    setSelectedId(null);
    setSearchQuery("");
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

  // Hydrate the saved list width once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LIST_WIDTH_KEY);
      const n = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(n)) {
        const clamped = Math.min(Math.max(n, LIST_WIDTH_MIN), LIST_WIDTH_MAX);
        setListWidth(clamped);
        listWidthRef.current = clamped;
      }
    } catch {
      // Ignore storage failures — default width applies.
    }
  }, []);

  // Hydrate the set of already-opened (read) emails once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEWED_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setViewedIds(new Set(parsed.filter((id): id is string => typeof id === "string")));
        }
      }
    } catch {
      // Ignore storage/parse failures — everything just shows as unread.
    }
  }, []);

  // Drag the divider between the list and detail to resize the list pane.
  const startListResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        Math.max(listWidthRef.current + moveEvent.movementX, LIST_WIDTH_MIN),
        LIST_WIDTH_MAX,
      );
      listWidthRef.current = next;
      setListWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      try {
        window.localStorage.setItem(LIST_WIDTH_KEY, String(listWidthRef.current));
      } catch {
        // Ignore storage failures — width still applies for this session.
      }
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Keyboard resize (arrow keys on the focused divider) — accessible parity with
  // the pointer drag; persists like the drag does.
  const nudgeListWidth = useCallback((delta: number) => {
    setListWidth((prev) => {
      const next = Math.min(Math.max(prev + delta, LIST_WIDTH_MIN), LIST_WIDTH_MAX);
      listWidthRef.current = next;
      try {
        window.localStorage.setItem(LIST_WIDTH_KEY, String(next));
      } catch {
        // Ignore storage failures — width still applies for this session.
      }
      return next;
    });
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
      // Don't hijack typing in the list search box (j/k are literal there).
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
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
            onOpenLearned={() => setLearnedOpen(true)}
            onOpenInsights={() => setInsightsOpen(true)}
          />
        </div>

        {/* LEFT RAIL — overlay on < md. Wrapped in a Radix Dialog so Tab is
            trapped inside the rail (can't escape behind the scrim), Escape closes,
            body scroll locks, and focus returns to the opener on close. */}
        <DialogPrimitive.Root
          open={mobileRailOpen}
          onOpenChange={(next) => setMobileRailOpen(next)}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(20%_0.02_260_/_0.35)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
            <DialogPrimitive.Content
              aria-label="Inbox navigation"
              className="fixed inset-y-0 left-0 z-50 flex h-full w-auto data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden"
            >
              <DialogPrimitive.Title className="sr-only">Inbox navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Jump to a bucket, search, ask your inbox, or open settings.
              </DialogPrimitive.Description>
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
                onOpenLearned={() => {
                  setMobileRailOpen(false);
                  setLearnedOpen(true);
                }}
                onOpenInsights={() => {
                  setMobileRailOpen(false);
                  setInsightsOpen(true);
                }}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* LIST PANE — width is user-draggable on desktop via the handle below. */}
        <aside
          aria-label="Triaged emails"
          onKeyDown={handleListKeyDown}
          style={{ "--list-w": `${listWidth}px` } as React.CSSProperties}
          className={`${
            mobileDetailOpen ? "hidden" : "flex"
          } w-full shrink-0 flex-col md:flex md:w-[var(--list-w)]`}
        >
          <ListSearch value={searchQuery} onChange={setSearchQuery} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {hasEmails ? (
              <ul className="flex flex-col py-2">
                {visibleSections.map((section) => (
                  <SectionList
                    key={section.key}
                    section={section}
                    selectedId={selectedEmail?.id ?? null}
                    viewedIds={viewedIds}
                    expandedThreads={expandedThreads}
                    onSelect={selectEmail}
                    onToggleThread={toggleThread}
                    onArchiveAll={
                      BULK_ARCHIVE_BUCKETS.has(section.key)
                        ? () =>
                            bulkArchiveBucket(
                              section.label,
                              section.emails.map((email) => email.id),
                            )
                        : undefined
                    }
                  />
                ))}
              </ul>
            ) : (
              <div className="px-6 py-10">
                <p className="text-sm leading-relaxed text-[var(--ink-500)]">
                  {searchQuery.trim() === ""
                    ? "No emails to triage yet. Connect Gmail and sync to get started."
                    : `No emails match “${searchQuery.trim()}”.`}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Drag handle — resize the list pane (desktop only). role="slider"
            (not "separator") so aria-valuenow/min/max are conveyed as an
            adjustable value; keyboard arrows nudge the width. */}
        <div
          role="slider"
          aria-orientation="vertical"
          aria-label="Resize inbox list"
          aria-valuenow={Math.round(listWidth)}
          aria-valuemin={LIST_WIDTH_MIN}
          aria-valuemax={LIST_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={startListResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              nudgeListWidth(-24);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              nudgeListWidth(24);
            }
          }}
          className={`${
            mobileDetailOpen ? "hidden" : "hidden md:block"
          } group relative w-1 shrink-0 cursor-col-resize touch-none bg-[var(--hairline)] transition-colors hover:bg-[var(--accent)] focus-visible:bg-[var(--accent)] focus-visible:outline-none`}
        >
          <span className="absolute inset-y-0 -left-1 -right-1" aria-hidden="true" />
        </div>

        {/* DETAIL PANE */}
        <main
          ref={detailRef}
          tabIndex={-1}
          aria-label="Email detail"
          className={`${
            mobileDetailOpen ? "flex" : "hidden"
          } min-w-0 flex-1 flex-col overflow-y-auto outline-none md:flex`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedEmail?.id ?? "empty"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {selectedEmail ? (
                <EmailDetail
                  email={selectedEmail}
                  onBack={() => setMobileDetailOpen(false)}
                  onArchived={archiveEmail}
                  onRestore={restoreEmail}
                />
              ) : (
                <EmptyDetail brief={data.brief} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onOpenLearned={() => {
          setSettingsOpen(false);
          setLearnedOpen(true);
        }}
      />

      <LearnedPanel open={learnedOpen} onOpenChange={setLearnedOpen} />

      <InsightsPanel open={insightsOpen} onOpenChange={setInsightsOpen} buckets={liveBuckets} />

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

type ListSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

// Free-text search box pinned above the list. Escape clears (and if already
// empty, blurs so the list keyboard nav takes over again).
function ListSearch({ value, onChange }: ListSearchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="shrink-0 border-b border-[var(--hairline)] px-3 py-2">
      <div className="flex items-center gap-2 rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-2.5 py-1.5 transition-colors focus-within:border-[var(--accent)]">
        <Search size={15} aria-hidden="true" className="shrink-0 text-[var(--ink-500)]" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (value === "") {
                inputRef.current?.blur();
              } else {
                onChange("");
              }
            }
          }}
          placeholder="Search this list…"
          aria-label="Search triaged emails"
          className="w-full bg-transparent text-sm text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-500)]"
        />
        {value !== "" && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ink-500)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

type SectionListProps = {
  section: ListSection;
  selectedId: string | null;
  viewedIds: ReadonlySet<string>;
  expandedThreads: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggleThread: (threadId: string) => void;
  // Present only for low-signal buckets: sweeps the whole section (archive all).
  onArchiveAll?: () => void;
};

// One bucket section: groups its emails into threads and renders each group.
// Singleton threads (count 1) render as today's flat EmailRow; multi-message
// threads render a ThreadRow that expands to reveal older replies.
function SectionList({
  section,
  selectedId,
  viewedIds,
  expandedThreads,
  onSelect,
  onToggleThread,
  onArchiveAll,
}: SectionListProps) {
  const groups = groupEmailsByThread(section.emails);
  return (
    <li>
      <SectionHeader
        label={section.label}
        count={section.emails.length}
        onArchiveAll={onArchiveAll}
      />
      <ul>
        {groups.map((group) =>
          group.count > 1 ? (
            <ThreadRow
              key={group.threadId}
              group={group}
              selectedId={selectedId}
              viewedIds={viewedIds}
              expanded={expandedThreads.has(group.threadId)}
              onSelect={onSelect}
              onToggle={() => onToggleThread(group.threadId)}
            />
          ) : (
            <li key={group.head.id}>
              <EmailRow
                email={group.head}
                isSelected={group.head.id === selectedId}
                isViewed={viewedIds.has(group.head.id)}
                onSelect={() => onSelect(group.head.id)}
              />
            </li>
          ),
        )}
      </ul>
    </li>
  );
}

type ThreadRowProps = {
  group: ThreadGroup;
  selectedId: string | null;
  viewedIds: ReadonlySet<string>;
  expanded: boolean;
  onSelect: (id: string) => void;
  onToggle: () => void;
};

// A multi-message conversation: the newest message as the primary row plus a
// small "N in thread" toggle. Expanding reveals the older replies indented,
// each still an independent EmailRow (selection / read / archive per message).
function ThreadRow({ group, selectedId, viewedIds, expanded, onSelect, onToggle }: ThreadRowProps) {
  const olderCount = group.count - 1;
  return (
    <li>
      <div className="relative">
        <EmailRow
          email={group.head}
          isSelected={group.head.id === selectedId}
          isViewed={viewedIds.has(group.head.id)}
          onSelect={() => onSelect(group.head.id)}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Collapse thread of ${group.count} messages`
              : `Show ${olderCount} more in thread`
          }
          className="absolute top-2 right-3 flex min-h-[24px] items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-raised)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--ink-500)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <ChevronDown
            size={11}
            aria-hidden="true"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {group.count} in thread
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden border-l-2 border-[var(--hairline)] pl-1"
          >
            {group.others.map((email) => (
              <li key={email.id}>
                <EmailRow
                  email={email}
                  isSelected={email.id === selectedId}
                  isViewed={viewedIds.has(email.id)}
                  onSelect={() => onSelect(email.id)}
                />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

type SectionHeaderProps = {
  label: string;
  count: number;
  // Low-signal buckets get an "Archive all" sweep; omitted for everything else.
  onArchiveAll?: () => void;
};

function SectionHeader({ label, count, onArchiveAll }: SectionHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--surface)]/95 px-5 pt-4 pb-1.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[0.7rem] font-semibold tracking-[0.12em] text-[var(--ink-500)] uppercase">
          {label}
        </h2>
        <span className="text-[0.7rem] font-medium text-[var(--ink-500)]">{count}</span>
      </div>
      {onArchiveAll && count > 0 && (
        <button
          type="button"
          onClick={onArchiveAll}
          aria-label={`Archive all ${count} email${count === 1 ? "" : "s"} in ${label}`}
          className="inline-flex min-h-[24px] shrink-0 items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-raised)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--ink-500)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Archive size={11} aria-hidden="true" />
          Archive all
        </button>
      )}
    </div>
  );
}

type EmailRowProps = {
  email: EmailCard;
  isSelected: boolean;
  isViewed: boolean;
  onSelect: () => void;
};

function EmailRow({ email, isSelected, isViewed, onSelect }: EmailRowProps) {
  const tier = resolvePriorityTier(email.priorityLevel);
  const { accentVar } = tierStyle(tier);
  const time = formatTime(email.receivedAt);
  // "Read" = already opened and not the current selection. Unread (and the
  // selected row) stay emphasized; read rows mute so reviewed items are obvious.
  const isRead = isViewed && !isSelected;
  const emphasized = !isRead;

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
        style={{ backgroundColor: accentVar, opacity: isRead ? 0.35 : 1 }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[0.8rem] ${
              isRead ? "font-normal text-[var(--ink-500)]" : "font-semibold text-[var(--ink-900)]"
            }`}
          >
            {email.senderName}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {time && <span className="text-[0.7rem] text-[var(--ink-500)]">{time}</span>}
            {!isViewed && (
              <span
                role="img"
                aria-label="Unread"
                className="h-2 w-2 rounded-full bg-[var(--accent)]"
                title="Unread"
              />
            )}
          </span>
        </span>
        <span
          className={`mt-0.5 block truncate text-[0.85rem] ${
            emphasized ? "font-semibold text-[var(--ink-900)]" : "font-normal text-[var(--ink-500)]"
          }`}
        >
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
  // Optimistically remove / restore this email in the parent list (archive + undo).
  onArchived: (id: string) => void;
  onRestore: (id: string) => void;
};

function EmailDetail({ email, onBack, onArchived, onRestore }: EmailDetailProps) {
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
        <ActionButtons
          emailMessageId={email.id}
          senderEmail={email.senderEmail}
          senderName={email.senderName}
          suggestedBucket={email.suggestedBucket}
          category={email.category}
          onArchived={onArchived}
          onRestore={onRestore}
        />
        <div className="border-t border-[var(--hairline)] pt-3">
          <FeedbackButtons emailMessageId={email.id} />
        </div>
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
  onOpenLearned: () => void;
};

function SettingsDrawer({
  open,
  onOpenChange,
  onOpenOnboarding,
  onOpenLearned,
}: SettingsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)] px-5 py-4">
          <SheetTitle className="text-base font-semibold tracking-tight text-[var(--ink-900)]">
            Settings
          </SheetTitle>
          <SheetDescription className="sr-only">
            Manage your Gmail connection, review what the app has learned, configure Smart Rules,
            and access data controls.
          </SheetDescription>
        </header>

        <div className="flex flex-col gap-6 px-5 py-5">
          <ConnectGmailCard />
          <button
            type="button"
            onClick={onOpenLearned}
            className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] px-4 py-3.5 text-left transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <Brain size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold tracking-tight text-[var(--ink-900)]">
                What I&rsquo;ve learned
              </span>
              <span className="block text-[0.8rem] text-[var(--ink-500)]">
                See how your feedback shapes triage.
              </span>
            </span>
            <ChevronRight
              size={16}
              className="shrink-0 text-[var(--ink-500)] transition-colors group-hover:text-[var(--accent)]"
              aria-hidden="true"
            />
          </button>
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
