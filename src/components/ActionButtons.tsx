"use client";

import { Archive, Check, MailX, PenLine, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { BucketKey } from "@/lib/dashboard-types";
import { isUnsubscribeProne } from "@/lib/unsubscribe-eligibility";
import { Button } from "./ui/button";
import { useWriteState } from "./useWriteState";

type ActionButtonsProps = {
  // Internal EmailMessage.id — the archive/draft/unsubscribe routes key off this,
  // NOT sourceId.
  emailMessageId: string;
  // Sender identity for the "Screen sender" control (prioritize / ignore rules).
  senderEmail: string;
  senderName: string;
  // Used to decide whether to surface the Unsubscribe action prominently.
  suggestedBucket: BucketKey;
  category: string;
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

/**
 * Tier 1 + Tier 3 email actions on the detail pane: Archive (with undo), Draft
 * reply, Unsubscribe, and Screen sender (prioritize / ignore).
 *
 * SAFETY: Archive only removes the INBOX label (reversible); Draft reply only
 * creates a Gmail draft; Unsubscribe uses only the RFC 8058 one-click HTTPS URL
 * (never sends a mailto — hands it to the user instead); Screen sender writes a
 * Smart Rule and optionally archives (reversible). This UI never sends email.
 * When the grant lacks write scopes (`no-write`) the actions are replaced by a
 * reconnect CTA.
 */
export function ActionButtons({
  emailMessageId,
  senderEmail,
  senderName,
  suggestedBucket,
  category,
  onArchived,
  onRestore,
}: ActionButtonsProps) {
  const writeState = useWriteState();
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);

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

  // Shared archive-with-undo used by the Archive button and by a successful
  // one-click unsubscribe (which optimistically archives afterward).
  async function archiveWithUndo(successTitle: string, successDescription: string) {
    onArchived(emailMessageId);
    const res = await fetch(`/api/emails/${emailMessageId}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`archive failed (${res.status})`);
    }
    toast.success(successTitle, {
      description: successDescription,
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          void restore();
        },
      },
    });
  }

  async function archive() {
    setIsArchiving(true);
    // Optimistic: remove from the list immediately, restore on failure.
    try {
      await archiveWithUndo("Email archived", "Removed from your inbox in Gmail.");
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
  const showUnsubscribe = isUnsubscribeProne(suggestedBucket, category);

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
        <UnsubscribeButton
          emailMessageId={emailMessageId}
          prominent={showUnsubscribe}
          onArchiveWithUndo={archiveWithUndo}
          onRestore={onRestore}
        />
      </div>
      <ScreenSenderControl senderEmail={senderEmail} senderName={senderName} />
    </div>
  );
}

type UnsubscribeButtonProps = {
  emailMessageId: string;
  // When true, render as a visible outline button (low-signal mail). When false,
  // render as a quieter ghost button so it stays available but out of the way.
  prominent: boolean;
  // Optimistically archive after a successful one-click unsubscribe (with undo).
  // archiveWithUndo optimistically removes the row up front, so on failure we
  // must restore it (mirroring archive()) — onRestore does exactly that.
  onArchiveWithUndo: (title: string, description: string) => Promise<void>;
  // Restore the optimistically-removed row if the post-unsubscribe archive fails.
  onRestore: (id: string) => void;
};

/**
 * Per-email Unsubscribe. Calls the unsubscribe route which fetches the
 * List-Unsubscribe headers on demand.
 *
 * SAFETY: On a one-click (RFC 8058) success the server has already POSTed the
 * HTTPS unsubscribe URL — we then optimistically archive with undo. When only a
 * mailto: is available we NEVER send it; we open the user's mail client with a
 * pre-addressed unsubscribe message so THEY can send it.
 */
function UnsubscribeButton({
  emailMessageId,
  prominent,
  onArchiveWithUndo,
  onRestore,
}: UnsubscribeButtonProps) {
  const [isBusy, setIsBusy] = useState(false);

  async function unsubscribe() {
    setIsBusy(true);
    try {
      const res = await fetch(`/api/emails/${emailMessageId}/unsubscribe`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`unsubscribe failed (${res.status})`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        method?: string;
        mailto?: string | null;
      };

      if (data.ok === true && data.method === "one-click") {
        toast.success("Unsubscribed");
        // Optimistically clear the newsletter from the inbox, with undo.
        try {
          await onArchiveWithUndo("Unsubscribed and archived", "Removed from your inbox in Gmail.");
        } catch {
          // Unsubscribe still succeeded; the archive failed. archiveWithUndo
          // optimistically removed the row up front, so restore it (mirroring
          // archive()) — otherwise the email vanishes despite still being in Gmail.
          onRestore(emailMessageId);
          toast.message("Unsubscribed, but couldn’t archive — archive it manually if you like.");
        }
        return;
      }

      // Only a mailto: (or nothing). We never send it — hand it to the user.
      if (data.mailto) {
        toast.message("This sender only offers email unsubscribe", {
          description: "Open a pre-filled message — you send it yourself. We never send for you.",
          duration: 10000,
          action: {
            label: "Open email",
            onClick: () => {
              window.open(data.mailto as string, "_blank", "noopener,noreferrer");
            },
          },
        });
      } else {
        toast.message("No unsubscribe link found for this sender.");
      }
    } catch {
      toast.error("Couldn’t unsubscribe — try reconnecting Gmail and retry.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={prominent ? "outline" : "ghost"}
      size="sm"
      onClick={unsubscribe}
      disabled={isBusy}
      aria-label="Unsubscribe from this sender (never sends email on your behalf)"
    >
      <MailX size={14} aria-hidden="true" />
      {isBusy ? "Unsubscribing…" : "Unsubscribe"}
    </Button>
  );
}

type ScreenSenderControlProps = {
  senderEmail: string;
  senderName: string;
};

type ScreenDecision = "in" | "out";

/**
 * Per-email sender screening: "Prioritize sender" (screen in) or "Ignore sender"
 * (screen out). Reuses the Smart-Rules machinery via /api/senders/screen — no
 * new tables. Screening a sender out also archives their existing stored mail
 * (reversible), which optimistically clears this email from the list.
 */
function ScreenSenderControl({ senderEmail, senderName }: ScreenSenderControlProps) {
  const [pending, setPending] = useState<ScreenDecision | null>(null);
  const [done, setDone] = useState<ScreenDecision | null>(null);

  async function screen(decision: ScreenDecision) {
    setPending(decision);
    try {
      const res = await fetch("/api/senders/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderEmail,
          senderName,
          decision,
          // On "out", also archive this sender's existing mail (reversible).
          archiveExisting: decision === "out",
        }),
      });
      if (!res.ok) {
        throw new Error(`screen failed (${res.status})`);
      }
      const data = (await res.json()) as {
        ruleCreated?: boolean;
        archived?: number;
      };
      setDone(decision);
      const label = decision === "in" ? "prioritize" : "ignore";
      toast.success(
        data.ruleCreated === true
          ? `Smart Rule added — always ${label} ${senderEmail}`
          : `Already ${label === "prioritize" ? "prioritizing" : "ignoring"} ${senderEmail}`,
      );
      const archived = data.archived ?? 0;
      if (decision === "out" && archived > 0) {
        toast.success(`Archived ${archived} email${archived === 1 ? "" : "s"} from this sender`, {
          description: "Reversible — they’re just removed from your inbox.",
        });
        // Reflect the sender-wide change without hand-tracking every id.
        window.setTimeout(() => {
          window.location.reload();
        }, 1100);
      }
    } catch {
      toast.error("Couldn’t update this sender — try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[0.65rem] font-semibold tracking-[0.1em] text-[var(--ink-500)] uppercase">
        This sender
      </span>
      <ScreenPill
        label="Prioritize"
        decision="in"
        pending={pending}
        done={done}
        onClick={() => screen("in")}
      />
      <ScreenPill
        label="Ignore"
        decision="out"
        pending={pending}
        done={done}
        onClick={() => screen("out")}
      />
    </div>
  );
}

type ScreenPillProps = {
  label: string;
  decision: ScreenDecision;
  pending: ScreenDecision | null;
  done: ScreenDecision | null;
  onClick: () => void;
};

function ScreenPill({ label, decision, pending, done, onClick }: ScreenPillProps) {
  const isDone = done === decision;
  const isPending = pending === decision;
  const Icon = decision === "in" ? ThumbsUp : ThumbsDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending !== null || isDone}
      aria-pressed={isDone}
      aria-label={
        decision === "in" ? "Always prioritize this sender" : "Usually ignore this sender"
      }
      className={
        isDone
          ? "inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]"
          : "inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--ink-700)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {isDone ? <Check size={12} aria-hidden="true" /> : <Icon size={12} aria-hidden="true" />}
      {isPending ? "…" : label}
    </button>
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
