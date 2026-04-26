import { MotionConfig } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import appStyles from "./App.module.css";
import { AgentTerminal } from "./features/agent-terminal";
import { UpdateBanner } from "./features/app/UpdateBanner";
import { useAppMenus } from "./features/app/useAppMenus";
import { FileTree } from "./features/file-tree/FileTree";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { PaneTreeContainer } from "./features/terminal/pane-tree";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";

// Right-panel + secondary UIs: lazy-loaded so they do not block first paint.
const KanbanBoard = lazy(() => import("./features/kanban/KanbanBoard").then((m) => ({ default: m.KanbanBoard })));
const AgentInspector = lazy(() =>
  import("./features/agent-inspector/AgentInspector").then((m) => ({ default: m.AgentInspector })),
);
const ToolkitPanel = lazy(() => import("./features/toolkit/ToolkitPanel").then((m) => ({ default: m.ToolkitPanel })));
const WorkflowPanel = lazy(() =>
  import("./features/workflow/WorkflowPanel").then((m) => ({ default: m.WorkflowPanel })),
);
const SCMPanel = lazy(() => import("./features/scm/SCMPanel").then((m) => ({ default: m.SCMPanel })));
const LogsPanel = lazy(() => import("./features/logs/LogsPanel").then((m) => ({ default: m.LogsPanel })));
const QuickOpen = lazy(() => import("./features/quick-open/QuickOpen").then((m) => ({ default: m.QuickOpen })));

