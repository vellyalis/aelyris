import { useState, useEffect, useMemo } from "react";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { FileTree } from "./features/file-tree/FileTree";
import { HelmPanel } from "./features/helm/HelmPanel";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { AgentInspector } from "./features/agent-inspector/AgentInspector";
import { ToolkitPanel } from "./features/toolkit/ToolkitPanel";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import { CommandPalette, type Command } from "./features/command-palette/CommandPalette";
import { Settings } from "./features/settings/Settings";
import { useTabManager } from "./shared/hooks/useTabManager";
import type { AgentSession } from "./shared/types/agent";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [agentSessions, _setAgentSessions] = useState<AgentSession[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab } =
    useTabManager("powershell");

  // Derive project info from active tab
  const projectPath = activeTab.cwd ?? "C:/Users/owner/Aether_Terminal";
  const projectName = projectPath.split("/").filter(Boolean).pop() ?? "Aether Terminal";
  const initials = projectName.slice(0, 2).toUpperCase();

  const commands: Command[] = useMemo(() => [
    { id: "new-tab-ps", label: "New Terminal: PowerShell", shortcut: "Ctrl+Shift+T", action: () => addTab("powershell") },
    { id: "new-tab-cmd", label: "New Terminal: CMD", action: () => addTab("cmd") },
    { id: "new-tab-gitbash", label: "New Terminal: Git Bash", action: () => addTab("gitbash") },
    { id: "new-tab-wsl", label: "New Terminal: WSL", action: () => addTab("wsl") },
    { id: "close-tab", label: "Close Current Tab", shortcut: "Ctrl+Shift+W", action: () => closeTab(activeTabId) },
    { id: "open-settings", label: "Open Settings", shortcut: "Ctrl+,", action: () => setSettingsVisible(true) },
  ], [addTab, closeTab, activeTabId]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") { e.preventDefault(); setPaletteVisible((v) => !v); }
      else if (e.ctrlKey && e.shiftKey && e.key === "T") { e.preventDefault(); addTab("powershell"); }
      else if (e.ctrlKey && e.shiftKey && e.key === "W") { e.preventDefault(); closeTab(activeTabId); }
      else if (e.ctrlKey && e.key === ",") { e.preventDefault(); setSettingsVisible((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTabId]);

  return (
    <div className="app-container">
      <ProjectHeaderBar
        projectName={projectName}
        initials={initials}
        avatarColor="#7c3aed"
        branch="main"
        status="idle"
        model="Opus 4.6 (1M context)"
        cost={0.01}
      />

      <main className="app-main">
        {/* Left Panel: FileTree + Helm */}
        <div className="left-panel">
          <FileTree rootPath={projectPath} />
          <HelmPanel />
        </div>

        {/* Center: Terminal */}
        <div className="center-panel">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: tab.id === activeTabId ? "flex" : "none", flex: 1 }}
            >
              <TerminalPane shell={tab.shell} cwd={tab.cwd} />
            </div>
          ))}
        </div>

        {/* Right Panel: Sessions + Toolkit */}
        <div className="right-panel">
          <AgentInspector
            sessions={agentSessions}
            activeSessionId={activeAgentId}
            onSelectSession={setActiveAgentId}
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
