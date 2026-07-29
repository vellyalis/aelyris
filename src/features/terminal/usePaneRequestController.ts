import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PaneAttachRequest,
  PaneCloseRequest,
  PaneFocusRequest,
  PaneLayoutCommand,
  PaneLayoutRequest,
  PaneRenameRequest,
  PaneRestartRequest,
  PaneRoleCycleRequest,
} from "./pane-tree/PaneTreeContainer";

type Routed<T> = T & { tabId: string };
type PaneRequestCompletion = (error: string | null) => void;
type CompletableRouted<T> = Routed<T> & { onComplete: PaneRequestCompletion };

export type PaneRequestCancellationReason = "superseded" | "tab-removed" | "tab-unavailable" | "timeout" | "unmounted";

export class PaneRequestCancelledError extends Error {
  readonly code = "PANE_REQUEST_CANCELLED";

  constructor(readonly reason: PaneRequestCancellationReason) {
    super(`Pane request cancelled: ${reason}.`);
    this.name = "PaneRequestCancelledError";
  }
}

export type PaneFocusOutcome =
  | { status: "focused" }
  | { status: "failed"; error: Error }
  | { status: "cancelled"; error: PaneRequestCancelledError };

interface PendingFocusRequest {
  cancel: (reason: PaneRequestCancellationReason) => void;
  tabId: string;
}

interface UsePaneRequestControllerOptions {
  activeTabId: string;
  handleTabSwitch: (tabId: string) => Promise<boolean>;
  interactiveSessionId: string | null;
  /** Required by the A6.2e4 callsite to cancel accepted work when its tab is removed. */
  liveTabIds?: readonly string[];
  /** Test seam and lifecycle bound; production uses the conservative default. */
  requestTimeoutMs?: number;
  selectInteractiveSession: (sessionId: string) => void;
}

interface SerializedEntry<TInput> {
  beforeDispatch?: () => Promise<boolean>;
  dispatched: boolean;
  input: TInput;
  reject: (error: Error) => void;
  released: boolean;
  resolve: () => void;
  sequence: number;
  settled: boolean;
  tabId: string;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface UseSerializedPaneRequestOptions<TInput, TRequest extends { sequence: number }> {
  buildRequest: (input: TInput, sequence: number, onComplete: PaneRequestCompletion) => TRequest;
  liveTabIds?: readonly string[];
  requestTimeoutMs: number;
}

/**
 * One scheduling mechanism instantiated once per pane request kind. Each instance
 * admits one active item and preserves every accepted item behind it in FIFO order.
 */
function useSerializedPaneRequest<TInput, TRequest extends { sequence: number }>({
  buildRequest,
  liveTabIds,
  requestTimeoutMs,
}: UseSerializedPaneRequestOptions<TInput, TRequest>) {
  const [request, setRequest] = useState<CompletableRouted<TRequest> | null>(null);
  const activeRef = useRef<SerializedEntry<TInput> | null>(null);
  const buildRequestRef = useRef(buildRequest);
  const mountedRef = useRef(true);
  const pumpRef = useRef<() => void>(() => undefined);
  const queueRef = useRef<Array<SerializedEntry<TInput>>>([]);
  const sequenceRef = useRef(0);
  buildRequestRef.current = buildRequest;

  const settle = useCallback((entry: SerializedEntry<TInput>, error: Error | null, release = true) => {
    if (!entry.settled) {
      entry.settled = true;
      clearTimeout(entry.timeoutId);
      if (error) entry.reject(error);
      else entry.resolve();
    }
    if (!release || entry.released) return;
    entry.released = true;

    const queue = queueRef.current;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (activeRef.current === entry) {
      activeRef.current = null;
      if (mountedRef.current) {
        setRequest((current) => (current?.sequence === entry.sequence ? null : current));
      }
    }

    if (mountedRef.current) queueMicrotask(() => pumpRef.current());
  }, []);

  pumpRef.current = () => {
    if (!mountedRef.current || activeRef.current) return;
    const entry = queueRef.current[0];
    if (!entry || entry.released) return;
    activeRef.current = entry;
    void Promise.resolve(entry.beforeDispatch?.() ?? true)
      .then((available) => {
        if (entry.released || activeRef.current !== entry || !mountedRef.current) return;
        if (!available) {
          settle(entry, new PaneRequestCancelledError("tab-unavailable"));
          return;
        }
        const onComplete: PaneRequestCompletion = (error) => {
          settle(entry, error ? new Error(error) : null);
        };
        entry.dispatched = true;
        setRequest({
          ...buildRequestRef.current(entry.input, entry.sequence, onComplete),
          onComplete,
          tabId: entry.tabId,
        });
      })
      .catch((error) => {
        settle(entry, error instanceof Error ? error : new Error(String(error)));
      });
  };

  const enqueue = useCallback(
    (tabId: string, input: TInput, beforeDispatch?: () => Promise<boolean>): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        sequenceRef.current += 1;
        const entry: SerializedEntry<TInput> = {
          beforeDispatch,
          dispatched: false,
          input,
          reject,
          released: false,
          resolve,
          sequence: sequenceRef.current,
          settled: false,
          tabId,
          timeoutId: setTimeout(() => {
            settle(entry, new PaneRequestCancelledError("timeout"), !entry.dispatched);
          }, requestTimeoutMs),
        };
        queueRef.current.push(entry);
        pumpRef.current();
      }),
    [requestTimeoutMs, settle],
  );

  useEffect(() => {
    if (!liveTabIds) return;
    const live = new Set(liveTabIds);
    for (const entry of [...queueRef.current]) {
      if (!live.has(entry.tabId)) {
        settle(entry, new PaneRequestCancelledError("tab-removed"), !entry.dispatched);
      }
    }
  }, [liveTabIds, settle]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const entry of [...queueRef.current]) {
        settle(entry, new PaneRequestCancelledError("unmounted"));
      }
    };
  }, [settle]);

  return { enqueue, request };
}

