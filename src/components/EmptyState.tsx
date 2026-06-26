"use client";

import { useState } from "react";

type Status = "idle" | "running" | "error";

/**
 * Shown when no emails have been classified yet. The primary action triggers a
 * sample classification run (an LLM call — can take many seconds) then reloads.
 */
export function EmptyState() {
  const [status, setStatus] = useState<Status>("idle");

  async function classifySamples() {
    setStatus("running");
    try {
      const res = await fetch("/api/classify", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      location.reload();
    } catch {
      setStatus("error");
    }
  }

  const isRunning = status === "running";

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
        {isRunning ? "Classifying… this can take a moment" : "Classify sample emails"}
      </button>

      {status === "error" && (
        <p className="mt-3 text-sm font-medium text-[var(--priority-high)]" role="status">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
