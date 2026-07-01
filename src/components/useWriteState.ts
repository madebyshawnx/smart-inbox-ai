"use client";

import { useEffect, useState } from "react";

/**
 * Gmail write-grant state shared by every Tier 1/3 write action (archive,
 * draft, unsubscribe, bulk cleanup, sender screening).
 *
 *  - "loading"      — probe in flight; don't flash controls yet.
 *  - "ready"        — connected WITH gmail.modify + gmail.compose; actions live.
 *  - "no-write"     — connected but read-only grant; needs reconnect consent.
 *  - "disconnected" — no Gmail account connected at all.
 *  - "error"        — status probe failed; degrade gracefully (let the user try;
 *                     the API routes are the real gate and fail soft).
 */
export type WriteState = "loading" | "ready" | "no-write" | "disconnected" | "error";

type StatusResponse = {
  connected?: boolean;
  canWrite?: boolean;
};

/**
 * Probe `/api/auth/google/status` once on mount and resolve the shared
 * {@link WriteState}. Centralizes the status fetch so every write-capable
 * control gates on the exact same signal instead of duplicating the probe.
 */
export function useWriteState(): WriteState {
  const [writeState, setWriteState] = useState<WriteState>("loading");

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

  return writeState;
}
