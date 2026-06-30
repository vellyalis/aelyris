import { create } from "zustand";
import { type FallbackTelemetryDetail, formatFallbackError, reportFallback } from "../lib/fallbackTelemetry";
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
import { ACCENT_KEYS, type AccentKey, type AccentOverrides, isValidHex, normalizeHex } from "../themes/catppuccin";
import {
  DEFAULT_MOOD_PRESET,
  MOOD_MATERIAL_DEFAULTS,
  MOOD_PRESETS,
  type MoodMaterialKey,
  type MoodMaterialOverrides,
  type MoodPresetId,
  normalizeMoodPreset,
  SAKURA_MATERIAL_ALPHA_KEYS,
  SAKURA_MATERIAL_COLOR_KEYS,
  type SakuraMaterialKey,
  type SakuraMaterialOverrides,
  sanitizeMaterialOverrides,
  sanitizeSakuraMaterialOverrides,
} from "../themes/moods";
import type { KanbanColumnId, KanbanTask } from "../types/kanban";

export type SidebarSection = "files" | "tasks" | "agents" | "tools";

const THEME_OVERRIDES_KEY = "aelyris:themeOverrides";
const MOOD_PRESET_KEY = "aelyris:moodPreset";
const SAKURA_MATERIAL_OVERRIDES_KEY = "aelyris:sakuraMaterialOverrides";
const MOOD_MATERIAL_OVERRIDES_KEY = "aelyris:moodMaterialOverrides";
const WALLPAPER_IMAGE_KEY = "aelyris:wallpaperImagePath";
const WALLPAPER_OPACITY_KEY = "aelyris:wallpaperOpacity";
const WALLPAPER_SETTINGS_KEY = "aelyris:wallpaperSettingsByMood";
const APP_WINDOW_OPACITY_KEY = "aelyris:windowOpacity";
const TERMINAL_FONT_FAMILY_KEY = "aelyris:terminalFontFamily";
const TERMINAL_FONT_SIZE_KEY = "aelyris:terminalFontSize";
const TERMINAL_TEXT_CLARITY_KEY = "aelyris:terminalTextClarity";
const TERMINAL_SURFACE_OPACITY_KEY = "aelyris:terminalSurfaceOpacity";
const TERMINAL_LINE_HEIGHT_KEY = "aelyris:terminalLineHeight";
const TERMINAL_LIGATURES_KEY = "aelyris:terminalLigatures";
const TERMINAL_CURSOR_STYLE_KEY = "aelyris:terminalCursorStyle";
const TERMINAL_CURSOR_BLINK_KEY = "aelyris:terminalCursorBlink";
const DEFAULT_SHELL_KEY = "aelyris:defaultShell";
const UI_FONT_FAMILY_KEY = "aelyris:uiFontFamily";
const WINDOW_EFFECT_KEY = "aelyris:windowEffect";
const WORKSPACE_PROFILES_KEY = "aelyris:workspaceProfiles";
const MAX_FALLBACK_TELEMETRY_EVENTS = 30;
const DEFAULT_TERMINAL_FONT_FAMILY =
  "Cascadia Code, Cascadia Mono, Cascadia Next JP, BIZ UDGothic, Yu Gothic UI, Meiryo, Noto Sans Mono CJK JP, IBM Plex Mono, monospace";
const DEFAULT_TERMINAL_FONT_SIZE = 14;
export type TerminalTextClarity = "glass" | "balanced" | "solid";
const DEFAULT_TERMINAL_TEXT_CLARITY: TerminalTextClarity = "solid";
const DEFAULT_TERMINAL_SURFACE_OPACITY = 0.82;
const DEFAULT_TERMINAL_LINE_HEIGHT = 1.25;
const DEFAULT_TERMINAL_LIGATURES = true;
export type TerminalCursorStyle = "bar" | "block" | "underline";
const DEFAULT_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = "bar";
const DEFAULT_TERMINAL_CURSOR_BLINK = true;
export type DefaultShellId = "powershell" | "cmd" | "gitbash" | "wsl";
const DEFAULT_SHELL: DefaultShellId = "powershell";
const DEFAULT_UI_FONT_FAMILY = '"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif';
// "transparent" = per-pixel see-through to the desktop/windows behind (no DWM
// material). "mica"/"acrylic" are opt-in OPAQUE Win11 materials that disable
// see-through (a material occludes the wry transparent window — see
// `backdrop_for_effect` in src-tauri/src/lib.rs). Default is see-through.
export type WindowEffect = "transparent" | "mica" | "acrylic";
export const DEFAULT_WINDOW_EFFECT: WindowEffect = "transparent";

export interface WallpaperSettings {
  imagePath: string | null;
  opacity: number;
  positionX: number;
  positionY: number;
  scale: number;
}

const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  imagePath: null,
  opacity: 0,
  positionX: 50,
  positionY: 50,
  scale: 100,
};

function reportStorageFailure(operation: string, err: unknown, severity: "info" | "warning" = "warning"): void {
  reportFallback(
    {
      source: "app-store",
      operation,
      severity,
      message: formatFallbackError(err),
      userVisible: true,
    },
    { throttleMs: 10_000 },
  );
}

function sanitizeAppWindowOpacity(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.95;
  return Number(Math.min(1, Math.max(0.2, numeric)).toFixed(2));
}

function loadAppWindowOpacity(): number {
  try {
    const raw = localStorage.getItem(APP_WINDOW_OPACITY_KEY);
    return raw == null ? 0.95 : sanitizeAppWindowOpacity(raw);
  } catch (err) {
    reportStorageFailure("load_window_opacity", err, "info");
    return 0.95;
  }
}

function sanitizeTerminalFontFamily(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_TERMINAL_FONT_FAMILY;
}

