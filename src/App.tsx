import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import appStyles from "./App.module.css";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { MenuBar, type Menu } from "./features/menubar/MenuBar";
import { FileTree } from "./features/file-tree/FileTree";
import { KanbanBoard } from "./features/kanban/KanbanBoard";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { AgentInspector } from "./features/agent-inspector/AgentInspector";
import { ToolkitPanel } from "./features/toolkit/ToolkitPanel";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import type { CommandItem } from "./features/command-palette/CommandPalette";

// Lazy load heavy components — not needed at initial render
const EditorPanel = lazy(() => import("./features/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
const CommandPalette = lazy(() => import("./features/command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const Settings = lazy(() => import("./features/settings/Settings").then((m) => ({ default: m.Settings })));
const WatchdogDialog = lazy(() => import("./features/watchdog/WatchdogDialog").then((m) => ({ default: m.WatchdogDialog })));
const WelcomeScreen = lazy(() => import("./features/welcome/WelcomeScreen").then((m) => ({ default: m.WelcomeScreen })));
const SearchPanel = lazy(() => import("./features/search/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const AboutDialog = lazy(() => import("./features/about/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const PRInspector = lazy(() => import("./features/pr-inspector/PRInspector").then((m) => ({ default: m.PRInspector })));
const WebInspector = lazy(() => import("./features/web-inspector/WebInspector").then((m) => ({ default: m.WebInspector })));
import { SplitPane } from "./shared/ui/SplitPane";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { TooltipProvider } from "./shared/ui/Tooltip";
import { ToastProvider } from "./shared/ui/Toast";
import { PromptDialog, showPrompt } from "./shared/ui/PromptDialog";
import { OnboardingOverlay } from "./shared/ui/OnboardingOverlay";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useAgentManager } from "./shared/hooks/useAgentManager";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useAppStore } from "./shared/store/appStore";
import { useThemeApplier } from "./shared/hooks/useTheme";
import { getActivePtyId } from "./features/terminal/hooks/useTerminal";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const {
    themeId,
    rootProjectPath, setRootProjectPath,
    paletteVisible, setPaletteVisible,
    settingsVisible, setSettingsVisible,
    watchdogVisible, setWatchdogVisible,
    searchVisible, setSearchVisible,
    aboutVisible, setAboutVisible,
    webInspectorVisible, setWebInspectorVisible,
    prInspectorVisible, setPrInspectorVisible,
    openFiles, activeFile, openFile, closeFile, clearFiles, setActiveFile,
  } = useAppStore();
  useThemeApplier(themeId);
  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd } =
    useTabManager("powershell");
  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent } =
    useAgentManager();

  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  const projectName = projectPath ? projectPath.split("/").filter(Boolean).pop() ?? "Aether" : "Aether";

  // Show window once React has mounted (window starts hidden to avoid white flash)
  useEffect(() => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().show().catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const title = projectPath ? `${projectName} — Aether Terminal` : "Aether Terminal";
    document.title = title;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title).catch(() => {});
    }).catch(() => {});
  }, [projectName, projectPath]);

  const handleOpenProject = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    setRootProjectPath(normalized);
    addTabWithCwd("powershell", normalized);
    clearFiles();
  }, [addTabWithCwd, setRootProjectPath, clearFiles]);

  const handleCloseFolder = useCallback(() => {
    setRootProjectPath(null);
    clearFiles();
  }, [setRootProjectPath, clearFiles]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        handleOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch { /* cancelled or not in Tauri */ }
  }, [handleOpenProject]);

  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    clearFiles();
  }, [setActiveTabId, clearFiles]);

  const { branch, changedFiles, refresh: refreshGitStatus } = useGitStatus(projectPath);
  const [fileTreeKey, setFileTreeKey] = useState(0);

  const handleRefresh = useCallback(() => {
    refreshGitStatus();
    setFileTreeKey((k) => k + 1);
  }, [refreshGitStatus]);

  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? (activeAgent.status === "thinking" ? "thinking" : activeAgent.status === "coding" ? "edit" : "idle")
    : "idle";

  // Worktree handlers
  const handleCreateWorktree = useCallback(async (_sessionId: string, branchName: string) => {
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      const wt = await tauriInvoke<{ name: string; path: string; branch: string; is_main: boolean; head_sha: string; status: string }>("create_worktree", {
        repoPath: projectPath,
        branchName,
      });
      // Add a terminal tab scoped to the worktree with branch badge
      addTabWithCwd("powershell", wt.path, branchName);
      handleRefresh();
      return { ...wt, status: wt.status as "Clean" | "Modified" | "Conflicted" };
    } catch {
      return null;
    }
  }, [projectPath, addTabWithCwd, handleRefresh]);

  const handleRemoveWorktree = useCallback(async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session?.worktree) return;
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      await tauriInvoke("remove_worktree", {
        repoPath: projectPath,
        worktreeName: session.worktree.name,
        deleteBranch: true,
      });
      stopAgent(sessionId);
      handleRefresh();
    } catch { /* ignore */ }
  }, [sessions, projectPath, stopAgent, handleRefresh]);

  const handleStartAgent = useCallback(async (prompt: string, model?: string) => {
    try {
      const agentId = await startAgent(prompt, projectPath, model);
      addTabWithCwd("powershell", projectPath);
      return agentId;
    } catch { /* */ }
  }, [startAgent, projectPath, addTabWithCwd]);

  const handleFileSelect = useCallback((path: string) => {
    setOpenInDiff(false);
    openFile(path);
  }, [openFile]);

  const handleOpenDiff = useCallback((path: string) => {
    setOpenInDiff(true);
    openFile(path);
  }, [openFile]);

  const handleCloseFile = useCallback((path: string) => {
    const modDots = document.querySelectorAll("[class*='modDot']");
    if (modDots.length > 0 && !window.confirm("You have unsaved changes. Close anyway?")) return;
    closeFile(path);
  }, [closeFile]);

  const handleRunCommand = useCallback(async (command: string) => {
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      // Use the most recently focused terminal
      const activeId = getActivePtyId();
      if (activeId) {
        await tauriInvoke("write_terminal", { id: activeId, data: command + "\r" });
        return;
      }
      // Fallback: try any available terminal
      const terminals = await tauriInvoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await tauriInvoke("write_terminal", { id: terminals[0], data: command + "\r" });
      }
    } catch (err) {
      console.error("[handleRunCommand] failed:", err);
    }
  }, []);

  // Kanban move side effects: create worktree + terminal tab when moving to in_progress
  // Session switching = holistic workspace switch
  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    const agent = sessions.find((s) => s.id === sessionId);
    if (agent) {
      const matchTab = tabs.find((t) => t.cwd && agent.prompt.includes(t.cwd.split("/").pop() ?? ""));
      if (matchTab) handleTabSwitch(matchTab.id);
    }
  }, [sessions, tabs, setActiveSessionId, handleTabSwitch]);

  function navSession(delta: number) {
    if (sessions.length === 0) return;
    const idx = sessions.findIndex((s) => s.id === activeSessionId);
    const next = Math.max(0, Math.min(sessions.length - 1, (idx === -1 ? 0 : idx) + delta));
    setActiveSessionId(sessions[next].id);
  }

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
    { id: "start-agent", label: "Start Claude Agent", shortcut: "Ctrl+Shift+A", action: async () => { const p = await showPrompt("Enter prompt for agent", { placeholder: "What should the agent do?" }); if (p) handleStartAgent(p); } },
    { id: "close-folder", label: "Close Folder", action: handleCloseFolder },
    { id: "search-files", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible(true) },
  ], [addTab, closeTab, activeTabId, activeFile, handleCloseFile, handleStartAgent, handleOpenFolder, handleCloseFolder]);

  const menus: Menu[] = useMemo(() => [
    {
      label: "File",
      items: [
        { label: "New File", shortcut: "Ctrl+N", action: async () => {
          const name = await showPrompt("New File", { placeholder: "file name..." });
          if (name && projectPath) {
            const { invoke: inv } = await import("@tauri-apps/api/core");
            await inv("create_file", { path: `${projectPath}/${name}` }).catch(() => {});
            handleFileSelect(`${projectPath}/${name}`);
          }
        }},
        { label: "Open Folder...", shortcut: "Ctrl+Shift+O", action: handleOpenFolder },
        { label: "Close Folder", action: handleCloseFolder },
        { divider: true, label: "" },
        { label: "Save", shortcut: "Ctrl+S", action: () => { /* handled by editor */ } },
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
    {
      label: "Help",
      items: [
        { label: "About Aether Terminal", action: () => setAboutVisible(true) },
      ],
    },
  ], [handleOpenFolder, handleCloseFolder, addTab, activeFile, handleCloseFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        showPrompt("New File", { placeholder: "file name..." }).then(async (name) => {
          if (name && projectPath) {
            const { invoke: inv } = await import("@tauri-apps/api/core");
            await inv("create_file", { path: `${projectPath}/${name}` }).catch(() => {});
            handleFileSelect(`${projectPath}/${name}`);
          }
        });
      }
      else if (e.ctrlKey && e.shiftKey && e.key === "P") { e.preventDefault(); setPaletteVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); addTab("powershell"); }
      else if (e.ctrlKey && e.shiftKey && e.key === "W") { e.preventDefault(); closeTab(activeTabId); }
      else if (e.ctrlKey && e.shiftKey && e.key === "F") { e.preventDefault(); setSearchVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "O") { e.preventDefault(); handleOpenFolder(); }
      else if (e.ctrlKey && e.shiftKey && e.key === "E") { e.preventDefault(); setSearchVisible(false); }
      else if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        showPrompt("Start Agent", { placeholder: "What should the agent do?" }).then((p) => { if (p) handleStartAgent(p); });
      }
      else if (e.ctrlKey && !e.shiftKey && e.key === "w") { e.preventDefault(); if (activeFile) handleCloseFile(activeFile); }
      else if (e.ctrlKey && e.key === ",") { e.preventDefault(); setSettingsVisible((v) => !v); }
      else if (e.ctrlKey && e.key === "[") { e.preventDefault(); navSession(-1); }
      else if (e.ctrlKey && e.key === "]") { e.preventDefault(); navSession(1); }
      else if (e.ctrlKey && e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key);
        if (idx < sessions.length) setActiveSessionId(sessions[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTabId, sessions, setActiveSessionId]);

  const terminalTabs = tabs.map((tab) => (
    <div key={tab.id} className={appStyles.terminalTabPane} data-active={tab.id === activeTabId}>
      <TerminalPane shell={tab.shell} cwd={tab.cwd} />
    </div>
  ));

  // Welcome screen when no project is open
  if (!rootProjectPath) {
    return (
      <TooltipProvider>
      <ToastProvider>
        <div className="app-container">
          <Suspense fallback={null}>
            <WelcomeScreen onOpenProject={handleOpenProject} />
          </Suspense>
        </div>
      </ToastProvider>
      </TooltipProvider>
    );
  }

  const editorArea = activeFile ? (
    <div className={appStyles.editorArea}>
      <div className={appStyles.editorTabsBar}>
        {openFiles.map((f) => {
          const name = f.split("/").pop() ?? f;
          return (
            <button
              key={f}
              className={appStyles.editorTab}
              data-active={f === activeFile}
              onClick={() => setActiveFile(f)}
            >
              {name}
              <span
                role="button"
                className={appStyles.editorTabClose}
                aria-label={`Close ${name}`}
                onClick={(e) => { e.stopPropagation(); handleCloseFile(f); }}
              >×</span>
            </button>
          );
        })}
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className={appStyles.editorLoading}>Loading editor...</div>}>
          <EditorPanel filePath={activeFile} onClose={() => handleCloseFile(activeFile!)} projectPath={projectPath} initialLine={editorLine} initialDiffMode={openInDiff} />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null;

  return (
    <TooltipProvider>
    <ToastProvider>
    <div className="app-container">
      <ProjectHeaderBar
        projectName={projectName}
        branch={branch}
        changedCount={changedFiles.length}
        status={headerStatus as "idle" | "edit" | "thinking"}
        activeAgent={activeAgent ? { model: activeAgent.model, cost: activeAgent.cost } : null}
        onOpenSettings={() => setSettingsVisible(true)}
        onRefresh={handleRefresh}
      />
      <MenuBar menus={menus} />

      <main className="app-main" role="main">
        <div className="left-panel" role="navigation" aria-label="Project sidebar">
          <FileTree key={fileTreeKey} rootPath={projectPath} onFileSelect={handleFileSelect} onOpenDiff={handleOpenDiff} changedFiles={changedFiles} />
          <KanbanBoard onStartAgent={handleStartAgent} />
          {searchVisible && <Suspense fallback={null}><SearchPanel
            visible
            rootPath={projectPath}
            onClose={() => setSearchVisible(false)}
            onResultClick={(file, line) => { handleFileSelect(file); setEditorLine(line); }}
          /></Suspense>}
        </div>

        <div className="center-panel" role="region" aria-label="Terminal and editor">
          {editorArea ? (
            <SplitPane
              direction="vertical"
              defaultRatio={0.5}
              first={editorArea}
              second={<div className={appStyles.terminalContainer}>{terminalTabs}</div>}
            />
          ) : (
            terminalTabs
          )}
        </div>

        <div className="right-panel" role="complementary" aria-label="Agent inspector">
          <AgentInspector
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onStartAgent={handleStartAgent}
            onStopAgent={stopAgent}
            onCreateWorktree={handleCreateWorktree}
            onRemoveWorktree={handleRemoveWorktree}
          />
          <ToolkitPanel projectName={projectName} onRunCommand={handleRunCommand} />
        </div>
      </main>

      <WorkspaceTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleTabSwitch}
        onCloseTab={closeTab}
        onNewTab={addTab}
      />

      {paletteVisible && <Suspense fallback={null}><CommandPalette visible onClose={() => setPaletteVisible(false)} commands={commands} /></Suspense>}
      {settingsVisible && <Suspense fallback={null}><Settings visible onClose={() => setSettingsVisible(false)} /></Suspense>}
      {watchdogVisible && <Suspense fallback={null}><WatchdogDialog visible onClose={() => setWatchdogVisible(false)} /></Suspense>}
      {aboutVisible && <Suspense fallback={null}><AboutDialog visible onClose={() => setAboutVisible(false)} /></Suspense>}
      {webInspectorVisible && <Suspense fallback={null}><WebInspector visible onClose={() => setWebInspectorVisible(false)} /></Suspense>}
      {prInspectorVisible && <Suspense fallback={null}><PRInspector visible projectPath={projectPath} onClose={() => setPrInspectorVisible(false)} onStartReview={(prompt) => handleStartAgent(prompt)} /></Suspense>}
      <PromptDialog />
      <OnboardingOverlay />
    </div>
    </ToastProvider>
    </TooltipProvider>
  );
}
