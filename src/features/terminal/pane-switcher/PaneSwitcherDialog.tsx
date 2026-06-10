import * as Dialog from "@radix-ui/react-dialog";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { Command } from "cmdk";
import { MonitorUp, MousePointer2, Pencil, RotateCcw, Send, Tag, Terminal, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import type { TerminalPaneTarget } from "../../../App";
import type { Invoke } from "../../../shared/hooks/useLogStream";
import { normalizeCommandInput } from "../../../shared/lib/terminalInput";
import { toast } from "../../../shared/store/toastStore";
import { showConfirm } from "../../../shared/ui/ConfirmDialog";
import { showPrompt } from "../../../shared/ui/PromptDialog";
import styles from "./PaneSwitcherDialog.module.css";

interface PaneSwitcherDialogProps {
  visible: boolean;
  panes: TerminalPaneTarget[];
  activeTabId: string;
  activeTerminalId: string | null;
  onClose: () => void;
  onFocusPane: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onClosePane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRenamePane?: (tabId: string, paneId: string, title: string | null) => void | Promise<void>;
  onCyclePaneRole?: (tabId: string, paneId: string) => void | Promise<void>;
  invoke?: Invoke;
}

interface PaneChoice {
  key: string;
  pane: TerminalPaneTarget;
  name: string;
  route: string;
  cwd: string;
  pty: string;
  value: string;
  active: boolean;
  pending: boolean;
}

export function PaneSwitcherDialog({
  visible,
  panes,
  activeTerminalId,
  onClose,
  onFocusPane,
  onRestartPane,
  onClosePane,
  onRenamePane,
  onCyclePaneRole,
  invoke,
}: PaneSwitcherDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const choicesRef = useRef<PaneChoice[]>([]);
  const actionLocksRef = useRef(new Set<string>());
  const [query, setQuery] = useState("");
  const [pendingActionKeys, setPendingActionKeys] = useState<ReadonlySet<string>>(() => new Set());
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  const choices = useMemo(
    () => panes.map((pane, index) => toPaneChoice(pane, index, activeTerminalId)),
    [activeTerminalId, panes],
  );

  useEffect(() => {
    choicesRef.current = choices;
  }, [choices]);

  const groups = useMemo(() => groupByTab(choices), [choices]);
  const canCloseChoices = panes.length > 1;

  const resolveLiveChoice = (choice: PaneChoice): PaneChoice | null =>
    choicesRef.current.find((item) => item.key === choice.key) ?? null;

  const runExclusive = async (key: string, task: () => Promise<void>) => {
    if (actionLocksRef.current.has(key)) return;
    actionLocksRef.current.add(key);
    setPendingActionKeys((current) => new Set(current).add(key));
    try {
      await task();
    } finally {
      actionLocksRef.current.delete(key);
      setPendingActionKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const focusChoice = async (choice: PaneChoice) => {
    const liveChoice = resolveLiveChoice(choice);
    if (!liveChoice) {
      toast.error("Pane no longer exists", "The selected pane changed before the action completed.");
      return;
    }
    await onFocusPane(liveChoice.pane.tabId, liveChoice.pane.paneId);
    onClose();
  };

  const restartChoice = async (choice: PaneChoice) => {
    if (!onRestartPane || !choice.pane.terminalId) return;
    await runExclusive(choice.key, async () => {
      const ok = await showConfirm({
        title: "Restart terminal shell",
        description: `Restart ${choice.route}? The shell process will be replaced in the same pane.`,
        confirmLabel: "Restart",
        tone: "default",
      });
      if (!ok) return;
      const liveChoice = resolveLiveChoice(choice);
      if (!liveChoice?.pane.terminalId) {
        toast.error("Restart target changed", "The pane was removed or is still starting.");
        return;
      }
      await onRestartPane(liveChoice.pane.tabId, liveChoice.pane.paneId);
      onClose();
    });
  };

  const closeChoice = async (choice: PaneChoice) => {
    if (!onClosePane || !canCloseChoices) return;
    await runExclusive(choice.key, async () => {
      const ok = await showConfirm({
        title: "Close terminal pane",
        description: choice.pane.terminalId
          ? `Close ${choice.route}? Its running shell process will be ended and the pane will be removed.`
          : `Remove ${choice.route} from the pane layout?`,
        confirmLabel: "Close Pane",
        tone: choice.pane.terminalId ? "danger" : "default",
      });
      if (!ok) return;
      const liveChoice = resolveLiveChoice(choice);
      if (!liveChoice) {
        toast.error("Close target changed", "The pane was already removed.");
        return;
      }
      await onClosePane(liveChoice.pane.tabId, liveChoice.pane.paneId);
      onClose();
    });
  };

  const sendChoice = async (choice: PaneChoice) => {
    if (!choice.pane.terminalId) return;
    await runExclusive(choice.key, async () => {
      const text = await showPrompt(`Send to ${choice.route}`, { placeholder: "command or text" });
      if (!text?.trim()) return;
      const liveChoice = resolveLiveChoice(choice);
      if (!liveChoice?.pane.terminalId) {
        toast.error("Send target changed", "The pane was removed or does not have a terminal yet.");
        return;
      }
      try {
        const call = invoke ?? (await Promise.resolve({ invoke: tauriInvoke })).invoke;
        await call("send_keys", { terminalId: liveChoice.pane.terminalId, data: normalizeCommandInput(text) });
        toast.success("Sent to pane", liveChoice.pty);
        onClose();
      } catch (error) {
        toast.error("Send to pane failed", error instanceof Error ? error.message : String(error));
      }
    });
  };

  const renameChoice = async (choice: PaneChoice) => {
    if (!onRenamePane) return;
    await runExclusive(choice.key, async () => {
      const text = await showPrompt(`Rename ${choice.route}`, {
        placeholder: "pane name",
        defaultValue: choice.pane.title ?? choice.pane.label ?? "",
      });
      if (text == null) return;
      const liveChoice = resolveLiveChoice(choice);
      if (!liveChoice) {
        toast.error("Rename target changed", "The pane was removed before it could be renamed.");
        return;
      }
      await onRenamePane(liveChoice.pane.tabId, liveChoice.pane.paneId, text.trim() || null);
      toast.success("Pane renamed", liveChoice.route);
      onClose();
    });
  };

  const cycleRoleChoice = async (choice: PaneChoice) => {
    if (!onCyclePaneRole) return;
    await runExclusive(choice.key, async () => {
      const liveChoice = resolveLiveChoice(choice);
      if (!liveChoice) {
        toast.error("Role target changed", "The pane was removed before its role could be updated.");
        return;
      }
      await onCyclePaneRole(liveChoice.pane.tabId, liveChoice.pane.paneId);
      toast.success("Pane role updated", liveChoice.route);
      onClose();
    });
  };

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnimatePresence>
        {visible && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className={styles.overlay}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.12 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                className={styles.panel}
                initial={reduceMotion ? false : { opacity: 0, x: "-50%", y: -18, scale: 0.98 }}
                animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
                exit={
                  reduceMotion
                    ? { opacity: 1, x: "-50%", y: 0, scale: 1 }
                    : { opacity: 0, x: "-50%", y: -10, scale: 0.98 }
                }
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
              >
                <Command label="Switch terminal pane" loop shouldFilter>
                  <div className={styles.header}>
                    <div className={styles.titleBlock}>
                      <Dialog.Title className={styles.title}>Switch Terminal Pane</Dialog.Title>
                      <Dialog.Description className="sr-only">
                        Filter panes by tab, role, title, shell, cwd, or PTY. Use arrow keys and Enter to focus a pane.
                      </Dialog.Description>
                      <div className={styles.subtitle}>tmux choose-tree · live panes</div>
                    </div>
                    <span
                      className={styles.count}
                      title={`${choices.length} live panes`}
                      role="status"
                      aria-label={`${choices.length} live panes`}
                    >
                      {choices.length}
                    </span>
                  </div>
                  <Command.Input
                    ref={inputRef}
                    className={styles.input}
                    aria-label="Filter terminal panes"
                    placeholder="Filter by tab, role, title, shell, cwd, or PTY..."
                    value={query}
                    onValueChange={setQuery}
                  />
                  <Command.List className={styles.list} aria-label="Available terminal panes">
                    <Command.Empty className={styles.empty}>
                      <div className={styles.emptyTitle}>No matching panes</div>
                      <div className={styles.emptyHint}>Try another tab, role, cwd, or terminal id.</div>
                    </Command.Empty>

                    {groups.map((group) => (
                      <Command.Group key={group.tabId} heading={group.label} className={styles.group}>
                        {group.items.map((choice) => (
                          <PaneRow
                            key={`${choice.pane.tabId}:${choice.pane.paneId}`}
                            choice={choice}
                            canSend={Boolean(choice.pane.terminalId)}
                            canRestart={Boolean(onRestartPane && choice.pane.terminalId)}
                            canClose={Boolean(onClosePane && canCloseChoices)}
                            canRename={Boolean(onRenamePane)}
                            canCycleRole={Boolean(onCyclePaneRole)}
                            pendingActions={pendingActionKeys}
                            onFocus={focusChoice}
                            onSend={sendChoice}
                            onRestart={restartChoice}
                            onClosePane={closeChoice}
                            onRename={renameChoice}
                            onCycleRole={cycleRoleChoice}
                          />
                        ))}
                      </Command.Group>
                    ))}
                  </Command.List>
                </Command>
                <div className={styles.footer}>
                  <span>
                    <kbd>↑↓</kbd> navigate
                  </span>
                  <span>
                    <kbd>Enter</kbd> focus
                  </span>
                  <span>
                    <kbd>icons</kbd> act
                  </span>
                  <span>
                    <kbd>Esc</kbd> close
                  </span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function PaneRow({
  choice,
  canSend,
  canRestart,
  canClose,
  canRename,
  canCycleRole,
  pendingActions,
  onFocus,
  onSend,
  onRestart,
  onClosePane,
  onRename,
  onCycleRole,
}: {
  choice: PaneChoice;
  canSend: boolean;
  canRestart: boolean;
  canClose: boolean;
  canRename: boolean;
  canCycleRole: boolean;
  pendingActions: ReadonlySet<string>;
  onFocus: (choice: PaneChoice) => void | Promise<void>;
  onSend: (choice: PaneChoice) => void | Promise<void>;
  onRestart: (choice: PaneChoice) => void | Promise<void>;
  onClosePane: (choice: PaneChoice) => void | Promise<void>;
  onRename: (choice: PaneChoice) => void | Promise<void>;
  onCycleRole: (choice: PaneChoice) => void | Promise<void>;
}) {
  const pending = pendingActions.has(choice.key);

  return (
    <Command.Item
      value={choice.value}
      className={styles.row}
      aria-current={choice.active ? "true" : undefined}
      aria-label={formatPaneChoiceLabel(choice)}
      onSelect={() => void onFocus(choice)}
    >
      <span className={styles.icon} aria-hidden="true">
        {choice.active ? <MonitorUp size={14} /> : <Terminal size={14} />}
      </span>
      <span className={styles.main}>
        <span className={styles.line}>
          <span className={styles.name}>{choice.name}</span>
          {choice.active && <span className={styles.activeBadge}>active</span>}
          {choice.pane.role && <span className={styles.roleBadge}>@{choice.pane.role}</span>}
          {choice.pending && <span className={styles.pendingBadge}>starting</span>}
        </span>
        <span className={styles.meta}>
          <span className={styles.shell}>{choice.pane.shell}</span>
          <span className={styles.cwd}>{choice.cwd}</span>
          <span className={styles.pty}>{choice.pty}</span>
        </span>
      </span>
      <span className={styles.route}>{choice.route}</span>
      <fieldset className={styles.actions} aria-label={`${choice.name} actions`}>
        <button
          type="button"
          className={styles.actionButton}
          title={`Focus ${choice.route}`}
          aria-label={`Focus ${choice.route}`}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onFocus(choice);
          }}
        >
          <MousePointer2 size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={`Send command to ${choice.route}`}
          aria-label={`Send command to ${choice.route}`}
          disabled={!canSend || pending}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onSend(choice);
          }}
        >
          <Send size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={`Restart ${choice.route}`}
          aria-label={`Restart ${choice.route}`}
          disabled={!canRestart || pending}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onRestart(choice);
          }}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={`Rename ${choice.route}`}
          aria-label={`Rename ${choice.route}`}
          disabled={!canRename || pending}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onRename(choice);
          }}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={`Cycle role for ${choice.route}`}
          aria-label={`Cycle role for ${choice.route}`}
          disabled={!canCycleRole || pending}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onCycleRole(choice);
          }}
        >
          <Tag size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.actionButton}
          title={`Close ${choice.route}`}
          aria-label={`Close ${choice.route}`}
          disabled={!canClose || pending}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={stopNestedActionKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            void onClosePane(choice);
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </fieldset>
    </Command.Item>
  );
}

function stopNestedActionKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function formatPaneChoiceLabel(choice: PaneChoice): string {
  const status = [choice.active ? "active" : null, choice.pending ? "starting" : null].filter(Boolean).join(", ");
  return status ? `${choice.route}, ${status}` : choice.route;
}

function toPaneChoice(pane: TerminalPaneTarget, index: number, activeTerminalId: string | null): PaneChoice {
  const name = pane.label || pane.title || (pane.role ? `@${pane.role}` : `${pane.shell} pane ${pane.index + 1}`);
  const cwd = compactPath(pane.cwd || pane.tabCwd || "");
  const pty = pane.terminalId ? shortId(pane.terminalId) : "spawning";
  const route = pane.route || `${pane.tabLabel}.${pane.index + 1} ${name}`;
  const active = Boolean(activeTerminalId && pane.terminalId && pane.terminalId === activeTerminalId);
  const key = `${pane.tabId}:${pane.paneId}`;
  const value = [
    index + 1,
    pane.tabLabel,
    pane.tabId,
    pane.paneId,
    pane.terminalId,
    name,
    pane.role ? `@${pane.role}` : "",
    pane.shell,
    pane.cwd,
    pane.tabCwd,
    pty,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    key,
    pane,
    name,
    route,
    cwd,
    pty,
    value,
    active,
    pending: !pane.terminalId,
  };
}

function groupByTab(choices: PaneChoice[]): Array<{ tabId: string; label: string; items: PaneChoice[] }> {
  const groups: Array<{ tabId: string; label: string; items: PaneChoice[] }> = [];
  for (const choice of choices) {
    let group = groups.find((item) => item.tabId === choice.pane.tabId);
    if (!group) {
      group = { tabId: choice.pane.tabId, label: choice.pane.tabLabel, items: [] };
      groups.push(group);
    }
    group.items.push(choice);
  }
  return groups;
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
