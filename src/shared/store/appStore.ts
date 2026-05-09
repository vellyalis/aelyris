import { create } from "zustand";
import { formatFallbackError, reportFallback } from "../lib/fallbackTelemetry";
import {
  buildWorkspaceProfile,
  createWorkspaceProfileState,
  parseWorkspaceProfileState,
  type ResolvedWorkspaceProfile,
  upsertThreadRunState,
  upsertWorkspaceProfileOverride,
  type WorkspaceProfileOverride,
  type WorkspaceProfileState,
  type WorkspaceThreadRunState,
} from "../lib/workspaceProfile";
import { ACCENT_KEYS, isValidHex, normalizeHex, type AccentKey, type AccentOverrides } from "../themes/catppuccin";
import { DEFAULT_MOOD_PRESET, type MoodPresetId, normalizeMoodPreset } from "../themes/moods";
import type { KanbanColumnId, KanbanTask } from "../types/kanban";

export type SidebarSection = "files" | "tasks" | "agents" | "tools";

const THEME_OVERRIDES_KEY = "aether:themeOverrides";
const MOOD_PRESET_KEY = "aether:moodPreset";
const WORKSPACE_PROFILES_KEY = "aether:workspaceProfiles";

function reportStorageFailure(operation: string, err: unknown, severity: "info" | "warning" = "warning"): void {
  reportFallback(
    {
      source: "app-store",
      operation,
      severity,
      message: formatFallbackError(err),
    },
    { throttleMs: 10_000 },
  );
}

export function sanitizeThemeOverrides(value: unknown): Record<string, AccentOverrides> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned: Record<string, AccentOverrides> = {};
  for (const [themeId, overrideValue] of Object.entries(value as Record<string, unknown>)) {
    if (!overrideValue || typeof overrideValue !== "object" || Array.isArray(overrideValue)) continue;
    const next: AccentOverrides = {};
    for (const key of ACCENT_KEYS) {
      const rawOverride = (overrideValue as Record<string, unknown>)[key];
      if (typeof rawOverride === "string" && isValidHex(rawOverride)) {
        next[key] = normalizeHex(rawOverride);
      }
    }
    if (Object.keys(next).length > 0) cleaned[themeId] = next;
  }
  return cleaned;
}

