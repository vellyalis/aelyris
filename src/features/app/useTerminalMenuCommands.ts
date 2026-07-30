import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { ClipboardList, X as CloseIcon, RadioTower, Send, Terminal as TerminalIcon } from "lucide-react";
import { useMemo } from "react";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { formatOperationalPaneChoice, resolveOperationalPaneChoice } from "../../shared/lib/operationalPaneSelection";
import {
  acceptedTerminalWrites,
  type SendKeysBatchResult,
  skippedTerminalWrites,
} from "../../shared/lib/sendKeysResult";
import { shortcutFor } from "../../shared/lib/shortcutRegistry";
import { normalizeCommandInput } from "../../shared/lib/terminalInput";
import { toast } from "../../shared/store/toastStore";
import type { ShellType, TerminalPaneTarget } from "../../shared/types/terminalPane";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { showPrompt } from "../../shared/ui/PromptDialog";
import type { CommandItem } from "../command-palette/CommandPalette";
import type { Menu } from "../menubar/MenuBar";
import {
  copyImeDiagnostics,
  disableImeDiagnostics,
  enableImeDiagnostics,
  imeDiagnosticsEnabled,
} from "../terminal/hooks/useCanvasIME";
import type { PaneFocusOutcome } from "../terminal/usePaneRequestController";

export interface UseTerminalMenuCommandsOptions {
  addTab: (shell: ShellType) => void;
  closeTab: (id: string) => void;
  switchTab?: (id: string) => undefined | boolean | Promise<undefined | boolean>;
  tabs?: Array<{ id: string; label: string; shell: ShellType; cwd?: string; worktreeBranch?: string }>;
  switchPane?: (tabId: string, paneId: string) => undefined | Promise<undefined | PaneFocusOutcome>;
  openPaneSwitcher?: () => void;
  focusNextPane?: () => void | Promise<void>;
  focusPreviousPane?: () => void | Promise<void>;
  movePaneNext?: () => void | Promise<void>;
  movePanePrevious?: () => void | Promise<void>;
  rotatePanesNext?: () => void | Promise<void>;
  rotatePanesPrevious?: () => void | Promise<void>;
  equalizePanes?: () => void | Promise<void>;
  tilePanes?: () => void | Promise<void>;
  syncPanesOn?: () => void | Promise<void>;
  syncPanesOff?: () => void | Promise<void>;
  panes?: TerminalPaneTarget[];
  activeTabId: string;
  splitPaneRight?: () => void;
  splitPaneDown?: () => void;
}

