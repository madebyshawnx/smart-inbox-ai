"use client";

import { useCallback, useEffect, useState } from "react";

type SmartRule = {
  id: string;
  ruleText: string;
  isActive: boolean;
  priorityWeight: number;
};

type LoadState = "loading" | "ready" | "error";

/**
 * Lets the user manage plain-English priority rules that personalize triage
 * (e.g. "Always prioritize emails from my boss"). Reads the rule set on mount,
 * supports add / toggle / delete, and re-fetches after each mutation so the list
 * always reflects server state. All mutations surface inline errors instead of
 * crashing the panel.
 */
export function SmartRulesManager() {
  const [rules, setRules] = useState<SmartRule[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/smart-rules");
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const { rules: nextRules } = (await res.json()) as { rules: SmartRule[] };
      setRules(nextRules);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  async function handleAddRule() {
    const ruleText = draft.trim();
    if (ruleText.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/smart-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleText }),
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      setDraft("");
      await loadRules();
    } catch {
      setActionError("Could not add that rule. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggle(rule: SmartRule) {
    if (busyId !== null) {
      return;
    }
    setBusyId(rule.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/smart-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      await loadRules();
    } catch {
      setActionError("Could not update that rule. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(rule: SmartRule) {
    if (busyId !== null) {
      return;
    }
    setBusyId(rule.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/smart-rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      await loadRules();
    } catch {
      setActionError("Could not delete that rule. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length > 0 && !isSubmitting;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-5 sm:p-6">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void handleAddRule();
        }}
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="smart-rule-input"
            className="text-[0.7rem] font-semibold tracking-wide text-[var(--ink-500)] uppercase"
          >
            Add a rule
          </label>
          <input
            id="smart-rule-input"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. Always prioritize emails from my boss"
            className="mt-1 w-full rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--ink-900)] placeholder:text-[var(--ink-500)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Adding…" : "Add rule"}
        </button>
      </form>

      {actionError !== null && (
        <p className="mt-3 text-sm font-medium text-[var(--priority-high)]" role="status">
          {actionError}
        </p>
      )}

      <div className="mt-5">
        {loadState === "loading" && (
          <p className="text-sm text-[var(--ink-500)]" role="status">
            Loading your rules…
          </p>
        )}

        {loadState === "error" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-[var(--priority-high)]">
              Could not load your rules.
            </p>
            <button
              type="button"
              onClick={() => {
                setLoadState("loading");
                void loadRules();
              }}
              className="rounded-[var(--radius-chip)] border border-[var(--hairline)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-700)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Retry
            </button>
          </div>
        )}

        {loadState === "ready" && rules.length === 0 && (
          <p className="rounded-lg bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--ink-500)]">
            No rules yet — add one to personalize your inbox.
          </p>
        )}

        {loadState === "ready" && rules.length > 0 && (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => {
              const isBusy = busyId === rule.id;
              return (
                <li
                  key={rule.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => void handleToggle(rule)}
                    disabled={isBusy}
                    aria-pressed={rule.isActive}
                    aria-label={`${rule.isActive ? "Deactivate" : "Activate"} rule: ${rule.ruleText}`}
                    className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-chip)] border border-[var(--hairline)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-[var(--accent)] aria-pressed:border-[var(--accent)]"
                  >
                    <span
                      aria-hidden="true"
                      className="ml-0.5 inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                      style={{ transform: rule.isActive ? "translateX(20px)" : "translateX(0)" }}
                    />
                  </button>

                  <span
                    className={`min-w-0 flex-1 text-sm ${
                      rule.isActive ? "text-[var(--ink-900)]" : "text-[var(--ink-500)] line-through"
                    }`}
                  >
                    {rule.ruleText}
                  </span>

                  <button
                    type="button"
                    onClick={() => void handleDelete(rule)}
                    disabled={isBusy}
                    aria-label={`Delete rule: ${rule.ruleText}`}
                    className="shrink-0 rounded-[var(--radius-chip)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-500)] transition-colors hover:bg-[var(--priority-high-soft)] hover:text-[var(--priority-high)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
