"use client";

import { Command } from "cmdk";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { EmailCard } from "@/lib/dashboard-types";

type SyncResult = { classified: number; needsReview: number; total: number };

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  emails: ReadonlyArray<EmailCard>;
  onSelectEmail: (id: string) => void;
  onOpenSettings: () => void;
  onOpenAsk: () => void;
};

/**
 * Cmd/Ctrl+K command palette. Renders a centered modal dialog over a scrim.
 * Lets the user jump to any triaged email or run a workspace action. Opening,
 * closing, and the keyboard listener are owned by the parent (InboxWorkspace).
 */
export function CommandPalette({
  open,
  onClose,
  emails,
  onSelectEmail,
  onOpenSettings,
  onOpenAsk,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the search input whenever the palette opens.
  useEffect(() => {
    if (open) {
      // Defer to after paint so the element exists and is focusable.
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  // Escape closes the palette. Bound on the dialog itself so it doesn't fight
  // with the workspace list navigation while closed.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function jumpToEmail(id: string) {
    onSelectEmail(id);
    onClose();
  }

  function openSettings() {
    onClose();
    onOpenSettings();
  }

  function openAsk() {
    onClose();
    onOpenAsk();
  }

  async function syncInbox() {
    onClose();
    try {
      const res = await fetch("/api/emails/sync", { method: "POST" });
      if (!res.ok) {
        throw new Error(`sync failed (${res.status})`);
      }
      const result = (await res.json()) as SyncResult;
      toast.success(
        `Synced ${result.total} email${result.total === 1 ? "" : "s"} — ${result.needsReview} need review`,
      );
      window.location.reload();
    } catch {
      toast.error("Couldn’t sync your inbox — please try again.");
    }
  }

  function connectGmail() {
    onClose();
    window.location.href = "/api/auth/google/connect";
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="absolute inset-0 bg-[oklch(20%_0.02_260_/_0.35)] backdrop-blur-[2px]"
      />

      <Command
        label="Command palette"
        onKeyDown={handleKeyDown}
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[0_24px_64px_-24px_rgba(20,20,40,0.45)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-4">
          <span aria-hidden="true" className="text-sm text-[var(--ink-500)]">
            ⌘K
          </span>
          <Command.Input
            ref={inputRef}
            placeholder="Jump to an email or run an action…"
            className="w-full bg-transparent py-3.5 text-sm text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-500)]"
          />
        </div>

        <Command.List className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--ink-500)]">
            No results found.
          </Command.Empty>

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.7rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-[var(--ink-500)] [&_[cmdk-group-heading]]:uppercase"
          >
            <PaletteItem value="Ask your inbox" icon="✨" onSelect={openAsk}>
              Ask your inbox
            </PaletteItem>
            <PaletteItem value="Open Settings" icon="⚙" onSelect={openSettings}>
              Open Settings
            </PaletteItem>
            <PaletteItem value="Sync inbox" icon="↻" onSelect={syncInbox}>
              Sync inbox
            </PaletteItem>
            <PaletteItem value="Connect Gmail" icon="✉" onSelect={connectGmail}>
              Connect Gmail
            </PaletteItem>
          </Command.Group>

          {emails.length > 0 && (
            <Command.Group
              heading="Emails"
              className="mt-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.7rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-[var(--ink-500)] [&_[cmdk-group-heading]]:uppercase"
            >
              {emails.map((email) => (
                <PaletteItem
                  key={email.id}
                  // Include id so senders with identical names stay distinct.
                  value={`${email.senderName} ${email.subject} ${email.id}`}
                  onSelect={() => jumpToEmail(email.id)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-[var(--ink-900)]">
                      {email.subject}
                    </span>
                    <span className="truncate text-xs text-[var(--ink-500)]">
                      {email.senderName}
                    </span>
                  </span>
                </PaletteItem>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

type PaletteItemProps = {
  value: string;
  onSelect: () => void;
  icon?: string;
  children: React.ReactNode;
};

function PaletteItem({ value, onSelect, icon, children }: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-[var(--ink-700)] transition-colors data-[selected=true]:bg-[var(--accent-soft)] data-[selected=true]:text-[var(--ink-900)]"
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-[var(--ink-500)]">
          {icon}
        </span>
      )}
      {children}
    </Command.Item>
  );
}
