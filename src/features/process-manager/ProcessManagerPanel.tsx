import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { MousePointer2, PlugZap, Power, RotateCcw, SquareActivity, Terminal, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TerminalPaneTarget } from "../../shared/types/terminalPane";
import type { Invoke } from "../../shared/hooks/useLogStream";
import { toast } from "../../shared/store/toastStore";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import type { PaneLifecycleState } from "../terminal/pane-tree";
import styles from "./ProcessManagerPanel.module.css";

interface ProcessManagerPanelProps {
  panes: TerminalPaneTarget[];
  activeTerminalId: string | null;
  invoke?: Invoke;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onClosePane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onAttachProcess?: (tabId: string, paneId: string, terminalId: string) => void | Promise<void>;
  onProcessEnded?: (terminalId: string) => void;
  highlightedPaneId?: string | null;
  highlightedTerminalId?: string | null;
}

interface ProcessView {
  key: string;
  terminalId: string | null;
  paneId: string;
  tabId: string;
  name: string;
  shell: string;
  cwd: string;
  route: string;
  active: boolean;
  lifecycle: PaneLifecycleState;
}

type ProcessState = "active" | "running" | "starting" | "detached" | "orphaned" | "ended" | "restarting" | "failed";

const PROCESS_ROW_LIMIT = 5;