function sanitizeTerminalFontSize(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(28, Math.max(10, Math.round(numeric)));
}

export function sanitizeTerminalTextClarity(value: unknown): TerminalTextClarity {
  return value === "glass" || value === "solid" || value === "balanced" ? value : DEFAULT_TERMINAL_TEXT_CLARITY;
}

export function sanitizeTerminalSurfaceOpacity(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_SURFACE_OPACITY;
  return Number(Math.min(1, Math.max(0.24, numeric)).toFixed(2));
}

function loadTerminalFontFamily(): string {
  try {
    return sanitizeTerminalFontFamily(localStorage.getItem(TERMINAL_FONT_FAMILY_KEY));
  } catch (err) {
    reportStorageFailure("load_terminal_font_family", err, "info");
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
}

function loadTerminalFontSize(): number {
  try {
    return sanitizeTerminalFontSize(localStorage.getItem(TERMINAL_FONT_SIZE_KEY));
  } catch (err) {
    reportStorageFailure("load_terminal_font_size", err, "info");
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
}

function loadTerminalTextClarity(): TerminalTextClarity {
  try {
    return sanitizeTerminalTextClarity(localStorage.getItem(TERMINAL_TEXT_CLARITY_KEY));
  } catch (err) {
    reportStorageFailure("load_terminal_text_clarity", err, "info");
    return DEFAULT_TERMINAL_TEXT_CLARITY;
  }
}

function loadTerminalSurfaceOpacity(): number {
  try {
    const raw = localStorage.getItem(TERMINAL_SURFACE_OPACITY_KEY);
    return raw == null ? DEFAULT_TERMINAL_SURFACE_OPACITY : sanitizeTerminalSurfaceOpacity(raw);
  } catch (err) {
    reportStorageFailure("load_terminal_surface_opacity", err, "info");
    return DEFAULT_TERMINAL_SURFACE_OPACITY;
  }
}

export function sanitizeTerminalLineHeight(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TERMINAL_LINE_HEIGHT;
  return Number(Math.min(2, Math.max(1, numeric)).toFixed(2));
}

function loadTerminalLineHeight(): number {
  try {
    const raw = localStorage.getItem(TERMINAL_LINE_HEIGHT_KEY);
    return raw == null ? DEFAULT_TERMINAL_LINE_HEIGHT : sanitizeTerminalLineHeight(raw);
  } catch (err) {
    reportStorageFailure("load_terminal_line_height", err, "info");
    return DEFAULT_TERMINAL_LINE_HEIGHT;
  }
}

function loadTerminalLigatures(): boolean {
  try {
    const raw = localStorage.getItem(TERMINAL_LIGATURES_KEY);
    return raw == null ? DEFAULT_TERMINAL_LIGATURES : raw === "1";
  } catch (err) {
    reportStorageFailure("load_terminal_ligatures", err, "info");
    return DEFAULT_TERMINAL_LIGATURES;
  }
}

export function sanitizeTerminalCursorStyle(value: unknown): TerminalCursorStyle {
  return value === "bar" || value === "block" || value === "underline" ? value : DEFAULT_TERMINAL_CURSOR_STYLE;
}

function loadTerminalCursorStyle(): TerminalCursorStyle {
  try {
    return sanitizeTerminalCursorStyle(localStorage.getItem(TERMINAL_CURSOR_STYLE_KEY));
  } catch (err) {
    reportStorageFailure("load_terminal_cursor_style", err, "info");
    return DEFAULT_TERMINAL_CURSOR_STYLE;
  }
}

function loadTerminalCursorBlink(): boolean {
  try {
    const raw = localStorage.getItem(TERMINAL_CURSOR_BLINK_KEY);
    return raw == null ? DEFAULT_TERMINAL_CURSOR_BLINK : raw === "1";
  } catch (err) {
    reportStorageFailure("load_terminal_cursor_blink", err, "info");
    return DEFAULT_TERMINAL_CURSOR_BLINK;
  }
}

/**
 * Map a persisted `default_shell` string (config.toml or localStorage) to a
 * valid shell id. The Rust default is `pwsh.exe`; the Settings picker stores
 * `powershell`/`cmd`/`gitbash`/`wsl`. Anything unrecognized falls back to
 * PowerShell so a stale/odd config value never breaks tab creation.
 */
export function sanitizeDefaultShell(value: unknown): DefaultShellId {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (raw) {
    case "powershell":
    case "pwsh":
    case "pwsh.exe":
    case "powershell.exe":
    case "ps":
      return "powershell";
    case "cmd":
    case "cmd.exe":
      return "cmd";
    case "gitbash":
    case "bash":
      return "gitbash";
    case "wsl":
      return "wsl";
    default:
      return DEFAULT_SHELL;
  }
}

function loadDefaultShell(): DefaultShellId {
  try {
    const raw = localStorage.getItem(DEFAULT_SHELL_KEY);
    return raw == null ? DEFAULT_SHELL : sanitizeDefaultShell(raw);
  } catch (err) {
    reportStorageFailure("load_default_shell", err, "info");
    return DEFAULT_SHELL;
  }
}

export function sanitizeUiFontFamily(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_UI_FONT_FAMILY;
}

function loadUiFontFamily(): string {
  try {
    return sanitizeUiFontFamily(localStorage.getItem(UI_FONT_FAMILY_KEY));
  } catch (err) {
    reportStorageFailure("load_ui_font_family", err, "info");
    return DEFAULT_UI_FONT_FAMILY;
  }
}

export function sanitizeWindowEffect(value: unknown): WindowEffect {
  return value === "transparent" || value === "mica" || value === "acrylic"
    ? value
    : DEFAULT_WINDOW_EFFECT;
}

function loadWindowEffect(): WindowEffect {
  try {
    return sanitizeWindowEffect(localStorage.getItem(WINDOW_EFFECT_KEY));
  } catch (err) {
    reportStorageFailure("load_window_effect", err, "info");
    return DEFAULT_WINDOW_EFFECT;
  }
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

function loadSakuraMaterialOverrides(): SakuraMaterialOverrides {
  try {
    const raw = localStorage.getItem(SAKURA_MATERIAL_OVERRIDES_KEY);
    if (!raw) return {};
    return sanitizeSakuraMaterialOverrides(JSON.parse(raw) as unknown);
  } catch (err) {
    reportStorageFailure("load_sakura_material_overrides", err);
    return {};
  }
}

function persistSakuraMaterialOverrides(state: SakuraMaterialOverrides): void {
  try {
    if (Object.keys(state).length === 0) {
      localStorage.removeItem(SAKURA_MATERIAL_OVERRIDES_KEY);
      return;
    }
    localStorage.setItem(SAKURA_MATERIAL_OVERRIDES_KEY, JSON.stringify(state));
  } catch (err) {
    reportStorageFailure("persist_sakura_material_overrides", err);
  }
}

function loadMoodMaterialOverrides(): Partial<Record<MoodPresetId, MoodMaterialOverrides>> {
  const cleaned: Partial<Record<MoodPresetId, MoodMaterialOverrides>> = {};
  try {
    const raw = localStorage.getItem(MOOD_MATERIAL_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const preset of MOOD_PRESETS) {
          const value = (parsed as Record<string, unknown>)[preset.id];
          const next = sanitizeMaterialOverrides(value, MOOD_MATERIAL_DEFAULTS[preset.id]);
          if (Object.keys(next).length > 0) cleaned[preset.id] = next;
        }
      }
    }
    if (!cleaned["aelyris-sakura"]) {
      const legacy = loadSakuraMaterialOverrides();
      if (Object.keys(legacy).length > 0) cleaned["aelyris-sakura"] = legacy;
    }
  } catch (err) {
    reportStorageFailure("load_mood_material_overrides", err);
  }
  return cleaned;
}

function persistMoodMaterialOverrides(state: Partial<Record<MoodPresetId, MoodMaterialOverrides>>): void {
  try {
    const next: Partial<Record<MoodPresetId, MoodMaterialOverrides>> = {};
    for (const preset of MOOD_PRESETS) {
      const clean = sanitizeMaterialOverrides(state[preset.id], MOOD_MATERIAL_DEFAULTS[preset.id]);
      if (Object.keys(clean).length > 0) next[preset.id] = clean;
    }
    if (Object.keys(next).length === 0) {
      localStorage.removeItem(MOOD_MATERIAL_OVERRIDES_KEY);
      return;
    }
    localStorage.setItem(MOOD_MATERIAL_OVERRIDES_KEY, JSON.stringify(next));
  } catch (err) {
    reportStorageFailure("persist_mood_material_overrides", err);
  }
}

function sanitizeWallpaperSettings(value: unknown): Partial<WallpaperSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const next: Partial<WallpaperSettings> = {};
  if (typeof record.imagePath === "string" && record.imagePath.trim()) next.imagePath = record.imagePath.trim();
  if (record.imagePath === null) next.imagePath = null;
  if (typeof record.opacity === "number" && Number.isFinite(record.opacity)) {
    next.opacity = Math.min(1, Math.max(0, record.opacity));
  }
  if (typeof record.positionX === "number" && Number.isFinite(record.positionX)) {
    next.positionX = Math.min(100, Math.max(0, record.positionX));
  }
  if (typeof record.positionY === "number" && Number.isFinite(record.positionY)) {
    next.positionY = Math.min(100, Math.max(0, record.positionY));
  }
  if (typeof record.scale === "number" && Number.isFinite(record.scale)) {
    next.scale = Math.min(300, Math.max(25, record.scale));
  }
  return next;
}

