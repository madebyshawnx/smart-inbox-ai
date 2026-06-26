"use client";

import { useState } from "react";

type Status = "idle" | "running" | "error";

type RawEmail = { sourceId: string };

// How many emails to classify at once. Each is its own LLM call; a small pool
// keeps the run fast without flooding the API or the SQLite write path.
const CONCURRENCY = 4;

/**
 * Shown when no emails have been classified yet. The primary action fetches the
 * sample emails, classifies them a few at a time (each is an LLM call), and
 * shows live "X of N" progress before reloading into the populated dashboard.
 */
export function EmptyState() {
  const [status, setStatus] = useState<Status>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  async function classifySamples() {
    setStatus("running");
    setDone(0);
    setTotal(0);

    try {
      const listRes = await fetch("/api/classify");
      if (!listRes.ok) {
        throw new Error(`Could not load samples (${listRes.status})`);
      }
      const { emails } = (await listRes.json()) as { emails: RawEmail[] };
      setTotal(emails.length);

      let failures = 0;
      let cursor = 0;
      async function worker(): Promise<void> {
        while (cursor < emails.length) {
          const email = emails[cursor++];
          try {
            const res = await fetch("/api/classify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ emails: [email] }),
            });
            if (!res.ok) {
              failures += 1;
            }
          } catch {
            failures += 1;
          }
          setDone((d) => d + 1);
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, worker));

      if (failures === emails.length) {
        throw new Error("All classifications failed.");
      }
      location.reload();
    } catch {
      setStatus("error");
    }
  }

  const isRunning = status === "running";
  const buttonLabel = isRunning
    ? total > 0
      ? `Classifying ${done} of ${total}…`
      : "Preparing…"
    : "Classify sample emails";

  return (
    <section
      aria-labelledby="empty-heading"
      className="mx-auto flex max-w-md flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[var(--hairline)] bg-[var(--surface-raised)] px-6 py-14 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xl text-[var(--accent)]"
      >
        ✦
      </span>
      <h2 id="empty-heading" className="mt-4 text-xl font-semibold text-[var(--ink-900)]">
        No classified emails yet
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-700)]">
        Your daily brief is empty. Run a sample classification to see how Smart Inbox AI prioritizes
        your inbox and explains what needs attention.
      </p>

      <button
        type="button"
        onClick={classifySamples}
        disabled={isRunning}
        className="mt-6 inline-flex items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {buttonLabel}
      </button>

      {isRunning && total > 0 && (
        <div
          className="mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[var(--hairline)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Classification progress"
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}

      {status === "error" && (
        <p className="mt-3 text-sm font-medium text-[var(--priority-high)]" role="status">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
