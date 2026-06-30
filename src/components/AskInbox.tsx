"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type AskInboxProps = {
  open: boolean;
  onClose: () => void;
};

const EXAMPLE_QUESTIONS = [
  "What's waiting on me?",
  "What deadlines do I have?",
  "What needs attention today?",
] as const;

/**
 * "Ask your inbox" modal dialog. The user types a natural-language question and
 * gets an AI answer grounded in their already-triaged emails. Read-only — it
 * only POSTs the question to /api/ask, which reads existing classifications.
 *
 * Visual language matches the command palette / settings drawer: a scrim plus a
 * centered card built on the shared design tokens. Escape closes; the input is
 * focused on open. The user can ask follow-up questions without closing.
 */
export function AskInbox({ open, onClose }: AskInboxProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Focus the input whenever the dialog opens.
  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const askQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed === "") {
      return;
    }
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) {
        throw new Error(`ask failed (${res.status})`);
      }
      const data = (await res.json()) as { answer: string };
      setAnswer(data.answer);
    } catch {
      toast.error("Couldn't answer your question — please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askQuestion(question);
  }

  function fillExample(example: string) {
    setQuestion(example);
    inputRef.current?.focus();
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close ask your inbox"
        onClick={onClose}
        className="absolute inset-0 bg-[oklch(20%_0.02_260_/_0.35)] backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask your inbox"
        onKeyDown={handleKeyDown}
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[0_24px_64px_-24px_rgba(20,20,40,0.45)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent-soft)] text-sm text-[var(--accent)]"
            >
              ✨
            </span>
            <h2 className="text-base font-semibold tracking-tight text-[var(--ink-900)]">
              Ask your inbox
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ask your inbox"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-chip)] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label htmlFor="ask-input" className="sr-only">
              Ask a question about your inbox
            </label>
            <div className="flex items-center gap-2">
              <input
                id="ask-input"
                ref={inputRef}
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={500}
                placeholder="Ask anything about your triaged inbox…"
                className="min-w-0 flex-1 rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-500)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              />
              <button
                type="submit"
                disabled={loading || question.trim() === ""}
                className="inline-flex shrink-0 items-center rounded-[var(--radius-chip)] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Asking…" : "Ask"}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUESTIONS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => fillExample(example)}
                  className="rounded-[var(--radius-chip)] border border-[var(--hairline)] px-2.5 py-1 text-xs font-medium text-[var(--ink-500)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  {example}
                </button>
              ))}
            </div>
          </form>

          {(loading || answer !== null) && (
            <div
              aria-live="polite"
              className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3.5"
            >
              {loading ? (
                <p className="text-sm text-[var(--ink-500)]">Reading your inbox…</p>
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--ink-700)]">
                  {answer}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
