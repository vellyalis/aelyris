import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellType } from "../types/terminalPane";

export interface Tab {
  id: string;
  label: string;
  shell: ShellType;
  cwd?: string;
  worktreeBranch?: string;
}

export const VISUAL_QA_FALLBACK_PROJECT_PATH = "C:/repo/aelyris";

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

function readVisualQaProjectPath(): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  let storedProject: string | null = null;
  try {
    storedProject = window.localStorage.getItem("aelyris:visualQaProject");
  } catch {
    /* storage may be unavailable in private/test contexts */
  }
  const enabled = params.get("aelyrisVisualQa") === "1" || params.get("visualQa") === "1";
  if (!enabled) return null;
  return (params.get("projectPath") || storedProject || VISUAL_QA_FALLBACK_PROJECT_PATH).replace(/\\/g, "/");
}

// Validate that a parsed tab has the minimum shape we need. Without this,
// a corrupted localStorage entry — or an older app version that stored a
// different schema — would surface as a TypeError later when callers do
// `tabs.some(t => t.id === ...)` on entries that lack a string id. Drop
// invalid entries silently and treat empty results as "no saved tabs".
const VALID_SHELLS: ShellType[] = ["powershell", "cmd", "gitbash", "wsl"];

function isValidTab(value: unknown): value is Tab {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.shell === "string" &&
    VALID_SHELLS.includes(v.shell as ShellType)
  );
}

function loadSavedTabs(): Tab[] | null {
  try {
    const saved = localStorage.getItem("aelyris:tabs");
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isValidTab);
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function saveTabs(tabs: Tab[], activeId: string) {
  try {
    localStorage.setItem("aelyris:tabs", JSON.stringify(tabs));
    localStorage.setItem("aelyris:activeTab", activeId);
  } catch {
    /* ignore */
  }
}

export function useTabManager(defaultShell: ShellType = "powershell") {
  // Initialize tabs and activeTabId together to keep them in sync
  const [initialState] = useState(() => {
    const visualQaProjectPath = readVisualQaProjectPath();
    if (visualQaProjectPath) {
      const tab: Tab = {
        id: "tab-visual-qa",
        label: visualQaProjectPath.split("/").filter(Boolean).pop() ?? "Aelyris",
        shell: defaultShell,
        cwd: visualQaProjectPath,
      };
      return { tabs: [tab], activeId: tab.id };
    }
    const saved = loadSavedTabs();
    const tabs = saved ?? [createTab(defaultShell)];
    let activeId: string;
    try {
      const savedActive = localStorage.getItem("aelyris:activeTab");
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
