import { useState, useCallback } from "react";
import type { ShellType } from "../../App";

export interface Tab {
  id: string;
  label: string;
  shell: ShellType;
  cwd?: string;
}

let nextId = 1;

function createTab(shell: ShellType, cwd?: string): Tab {
  const id = `tab-${nextId++}`;
  const labels: Record<ShellType, string> = {
    powershell: "PowerShell",
    cmd: "CMD",
    gitbash: "Git Bash",
    wsl: "WSL",
  };
  // Use folder name as label if cwd is provided
  const label = cwd
    ? cwd.split("/").filter(Boolean).pop() ?? labels[shell]
    : labels[shell];
  return { id, label, shell, cwd };
}

export function useTabManager(defaultShell: ShellType = "powershell") {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab(defaultShell)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => `tab-1`);

  const addTab = useCallback((shell: ShellType) => {
    const tab = createTab(shell);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) return prev; // Don't close last tab
      return next;
    });
    setActiveTabId((currentId) => {
      if (currentId !== id) return currentId;
      // Switch to adjacent tab
      const idx = tabs.findIndex((t) => t.id === id);
      const nextTab = tabs[idx - 1] ?? tabs[idx + 1];
      return nextTab?.id ?? currentId;
    });
  }, [tabs]);

  const addTabWithCwd = useCallback((shell: ShellType, cwd: string) => {
    const tab = createTab(shell, cwd);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, addTabWithCwd };
}
