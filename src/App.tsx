import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { MenuBar, type Menu } from "./features/menubar/MenuBar";
import { Sidebar } from "./features/sidebar/Sidebar";
import { FileTree } from "./features/file-tree/FileTree";
import { HelmPanel } from "./features/helm/HelmPanel";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { StatusBar } from "./features/statusbar/StatusBar";
import { KanbanBoard } from "./features/kanban/KanbanBoard";
import { WorktreeManager } from "./features/worktree/WorktreeManager";

// Lazy load Monaco Editor (~2MB)
const EditorPanel = lazy(() => import("./features/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
import { AgentInspector } from "./features/agent-inspector/AgentInspector";
import { ToolkitPanel } from "./features/toolkit/ToolkitPanel";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import { CommandPalette, type Command } from "./features/command-palette/CommandPalette";
import { Settings } from "./features/settings/Settings";
import { WatchdogDialog } from "./features/watchdog/WatchdogDialog";
import { WelcomeScreen } from "./features/welcome/WelcomeScreen";
import { SearchPanel } from "./features/search/SearchPanel";
import { AboutDialog } from "./features/about/AboutDialog";
import { PRInspector } from "./features/pr-inspector/PRInspector";
import { WebInspector } from "./features/web-inspector/WebInspector";
import { SplitPane } from "./shared/ui/SplitPane";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useAgentManager } from "./shared/hooks/useAgentManager";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useAppStore } from "./shared/store/appStore";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const {
    rootProjectPath, setRootProjectPath,
    sidebarSection,
    paletteVisible, setPaletteVisible,
    settingsVisible, setSettingsVisible,
    watchdogVisible, setWatchdogVisible,
    searchVisible, setSearchVisible,
    aboutVisible, setAboutVisible,
    webInspectorVisible, setWebInspectorVisible,
    prInspectorVisible, setPrInspectorVisible,
    openFiles, activeFile, openFile, closeFile, clearFiles, setActiveFile,
  } = useAppStore();
  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd } =
    useTabManager("powershell");
  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent } =
    useAgentManager();

  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  const projectName = projectPath ? projectPath.split("/").filter(Boolean).pop() ?? "Aether" : "Aether";

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

  const { branch, changedFiles } = useGitStatus(projectPath);

  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? (activeAgent.status === "thinking" ? "thinking" : activeAgent.status === "coding" ? "edit" : "idle")
    : "idle";

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
      const terminals = await tauriInvoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await tauriInvoke("write_terminal", { id: terminals[0], data: command + "\r" });
      }
    } catch { /* ignore */ }
  }, []);

  // Kanban move side effects: create worktree + terminal tab when moving to in_progress
  const handleKanbanMove = useCallback(async (taskId: string, toColumn: string) => {
    if (toColumn === "in_progress") {
      try {
        const { invoke: inv } = await import("@tauri-apps/api/core");
        const task = useAppStore.getState().kanbanTasks.find((t) => t.id === taskId);
        if (task) {
          const branchName = `feat/${task.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`;
          try {
            await inv("create_worktree", { repoPath: projectPath, branchName });
          } catch { /* worktree may already exist */ }
          useAppStore.getState().updateKanbanTask(taskId, { branch: branchName });
          addTabWithCwd("powershell", projectPath);
        }
      } catch { /* ignore */ }
    }
  }, [projectPath, addTabWithCwd]);

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

  const commands: Command[] = useMemo(() => [
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
    { id: "start-agent", label: "Start Claude Agent", shortcut: "Ctrl+Shift+A", action: () => { const p = window.prompt("Prompt:"); if (p) handleStartAgent(p); } },
    { id: "close-folder", label: "Close Folder", action: handleCloseFolder },
    { id: "search-files", label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible(true) },
  ], [addTab, closeTab, activeTabId, activeFile, handleCloseFile, handleStartAgent, handleOpenFolder, handleCloseFolder]);

  const menus: Menu[] = useMemo(() => [
    {
      label: "File",
      items: [
        { label: "New File", shortcut: "Ctrl+N", action: () => {
          const name = prompt("New file name:");
          if (name && projectPath) {
            import("@tauri-apps/api/core").then(({ invoke: inv }) => {
              inv("create_file", { path: `${projectPath}/${name}` }).then(() => handleFileSelect(`${projectPath}/${name}`)).catch(() => {});
            });
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
        { label: "Find", shortcut: "Ctrl+F", action: () => { /* editor/terminal search */ } },
        { label: "Replace", shortcut: "Ctrl+H", action: () => { /* TODO */ } },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette", shortcut: "Ctrl+Shift+P", action: () => setPaletteVisible(true) },
        { label: "Search in Files", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible(true) },
        { label: "Web Inspector", action: () => setWebInspectorVisible((v) => !v) },
        { label: "Pull Requests", action: () => setPrInspectorVisible((v) => !v) },
        { divider: true, label: "" },
        { label: "Zoom In", shortcut: "Ctrl+=", action: () => { /* TODO */ } },
        { label: "Zoom Out", shortcut: "Ctrl+-", action: () => { /* TODO */ } },
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
        { label: "Split Horizontal", shortcut: "Ctrl+Shift+H", action: () => { /* handled by TerminalPane */ } },
        { label: "Split Vertical", shortcut: "Ctrl+Shift+V", action: () => { /* handled by TerminalPane */ } },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Aether Terminal", action: () => setAboutVisible(true) },
        { label: "Keyboard Shortcuts", action: () => setSettingsVisible(true) },
      ],
    },
  ], [handleOpenFolder, handleCloseFolder, addTab, activeFile, handleCloseFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        const name = prompt("New file name:");
        if (name && projectPath) {
          import("@tauri-apps/api/core").then(({ invoke: inv }) => {
            inv("create_file", { path: `${projectPath}/${name}` }).then(() => {
              handleFileSelect(`${projectPath}/${name}`);
            }).catch(() => {});
          });
        }
      }
      else if (e.ctrlKey && e.shiftKey && e.key === "P") { e.preventDefault(); setPaletteVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); addTab("powershell"); }
      else if (e.ctrlKey && e.shiftKey && e.key === "W") { e.preventDefault(); closeTab(activeTabId); }
      else if (e.ctrlKey && e.shiftKey && e.key === "F") { e.preventDefault(); setSearchVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "O") { e.preventDefault(); handleOpenFolder(); }
      else if (e.ctrlKey && e.shiftKey && e.key === "E") { e.preventDefault(); setSearchVisible(false); }
      else if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        const prompt = window.prompt("Enter prompt for Claude agent:");
        if (prompt) handleStartAgent(prompt);
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
    <div key={tab.id} style={{ display: tab.id === activeTabId ? "flex" : "none", flex: 1 }}>
      <TerminalPane shell={tab.shell} cwd={tab.cwd} />
    </div>
  ));

  // Welcome screen when no project is open
  if (!rootProjectPath) {
    return (
      <div className="app-container">
        <WelcomeScreen onOpenProject={handleOpenProject} />
      </div>
    );
  }

  const editorArea = activeFile ? (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Editor file tabs */}
      <div style={{ display: "flex", height: 28, background: "var(--aether-bg-sidebar)", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 1, padding: "0 4px", overflow: "auto" }}>
        {openFiles.map((f) => {
          const name = f.split("/").pop() ?? f;
          return (
            <button
              key={f}
              onClick={() => setActiveFile(f)}
              style={{
                background: f === activeFile ? "rgba(255,255,255,0.07)" : "transparent",
                color: f === activeFile ? "var(--text-primary)" : "var(--text-muted)",
                border: "none", borderRadius: 4, padding: "3px 10px", fontSize: 11,
                fontFamily: "var(--font-ui)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {name}
              <span
                role="button"
                aria-label={`Close ${name}`}
                onClick={(e) => { e.stopPropagation(); handleCloseFile(f); }}
                style={{ fontSize: 11, opacity: 0.5, cursor: "pointer" }}
              >×</span>
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading editor...</div>}>
        <EditorPanel filePath={activeFile} onClose={() => handleCloseFile(activeFile!)} projectPath={projectPath} initialLine={editorLine} initialDiffMode={openInDiff} />
      </Suspense>
    </div>
  ) : null;

  // Left panel content based on sidebar section
  const leftPanelContent = (() => {
    switch (sidebarSection) {
      case "files":
        return (
          <>
            <WorktreeManager projectPath={projectPath} onSwitch={(path) => {
              setRootProjectPath(path.replace(/\\/g, "/"));
              addTabWithCwd("powershell", path.replace(/\\/g, "/"));
            }} />
            <FileTree rootPath={projectPath} onFileSelect={handleFileSelect} onOpenDiff={handleOpenDiff} changedFiles={changedFiles} />
            <HelmPanel />
            <SearchPanel
              visible={searchVisible}
              rootPath={projectPath}
              onClose={() => setSearchVisible(false)}
              onResultClick={(file, line) => { handleFileSelect(file); setEditorLine(line); }}
            />
          </>
        );
      case "tasks":
        return (
          <KanbanBoard
            onStartAgent={handleStartAgent}
            onMoveWithSideEffects={handleKanbanMove}
          />
        );
      case "agents":
        return (
          <AgentInspector
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onStartAgent={handleStartAgent}
            onStopAgent={stopAgent}
          />
        );
      case "tools":
        return <ToolkitPanel projectName={projectName} onRunCommand={handleRunCommand} />;
    }
  })();

  // Determine agent status text for status bar
  const agentStatusText = activeAgent
    ? `${activeAgent.status} (${activeAgent.model})`
    : undefined;

  return (
    <div className="app-container">
      <ProjectHeaderBar
        projectName={projectName}
        branch={branch}
        status={headerStatus as "idle" | "edit" | "thinking"}
        activeAgent={activeAgent ? { model: activeAgent.model, cost: activeAgent.cost } : null}
        onOpenSettings={() => setSettingsVisible(true)}
      />
      <MenuBar menus={menus} />

      <main className="app-main" role="main">
        <Sidebar />

        <div className="left-panel" role="navigation" aria-label="Project sidebar" style={{ position: "relative" }}>
          {leftPanelContent}
        </div>

        <div className="center-panel" role="region" aria-label="Terminal and editor">
          {editorArea ? (
            <SplitPane
              direction="vertical"
              defaultRatio={0.5}
              first={editorArea}
              second={<div style={{ flex: 1, display: "flex" }}>{terminalTabs}</div>}
            />
          ) : (
            terminalTabs
          )}
        </div>

        {sidebarSection !== "agents" && sidebarSection !== "tools" && (
          <div className="right-panel" role="complementary" aria-label="Agent inspector">
            <AgentInspector
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onStartAgent={handleStartAgent}
              onStopAgent={stopAgent}
            />
            <ToolkitPanel projectName={projectName} onRunCommand={handleRunCommand} />
          </div>
        )}
      </main>

      <WorkspaceTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleTabSwitch}
        onCloseTab={closeTab}
        onNewTab={addTab}
        branch={branch}
        changedCount={changedFiles.length}
      />

      <StatusBar
        shell={activeTab.shell}
        branch={branch}
        changedCount={changedFiles.length}
        agentStatus={agentStatusText}
      />

      <CommandPalette visible={paletteVisible} onClose={() => setPaletteVisible(false)} commands={commands} />
      <Settings visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <WatchdogDialog visible={watchdogVisible} onClose={() => setWatchdogVisible(false)} />
      <AboutDialog visible={aboutVisible} onClose={() => setAboutVisible(false)} />
      <WebInspector visible={webInspectorVisible} onClose={() => setWebInspectorVisible(false)} />
      <PRInspector visible={prInspectorVisible} projectPath={projectPath} onClose={() => setPrInspectorVisible(false)} onStartReview={(prompt) => handleStartAgent(prompt)} />
    </div>
  );
}
