import { create } from "zustand";
import type { KanbanTask, KanbanColumnId } from "../types/kanban";

export type SidebarSection = "files" | "tasks" | "agents" | "tools";

interface AppState {
  // Project
  rootProjectPath: string | null;
  setRootProjectPath: (path: string | null) => void;

  // Sidebar
  sidebarSection: SidebarSection;
  setSidebarSection: (section: SidebarSection) => void;

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
  webInspectorVisible: boolean;
  setWebInspectorVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  prInspectorVisible: boolean;
  setPrInspectorVisible: (v: boolean | ((prev: boolean) => boolean)) => void;

  // Agent model
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;

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
}

function toggleOrSet(v: boolean | ((prev: boolean) => boolean), prev: boolean): boolean {
  return typeof v === "function" ? v(prev) : v;
}

export const useAppStore = create<AppState>((set) => ({
  // Project
  rootProjectPath: (() => {
    try { return localStorage.getItem("aether:lastProject"); } catch { return null; }
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
  webInspectorVisible: false,
  setWebInspectorVisible: (v) => set((s) => ({ webInspectorVisible: toggleOrSet(v, s.webInspectorVisible) })),
  prInspectorVisible: false,
  setPrInspectorVisible: (v) => set((s) => ({ prInspectorVisible: toggleOrSet(v, s.prInspectorVisible) })),

  // Agent model
  selectedModel: (() => {
    try { return localStorage.getItem("aether:selectedModel") ?? "claude-sonnet"; } catch { return "claude-sonnet"; }
  })(),
  setSelectedModel: (modelId) => {
    set({ selectedModel: modelId });
    try { localStorage.setItem("aether:selectedModel", modelId); } catch {}
  },

  // Kanban
  kanbanTasks: (() => {
    try { return JSON.parse(localStorage.getItem("aether:kanban") ?? "[]") as KanbanTask[]; } catch { return [] as KanbanTask[]; }
  })(),
  activeTaskId: null,
  addKanbanTask: (title, priority = "medium") => set((s) => {
    const task: KanbanTask = { id: `task-${Date.now()}`, title, column: "todo", priority, createdAt: Date.now(), updatedAt: Date.now() };
    const tasks = [...s.kanbanTasks, task];
    try { localStorage.setItem("aether:kanban", JSON.stringify(tasks)); } catch {}
    return { kanbanTasks: tasks };
  }),
  moveKanbanTask: (taskId, toColumn) => set((s) => {
    const tasks = s.kanbanTasks.map((t) => t.id === taskId ? { ...t, column: toColumn, updatedAt: Date.now() } : t);
    try { localStorage.setItem("aether:kanban", JSON.stringify(tasks)); } catch {}
    return { kanbanTasks: tasks };
  }),
  deleteKanbanTask: (taskId) => set((s) => {
    const tasks = s.kanbanTasks.filter((t) => t.id !== taskId);
    try { localStorage.setItem("aether:kanban", JSON.stringify(tasks)); } catch {}
    return { kanbanTasks: tasks };
  }),
  updateKanbanTask: (taskId, updates) => set((s) => {
    const tasks = s.kanbanTasks.map((t) => t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t);
    try { localStorage.setItem("aether:kanban", JSON.stringify(tasks)); } catch {}
    return { kanbanTasks: tasks };
  }),
  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

  // Editor
  openFiles: (() => {
    try { return JSON.parse(localStorage.getItem("aether:openFiles") ?? "[]"); } catch { return []; }
  })(),
  activeFile: (() => {
    try { return localStorage.getItem("aether:activeFile") ?? null; } catch { return null; }
  })(),
  openFile: (path) => set((s) => {
    const files = s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path];
    try { localStorage.setItem("aether:openFiles", JSON.stringify(files)); } catch {}
    try { localStorage.setItem("aether:activeFile", path); } catch {}
    return { openFiles: files, activeFile: path };
  }),
  closeFile: (path) => set((s) => {
    const files = s.openFiles.filter((f) => f !== path);
    const active = s.activeFile === path ? (files.length > 0 ? files[files.length - 1] : null) : s.activeFile;
    try { localStorage.setItem("aether:openFiles", JSON.stringify(files)); } catch {}
    try { if (active) localStorage.setItem("aether:activeFile", active); else localStorage.removeItem("aether:activeFile"); } catch {}
    return { openFiles: files, activeFile: active };
  }),
  setActiveFile: (path) => {
    set({ activeFile: path });
    try { if (path) localStorage.setItem("aether:activeFile", path); else localStorage.removeItem("aether:activeFile"); } catch {}
  },
  clearFiles: () => {
    set({ openFiles: [], activeFile: null });
    try { localStorage.removeItem("aether:openFiles"); localStorage.removeItem("aether:activeFile"); } catch {}
  },
}));
