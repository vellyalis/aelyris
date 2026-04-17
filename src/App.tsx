import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import appStyles from "./App.module.css";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { MenuBar } from "./features/menubar/MenuBar";
import { FileTree } from "./features/file-tree/FileTree";
import { PaneTreeContainer } from "./features/terminal/pane-tree";
import { AgentTerminal } from "./features/agent-terminal";
import { useAppMenus } from "./features/app/useAppMenus";
import { StatusBar } from "./features/statusbar/StatusBar";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";

// Right-panel + secondary UIs: lazy-loaded so they do not block first paint.
const KanbanBoard = lazy(() => import("./features/kanban/KanbanBoard").then((m) => ({ default: m.KanbanBoard })));
const AgentInspector = lazy(() => import("./features/agent-inspector/AgentInspector").then((m) => ({ default: m.AgentInspector })));
const ToolkitPanel = lazy(() => import("./features/toolkit/ToolkitPanel").then((m) => ({ default: m.ToolkitPanel })));
const WorkflowPanel = lazy(() => import("./features/workflow/WorkflowPanel").then((m) => ({ default: m.WorkflowPanel })));
const SCMPanel = lazy(() => import("./features/scm/SCMPanel").then((m) => ({ default: m.SCMPanel })));
const QuickOpen = lazy(() => import("./features/quick-open/QuickOpen").then((m) => ({ default: m.QuickOpen })));

