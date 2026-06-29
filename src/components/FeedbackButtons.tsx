"use client";

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

const ACTIONS: ReadonlyArray<{ type: FeedbackType; label: string }> = [
  { type: "correct", label: "Correct" },
  { type: "wrong", label: "Wrong" },
  { type: "mark_urgent", label: "Mark urgent" },
  { type: "not_urgent", label: "Not urgent" },
  { type: "move_to_read_later", label: "Move to Read Later" },
  { type: "safe_to_ignore", label: "Safe to ignore" },
  { type: "always_prioritize_sender", label: "Always prioritize this sender" },
  { type: "usually_ignore_sender", label: "Usually ignore this sender" },
];

/**
 * Compact feedback action row. POSTs the user's correction to /api/feedback.
 * Failures are surfaced inline and never throw past this component.
 */
export function FeedbackButtons({ emailMessageId }: FeedbackButtonsProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [pending, setPending] = useState<FeedbackType | null>(null);

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
      const data = (await res.json()) as { ruleCreated?: boolean };
      setStatus("saved");
      toast.success("Feedback saved");
      if (data.ruleCreated === true) {
        toast.success("Smart Rule added");
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
    <div className="flex flex-wrap items-center gap-1.5">
      {ACTIONS.map((action) => (
        <button
          key={action.type}
          type="button"
          disabled={isSaving}
          onClick={() => submit(action.type)}
          aria-label={`Feedback: ${action.label}`}
          className="rounded-full border border-[var(--hairline)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--ink-700)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === action.type ? "…" : action.label}
        </button>
      ))}
    </div>
  );
}
