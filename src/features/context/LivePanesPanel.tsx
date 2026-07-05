import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { MousePointer2, PlugZap, RadioTower, Send, Terminal } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLivePanes } from "../../shared/hooks/useLivePanes";
import type { Invoke } from "../../shared/hooks/useLogStream";
import {
  acceptedTerminalWrites,
  type SendKeysBatchResult,
  skippedTerminalWrites,
} from "../../shared/lib/sendKeysResult";
import { normalizeCommandInput } from "../../shared/lib/terminalInput";
import { toast } from "../../shared/store/toastStore";
import type { PaneEntry } from "../../shared/types/pane";
import type { TerminalPaneTarget } from "../../shared/types/terminalPane";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { showPrompt } from "../../shared/ui/PromptDialog";
import styles from "./LivePanesPanel.module.css";

export const RIGHT_RAIL_COMPATIBILITY_CLIENT = {
  schema: "aelyris.react.right-rail-compatibility-client.v1",
  surface: "live-panes-right-rail",
  primarySurface: "aelyris-native",
  compatibilityRole: "legacy-tauri-react-client",
  productTruthOwner: "rust-native-command-center",
  nativeContract: "aelyris.native.right-rail-demotion-proof.v1",
  reactOwnsProductTruth: false,
  webviewDispatchRequired: false,
} as const;

interface LivePanesPanelProps {
  enabled?: boolean;
  invoke?: Invoke;
  pollMs?: number;
  panes?: TerminalPaneTarget[];
  highlightedPaneId?: string | null;
  highlightedTerminalId?: string | null;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onAttachPane?: (tabId: string, paneId: string, terminalId: string) => void | Promise<void>;
  onSelectPane?: (pane: TerminalPaneTarget) => void;
}

interface PaneView {
  key: string;
  terminalId: string | null;
  paneId?: string;
  tabId?: string;
  state: "live" | "detached" | "orphaned" | "frontend-only";
  label: string;
  route: string;
  target?: string;
  preferTargetRoute: boolean;
  role?: string;
  shell: string;
  cwd: string;
  tabLabel?: string;
  source?: TerminalPaneTarget;
}

const LIVE_PANE_ROW_LIMIT = 5;

