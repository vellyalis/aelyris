import { useState, useCallback, useEffect } from "react";
import type { ShellType } from "../../App";

export interface Tab {
  id: string;
  label: string;
  shell: ShellType;
  cwd?: string;
  worktreeBranch?: string;
}

let nextId = 1;

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

function createTab(shell: ShellType, cwd?: string): Tab {
  const id = `tab-${nextId++}`;
  const label = cwd
    ? cwd.split("/").filter(Boolean).pop() ?? SHELL_LABELS[shell]
    : SHELL_LABELS[shell];
  return { id, label, shell, cwd };
}

function loadSavedTabs(): Tab[] | null {
  try {
    const saved = localStorage.getItem("aether:tabs");
    if (saved) {
      const parsed = JSON.parse(saved) as Tab[];
      if (parsed.length > 0) {
        nextId = Math.max(...parsed.map((t) => parseInt(t.id.replace("tab-", "")) || 0)) + 1;
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function saveTabs(tabs: Tab[], activeId: string) {
  try {
    localStorage.setItem("aether:tabs", JSON.stringify(tabs));
    localStorage.setItem("aether:activeTab", activeId);
  } catch { /* ignore */ }
}

export function useTabManager(defaultShell: ShellType = "powershell") {
  const [tabs, setTabs] = useState<Tab[]>(() => loadSavedTabs() ?? [createTab(defaultShell)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try { return localStorage.getItem("aether:activeTab") ?? "tab-1"; } catch { return "tab-1"; }
  });

  // Persist tabs on change
  useEffect(() => { saveTabs(tabs, activeTabId); }, [tabs, activeTabId]);

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

  const addTabWithCwd = useCallback((shell: ShellType, cwd: string, worktreeBranch?: string) => {
    const tab = createTab(shell, cwd);
    if (worktreeBranch) tab.worktreeBranch = worktreeBranch;
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Activity tracking for notification badges
  const [activityTabs, setActivityTabs] = useState<Set<string>>(new Set());

  const markTabActivity = useCallback((tabId: string) => {
    setActivityTabs((prev) => {
      if (prev.has(tabId)) return prev;
      return new Set(prev).add(tabId);
    });
  }, []);

  // Clear activity when switching to a tab
  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActivityTabs((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  return { tabs, activeTab, activeTabId, setActiveTabId: selectTab, addTab, closeTab, addTabWithCwd, activityTabs, markTabActivity };
}
