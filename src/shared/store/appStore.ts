import { create } from "zustand";

interface AppState {
  // Project
  rootProjectPath: string | null;
  setRootProjectPath: (path: string | null) => void;

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
