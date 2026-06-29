"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Suggestion = {
  signature: string;
  ruleText: string;
  reason: string;
  priorityWeight: number;
};

/**
 * Surfaces behavioral-learning suggestions ("Suggested rules") derived from how
 * the user handles their inbox. Suggestions are *proposals* — the user accepts
 * or dismisses each one; nothing is auto-applied.
 *
 * Renders NOTHING when there are no suggestions (or while loading / on error),
 * so it never clutters Settings when there's nothing to propose.
 */
export function SuggestedRules() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busySignature, setBusySignature] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/suggestions");
        if (!res.ok) {
          return;
        }
        const { suggestions: next } = (await res.json()) as { suggestions: Suggestion[] };
        if (active) {
          setSuggestions(next);
        }
      } catch {
        // Silent: suggestions are an enhancement; never block Settings on failure.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const removeSuggestion = useCallback((signature: string) => {
    setSuggestions((prev) => prev.filter((item) => item.signature !== signature));
  }, []);

  const handleAccept = useCallback(
    async (suggestion: Suggestion) => {
      if (busySignature !== null) {
        return;
      }
      setBusySignature(suggestion.signature);
      try {
        const res = await fetch("/api/suggestions/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ruleText: suggestion.ruleText,
            priorityWeight: suggestion.priorityWeight,
          }),
        });
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        toast.success("Smart Rule added");
        removeSuggestion(suggestion.signature);
      } catch {
        toast.error("Couldn’t add that rule — try again");
      } finally {
        setBusySignature(null);
      }
    },
    [busySignature, removeSuggestion],
  );

  const handleDismiss = useCallback(
    async (suggestion: Suggestion) => {
      if (busySignature !== null) {
        return;
      }
      setBusySignature(suggestion.signature);
      try {
        const res = await fetch("/api/suggestions/dismiss", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signature: suggestion.signature }),
        });
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        removeSuggestion(suggestion.signature);
        toast("Suggestion dismissed");
      } catch {
        toast.error("Couldn’t dismiss that — try again");
      } finally {
        setBusySignature(null);
      }
    },
    [busySignature, removeSuggestion],
  );

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="suggested-rules-heading" className="flex flex-col gap-3">
      <div>
        <h3
          id="suggested-rules-heading"
          className="text-base font-semibold tracking-tight text-[var(--ink-900)]"
        >
          Suggested rules
        </h3>
        <p className="mt-0.5 text-sm text-[var(--ink-500)]">Based on how you handle your inbox.</p>
      </div>

      <ul className="flex flex-col gap-2">
        {suggestions.map((suggestion) => {
          const isBusy = busySignature === suggestion.signature;
          return (
            <li
              key={suggestion.signature}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-4"
            >
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-[var(--ink-900)]">{suggestion.reason}</p>
                <p className="rounded-[var(--radius-chip)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink-500)]">
                  {suggestion.ruleText}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAccept(suggestion)}
                  disabled={isBusy}
                  aria-label={`Add rule: ${suggestion.ruleText}`}
                  className="inline-flex items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add rule
                </button>
                <button
                  type="button"
                  onClick={() => void handleDismiss(suggestion)}
                  disabled={isBusy}
                  aria-label={`Dismiss suggestion: ${suggestion.ruleText}`}
                  className="inline-flex items-center justify-center rounded-[var(--radius-chip)] border border-[var(--hairline)] px-4 py-2 text-sm font-semibold text-[var(--ink-700)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