const EditorPanel = lazy(() => import("./features/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
const CommandPalette = lazy(() => import("./features/command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const Settings = lazy(() => import("./features/settings/Settings").then((m) => ({ default: m.Settings })));
const WatchdogDialog = lazy(() => import("./features/watchdog/WatchdogDialog").then((m) => ({ default: m.WatchdogDialog })));
const WelcomeScreen = lazy(() => import("./features/welcome/WelcomeScreen").then((m) => ({ default: m.WelcomeScreen })));
const SearchPanel = lazy(() => import("./features/search/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const AboutDialog = lazy(() => import("./features/about/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const HelpDialog = lazy(() => import("./features/help/HelpDialog").then((m) => ({ default: m.HelpDialog })));
const PRInspector = lazy(() => import("./features/pr-inspector/PRInspector").then((m) => ({ default: m.PRInspector })));
const WebInspector = lazy(() => import("./features/web-inspector/WebInspector").then((m) => ({ default: m.WebInspector })));

import { SplitPane } from "./shared/ui/SplitPane";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { TooltipProvider } from "./shared/ui/Tooltip";
import { ToastProvider } from "./shared/ui/Toast";
import { PromptDialog } from "./shared/ui/PromptDialog";
import { OnboardingOverlay } from "./shared/ui/OnboardingOverlay";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useAgentManager } from "./shared/hooks/useAgentManager";
import { useInteractiveAgent } from "./shared/hooks/useInteractiveAgent";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useWorktreeActions } from "./shared/hooks/useWorktreeActions";
import { useTaskAgentLink } from "./shared/hooks/useTaskAgentLink";
import { useKeyboardShortcuts } from "./shared/hooks/useKeyboardShortcuts";
import { useTerminalNotifications } from "./shared/hooks/useTerminalNotifications";
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
    helpVisible, setHelpVisible,
    webInspectorVisible, setWebInspectorVisible,
    prInspectorVisible, setPrInspectorVisible,
    openFiles, activeFile, openFile, closeFile, clearFiles, setActiveFile,
    kanbanTasks, moveKanbanTask,
  } = useAppStore();
  useThemeApplier(themeId);

  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);
  const [fileTreeKey, setFileTreeKey] = useState(0);
  const [quickOpenMode, setQuickOpenMode] = useState<"files" | "buffers" | null>(null);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd, activityTabs, markTabActivity, reorderTab } = useTabManager("powershell");
  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent, renameSession } = useAgentManager();
  const {
    sessions: interactiveSessions,
    activeSessionId: interactiveSessionId,
    selectSession: selectInteractiveSession,
    startSession: startInteractiveSession,
    stopSession: stopInteractiveSession,
    endSessionAndRemoveWorktree,
  } = useInteractiveAgent();

  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  const projectName = projectPath ? projectPath.split("/").filter(Boolean).pop() ?? "Aether" : "Aether";

  // ── Derived state ──

  const { branch, changedFiles, refresh: refreshGitStatus } = useGitStatus(projectPath);
  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? (activeAgent.status === "thinking" || activeAgent.status === "generating" ? "thinking"
      : activeAgent.status === "coding" ? "edit"
      : activeAgent.status === "error" ? "error"
      : activeAgent.status === "waiting" ? "waiting"
      : activeAgent.status === "done" ? "done"
      : "idle")
    : "idle";

  const handleRefresh = useCallback(() => {
    refreshGitStatus();
    setFileTreeKey((k) => k + 1);
  }, [refreshGitStatus]);

  // ── Extracted hooks ──

  const { createWorktree, removeWorktree } = useWorktreeActions({
    projectPath, sessions, addTabWithCwd, stopAgent, onRefresh: handleRefresh,
  });

  const { agentStatuses } = useTaskAgentLink({
    sessions, kanbanTasks, moveKanbanTask,
  });

  // ── Handlers ──

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

  const handleStartAgent = useCallback(async (prompt: string, model?: string) => {
    try {
      return await startAgent(prompt, projectPath, model);
    } catch { return undefined; }
  }, [startAgent, projectPath]);

  const handleFileSelect = useCallback((path: string) => {
    setOpenInDiff(false);
    openFile(path);
  }, [openFile]);

  const handleOpenDiff = useCallback((path: string) => {
    setOpenInDiff(true);
    openFile(path);
  }, [openFile]);

  const unsavedFiles = useAppStore((s) => s.unsavedFiles);
  const handleCloseFile = useCallback((path: string) => {
    if (unsavedFiles.has(path) && !window.confirm("You have unsaved changes. Close anyway?")) return;
    closeFile(path);
  }, [closeFile, unsavedFiles]);

  const handleRunCommand = useCallback(async (command: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const activeId = getActivePtyId();
      if (activeId) {
        await invoke("write_terminal", { id: activeId, data: command + "\r" });
        return;
      }
      const terminals = await invoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await invoke("write_terminal", { id: terminals[0], data: command + "\r" });
      }
    } catch (err) {
      /* command error */
    }
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    const agent = sessions.find((s) => s.id === sessionId);
    if (agent) {
      const matchTab = tabs.find((t) => t.cwd && agent.prompt.includes(t.cwd.split("/").pop() ?? ""));
      if (matchTab) handleTabSwitch(matchTab.id);
    }
  }, [sessions, tabs, setActiveSessionId, handleTabSwitch]);

  // ── Interactive agent session handlers ──

  const handleFocusInteractiveSession = useCallback((sessionId: string) => {
    selectInteractiveSession(sessionId);
  }, [selectInteractiveSession]);

  const handleStartInteractiveSession = useCallback(async (opts: {
    cwd: string; model?: string; initialPrompt?: string; branchName?: string;
  }) => {
    await startInteractiveSession({
      ...opts,
      cols: 120,
      rows: 30,
    });
  }, [startInteractiveSession]);

  // ── Keyboard shortcuts (extracted hook) ──

  useKeyboardShortcuts({
    projectPath, tabs, addTab, closeTab, activeTabId, setActiveTabId, activeFile,
    sessions, activeSessionId, setActiveSessionId,
    setPaletteVisible, setSettingsVisible, setSearchVisible,
    handleOpenFolder, handleCloseFile, handleFileSelect, handleStartAgent, setQuickOpenMode, setHelpVisible,
  });

  // ── Terminal notifications (bell → tab badge + Windows toast) ──

  useTerminalNotifications({ activeTabId, tabs, onTabActivity: markTabActivity });

  // ── Session restore (DB bookkeeping + localStorage fallback) ──

  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<{ session: { id: string; name: string }; windows: { panes: { shell_type: string; cwd: string }[] }[] } | null>("restore_last_session")
        .then((restored) => {
          if (!restored) return;
          // If localStorage had no saved tabs, use DB panes as fallback
          const hasSavedTabs = localStorage.getItem("aether:tabs");
          if (!hasSavedTabs && restored.windows.length > 0) {
            for (const win of restored.windows) {
              for (const pane of win.panes) {
                const shell = (pane.shell_type as ShellType) || "powershell";
                if (pane.cwd) {
                  addTabWithCwd(shell, pane.cwd);
                }
              }
            }
          }
        })
        .catch(() => { /* DB not available or no session */ });
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Window setup ──

  useEffect(() => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();

      // Restore window position/size
      try {
        const saved = localStorage.getItem("aether:windowBounds");
        if (saved) {
          const { x, y, width, height, maximized } = JSON.parse(saved);
          if (width > 0 && height > 0) {
            import("@tauri-apps/api/dpi").then(({ LogicalPosition: LP, LogicalSize: LS }) => {
              win.setPosition(new LP(x, y)).catch(() => {});
              win.setSize(new LS(width, height)).catch(() => {});
            }).catch(() => {});
          }
          if (maximized) win.maximize().catch(() => {});
        }
      } catch { /* ignore */ }

      win.show().catch(() => {});

      win.onCloseRequested(async (event) => {
        // Save window position/size before close
        try {
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          const maximized = await win.isMaximized();
          localStorage.setItem("aether:windowBounds", JSON.stringify({
            x: pos.x, y: pos.y, width: size.width, height: size.height, maximized,
          }));
        } catch { /* ignore */ }

        const { unsavedFiles } = useAppStore.getState();
        if (unsavedFiles.size > 0) {
          const ok = window.confirm(`${unsavedFiles.size} file(s) have unsaved changes. Close anyway?`);
          if (!ok) event.preventDefault();
        }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const title = projectPath ? `${projectName} — Aether Terminal` : "Aether Terminal";
    document.title = title;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title).catch(() => {});
    }).catch(() => {});
  }, [projectName, projectPath]);

  // ── Command palette commands ──

  const { commands, menus } = useAppMenus({
    addTab, closeTab, activeTabId, activeFile, projectPath,
    handleFileSelect, handleCloseFile, handleOpenFolder, handleCloseFolder,
    handleStartAgent,
    setPaletteVisible, setSettingsVisible, setSearchVisible,
    setWatchdogVisible, setAboutVisible, setHelpVisible, setWebInspectorVisible, setPrInspectorVisible,
  });

  // ── Render ──

  // Active interactive session (if any)
  const activeInteractive = interactiveSessions.find((s) => s.id === interactiveSessionId);

  const terminalTabs = tabs.map((tab) => (
    <div key={tab.id} className={appStyles.terminalTabPane} data-active={tab.id === activeTabId && !activeInteractive}>
      <PaneTreeContainer shell={tab.shell} cwd={tab.cwd} />
    </div>
  ));

  if (!rootProjectPath) {
    return (
      <TooltipProvider><ToastProvider>
        <div className="app-container">
          <Suspense fallback={null}><WelcomeScreen onOpenProject={handleOpenProject} /></Suspense>
        </div>
      </ToastProvider></TooltipProvider>
    );
  }

  const editorArea = activeFile ? (
    <div className={appStyles.editorArea}>
      <div className={appStyles.editorTabsBar}>
        {openFiles.map((f) => {
          const name = f.split("/").pop() ?? f;
          return (
            <button key={f} className={appStyles.editorTab} data-active={f === activeFile} onClick={() => setActiveFile(f)}>
              {name}
              <span role="button" className={appStyles.editorTabClose} aria-label={`Close ${name}`} onClick={(e) => { e.stopPropagation(); handleCloseFile(f); }}>×</span>
            </button>
          );
        })}
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className={appStyles.editorLoading}>Loading editor...</div>}>
          <EditorPanel filePath={activeFile} onClose={() => handleCloseFile(activeFile!)} projectPath={projectPath} initialLine={editorLine} initialDiffMode={openInDiff} onStartAgent={handleStartAgent} />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null;

  return (
    <TooltipProvider><ToastProvider>
    <div className="app-container">
      <ProjectHeaderBar
        projectName={projectName} branch={branch} changedCount={changedFiles.length}
        status={headerStatus as "idle" | "edit" | "thinking" | "error" | "waiting" | "done"}
        activeAgent={activeAgent ? { model: activeAgent.model, cost: activeAgent.cost } : null}
        onOpenSettings={() => setSettingsVisible(true)} onRefresh={handleRefresh}
      />
      <MenuBar menus={menus} />

      <main className="app-main" role="main">
        <div className="left-panel" role="navigation" aria-label="Project sidebar">
          <ErrorBoundary>
            <FileTree key={fileTreeKey} rootPath={projectPath} onFileSelect={handleFileSelect} onOpenDiff={handleOpenDiff} changedFiles={changedFiles} />
          </ErrorBoundary>
          <ErrorBoundary>
            <Suspense fallback={null}>
              <KanbanBoard onStartAgent={handleStartAgent} projectPath={projectPath} agentStatuses={agentStatuses} />
            </Suspense>
          </ErrorBoundary>
          {searchVisible && <Suspense fallback={null}><ErrorBoundary><SearchPanel visible rootPath={projectPath} onClose={() => setSearchVisible(false)} onResultClick={(file, line) => { handleFileSelect(file); setEditorLine(line); }} /></ErrorBoundary></Suspense>}
          <ErrorBoundary>
            <Suspense fallback={null}>
              <SCMPanel projectPath={projectPath} onOpenFile={handleFileSelect} onOpenDiff={handleOpenDiff} />
            </Suspense>
          </ErrorBoundary>
        </div>

        <div className="center-panel" role="region" aria-label="Terminal and editor">
          {editorArea ? (
            <SplitPane direction="vertical" defaultRatio={0.5} first={editorArea} second={
              <div className={appStyles.terminalContainer}>
                {terminalTabs}
                {activeInteractive && (
                  <div className={appStyles.terminalTabPane} data-active>
                    <AgentTerminal
                      ptyId={activeInteractive.pty_id}

                      cli={activeInteractive.cli}
                      status={activeInteractive.status as "idle" | "thinking" | "coding" | "generating" | "waiting" | "error" | "done"}
                      model={activeInteractive.model}
                      cost={activeInteractive.cost}
                    />
                  </div>
                )}
              </div>
            } />
          ) : (
            <div className={appStyles.terminalContainer}>
              {terminalTabs}
              {activeInteractive && (
                <div className={appStyles.terminalTabPane} data-active>
                  <AgentTerminal
                    ptyId={activeInteractive.pty_id}
                    cli={activeInteractive.cli}
                    status={activeInteractive.status as "idle" | "thinking" | "coding" | "generating" | "waiting" | "error" | "done"}
                    model={activeInteractive.model}
                    cost={activeInteractive.cost}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="right-panel" role="complementary" aria-label="Agent inspector">
          <ErrorBoundary>
            <Suspense fallback={null}>
              <AgentInspector
                sessions={sessions} activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession} onStartAgent={handleStartAgent} onStopAgent={stopAgent}
                onCreateWorktree={createWorktree} onRemoveWorktree={removeWorktree} onRenameSession={renameSession}
                interactiveSessions={interactiveSessions}
                onFocusInteractiveSession={handleFocusInteractiveSession}
                onStopInteractiveSession={stopInteractiveSession}
                onEndSessionAndRemoveWorktree={endSessionAndRemoveWorktree}
                onStartInteractiveSession={handleStartInteractiveSession}
              />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary>
            <Suspense fallback={null}>
              <WorkflowPanel projectPath={projectPath} onStartAgent={handleStartAgent} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary>
            <Suspense fallback={null}>
              <ToolkitPanel projectName={projectName} onRunCommand={handleRunCommand} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      <WorkspaceTabs
        tabs={tabs} activeTabId={activeTabId} activityTabs={activityTabs}
        onSelectTab={(id) => { if (interactiveSessionId) selectInteractiveSession(""); handleTabSwitch(id); }} onCloseTab={closeTab} onNewTab={addTab} onReorderTab={reorderTab}
        interactiveSessions={interactiveSessions}
        activeInteractiveId={interactiveSessionId}
        onSelectInteractive={handleFocusInteractiveSession}
        onCloseInteractive={stopInteractiveSession}
      />

      <StatusBar
        shell={activeTab.shell}
        branch={branch}
        changedCount={changedFiles.length}
        agentStatus={activeAgent ? `${activeAgent.model} · $${activeAgent.cost.toFixed(2)}` : undefined}
      />

      {paletteVisible && <Suspense fallback={null}><CommandPalette visible onClose={() => setPaletteVisible(false)} commands={commands} /></Suspense>}
      {settingsVisible && <Suspense fallback={null}><Settings visible onClose={() => setSettingsVisible(false)} /></Suspense>}
      {watchdogVisible && <Suspense fallback={null}><WatchdogDialog visible onClose={() => setWatchdogVisible(false)} /></Suspense>}
      {aboutVisible && <Suspense fallback={null}><AboutDialog visible onClose={() => setAboutVisible(false)} /></Suspense>}
      {helpVisible && <Suspense fallback={null}><HelpDialog visible onClose={() => setHelpVisible(false)} /></Suspense>}
      {webInspectorVisible && <Suspense fallback={null}><WebInspector visible onClose={() => setWebInspectorVisible(false)} /></Suspense>}
      {prInspectorVisible && <Suspense fallback={null}><PRInspector visible projectPath={projectPath} onClose={() => setPrInspectorVisible(false)} onStartReview={handleStartAgent} /></Suspense>}
      {quickOpenMode && <Suspense fallback={null}><QuickOpen projectPath={projectPath} openFiles={openFiles} onSelectFile={handleFileSelect} onClose={() => setQuickOpenMode(null)} initialMode={quickOpenMode} /></Suspense>}
      <PromptDialog />
      <OnboardingOverlay />
    </div>
    </ToastProvider></TooltipProvider>
  );
}
