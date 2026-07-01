"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildRulesFromAnswers, type OnboardingAnswers } from "@/lib/onboarding";
import { Modal, ModalClose, ModalContent, ModalTitle } from "./ui/modal";

type OnboardingQuestionnaireProps = {
  open: boolean;
  onClose: () => void;
};

type Question = {
  key: keyof OnboardingAnswers;
  label: string;
  hint: string;
  placeholder: string;
};

// The five questions, in order. Each maps to one field of OnboardingAnswers and
// is fed to buildRulesFromAnswers on submit. All are optional.
const QUESTIONS: readonly Question[] = [
  {
    key: "alwaysPrioritize",
    label: "Who should always be prioritized?",
    hint: "Names or email addresses — separate multiple with commas.",
    placeholder: "e.g. my boss, jane@acme.com, the leadership team",
  },
  {
    key: "lowPriority",
    label: "Which senders or domains are low priority?",
    hint: "Senders or domains you rarely need to act on.",
    placeholder: "e.g. noreply@, marketing@vendor.com",
  },
  {
    key: "highStakesTopics",
    label: "What topics are high-stakes for you?",
    hint: "Subjects you never want to miss.",
    placeholder: "e.g. invoices, contracts, renewals",
  },
  {
    key: "readLater",
    label: "What should go straight to Read Later?",
    hint: "Things that are fine to batch and read when you have time.",
    placeholder: "e.g. newsletters, promotions, digests",
  },
  {
    key: "neverIgnore",
    label: "What should never be ignored?",
    hint: "Anything that must always surface, no matter what.",
    placeholder: "e.g. legal notices, anything from my accountant",
  },
] as const;

const EMPTY_ANSWERS: OnboardingAnswers = {
  alwaysPrioritize: "",
  lowPriority: "",
  highStakesTopics: "",
  readLater: "",
  neverIgnore: "",
};

/**
 * First-run "Set up priorities" questionnaire. A single scrollable modal form
 * with all five questions — each optional — that turns the answers into Smart
 * Rules via {@link buildRulesFromAnswers} and persists them through
 * `POST /api/onboarding`. On success it toasts "Added N rules" and reloads so the
 * dashboard reflects the new personalization.
 *
 * Built on the shared Radix {@link Modal} (focus trap, scroll-lock, Escape,
 * aria-modal, focus return); the first field is focused on open.
 */
export function OnboardingQuestionnaire({ open, onClose }: OnboardingQuestionnaireProps) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS);
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Focus the first input whenever the dialog opens.
  useEffect(() => {
    if (open) {
      const id = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  const setField = useCallback((key: keyof OnboardingAnswers, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) {
        return;
      }

      const rules = buildRulesFromAnswers(answers);
      if (rules.length === 0) {
        toast.error("Add at least one answer, or choose Skip for now.");
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rules }),
        });
        if (!res.ok) {
          throw new Error(`onboarding failed (${res.status})`);
        }
        const count = rules.length;
        toast.success(`Added ${count} rule${count === 1 ? "" : "s"}`);
        onClose();
        window.location.reload();
      } catch {
        toast.error("Couldn't create your rules — please try again.");
        setSubmitting(false);
      }
    },
    [answers, submitting, onClose],
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <ModalContent
        aria-label="Set up your priorities"
        wrapperClassName="pt-[8vh] pb-[8vh] sm:pt-[10vh]"
        className="max-h-[84vh]"
        // Drive focus to the first field ourselves rather than the close button.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent-soft)] text-sm text-[var(--accent)]"
            >
              ✨
            </span>
            <div>
              <ModalTitle className="text-base font-semibold tracking-tight text-[var(--ink-900)]">
                Set up your priorities
              </ModalTitle>
              <p className="mt-0.5 text-xs text-[var(--ink-500)]">
                Answer what's useful — every question is optional.
              </p>
            </div>
          </div>
          <ModalClose
            aria-label="Close priority setup"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-chip)] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span aria-hidden="true">✕</span>
          </ModalClose>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            {QUESTIONS.map((question, index) => {
              const inputId = `onboarding-${question.key}`;
              return (
                <div key={question.key} className="flex flex-col gap-1.5">
                  <label htmlFor={inputId} className="text-sm font-semibold text-[var(--ink-900)]">
                    {question.label}
                  </label>
                  <p className="text-xs text-[var(--ink-500)]">{question.hint}</p>
                  <input
                    id={inputId}
                    ref={index === 0 ? firstFieldRef : undefined}
                    type="text"
                    value={answers[question.key] ?? ""}
                    onChange={(event) => setField(question.key, event.target.value)}
                    disabled={submitting}
                    maxLength={280}
                    placeholder={question.placeholder}
                    className="mt-0.5 w-full rounded-[var(--radius-chip)] border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-500)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              );
            })}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--hairline)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-[var(--radius-chip)] px-3.5 py-2 text-sm font-medium text-[var(--ink-500)] transition-colors hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex shrink-0 items-center rounded-[var(--radius-chip)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create my rules"}
            </button>
          </footer>
        </form>
      </ModalContent>
    </Modal>
  );
}