export function useTerminalMenuCommands(opts: UseTerminalMenuCommandsOptions): {
  terminalCommands: CommandItem[];
  terminalMenu: Menu;
} {
  const {
    addTab,
    closeTab,
    switchTab,
    tabs = [],
    switchPane,
    openPaneSwitcher,
    focusNextPane,
    focusPreviousPane,
    movePaneNext,
    movePanePrevious,
    rotatePanesNext,
    rotatePanesPrevious,
    equalizePanes,
    tilePanes,
    syncPanesOn,
    syncPanesOff,
    panes = [],
    activeTabId,
    splitPaneRight,
    splitPaneDown,
  } = opts;

  const sendToPaneTarget = useMemo(() => {
    return async () => {
      try {
        type PaneInfo = { name: string; role: string; shell_type: string; cwd: string };
        let paneInfo: PaneInfo[] = [];
        try {
          paneInfo = await tauriInvoke<PaneInfo[]>("list_panes_info");
        } catch (err) {
          reportInvokeFailure({
            source: "app-menu",
            operation: "list_panes_info",
            err,
            severity: "warning",
          });
          toast.warning("Pane list unavailable", formatFallbackError(err));
        }
        const targets = paneInfo
          .flatMap((pane) => [pane.name ? pane.name : null, pane.role ? `@${pane.role}` : null])
          .filter((target): target is string => !!target)
          .filter((target, index, all) => all.indexOf(target) === index)
          .slice(0, 6)
          .join(", ");
        const target = await showPrompt("Send to pane", {
          placeholder: targets || "@build, @review, or pane name",
        });
        const trimmedTarget = target?.trim();
        if (!trimmedTarget) return;

        const text = await showPrompt(`Send to ${trimmedTarget}`, {
          placeholder: "command or text",
        });
        if (!text?.trim()) return;
        const result = await tauriInvoke<SendKeysBatchResult>("send_keys_by_target", {
          target: trimmedTarget,
          data: normalizeCommandInput(text),
        });
        const count = acceptedTerminalWrites(result);
        const skipped = skippedTerminalWrites(result).length;
        toast.success(
          "Sent to pane",
          `${count} target${count === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`,
        );
      } catch (e) {
        toast.error("Send to pane failed", String(e));
      }
    };
  }, []);

  const broadcastToAllPanes = useMemo(() => {
    return async () => {
      try {
        const text = await showPrompt("Broadcast to all panes", {
          placeholder: "command or text",
        });
        if (!text?.trim()) return;
        let livePanes: unknown[];
        try {
          livePanes = await tauriInvoke<unknown[]>("list_panes_info");
        } catch (err) {
          reportInvokeFailure({
            source: "app-menu",
            operation: "list_panes_info",
            err,
            severity: "error",
            userVisible: true,
          });
          toast.error("Broadcast unavailable", formatFallbackError(err));
          return;
        }
        if (livePanes.length < 1) {
          toast.error("Broadcast unavailable", "No live terminal panes are available.");
          return;
        }
        if (livePanes.length > 1) {
          const ok = await showConfirm({
            title: "Broadcast to all panes",
            description: `This will send the same input to ${livePanes.length} live panes.`,
            confirmLabel: `Send to ${livePanes.length} panes`,
            cancelLabel: "Review first",
          });
          if (!ok) return;
          let refreshedPanes: unknown[];
          try {
            refreshedPanes = await tauriInvoke<unknown[]>("list_panes_info");
          } catch (err) {
            reportInvokeFailure({
              source: "app-menu",
              operation: "list_panes_info",
              err,
              severity: "error",
              userVisible: true,
            });
            toast.error("Broadcast target check failed", formatFallbackError(err));
            return;
          }
          if (refreshedPanes.length < 1) {
            toast.error("Broadcast target changed", "No live terminal panes are available.");
            return;
          }
        }
        const result = await tauriInvoke<SendKeysBatchResult>("broadcast_keys", {
          data: normalizeCommandInput(text),
        });
        const count = acceptedTerminalWrites(result);
        const skipped = skippedTerminalWrites(result).length;
        toast.success(
          "Broadcast sent",
          `${count} pane${count === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`,
        );
      } catch (e) {
        toast.error("Broadcast failed", String(e));
      }
    };
  }, []);

  const switchTerminalTab = useMemo(() => {
    return async () => {
      if (!switchTab || tabs.length === 0) {
        toast.error("Switch terminal tab", "No terminal tabs are available");
        return;
      }

      const hints = tabs
        .map((tab, index) => `${index + 1}:${tab.label}${tab.worktreeBranch ? `/${tab.worktreeBranch}` : ""}`)
        .slice(0, 8)
        .join(", ");
      const choice = await showPrompt("Switch terminal tab", {
        placeholder: hints || "number, tab label, or tab id",
      });
      const target = resolveTabChoice(tabs, choice);
      if (!target) {
        toast.error("Tab not found", choice ? `No tab matched "${choice}"` : "Enter a tab number, label, or id");
        return;
      }

      await switchTab(target.id);
      toast.success("Terminal tab active", target.label);
    };
  }, [switchTab, tabs]);

  const switchTerminalPane = useMemo(() => {
    return async () => {
      if (!switchPane || panes.length === 0) {
        toast.error("Switch terminal pane", "No live terminal panes are available");
        return;
      }

      if (openPaneSwitcher) {
        openPaneSwitcher();
        return;
      }

      const hints = panes
        .map((pane, index) => `${index + 1}:${formatOperationalPaneChoice(pane)}`)
        .slice(0, 8)
        .join(", ");
      const choice = await showPrompt("Switch terminal pane", {
        placeholder: hints || "number, pane title, @role, pane id, or PTY id",
      });
      const result = resolveOperationalPaneChoice(panes, choice);
      if (result.kind === "ambiguous") {
        toast.error(
          "Pane target is ambiguous",
          `Matched ${result.matches.length} panes. Use tab.index, pane id, or PTY id.`,
        );
        return;
      }
      if (result.kind !== "match") {
        toast.error("Pane not found", choice ? `No pane matched "${choice}"` : "Enter a pane number, label, or id");
        return;
      }

      const outcome = await switchPane(result.pane.tabId, result.pane.paneId);
      if (outcome && outcome.status !== "focused") {
        toast.error("Switch terminal pane", outcome.error.message);
        return;
      }
      toast.success("Terminal pane active", formatOperationalPaneChoice(result.pane));
    };
  }, [openPaneSwitcher, panes, switchPane]);

  const enableImeTrace = useMemo(() => {
    return () => {
      enableImeDiagnostics(window);
      toast.success(
        "IME diagnostics enabled",
        "Trace recording is silent; reproduce the input bug, then copy the trace",
      );
    };
  }, []);

  const copyImeTrace = useMemo(() => {
    return async () => {
      if (!imeDiagnosticsEnabled(window)) {
        enableImeDiagnostics(window);
      }
      const copied = await copyImeDiagnostics(window);
      if (copied) {
        toast.success("IME trace copied", "The diagnostic event ring is on the clipboard");
      } else {
        toast.error("No IME trace yet", "Reproduce the terminal input bug, then run this again");
      }
    };
  }, []);

  const disableImeTrace = useMemo(() => {
    return () => {
      disableImeDiagnostics(window);
      toast.success("IME diagnostics disabled", "New IME events will no longer be recorded");
    };
  }, []);

  const terminalCommands: CommandItem[] = useMemo(
    () => [
      {
        id: "new-tab-ps",
        label: "New Terminal: PowerShell",
        description: "Open a new PowerShell tab",
        shortcut: shortcutFor("newTerminal"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["pwsh", "shell"],
        action: () => addTab("powershell"),
      },
      {
        id: "new-tab-cmd",
        label: "New Terminal: CMD",
        description: "Open a new CMD tab",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["cmd.exe", "prompt"],
        action: () => addTab("cmd"),
      },
      {
        id: "new-tab-gitbash",
        label: "New Terminal: Git Bash",
        description: "Open a new Git Bash tab",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["bash", "unix"],
        action: () => addTab("gitbash"),
      },
      {
        id: "new-tab-wsl",
        label: "New Terminal: WSL",
        description: "Open a new WSL tab",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["linux", "ubuntu"],
        action: () => addTab("wsl"),
      },
      {
        id: "close-tab",
        label: "Close Current Tab",
        description: "Close the active terminal tab",
        shortcut: shortcutFor("closeTerminalTab"),
        category: "Terminal",
        icon: CloseIcon,
        action: () => closeTab(activeTabId),
      },
      {
        id: "switch-terminal-tab",
        label: "Switch Terminal Tab...",
        description: "Choose a live terminal tab by number, label, or id",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "choose-tree", "session", "window", "tab", "switch"],
        action: switchTerminalTab,
      },
      {
        id: "switch-terminal-pane",
        label: "Switch Terminal Pane...",
        description: "Choose a live pane without detaching or respawning PTYs",
        shortcut: shortcutFor("switchTerminalPane"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "choose-tree", "pane", "focus", "window", "switch"],
        action: switchTerminalPane,
      },
      {
        id: "focus-next-terminal-pane",
        label: "Focus Next Terminal Pane",
        description: "Move focus to the next live pane in tmux order",
        shortcut: shortcutFor("focusNextPane"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "pane", "next", "cycle", "focus"],
        action: () => void focusNextPane?.(),
      },
      {
        id: "focus-previous-terminal-pane",
        label: "Focus Previous Terminal Pane",
        description: "Move focus to the previous live pane in tmux order",
        shortcut: shortcutFor("focusPreviousPane"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "pane", "previous", "prev", "cycle", "focus"],
        action: () => void focusPreviousPane?.(),
      },
      {
        id: "move-terminal-pane-next",
        label: "Move Pane Next",
        description: "Swap the active pane with the next pane in tmux order",
        shortcut: shortcutFor("movePaneNext"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "swap-pane", "move", "pane"],
        action: () => void movePaneNext?.(),
      },
      {
        id: "move-terminal-pane-previous",
        label: "Move Pane Previous",
        description: "Swap the active pane with the previous pane in tmux order",
        shortcut: shortcutFor("movePanePrevious"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "swap-pane", "move", "pane"],
        action: () => void movePanePrevious?.(),
      },
      {
        id: "rotate-terminal-panes-next",
        label: "Rotate Panes Next",
        description: "Rotate panes through the current split layout",
        shortcut: shortcutFor("rotatePanesNext"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "rotate-pane", "layout", "pane"],
        action: () => void rotatePanesNext?.(),
      },
      {
        id: "rotate-terminal-panes-previous",
        label: "Rotate Panes Previous",
        description: "Rotate panes backward through the current split layout",
        shortcut: shortcutFor("rotatePanesPrevious"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "rotate-pane", "layout", "pane"],
        action: () => void rotatePanesPrevious?.(),
      },
      {
        id: "equalize-terminal-panes",
        label: "Equalize Pane Sizes",
        description: "Reset terminal split ratios to even sizes",
        shortcut: shortcutFor("equalizePanes"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "resize-pane", "even", "layout"],
        action: () => void equalizePanes?.(),
      },
      {
        id: "tile-terminal-panes",
        label: "Tile Terminal Panes",
        description: "Rebuild terminal panes into a balanced tiled layout",
        shortcut: shortcutFor("tilePanes"),
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "select-layout", "tiled", "even"],
        action: () => void tilePanes?.(),
      },
      {
        id: "synchronize-terminal-panes-on",
        label: "Synchronize Panes On",
        description: "Mirror typed input from the active pane to every live pane in the active mux tab",
        category: "Terminal",
        icon: RadioTower,
        keywords: ["tmux", "synchronize-panes", "sync", "broadcast", "pane"],
        action: () => void syncPanesOn?.(),
      },
      {
        id: "synchronize-terminal-panes-off",
        label: "Synchronize Panes Off",
        description: "Stop mirroring typed input across panes in the active mux tab",
        category: "Terminal",
        icon: RadioTower,
        keywords: ["tmux", "synchronize-panes", "sync", "broadcast", "pane"],
        action: () => void syncPanesOff?.(),
      },
      {
        id: "send-to-pane",
        label: "Send Command to Pane...",
        description: "Route input to a named pane or role",
        category: "Terminal",
        icon: Send,
        keywords: ["pane", "role", "target", "tmux", "send-keys"],
        action: sendToPaneTarget,
      },
      {
        id: "broadcast-to-all-panes",
        label: "Broadcast Command to All Panes...",
        description: "Send the same command to every live pane",
        category: "Terminal",
        icon: RadioTower,
        keywords: ["tmux", "broadcast", "synchronize", "sync", "panes", "send-keys"],
        action: broadcastToAllPanes,
      },
      {
        id: "enable-ime-diagnostics",
        label: "Enable IME Diagnostics",
        description: "Record terminal IME events for Japanese input debugging",
        category: "Terminal",
        icon: ClipboardList,
        keywords: ["ime", "japanese", "composition", "candidate", "debug"],
        action: enableImeTrace,
      },
      {
        id: "copy-ime-diagnostics",
        label: "Copy IME Diagnostic Trace",
        description: "Copy the latest redacted IME event ring",
        category: "Terminal",
        icon: ClipboardList,
        keywords: ["ime", "japanese", "composition", "candidate", "clipboard"],
        action: copyImeTrace,
      },
      {
        id: "disable-ime-diagnostics",
        label: "Disable IME Diagnostics",
        description: "Stop recording terminal IME events",
        category: "Terminal",
        icon: ClipboardList,
        keywords: ["ime", "japanese", "composition", "candidate", "debug"],
        action: disableImeTrace,
      },
      {
        id: "split-pane-right",
        label: "Split Pane Right",
        description: "Split the active terminal pane to the right through the mux owner",
        shortcut: shortcutFor("splitPaneRight"),
        category: "Terminal",
        icon: TerminalIcon,
        action: () => splitPaneRight?.(),
      },
      {
        id: "split-pane-down",
        label: "Split Pane Down",
        description: "Split the active terminal pane downward through the mux owner",
        shortcut: shortcutFor("splitPaneDown"),
        category: "Terminal",
        icon: TerminalIcon,
        action: () => splitPaneDown?.(),
      },
    ],
    [
      activeTabId,
      addTab,
      broadcastToAllPanes,
      closeTab,
      copyImeTrace,
      disableImeTrace,
      enableImeTrace,
      equalizePanes,
      focusNextPane,
      focusPreviousPane,
      movePaneNext,
      movePanePrevious,
      rotatePanesNext,
      rotatePanesPrevious,
      sendToPaneTarget,
      splitPaneDown,
      splitPaneRight,
      switchTerminalPane,
      switchTerminalTab,
      syncPanesOff,
      syncPanesOn,
      tilePanes,
    ],
  );

  const terminalMenu: Menu = useMemo(
    () => ({
      label: "Terminal",
      items: [
        { label: "New Terminal", shortcut: shortcutFor("newTerminal"), action: () => addTab("powershell") },
        { label: "New CMD", action: () => addTab("cmd") },
        { label: "New Git Bash", action: () => addTab("gitbash") },
        { label: "New WSL", action: () => addTab("wsl") },
        { divider: true, label: "" },
        { label: "Switch Terminal Tab...", action: switchTerminalTab },
        { label: "Switch Terminal Pane...", shortcut: shortcutFor("switchTerminalPane"), action: switchTerminalPane },
        { label: "Focus Next Pane", shortcut: shortcutFor("focusNextPane"), action: () => void focusNextPane?.() },
        {
          label: "Focus Previous Pane",
          shortcut: shortcutFor("focusPreviousPane"),
          action: () => void focusPreviousPane?.(),
        },
        { label: "Move Pane Next", shortcut: shortcutFor("movePaneNext"), action: () => void movePaneNext?.() },
        {
          label: "Move Pane Previous",
          shortcut: shortcutFor("movePanePrevious"),
          action: () => void movePanePrevious?.(),
        },
        {
          label: "Rotate Panes Next",
          shortcut: shortcutFor("rotatePanesNext"),
          action: () => void rotatePanesNext?.(),
        },
        {
          label: "Rotate Panes Previous",
          shortcut: shortcutFor("rotatePanesPrevious"),
          action: () => void rotatePanesPrevious?.(),
        },
        {
          label: "Equalize Pane Sizes",
          shortcut: shortcutFor("equalizePanes"),
          action: () => void equalizePanes?.(),
        },
        { label: "Tile Panes", shortcut: shortcutFor("tilePanes"), action: () => void tilePanes?.() },
        { label: "Synchronize Panes On", action: () => void syncPanesOn?.() },
        { label: "Synchronize Panes Off", action: () => void syncPanesOff?.() },
        { divider: true, label: "" },
        { label: "Send Command to Pane...", action: sendToPaneTarget },
        { label: "Broadcast Command to All Panes...", action: broadcastToAllPanes },
        { divider: true, label: "" },
        { label: "Enable IME Diagnostics", action: enableImeTrace },
        { label: "Copy IME Diagnostic Trace", action: copyImeTrace },
        { label: "Disable IME Diagnostics", action: disableImeTrace },
      ],
    }),
    [
      addTab,
      broadcastToAllPanes,
      copyImeTrace,
      disableImeTrace,
      enableImeTrace,
      equalizePanes,
      focusNextPane,
      focusPreviousPane,
      movePaneNext,
      movePanePrevious,
      rotatePanesNext,
      rotatePanesPrevious,
      sendToPaneTarget,
      switchTerminalPane,
      switchTerminalTab,
      syncPanesOff,
      syncPanesOn,
      tilePanes,
    ],
  );

  return { terminalCommands, terminalMenu };
}

function resolveTabChoice<T extends { id: string; label: string }>(
  tabs: T[],
  choice: string | null | undefined,
): T | null {
  const trimmed = choice?.trim();
  if (!trimmed) return null;

  const maybeNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(maybeNumber) && String(maybeNumber) === trimmed) {
    return tabs[maybeNumber - 1] ?? null;
  }

  const normalized = trimmed.toLowerCase();
  return (
    tabs.find((tab) => tab.id.toLowerCase() === normalized) ??
    tabs.find((tab) => tab.label.toLowerCase() === normalized) ??
    tabs.find((tab) => tab.label.toLowerCase().includes(normalized)) ??
    null
  );
}
