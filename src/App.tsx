import { useState, useCallback, useEffect, useMemo } from "react";
import { TitleBar } from "./features/titlebar/TitleBar";
import { TabBar } from "./features/titlebar/TabBar";
import { Sidebar } from "./features/sidebar/Sidebar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { CommandPalette, type Command } from "./features/command-palette/CommandPalette";
import { useTabManager } from "./shared/hooks/useTabManager";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd } =
    useTabManager("powershell");

  const handleProjectSelect = useCallback((path: string) => {
    addTabWithCwd("powershell", path);
  }, [addTabWithCwd]);

  const commands: Command[] = useMemo(() => [
    { id: "new-tab-ps", label: "New Terminal: PowerShell", shortcut: "Ctrl+Shift+T", action: () => addTab("powershell") },
    { id: "new-tab-cmd", label: "New Terminal: CMD", action: () => addTab("cmd") },
    { id: "new-tab-gitbash", label: "New Terminal: Git Bash", action: () => addTab("gitbash") },
    { id: "new-tab-wsl", label: "New Terminal: WSL", action: () => addTab("wsl") },
    { id: "toggle-sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", action: () => setSidebarVisible((v) => !v) },
    { id: "close-tab", label: "Close Current Tab", shortcut: "Ctrl+Shift+W", action: () => closeTab(activeTabId) },
  ], [addTab, closeTab, activeTabId]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setPaletteVisible((v) => !v);
      } else if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        addTab("powershell");
      } else if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addTab, closeTab, activeTabId]);

  return (
    <div className="app-container">
      <TitleBar />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={addTab}
      />
      <main className="app-main">
        <Sidebar visible={sidebarVisible} onProjectSelect={handleProjectSelect} />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{ display: tab.id === activeTabId ? "flex" : "none", flex: 1 }}
            >
              <TerminalPane shell={tab.shell} cwd={tab.cwd} />
            </div>
          ))}
        </div>
      </main>
      <StatusBar activeShell={activeTab.shell} onShellChange={addTab} />
      <CommandPalette
        visible={paletteVisible}
        onClose={() => setPaletteVisible(false)}
        commands={commands}
      />
    </div>
  );
}
