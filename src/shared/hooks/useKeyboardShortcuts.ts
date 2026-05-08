import { useEffect } from "react";
import type { ShellType } from "../../App";
import { showHistorySearch } from "../../features/history/HistorySearchDialog";
import { toast } from "../store/toastStore";
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
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Bail out when the user is typing into an editable surface so
      // Ctrl+N/P/R/W don't steal keystrokes from Kanban task labels,
      // Watchdog rule inputs, Monaco, xterm, etc. F1 + the chord
      // shortcuts (Ctrl+Shift+*) stay global — those are app chrome,
      // not text input.
      if (e.key === "F1") {
        e.preventDefault();
        setHelpVisible?.((v: boolean) => !v);
        return;
      }
      const editableTarget = isEditableTarget(e.target);
      if (editableTarget && !(e.ctrlKey && e.shiftKey)) {
        return;
      }
      if (e.ctrlKey && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        showPrompt("New File", { placeholder: "file name..." }).then(async (name) => {
          if (name && projectPath) {
            const path = `${projectPath}/${name}`;
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("create_file", { path });
              handleFileSelect(path);
            } catch (error) {
              toast.error("Create file failed", error instanceof Error ? error.message : String(error));
            }
          }
        });
      } else if (e.ctrlKey && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        setQuickOpenMode?.("files");
      } else if (e.ctrlKey && !e.shiftKey && e.key === "r") {
        e.preventDefault();
        showHistorySearch();
      } else if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setPaletteVisible((v: boolean) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        addTab("powershell");
      } else if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        closeTab(activeTabId);
      } else if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setSearchVisible((v: boolean) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "O") {
        e.preventDefault();
        handleOpenFolder();
      } else if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        setSearchVisible(false);
      } else if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        showPrompt("Start Agent", { placeholder: "What should the agent do?" }).then((p) => {
          if (p) handleStartAgent(p);
        });
      } else if (e.ctrlKey && e.shiftKey && e.key === "`") {
        e.preventDefault();
        openPaneSwitcher?.();
      } else if (e.ctrlKey && e.shiftKey && e.key === "]") {
        e.preventDefault();
        void focusNextPane?.();
      } else if (e.ctrlKey && e.shiftKey && e.key === "[") {
        e.preventDefault();
        void focusPreviousPane?.();
      } else if (e.ctrlKey && e.key === "`") {
        // Ctrl+` — focus the active terminal pane
        e.preventDefault();
        // Find the visible native terminal IME textarea (inside active pane).
        const activePane = document.querySelector(
          "[data-active='true'] [data-testid='terminal-ime-textarea']",
        ) as HTMLTextAreaElement | null;
        const fallback = document.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement | null;
        (activePane ?? fallback)?.focus();
      } else if (e.ctrlKey && !e.shiftKey && e.key === "w") {
        e.preventDefault();
        if (activeFile) handleCloseFile(activeFile);
      } else if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        setSettingsVisible((v: boolean) => !v);
      } else if (e.ctrlKey && !e.shiftKey && (e.key === "b" || e.key === "B")) {
        // Ctrl+B — toggle left sidebar (matches VS Code / Claude Code Desktop).
        e.preventDefault();
        setSidebarCollapsed?.((v: boolean) => !v);
      } else if (e.ctrlKey && e.key === "[") {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.max(0, (idx === -1 ? 0 : idx) - 1);
          setActiveSessionId(sessions[next].id);
        }
      } else if (e.ctrlKey && e.key === "]") {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.min(sessions.length - 1, (idx === -1 ? 0 : idx) + 1);
          setActiveSessionId(sessions[next].id);
        }
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length > 1) {
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
          setActiveTabId(tabs[next].id);
        }
      } else if (e.ctrlKey && e.key >= "0" && e.key <= "9") {
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
  ]);
}
