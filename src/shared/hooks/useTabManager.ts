import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellType } from "../../App";

export interface Tab {
  id: string;
  label: string;
  shell: ShellType;
  cwd?: string;
  worktreeBranch?: string;
}

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

function createTab(shell: ShellType, cwd?: string): Tab {
  const id = `tab-${crypto.randomUUID().slice(0, 8)}`;
  const label = cwd ? (cwd.split("/").filter(Boolean).pop() ?? SHELL_LABELS[shell]) : SHELL_LABELS[shell];
  return { id, label, shell, cwd };
}

function loadSavedTabs(): Tab[] | null {
  try {
    const saved = localStorage.getItem("aether:tabs");
    if (saved) {
      const parsed = JSON.parse(saved) as Tab[];
      if (parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveTabs(tabs: Tab[], activeId: string) {
  try {
    localStorage.setItem("aether:tabs", JSON.stringify(tabs));
    localStorage.setItem("aether:activeTab", activeId);
  } catch {
    /* ignore */
  }
}

export function useTabManager(defaultShell: ShellType = "powershell") {
  // Initialize tabs and activeTabId together to keep them in sync
  const [initialState] = useState(() => {
    const saved = loadSavedTabs();
    const tabs = saved ?? [createTab(defaultShell)];
    let activeId: string;
    try {
      const savedActive = localStorage.getItem("aether:activeTab");
      activeId = savedActive && tabs.some((t) => t.id === savedActive) ? savedActive : (tabs[0]?.id ?? "");
    } catch {
      activeId = tabs[0]?.id ?? "";
    }
    return { tabs, activeId };
  });
  const [tabs, setTabs] = useState<Tab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialState.activeId);

  // Persist tabs on change
  useEffect(() => {
    saveTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

  const addTab = useCallback((shell: ShellType) => {
    const tab = createTab(shell);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) return prev;
      return next;
    });
    setActiveTabId((currentId) => {
      if (currentId !== id) return currentId;
      const latest = tabsRef.current;
      const idx = latest.findIndex((t) => t.id === id);
      const nextTab = latest[idx - 1] ?? latest[idx + 1];
      return nextTab?.id ?? currentId;
    });
  }, []);

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

  const reorderTab = useCallback((fromId: string, toId: string) => {
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      const toIdx = prev.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId: selectTab,
    addTab,
    closeTab,
    addTabWithCwd,
    activityTabs,
    markTabActivity,
    reorderTab,
  };
}
