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
 * Both `waiting_approval` and `blocked` are operator-attention states (the rail
 * counts both as "needs attention"), so both toast.
 */
const TOAST_STATUSES = new Set<AgentRunStatus>(["waiting_approval", "blocked", "done", "error"]);

/** Per-session throttle so a session flapping between states cannot spam toasts. */
const MIN_TOAST_INTERVAL_MS = 30_000;

function toastBody(session: AgentFleetSession): string {
  switch (session.runStatus) {
    case "waiting_approval":
      return `${session.name} needs approval ✦`;
    case "blocked":
      return `${session.name} is blocked ✦`;
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
 * transitions INTO a noteworthy run status (waiting_approval/blocked/done/error).
 *
 * Pass `useAgentFleet().fleetSessions` (not `.sessions` — only the fleet
 * projection carries the canonical `runStatus`). A toast fires ONLY for a
 * genuine transition of an already-observed session. A session seen for the
 * first time — whether in the initial snapshot or added later by async session
 * restore — is recorded silently, so app start / restore never bursts
 * notifications (the first snapshot can legitimately be empty before restore
 * lands, so a render-count seed is not enough).
 */
export function useAgentFleetToasts(sessions: AgentFleetSession[]): void {
  const prevStatuses = useRef<Map<string, AgentRunStatus>>(new Map());
  const lastToastAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const prev = prevStatuses.current;
    const now = Date.now();
    const seenIds = new Set<string>();

    for (const session of sessions) {
      seenIds.add(session.id);
      const before = prev.get(session.id);
      const after = session.runStatus;
      // First time we observe this id (initial snapshot OR async restore):
      // record it silently — only a later status change toasts.
      if (before === undefined || before === after) continue;
      if (!TOAST_STATUSES.has(after)) continue;

      const last = lastToastAt.current.get(session.id);
      if (last !== undefined && now - last < MIN_TOAST_INTERVAL_MS) continue;
      lastToastAt.current.set(session.id, now);

      void sendWindowsNotification(PRODUCT_NAME, toastBody(session));
    }

    prevStatuses.current = new Map(sessions.map((session) => [session.id, session.runStatus] as const));
    // Drop throttle entries for sessions that have left the fleet so the map
    // can't grow without bound across a long-lived session.
    for (const id of lastToastAt.current.keys()) {
      if (!seenIds.has(id)) lastToastAt.current.delete(id);
    }
  }, [sessions]);
}
