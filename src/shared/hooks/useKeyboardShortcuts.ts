import { useEffect } from "react";
import { showPrompt } from "../ui/PromptDialog";
import type { ShellType } from "../../App";

interface UseKeyboardShortcutsOptions {
  projectPath: string;
  addTab: (shell: ShellType) => void;
  closeTab: (id: string) => void;
  activeTabId: string;
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
}

export function useKeyboardShortcuts({
  projectPath, addTab, closeTab, activeTabId, activeFile,
  sessions, activeSessionId, setActiveSessionId,
  setPaletteVisible, setSettingsVisible, setSearchVisible,
  handleOpenFolder, handleCloseFile, handleFileSelect, handleStartAgent,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        showPrompt("New File", { placeholder: "file name..." }).then(async (name) => {
          if (name && projectPath) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("create_file", { path: `${projectPath}/${name}` }).catch(() => {});
            handleFileSelect(`${projectPath}/${name}`);
          }
        });
      }
      else if (e.ctrlKey && e.shiftKey && e.key === "P") { e.preventDefault(); setPaletteVisible((v: boolean) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); addTab("powershell"); }
      else if (e.ctrlKey && e.shiftKey && e.key === "W") { e.preventDefault(); closeTab(activeTabId); }
      else if (e.ctrlKey && e.shiftKey && e.key === "F") { e.preventDefault(); setSearchVisible((v: boolean) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "O") { e.preventDefault(); handleOpenFolder(); }
      else if (e.ctrlKey && e.shiftKey && e.key === "E") { e.preventDefault(); setSearchVisible(false); }
      else if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        showPrompt("Start Agent", { placeholder: "What should the agent do?" }).then((p) => { if (p) handleStartAgent(p); });
      }
      else if (e.ctrlKey && !e.shiftKey && e.key === "w") { e.preventDefault(); if (activeFile) handleCloseFile(activeFile); }
      else if (e.ctrlKey && e.key === ",") { e.preventDefault(); setSettingsVisible((v: boolean) => !v); }
      else if (e.ctrlKey && e.key === "[") {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.max(0, (idx === -1 ? 0 : idx) - 1);
          setActiveSessionId(sessions[next].id);
        }
      }
      else if (e.ctrlKey && e.key === "]") {
        e.preventDefault();
        if (sessions.length > 0) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = Math.min(sessions.length - 1, (idx === -1 ? 0 : idx) + 1);
          setActiveSessionId(sessions[next].id);
        }
      }
      else if (e.ctrlKey && e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key);
        if (idx < sessions.length) setActiveSessionId(sessions[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    projectPath, addTab, closeTab, activeTabId, activeFile,
    sessions, activeSessionId, setActiveSessionId,
    setPaletteVisible, setSettingsVisible, setSearchVisible,
    handleOpenFolder, handleCloseFile, handleFileSelect, handleStartAgent,
  ]);
}
