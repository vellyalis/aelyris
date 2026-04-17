import { useMemo } from "react";
import {
  Terminal as TerminalIcon,
  X as CloseIcon,
  Settings as SettingsIcon,
  FolderOpen,
  FolderX,
  Shield,
  GitPullRequest,
  Globe,
  Info,
  Bot,
  Search,
  History,
  FileX,
} from "lucide-react";
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
  setHelpVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setWebInspectorVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setPrInspectorVisible: (v: boolean | ((p: boolean) => boolean)) => void;
}

export function useAppMenus(opts: UseAppMenusOptions) {
  const {
    addTab, closeTab, activeTabId, activeFile, projectPath,
    handleFileSelect, handleCloseFile, handleOpenFolder, handleCloseFolder,
    handleStartAgent,
    setPaletteVisible, setSettingsVisible, setSearchVisible,
    setWatchdogVisible, setAboutVisible, setHelpVisible, setWebInspectorVisible, setPrInspectorVisible,
  } = opts;

  const commands: CommandItem[] = useMemo(() => [
    { id: "new-tab-ps", label: "New Terminal: PowerShell", description: "Open a new PowerShell tab", shortcut: "Ctrl+Shift+T", category: "Terminal", icon: TerminalIcon, keywords: ["pwsh", "shell"], action: () => addTab("powershell") },
    { id: "new-tab-cmd", label: "New Terminal: CMD", description: "Open a new CMD tab", category: "Terminal", icon: TerminalIcon, keywords: ["cmd.exe", "prompt"], action: () => addTab("cmd") },
    { id: "new-tab-gitbash", label: "New Terminal: Git Bash", description: "Open a new Git Bash tab", category: "Terminal", icon: TerminalIcon, keywords: ["bash", "unix"], action: () => addTab("gitbash") },
    { id: "new-tab-wsl", label: "New Terminal: WSL", description: "Open a new WSL tab", category: "Terminal", icon: TerminalIcon, keywords: ["linux", "ubuntu"], action: () => addTab("wsl") },
    { id: "close-tab", label: "Close Current Tab", description: "Close the active terminal tab", shortcut: "Ctrl+Shift+W", category: "Terminal", icon: CloseIcon, action: () => closeTab(activeTabId) },
    { id: "open-settings", label: "Open Settings", description: "Edit preferences and model config", shortcut: "Ctrl+,", category: "View", icon: SettingsIcon, action: () => setSettingsVisible(true) },
    { id: "close-editor", label: "Close Editor", description: "Close the currently open file", category: "File", icon: FileX, action: () => activeFile && handleCloseFile(activeFile) },
    { id: "open-folder", label: "Open Folder", description: "Switch to a different project", category: "File", icon: FolderOpen, action: handleOpenFolder },
    { id: "create-watchdog", label: "Create Watchdog", description: "Auto-respond to agent prompts", category: "Agent", icon: Shield, action: () => setWatchdogVisible(true) },
    { id: "pull-requests", label: "View Pull Requests", description: "Open the PR inspector", category: "View", icon: GitPullRequest, action: () => setPrInspectorVisible(true) },
    { id: "web-inspector", label: "Web Inspector", description: "Inspect a web page", category: "View", icon: Globe, action: () => setWebInspectorVisible(true) },
    { id: "about", label: "About Aether Terminal", description: "Version and credits", category: "Help", icon: Info, action: () => setAboutVisible(true) },
    { id: "start-agent", label: "Start Claude Agent", description: "Spawn a new agent with a custom prompt", shortcut: "Ctrl+Shift+A", category: "Agent", icon: Bot, action: async () => {
      const p = await showPrompt("Enter prompt for agent", { placeholder: "What should the agent do?" });
      if (p) handleStartAgent(p);
    }},
    { id: "close-folder", label: "Close Folder", description: "Return to the project picker", category: "File", icon: FolderX, action: handleCloseFolder },
    { id: "search-files", label: "Search in Files", description: "Full-text search across the project", shortcut: "Ctrl+Shift+F", category: "View", icon: Search, action: () => setSearchVisible(true) },
    { id: "search-history", label: "Search Command History", description: "Find and replay a past terminal command", category: "History", icon: History, action: async () => {
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
    { label: "Help", items: [
      { label: "Help Guide", shortcut: "F1", action: () => setHelpVisible(true) },
      { divider: true, label: "" },
      { label: "About Aether Terminal", action: () => setAboutVisible(true) },
    ] },
  ], [handleOpenFolder, handleCloseFolder, addTab, activeFile, handleCloseFile, projectPath, handleFileSelect]);

  return { commands, menus };
}
