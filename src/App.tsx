import { useState, useEffect, useMemo, useCallback } from "react";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { MenuBar, type Menu } from "./features/menubar/MenuBar";
import { FileTree } from "./features/file-tree/FileTree";
import { HelmPanel } from "./features/helm/HelmPanel";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { EditorPanel } from "./features/editor/EditorPanel";
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

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const [rootProjectPath, setRootProjectPath] = useState<string | null>(() => {
    try { return localStorage.getItem("aether:lastProject"); } catch { return null; }
  });
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [openFiles, setOpenFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("aether:openFiles") ?? "[]"); } catch { return []; }
  });
  const [activeFile, setActiveFile] = useState<string | null>(() => {
    try { return localStorage.getItem("aether:activeFile") ?? null; } catch { return null; }
  });
  const [watchdogVisible, setWatchdogVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [webInspectorVisible, setWebInspectorVisible] = useState(false);
  const [prInspectorVisible, setPrInspectorVisible] = useState(false);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd } =
    useTabManager("powershell");
  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent } =
    useAgentManager();

  // Project path: from active tab's cwd, or from root selection
  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  const projectName = projectPath ? projectPath.split("/").filter(Boolean).pop() ?? "Aether" : "Aether";
  // Persist open files
  useEffect(() => {
    try { localStorage.setItem("aether:openFiles", JSON.stringify(openFiles)); } catch {}
  }, [openFiles]);
  useEffect(() => {
    try { if (activeFile) localStorage.setItem("aether:activeFile", activeFile); else localStorage.removeItem("aether:activeFile"); } catch {}
  }, [activeFile]);

  // Persist last project to localStorage
  useEffect(() => {
    try {
      if (rootProjectPath) localStorage.setItem("aether:lastProject", rootProjectPath);
      else localStorage.removeItem("aether:lastProject");
    } catch { /* ignore */ }
  }, [rootProjectPath]);

  // Update window title to folder name
  useEffect(() => {
    const title = projectPath ? `${projectName} — Aether Terminal` : "Aether Terminal";
    document.title = title;
    // Also update Tauri window title
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title).catch(() => {});
    }).catch(() => {});
  }, [projectName, projectPath]);

  // Open project: set root + create first tab with that CWD
  const handleOpenProject = useCallback((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    setRootProjectPath(normalized);
    addTabWithCwd("powershell", normalized);
    setOpenFiles([]); setActiveFile(null);
  }, [addTabWithCwd]);

  // Close folder → back to Welcome
  const handleCloseFolder = useCallback(() => {
    setRootProjectPath(null);
    setOpenFiles([]);
    setActiveFile(null);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        handleOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch { /* cancelled or not in Tauri */ }
  }, [handleOpenProject]);

  // Tab switch updates projectPath automatically (via activeTab.cwd)
  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setOpenFiles([]); setActiveFile(null); // Close editor when switching tabs
  }, [setActiveTabId]);

  const { branch, changedFiles } = useGitStatus(projectPath);

  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? (activeAgent.status === "thinking" ? "thinking" : activeAgent.status === "coding" ? "edit" : "idle")
    : "idle";

  const handleStartAgent = useCallback(async (prompt: string) => {
    try {
      const agentId = await startAgent(prompt, projectPath);
      // Create a new tab linked to this agent session
      addTabWithCwd("powershell", projectPath);
      return agentId;
    } catch { /* */ }
  }, [startAgent, projectPath, addTabWithCwd]);

  const handleFileSelect = useCallback((path: string) => {
    setOpenFiles((prev) => prev.includes(path) ? prev : [...prev, path]);
    setActiveFile(path);
  }, []);

  const handleCloseFile = useCallback((path: string) => {
    // Check if Monaco has unsaved changes via DOM query
    const modDots = document.querySelectorAll("[class*='modDot']");
    if (modDots.length > 0 && !window.confirm("You have unsaved changes. Close anyway?")) return;
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f !== path);
      if (activeFile === path) {
        setActiveFile(next.length > 0 ? next[next.length - 1] : null);
      }
      return next;
    });
  }, [activeFile]);

  const handleRunCommand = useCallback(async (command: string) => {
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
      const terminals = await tauriInvoke<string[]>("list_terminals");
      if (terminals.length > 0) {
        await tauriInvoke("write_terminal", { id: terminals[0], data: command + "\r" });
      }
    } catch { /* ignore */ }
  }, []);

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
                onClick={(e) => { e.stopPropagation(); handleCloseFile(f); }}
                style={{ fontSize: 11, opacity: 0.5, cursor: "pointer" }}
              >×</span>
            </button>
          );
        })}
      </div>
      <EditorPanel filePath={activeFile} onClose={() => handleCloseFile(activeFile!)} projectPath={projectPath} />
    </div>
  ) : null;

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

      <main className="app-main">
        <div className="left-panel" style={{ position: "relative" }}>
          <FileTree rootPath={projectPath} onFileSelect={handleFileSelect} changedFiles={changedFiles} />
          <HelmPanel />
          <SearchPanel
            visible={searchVisible}
            rootPath={projectPath}
            onClose={() => setSearchVisible(false)}
            onResultClick={(file) => handleFileSelect(file)}
          />
        </div>

        <div className="center-panel">
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

        <div className="right-panel">
          <AgentInspector
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={(sessionId) => {
              setActiveSessionId(sessionId);
              // Find matching tab by agent's CWD and switch to it
              const agent = sessions.find((s) => s.id === sessionId);
              if (agent) {
                const matchTab = tabs.find((t) => t.cwd && agent.prompt.includes(t.cwd.split("/").pop() ?? ""));
                if (matchTab) handleTabSwitch(matchTab.id);
              }
            }}
            onStartAgent={handleStartAgent}
            onStopAgent={stopAgent}
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
        branch={branch}
        changedCount={changedFiles.length}
      />

      <CommandPalette visible={paletteVisible} onClose={() => setPaletteVisible(false)} commands={commands} />
      <Settings visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <WatchdogDialog visible={watchdogVisible} onClose={() => setWatchdogVisible(false)} />
      <AboutDialog visible={aboutVisible} onClose={() => setAboutVisible(false)} />
      <WebInspector visible={webInspectorVisible} onClose={() => setWebInspectorVisible(false)} />
      <PRInspector visible={prInspectorVisible} projectPath={projectPath} onClose={() => setPrInspectorVisible(false)} />
    </div>
  );
}