export function ProcessManagerPanel({
  panes,
  activeTerminalId,
  invoke,
  onFocusPane,
  onClosePane,
  onRestartPane,
  onAttachProcess,
  onProcessEnded,
  highlightedPaneId = null,
  highlightedTerminalId = null,
}: ProcessManagerPanelProps) {
  const [ending, setEnding] = useState<string | null>(null);
  const [restartingPaneKeys, setRestartingPaneKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [endedPaneKeys, setEndedPaneKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [failedPaneMessages, setFailedPaneMessages] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pendingActionKeys, setPendingActionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedAttachTargetKeys, setSelectedAttachTargetKeys] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const processesRef = useRef<ProcessView[]>([]);
  const actionLocksRef = useRef(new Set<string>());
  const processes = useMemo(
    () => panes.map((pane) => toProcessView(pane, activeTerminalId)),
    [activeTerminalId, panes],
  );
  const highlightedKey = useMemo(
    () =>
      processes.find((process) => isHighlightedProcess(process, highlightedPaneId, highlightedTerminalId))?.key ?? null,
    [highlightedPaneId, highlightedTerminalId, processes],
  );
  const highlightedProcess = useMemo(
    () => processes.find((process) => process.key === highlightedKey) ?? null,
    [highlightedKey, processes],
  );
  const visibleProcesses = useMemo(
    () => prioritizeVisibleProcesses(processes, highlightedKey, PROCESS_ROW_LIMIT),
    [highlightedKey, processes],
  );
  const stateForCount = (process: ProcessView) =>
    processState(process, endedPaneKeys, restartingPaneKeys, failedPaneMessages);
  const readyCount = processes.filter((process) => countsAsLiveProcess(process, stateForCount(process))).length;
  const activeCount = processes.filter(
    (process) => process.active && countsAsLiveProcess(process, stateForCount(process)),
  ).length;
  const activeProcess = processes.find((process) => process.active && process.terminalId) ?? null;
  const activeProcessState = activeProcess
    ? processState(activeProcess, endedPaneKeys, restartingPaneKeys, failedPaneMessages)
    : null;
  const recoveryProcess =
    processes.find(
      (process) =>
        onRestartPane &&
        process.terminalId &&
        (endedPaneKeys.has(process.key) ||
          failedPaneMessages.has(process.key) ||
          process.lifecycle === "exited" ||
          process.lifecycle === "crashed"),
    ) ?? null;
  const attachCandidatesByOrphanKey = useMemo(
    () => buildAttachCandidates(processes, Boolean(onAttachProcess)),
    [onAttachProcess, processes],
  );
  const canClosePane = processes.length > 1 && Boolean(onClosePane);

  useEffect(() => {
    if (!highlightedKey) return;
    rowRefs.current.get(highlightedKey)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlightedKey]);

  useEffect(() => {
    processesRef.current = processes;
  }, [processes]);

  useEffect(() => {
    const liveKeys = new Set(processes.map((process) => process.key));
    setEndedPaneKeys((prev) => filterSetByKeys(prev, liveKeys));
    setRestartingPaneKeys((prev) => filterSetByKeys(prev, liveKeys));
    setFailedPaneMessages((prev) => filterMapByKeys(prev, liveKeys));
    setSelectedAttachTargetKeys((prev) => {
      const next = new Map<string, string>();
      for (const [orphanKey, targetKey] of prev) {
        const candidates = attachCandidatesByOrphanKey.get(orphanKey) ?? [];
        if (candidates.some((candidate) => candidate.key === targetKey)) {
          next.set(orphanKey, targetKey);
        }
      }
      return next.size === prev.size && [...next].every(([key, value]) => prev.get(key) === value) ? prev : next;
    });
  }, [attachCandidatesByOrphanKey, processes]);

  const resolveAttachTarget = (process: ProcessView): ProcessView | null => {
    const candidates = attachCandidatesByOrphanKey.get(process.key) ?? [];
    if (candidates.length === 1) return candidates[0];
    const selectedKey = selectedAttachTargetKeys.get(process.key);
    return candidates.find((candidate) => candidate.key === selectedKey) ?? null;
  };

  const selectAttachTarget = useCallback((process: ProcessView, targetKey: string) => {
    setSelectedAttachTargetKeys((prev) => {
      const next = new Map(prev);
      if (targetKey) {
        next.set(process.key, targetKey);
      } else {
        next.delete(process.key);
      }
      return next;
    });
  }, []);

  const resolveLiveProcess = (process: ProcessView): ProcessView | null =>
    processesRef.current.find((item) => item.key === process.key) ?? null;

  const runExclusive = async (key: string, task: () => Promise<void>) => {
    if (actionLocksRef.current.has(key)) return;
    actionLocksRef.current.add(key);
    setPendingActionKeys((prev) => new Set(prev).add(key));
    try {
      await task();
    } finally {
      actionLocksRef.current.delete(key);
      setPendingActionKeys((prev) => setWithoutKey(prev, key));
    }
  };

  const endProcess = async (process: ProcessView) => {
    if (!process.terminalId) {
      toast.error("Process is still starting", "Wait for a terminal id before ending it.");
      return;
    }
    const targetTerminalId = process.terminalId;

    await runExclusive(process.key, async () => {
      const ok = await showConfirm({
        title: "End terminal process",
        description:
          process.lifecycle === "orphaned"
            ? `End orphaned backend session ${process.name} (${shortId(targetTerminalId)})? This cleans up the process without changing the pane layout.`
            : `End ${process.name} (${shortId(targetTerminalId)})? Unsaved shell state and running commands in that pane will stop.`,
        confirmLabel: "End Process",
        tone: "danger",
      });
      if (!ok) return;

      const liveProcess = resolveLiveProcess(process);
      if (!liveProcess?.terminalId || liveProcess.terminalId !== targetTerminalId) {
        toast.error("End target changed", "The selected process changed before it could be ended.");
        return;
      }

      setEnding(liveProcess.terminalId);
      setError(null);
      setFailedPaneMessages((prev) => mapWithoutKey(prev, liveProcess.key));
      try {
        const call = invoke ?? (await Promise.resolve({ invoke: tauriInvoke })).invoke;
        await call("close_terminal", { id: liveProcess.terminalId });
        setEndedPaneKeys((prev) => new Set(prev).add(liveProcess.key));
        onProcessEnded?.(liveProcess.terminalId);
        toast.success("Process ended", liveProcess.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error("End process failed", message);
      } finally {
        setEnding(null);
      }
    });
  };

  const closePane = async (process: ProcessView) => {
    if (process.lifecycle === "orphaned") {
      toast.error("Pane close is unavailable", "Orphaned sessions are not attached to a pane layout.");
      return;
    }
    if (!onClosePane) {
      toast.error("Pane close is unavailable", "This process view is not connected to the pane tree.");
      return;
    }

    await runExclusive(process.key, async () => {
      const ok = await showConfirm({
        title: "Close terminal pane",
        description: process.terminalId
          ? `Close ${process.name}? Its running shell process will be ended and the pane will be removed from the layout.`
          : `Remove ${process.name} from the pane layout?`,
        confirmLabel: "Close Pane",
        tone: process.terminalId ? "danger" : "default",
      });
      if (!ok) return;

      const liveProcess = resolveLiveProcess(process);
      if (!liveProcess) {
        toast.error("Close target changed", "The pane was already removed.");
        return;
      }
      setError(null);
      try {
        await onClosePane(liveProcess.tabId, liveProcess.paneId);
        setEndedPaneKeys((prev) => setWithoutKey(prev, liveProcess.key));
        setRestartingPaneKeys((prev) => setWithoutKey(prev, liveProcess.key));
        setFailedPaneMessages((prev) => mapWithoutKey(prev, liveProcess.key));
      } catch (err) {
        const message = toErrorMessage(err);
        setError(message);
        toast.error("Close pane failed", message);
      }
    });
  };

  const restartPane = async (process: ProcessView) => {
    if (process.lifecycle === "orphaned") {
      toast.error("Restart is unavailable", "Orphaned sessions must be ended or attached by a future recovery flow.");
      return;
    }
    if (!onRestartPane) {
      toast.error("Restart is unavailable", "This pane does not have a terminal process to restart.");
      return;
    }

    await runExclusive(process.key, async () => {
      const ok = await showConfirm({
        title: "Restart terminal shell",
        description: `Restart ${process.name}? The existing shell process will be replaced in the same pane without changing the pane layout.`,
        confirmLabel: "Restart",
        tone: "default",
      });
      if (!ok) return;

      const liveProcess = resolveLiveProcess(process);
      const liveState = liveProcess
        ? processState(liveProcess, endedPaneKeys, restartingPaneKeys, failedPaneMessages)
        : null;
      if (!liveProcess || !liveState || !canRestartProcess(liveProcess, liveState)) {
        toast.error("Restart target changed", "The pane was removed or is not restartable.");
        return;
      }

      setRestartingPaneKeys((prev) => new Set(prev).add(liveProcess.key));
      setFailedPaneMessages((prev) => mapWithoutKey(prev, liveProcess.key));
      setError(null);
      try {
        await onRestartPane(liveProcess.tabId, liveProcess.paneId);
        setEndedPaneKeys((prev) => setWithoutKey(prev, liveProcess.key));
        toast.success("Process restarted", liveProcess.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFailedPaneMessages((prev) => new Map(prev).set(liveProcess.key, message));
        setError(message);
        toast.error("Restart failed", message);
      } finally {
        setRestartingPaneKeys((prev) => setWithoutKey(prev, liveProcess.key));
      }
    });
  };

  const attachProcess = async (process: ProcessView) => {
    if (!onAttachProcess || !process.terminalId) {
      toast.error("Attach is unavailable", "This process view is not connected to pane recovery.");
      return;
    }
    const target = resolveAttachTarget(process);
    if (!target) {
      toast.error("Attach is unavailable", "Choose a detached pane before attaching this session.");
      return;
    }

    await runExclusive(process.key, async () => {
      const ok = await showConfirm({
        title: "Attach terminal process",
        description: `Attach ${process.name} (${shortId(process.terminalId ?? "")}) to ${target.name}? The existing backend shell will resume in that pane.`,
        confirmLabel: "Attach",
        tone: "default",
      });
      if (!ok) return;

      const liveProcess = resolveLiveProcess(process);
      const liveTarget = processesRef.current.find((item) => item.key === target.key);
      if (
        !liveProcess?.terminalId ||
        liveProcess.terminalId !== process.terminalId ||
        liveProcess.lifecycle !== "orphaned" ||
        !liveTarget ||
        liveTarget.lifecycle !== "detached" ||
        liveTarget.terminalId
      ) {
        toast.error("Attach target changed", "The detached pane or backend session changed before attach.");
        return;
      }

      setError(null);
      setFailedPaneMessages((prev) => mapWithoutKey(prev, liveProcess.key));
      try {
        await onAttachProcess(liveTarget.tabId, liveTarget.paneId, liveProcess.terminalId);
        setEndedPaneKeys((prev) => setWithoutKey(prev, liveProcess.key));
        toast.success("Process attached", liveTarget.name);
      } catch (err) {
        const message = toErrorMessage(err);
        setError(message);
        toast.error("Attach failed", message);
      }
    });
  };

  const focusProcess = async (process: ProcessView) => {
    if (process.lifecycle === "orphaned") {
      toast.error("Focus is unavailable", "Orphaned sessions are not attached to a pane layout.");
      return;
    }
    if (!onFocusPane) return;

    await runExclusive(process.key, async () => {
      const liveProcess = resolveLiveProcess(process);
      if (!liveProcess) {
        toast.error("Focus target changed", "The pane was already removed.");
        return;
      }
      setError(null);
      try {
        await onFocusPane(liveProcess.tabId, liveProcess.paneId);
      } catch (err) {
        const message = toErrorMessage(err);
        setError(message);
        toast.error("Focus pane failed", message);
      }
    });
  };

  return (
    <section className={styles.panel} aria-label="Terminal process manager">
      <PanelHeader
        title="Processes"
        subtitle="live shells"
        leadingIcon={<SquareActivity size={12} />}
        count={processes.length || undefined}
        actions={
          <span className={styles.headerActions}>
            <span className={styles.id}>{readyCount} live</span>
            {activeProcess && (
              <button
                type="button"
                className={styles.headerKillBtn}
                title={`End active process: ${activeProcess.name}`}
                aria-label={`End active process ${activeProcess.name}`}
                disabled={
                  ending === activeProcess.terminalId ||
                  pendingActionKeys.has(activeProcess.key) ||
                  activeProcessState === "ended" ||
                  activeProcessState === "restarting"
                }
                onClick={() => void endProcess(activeProcess)}
              >
                <Power size={11} aria-hidden="true" />
                <span>End</span>
              </button>
            )}
          </span>
        }
      />

      <div className={styles.body}>
        <fieldset className={styles.summary} aria-label="Process summary">
          <Metric label="Live" value={readyCount} />
          <Metric label="Active" value={activeCount} />
          <Metric label="Tabs" value={new Set(processes.map((process) => process.tabId)).size} />
        </fieldset>

        {error && <div className={styles.error}>{error}</div>}
        {highlightedProcess && (
          <section className={styles.context} aria-label="Selected process context">
            <span className={styles.contextText}>
              <span className={styles.contextLabel}>Selected target</span>
              <span className={styles.contextTarget} title={highlightedProcess.route}>
                {highlightedProcess.name}
              </span>
            </span>
            <span className={styles.contextActions}>
              {onFocusPane && (
                <button
                  type="button"
                  className={styles.contextBtn}
                  aria-label={`Focus selected process ${highlightedProcess.name}`}
                  disabled={
                    pendingActionKeys.has(highlightedProcess.key) || highlightedProcess.lifecycle === "orphaned"
                  }
                  onClick={() => void focusProcess(highlightedProcess)}
                >
                  <MousePointer2 size={11} aria-hidden="true" />
                  <span>Focus</span>
                </button>
              )}
              {onRestartPane && (
                <button
                  type="button"
                  className={styles.contextBtn}
                  aria-label={`Restart selected process ${highlightedProcess.name}`}
                  disabled={
                    pendingActionKeys.has(highlightedProcess.key) ||
                    highlightedProcess.lifecycle === "orphaned" ||
                    !canRestartProcess(
                      highlightedProcess,
                      processState(highlightedProcess, endedPaneKeys, restartingPaneKeys, failedPaneMessages),
                    )
                  }
                  onClick={() => void restartPane(highlightedProcess)}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  <span>Restart</span>
                </button>
              )}
              {highlightedProcess.lifecycle === "orphaned" && onAttachProcess && (
                <>
                  <AttachTargetSelect
                    process={highlightedProcess}
                    candidates={attachCandidatesByOrphanKey.get(highlightedProcess.key) ?? []}
                    selectedKey={selectedAttachTargetKeys.get(highlightedProcess.key) ?? ""}
                    onSelectTarget={selectAttachTarget}
                    compact
                  />
                  <button
                    type="button"
                    className={styles.contextBtn}
                    aria-label={`Attach selected process ${highlightedProcess.name}`}
                    disabled={pendingActionKeys.has(highlightedProcess.key) || !resolveAttachTarget(highlightedProcess)}
                    onClick={() => void attachProcess(highlightedProcess)}
                  >
                    <PlugZap size={11} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                </>
              )}
            </span>
          </section>
        )}
        {recoveryProcess && (
          <section className={styles.recovery} aria-label="Process recovery">
            <span className={styles.recoveryText}>
              <span className={styles.recoveryLabel}>Recovery ready</span>
              <span className={styles.recoveryTarget} title={recoveryProcess.route}>
                {recoveryProcess.name}
              </span>
            </span>
            <button
              type="button"
              className={styles.recoveryBtn}
              aria-label={`Restart affected process ${recoveryProcess.name}`}
              disabled={pendingActionKeys.has(recoveryProcess.key)}
              onClick={() => void restartPane(recoveryProcess)}
            >
              <RotateCcw size={11} aria-hidden="true" />
              <span>Restart</span>
            </button>
          </section>
        )}

        {processes.length === 0 ? (
          <EmptyState
            icon={<Terminal size={18} />}
            title="No terminal processes"
            description="Open a shell from Run, then use Health to focus, restart, attach, or end it."
          />
        ) : (
          <div className={styles.list}>
            {visibleProcesses.map((process) => (
              <ProcessRow
                key={process.key}
                process={process}
                state={processState(process, endedPaneKeys, restartingPaneKeys, failedPaneMessages)}
                rowError={failedPaneMessages.get(process.key) ?? null}
                ending={Boolean(process.terminalId && ending === process.terminalId)}
                pendingActions={pendingActionKeys}
                highlighted={isHighlightedProcess(process, highlightedPaneId, highlightedTerminalId)}
                canClosePane={canClosePane && process.lifecycle !== "orphaned"}
                canFocusPane={Boolean(onFocusPane) && process.lifecycle !== "orphaned"}
                attachCandidates={attachCandidatesByOrphanKey.get(process.key) ?? []}
                selectedAttachTargetKey={selectedAttachTargetKeys.get(process.key) ?? ""}
                canSubmitAttachPane={Boolean(resolveAttachTarget(process))}
                onFocusProcess={focusProcess}
                onEndProcess={endProcess}
                onClosePane={closePane}
                onRestartPane={restartPane}
                onAttachProcess={attachProcess}
                onSelectAttachTarget={selectAttachTarget}
                rowRef={(node) => {
                  if (node) {
                    rowRefs.current.set(process.key, node);
                  } else {
                    rowRefs.current.delete(process.key);
                  }
                }}
              />
            ))}
            {processes.length > visibleProcesses.length && (
              <div className={styles.more}>+{processes.length - visibleProcesses.length} more processes</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}

function ProcessRow({
  process,
  state,
  rowError,
  ending,
  pendingActions,
  highlighted,
  canClosePane,
  canFocusPane,
  attachCandidates,
  selectedAttachTargetKey,
  canSubmitAttachPane,
  onFocusProcess,
  onEndProcess,
  onClosePane,
  onRestartPane,
  onAttachProcess,
  onSelectAttachTarget,
  rowRef,
}: {
  process: ProcessView;
  state: ProcessState;
  rowError: string | null;
  ending: boolean;
  pendingActions: ReadonlySet<string>;
  highlighted: boolean;
  canClosePane: boolean;
  canFocusPane: boolean;
  attachCandidates: readonly ProcessView[];
  selectedAttachTargetKey: string;
  canSubmitAttachPane: boolean;
  onFocusProcess: (process: ProcessView) => void | Promise<void>;
  onEndProcess: (process: ProcessView) => void | Promise<void>;
  onClosePane: (process: ProcessView) => void | Promise<void>;
  onRestartPane: (process: ProcessView) => void | Promise<void>;
  onAttachProcess: (process: ProcessView) => void | Promise<void>;
  onSelectAttachTarget: (process: ProcessView, targetKey: string) => void;
  rowRef?: (node: HTMLElement | null) => void;
}) {
  const pending = pendingActions.has(process.key);

  return (
    <article
      ref={rowRef}
      className={styles.row}
      data-active={process.active ? "true" : "false"}
      data-state={state}
      data-highlighted={highlighted ? "true" : "false"}
      title={process.route}
    >
      <span className={styles.icon} aria-hidden="true">
        <Terminal size={12} />
      </span>
      <span className={styles.main}>
        <span className={styles.topLine}>
          <span className={styles.name}>{process.name}</span>
          <span className={styles.status}>{stateLabel(state)}</span>
        </span>
        <span className={styles.meta}>
          <span className={styles.shell}>{process.shell}</span>
          <span className={styles.cwd}>{compactPath(process.cwd)}</span>
          <span className={styles.id}>{process.terminalId ? shortId(process.terminalId) : "spawning"}</span>
        </span>
        {attachCandidates.length > 1 && (
          <AttachTargetSelect
            process={process}
            candidates={attachCandidates}
            selectedKey={selectedAttachTargetKey}
            onSelectTarget={onSelectAttachTarget}
          />
        )}
        {rowError && <span className={styles.rowError}>{rowError}</span>}
      </span>
      <fieldset className={styles.actions} aria-label={`${process.name} controls`}>
        {canFocusPane && (
          <button
            type="button"
            className={styles.actionBtn}
            title={`Focus ${process.route}`}
            aria-label={`Focus ${process.route}`}
            disabled={pending}
            onClick={() => void onFocusProcess(process)}
          >
            <MousePointer2 size={11} aria-hidden="true" />
          </button>
        )}
        {attachCandidates.length > 0 && (
          <button
            type="button"
            className={styles.actionBtn}
            title={`Attach ${process.name}`}
            aria-label={`Attach ${process.name}`}
            disabled={ending || pending || !canSubmitAttachPane}
            onClick={() => void onAttachProcess(process)}
          >
            <PlugZap size={11} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={styles.actionBtn}
          title={`Restart ${process.name}`}
          aria-label={`Restart ${process.name}`}
          disabled={!canRestartProcess(process, state) || ending || pending}
          onClick={() => void onRestartPane(process)}
        >
          <RotateCcw size={11} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          title={`Close ${process.name} pane`}
          aria-label={`Close ${process.name} pane`}
          disabled={!canClosePane || ending || state === "restarting" || pending}
          onClick={() => void onClosePane(process)}
        >
          <X size={11} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.killBtn}
          title={`End ${process.name}`}
          aria-label={`End ${process.name}`}
          disabled={!process.terminalId || ending || state === "ended" || state === "restarting" || pending}
          onClick={() => void onEndProcess(process)}
        >
          <Power size={11} aria-hidden="true" />
        </button>
      </fieldset>
    </article>
  );
}

function AttachTargetSelect({
  process,
  candidates,
  selectedKey,
  onSelectTarget,
  compact = false,
}: {
  process: ProcessView;
  candidates: readonly ProcessView[];
  selectedKey: string;
  onSelectTarget: (process: ProcessView, targetKey: string) => void;
  compact?: boolean;
}) {
  if (candidates.length <= 1) return null;
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onSelectTarget(process, event.currentTarget.value);
  };
  return (
    <label className={compact ? styles.contextAttachTarget : styles.attachTarget}>
      <span className={styles.attachTargetLabel}>Attach to</span>
      <select
        className={styles.attachTargetSelect}
        aria-label={`Attach destination for ${process.name}`}
        value={selectedKey}
        onChange={handleChange}
      >
        <option value="">Choose pane</option>
        {candidates.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {candidate.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function canRestartProcess(process: ProcessView, state: ProcessState): boolean {
  if (process.lifecycle === "orphaned") return false;
  return Boolean(process.terminalId && state !== "restarting");
}

function countsAsLiveProcess(process: ProcessView, state: ProcessState): boolean {
  return Boolean(process.terminalId && (state === "active" || state === "running"));
}

function buildAttachCandidates(
  processes: readonly ProcessView[],
  enabled: boolean,
): ReadonlyMap<string, readonly ProcessView[]> {
  const candidates = new Map<string, readonly ProcessView[]>();
  if (!enabled) return candidates;
  const detachedByTab = new Map<string, ProcessView[]>();
  for (const process of processes) {
    if (process.lifecycle !== "detached" || process.terminalId) continue;
    const tabCandidates = detachedByTab.get(process.tabId) ?? [];
    tabCandidates.push(process);
    detachedByTab.set(process.tabId, tabCandidates);
  }
  for (const process of processes) {
    if (process.lifecycle !== "orphaned" || !process.terminalId) continue;
    const tabCandidates = detachedByTab.get(process.tabId) ?? [];
    if (tabCandidates.length > 0) candidates.set(process.key, tabCandidates);
  }
  return candidates;
}

function prioritizeVisibleProcesses(
  processes: readonly ProcessView[],
  highlightedKey: string | null,
  limit: number,
): ProcessView[] {
  if (processes.length <= limit) return [...processes];
  const highlightedIndex = highlightedKey ? processes.findIndex((process) => process.key === highlightedKey) : -1;
  if (highlightedIndex < limit || highlightedIndex < 0) return processes.slice(0, limit);
  return [...processes.slice(0, limit - 1), processes[highlightedIndex]];
}

function isHighlightedProcess(process: ProcessView, paneId: string | null, terminalId: string | null): boolean {
  return Boolean((paneId && process.paneId === paneId) || (terminalId && process.terminalId === terminalId));
}

function processState(
  process: ProcessView,
  endedPaneKeys: ReadonlySet<string>,
  restartingPaneKeys: ReadonlySet<string>,
  failedPaneMessages: ReadonlyMap<string, string>,
): ProcessState {
  if (restartingPaneKeys.has(process.key)) return "restarting";
  if (failedPaneMessages.has(process.key)) return "failed";
  if (endedPaneKeys.has(process.key)) return "ended";
  if (process.lifecycle === "restarting") return "restarting";
  if (process.lifecycle === "crashed") return "failed";
  if (process.lifecycle === "exited") return "ended";
  if (process.lifecycle === "detached") return "detached";
  if (process.lifecycle === "orphaned") return "orphaned";
  if (process.lifecycle === "starting" || process.lifecycle === "layout-only") return "starting";
  if (process.active) return "active";
  if (process.terminalId) return "running";
  return "starting";
}

function stateLabel(state: ProcessState): string {
  return state === "restarting" ? "restart" : state;
}

function setWithoutKey(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

function mapWithoutKey(map: ReadonlyMap<string, string>, key: string): Map<string, string> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

function filterSetByKeys(set: ReadonlySet<string>, liveKeys: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const key of set) {
    if (liveKeys.has(key)) next.add(key);
  }
  return next;
}

function filterMapByKeys<K extends string, V>(map: ReadonlyMap<K, V>, liveKeys: ReadonlySet<string>): Map<K, V> {
  const next = new Map<K, V>();
  for (const [key, value] of map) {
    if (liveKeys.has(key)) next.set(key, value);
  }
  return next;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toProcessView(pane: TerminalPaneTarget, activeTerminalId: string | null): ProcessView {
  const name = pane.title || (pane.role ? `@${pane.role}` : `${pane.shell} pane ${pane.index + 1}`);
  return {
    key: `${pane.tabId}:${pane.paneId}`,
    terminalId: pane.terminalId,
    paneId: pane.paneId,
    tabId: pane.tabId,
    name,
    shell: pane.shell,
    cwd: pane.cwd || pane.tabCwd || "",
    route: `${pane.tabLabel}/${name}`,
    active: Boolean(activeTerminalId && pane.terminalId === activeTerminalId),
    lifecycle: pane.lifecycle ?? (pane.terminalId ? "live" : "layout-only"),
  };
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function compactPath(path: string): string {
  if (!path) return "workspace";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}
