"use client";

import { Archive, Check, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

type ActionButtonsProps = {
  // Internal EmailMessage.id — the archive/draft routes key off this, NOT sourceId.
  emailMessageId: string;
  // Optimistically drop the archived email from the visible list. Called before
  // the network round-trip so the UI feels instant.
  onArchived: (id: string) => void;
  // Restore an optimistically-removed email (undo path, or when archive fails).
  onRestore: (id: string) => void;
};

// Gmail web drafts folder — the backend returns only a draftId, and Gmail has no
// stable per-draft deep link, so we point at the drafts view where it now lives.
const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";

// How long the "Undo" toast stays actionable after archiving.
const UNDO_WINDOW_MS = 6000;

type WriteState = "loading" | "ready" | "no-write" | "disconnected" | "error";

type StatusResponse = {
  connected?: boolean;
  canWrite?: boolean;
};

/**
 * Tier 1 email actions on the detail pane: Archive (with undo) and Draft reply.
 *
 * SAFETY: Archive only removes the INBOX label (reversible); Draft reply only
 * creates a Gmail draft — this UI never sends. When the connected grant lacks
 * write scopes (`canWrite: false`), the actions are replaced by a reconnect CTA.
 */
export function ActionButtons({ emailMessageId, onArchived, onRestore }: ActionButtonsProps) {
  const [writeState, setWriteState] = useState<WriteState>("loading");
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const res = await fetch("/api/auth/google/status");
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        const data = (await res.json()) as StatusResponse;
        if (!active) {
          return;
        }
        if (data.connected !== true) {
          setWriteState("disconnected");
        } else if (data.canWrite === true) {
          setWriteState("ready");
        } else {
          setWriteState("no-write");
        }
      } catch {
        if (active) {
          setWriteState("error");
        }
      }
    }
    loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function restore() {
    onRestore(emailMessageId);
    try {
      const res = await fetch(`/api/emails/${emailMessageId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undo: true }),
      });
      if (!res.ok) {
        throw new Error(`unarchive failed (${res.status})`);
      }
      toast.success("Email restored to inbox");
    } catch {
      toast.error("Couldn’t restore this email — check Gmail.");
    }
  }

  async function archive() {
    setIsArchiving(true);
    // Optimistic: remove from the list immediately, restore on failure.
    onArchived(emailMessageId);
    try {
      const res = await fetch(`/api/emails/${emailMessageId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error(`archive failed (${res.status})`);
      }
      toast.success("Email archived", {
        description: "Removed from your inbox in Gmail.",
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void restore();
          },
        },
      });
    } catch {
      onRestore(emailMessageId);
      toast.error("Couldn’t archive this email — try reconnecting Gmail.");
    } finally {
      setIsArchiving(false);
    }
  }

  async function draftReply() {
    setIsDrafting(true);
    try {
      const res = await fetch(`/api/emails/${emailMessageId}/draft`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`draft failed (${res.status})`);
      }
      // Body shape: { ok: true, draftId }. Never sends — draft only.
      await res.json().catch(() => ({}));
      toast.success("Draft created in Gmail", {
        description: "Review and send it yourself — nothing was sent.",
        duration: 8000,
        action: {
          label: "Open Gmail",
          onClick: () => {
            window.open(GMAIL_DRAFTS_URL, "_blank", "noopener,noreferrer");
          },
        },
      });
    } catch {
      toast.error("Couldn’t create a draft — try reconnecting Gmail.");
    } finally {
      setIsDrafting(false);
    }
  }

  // While we don't yet know the grant state, don't flash controls.
  if (writeState === "loading") {
    return (
      <p className="text-xs text-[var(--ink-500)]" role="status">
        Checking Gmail permissions…
      </p>
    );
  }

  // Connected without write scopes (a legacy read-only grant) OR not connected:
  // both need a (re)consent through the connect route before actions work.
  if (writeState === "no-write" || writeState === "disconnected") {
    return <ReconnectPrompt connected={writeState === "no-write"} />;
  }

  // Status probe failed — degrade gracefully, still let the user try (the API
  // routes are the real gate and fail soft with a reconnect nudge).
  const probeFailed = writeState === "error";

  return (
    <div className="flex flex-col gap-2">
      {probeFailed && (
        <p className="text-xs text-[var(--ink-500)]">
          Couldn’t confirm Gmail permissions — actions may prompt a reconnect.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={archive}
          disabled={isArchiving}
          aria-label="Archive email (remove from inbox)"
        >
          <Archive size={14} aria-hidden="true" />
          {isArchiving ? "Archiving…" : "Archive"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={draftReply}
          disabled={isDrafting}
          aria-label="Draft a reply in Gmail (does not send)"
        >
          <PenLine size={14} aria-hidden="true" />
          {isDrafting ? "Drafting reply…" : "Draft reply"}
        </Button>
      </div>
    </div>
  );
}

type ReconnectPromptProps = {
  // true when a Gmail account is connected but lacks the write scopes; false when
  // no account is connected at all. Only the copy differs.
  connected: boolean;
};

/**
 * Inline CTA shown in the detail action area when archive/draft aren't available.
 * Links to the connect route to (re)grant the gmail.modify + gmail.compose scopes.
 */
function ReconnectPrompt({ connected }: ReconnectPromptProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--accent-soft)] px-3.5 py-3 text-sm">
      <p className="font-medium text-[var(--accent)]">
        {connected ? "Reconnect Gmail to enable actions" : "Connect Gmail to enable actions"}
      </p>
      <p className="mt-0.5 text-[var(--ink-700)]">
        Archiving and drafting replies need write access.{" "}
        {connected ? "Your current connection is read-only." : "No Gmail account is connected yet."}{" "}
        We still never send or delete anything for you.
      </p>
      <a
        href="/api/auth/google/connect"
        className="mt-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Check size={13} aria-hidden="true" />
        {connected ? "Reconnect Gmail" : "Connect Gmail"}
      </a>
    </div>
  );
}
