import { create } from "zustand";
import type { AccentKey, AccentOverrides } from "../themes/catppuccin";
import type { KanbanColumnId, KanbanTask } from "../types/kanban";

export type SidebarSection = "files" | "tasks" | "agents" | "tools";

const THEME_OVERRIDES_KEY = "aether:themeOverrides";

function loadThemeOverrides(): Record<string, AccentOverrides> {
  try {
    const raw = localStorage.getItem(THEME_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, AccentOverrides>;
    }
    return {};
  } catch {
    return {};
  }
}

function persistThemeOverrides(state: Record<string, AccentOverrides>): void {
  try {
    localStorage.setItem(THEME_OVERRIDES_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
}

interface AppState {
  // Theme
  themeId: string;
  setThemeId: (id: string) => void;
  /** Per-themeId accent overrides. Each entry is a partial palette that
   * layers on top of the base catppuccin palette. */
  themeOverrides: Record<string, AccentOverrides>;
  /** Set or clear a single accent for the given theme. Pass `undefined` to
   * clear the override and fall back to the base palette value. */
  setAccentOverride: (themeId: string, key: AccentKey, value: string | undefined) => void;
  /** Drop all overrides for the given theme. */
  resetThemeOverrides: (themeId: string) => void;

  // Project
  rootProjectPath: string | null;
  setRootProjectPath: (path: string | null) => void;

  // Sidebar
  sidebarSection: SidebarSection;
  setSidebarSection: (section: SidebarSection) => void;
  /** Whether the left sidebar (FileTree / Kanban / SCM) is hidden.
   *  Toggles via Ctrl+B and the chrome cluster's panel button.
   *  Persisted to localStorage so the choice survives reload. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** User-resized sidebar width in pixels. Drag handle on the
   *  panel's right edge writes here; CSS reads it as
   *  `--sidebar-width`. Clamped to [200, 480] in the setter. */
  sidebarWidth: number;
  setSidebarWidth: (v: number) => void;
  /** User-resized right panel (Agent Inspector / Workflow / Toolkit /
   *  Logs) width in pixels. Drag handle on the panel's left edge
   *  writes here. Clamped to [260, 480] in the setter. */
  rightPanelWidth: number;
  setRightPanelWidth: (v: number) => void;

  // UI visibility
  paletteVisible: boolean;
  setPaletteVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  settingsVisible: boolean;
  setSettingsVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  watchdogVisible: boolean;
  setWatchdogVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  searchVisible: boolean;
  setSearchVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  aboutVisible: boolean;
  setAboutVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  helpVisible: boolean;
  setHelpVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  webInspectorVisible: boolean;
  setWebInspectorVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  prInspectorVisible: boolean;
  setPrInspectorVisible: (v: boolean | ((prev: boolean) => boolean)) => void;

  // Agent model
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;

  // Budget
  agentBudget: { spent: number; limit: number };
  addAgentCost: (cost: number) => void;
  setAgentBudgetLimit: (limit: number) => void;
  /** Per-session cost cap in USD. Exceeding triggers a warning badge. */
  perSessionCostCap: number;
  setPerSessionCostCap: (cap: number) => void;
  /** Context usage percent (0-100) above which the session is flagged. */
  contextWarnPct: number;
  setContextWarnPct: (pct: number) => void;

  // Kanban
  kanbanTasks: KanbanTask[];
  activeTaskId: string | null;
  addKanbanTask: (title: string, priority?: KanbanTask["priority"]) => void;
  moveKanbanTask: (taskId: string, toColumn: KanbanColumnId) => void;
  deleteKanbanTask: (taskId: string) => void;
  updateKanbanTask: (taskId: string, updates: Partial<KanbanTask>) => void;
  setActiveTaskId: (taskId: string | null) => void;

  // Editor
  openFiles: string[];
  activeFile: string | null;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  clearFiles: () => void;

  // Unsaved file tracking (replaces DOM-based modDot detection)
  unsavedFiles: Set<string>;
  markUnsaved: (path: string) => void;
  markSaved: (path: string) => void;
  hasUnsavedChanges: () => boolean;

  // Ghost Diff Overlay (Phase 3C-1d)
  /** When true, inline ghost paint shows layers that are still in progress. */
  ghostDiffLiveMode: boolean;
  setGhostDiffLiveMode: (v: boolean) => void;
}

function toggleOrSet(v: boolean | ((prev: boolean) => boolean), prev: boolean): boolean {
  return typeof v === "function" ? v(prev) : v;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Theme
  themeId: (() => {
    try {
      return localStorage.getItem("aether:theme") ?? "aether-dark";
    } catch {
      return "aether-dark";
    }
  })(),
  setThemeId: (id) => {
    set({ themeId: id });
    try {
      localStorage.setItem("aether:theme", id);
    } catch {}
  },

  themeOverrides: loadThemeOverrides(),
  setAccentOverride: (themeId, key, value) =>
    set((s) => {
      const current = s.themeOverrides[themeId] ?? {};
      const nextForTheme: AccentOverrides = { ...current };
      if (value === undefined) {
        delete nextForTheme[key];
      } else {
        nextForTheme[key] = value;
      }
      const nextAll = { ...s.themeOverrides };
      if (Object.keys(nextForTheme).length === 0) {
        delete nextAll[themeId];
      } else {
        nextAll[themeId] = nextForTheme;
      }
      persistThemeOverrides(nextAll);
      return { themeOverrides: nextAll };
    }),
  resetThemeOverrides: (themeId) =>
    set((s) => {
      if (!(themeId in s.themeOverrides)) return s;
      const nextAll = { ...s.themeOverrides };
      delete nextAll[themeId];
      persistThemeOverrides(nextAll);
      return { themeOverrides: nextAll };
    }),

  // Project
  rootProjectPath: (() => {
    try {
      return localStorage.getItem("aether:lastProject");
    } catch {
      return null;
    }
  })(),
  setRootProjectPath: (path) => {
    set({ rootProjectPath: path });
    try {
      if (path) localStorage.setItem("aether:lastProject", path);
      else localStorage.removeItem("aether:lastProject");
    } catch {}
  },

  // Sidebar
  sidebarSection: "files" as SidebarSection,
  setSidebarSection: (section: SidebarSection) => set({ sidebarSection: section }),
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem("aether:sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  })(),
  setSidebarCollapsed: (v) =>
    set((s) => {
      const next = toggleOrSet(v, s.sidebarCollapsed);
      try {
        localStorage.setItem("aether:sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return { sidebarCollapsed: next };
    }),
  sidebarWidth: (() => {
    try {
      const raw = localStorage.getItem("aether:sidebarWidth");
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 480) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return 240;
  })(),
  setSidebarWidth: (v: number) =>
    set(() => {
      const clamped = Math.max(200, Math.min(480, Math.round(v)));
      try {
        localStorage.setItem("aether:sidebarWidth", String(clamped));
      } catch {
        /* ignore */
      }
      return { sidebarWidth: clamped };
    }),
  rightPanelWidth: (() => {
    try {
      const raw = localStorage.getItem("aether:rightPanelWidth");
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 260 && parsed <= 480) {
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return 320;
  })(),
  setRightPanelWidth: (v: number) =>
    set(() => {
      const clamped = Math.max(260, Math.min(480, Math.round(v)));
      try {
        localStorage.setItem("aether:rightPanelWidth", String(clamped));
      } catch {
        /* ignore */
      }
      return { rightPanelWidth: clamped };
    }),

  // UI
  paletteVisible: false,
  setPaletteVisible: (v) => set((s) => ({ paletteVisible: toggleOrSet(v, s.paletteVisible) })),
  settingsVisible: false,
  setSettingsVisible: (v) => set((s) => ({ settingsVisible: toggleOrSet(v, s.settingsVisible) })),
  watchdogVisible: false,
  setWatchdogVisible: (v) => set((s) => ({ watchdogVisible: toggleOrSet(v, s.watchdogVisible) })),
  searchVisible: false,
  setSearchVisible: (v) => set((s) => ({ searchVisible: toggleOrSet(v, s.searchVisible) })),
  aboutVisible: false,
  setAboutVisible: (v) => set((s) => ({ aboutVisible: toggleOrSet(v, s.aboutVisible) })),
  helpVisible: false,
  setHelpVisible: (v) => set((s) => ({ helpVisible: toggleOrSet(v, s.helpVisible) })),
  webInspectorVisible: false,
  setWebInspectorVisible: (v) => set((s) => ({ webInspectorVisible: toggleOrSet(v, s.webInspectorVisible) })),
  prInspectorVisible: false,
  setPrInspectorVisible: (v) => set((s) => ({ prInspectorVisible: toggleOrSet(v, s.prInspectorVisible) })),

  // Agent model
  selectedModel: (() => {
    try {
      return localStorage.getItem("aether:selectedModel") ?? "claude-sonnet";
    } catch {
      return "claude-sonnet";
    }
  })(),
  setSelectedModel: (modelId) => {
    set({ selectedModel: modelId });
    try {
      localStorage.setItem("aether:selectedModel", modelId);
    } catch {}
  },

  // Budget
  agentBudget: (() => {
    try {
      return JSON.parse(localStorage.getItem("aether:budget") ?? '{"spent":0,"limit":10}');
    } catch {
      return { spent: 0, limit: 10 };
    }
  })(),
  addAgentCost: (cost: number) =>
    set((s) => {
      const budget = { ...s.agentBudget, spent: s.agentBudget.spent + cost };
      try {
        localStorage.setItem("aether:budget", JSON.stringify(budget));
      } catch {}
      return { agentBudget: budget };
    }),
  setAgentBudgetLimit: (limit: number) =>
    set((s) => {
      const budget = { ...s.agentBudget, limit };
      try {
        localStorage.setItem("aether:budget", JSON.stringify(budget));
      } catch {}
      return { agentBudget: budget };
    }),
  perSessionCostCap: (() => {
    try {
      const v = Number(localStorage.getItem("aether:perSessionCostCap") ?? "2");
      return Number.isFinite(v) && v > 0 ? v : 2;
    } catch {
      return 2;
    }
  })(),
  setPerSessionCostCap: (cap) => {
    set({ perSessionCostCap: cap });
    try {
      localStorage.setItem("aether:perSessionCostCap", String(cap));
    } catch {}
  },
  contextWarnPct: (() => {
    try {
      const v = Number(localStorage.getItem("aether:contextWarnPct") ?? "85");
      return Number.isFinite(v) && v > 0 && v <= 100 ? v : 85;
    } catch {
      return 85;
    }
  })(),
  setContextWarnPct: (pct) => {
    set({ contextWarnPct: pct });
    try {
      localStorage.setItem("aether:contextWarnPct", String(pct));
    } catch {}
  },

  // Kanban
  kanbanTasks: (() => {
    try {
      return JSON.parse(localStorage.getItem("aether:kanban") ?? "[]") as KanbanTask[];
    } catch {
      return [] as KanbanTask[];
    }
  })(),
  activeTaskId: null,
  addKanbanTask: (title, priority = "medium") =>
    set((s) => {
      const task: KanbanTask = {
        id: `task-${Date.now()}`,
        title,
        column: "todo",
        priority,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const tasks = [...s.kanbanTasks, task];
      try {
        localStorage.setItem("aether:kanban", JSON.stringify(tasks));
      } catch {}
      return { kanbanTasks: tasks };
    }),
  moveKanbanTask: (taskId, toColumn) =>
    set((s) => {
      const tasks = s.kanbanTasks.map((t) => (t.id === taskId ? { ...t, column: toColumn, updatedAt: Date.now() } : t));
      try {
        localStorage.setItem("aether:kanban", JSON.stringify(tasks));
      } catch {}
      return { kanbanTasks: tasks };
    }),
  deleteKanbanTask: (taskId) =>
    set((s) => {
      const tasks = s.kanbanTasks.filter((t) => t.id !== taskId);
      try {
        localStorage.setItem("aether:kanban", JSON.stringify(tasks));
      } catch {}
      return { kanbanTasks: tasks };
    }),
  updateKanbanTask: (taskId, updates) =>
    set((s) => {
      const tasks = s.kanbanTasks.map((t) => (t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t));
      try {
        localStorage.setItem("aether:kanban", JSON.stringify(tasks));
      } catch {}
      return { kanbanTasks: tasks };
    }),
  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

  // Editor
  openFiles: (() => {
    try {
      return JSON.parse(localStorage.getItem("aether:openFiles") ?? "[]");
    } catch {
      return [];
    }
  })(),
  activeFile: (() => {
    try {
      return localStorage.getItem("aether:activeFile") ?? null;
    } catch {
      return null;
    }
  })(),
  openFile: (path) =>
    set((s) => {
      const files = s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path];
      try {
        localStorage.setItem("aether:openFiles", JSON.stringify(files));
      } catch {}
      try {
        localStorage.setItem("aether:activeFile", path);
      } catch {}
      return { openFiles: files, activeFile: path };
    }),
  closeFile: (path) =>
    set((s) => {
      const files = s.openFiles.filter((f) => f !== path);
      const active = s.activeFile === path ? (files.length > 0 ? files[files.length - 1] : null) : s.activeFile;
      try {
        localStorage.setItem("aether:openFiles", JSON.stringify(files));
      } catch {}
      try {
        if (active) localStorage.setItem("aether:activeFile", active);
        else localStorage.removeItem("aether:activeFile");
      } catch {}
      return { openFiles: files, activeFile: active };
    }),
  setActiveFile: (path) => {
    set({ activeFile: path });
    try {
      if (path) localStorage.setItem("aether:activeFile", path);
      else localStorage.removeItem("aether:activeFile");
    } catch {}
  },
  clearFiles: () => {
    set({ openFiles: [], activeFile: null, unsavedFiles: new Set() });
    try {
      localStorage.removeItem("aether:openFiles");
      localStorage.removeItem("aether:activeFile");
    } catch {}
  },

  unsavedFiles: new Set(),
  markUnsaved: (path) =>
    set((s) => {
      if (s.unsavedFiles.has(path)) return s;
      const next = new Set(s.unsavedFiles);
      next.add(path);
      return { unsavedFiles: next };
    }),
  markSaved: (path) =>
    set((s) => {
      if (!s.unsavedFiles.has(path)) return s;
      const next = new Set(s.unsavedFiles);
      next.delete(path);
      return { unsavedFiles: next };
    }),
  hasUnsavedChanges: () => get().unsavedFiles.size > 0,

  // Ghost Diff Overlay (Phase 3C-1d) — bootstrap from localStorage for
  // first paint; Settings load_app_config then rehydrates from config.toml.
  ghostDiffLiveMode: (() => {
    try {
      return localStorage.getItem("aether:ghostDiffLiveMode") === "1";
    } catch {
      return false;
    }
  })(),
  setGhostDiffLiveMode: (v) => {
    set({ ghostDiffLiveMode: v });
    try {
      localStorage.setItem("aether:ghostDiffLiveMode", v ? "1" : "0");
    } catch {}
  },
}));