export function LivePanesPanel({
  enabled = true,
  invoke,
  pollMs = 2_000,
  panes: frontendPanes = [],
  highlightedPaneId = null,
  highlightedTerminalId = null,
  onFocusPane,
  onAttachPane,
  onSelectPane,
}: LivePanesPanelProps) {
  const {
    panes: backendPanes,
    activeTerminalIds,
    backendAvailable,
    error,
    ready,
  } = useLivePanes({ enabled, invoke, pollMs });
  const paneViews = mergePaneViews(frontendPanes, backendPanes, activeTerminalIds, backendAvailable);
  const paneViewsRef = useRef<PaneView[]>([]);
  const actionLocksRef = useRef(new Set<string>());
  const [pendingActionKeys, setPendingActionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedAttachTargetKeys, setSelectedAttachTargetKeys] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  paneViewsRef.current = paneViews;
  const visiblePaneViews = paneViews.slice(0, LIVE_PANE_ROW_LIMIT);
  const livePaneViews = paneViews.filter(isControllableLivePane);
  const roleOccurrences = countPaneRoles(livePaneViews);
  const roleCount = roleOccurrences.size;
  const attachCandidatesByOrphanKey = useMemo(
    () => buildAttachCandidates(paneViews, Boolean(onAttachPane)),
    [onAttachPane, paneViews],
  );
  useEffect(() => {
    paneViewsRef.current = paneViews;
  }, [paneViews]);
  const resolveLivePane = (pane: PaneView): PaneView | null =>
    paneViewsRef.current.find((candidate) => candidate.key === pane.key) ?? null;
  const countLiveRoleTargets = (role: string): number =>
    paneViewsRef.current.filter((candidate) => isControllableLivePane(candidate) && candidate.role === role).length;
  const resolveAttachTarget = (pane: PaneView): PaneView | null => {
    const candidates = attachCandidatesByOrphanKey.get(pane.key) ?? [];
    if (candidates.length === 1) return candidates[0];
    const selectedKey = selectedAttachTargetKeys.get(pane.key);
    return candidates.find((candidate) => candidate.key === selectedKey) ?? null;
  };
  const selectAttachTarget = (pane: PaneView, targetKey: string) => {
    setSelectedAttachTargetKeys((prev) => {
      const next = new Map(prev);
      if (targetKey) {
        next.set(pane.key, targetKey);
      } else {
        next.delete(pane.key);
      }
      return next;
    });
  };
  const runExclusive = async (key: string, task: () => Promise<void>) => {
    if (actionLocksRef.current.has(key)) return;
    actionLocksRef.current.add(key);
    setPendingActionKeys(new Set(actionLocksRef.current));
    try {
      await task();
    } finally {
      actionLocksRef.current.delete(key);
      setPendingActionKeys(new Set(actionLocksRef.current));
    }
  };

  useEffect(() => {
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
  }, [attachCandidatesByOrphanKey]);

  return (
    <section className={styles.panel} aria-label="Live terminal panes" data-empty={paneViews.length === 0}>
      <PanelHeader
        title="Live Panes"
        subtitle="focus/recover"
        leadingIcon={<Terminal size={12} />}
        count={livePaneViews.length || undefined}
        actions={
          roleCount > 0 ? (
            <span className={styles.roleCount} title="Assigned pane roles">
              {roleCount} roles
            </span>
          ) : null
        }
      />

      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}

        {paneViews.length === 0 ? (
          <EmptyState
            icon={<Terminal size={18} />}
            title={ready ? "No live panes" : "Loading panes"}
            description="Split a terminal or start a shell to focus, attach, and broadcast by role."
          />
        ) : (
          <div className={styles.list}>
            {visiblePaneViews.map((pane) => (
              <PaneRow
                key={pane.key}
                pane={pane}
                invoke={invoke}
                highlighted={isHighlightedPane(pane, highlightedPaneId, highlightedTerminalId)}
                roleTargetCount={pane.role ? (roleOccurrences.get(pane.role) ?? 0) : 0}
                resolveLivePane={resolveLivePane}
                countLiveRoleTargets={countLiveRoleTargets}
                attachCandidates={attachCandidatesByOrphanKey.get(pane.key) ?? []}
                selectedAttachTargetKey={selectedAttachTargetKeys.get(pane.key) ?? ""}
                canSubmitAttachPane={Boolean(resolveAttachTarget(pane))}
                runExclusive={runExclusive}
                pendingActionKeys={pendingActionKeys}
                onFocusPane={onFocusPane}
                onAttachPane={onAttachPane}
                onSelectPane={onSelectPane}
                onAttachTargetSelect={selectAttachTarget}
                resolveAttachTarget={resolveAttachTarget}
              />
            ))}
            {paneViews.length > visiblePaneViews.length && (
              <div className={styles.more}>+{paneViews.length - visiblePaneViews.length} more panes</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PaneRow({
  pane,
  invoke,
  highlighted,
  roleTargetCount,
  resolveLivePane,
  countLiveRoleTargets,
  attachCandidates,
  selectedAttachTargetKey,
  canSubmitAttachPane,
  runExclusive,
  pendingActionKeys,
  onFocusPane,
  onAttachPane,
  onSelectPane,
  onAttachTargetSelect,
  resolveAttachTarget,
}: {
  pane: PaneView;
  invoke?: Invoke;
  highlighted: boolean;
  roleTargetCount: number;
  resolveLivePane: (pane: PaneView) => PaneView | null;
  countLiveRoleTargets: (role: string) => number;
  attachCandidates: readonly PaneView[];
  selectedAttachTargetKey: string;
  canSubmitAttachPane: boolean;
  runExclusive: (key: string, task: () => Promise<void>) => Promise<void>;
  pendingActionKeys: ReadonlySet<string>;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onAttachPane?: (tabId: string, paneId: string, terminalId: string) => void | Promise<void>;
  onSelectPane?: (pane: TerminalPaneTarget) => void;
  onAttachTargetSelect: (pane: PaneView, targetKey: string) => void;
  resolveAttachTarget: (pane: PaneView) => PaneView | null;
}) {
  const role = pane.role;
  const sendActionKey = `${pane.key}:send`;
  const roleActionKey = role ? `role:${role}:send` : "";
  const attachActionKey = `${pane.key}:attach`;
  const isSendPending = pendingActionKeys.has(sendActionKey);
  const isRolePending = role ? pendingActionKeys.has(roleActionKey) : false;
  const isAttachPending = pendingActionKeys.has(attachActionKey);
  const selectPane = () => {
    if (pane.source) onSelectPane?.(pane.source);
  };
  const focusPane = () => {
    const livePane = resolveLivePane(pane);
    if (!livePane?.tabId || !livePane.paneId || !onFocusPane) {
      toast.error("Focus target changed", "The pane was removed before it could be focused.");
      return;
    }
    void onFocusPane(livePane.tabId, livePane.paneId);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!pane.source || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    selectPane();
  };
  return (
    <article
      className={styles.row}
      data-highlighted={highlighted ? "true" : "false"}
      data-selectable={pane.source ? "true" : "false"}
      data-state={pane.state}
      title={`${pane.tabLabel ? `${pane.tabLabel} · ` : ""}${pane.shell} ${pane.cwd}`}
      onClick={selectPane}
      onKeyDown={handleRowKeyDown}
      tabIndex={pane.source ? 0 : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        <Terminal size={12} />
      </span>
      <span className={styles.main}>
        <span className={styles.topLine}>
          <span className={styles.label}>{pane.label}</span>
          <span className={styles.shell}>{pane.shell}</span>
        </span>
        <span className={styles.meta}>
          {pane.state !== "live" && <span className={styles.state}>{pane.state}</span>}
          {pane.role ? (
            <span className={styles.role}>@{pane.role}</span>
          ) : (
            <span className={styles.muted}>no role</span>
          )}
          <span className={styles.cwd}>{compactPath(pane.cwd)}</span>
        </span>
        {attachCandidates.length > 1 && (
          <AttachTargetSelect
            pane={pane}
            candidates={attachCandidates}
            selectedKey={selectedAttachTargetKey}
            onSelectTarget={onAttachTargetSelect}
          />
        )}
      </span>
      {pane.state === "live" && pane.tabId && pane.paneId && onFocusPane && (
        <button
          type="button"
          className={styles.actionBtn}
          title={`Focus ${pane.route}`}
          aria-label={`Focus ${pane.route}`}
          onClick={(event) => {
            event.stopPropagation();
            selectPane();
            focusPane();
          }}
        >
          <MousePointer2 size={11} aria-hidden="true" />
        </button>
      )}
      {isControllableLivePane(pane) && (
        <button
          type="button"
          className={styles.actionBtn}
          title={`Send command to ${pane.route}`}
          aria-label={`Send command to ${pane.route}`}
          aria-busy={isSendPending ? "true" : undefined}
          disabled={isSendPending}
          onClick={(event) => {
            event.stopPropagation();
            selectPane();
            void runExclusive(sendActionKey, () =>
              sendToPane(pane, invoke, roleTargetCount, resolveLivePane, countLiveRoleTargets),
            );
          }}
        >
          <Send size={11} aria-hidden="true" />
        </button>
      )}
      {attachCandidates.length > 0 && onAttachPane && (
        <button
          type="button"
          className={styles.actionBtn}
          title={`Attach ${pane.label}`}
          aria-label={`Attach ${pane.label}`}
          aria-busy={isAttachPending ? "true" : undefined}
          disabled={isAttachPending || !canSubmitAttachPane}
          onClick={(event) => {
            event.stopPropagation();
            selectPane();
            void runExclusive(attachActionKey, () =>
              attachPane(pane, onAttachPane, resolveLivePane, resolveAttachTarget),
            );
          }}
        >
          <PlugZap size={11} aria-hidden="true" />
        </button>
      )}
      {role && isControllableLivePane(pane) && (
        <button
          type="button"
          className={styles.actionBtn}
          title={`Broadcast to @${role}`}
          aria-label={`Broadcast to @${role}`}
          aria-busy={isRolePending ? "true" : undefined}
          disabled={isRolePending}
          onClick={(event) => {
            event.stopPropagation();
            selectPane();
            void runExclusive(roleActionKey, () => sendToRole(role, invoke, () => countLiveRoleTargets(role)));
          }}
        >
          <RadioTower size={11} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}

function AttachTargetSelect({
  pane,
  candidates,
  selectedKey,
  onSelectTarget,
}: {
  pane: PaneView;
  candidates: readonly PaneView[];
  selectedKey: string;
  onSelectTarget: (pane: PaneView, targetKey: string) => void;
}) {
  if (candidates.length <= 1) return null;
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onSelectTarget(pane, event.currentTarget.value);
  };
  return (
    <label className={styles.attachTarget}>
      <span className={styles.attachTargetLabel}>Attach to</span>
      <select
        className={styles.attachTargetSelect}
        aria-label={`Attach destination for ${pane.label}`}
        value={selectedKey}
        onChange={handleChange}
      >
        <option value="">Choose pane</option>
        {candidates.map((candidate) => (
          <option key={candidate.key} value={candidate.key}>
            {candidate.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function isHighlightedPane(pane: PaneView, paneId: string | null, terminalId: string | null): boolean {
  return Boolean((paneId && pane.paneId === paneId) || (terminalId && pane.terminalId === terminalId));
}

async function sendToPane(
  pane: PaneView,
  invoke?: Invoke,
  roleTargetCount = 0,
  resolveLivePane: (pane: PaneView) => PaneView | null = () => pane,
  countLiveRoleTargets: (role: string) => number = () => roleTargetCount,
) {
  const text = await showPrompt(`Send to ${pane.route}`, { placeholder: "command or text" });
  if (!text?.trim()) return;
  const data = normalizeCommandInput(text);
  try {
    const call = invoke ?? (await Promise.resolve({ invoke: tauriInvoke })).invoke;
    const livePane = resolveLivePane(pane);
    if (!livePane) {
      toast.error("Send target changed", "The pane was removed before input could be sent.");
      return;
    }
    if (!isControllableLivePane(livePane)) {
      toast.error("Send target changed", "The pane is not attached to a live terminal.");
      return;
    }
    if (livePane.preferTargetRoute && livePane.target) {
      if (isRoleTarget(livePane.target)) {
        const liveRoleCount = countLiveRoleTargets(livePane.target.slice(1));
        if (!(await confirmRoleBroadcast(livePane.target.slice(1), liveRoleCount))) return;
      }
      const result = await call<SendKeysBatchResult>("send_keys_by_target", { target: livePane.target, data });
      const count = acceptedTerminalWrites(result);
      const skipped = skippedTerminalWrites(result).length;
      toast.success("Sent to pane", `${count} target${count === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`);
      return;
    }
    if (!livePane.terminalId || livePane.terminalId !== pane.terminalId) {
      toast.error("Pane is still starting", "Wait for the terminal id before sending input.");
      return;
    }
    await call("send_keys", { terminalId: livePane.terminalId, data });
    toast.success("Sent to pane", shortId(livePane.terminalId));
  } catch (error) {
    toast.error("Send to pane failed", error instanceof Error ? error.message : String(error));
  }
}

async function attachPane(
  pane: PaneView,
  onAttachPane: (tabId: string, paneId: string, terminalId: string) => void | Promise<void>,
  resolveLivePane: (pane: PaneView) => PaneView | null,
  resolveAttachTarget: (pane: PaneView) => PaneView | null,
) {
  if (!pane.terminalId) {
    toast.error("Attach is unavailable", "The backend session does not have a terminal id.");
    return;
  }
  const target = resolveAttachTarget(pane);
  if (!target?.tabId || !target.paneId) {
    toast.error("Attach is unavailable", "Choose a detached pane before attaching this session.");
    return;
  }

  const ok = await showConfirm({
    title: "Attach terminal pane",
    description: `Attach ${pane.label} (${shortId(pane.terminalId)}) to ${target.label}? The existing backend shell will resume in that pane.`,
    confirmLabel: "Attach",
    tone: "default",
  });
  if (!ok) return;

  const livePane = resolveLivePane(pane);
  const liveTarget = resolveLivePane(target);
  if (
    !livePane?.terminalId ||
    livePane.terminalId !== pane.terminalId ||
    livePane.state !== "orphaned" ||
    !liveTarget?.tabId ||
    !liveTarget.paneId ||
    liveTarget.state !== "detached" ||
    liveTarget.terminalId
  ) {
    toast.error("Attach target changed", "The detached pane or backend session changed before attach.");
    return;
  }

  try {
    await onAttachPane(liveTarget.tabId, liveTarget.paneId, livePane.terminalId);
    toast.success("Pane attached", liveTarget.label);
  } catch (error) {
    toast.error("Attach failed", error instanceof Error ? error.message : String(error));
  }
}

async function sendToRole(role: string, invoke?: Invoke, countLiveRoleTargets: () => number = () => 0) {
  const text = await showPrompt(`Broadcast to @${role}`, { placeholder: "command or text" });
  if (!text?.trim()) return;
  const roleTargetCount = countLiveRoleTargets();
  if (roleTargetCount < 1) {
    toast.error("Broadcast target changed", `No live panes are currently assigned to @${role}.`);
    return;
  }
  if (!(await confirmRoleBroadcast(role, roleTargetCount))) return;
  if (countLiveRoleTargets() < 1) {
    toast.error("Broadcast target changed", `No live panes are currently assigned to @${role}.`);
    return;
  }
  try {
    const call = invoke ?? (await Promise.resolve({ invoke: tauriInvoke })).invoke;
    const result = await call<SendKeysBatchResult>("send_keys_by_role", { role, data: normalizeCommandInput(text) });
    const count = acceptedTerminalWrites(result);
    const skipped = skippedTerminalWrites(result).length;
    toast.success("Broadcast sent", `${count} pane${count === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`);
  } catch (error) {
    toast.error("Broadcast failed", error instanceof Error ? error.message : String(error));
  }
}

function countPaneRoles(panes: PaneView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pane of panes) {
    if (!pane.role) continue;
    counts.set(pane.role, (counts.get(pane.role) ?? 0) + 1);
  }
  return counts;
}

function isControllableLivePane(pane: PaneView): boolean {
  return pane.state === "live" && Boolean(pane.terminalId);
}

function buildAttachCandidates(panes: readonly PaneView[], enabled: boolean): ReadonlyMap<string, readonly PaneView[]> {
  const candidates = new Map<string, readonly PaneView[]>();
  if (!enabled) return candidates;
  const detachedByTab = new Map<string, PaneView[]>();
  for (const pane of panes) {
    if (pane.state !== "detached" || pane.terminalId || !pane.tabId) continue;
    const tabCandidates = detachedByTab.get(pane.tabId) ?? [];
    tabCandidates.push(pane);
    detachedByTab.set(pane.tabId, tabCandidates);
  }
  for (const pane of panes) {
    if (pane.state !== "orphaned" || !pane.terminalId || !pane.tabId) continue;
    const tabCandidates = detachedByTab.get(pane.tabId) ?? [];
    if (tabCandidates.length > 0) candidates.set(pane.key, tabCandidates);
  }
  return candidates;
}

function isRoleTarget(target: string): boolean {
  return target.startsWith("@") && target.length > 1;
}

async function confirmRoleBroadcast(role: string, targetCount: number): Promise<boolean> {
  if (targetCount <= 1) return true;
  return showConfirm({
    title: `Broadcast to @${role}`,
    description: `This will send the same input to ${targetCount} panes assigned to @${role}.`,
    confirmLabel: `Send to ${targetCount} panes`,
    cancelLabel: "Review first",
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function paneAddress(pane: Pick<PaneEntry, "terminal_id" | "short_id">): string {
  return typeof pane.short_id === "number" && pane.short_id > 0 ? `%${pane.short_id}` : shortId(pane.terminal_id);
}

function compactPath(path: string): string {
  if (!path) return "workspace";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}

function backendPaneToView(pane: PaneEntry): PaneView {
  const target = pane.name ? pane.name : pane.role ? `@${pane.role}` : undefined;
  const label = pane.name || pane.role || paneAddress(pane);
  return {
    key: pane.terminal_id,
    terminalId: pane.terminal_id,
    state: "orphaned",
    label,
    route: target ?? pane.terminal_id,
    target,
    preferTargetRoute: Boolean(target),
    role: pane.role || undefined,
    shell: pane.shell_type,
    cwd: pane.cwd,
  };
}

function frontendPaneToView(pane: TerminalPaneTarget): PaneView {
  const label = pane.title || (pane.role ? `@${pane.role}` : shortId(pane.terminalId ?? pane.paneId));
  return {
    key: `${pane.tabId}:${pane.paneId}`,
    terminalId: pane.terminalId,
    paneId: pane.paneId,
    tabId: pane.tabId,
    state: frontendPaneState(pane),
    label,
    route: `${pane.tabLabel}/${label}`,
    target: pane.role ? `@${pane.role}` : undefined,
    preferTargetRoute: false,
    role: pane.role,
    shell: pane.shell,
    cwd: pane.cwd || pane.tabCwd || "",
    tabLabel: pane.tabLabel,
    source: pane,
  };
}

function frontendPaneState(pane: TerminalPaneTarget): PaneView["state"] {
  if (pane.lifecycle === "orphaned") return "orphaned";
  if (pane.lifecycle === "detached") return "detached";
  if (pane.lifecycle === "exited" || pane.lifecycle === "crashed") return "frontend-only";
  if (!pane.terminalId) return "frontend-only";
  return "live";
}

function mergePaneViews(
  frontendPanes: TerminalPaneTarget[],
  backendPanes: PaneEntry[],
  activeTerminalIds: string[],
  backendAvailable: boolean,
): PaneView[] {
  if (frontendPanes.length === 0) return backendPanes.map((pane) => ({ ...backendPaneToView(pane), state: "live" }));

  const activeIds = new Set(activeTerminalIds);
  const backendByTerminalId = new Map(backendPanes.map((pane) => [pane.terminal_id, pane]));
  const frontendTerminalIds = new Set(frontendPanes.map((pane) => pane.terminalId).filter(Boolean));
  const views = frontendPanes.map((pane) => {
    const view = frontendPaneToView(pane);
    if (backendAvailable && view.terminalId && activeIds.size > 0 && !activeIds.has(view.terminalId)) {
      view.state = "frontend-only";
    }
    const backend = view.terminalId ? backendByTerminalId.get(view.terminalId) : undefined;
    if (backend?.role && !view.role) view.role = backend.role;
    if (backend?.cwd && !view.cwd) view.cwd = backend.cwd;
    if (backend?.shell_type && !view.shell) view.shell = backend.shell_type;
    return view;
  });

  for (const backendPane of backendPanes) {
    if (frontendTerminalIds.has(backendPane.terminal_id)) continue;
    views.push(backendPaneToView(backendPane));
  }

  return views;
}
