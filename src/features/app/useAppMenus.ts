import {
  Bot,
  ClipboardList,
  X as CloseIcon,
  FileX,
  FolderOpen,
  FolderX,
  GitBranch,
  GitPullRequest,
  Globe,
  History,
  Info,
  RadioTower,
  Search,
  Send,
  Settings as SettingsIcon,
  Shield,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useMemo } from "react";
import type { ShellType, TerminalPaneTarget } from "../../App";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { formatOperationalPaneChoice, resolveOperationalPaneChoice } from "../../shared/lib/operationalPaneSelection";
import { normalizeCommandInput } from "../../shared/lib/terminalInput";
import { toast } from "../../shared/store/toastStore";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { showPrompt } from "../../shared/ui/PromptDialog";
import type { CommandItem } from "../command-palette/CommandPalette";
import { showHistorySearch } from "../history/HistorySearchDialog";
import type { Menu } from "../menubar/MenuBar";
import {
  copyImeDiagnostics,
  disableImeDiagnostics,
  enableImeDiagnostics,
  imeDiagnosticsEnabled,
} from "../terminal/hooks/useCanvasIME";

interface UseAppMenusOptions {
  addTab: (shell: ShellType) => void;
  closeTab: (id: string) => void;
  switchTab?: (id: string) => undefined | boolean | Promise<undefined | boolean>;
  tabs?: Array<{ id: string; label: string; shell: ShellType; cwd?: string; worktreeBranch?: string }>;
  switchPane?: (tabId: string, paneId: string) => void | Promise<void>;
  openPaneSwitcher?: () => void;
  focusNextPane?: () => void | Promise<void>;
  focusPreviousPane?: () => void | Promise<void>;
  movePaneNext?: () => void | Promise<void>;
  movePanePrevious?: () => void | Promise<void>;
  equalizePanes?: () => void | Promise<void>;
  tilePanes?: () => void | Promise<void>;
  panes?: TerminalPaneTarget[];
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
    equalizePanes,
    tilePanes,
    panes = [],
    activeTabId,
    activeFile,
    projectPath,
    handleFileSelect,
    handleCloseFile,
    handleOpenFolder,
    handleCloseFolder,
    handleStartAgent,
    setPaletteVisible,
    setSettingsVisible,
    setSearchVisible,
    setWatchdogVisible,
    setAboutVisible,
    setHelpVisible,
    setWebInspectorVisible,
    setPrInspectorVisible,
  } = opts;

  // Compare Branch action extracted so the palette entry and the View menu
  // entry share one source of truth. Re-created on projectPath change so
  // the closure captures the latest repo.
  const compareBranch = useMemo(() => {
    return async () => {
      if (!projectPath) {
        toast.error("Compare Branch", "Open a folder first");
        return;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        type BranchInfo = { name: string; isHead: boolean; isRemote: boolean };
        const branches = await invoke<BranchInfo[]>("list_branches", { repoPath: projectPath });
        const current = branches.find((b) => b.isHead)?.name ?? "(unknown)";
        const options = branches
          .filter((b) => !b.isHead && !b.isRemote)
          .map((b) => b.name)
          .slice(0, 8)
          .join(", ");
        const head = await showPrompt(`Compare ${current} against branch`, {
          placeholder: options || "Enter a branch name",
        });
        const target = head?.trim();
        if (!target) return;
        if (target === current) {
          toast.error("Compare Branch", "Base and head must differ");
          return;
        }
        await invoke("start_branch_comparison", {
          repoPath: projectPath,
          baseBranch: current,
          headBranch: target,
        });
        toast.success("Branch comparison started", `${current} \u2190 ${target}`);
      } catch (e) {
        toast.error("Branch comparison failed", String(e));
      }
    };
  }, [projectPath]);

  const sendToPaneTarget = useMemo(() => {
    return async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        type PaneInfo = { name: string; role: string; shell_type: string; cwd: string };
        let panes: PaneInfo[] = [];
        try {
          panes = await invoke<PaneInfo[]>("list_panes_info");
        } catch (err) {
          reportInvokeFailure({
            source: "app-menu",
            operation: "list_panes_info",
            err,
            severity: "warning",
          });
          toast.warning("Pane list unavailable", formatFallbackError(err));
        }
        const targets = panes
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
        const count = await invoke<number>("send_keys_by_target", {
          target: trimmedTarget,
          data: normalizeCommandInput(text),
        });
        toast.success("Sent to pane", `${count} target${count === 1 ? "" : "s"}`);
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
        const { invoke } = await import("@tauri-apps/api/core");
        let panes: unknown[];
        try {
          panes = await invoke<unknown[]>("list_panes_info");
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
        if (panes.length < 1) {
          toast.error("Broadcast unavailable", "No live terminal panes are available.");
          return;
        }
        if (panes.length > 1) {
          const ok = await showConfirm({
            title: "Broadcast to all panes",
            description: `This will send the same input to ${panes.length} live panes.`,
            confirmLabel: `Send to ${panes.length} panes`,
            cancelLabel: "Review first",
          });
          if (!ok) return;
          let refreshedPanes: unknown[];
          try {
            refreshedPanes = await invoke<unknown[]>("list_panes_info");
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
        const count = await invoke<number>("broadcast_keys", { data: normalizeCommandInput(text) });
        toast.success("Broadcast sent", `${count} pane${count === 1 ? "" : "s"}`);
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

      await switchPane(result.pane.tabId, result.pane.paneId);
      toast.success("Terminal pane active", formatOperationalPaneChoice(result.pane));
    };
  }, [openPaneSwitcher, panes, switchPane]);

  const enableImeTrace = useMemo(() => {
    return () => {
      enableImeDiagnostics(window);
      toast.success("IME diagnostics enabled", "Reproduce the input bug, then copy the trace");
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

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "new-tab-ps",
        label: "New Terminal: PowerShell",
        description: "Open a new PowerShell tab",
        shortcut: "Ctrl+Shift+T",
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
        shortcut: "Ctrl+Shift+W",
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
        shortcut: "Ctrl+Shift+`",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "choose-tree", "pane", "focus", "window", "switch"],
        action: switchTerminalPane,
      },
      {
        id: "focus-next-terminal-pane",
        label: "Focus Next Terminal Pane",
        description: "Move focus to the next live pane in tmux order",
        shortcut: "Ctrl+Shift+]",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "pane", "next", "cycle", "focus"],
        action: () => void focusNextPane?.(),
      },
      {
        id: "focus-previous-terminal-pane",
        label: "Focus Previous Terminal Pane",
        description: "Move focus to the previous live pane in tmux order",
        shortcut: "Ctrl+Shift+[",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "pane", "previous", "prev", "cycle", "focus"],
        action: () => void focusPreviousPane?.(),
      },
      {
        id: "move-terminal-pane-next",
        label: "Move Pane Next",
        description: "Swap the active pane with the next pane in tmux order",
        shortcut: "Ctrl+B }",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "swap-pane", "move", "pane"],
        action: () => void movePaneNext?.(),
      },
      {
        id: "move-terminal-pane-previous",
        label: "Move Pane Previous",
        description: "Swap the active pane with the previous pane in tmux order",
        shortcut: "Ctrl+B {",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "swap-pane", "move", "pane"],
        action: () => void movePanePrevious?.(),
      },
      {
        id: "equalize-terminal-panes",
        label: "Equalize Pane Sizes",
        description: "Reset terminal split ratios to even sizes",
        shortcut: "Ctrl+B =",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "resize-pane", "even", "layout"],
        action: () => void equalizePanes?.(),
      },
      {
        id: "tile-terminal-panes",
        label: "Tile Terminal Panes",
        description: "Rebuild terminal panes into a balanced tiled layout",
        shortcut: "Ctrl+B Space",
        category: "Terminal",
        icon: TerminalIcon,
        keywords: ["tmux", "select-layout", "tiled", "even"],
        action: () => void tilePanes?.(),
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
        id: "open-settings",
        label: "Open Settings",
        description: "Edit preferences and model config",
        shortcut: "Ctrl+,",
        category: "View",
        icon: SettingsIcon,
        action: () => setSettingsVisible(true),
      },
      {
        id: "close-editor",
        label: "Close Editor",
        description: "Close the currently open file",
        category: "File",
        icon: FileX,
        action: () => activeFile && handleCloseFile(activeFile),
      },
      {
        id: "open-folder",
        label: "Open Folder",
        description: "Switch to a different project",
        category: "File",
        icon: FolderOpen,
        action: handleOpenFolder,
      },
      {
        id: "create-watchdog",
        label: "Create Watchdog",
        description: "Auto-respond to agent prompts",
        category: "Agent",
        icon: Shield,
        action: () => setWatchdogVisible(true),
      },
      {
        id: "pull-requests",
        label: "View Pull Requests",
        description: "Open the PR inspector",
        category: "View",
        icon: GitPullRequest,
        action: () => setPrInspectorVisible(true),
      },
      {
        id: "web-inspector",
        label: "Web Inspector",
        description: "Inspect a web page",
        category: "View",
        icon: Globe,
        action: () => setWebInspectorVisible(true),
      },
      {
        id: "about",
        label: "About Aether Terminal",
        description: "Version and credits",
        category: "Help",
        icon: Info,
        action: () => setAboutVisible(true),
      },
      {
        id: "start-agent",
        label: "Start Claude Agent",
        description: "Spawn a new agent with a custom prompt",
        shortcut: "Ctrl+Shift+A",
        category: "Agent",
        icon: Bot,
        action: async () => {
          const p = await showPrompt("Enter prompt for agent", { placeholder: "What should the agent do?" });
          if (p) handleStartAgent(p);
        },
      },
      {
        id: "close-folder",
        label: "Close Folder",
        description: "Return to the project picker",
        category: "File",
        icon: FolderX,
        action: handleCloseFolder,
      },
      {
        id: "search-files",
        label: "Search in Files",
        description: "Full-text search across the project",
        shortcut: "Ctrl+Shift+F",
        category: "View",
        icon: Search,
        action: () => setSearchVisible(true),
      },
      {
        id: "search-history",
        label: "Search Command History",
        description: "Semantic search across past terminal commands",
        shortcut: "Ctrl+R",
        category: "History",
        icon: History,
        keywords: ["semantic", "recall"],
        action: () => showHistorySearch(),
      },
      {
        id: "compare-branch",
        label: "Compare Branch...",
        description: "Overlay another branch as a read-only ghost diff",
        category: "View",
        icon: GitBranch,
        keywords: ["diff", "parallel", "ghost"],
        action: compareBranch,
      },
    ],
    [
      addTab,
      closeTab,
      activeTabId,
      activeFile,
      handleCloseFile,
      handleStartAgent,
      handleOpenFolder,
      handleCloseFolder,
      compareBranch,
      sendToPaneTarget,
      broadcastToAllPanes,
      switchTerminalTab,
      switchTerminalPane,
      focusNextPane,
      focusPreviousPane,
      movePaneNext,
      movePanePrevious,
      equalizePanes,
      tilePanes,
      enableImeTrace,
      copyImeTrace,
      disableImeTrace,
      setAboutVisible,
      setPrInspectorVisible,
      setSearchVisible,
      setSettingsVisible,
      setWatchdogVisible,
      setWebInspectorVisible,
    ],
  );

  const menus: Menu[] = useMemo(
    () => [
      {
        label: "File",
        items: [
          {
            label: "New File",
            shortcut: "Ctrl+N",
            action: async () => {
              const name = await showPrompt("New File", { placeholder: "file name..." });
              if (name && projectPath) {
                const { invoke } = await import("@tauri-apps/api/core");
                const path = `${projectPath}/${name}`;
                try {
                  await invoke("create_file", { path });
                  handleFileSelect(path);
                } catch (err) {
                  reportInvokeFailure({
                    source: "app-menu",
                    operation: "create_file",
                    err,
                    severity: "error",
                    userVisible: true,
                  });
                  toast.error("Create file failed", formatFallbackError(err));
                }
              }
            },
          },
          { label: "Open Folder...", shortcut: "Ctrl+Shift+O", action: handleOpenFolder },
          { label: "Close Folder", action: handleCloseFolder },
          { divider: true, label: "" },
          { label: "Save", shortcut: "Ctrl+S", action: () => {} },
          { divider: true, label: "" },
          {
            label: "Close Editor",
            shortcut: "Ctrl+W",
            action: () => activeFile && handleCloseFile(activeFile),
            disabled: !activeFile,
          },
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
          { divider: true, label: "" },
          { label: "Compare Branch...", action: compareBranch },
          { divider: true, label: "" },
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
          { divider: true, label: "" },
          { label: "Switch Terminal Tab...", action: switchTerminalTab },
          { label: "Switch Terminal Pane...", shortcut: "Ctrl+Shift+`", action: switchTerminalPane },
          { label: "Focus Next Pane", shortcut: "Ctrl+Shift+]", action: () => void focusNextPane?.() },
          { label: "Focus Previous Pane", shortcut: "Ctrl+Shift+[", action: () => void focusPreviousPane?.() },
          { label: "Move Pane Next", shortcut: "Ctrl+B }", action: () => void movePaneNext?.() },
          { label: "Move Pane Previous", shortcut: "Ctrl+B {", action: () => void movePanePrevious?.() },
          { label: "Equalize Pane Sizes", shortcut: "Ctrl+B =", action: () => void equalizePanes?.() },
          { label: "Tile Panes", shortcut: "Ctrl+B Space", action: () => void tilePanes?.() },
          { divider: true, label: "" },
          { label: "Send Command to Pane...", action: sendToPaneTarget },
          { label: "Broadcast Command to All Panes...", action: broadcastToAllPanes },
          { divider: true, label: "" },
          { label: "Enable IME Diagnostics", action: enableImeTrace },
          { label: "Copy IME Diagnostic Trace", action: copyImeTrace },
          { label: "Disable IME Diagnostics", action: disableImeTrace },
        ],
      },
      {
        label: "Help",
        items: [
          { label: "Help Guide", shortcut: "F1", action: () => setHelpVisible(true) },
          { divider: true, label: "" },
          { label: "About Aether Terminal", action: () => setAboutVisible(true) },
        ],
      },
    ],
    [
      handleOpenFolder,
      handleCloseFolder,
      addTab,
      activeFile,
      handleCloseFile,
      projectPath,
      handleFileSelect,
      compareBranch,
      sendToPaneTarget,
      broadcastToAllPanes,
      switchTerminalTab,
      switchTerminalPane,
      focusNextPane,
      focusPreviousPane,
      movePaneNext,
      movePanePrevious,
      equalizePanes,
      tilePanes,
      enableImeTrace,
      copyImeTrace,
      disableImeTrace,
      setPaletteVisible,
      setSearchVisible,
      setWebInspectorVisible,
      setPrInspectorVisible,
      setSettingsVisible,
      setHelpVisible,
      setAboutVisible,
    ],
  );

  return { commands, menus };
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
