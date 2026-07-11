import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { showHistorySearch } from "../../features/history/HistorySearchDialog";
import { reportFallback } from "../lib/fallbackTelemetry";
import { matchesShortcut, SHORTCUTS } from "../lib/shortcutRegistry";
import { cycleWorkspaceRegion } from "../lib/workspaceRegionFocus";
import { toast } from "../store/toastStore";
import type { ShellType } from "../types/terminalPane";
import { showPrompt } from "../ui/PromptDialog";
import { isEditableTarget } from "./useEditableTargetGuard";

interface UseKeyboardShortcutsOptions {
  projectPath: string;
  tabs: { id: string }[];
  addTab: (shell: ShellType) => void;
  closeTab: (id: string) => void;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  activeFile: string | null;
  sessions: { id: string }[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string) => void;
  setPaletteVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSettingsVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSearchVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  handleOpenFolder: () => void;
  handleCloseFile: (path: string) => void;
  handleFileSelect: (path: string) => void;
  handleStartAgent: (prompt: string) => void;
  setQuickOpenMode?: (mode: "files" | "buffers" | null) => void;
  openPaneSwitcher?: () => void;
  focusNextPane?: () => void | Promise<void>;
  focusPreviousPane?: () => void | Promise<void>;
  setHelpVisible?: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle the left sidebar (Ctrl+B). Optional so legacy
   *  consumers without the new chrome cluster keep working. */
  setSidebarCollapsed?: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle Zen mode (Ctrl+Shift+M) without disturbing persisted rail widths. */
  setZenMode?: (v: boolean | ((prev: boolean) => boolean)) => void;
  openDecisionInbox?: () => void;
  setRightRailCollapsed?: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function useKeyboardShortcuts({
  projectPath,
  tabs,
  addTab,
  closeTab,
  activeTabId,
  setActiveTabId,
  activeFile,
  sessions,
  activeSessionId,
  setActiveSessionId,
  setPaletteVisible,
  setSettingsVisible,
  setSearchVisible,
  handleOpenFolder,
  handleCloseFile,
  handleFileSelect,
  handleStartAgent,
  setQuickOpenMode,
  openPaneSwitcher,
  focusNextPane,
  focusPreviousPane,
  setHelpVisible,
  setSidebarCollapsed,
  setZenMode,
  openDecisionInbox,
  setRightRailCollapsed,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesShortcut(e, SHORTCUTS.cycleWorkspaceRegion)) {
        e.preventDefault();
        cycleWorkspaceRegion(e.shiftKey);
        return;
      }
      // Bail out when the user is typing into an editable surface so
      // Ctrl+N/P/R/W don't steal keystrokes from Kanban task labels,
      // Watchdog rule inputs, Monaco, native terminal input, etc. F1 + the chord
      // shortcuts (Ctrl+Shift+*) stay global — those are app chrome,
      // not text input.
      if (matchesShortcut(e, SHORTCUTS.help)) {
        e.preventDefault();
        setHelpVisible?.((v: boolean) => !v);
        return;
      }
      const editableTarget = isEditableTarget(e.target);
      if (editableTarget && !(e.ctrlKey && e.shiftKey)) {
        return;
      }
      if (matchesShortcut(e, SHORTCUTS.newFile)) {
        e.preventDefault();
        showPrompt("New File", { placeholder: "file name..." }).then(async (name) => {
          if (name && projectPath) {
            const path = `${projectPath}/${name}`;
            try {
              const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
              await invoke("create_file", { path });
              handleFileSelect(path);
            } catch (error) {
              toast.error("Create file failed", error instanceof Error ? error.message : String(error));
            }
          }
        });
      } else if (matchesShortcut(e, SHORTCUTS.quickOpen)) {
        e.preventDefault();
        setQuickOpenMode?.("files");
      } else if (matchesShortcut(e, SHORTCUTS.commandHistory)) {
        e.preventDefault();
        showHistorySearch();
      } else if (matchesShortcut(e, SHORTCUTS.commandPalette)) {
        e.preventDefault();
        setPaletteVisible((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.newTerminal)) {
        e.preventDefault();
        addTab("powershell");
      } else if (matchesShortcut(e, SHORTCUTS.closeTerminalTab)) {
        e.preventDefault();
        closeTab(activeTabId);
      } else if (matchesShortcut(e, SHORTCUTS.searchFiles)) {
        e.preventDefault();
        setSearchVisible((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.openFolder)) {
        e.preventDefault();
        handleOpenFolder();
      } else if (matchesShortcut(e, SHORTCUTS.explorerFocus)) {
        e.preventDefault();
        setSearchVisible(false);
      } else if (matchesShortcut(e, SHORTCUTS.startAgent)) {
        e.preventDefault();
        showPrompt("Start Agent", { placeholder: "What should the agent do?" }).then((p) => {
          if (p) handleStartAgent(p);
        });
      } else if (matchesShortcut(e, SHORTCUTS.toggleZenMode)) {
        e.preventDefault();
        setZenMode?.((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.openDecisionInbox)) {
        e.preventDefault();
        openDecisionInbox?.();
      } else if (matchesShortcut(e, SHORTCUTS.toggleRightRail)) {
        e.preventDefault();
        setRightRailCollapsed?.((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.switchTerminalPane)) {
        e.preventDefault();
        openPaneSwitcher?.();
      } else if (matchesShortcut(e, SHORTCUTS.focusNextPane)) {
        e.preventDefault();
        void focusNextPane?.();
      } else if (matchesShortcut(e, SHORTCUTS.focusPreviousPane)) {
        e.preventDefault();
        void focusPreviousPane?.();
      } else if (matchesShortcut(e, SHORTCUTS.focusTerminal)) {
        // Ctrl+` — focus the active terminal pane
        e.preventDefault();
        const activeNativeSurface = document.querySelector(
          "[data-active='true'] [data-native-input-surface='true']",
        ) as HTMLElement | null;
        const nativeSurface = document.querySelector("[data-native-input-surface='true']") as HTMLElement | null;
        // Fallback for non-Tauri/jsdom/emergency opt-out WebView IME input.
        const activePane = document.querySelector(
          "[data-active='true'] [data-testid='terminal-ime-textarea']",
        ) as HTMLTextAreaElement | null;
        const fallback = document.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement | null;
        const target = activeNativeSurface ?? nativeSurface ?? activePane ?? fallback;
        target?.focus();
        if (target && (target === activePane || target === fallback)) {
          reportFallback(
            {
              source: "terminal.input",
              operation: "focus_webview_ime_fallback",
              severity: "warning",
              message: "Ctrl+` focused the WebView IME fallback because no native input surface was available.",
              userVisible: true,
            },
            { throttleMs: 30_000 },
          );
        } else if (!target) {
          reportFallback(
            {
              source: "terminal.input",
              operation: "focus_terminal_unavailable",
              severity: "warning",
              message: "Ctrl+` could not find a terminal input surface to focus.",
              userVisible: true,
            },
            { throttleMs: 30_000 },
          );
        }
      } else if (matchesShortcut(e, SHORTCUTS.closeEditor)) {
        e.preventDefault();
        if (activeFile) handleCloseFile(activeFile);
      } else if (matchesShortcut(e, SHORTCUTS.settings)) {
        e.preventDefault();
        setSettingsVisible((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.toggleSidebar)) {
        // Ctrl+B — toggle left sidebar (matches VS Code / Claude Code Desktop).
        e.preventDefault();
        setSidebarCollapsed?.((v: boolean) => !v);
      } else if (matchesShortcut(e, SHORTCUTS.previousSession)) {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.max(0, (idx === -1 ? 0 : idx) - 1);
          setActiveSessionId(sessions[next].id);
        }
      } else if (matchesShortcut(e, SHORTCUTS.nextSession)) {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.min(sessions.length - 1, (idx === -1 ? 0 : idx) + 1);
          setActiveSessionId(sessions[next].id);
        }
      } else if (matchesShortcut(e, SHORTCUTS.switchTerminalTab)) {
        e.preventDefault();
        if (tabs.length > 1) {
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
          setActiveTabId(tabs[next].id);
        }
      } else if (matchesShortcut(e, SHORTCUTS.sessionJump)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10);
        if (idx < sessions.length) setActiveSessionId(sessions[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    projectPath,
    tabs,
    addTab,
    closeTab,
    activeTabId,
    setActiveTabId,
    activeFile,
    sessions,
    activeSessionId,
    setActiveSessionId,
    setPaletteVisible,
    setSettingsVisible,
    setSearchVisible,
    handleOpenFolder,
    handleCloseFile,
    handleFileSelect,
    handleStartAgent,
    setQuickOpenMode,
    openPaneSwitcher,
    focusNextPane,
    focusPreviousPane,
    setHelpVisible,
    setSidebarCollapsed,
    setZenMode,
    openDecisionInbox,
    setRightRailCollapsed,
  ]);
}
