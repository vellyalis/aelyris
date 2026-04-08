import { TitleBar } from "./features/titlebar/TitleBar";
import { TabBar } from "./features/titlebar/TabBar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TerminalArea } from "./features/terminal/TerminalArea";
import { useTabManager } from "./shared/hooks/useTabManager";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export function App() {
  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab } =
    useTabManager("powershell");

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
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{ display: tab.id === activeTabId ? "flex" : "none", flex: 1 }}
          >
            <TerminalArea shell={tab.shell} />
          </div>
        ))}
      </main>
      <StatusBar activeShell={activeTab.shell} onShellChange={addTab} />
    </div>
  );
}
