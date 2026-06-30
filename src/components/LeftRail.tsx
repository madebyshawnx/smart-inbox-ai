"use client";

import {
  Inbox,
  LogOut,
  Mail,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { bucketTier, type ListSection, type SelectedBucket } from "@/lib/inbox-buckets";
import { tierStyle } from "./priority-style";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type LeftRailProps = {
  sections: ReadonlyArray<ListSection>;
  selectedBucket: SelectedBucket;
  onSelectBucket: (bucket: SelectedBucket) => void;
  totalCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenAsk: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
};

/**
 * Persistent, collapsible left navigation rail. Lists non-empty buckets with
 * live counts and a priority-tier dot, pins Ask near the top and the Gmail
 * account block to the bottom. Collapsing shrinks it to an icon-only strip and
 * the parent persists that state to localStorage.
 */
export function LeftRail({
  sections,
  selectedBucket,
  onSelectBucket,
  totalCount,
  collapsed,
  onToggleCollapse,
  onOpenAsk,
  onOpenSearch,
  onOpenSettings,
}: LeftRailProps) {
  return (
    <nav
      aria-label="Inbox navigation"
      className={`flex h-full shrink-0 flex-col border-r border-[var(--hairline)] bg-[var(--surface-sunken)] transition-[width] duration-200 ease-out ${
        collapsed ? "w-[68px]" : "w-[248px]"
      }`}
    >
      {/* Header: collapse toggle + wordmark */}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-[var(--hairline)] ${
          collapsed ? "justify-center px-0" : "justify-between px-3"
        }`}
      >
        {!collapsed && (
          <span className="flex min-w-0 items-center gap-2 pl-1">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-white shadow-[var(--shadow-sm)]"
            >
              <Mail size={15} strokeWidth={2.25} />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight text-[var(--ink-900)]">
              Smart Inbox
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-chip)] text-[var(--ink-500)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      {/* Scrollable nav body */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
        <AskButton collapsed={collapsed} onOpenAsk={onOpenAsk} />
        <SearchButton collapsed={collapsed} onOpenSearch={onOpenSearch} />

        <div className="my-2 h-px bg-[var(--hairline)]" aria-hidden="true" />

        <BucketItem
          label="All"
          sublabel="Daily brief"
          count={totalCount}
          dotColor="var(--accent)"
          active={selectedBucket === "all"}
          collapsed={collapsed}
          icon={<Inbox size={16} />}
          onSelect={() => onSelectBucket("all")}
        />

        {sections.map((section) => {
          const { accentVar } = tierStyle(bucketTier(section.key));
          return (
            <BucketItem
              key={section.key}
              label={section.label}
              count={section.emails.length}
              dotColor={accentVar}
              active={selectedBucket === section.key}
              collapsed={collapsed}
              onSelect={() => onSelectBucket(section.key)}
            />
          );
        })}
      </div>

      {/* Account/profile block pinned to the bottom */}
      <div className="shrink-0 border-t border-[var(--hairline)] p-2">
        <AccountBlock collapsed={collapsed} onOpenSettings={onOpenSettings} />
      </div>
    </nav>
  );
}

type AskButtonProps = {
  collapsed: boolean;
  onOpenAsk: () => void;
};

function AskButton({ collapsed, onOpenAsk }: AskButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpenAsk}
      aria-label="Ask your inbox"
      title={collapsed ? "Ask your inbox" : undefined}
      className={`flex items-center rounded-[var(--radius-chip)] border border-[var(--hairline)] text-sm font-medium text-[var(--ink-700)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        collapsed ? "h-9 w-9 justify-center self-center" : "w-full gap-2 px-3 py-2"
      }`}
    >
      <Sparkles size={16} />
      {!collapsed && <span>Ask your inbox</span>}
    </button>
  );
}

type SearchButtonProps = {
  collapsed: boolean;
  onOpenSearch: () => void;
};

function SearchButton({ collapsed, onOpenSearch }: SearchButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpenSearch}
      aria-label="Search emails and actions"
      title={collapsed ? "Search (⌘K)" : undefined}
      className={`flex items-center rounded-[var(--radius-chip)] text-sm font-medium text-[var(--ink-500)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        collapsed ? "h-9 w-9 justify-center self-center" : "w-full gap-2 px-3 py-2"
      }`}
    >
      <Search size={16} />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-[0.7rem] tracking-wide text-[var(--ink-500)]">⌘K</kbd>
        </>
      )}
    </button>
  );
}

type BucketItemProps = {
  label: string;
  sublabel?: string;
  count: number;
  dotColor: string;
  active: boolean;
  collapsed: boolean;
  icon?: ReactNode;
  onSelect: () => void;
};

function BucketItem({
  label,
  sublabel,
  count,
  dotColor,
  active,
  collapsed,
  icon,
  onSelect,
}: BucketItemProps) {
  if (collapsed) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger
            onClick={onSelect}
            aria-current={active ? "true" : undefined}
            aria-label={`${label} (${count})`}
            className={`relative flex h-9 w-9 items-center justify-center self-center rounded-[var(--radius-chip)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface)]"
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: dotColor }}
            />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] rounded-full bg-[var(--ink-900)] px-1 text-center text-[0.6rem] font-semibold leading-[16px] text-[var(--surface)]">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent side="right">
            {label} · {count}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`group relative flex w-full items-center gap-2.5 rounded-[var(--radius-chip)] px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${
        active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface)]"
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-0 w-[3px] rounded-r bg-[var(--accent)]"
        />
      )}
      {icon ? (
        <span aria-hidden="true" className="text-sm text-[var(--accent)]">
          {icon}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[0.85rem] ${
            active ? "font-semibold text-[var(--ink-900)]" : "font-medium text-[var(--ink-700)]"
          }`}
        >
          {label}
        </span>
        {sublabel && (
          <span className="block truncate text-[0.7rem] text-[var(--ink-500)]">{sublabel}</span>
        )}
      </span>
      <span
        className={`shrink-0 rounded-full px-1.5 text-[0.7rem] font-semibold tabular-nums ${
          active ? "text-[var(--accent)]" : "text-[var(--ink-500)]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

type GmailStatus = { connected: false } | { connected: true; email: string; connectedAt: string };

type AccountBlockProps = {
  collapsed: boolean;
  onOpenSettings: () => void;
};

/**
 * Bottom-pinned Gmail account block. Shows an initials avatar + connected
 * address with a small menu (Settings / Disconnect), or a Connect Gmail CTA
 * when no account is linked. Disconnect IS the sign-out today (no real auth).
 */
function AccountBlock({ collapsed, onOpenSettings }: AccountBlockProps) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/google/status")
      .then((res) => (res.ok ? res.json() : { connected: false }))
      .then((data: GmailStatus) => {
        if (active) {
          setStatus(data);
        }
      })
      .catch(() => {
        if (active) {
          setStatus({ connected: false });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function disconnect() {
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
      if (!res.ok) {
        throw new Error(`disconnect failed (${res.status})`);
      }
      window.location.reload();
    } catch {
      toast.error("Couldn’t disconnect — please try again.");
      setIsDisconnecting(false);
    }
  }

  // Loading: a quiet placeholder so layout doesn't jump.
  if (status === null) {
    return (
      <div
        className={`flex items-center ${collapsed ? "justify-center" : "gap-2 px-1"} py-1.5`}
        role="status"
        aria-label="Checking Gmail connection"
      >
        <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--surface)]" />
        {!collapsed && <span className="h-3 w-24 animate-pulse rounded bg-[var(--surface)]" />}
      </div>
    );
  }

  // Not connected: Connect Gmail CTA.
  if (!status.connected) {
    return (
      <button
        type="button"
        onClick={() => {
          window.location.href = "/api/auth/google/connect";
        }}
        aria-label="Connect Gmail"
        title={collapsed ? "Connect Gmail" : undefined}
        className={`flex items-center rounded-[var(--radius-chip)] bg-[var(--accent)] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
          collapsed
            ? "h-9 w-9 justify-center self-center"
            : "w-full justify-center gap-2 px-3 py-2.5 text-sm"
        }`}
      >
        <Mail size={16} />
        {!collapsed && <span>Connect Gmail</span>}
      </button>
    );
  }

  const initials = deriveInitials(status.email);

  // Collapsed rail: avatar opens a Radix DropdownMenu (keyboard, focus, and
  // dismissal handled by the primitive — no hand-rolled popover state).
  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Account: ${status.email}`}
          className="flex h-10 w-10 items-center justify-center self-center rounded-[var(--radius-chip)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] data-[state=open]:bg-[var(--surface)]"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white"
          >
            {initials}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuLabel>
            <span className="block truncate text-xs font-medium text-[var(--ink-900)]">
              {status.email}
            </span>
            <span className="block text-[0.7rem] text-[var(--ink-500)]">Gmail connected</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings size={15} /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              disconnect();
            }}
            disabled={isDisconnecting}
            className="text-[var(--priority-high)] data-[highlighted]:bg-[var(--priority-high-soft)] data-[highlighted]:text-[var(--priority-high)]"
          >
            <LogOut size={15} />
            {isDisconnecting ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Expanded rail: identity + directly-visible Settings / Sign out buttons, so
  // signing out (= disconnecting Gmail) is never hidden behind a menu.
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 px-2 pt-1">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8rem] font-medium text-[var(--ink-900)]">
            {status.email}
          </span>
          <span className="block text-[0.7rem] text-[var(--ink-500)]">Gmail connected</span>
        </span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--hairline)] px-2 py-1.5 text-xs font-medium text-[var(--ink-700)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Settings size={15} /> Settings
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={isDisconnecting}
          aria-label="Sign out (disconnect Gmail)"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] border border-[var(--priority-high)] px-2 py-1.5 text-xs font-medium text-[var(--priority-high)] transition-colors hover:bg-[var(--priority-high-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--priority-high)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut size={15} />
          {isDisconnecting ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

// First 1-2 alphanumeric chars of the email's local part, uppercased.
function deriveInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const letters = local.replace(/[^a-zA-Z0-9]/g, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}
