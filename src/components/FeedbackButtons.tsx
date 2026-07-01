"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FeedbackType =
  | "correct"
  | "wrong"
  | "mark_urgent"
  | "not_urgent"
  | "move_to_read_later"
  | "safe_to_ignore"
  | "always_prioritize_sender"
  | "usually_ignore_sender";

type FeedbackButtonsProps = {
  emailMessageId: string;
};

type Status = "idle" | "saving" | "saved" | "error";

type FeedbackAction = { type: FeedbackType; label: string };

// Grouped so the row reads as intent ("was this right?" vs. adjustments vs.
// sender preferences) rather than one flat wall of pills.
const GROUPS: ReadonlyArray<{ heading: string; actions: ReadonlyArray<FeedbackAction> }> = [
  {
    heading: "Was this right?",
    actions: [
      { type: "correct", label: "Correct" },
      { type: "wrong", label: "Wrong" },
    ],
  },
  {
    heading: "Adjust",
    actions: [
      { type: "mark_urgent", label: "Mark urgent" },
      { type: "not_urgent", label: "Not urgent" },
      { type: "move_to_read_later", label: "Read Later" },
      { type: "safe_to_ignore", label: "Safe to ignore" },
    ],
  },
  {
    heading: "This sender",
    actions: [
      { type: "always_prioritize_sender", label: "Always prioritize" },
      { type: "usually_ignore_sender", label: "Usually ignore" },
    ],
  },
];

/**
 * Compact feedback action row. POSTs the user's correction to /api/feedback.
 * Failures are surfaced inline and never throw past this component.
 */
export function FeedbackButtons({ emailMessageId }: FeedbackButtonsProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [pending, setPending] = useState<FeedbackType | null>(null);
  // Feedback types already submitted for this email — their buttons lock into a
  // confirmed state so the same correction can't be sent twice.
  const [submitted, setSubmitted] = useState<ReadonlySet<FeedbackType>>(() => new Set());

  async function submit(feedbackType: FeedbackType) {
    setStatus("saving");
    setPending(feedbackType);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailMessageId, feedbackType }),
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const data = (await res.json()) as { ruleCreated?: boolean; reclassified?: number };
      setStatus("saved");
      setSubmitted((prev) => new Set(prev).add(feedbackType));
      toast.success("Feedback saved");
      if (data.ruleCreated === true) {
        toast.success("Smart Rule added");
      }
      // The backend re-triages this sender's already-stored mail so the
      // correction visibly takes effect. Surface that, then refresh the inbox so
      // the updated classifications show without a manual reload.
      const reclassified = data.reclassified ?? 0;
      if (reclassified > 0) {
        toast.success(`Updated ${reclassified} similar email${reclassified === 1 ? "" : "s"}`);
        // Give the toasts a beat to register, then pull the fresh server-rendered
        // triage (the page is force-dynamic, so a reload re-runs classification-aware
        // data loading).
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
      }
    } catch {
      setStatus("error");
      toast.error("Couldn’t save feedback — try again");
    } finally {
      setPending(null);
    }
  }

  const isSaving = status === "saving";

  return (
    <div className="flex flex-col gap-2.5">
      {GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 w-full text-[0.65rem] font-semibold tracking-[0.1em] text-[var(--ink-500)] uppercase sm:w-auto">
            {group.heading}
          </span>
          {group.actions.map((action) => {
            const isDone = submitted.has(action.type);
            return (
              <button
                key={action.type}
                type="button"
                disabled={isSaving || isDone}
                onClick={() => submit(action.type)}
                aria-label={`Feedback: ${action.label}`}
                aria-pressed={isDone}
                className={
                  isDone
                    ? "inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]"
                    : "rounded-full border border-[var(--hairline)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--ink-700)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {isDone && <Check size={12} />}
                {pending === action.type ? "…" : action.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