function loadThemeOverrides(): Record<string, AccentOverrides> {
  try {
    const raw = localStorage.getItem(THEME_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeThemeOverrides(parsed);
  } catch (err) {
    reportStorageFailure("load_theme_overrides", err);
    return {};
  }
}

function persistThemeOverrides(state: Record<string, AccentOverrides>): void {
  try {
    localStorage.setItem(THEME_OVERRIDES_KEY, JSON.stringify(state));
  } catch (err) {
    reportStorageFailure("persist_theme_overrides", err);
  }
}

interface AppState {
  // Theme
  themeId: string;
  setThemeId: (id: string) => void;
  moodPresetId: MoodPresetId;
  setMoodPresetId: (id: string) => void;
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
  replaceOpenPath: (oldPath: string, newPath: string) => void;
  removeOpenPath: (path: string) => void;

  // Unsaved file tracking (replaces DOM-based modDot detection)
  unsavedFiles: Set<string>;
  markUnsaved: (path: string) => void;
  markSaved: (path: string) => void;
  hasUnsavedChanges: () => boolean;

  // Ghost Diff Overlay (Phase 3C-1d)
  /** When true, inline ghost paint shows layers that are still in progress. */
  ghostDiffLiveMode: boolean;
  setGhostDiffLiveMode: (v: boolean) => void;

  // Workspace Profile System (P2-03)
  workspaceProfiles: WorkspaceProfileState;
  resolveWorkspaceProfile: (
    workspaceRoot: string | null | undefined,
    threadId: string | null | undefined,
  ) => ResolvedWorkspaceProfile;
  setWorkspaceProfileOverride: (workspaceRoot: string, override: WorkspaceProfileOverride) => void;
  setWorkspaceThreadRunState: (
    workspaceRoot: string,
    threadId: string,
    patch: Partial<WorkspaceThreadRunState>,
  ) => void;
}

function toggleOrSet(v: boolean | ((prev: boolean) => boolean), prev: boolean): boolean {
  return typeof v === "function" ? v(prev) : v;
}

function readStorageJson(key: string, fallback: unknown): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    reportStorageFailure(`read_json:${key}`, err, "info");
    return fallback;
  }
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function loadAgentBudget(): { spent: number; limit: number } {
  const parsed = readStorageJson("aether:budget", {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { spent: 0, limit: 10 };
  const record = parsed as Record<string, unknown>;
  return {
    spent: Math.max(0, finiteNumberOr(record.spent, 0)),
    limit: Math.max(0, finiteNumberOr(record.limit, 10)),
  };
}

const KANBAN_COLUMN_IDS = new Set<KanbanColumnId>(["todo", "in_progress", "review", "done"]);
const TASK_PRIORITIES = new Set<KanbanTask["priority"]>(["low", "medium", "high", "critical"]);

function loadKanbanTasks(): KanbanTask[] {
  const parsed = readStorageJson("aether:kanban", []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    .map((item) => {
      const id = typeof item.id === "string" && item.id.trim() ? item.id : null;
      const title = typeof item.title === "string" && item.title.trim() ? item.title : null;
      const column = KANBAN_COLUMN_IDS.has(item.column as KanbanColumnId) ? (item.column as KanbanColumnId) : "todo";
      const priority = TASK_PRIORITIES.has(item.priority as KanbanTask["priority"])
        ? (item.priority as KanbanTask["priority"])
        : "medium";
      if (!id || !title) return null;
      const task: KanbanTask = {
        id,
        title,
        column,
        priority,
        createdAt: finiteNumberOr(item.createdAt, Date.now()),
        updatedAt: finiteNumberOr(item.updatedAt, Date.now()),
      };
      if (typeof item.description === "string") task.description = item.description;
      if (typeof item.assignedAgentId === "string") task.assignedAgentId = item.assignedAgentId;
      if (typeof item.branch === "string") task.branch = item.branch;
      if (typeof item.worktreePath === "string") task.worktreePath = item.worktreePath;
      if (typeof item.terminalTabId === "string") task.terminalTabId = item.terminalTabId;
      if (Array.isArray(item.labels))
        task.labels = item.labels.filter((label): label is string => typeof label === "string").slice(0, 20);
      return task;
    })
    .filter((task): task is KanbanTask => task != null);
}

function loadOpenFiles(): string[] {
  const parsed = readStorageJson("aether:openFiles", []);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

function isPathOrDescendant(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
  return path;
}

function persistEditorFiles(openFiles: string[], activeFile: string | null): void {
  try {
    localStorage.setItem("aether:openFiles", JSON.stringify(openFiles));
  } catch (err) {
    reportStorageFailure("persist_open_files", err);
  }
  try {
    if (activeFile) localStorage.setItem("aether:activeFile", activeFile);
    else localStorage.removeItem("aether:activeFile");
  } catch (err) {
    reportStorageFailure("persist_active_file", err);
  }
}

function loadWorkspaceProfiles(): WorkspaceProfileState {
  try {
    return parseWorkspaceProfileState(localStorage.getItem(WORKSPACE_PROFILES_KEY));
  } catch (err) {
    reportStorageFailure("load_workspace_profiles", err);
    return createWorkspaceProfileState();
  }
}

function persistWorkspaceProfiles(state: WorkspaceProfileState): void {
  try {
    localStorage.setItem(WORKSPACE_PROFILES_KEY, JSON.stringify(state));
  } catch (err) {
    reportStorageFailure("persist_workspace_profiles", err);
  }
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
    } catch (err) {
      reportStorageFailure("persist_theme", err);
    }
  },
  moodPresetId: (() => {
    try {
      return normalizeMoodPreset(localStorage.getItem(MOOD_PRESET_KEY));
    } catch {
      return DEFAULT_MOOD_PRESET;
    }
  })(),
  setMoodPresetId: (id) => {
    const next = normalizeMoodPreset(id);
    set({ moodPresetId: next });
    try {
      localStorage.setItem(MOOD_PRESET_KEY, next);
    } catch (err) {
      reportStorageFailure("persist_mood_preset", err);
    }
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
    } catch (err) {
      reportStorageFailure("persist_last_project", err);
    }
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
      } catch (err) {
        reportStorageFailure("persist_sidebar_collapsed", err, "info");
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
  agentBudget: loadAgentBudget(),
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
  kanbanTasks: loadKanbanTasks(),
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
  openFiles: loadOpenFiles(),
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
  replaceOpenPath: (oldPath, newPath) =>
    set((s) => {
      const seen = new Set<string>();
      const files: string[] = [];
      for (const file of s.openFiles) {
        const next = replacePathPrefix(file, oldPath, newPath);
        if (!seen.has(next)) {
          seen.add(next);
          files.push(next);
        }
      }
      const active = s.activeFile ? replacePathPrefix(s.activeFile, oldPath, newPath) : null;
      const unsavedFiles = new Set<string>();
      for (const file of s.unsavedFiles) {
        unsavedFiles.add(replacePathPrefix(file, oldPath, newPath));
      }
      persistEditorFiles(files, active);
      return { openFiles: files, activeFile: active, unsavedFiles };
    }),
  removeOpenPath: (path) =>
    set((s) => {
      const files = s.openFiles.filter((file) => !isPathOrDescendant(file, path));
      const active =
        s.activeFile && isPathOrDescendant(s.activeFile, path) ? (files[files.length - 1] ?? null) : s.activeFile;
      const unsavedFiles = new Set(Array.from(s.unsavedFiles).filter((file) => !isPathOrDescendant(file, path)));
      persistEditorFiles(files, active);
      return { openFiles: files, activeFile: active, unsavedFiles };
    }),

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

  workspaceProfiles: loadWorkspaceProfiles(),
  resolveWorkspaceProfile: (workspaceRoot, threadId) =>
    buildWorkspaceProfile({
      state: get().workspaceProfiles,
      workspaceRoot,
      threadId,
    }),
  setWorkspaceProfileOverride: (workspaceRoot, override) =>
    set((s) => {
      const next = upsertWorkspaceProfileOverride(s.workspaceProfiles, workspaceRoot, override);
      persistWorkspaceProfiles(next);
      return { workspaceProfiles: next };
    }),
  setWorkspaceThreadRunState: (workspaceRoot, threadId, patch) =>
    set((s) => {
      const next = upsertThreadRunState(s.workspaceProfiles, workspaceRoot, threadId, patch);
      persistWorkspaceProfiles(next);
      return { workspaceProfiles: next };
    }),
}));