function normalizeWallpaperSettings(value: unknown): WallpaperSettings {
  return { ...DEFAULT_WALLPAPER_SETTINGS, ...sanitizeWallpaperSettings(value) };
}

function loadWallpaperSettingsByMood(): Record<MoodPresetId, WallpaperSettings> {
  const next = Object.fromEntries(
    MOOD_PRESETS.map((preset) => [preset.id, { ...DEFAULT_WALLPAPER_SETTINGS }]),
  ) as Record<MoodPresetId, WallpaperSettings>;
  try {
    const raw = localStorage.getItem(WALLPAPER_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const preset of MOOD_PRESETS) {
          next[preset.id] = normalizeWallpaperSettings((parsed as Record<string, unknown>)[preset.id]);
        }
      }
    }
    const legacyPath = localStorage.getItem(WALLPAPER_IMAGE_KEY);
    const legacyOpacity = Number(localStorage.getItem(WALLPAPER_OPACITY_KEY));
    if (legacyPath?.trim()) {
      const mood = normalizeMoodPreset(localStorage.getItem(MOOD_PRESET_KEY));
      next[mood] = {
        ...next[mood],
        imagePath: legacyPath.trim(),
        opacity: Number.isFinite(legacyOpacity) ? Math.min(0.85, Math.max(0, legacyOpacity)) : next[mood].opacity,
      };
    }
  } catch (err) {
    reportStorageFailure("load_wallpaper_settings", err);
  }
  return next;
}

