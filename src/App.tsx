import { useState, useEffect, useMemo, useCallback } from "react";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { FileTree } from "./features/file-tree/FileTree";
import { HelmPanel } from "./features/helm/HelmPanel";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { EditorPanel } from "./features/editor/EditorPanel";
import { AgentInspector } from "./features/agent-inspector/AgentInspector";
import { ToolkitPanel } from "./features/toolkit/ToolkitPanel";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import { CommandPalette, type Command } from "./features/command-palette/CommandPalette";
import { Settings } from "./features/settings/Settings";
import { SplitPane } from "./shared/ui/SplitPane";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useAgentManager } from "./shared/hooks/useAgentManager";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab } =
    useTabManager("powershell");
  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent } =
    useAgentManager();

  const projectPath = activeTab.cwd ?? "C:/Users/owner/Aether_Terminal";
  const projectName = projectPath.split("/").filter(Boolean).pop() ?? "Aether Terminal";
  const initials = projectName.slice(0, 2).toUpperCase();

  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? (activeAgent.status === "thinking" ? "thinking" : activeAgent.status === "coding" ? "edit" : "idle")
    : "idle";
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);

  const handleStartAgent = useCallback(async (prompt: string) => {
    try { await startAgent(prompt, projectPath); } catch { /* */ }
  }, [startAgent, projectPath]);

  const handleFileSelect = useCallback((path: string) => {
    setOpenFilePath(path);
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
    { id: "close-editor", label: "Close Editor", action: () => setOpenFilePath(null) },
  ], [addTab, closeTab, activeTabId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") { e.preventDefault(); setPaletteVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); addTab("powershell"); }
      else if (e.ctrlKey && e.shiftKey && e.key === "W") { e.preventDefault(); closeTab(activeTabId); }
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

  return (
    <div className="app-container">
      <ProjectHeaderBar
        projectName={projectName}
        initials={initials}
        avatarColor="#7c3aed"
        branch="main"
        status={headerStatus as "idle" | "edit" | "thinking"}
        model="Opus 4.6 (1M context)"
        cost={totalCost}
      />

      <main className="app-main">
        <div className="left-panel">
          <FileTree rootPath={projectPath} onFileSelect={handleFileSelect} />
          <HelmPanel />
        </div>

        <div className="center-panel">
          {openFilePath ? (
            <SplitPane
              direction="vertical"
              defaultRatio={0.5}
              first={<EditorPanel filePath={openFilePath} onClose={() => setOpenFilePath(null)} />}
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
            onSelectSession={setActiveSessionId}
            onStartAgent={handleStartAgent}
            onStopAgent={stopAgent}
          />
          <ToolkitPanel projectName={projectName} />
        </div>
      </main>

      <WorkspaceTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={addTab}
      />

      <CommandPalette visible={paletteVisible} onClose={() => setPaletteVisible(false)} commands={commands} />
      <Settings visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </div>
  );
}