function ignoreSettlement(promise: Promise<void>) {
  void promise.catch(() => {
    // Fire-and-forget pane intents still settle internally; user-facing promise
    // consumers exist only for restart and attach.
  });
}

export function usePaneRequestController({
  activeTabId,
  handleTabSwitch,
  interactiveSessionId,
  liveTabIds,
  requestTimeoutMs = 15_000,
  selectInteractiveSession,
}: UsePaneRequestControllerOptions) {
  const mountedRef = useRef(true);
  const focusGenerationRef = useRef(0);
  const focusPendingRef = useRef<PendingFocusRequest | null>(null);
  const focusSequenceRef = useRef(0);
  const [paneFocusRequest, setPaneFocusRequest] = useState<Routed<PaneFocusRequest> | null>(null);

  const close = useSerializedPaneRequest<{ paneId: string }, PaneCloseRequest>({
    buildRequest: ({ paneId }, sequence) => ({ paneId, sequence }),
    liveTabIds,
    requestTimeoutMs,
  });
  const restart = useSerializedPaneRequest<{ paneId: string }, PaneRestartRequest>({
    buildRequest: ({ paneId }, sequence, onComplete) => ({ onComplete, paneId, sequence }),
    liveTabIds,
    requestTimeoutMs,
  });
  const attach = useSerializedPaneRequest<{ paneId: string; terminalId: string }, PaneAttachRequest>({
    buildRequest: ({ paneId, terminalId }, sequence, onComplete) => ({
      onComplete,
      paneId,
      sequence,
      terminalId,
    }),
    liveTabIds,
    requestTimeoutMs,
  });
  const rename = useSerializedPaneRequest<{ paneId: string; title: string | null }, PaneRenameRequest>({
    buildRequest: ({ paneId, title }, sequence) => ({ paneId, sequence, title }),
    liveTabIds,
    requestTimeoutMs,
  });
  const role = useSerializedPaneRequest<{ paneId: string }, PaneRoleCycleRequest>({
    buildRequest: ({ paneId }, sequence) => ({ paneId, sequence }),
    liveTabIds,
    requestTimeoutMs,
  });
  const layout = useSerializedPaneRequest<{ command: PaneLayoutCommand }, PaneLayoutRequest>({
    buildRequest: ({ command }, sequence) => ({ command, sequence }),
    liveTabIds,
    requestTimeoutMs,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusGenerationRef.current += 1;
      focusPendingRef.current?.cancel("unmounted");
    };
  }, []);

  useEffect(() => {
    if (!liveTabIds) return;
    const pending = focusPendingRef.current;
    if (pending && !liveTabIds.includes(pending.tabId)) pending.cancel("tab-removed");
    if (paneFocusRequest && !liveTabIds.includes(paneFocusRequest.tabId)) setPaneFocusRequest(null);
  }, [liveTabIds, paneFocusRequest]);

  const switchToTarget = useCallback(
    async (tabId: string) => (tabId === activeTabId ? true : handleTabSwitch(tabId)),
    [activeTabId, handleTabSwitch],
  );

  const handlePaneSwitch = useCallback(
    (tabId: string, paneId: string): Promise<PaneFocusOutcome> => {
      focusPendingRef.current?.cancel("superseded");
      focusGenerationRef.current += 1;
      const generation = focusGenerationRef.current;
      focusSequenceRef.current += 1;
      const sequence = focusSequenceRef.current;
      return new Promise<PaneFocusOutcome>((resolve) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout>;
        let pending!: PendingFocusRequest;
        const finish = (outcome: PaneFocusOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (focusPendingRef.current === pending) focusPendingRef.current = null;
          setPaneFocusRequest((current) => (current?.sequence === sequence ? null : current));
          resolve(outcome);
        };
        pending = {
          cancel: (reason) => finish({ status: "cancelled", error: new PaneRequestCancelledError(reason) }),
          tabId,
        };
        focusPendingRef.current = pending;
        timeoutId = setTimeout(() => pending.cancel("timeout"), requestTimeoutMs);

        void switchToTarget(tabId)
          .then((available) => {
            if (settled) return;
            if (!available) {
              pending.cancel("tab-unavailable");
              return;
            }
            // Focus is the sole latest-wins kind: a slower earlier tab transition
            // may never overwrite a later operator focus choice.
            if (!mountedRef.current || generation !== focusGenerationRef.current) {
              pending.cancel(mountedRef.current ? "superseded" : "unmounted");
              return;
            }
            if (interactiveSessionId) selectInteractiveSession("");
            setPaneFocusRequest({
              tabId,
              paneId,
              sequence,
              onComplete: (error) =>
                finish(error ? { status: "failed", error: new Error(error) } : { status: "focused" }),
            });
          })
          .catch(() => pending.cancel("tab-unavailable"));
      });
    },
    [interactiveSessionId, requestTimeoutMs, selectInteractiveSession, switchToTarget],
  );

  const applyPaneLayoutCommand = useCallback(
    (command: PaneLayoutCommand, tabId = activeTabId) => {
      ignoreSettlement(layout.enqueue(tabId, { command }));
    },
    [activeTabId, layout.enqueue],
  );

  const handlePaneClose = useCallback(
    (tabId: string, paneId: string) => {
      ignoreSettlement(close.enqueue(tabId, { paneId }));
    },
    [close.enqueue],
  );

  const handlePaneRestart = useCallback(
    async (tabId: string, paneId: string) => {
      await restart.enqueue(tabId, { paneId }, () => switchToTarget(tabId));
    },
    [restart.enqueue, switchToTarget],
  );

  const handlePaneAttach = useCallback(
    async (tabId: string, paneId: string, terminalId: string) => {
      await attach.enqueue(tabId, { paneId, terminalId }, () => switchToTarget(tabId));
    },
    [attach.enqueue, switchToTarget],
  );

  const handlePaneRename = useCallback(
    async (tabId: string, paneId: string, title: string | null) => {
      ignoreSettlement(rename.enqueue(tabId, { paneId, title }, () => switchToTarget(tabId)));
    },
    [rename.enqueue, switchToTarget],
  );

  const handlePaneRoleCycle = useCallback(
    async (tabId: string, paneId: string) => {
      ignoreSettlement(role.enqueue(tabId, { paneId }, () => switchToTarget(tabId)));
    },
    [role.enqueue, switchToTarget],
  );

  return {
    applyPaneLayoutCommand,
    handlePaneAttach,
    handlePaneClose,
    handlePaneRename,
    handlePaneRestart,
    handlePaneRoleCycle,
    handlePaneSwitch,
    paneAttachRequest: attach.request,
    paneCloseRequest: close.request,
    paneFocusRequest,
    paneLayoutRequest: layout.request,
    paneRenameRequest: rename.request,
    paneRestartRequest: restart.request,
    paneRoleCycleRequest: role.request,
  };
}
