import { useEffect, useRef } from "react";
import { PRODUCT_NAME } from "../constants/product";
import type { AgentFleetSession } from "../lib/agentFleet";
import type { AgentRunStatus } from "../types/agentStatus";
import { sendWindowsNotification } from "./useTerminalNotifications";

/**
 * Canonical run-status transitions worth a native OS notification: a session
 * that has become blocked on a human decision, finished, or errored. These are
 * the "you should look" signals, so — unlike the noisy bell path — they fire
 * regardless of window focus. The legacy `status` field collapses
 * `waiting_approval`/`blocked` into `waiting`, so we diff on `runStatus`.
 */
const TOAST_STATUSES = new Set<AgentRunStatus>(["waiting_approval", "done", "error"]);

/** Per-session throttle so a session flapping between states cannot spam toasts. */
const MIN_TOAST_INTERVAL_MS = 30_000;

function toastBody(session: AgentFleetSession): string {
  switch (session.runStatus) {
    case "waiting_approval":
      return `${session.name} needs approval ✦`;
    case "done":
      return `${session.name} finished ✦`;
    case "error":
      return `${session.name} hit an error ✦`;
    default:
      return `${session.name} updated ✦`;
  }
}

/**
 * Watches the unified agent fleet and fires a native toast each time a session
 * transitions INTO a noteworthy run status (waiting_approval/done/error).
 *
 * Pass `useAgentFleet().fleetSessions` (not `.sessions` — only the fleet
 * projection carries the canonical `runStatus`). The first observed snapshot is
 * seeded silently so app start / session restore does not produce a toast burst;
 * only genuine prev→next transitions toast thereafter.
 */
export function useAgentFleetToasts(sessions: AgentFleetSession[]): void {
  const prevStatuses = useRef<Map<string, AgentRunStatus>>(new Map());
  const seeded = useRef(false);
  const lastToastAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const next = new Map(sessions.map((session) => [session.id, session.runStatus] as const));

    // Seed silently on the first snapshot: sessions restored already-done/errored
    // must not toast on mount.
    if (!seeded.current) {
      prevStatuses.current = next;
      seeded.current = true;
      return;
    }

    const now = Date.now();
    for (const session of sessions) {
      const prev = prevStatuses.current.get(session.id);
      if (prev === session.runStatus) continue;
      if (!TOAST_STATUSES.has(session.runStatus)) continue;

      const last = lastToastAt.current.get(session.id);
      if (last !== undefined && now - last < MIN_TOAST_INTERVAL_MS) continue;
      lastToastAt.current.set(session.id, now);

      void sendWindowsNotification(PRODUCT_NAME, toastBody(session));
    }

    prevStatuses.current = next;
  }, [sessions]);
}
