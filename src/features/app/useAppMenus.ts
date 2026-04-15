import { useMemo } from "react";
import { showPrompt } from "../../shared/ui/PromptDialog";
import type { Menu } from "../menubar/MenuBar";
import type { CommandItem } from "../command-palette/CommandPalette";
import type { ShellType } from "../../App";

interface UseAppMenusOptions {
  addTab: (shell: ShellType) => void;
  closeTab: (id: string) => void;
  activeTabId: string;
  activeFile: string | null;
  projectPath: string;
  handleFileSelect: (path: string) => void;
  handleCloseFile: (path: string) => void;
  handleOpenFolder: () => void;
  handleCloseFolder: () => void;
  handleStartAgent: (prompt: string) => void;
  setPaletteVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setSettingsVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setSearchVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setWatchdogVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setAboutVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setWebInspectorVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setPrInspectorVisible: (v: boolean | ((p: boolean) => boolean)) => void;
}

export function useAppMenus(opts: UseAppMenusOptions) {
  const {
    addTab, closeTab, activeTabId, activeFile, projectPath,
    handleFileSelect, handleCloseFile, handleOpenFolder, handleCloseFolder,
    handleStartAgent,
    setPaletteVisible, setSettingsVisible, setSearchVisible,
    setWatchdogVisible, setAboutVisible, setWebInspectorVisible, setPrInspectorVisible,
  } = opts;

  const commands: CommandItem[] = useMemo(() => [
    { id: "new-tab-ps", label: "New Terminal: PowerShell", shortcut: "Ctrl+Shift+T", action: () => addTab("powershell") },
    { id: "new-tab-cmd", label: "New Terminal: CMD", action: () => addTab("cmd") },
    { id: "new-tab-gitbash", label: "New Terminal: Git Bash", action: () => addTab("gitbash") },
    { id: "new-tab-wsl", label: "New Terminal: WSL", action: () => addTab("wsl") },
    { id: "close-tab", label: "Close Current Tab", shortcut: "Ctrl+Shift+W", action: () => closeTab(activeTabId) },
    { id: "open-settings", label: "Open Settings", shortcut: "Ctrl+,", action: () => setSettingsVisible(true) },
    { id: "close-editor", label: "Close Editor", action: () => activeFile && handleCloseFile(activeFile) },
    { id: "open-folder", label: "Open Folder", action: handleOpenFolder },
    { id: "create-watchdog", label: "Create Watchdog", action: () => setWatchdogVisible(true) },
    { id: "pull-requests", label: "View Pull Requests", action: () => setPrInspectorVisible(true) },
    { id: "web-inspector", label: "Web Inspector", action: () => setWebInspectorVisible(true) },
    { id: "about", label: "About Aether Terminal", action: () => setAboutVisible(true) },
    { id: "start-agent", label: "Start Claude Agent", shortcut: "Ctrl+Shift+A", action: async () => {
      const p = await showPrompt("Enter prompt for agent", { placeholder: "What should the agent do?" });
      if (p) handleStartAgent(p);
    }},
    { id: "close-folder", label: "Close Folder", action: handleCloseFolder },
    { id: "search-files", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible(true) },
    { id: "search-history", label: "Search Command History", action: async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const results = await invoke<string[]>("recent_commands", { limit: 50 });
        if (results.length === 0) { showPrompt("No command history", { placeholder: "No commands recorded yet" }); return; }
        const query = await showPrompt("Command History", { placeholder: `${results.length} commands — type to filter...` });
        if (query) {
          const filtered = await invoke<Array<{ command: string }>>( "search_command_history", { query, limit: 10 });
          if (filtered.length > 0) {
            const cmd = filtered[0].command;
            const { getActivePtyId } = await import("../../features/terminal/hooks/useTerminal");
            const activeId = getActivePtyId();
            if (activeId) await invoke("write_terminal", { id: activeId, data: cmd + "\r" });
          }
        }
      } catch { /* not in Tauri */ }
    }},
  ], [addTab, closeTab, activeTabId, activeFile, handleCloseFile, handleStartAgent, handleOpenFolder, handleCloseFolder]);

  const menus: Menu[] = useMemo(() => [
    {
      label: "File",
      items: [
        { label: "New File", shortcut: "Ctrl+N", action: async () => {
          const name = await showPrompt("New File", { placeholder: "file name..." });
          if (name && projectPath) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("create_file", { path: `${projectPath}/${name}` }).catch(() => {});
            handleFileSelect(`${projectPath}/${name}`);
          }
        }},
        { label: "Open Folder...", shortcut: "Ctrl+Shift+O", action: handleOpenFolder },
        { label: "Close Folder", action: handleCloseFolder },
        { divider: true, label: "" },
        { label: "Save", shortcut: "Ctrl+S", action: () => {} },
        { divider: true, label: "" },
        { label: "Close Editor", shortcut: "Ctrl+W", action: () => activeFile && handleCloseFile(activeFile), disabled: !activeFile },
        { label: "Settings", shortcut: "Ctrl+,", action: () => setSettingsVisible(true) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => document.execCommand("undo") },
        { label: "Redo", shortcut: "Ctrl+Y", action: () => document.execCommand("redo") },
        { divider: true, label: "" },
        { label: "Cut", shortcut: "Ctrl+X", action: () => document.execCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", action: () => document.execCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", action: () => document.execCommand("paste") },
        { divider: true, label: "" },
        { label: "Find", shortcut: "Ctrl+F", disabled: true, action: () => {} },
        { label: "Replace", shortcut: "Ctrl+H", disabled: true, action: () => {} },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette", shortcut: "Ctrl+Shift+P", action: () => setPaletteVisible(true) },
        { label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible(true) },
        { label: "Web Inspector", action: () => setWebInspectorVisible((v) => !v) },
        { label: "Pull Requests", action: () => setPrInspectorVisible((v) => !v) },
      ],
    },
    {
      label: "Terminal",
      items: [
        { label: "New Terminal", shortcut: "Ctrl+Shift+T", action: () => addTab("powershell") },
        { label: "New CMD", action: () => addTab("cmd") },
        { label: "New Git Bash", action: () => addTab("gitbash") },
        { label: "New WSL", action: () => addTab("wsl") },
      ],
    },
    { label: "Help", items: [{ label: "About Aether Terminal", action: () => setAboutVisible(true) }] },
  ], [handleOpenFolder, handleCloseFolder, addTab, activeFile, handleCloseFile, projectPath, handleFileSelect]);

  return { commands, menus };
}