function persistWallpaperSettingsByMood(state: Record<MoodPresetId, WallpaperSettings>): void {
  try {
    const compact: Partial<Record<MoodPresetId, WallpaperSettings>> = {};
    for (const preset of MOOD_PRESETS) {
      const settings = normalizeWallpaperSettings(state[preset.id]);
      const persistedSettings = settings.imagePath?.startsWith("blob:") ? { ...settings, imagePath: null } : settings;
      if (
        persistedSettings.imagePath ||
        persistedSettings.opacity !== DEFAULT_WALLPAPER_SETTINGS.opacity ||
        persistedSettings.positionX !== DEFAULT_WALLPAPER_SETTINGS.positionX ||
        persistedSettings.positionY !== DEFAULT_WALLPAPER_SETTINGS.positionY ||
        persistedSettings.scale !== DEFAULT_WALLPAPER_SETTINGS.scale
      ) {
        compact[preset.id] = persistedSettings;
      }
    }
    if (Object.keys(compact).length === 0) {
      localStorage.removeItem(WALLPAPER_SETTINGS_KEY);
      return;
    }
    localStorage.setItem(WALLPAPER_SETTINGS_KEY, JSON.stringify(compact));
  } catch (err) {
    reportStorageFailure("persist_wallpaper_settings", err);
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
  /** Replace every per-theme accent override from config/hydration. */
  replaceThemeOverrides: (overrides: Record<string, AccentOverrides>) => void;
  /** User-tunable material tokens for each mood preset. */
  moodMaterialOverrides: Partial<Record<MoodPresetId, MoodMaterialOverrides>>;
  setMoodMaterialOverride: (mood: MoodPresetId, key: MoodMaterialKey, value: string | number | undefined) => void;
  resetMoodMaterialOverrides: (mood: MoodPresetId) => void;
  replaceMoodMaterialOverrides: (overrides: Partial<Record<MoodPresetId, MoodMaterialOverrides>>) => void;
  /** Legacy Sakura aliases kept so older tests and stored state keep working. */
  sakuraMaterialOverrides: SakuraMaterialOverrides;
  setSakuraMaterialOverride: (key: SakuraMaterialKey, value: string | number | undefined) => void;
  resetSakuraMaterialOverrides: () => void;
  wallpaperImagePath: string | null;
  wallpaperOpacity: number;
  wallpaperSettingsByMood: Record<MoodPresetId, WallpaperSettings>;
  setWallpaperSettingsForMood: (mood: MoodPresetId, patch: Partial<WallpaperSettings>) => void;
  replaceWallpaperSettingsByMood: (settings: Partial<Record<MoodPresetId, Partial<WallpaperSettings>>>) => void;
  setWallpaperImagePath: (path: string | null) => void;
  setWallpaperOpacity: (opacity: number) => void;
  appWindowOpacity: number;
  setAppWindowOpacity: (opacity: number) => void;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalTextClarity: TerminalTextClarity;
  terminalSurfaceOpacity: number;
  /** Terminal cell line-height multiplier (height = round(fontSize × lineHeight)). Clamped 1.0..2.0. */
  terminalLineHeight: number;
  /** Whether the native shaper is allowed to form font ligatures. */
  terminalLigatures: boolean;
  setTerminalAppearance: (appearance: {
    fontFamily?: string;
    fontSize?: number;
    textClarity?: TerminalTextClarity;
    surfaceOpacity?: number;
    lineHeight?: number;
    ligatures?: boolean;
  }) => void;
  /** User-preferred cursor style; seeds the rendered cursor when the program hasn't set one. */
  cursorStyle: TerminalCursorStyle;
  setCursorStyle: (style: TerminalCursorStyle) => void;
  /** Whether the terminal cursor blinks. */
  cursorBlink: boolean;
  setCursorBlink: (blink: boolean) => void;
  /** Shell used to seed the first tab and new terminals on startup. */
  defaultShell: DefaultShellId;
  /** Accepts any persisted shell string (config.toml or picker id); sanitized to a valid id. */
  setDefaultShell: (shell: string) => void;
  /** Application (UI chrome) font family, applied to the `--font-ui` CSS variable. */
  uiFontFamily: string;
  setUiFontFamily: (family: string) => void;
  /** Windows DWM backdrop type. Persisted to config and applied at window setup. */
  windowEffect: WindowEffect;
  setWindowEffect: (effect: WindowEffect) => void;

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

  // Runtime fallback telemetry
  fallbackTelemetryEvents: FallbackTelemetryDetail[];
  recordFallbackTelemetry: (event: FallbackTelemetryDetail) => void;
  clearFallbackTelemetry: () => void;

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
  const parsed = readStorageJson("aelyris:budget", {});
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
  const parsed = readStorageJson("aelyris:kanban", []);
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

function persistKanbanTasks(tasks: KanbanTask[]): void {
  try {
    localStorage.setItem("aelyris:kanban", JSON.stringify(tasks));
  } catch (err) {
    reportStorageFailure("persist_kanban_tasks", err);
  }
}

function loadOpenFiles(): string[] {
  const parsed = readStorageJson("aelyris:openFiles", []);
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
    localStorage.setItem("aelyris:openFiles", JSON.stringify(openFiles));
  } catch (err) {
    reportStorageFailure("persist_open_files", err);
  }
  try {
    if (activeFile) localStorage.setItem("aelyris:activeFile", activeFile);
    else localStorage.removeItem("aelyris:activeFile");
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
      return localStorage.getItem("aelyris:theme") ?? "aelyris-dark";
    } catch (err) {
      reportStorageFailure("load_theme", err, "info");
      return "aelyris-dark";
    }
  })(),
  setThemeId: (id) => {
    set({ themeId: id });
    try {
      localStorage.setItem("aelyris:theme", id);
    } catch (err) {
      reportStorageFailure("persist_theme", err);
    }
  },
  moodPresetId: (() => {
    try {
      return normalizeMoodPreset(localStorage.getItem(MOOD_PRESET_KEY));
    } catch (err) {
      reportStorageFailure("load_mood_preset", err, "info");
      return DEFAULT_MOOD_PRESET;
    }
  })(),
  setMoodPresetId: (id) => {
    const next = normalizeMoodPreset(id);
    const wallpaper = get().wallpaperSettingsByMood?.[next] ?? DEFAULT_WALLPAPER_SETTINGS;
    set({ moodPresetId: next, wallpaperImagePath: wallpaper.imagePath, wallpaperOpacity: wallpaper.opacity });
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
  replaceThemeOverrides: (overrides) =>
    set(() => {
      const nextAll = sanitizeThemeOverrides(overrides);
      persistThemeOverrides(nextAll);
      return { themeOverrides: nextAll };
    }),
  moodMaterialOverrides: loadMoodMaterialOverrides(),
  setMoodMaterialOverride: (mood, key, value) =>
    set((s) => {
      const preset = normalizeMoodPreset(mood);
      const current = s.moodMaterialOverrides[preset] ?? {};
      const nextForMood = { ...current } as Record<string, string | number>;
      if (value === undefined || value === "") {
        delete nextForMood[key];
      } else if (SAKURA_MATERIAL_COLOR_KEYS.includes(key as (typeof SAKURA_MATERIAL_COLOR_KEYS)[number])) {
        nextForMood[key] = String(value);
      } else if (SAKURA_MATERIAL_ALPHA_KEYS.includes(key as (typeof SAKURA_MATERIAL_ALPHA_KEYS)[number])) {
        nextForMood[key] = Number(value);
      }
      const cleanedForMood = sanitizeMaterialOverrides(nextForMood, MOOD_MATERIAL_DEFAULTS[preset]);
      const nextAll = { ...s.moodMaterialOverrides };
      if (Object.keys(cleanedForMood).length > 0) nextAll[preset] = cleanedForMood;
      else delete nextAll[preset];
      persistMoodMaterialOverrides(nextAll);
      if (preset === "aelyris-sakura") persistSakuraMaterialOverrides(cleanedForMood);
      return {
        moodMaterialOverrides: nextAll,
        ...(preset === "aelyris-sakura" ? { sakuraMaterialOverrides: cleanedForMood } : {}),
      };
    }),
  resetMoodMaterialOverrides: (mood) =>
    set((s) => {
      const preset = normalizeMoodPreset(mood);
      const nextAll = { ...s.moodMaterialOverrides };
      delete nextAll[preset];
      persistMoodMaterialOverrides(nextAll);
      if (preset === "aelyris-sakura") persistSakuraMaterialOverrides({});
      return {
        moodMaterialOverrides: nextAll,
        ...(preset === "aelyris-sakura" ? { sakuraMaterialOverrides: {} } : {}),
      };
    }),
  replaceMoodMaterialOverrides: (overrides) =>
    set(() => {
      const nextAll: Partial<Record<MoodPresetId, MoodMaterialOverrides>> = {};
      for (const preset of MOOD_PRESETS) {
        const cleaned = sanitizeMaterialOverrides(overrides[preset.id], MOOD_MATERIAL_DEFAULTS[preset.id]);
        if (Object.keys(cleaned).length > 0) nextAll[preset.id] = cleaned;
      }
      persistMoodMaterialOverrides(nextAll);
      persistSakuraMaterialOverrides(nextAll["aelyris-sakura"] ?? {});
      return {
        moodMaterialOverrides: nextAll,
        sakuraMaterialOverrides: nextAll["aelyris-sakura"] ?? {},
      };
    }),
  sakuraMaterialOverrides: loadMoodMaterialOverrides()["aelyris-sakura"] ?? {},
  setSakuraMaterialOverride: (key, value) =>
    set((s) => {
      const next = { ...s.sakuraMaterialOverrides } as Record<string, string | number>;
      if (value === undefined || value === "") {
        delete next[key];
      } else if (SAKURA_MATERIAL_COLOR_KEYS.includes(key as (typeof SAKURA_MATERIAL_COLOR_KEYS)[number])) {
        next[key] = String(value);
      } else if (SAKURA_MATERIAL_ALPHA_KEYS.includes(key as (typeof SAKURA_MATERIAL_ALPHA_KEYS)[number])) {
        next[key] = Number(value);
      }
      const cleaned = sanitizeSakuraMaterialOverrides(next);
      persistSakuraMaterialOverrides(cleaned);
      const nextAll = { ...s.moodMaterialOverrides };
      if (Object.keys(cleaned).length > 0) nextAll["aelyris-sakura"] = cleaned;
      else delete nextAll["aelyris-sakura"];
      persistMoodMaterialOverrides(nextAll);
      return { sakuraMaterialOverrides: cleaned, moodMaterialOverrides: nextAll };
    }),
  resetSakuraMaterialOverrides: () => {
    persistSakuraMaterialOverrides({});
    set((s) => {
      const nextAll = { ...s.moodMaterialOverrides };
      delete nextAll["aelyris-sakura"];
      persistMoodMaterialOverrides(nextAll);
      return { sakuraMaterialOverrides: {}, moodMaterialOverrides: nextAll };
    });
  },
  wallpaperImagePath: (() => {
    try {
      const value = localStorage.getItem(WALLPAPER_IMAGE_KEY);
      return value?.trim() ? value : null;
    } catch (err) {
      reportStorageFailure("load_wallpaper_image", err, "info");
      return null;
    }
  })(),
  wallpaperOpacity: (() => {
    try {
      const value = Number(localStorage.getItem(WALLPAPER_OPACITY_KEY));
      return Number.isFinite(value) ? Math.min(0.85, Math.max(0, value)) : 0;
    } catch (err) {
      reportStorageFailure("load_wallpaper_opacity", err, "info");
      return 0;
    }
  })(),
  wallpaperSettingsByMood: loadWallpaperSettingsByMood(),
  setWallpaperSettingsForMood: (mood, patch) =>
    set((s) => {
      const preset = normalizeMoodPreset(mood);
      const current = s.wallpaperSettingsByMood[preset] ?? DEFAULT_WALLPAPER_SETTINGS;
      const nextForMood = normalizeWallpaperSettings({ ...current, ...patch });
      const nextAll = { ...s.wallpaperSettingsByMood, [preset]: nextForMood };
      persistWallpaperSettingsByMood(nextAll);
      return {
        wallpaperSettingsByMood: nextAll,
        ...(preset === s.moodPresetId
          ? { wallpaperImagePath: nextForMood.imagePath, wallpaperOpacity: nextForMood.opacity }
          : {}),
      };
    }),
  replaceWallpaperSettingsByMood: (settings) =>
    set((s) => {
      const nextAll = Object.fromEntries(
        MOOD_PRESETS.map((preset) => [preset.id, normalizeWallpaperSettings(settings[preset.id])]),
      ) as Record<MoodPresetId, WallpaperSettings>;
      const current = nextAll[s.moodPresetId] ?? DEFAULT_WALLPAPER_SETTINGS;
      persistWallpaperSettingsByMood(nextAll);
      return {
        wallpaperSettingsByMood: nextAll,
        wallpaperImagePath: current.imagePath,
        wallpaperOpacity: current.opacity,
      };
    }),
  setWallpaperImagePath: (path) => {
    const next = path?.trim() ? path.trim() : null;
    set((s) => {
      const preset = s.moodPresetId;
      const current = s.wallpaperSettingsByMood[preset] ?? DEFAULT_WALLPAPER_SETTINGS;
      const nextForMood = { ...current, imagePath: next };
      const nextAll = { ...s.wallpaperSettingsByMood, [preset]: nextForMood };
      persistWallpaperSettingsByMood(nextAll);
      return { wallpaperImagePath: next, wallpaperSettingsByMood: nextAll };
    });
    try {
      if (next) localStorage.setItem(WALLPAPER_IMAGE_KEY, next);
      else localStorage.removeItem(WALLPAPER_IMAGE_KEY);
    } catch (err) {
      reportStorageFailure("persist_wallpaper_image", err);
    }
  },
  setWallpaperOpacity: (opacity) => {
    const next = Number.isFinite(opacity) ? Math.min(0.85, Math.max(0, opacity)) : 0;
    set((s) => {
      const preset = s.moodPresetId;
      const current = s.wallpaperSettingsByMood[preset] ?? DEFAULT_WALLPAPER_SETTINGS;
      const nextForMood = { ...current, opacity: next };
      const nextAll = { ...s.wallpaperSettingsByMood, [preset]: nextForMood };
      persistWallpaperSettingsByMood(nextAll);
      return { wallpaperOpacity: next, wallpaperSettingsByMood: nextAll };
    });
    try {
      localStorage.setItem(WALLPAPER_OPACITY_KEY, String(next));
    } catch (err) {
      reportStorageFailure("persist_wallpaper_opacity", err);
    }
  },
  appWindowOpacity: loadAppWindowOpacity(),
  setAppWindowOpacity: (opacity) => {
    const next = sanitizeAppWindowOpacity(opacity);
    set({ appWindowOpacity: next });
    try {
      localStorage.setItem(APP_WINDOW_OPACITY_KEY, String(next));
    } catch (err) {
      reportStorageFailure("persist_window_opacity", err);
    }
  },
  terminalFontFamily: loadTerminalFontFamily(),
  terminalFontSize: loadTerminalFontSize(),
  terminalTextClarity: loadTerminalTextClarity(),
  terminalSurfaceOpacity: loadTerminalSurfaceOpacity(),
  terminalLineHeight: loadTerminalLineHeight(),
  terminalLigatures: loadTerminalLigatures(),
  setTerminalAppearance: ({ fontFamily, fontSize, textClarity, surfaceOpacity, lineHeight, ligatures }) => {
    const patch: Partial<
      Pick<
        AppState,
        | "terminalFontFamily"
        | "terminalFontSize"
        | "terminalTextClarity"
        | "terminalSurfaceOpacity"
        | "terminalLineHeight"
        | "terminalLigatures"
      >
    > = {};
    if (fontFamily !== undefined) patch.terminalFontFamily = sanitizeTerminalFontFamily(fontFamily);
    if (fontSize !== undefined) patch.terminalFontSize = sanitizeTerminalFontSize(fontSize);
    if (textClarity !== undefined) patch.terminalTextClarity = sanitizeTerminalTextClarity(textClarity);
    if (surfaceOpacity !== undefined) patch.terminalSurfaceOpacity = sanitizeTerminalSurfaceOpacity(surfaceOpacity);
    if (lineHeight !== undefined) patch.terminalLineHeight = sanitizeTerminalLineHeight(lineHeight);
    if (ligatures !== undefined) patch.terminalLigatures = ligatures;
    if (Object.keys(patch).length === 0) return;
    set(patch);
    try {
      if (patch.terminalFontFamily !== undefined) {
        localStorage.setItem(TERMINAL_FONT_FAMILY_KEY, patch.terminalFontFamily);
      }
      if (patch.terminalFontSize !== undefined) {
        localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(patch.terminalFontSize));
      }
      if (patch.terminalTextClarity !== undefined) {
        localStorage.setItem(TERMINAL_TEXT_CLARITY_KEY, patch.terminalTextClarity);
      }
      if (patch.terminalSurfaceOpacity !== undefined) {
        localStorage.setItem(TERMINAL_SURFACE_OPACITY_KEY, String(patch.terminalSurfaceOpacity));
      }
      if (patch.terminalLineHeight !== undefined) {
        localStorage.setItem(TERMINAL_LINE_HEIGHT_KEY, String(patch.terminalLineHeight));
      }
      if (patch.terminalLigatures !== undefined) {
        localStorage.setItem(TERMINAL_LIGATURES_KEY, patch.terminalLigatures ? "1" : "0");
      }
    } catch (err) {
      reportStorageFailure("persist_terminal_appearance", err);
    }
  },
  cursorStyle: loadTerminalCursorStyle(),
  setCursorStyle: (style) => {
    const next = sanitizeTerminalCursorStyle(style);
    set({ cursorStyle: next });
    try {
      localStorage.setItem(TERMINAL_CURSOR_STYLE_KEY, next);
    } catch (err) {
      reportStorageFailure("persist_terminal_cursor_style", err);
    }
  },
  cursorBlink: loadTerminalCursorBlink(),
  setCursorBlink: (blink) => {
    const next = Boolean(blink);
    set({ cursorBlink: next });
    try {
      localStorage.setItem(TERMINAL_CURSOR_BLINK_KEY, next ? "1" : "0");
    } catch (err) {
      reportStorageFailure("persist_terminal_cursor_blink", err);
    }
  },
  defaultShell: loadDefaultShell(),
  setDefaultShell: (shell) => {
    const next = sanitizeDefaultShell(shell);
    set({ defaultShell: next });
    try {
      localStorage.setItem(DEFAULT_SHELL_KEY, next);
    } catch (err) {
      reportStorageFailure("persist_default_shell", err);
    }
  },
  uiFontFamily: loadUiFontFamily(),
  setUiFontFamily: (family) => {
    const next = sanitizeUiFontFamily(family);
    set({ uiFontFamily: next });
    try {
      localStorage.setItem(UI_FONT_FAMILY_KEY, next);
    } catch (err) {
      reportStorageFailure("persist_ui_font_family", err);
    }
  },
  windowEffect: loadWindowEffect(),
  setWindowEffect: (effect) => {
    const next = sanitizeWindowEffect(effect);
    set({ windowEffect: next });
    try {
      localStorage.setItem(WINDOW_EFFECT_KEY, next);
    } catch (err) {
      reportStorageFailure("persist_window_effect", err);
    }
  },

  // Project
  rootProjectPath: (() => {
    try {
      return localStorage.getItem("aelyris:lastProject");
    } catch (err) {
      reportStorageFailure("load_last_project", err, "info");
      return null;
    }
  })(),
  setRootProjectPath: (path) => {
    set({ rootProjectPath: path });
    try {
      if (path) localStorage.setItem("aelyris:lastProject", path);
      else localStorage.removeItem("aelyris:lastProject");
    } catch (err) {
      reportStorageFailure("persist_last_project", err);
    }
  },

  // Sidebar
  sidebarSection: "files" as SidebarSection,
  setSidebarSection: (section: SidebarSection) => set({ sidebarSection: section }),
  sidebarCollapsed: (() => {
    try {
      return localStorage.getItem("aelyris:sidebarCollapsed") === "1";
    } catch (err) {
      reportStorageFailure("load_sidebar_collapsed", err, "info");
      return false;
    }
  })(),
  setSidebarCollapsed: (v) =>
    set((s) => {
      const next = toggleOrSet(v, s.sidebarCollapsed);
      try {
        localStorage.setItem("aelyris:sidebarCollapsed", next ? "1" : "0");
      } catch (err) {
        reportStorageFailure("persist_sidebar_collapsed", err, "info");
      }
      return { sidebarCollapsed: next };
    }),
  sidebarWidth: (() => {
    try {
      const raw = localStorage.getItem("aelyris:sidebarWidth");
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 480) {
        return parsed;
      }
    } catch (err) {
      reportStorageFailure("load_sidebar_width", err, "info");
    }
    return 240;
  })(),
  setSidebarWidth: (v: number) =>
    set(() => {
      const clamped = Math.max(200, Math.min(480, Math.round(v)));
      try {
        localStorage.setItem("aelyris:sidebarWidth", String(clamped));
      } catch (err) {
        reportStorageFailure("persist_sidebar_width", err, "warning");
      }
      return { sidebarWidth: clamped };
    }),
  rightPanelWidth: (() => {
    try {
      const raw = localStorage.getItem("aelyris:rightPanelWidth");
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed >= 260 && parsed <= 480) {
        return parsed;
      }
    } catch (err) {
      reportStorageFailure("load_right_panel_width", err, "info");
    }
    return 320;
  })(),
  setRightPanelWidth: (v: number) =>
    set(() => {
      const clamped = Math.max(260, Math.min(480, Math.round(v)));
      try {
        localStorage.setItem("aelyris:rightPanelWidth", String(clamped));
      } catch (err) {
        reportStorageFailure("persist_right_panel_width", err, "warning");
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
      return localStorage.getItem("aelyris:selectedModel") ?? "claude-sonnet";
    } catch (err) {
      reportStorageFailure("load_selected_model", err, "info");
      return "claude-sonnet";
    }
  })(),
  setSelectedModel: (modelId) => {
    set({ selectedModel: modelId });
    try {
      localStorage.setItem("aelyris:selectedModel", modelId);
    } catch (err) {
      reportStorageFailure("persist_selected_model", err);
    }
  },

  // Budget
  agentBudget: loadAgentBudget(),
  addAgentCost: (cost: number) =>
    set((s) => {
      const budget = { ...s.agentBudget, spent: s.agentBudget.spent + cost };
      try {
        localStorage.setItem("aelyris:budget", JSON.stringify(budget));
      } catch (err) {
        reportStorageFailure("persist_agent_budget_spent", err);
      }
      return { agentBudget: budget };
    }),
  setAgentBudgetLimit: (limit: number) =>
    set((s) => {
      const budget = { ...s.agentBudget, limit };
      try {
        localStorage.setItem("aelyris:budget", JSON.stringify(budget));
      } catch (err) {
        reportStorageFailure("persist_agent_budget_limit", err);
      }
      return { agentBudget: budget };
    }),
  perSessionCostCap: (() => {
    try {
      const v = Number(localStorage.getItem("aelyris:perSessionCostCap") ?? "2");
      return Number.isFinite(v) && v > 0 ? v : 2;
    } catch (err) {
      reportStorageFailure("load_per_session_cost_cap", err, "info");
      return 2;
    }
  })(),
  setPerSessionCostCap: (cap) => {
    set({ perSessionCostCap: cap });
    try {
      localStorage.setItem("aelyris:perSessionCostCap", String(cap));
    } catch (err) {
      reportStorageFailure("persist_per_session_cost_cap", err);
    }
  },
  contextWarnPct: (() => {
    try {
      const v = Number(localStorage.getItem("aelyris:contextWarnPct") ?? "85");
      return Number.isFinite(v) && v > 0 && v <= 100 ? v : 85;
    } catch (err) {
      reportStorageFailure("load_context_warn_pct", err, "info");
      return 85;
    }
  })(),
  setContextWarnPct: (pct) => {
    set({ contextWarnPct: pct });
    try {
      localStorage.setItem("aelyris:contextWarnPct", String(pct));
    } catch (err) {
      reportStorageFailure("persist_context_warn_pct", err);
    }
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
      persistKanbanTasks(tasks);
      return { kanbanTasks: tasks };
    }),
  moveKanbanTask: (taskId, toColumn) =>
    set((s) => {
      const tasks = s.kanbanTasks.map((t) => (t.id === taskId ? { ...t, column: toColumn, updatedAt: Date.now() } : t));
      persistKanbanTasks(tasks);
      return { kanbanTasks: tasks };
    }),
  deleteKanbanTask: (taskId) =>
    set((s) => {
      const tasks = s.kanbanTasks.filter((t) => t.id !== taskId);
      persistKanbanTasks(tasks);
      return { kanbanTasks: tasks };
    }),
  updateKanbanTask: (taskId, updates) =>
    set((s) => {
      const tasks = s.kanbanTasks.map((t) => (t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t));
      persistKanbanTasks(tasks);
      return { kanbanTasks: tasks };
    }),
  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

  // Editor
  openFiles: loadOpenFiles(),
  activeFile: (() => {
    try {
      return localStorage.getItem("aelyris:activeFile") ?? null;
    } catch (err) {
      reportStorageFailure("load_active_file", err, "info");
      return null;
    }
  })(),
  openFile: (path) =>
    set((s) => {
      const files = s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path];
      persistEditorFiles(files, path);
      return { openFiles: files, activeFile: path };
    }),
  closeFile: (path) =>
    set((s) => {
      const files = s.openFiles.filter((f) => f !== path);
      const active = s.activeFile === path ? (files.length > 0 ? files[files.length - 1] : null) : s.activeFile;
      persistEditorFiles(files, active);
      return { openFiles: files, activeFile: active };
    }),
  setActiveFile: (path) => {
    set({ activeFile: path });
    try {
      if (path) localStorage.setItem("aelyris:activeFile", path);
      else localStorage.removeItem("aelyris:activeFile");
    } catch (err) {
      reportStorageFailure("persist_active_file", err);
    }
  },
  clearFiles: () => {
    set({ openFiles: [], activeFile: null, unsavedFiles: new Set() });
    try {
      localStorage.removeItem("aelyris:openFiles");
      localStorage.removeItem("aelyris:activeFile");
    } catch (err) {
      reportStorageFailure("clear_editor_files", err);
    }
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

  fallbackTelemetryEvents: [],
  recordFallbackTelemetry: (event) =>
    set((s) => {
      const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
      const normalized: FallbackTelemetryDetail = {
        ...event,
        timestamp,
        source: event.source || "unknown",
        operation: event.operation || "unknown",
        severity: event.severity ?? "warning",
        message: event.message || "Fallback path used",
      };
      const key = `${normalized.source}:${normalized.operation}:${normalized.message}`;
      const withoutDuplicate = s.fallbackTelemetryEvents.filter(
        (item) => `${item.source}:${item.operation}:${item.message}` !== key,
      );
      return {
        fallbackTelemetryEvents: [normalized, ...withoutDuplicate]
          .sort((left, right) => right.timestamp - left.timestamp)
          .slice(0, MAX_FALLBACK_TELEMETRY_EVENTS),
      };
    }),
  clearFallbackTelemetry: () => set({ fallbackTelemetryEvents: [] }),

  // Ghost Diff Overlay (Phase 3C-1d) — bootstrap from localStorage for
  // first paint; Settings load_app_config then rehydrates from config.toml.
  ghostDiffLiveMode: (() => {
    try {
      return localStorage.getItem("aelyris:ghostDiffLiveMode") === "1";
    } catch {
      return false;
    }
  })(),
  setGhostDiffLiveMode: (v) => {
    set({ ghostDiffLiveMode: v });
    try {
      localStorage.setItem("aelyris:ghostDiffLiveMode", v ? "1" : "0");
    } catch (err) {
      reportStorageFailure("persist_ghost_diff_live_mode", err, "info");
    }
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
