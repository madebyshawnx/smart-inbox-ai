"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

type GmailStatus = { connected: false } | { connected: true; email: string; connectedAt: string };

type SyncResult = { classified: number; needsReview: number; total: number };

type LoadState = "loading" | "ready" | "error";

/**
 * Permissions surface for the Gmail read-only integration. On mount it reads the
 * connection status and any post-OAuth redirect flag (`?gmail=connected|error`),
 * then renders either a connect explainer or the connected controls (sync /
 * disconnect). All network calls fail soft — the card never crashes the page.
 */
export function ConnectGmailCard() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Read the one-time OAuth redirect flag, then scrub it from the URL so a
  // refresh doesn't re-show the toast.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("gmail");
    if (flag === "connected") {
      toast.success("Gmail connected");
    } else if (flag === "error") {
      toast.error("Couldn’t connect Gmail — please try again.");
    }
    if (flag) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const res = await fetch("/api/auth/google/status");
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        const data = (await res.json()) as GmailStatus;
        if (active) {
          setStatus(data);
          setLoadState("ready");
        }
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    }
    loadStatus();
    return () => {
      active = false;
    };
  }, []);

  function connect() {
    // Full navigation: this route 302-redirects to Google's consent screen.
    window.location.href = "/api/auth/google/connect";
  }

  async function syncInbox() {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/emails/sync", { method: "POST" });
      if (!res.ok) {
        throw new Error(`sync failed (${res.status})`);
      }
      const result = (await res.json()) as SyncResult;
      toast.success(
        `Synced ${result.total} email${result.total === 1 ? "" : "s"} — ${result.needsReview} need review`,
      );
      // Reload so the server-rendered dashboard picks up the new emails.
      window.location.reload();
    } catch {
      toast.error("Couldn’t sync your inbox — please try again.");
      setIsSyncing(false);
    }
  }

  async function disconnect() {
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/auth/google/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`disconnect failed (${res.status})`);
      }
      window.location.reload();
    } catch {
      toast.error("Couldn’t disconnect — please try again.");
      setIsDisconnecting(false);
    }
  }

  return (
    <section
      aria-labelledby="connect-gmail-heading"
      className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--accent-soft)] text-lg text-[var(--accent)]"
        >
          ✉
        </span>

        <div className="min-w-0 flex-1">
          <h2
            id="connect-gmail-heading"
            className="text-base font-semibold tracking-tight text-[var(--ink-900)]"
          >
            Gmail integration
          </h2>

          {loadState === "loading" && (
            <p className="mt-1 text-sm text-[var(--ink-500)]" role="status">
              Checking connection…
            </p>
          )}

          {loadState === "error" && (
            <p className="mt-1 text-sm font-medium text-[var(--priority-high)]" role="status">
              Couldn't check your Gmail connection. Refresh to try again.
            </p>
          )}

          {loadState === "ready" && status && !status.connected && (
            <div className="mt-1">
              <p className="text-sm leading-relaxed text-[var(--ink-700)]">
                Connect your Gmail to triage your real inbox. Read-only — Smart Inbox AI never
                sends, deletes, or modifies your email.
              </p>
              <button
                type="button"
                onClick={connect}
                aria-label="Connect Gmail"
                className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                Connect Gmail
              </button>
            </div>
          )}

          {loadState === "ready" && status?.connected && (
            <div className="mt-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--priority-low-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--priority-low)]">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-[var(--priority-low)]"
                  />
                  Connected
                </span>
                <span className="truncate text-sm font-medium text-[var(--ink-900)]">
                  {status.email}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={syncInbox}
                  disabled={isSyncing || isDisconnecting}
                  aria-label="Sync inbox"
                  className="inline-flex items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSyncing ? "Syncing your inbox…" : "Sync inbox"}
                </button>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={isSyncing || isDisconnecting}
                  aria-label="Disconnect Gmail"
                  className="inline-flex items-center rounded-[var(--radius-chip)] px-3 py-2 text-sm font-medium text-[var(--ink-500)] transition-colors hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>

              {isSyncing && (
                <p className="mt-3 text-sm text-[var(--ink-500)]" role="status">
                  Syncing your inbox… this can take up to a minute.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
