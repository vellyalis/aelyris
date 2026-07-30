import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  Bot,
  FileX,
  FolderOpen,
  FolderX,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  History,
  Info,
  Maximize2,
  Search,
  Settings as SettingsIcon,
  Shield,
} from "lucide-react";
import { useMemo } from "react";
import { PRODUCT_NAME } from "../../shared/constants/product";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { shortcutFor } from "../../shared/lib/shortcutRegistry";
import { toast } from "../../shared/store/toastStore";
import { showPrompt } from "../../shared/ui/PromptDialog";
import type { CommandItem } from "../command-palette/CommandPalette";
import { showHistorySearch } from "../history/HistorySearchDialog";
import type { Menu } from "../menubar/MenuBar";
import { type UseTerminalMenuCommandsOptions, useTerminalMenuCommands } from "./useTerminalMenuCommands";

interface UseAppMenusOptions extends UseTerminalMenuCommandsOptions {
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
  setMergeQueueVisible: (v: boolean | ((p: boolean) => boolean)) => void;
  setZenMode?: (v: boolean | ((prev: boolean) => boolean)) => void;
  openDecisionInbox?: () => void;
  setRightRailCollapsed?: (v: boolean | ((prev: boolean) => boolean)) => void;
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
    rotatePanesNext,
    rotatePanesPrevious,
    equalizePanes,
    tilePanes,
    syncPanesOn,
    syncPanesOff,
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
    setMergeQueueVisible,
    setZenMode,
    openDecisionInbox,
    setRightRailCollapsed,
    splitPaneRight,
    splitPaneDown,
  } = opts;

  const { terminalCommands, terminalMenu } = useTerminalMenuCommands({
    addTab,
    closeTab,
    switchTab,
    tabs,
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
    panes,
    activeTabId,
    splitPaneRight,
    splitPaneDown,
  });

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
        const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
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

  const commands: CommandItem[] = useMemo(
    () => [
      ...terminalCommands,
      {
        id: "toggle-zen-mode",
        label: "Toggle Zen Mode",
        description: "Hide side rails and top chrome while keeping the status bar visible",
        shortcut: shortcutFor("toggleZenMode"),
        category: "View",
        icon: Maximize2,
        keywords: ["focus", "minimal", "chrome", "rails"],
        action: () => setZenMode?.((v: boolean) => !v),
      },
      {
        id: "toggle-right-rail",
        label: "Toggle Right Rail",
        description: "Show or hide the contextual inspector",
        shortcut: shortcutFor("toggleRightRail"),
        category: "View",
        icon: Maximize2,
        action: () => setRightRailCollapsed?.((v: boolean) => !v),
      },
      {
        id: "open-settings",
        label: "Open Settings",
        description: "Edit preferences and model config",
        shortcut: shortcutFor("settings"),
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
        id: "open-decision-inbox",
        label: "Open Decision Inbox",
        description: "Focus the first pending human approval",
        shortcut: shortcutFor("openDecisionInbox"),
        category: "Agent",
        icon: Shield,
        keywords: ["approval", "deny", "human gate", "decision"],
        action: () => openDecisionInbox?.(),
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
        id: "merge-queue",
        label: "Ready to Merge",
        description: "Review done agent branches and their merge outcomes",
        category: "View",
        icon: GitMerge,
        action: () => setMergeQueueVisible(true),
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
        label: `About ${PRODUCT_NAME}`,
        description: "Version and credits",
        category: "Help",
        icon: Info,
        action: () => setAboutVisible(true),
      },
      {
        id: "start-agent",
        label: "Start Claude Agent",
        description: "Spawn a new agent with a custom prompt",
        shortcut: shortcutFor("startAgent"),
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
        shortcut: shortcutFor("searchFiles"),
        category: "View",
        icon: Search,
        action: () => setSearchVisible(true),
      },
      {
        id: "search-history",
        label: "Search Command History",
        description: "Semantic search across past terminal commands",
        shortcut: shortcutFor("commandHistory"),
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
      activeFile,
      compareBranch,
      handleCloseFile,
      handleCloseFolder,
      handleOpenFolder,
      handleStartAgent,
      openDecisionInbox,
      setAboutVisible,
      setMergeQueueVisible,
      setPrInspectorVisible,
      setRightRailCollapsed,
      setSearchVisible,
      setSettingsVisible,
      setWatchdogVisible,
      setWebInspectorVisible,
      setZenMode,
      terminalCommands,
    ],
  );

  const menus: Menu[] = useMemo(
    () => [
      {
        label: "File",
        items: [
          {
            label: "New File",
            shortcut: shortcutFor("newFile"),
            action: async () => {
              const name = await showPrompt("New File", { placeholder: "file name..." });
              if (name && projectPath) {
                const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
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
          { label: "Open Folder...", shortcut: shortcutFor("openFolder"), action: handleOpenFolder },
          { label: "Close Folder", action: handleCloseFolder },
          { divider: true, label: "" },
          { label: "Save", shortcut: shortcutFor("save"), action: () => {} },
          { divider: true, label: "" },
          {
            label: "Close Editor",
            shortcut: shortcutFor("closeEditor"),
            action: () => activeFile && handleCloseFile(activeFile),
            disabled: !activeFile,
          },
          { label: "Settings", shortcut: shortcutFor("settings"), action: () => setSettingsVisible(true) },
        ],
      },
      {
        label: "Edit",
        items: [
          { label: "Undo", shortcut: shortcutFor("undo"), action: () => document.execCommand("undo") },
          { label: "Redo", shortcut: shortcutFor("redo"), action: () => document.execCommand("redo") },
          { divider: true, label: "" },
          { label: "Cut", shortcut: shortcutFor("cut"), action: () => document.execCommand("cut") },
          { label: "Copy", shortcut: shortcutFor("copy"), action: () => document.execCommand("copy") },
          { label: "Paste", shortcut: shortcutFor("paste"), action: () => document.execCommand("paste") },
          { divider: true, label: "" },
          { label: "Find", shortcut: shortcutFor("findInFile"), disabled: true, action: () => {} },
          { label: "Replace", shortcut: shortcutFor("replaceInFile"), disabled: true, action: () => {} },
        ],
      },
      {
        label: "View",
        items: [
          { label: "Command Palette", shortcut: shortcutFor("commandPalette"), action: () => setPaletteVisible(true) },
          { label: "Search in Files", shortcut: shortcutFor("searchFiles"), action: () => setSearchVisible(true) },
          { divider: true, label: "" },
          { label: "Compare Branch...", action: compareBranch },
          { divider: true, label: "" },
          {
            label: "Toggle Zen Mode",
            shortcut: shortcutFor("toggleZenMode"),
            action: () => setZenMode?.((v: boolean) => !v),
          },
          { divider: true, label: "" },
          { label: "Web Inspector", action: () => setWebInspectorVisible((v) => !v) },
          { label: "Pull Requests", action: () => setPrInspectorVisible((v) => !v) },
          { label: "Ready to Merge", action: () => setMergeQueueVisible((v) => !v) },
        ],
      },
      terminalMenu,
      {
        label: "Help",
        items: [
          { label: "Help Guide", shortcut: shortcutFor("help"), action: () => setHelpVisible(true) },
          { divider: true, label: "" },
          { label: `About ${PRODUCT_NAME}`, action: () => setAboutVisible(true) },
        ],
      },
    ],
    [
      activeFile,
      compareBranch,
      handleCloseFile,
      handleCloseFolder,
      handleFileSelect,
      handleOpenFolder,
      projectPath,
      setAboutVisible,
      setHelpVisible,
      setMergeQueueVisible,
      setPaletteVisible,
      setPrInspectorVisible,
      setSearchVisible,
      setSettingsVisible,
      setWebInspectorVisible,
      setZenMode,
      terminalMenu,
    ],
  );

  return { commands, menus };
}
