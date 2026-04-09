import { useState, useCallback } from "react";
import { TitleBar } from "./features/titlebar/TitleBar";
import { TabBar } from "./features/titlebar/TabBar";
import { Sidebar } from "./features/sidebar/Sidebar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TerminalArea } from "./features/terminal/TerminalArea";
import { useTabManager } from "./shared/hooks/useTabManager";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd } =
    useTabManager("powershell");

  const handleProjectSelect = useCallback((path: string) => {
    addTabWithCwd("powershell", path);
  }, [addTabWithCwd]);

  // Ctrl+B to toggle sidebar
  useState(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "b") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

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
              <TerminalArea shell={tab.shell} cwd={tab.cwd} />
            </div>
          ))}
        </div>
      </main>
      <StatusBar activeShell={activeTab.shell} onShellChange={addTab} />
    </div>
  );
}