const EditorPanel = lazy(() => import("./features/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
const CommandPalette = lazy(() =>
  import("./features/command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const Settings = lazy(() => import("./features/settings/Settings").then((m) => ({ default: m.Settings })));
const WatchdogDialog = lazy(() =>
  import("./features/watchdog/WatchdogDialog").then((m) => ({ default: m.WatchdogDialog })),
);
const WelcomeScreen = lazy(() =>
  import("./features/welcome/WelcomeScreen").then((m) => ({ default: m.WelcomeScreen })),
);
const SearchPanel = lazy(() => import("./features/search/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const AboutDialog = lazy(() => import("./features/about/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const HelpDialog = lazy(() => import("./features/help/HelpDialog").then((m) => ({ default: m.HelpDialog })));
const PRInspector = lazy(() => import("./features/pr-inspector/PRInspector").then((m) => ({ default: m.PRInspector })));
const WebInspector = lazy(() =>
  import("./features/web-inspector/WebInspector").then((m) => ({ default: m.WebInspector })),
);

import { HistorySearchDialog } from "./features/history/HistorySearchDialog";
import { useAgentManager } from "./shared/hooks/useAgentManager";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useInteractiveAgent } from "./shared/hooks/useInteractiveAgent";
import { useKeyboardShortcuts } from "./shared/hooks/useKeyboardShortcuts";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useTaskAgentLink } from "./shared/hooks/useTaskAgentLink";
import { useTerminalNotifications } from "./shared/hooks/useTerminalNotifications";
import { useThemeApplier } from "./shared/hooks/useTheme";
import { useWorktreeActions } from "./shared/hooks/useWorktreeActions";
import { markFirstPaint } from "./shared/lib/bootMetrics";
import { useAppStore } from "./shared/store/appStore";
import type { SearchHit } from "./shared/types/history";
import { ConfirmDialog, showConfirm } from "./shared/ui/ConfirmDialog";
import { CollapsibleSection } from "./shared/ui/CollapsibleSection";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { LazyDialog } from "./shared/ui/LazyDialog";
import { HandoffDialog } from "./shared/ui/HandoffDialog";
import { OnboardingOverlay } from "./shared/ui/OnboardingOverlay";
import { OrchestraDialog } from "./shared/ui/OrchestraDialog";
import { PromptDialog } from "./shared/ui/PromptDialog";
import { SplitPane } from "./shared/ui/SplitPane";
import { ToastProvider } from "./shared/ui/Toast";
import { TooltipProvider } from "./shared/ui/Tooltip";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const {
    themeId,
    rootProjectPath,
    setRootProjectPath,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    paletteVisible,
    setPaletteVisible,
    settingsVisible,
    setSettingsVisible,
    watchdogVisible,
    setWatchdogVisible,
    searchVisible,
    setSearchVisible,
    aboutVisible,
    setAboutVisible,
    helpVisible,
    setHelpVisible,
    webInspectorVisible,
    setWebInspectorVisible,
    prInspectorVisible,
    setPrInspectorVisible,
    openFiles,
    activeFile,
    openFile,
    closeFile,
    clearFiles,
    setActiveFile,
    kanbanTasks,
    moveKanbanTask,
  } = useAppStore();
  const themeOverridesForActive = useAppStore((s) => s.themeOverrides[themeId]);
  useThemeApplier(themeId, themeOverridesForActive);

  // Boot perf marker — fires after the first React commit + one frame, so the
  // number reflects when pixels actually land on screen rather than when JS ran.
  useEffect(() => {
    const raf = requestAnimationFrame(() => markFirstPaint());
    return () => cancelAnimationFrame(raf);
  }, []);

  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);
  const [fileTreeKey, setFileTreeKey] = useState(0);
  const [quickOpenMode, setQuickOpenMode] = useState<"files" | "buffers" | null>(null);

  // Map<tabId, focused-pane PTY id>. Each `<PaneTreeContainer>` reports
  // its tab's focused-pane PTY id through `onActiveTerminalChange`; the
  // status-bar inline-image budget badge reads `tabActivePtyIds[active
  // TabId]` so it polls the correct backend session. PTY id ≠ Tab UUID
  // — `spawn_terminal` returns a freshly-allocated id that lives in the
  // pane-tree's private `terminalIds` map, so this lift is the only way
  // to thread it through to global UI without leaking pane-tree state.
  const [tabActivePtyIds, setTabActivePtyIds] = useState<Record<string, string | null>>({});
  const setTabActivePtyId = useCallback((tabId: string, ptyId: string | null) => {
    setTabActivePtyIds((prev) => {
      if (prev[tabId] === ptyId) return prev;
      return { ...prev, [tabId]: ptyId };
    });
  }, []);

  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    addTabWithCwd,
    activityTabs,
    markTabActivity,
    reorderTab,
  } = useTabManager("powershell");
  const activePtyId = tabActivePtyIds[activeTabId] ?? null;

  // Prune `tabActivePtyIds` entries whose tab has been closed. Without
  // this the map grows unboundedly across the lifetime of the session
  // — minor in practice but trivial to guard against.
  useEffect(() => {
    const liveIds = new Set(tabs.map((t) => t.id));
    setTabActivePtyIds((prev) => {
      let mutated = false;
      const next: Record<string, string | null> = {};
      for (const [id, ptyId] of Object.entries(prev)) {
        if (liveIds.has(id)) {
          next[id] = ptyId;
        } else {
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [tabs]);
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
  const projectName = projectPath ? (projectPath.split("/").filter(Boolean).pop() ?? "Aether") : "Aether";

  // ── Derived state ──

  const { branch, changedFiles, refresh: refreshGitStatus } = useGitStatus(projectPath);
  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? activeAgent.status === "thinking" || activeAgent.status === "generating"
      ? "thinking"
      : activeAgent.status === "coding"
        ? "edit"
        : activeAgent.status === "error"
          ? "error"
          : activeAgent.status === "waiting"
            ? "waiting"
            : activeAgent.status === "done"
              ? "done"
              : "idle"
    : "idle";

  const handleRefresh = useCallback(() => {
    refreshGitStatus();
    setFileTreeKey((k) => k + 1);
  }, [refreshGitStatus]);

  // ── Extracted hooks ──

  const { createWorktree, removeWorktree } = useWorktreeActions({
    projectPath,
    sessions,
    addTabWithCwd,
    stopAgent,
    onRefresh: handleRefresh,
  });

  const { agentStatuses } = useTaskAgentLink({
    sessions,
    kanbanTasks,
    moveKanbanTask,
  });

  // ── Handlers ──

  const handleOpenProject = useCallback(
    (path: string) => {
      const normalized = path.replace(/\\/g, "/");
      setRootProjectPath(normalized);
      addTabWithCwd("powershell", normalized);
      clearFiles();
    },
    [addTabWithCwd, setRootProjectPath, clearFiles],
  );

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
    } catch {
      /* cancelled or not in Tauri */
    }
  }, [handleOpenProject]);

  const handleTabSwitch = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      clearFiles();
    },
    [setActiveTabId, clearFiles],
  );

  const handleStartAgent = useCallback(
    async (
      prompt: string,
      model?: string,
      meta?: { role?: import("./shared/lib/orchestrator").OrchestraRoleId; handoffFrom?: string },
    ) => {
      try {
        return await startAgent(prompt, projectPath, model, meta);
      } catch {
        return undefined;
      }
    },
    [startAgent, projectPath],
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      setOpenInDiff(false);
      openFile(path);
    },
    [openFile],
  );

  const handleOpenDiff = useCallback(
    (path: string) => {
      setOpenInDiff(true);
      openFile(path);
    },
    [openFile],
  );

  const unsavedFiles = useAppStore((s) => s.unsavedFiles);
  const handleCloseFile = useCallback(
    async (path: string) => {
      if (unsavedFiles.has(path)) {
        const ok = await showConfirm({
          title: "Unsaved changes",
          description: "You have unsaved changes. Close anyway?",
          confirmLabel: "Close",
          tone: "danger",
        });
        if (!ok) return;
      }
      closeFile(path);
    },
    [closeFile, unsavedFiles],
  );

  const handleRunCommand = useCallback(async (command: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const terminals = await invoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await invoke("write_terminal", { id: terminals[0], data: command + "\r" });
      }
    } catch (err) {
      /* command error */
    }
  }, []);

  /**
   * Ctrl+R history hit → stage the command at the current prompt without
   * pressing Enter. Matches fish/zsh `history-pager` behaviour so the user
   * can still edit before running.
   */
  const handleHistoryAccept = useCallback(async (hit: SearchHit) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const terminals = await invoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await invoke("write_terminal", { id: terminals[0], data: hit.entry.command });
      }
    } catch {
      /* not in Tauri */
    }
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      const agent = sessions.find((s) => s.id === sessionId);
      if (agent) {
        const matchTab = tabs.find((t) => t.cwd && agent.prompt.includes(t.cwd.split("/").pop() ?? ""));
        if (matchTab) handleTabSwitch(matchTab.id);
      }
    },
    [sessions, tabs, setActiveSessionId, handleTabSwitch],
  );

  // ── Interactive agent session handlers ──

  const handleFocusInteractiveSession = useCallback(
    (sessionId: string) => {
      selectInteractiveSession(sessionId);
    },
    [selectInteractiveSession],
  );

  const handleStartInteractiveSession = useCallback(
    async (opts: { cwd: string; model?: string; initialPrompt?: string; branchName?: string }) => {
      await startInteractiveSession({
        ...opts,
        cols: 120,
        rows: 30,
      });
    },
    [startInteractiveSession],
  );

  // ── Keyboard shortcuts (extracted hook) ──

  useKeyboardShortcuts({
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
    setHelpVisible,
    setSidebarCollapsed,
  });

  // ── Terminal notifications (bell → tab badge + Windows toast) ──

  useTerminalNotifications({ activeTabId, tabs, onTabActivity: markTabActivity });

  // ── Session restore (DB bookkeeping + localStorage fallback) ──

  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke<{
          session: { id: string; name: string };
          windows: { panes: { shell_type: string; cwd: string }[] }[];
        } | null>("restore_last_session")
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
          .catch(() => {
            /* DB not available or no session */
          });
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Window setup ──

  useEffect(() => {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();

        // Restore window position/size
        try {
          const saved = localStorage.getItem("aether:windowBounds");
          if (saved) {
            const { x, y, width, height, maximized } = JSON.parse(saved);
            if (width > 0 && height > 0) {
              import("@tauri-apps/api/dpi")
                .then(({ LogicalPosition: LP, LogicalSize: LS }) => {
                  win.setPosition(new LP(x, y)).catch(() => {});
                  win.setSize(new LS(width, height)).catch(() => {});
                })
                .catch(() => {});
            }
            if (maximized) win.maximize().catch(() => {});
          }
        } catch {
          /* ignore */
        }

        win.show().catch(() => {});

        win
          .onCloseRequested(async (event) => {
            // Save window position/size before close
            try {
              const pos = await win.outerPosition();
              const size = await win.outerSize();
              const maximized = await win.isMaximized();
              localStorage.setItem(
                "aether:windowBounds",
                JSON.stringify({
                  x: pos.x,
                  y: pos.y,
                  width: size.width,
                  height: size.height,
                  maximized,
                }),
              );
            } catch {
              /* ignore */
            }

            const { unsavedFiles } = useAppStore.getState();
            if (unsavedFiles.size > 0) {
              // Preserve the native close-request semantics (synchronous
              // preventDefault) while still showing the themed confirm
              // asynchronously. If the user confirms, we tear the window
              // down ourselves.
              event.preventDefault();
              const ok = await showConfirm({
                title: "Unsaved changes",
                description: `${unsavedFiles.size} file(s) have unsaved changes. Close anyway?`,
                confirmLabel: "Close",
                tone: "danger",
              });
              if (ok) {
                await win.close();
              }
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const title = projectPath ? `${projectName} — Aether Terminal` : "Aether Terminal";
    document.title = title;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        getCurrentWindow()
          .setTitle(title)
          .catch(() => {});
      })
      .catch(() => {});
  }, [projectName, projectPath]);

  // ── Command palette commands ──

  const { commands, menus } = useAppMenus({
    addTab,
    closeTab,
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
  });

  // ── Render ──

  // Active interactive session (if any)
  const activeInteractive = interactiveSessions.find((s) => s.id === interactiveSessionId);

  const terminalTabs = tabs.map((tab) => (
    <div key={tab.id} className={appStyles.terminalTabPane} data-active={tab.id === activeTabId && !activeInteractive}>
      <PaneTreeContainer
        shell={tab.shell}
        cwd={tab.cwd}
        onActiveTerminalChange={(terminalId) => {
          setTabActivePtyId(tab.id, terminalId);
        }}
      />
    </div>
  ));

  if (!rootProjectPath) {
    return (
      <TooltipProvider>
        <ToastProvider>
          <div className="app-container">
            <Suspense fallback={null}>
              <WelcomeScreen
                onOpenProject={handleOpenProject}
                onOpenSettings={() => setSettingsVisible(true)}
              />
            </Suspense>
            {/* Settings is reachable before a project is open (theme /
             * default shell pick on first run). Same LazyDialog wrapper
             * as the post-project path so a chunk-load failure shows a
             * retry panel instead of a silent click. */}
            {settingsVisible && (
              <LazyDialog>
                <Settings visible onClose={() => setSettingsVisible(false)} />
              </LazyDialog>
            )}
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
          // Editor tab = row container + inline close affordance. Two nested
          // <button>s would be invalid HTML, so the outer is a tab-role div
          // with keyboard activation; the inner × is a real button.
          return (
            <div
              key={f}
              className={appStyles.editorTab}
              role="tab"
              tabIndex={0}
              aria-selected={f === activeFile}
              data-active={f === activeFile}
              onClick={() => setActiveFile(f)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveFile(f);
                }
              }}
            >
              {name}
              <button
                type="button"
                className={appStyles.editorTabClose}
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseFile(f);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className={appStyles.editorLoading}>Loading editor...</div>}>
          <EditorPanel
            filePath={activeFile}
            onClose={() => handleCloseFile(activeFile!)}
            projectPath={projectPath}
            initialLine={editorLine}
            initialDiffMode={openInDiff}
            onStartAgent={handleStartAgent}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null;

  return (
    /* MotionConfig reducedMotion="user" tells every motion.* child in the
     * tree to honor the OS prefers-reduced-motion setting. CSS already
     * zeroes transition-duration and transform on :hover under that
     * query — this adds the missing JS-side respect for Framer-driven
     * springs across CommandPalette/WelcomeScreen/SearchPanel/PRInspector/
     * WebInspector/OnboardingOverlay. */
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <ToastProvider>
        <div className="app-container">
          <UpdateBanner />
          <ProjectHeaderBar
            projectName={projectName}
            branch={branch}
            changedCount={changedFiles.length}
            status={headerStatus as "idle" | "edit" | "thinking" | "error" | "waiting" | "done"}
            activeAgent={activeAgent ? { model: activeAgent.model, cost: activeAgent.cost } : null}
            onOpenSettings={() => setSettingsVisible(true)}
            onRefresh={handleRefresh}
            menus={menus}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          />

          <main className="app-main">
            <nav
              className={`left-panel${sidebarCollapsed ? " left-panel-collapsed" : ""}`}
              aria-label="Project sidebar"
              data-collapsed={sidebarCollapsed}
              style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
            >
              <CollapsibleSection storageKey="files" title="Files" defaultOpen>
                <ErrorBoundary>
                  <FileTree
                    key={fileTreeKey}
                    rootPath={projectPath}
                    onFileSelect={handleFileSelect}
                    onOpenDiff={handleOpenDiff}
                    changedFiles={changedFiles}
                  />
                </ErrorBoundary>
              </CollapsibleSection>
              <CollapsibleSection storageKey="tasks" title="Tasks" defaultOpen={false}>
                <ErrorBoundary>
                  <Suspense fallback={null}>
                    <KanbanBoard
                      onStartAgent={handleStartAgent}
                      projectPath={projectPath}
                      agentStatuses={agentStatuses}
                    />
                  </Suspense>
                </ErrorBoundary>
              </CollapsibleSection>
              <CollapsibleSection
                storageKey="source-control"
                title="Source Control"
                defaultOpen={false}
              >
                <ErrorBoundary>
                  <Suspense fallback={null}>
                    <SCMPanel
                      projectPath={projectPath}
                      onOpenFile={handleFileSelect}
                      onOpenDiff={handleOpenDiff}
                    />
                  </Suspense>
                </ErrorBoundary>
              </CollapsibleSection>
              {searchVisible && (
                <Suspense fallback={null}>
                  <ErrorBoundary>
                    <SearchPanel
                      visible
                      rootPath={projectPath}
                      onClose={() => setSearchVisible(false)}
                      onResultClick={(file, line) => {
                        handleFileSelect(file);
                        setEditorLine(line);
                      }}
                    />
                  </ErrorBoundary>
                </Suspense>
              )}
              <div
                className="left-panel-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                aria-valuemin={200}
                aria-valuemax={480}
                aria-valuenow={sidebarWidth}
                tabIndex={0}
                onPointerDown={(e) => {
                  // Drag-to-resize. We capture the pointer on the handle so
                  // the move events keep coming even if the cursor leaves
                  // the handle's bounds (large drags).
                  const startX = e.clientX;
                  const startWidth = sidebarWidth;
                  const handleEl = e.currentTarget;
                  handleEl.setPointerCapture(e.pointerId);
                  document.body.style.cursor = "col-resize";
                  const onMove = (ev: PointerEvent) => {
                    setSidebarWidth(startWidth + (ev.clientX - startX));
                  };
                  const onUp = () => {
                    document.body.style.cursor = "";
                    handleEl.releasePointerCapture(e.pointerId);
                    handleEl.removeEventListener("pointermove", onMove);
                    handleEl.removeEventListener("pointerup", onUp);
                  };
                  handleEl.addEventListener("pointermove", onMove);
                  handleEl.addEventListener("pointerup", onUp);
                }}
                onKeyDown={(e) => {
                  // Keyboard accessibility — Arrow keys nudge the
                  // sidebar by 16 px, Shift+Arrow by 64 px.
                  const step = e.shiftKey ? 64 : 16;
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setSidebarWidth(sidebarWidth - step);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setSidebarWidth(sidebarWidth + step);
                  }
                }}
              />
            </nav>

            <section className="center-panel" aria-label="Terminal and editor">
              {editorArea ? (
                <SplitPane
                  direction="vertical"
                  defaultRatio={0.5}
                  first={editorArea}
                  second={
                    <div className={appStyles.terminalContainer}>
                      {terminalTabs}
                      {activeInteractive && (
                        <div className={appStyles.terminalTabPane} data-active>
                          <AgentTerminal
                            ptyId={activeInteractive.pty_id}
                            cli={activeInteractive.cli}
                            status={
                              activeInteractive.status as
                                | "idle"
                                | "thinking"
                                | "coding"
                                | "generating"
                                | "waiting"
                                | "error"
                                | "done"
                            }
                            model={activeInteractive.model}
                            cost={activeInteractive.cost}
                          />
                        </div>
                      )}
                    </div>
                  }
                />
              ) : (
                <div className={appStyles.terminalContainer}>
                  {terminalTabs}
                  {activeInteractive && (
                    <div className={appStyles.terminalTabPane} data-active>
                      <AgentTerminal
                        ptyId={activeInteractive.pty_id}
                        cli={activeInteractive.cli}
                        status={
                          activeInteractive.status as
                            | "idle"
                            | "thinking"
                            | "coding"
                            | "generating"
                            | "waiting"
                            | "error"
                            | "done"
                        }
                        model={activeInteractive.model}
                        cost={activeInteractive.cost}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>

            <aside className="right-panel" aria-label="Agent inspector">
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <AgentInspector
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelectSession={handleSelectSession}
                    onStartAgent={handleStartAgent}
                    onStopAgent={stopAgent}
                    onCreateWorktree={createWorktree}
                    onRemoveWorktree={removeWorktree}
                    onRenameSession={renameSession}
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
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <LogsPanel />
                </Suspense>
              </ErrorBoundary>
            </aside>
          </main>

          <WorkspaceTabs
            tabs={tabs}
            activeTabId={activeTabId}
            activityTabs={activityTabs}
            onSelectTab={(id) => {
              if (interactiveSessionId) selectInteractiveSession("");
              handleTabSwitch(id);
            }}
            onCloseTab={closeTab}
            onNewTab={addTab}
            onReorderTab={reorderTab}
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
            terminalId={activePtyId}
          />

          {paletteVisible && (
            <LazyDialog>
              <CommandPalette visible onClose={() => setPaletteVisible(false)} commands={commands} />
            </LazyDialog>
          )}
          {settingsVisible && (
            <LazyDialog>
              <Settings visible onClose={() => setSettingsVisible(false)} />
            </LazyDialog>
          )}
          {watchdogVisible && (
            <LazyDialog>
              <WatchdogDialog visible onClose={() => setWatchdogVisible(false)} />
            </LazyDialog>
          )}
          {aboutVisible && (
            <LazyDialog>
              <AboutDialog visible onClose={() => setAboutVisible(false)} />
            </LazyDialog>
          )}
          {helpVisible && (
            <LazyDialog>
              <HelpDialog visible onClose={() => setHelpVisible(false)} />
            </LazyDialog>
          )}
          {webInspectorVisible && (
            <LazyDialog>
              <WebInspector visible onClose={() => setWebInspectorVisible(false)} />
            </LazyDialog>
          )}
          {prInspectorVisible && (
            <LazyDialog>
              <PRInspector
                visible
                projectPath={projectPath}
                onClose={() => setPrInspectorVisible(false)}
                onStartReview={handleStartAgent}
              />
            </LazyDialog>
          )}
          {quickOpenMode && (
            <LazyDialog>
              <QuickOpen
                projectPath={projectPath}
                openFiles={openFiles}
                onSelectFile={handleFileSelect}
                onClose={() => setQuickOpenMode(null)}
                initialMode={quickOpenMode}
              />
            </LazyDialog>
          )}
          <PromptDialog />
          <ConfirmDialog />
          <HandoffDialog />
          <OrchestraDialog />
          <HistorySearchDialog onAccept={handleHistoryAccept} defaultCwdPrefix={projectPath || undefined} />
          <OnboardingOverlay />
        </div>
      </ToastProvider>
    </TooltipProvider>
    </MotionConfig>
  );
}
