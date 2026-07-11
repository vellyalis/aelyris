import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { type EditorOpenMode, loadEditorOpenMode, saveEditorOpenMode } from "../../shared/lib/externalEditor";
import { getShortcutHelpItems } from "../../shared/lib/shortcutRegistry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import {
  sanitizeDefaultShell,
  sanitizeWindowEffect,
  type TerminalCursorStyle,
  type TerminalRendererMode,
  type TerminalTextClarity,
  useAppStore,
  type WallpaperSettings,
  type WindowEffect,
} from "../../shared/store/appStore";
import { toast } from "../../shared/store/toastStore";
import type { AccentOverrides } from "../../shared/themes/catppuccin";
import {
  MOOD_MATERIAL_DEFAULTS,
  MOOD_PRESETS,
  type MoodMaterialAlphaKey,
  type MoodMaterialColorKey,
  type MoodMaterialOverrides,
  type MoodPresetId,
  normalizeMoodPreset,
} from "../../shared/themes/moods";
import { Select } from "../../shared/ui/Select";
import { Switch } from "../../shared/ui/Switch";
import styles from "./Settings.module.css";
import { ShellIntegrationSection } from "./ShellIntegrationSection";
import { ThemePaletteEditor } from "./ThemePaletteEditor";
import { UpdateCheckSection } from "./UpdateCheckSection";

interface SettingsProps {
  visible: boolean;
  onClose: () => void;
}

const THEMES = [
  { id: "aelyris-dark", label: "Aelyris Dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
  { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
  { id: "catppuccin-latte", label: "Catppuccin Latte (Light)" },
  { id: "sakura-hub", label: "Sakura Hub (Light)" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "dracula", label: "Dracula" },
];

const FONTS = [
  "Cascadia Code",
  "Cascadia Mono",
  "Cascadia Next JP",
  "BIZ UDGothic",
  "Yu Gothic UI",
  "Meiryo",
  "IBM Plex Mono",
  "JetBrains Mono",
  "Fira Code",
  "Consolas",
];
const TERMINAL_TEXT_CLARITY_OPTIONS: { value: TerminalTextClarity; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "solid", label: "Sharp" },
  { value: "glass", label: "Glass" },
];
const TERMINAL_RENDERER_OPTIONS: { value: TerminalRendererMode; label: string }[] = [
  { value: "canvas2d", label: "Canvas2D" },
  { value: "webgl2", label: "WebGL2 Atlas" },
];
// UI (app-chrome) font choices. Each value is a full font stack so the chosen
// primary always has sensible cross-platform fallbacks. The persisted
// `ui_font_family` is matched back to one of these by primary family name.
const UI_FONTS: { value: string; label: string }[] = [
  { value: '"IBM Plex Sans", -apple-system, "Segoe UI", sans-serif', label: "IBM Plex Sans" },
  { value: '"Inter", -apple-system, "Segoe UI", sans-serif', label: "Inter" },
  { value: '"Geist", "Inter", "Source Han Sans JP", sans-serif', label: "Geist" },
  { value: '"Segoe UI", -apple-system, sans-serif', label: "Segoe UI" },
  { value: 'system-ui, -apple-system, "Segoe UI", sans-serif', label: "System UI" },
];
const WINDOW_EFFECT_OPTIONS: { value: WindowEffect; label: string }[] = [
  { value: "transparent", label: "Transparent (see-through to desktop)" },
  { value: "mica", label: "Mica (opaque wallpaper tint)" },
  { value: "acrylic", label: "Acrylic (opaque frosted)" },
];

function uiFontPrimary(stack: string): string {
  return (
    stack
      .split(",")[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") || "IBM Plex Sans"
  );
}

// Match a persisted ui_font_family stack to a known UI_FONTS option by primary
// family name, falling back to the IBM Plex Sans stack so the Select always
// has a valid value even if config carries an unknown / custom stack.
function matchUiFontValue(stack: string): string {
  const primary = uiFontPrimary(stack).toLowerCase();
  const hit = UI_FONTS.find((font) => uiFontPrimary(font.value).toLowerCase() === primary);
  return hit?.value ?? UI_FONTS[0].value;
}
const TERMINAL_FONT_FALLBACKS = [
  "Cascadia Mono",
  "Cascadia Next JP",
  "BIZ UDGothic",
  "Yu Gothic UI",
  "Meiryo",
  "Noto Sans Mono CJK JP",
  "IBM Plex Mono",
  "monospace",
];

function terminalPrimaryFont(fontFamily: string): string {
  return (
    fontFamily
      .split(",")[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") || "Cascadia Code"
  );
}

function terminalFontStack(primaryFont: string): string {
  const primary = terminalPrimaryFont(primaryFont);
  if (!primaryFont.includes(",")) {
    const stack = [primary, ...TERMINAL_FONT_FALLBACKS.filter((font) => font !== primary)];
    return stack.join(", ");
  }
  const entries = primaryFont
    .split(",")
    .map((font) => font.trim())
    .filter(Boolean);
  const normalized = new Set(entries.map((font) => terminalPrimaryFont(font)));
  for (const fallback of TERMINAL_FONT_FALLBACKS) {
    if (!normalized.has(fallback)) entries.push(fallback);
  }
  return entries.join(", ");
}

const SHELLS = [
  { id: "powershell", label: "PowerShell" },
  { id: "cmd", label: "CMD" },
  { id: "gitbash", label: "Git Bash" },
  { id: "wsl", label: "WSL" },
];

const MATERIAL_CONTROLS: readonly {
  label: string;
  colorKey: MoodMaterialColorKey;
  alphaKey: MoodMaterialAlphaKey;
  min: number;
  max: number;
}[] = [
  { label: "Backdrop", colorKey: "backdropColor", alphaKey: "backdropAlpha", min: 0, max: 0.85 },
  { label: "Panels", colorKey: "panelColor", alphaKey: "panelAlpha", min: 0.15, max: 1 },
  { label: "Status bars", colorKey: "chromeColor", alphaKey: "chromeAlpha", min: 0.15, max: 1 },
  { label: "Terminal well", colorKey: "terminalColor", alphaKey: "terminalAlpha", min: 0.05, max: 0.9 },
];

function previewConfig(theme: string, moodPreset: string, shell: string, liveMode: boolean): LoadedConfig {
  return {
    appearance: {
      theme,
      mood_preset: normalizeMoodPreset(moodPreset),
      ui_font_family: "IBM Plex Sans",
      terminal_font_family: terminalFontStack("Cascadia Code"),
      font_size: 14,
      terminal_text_clarity: "solid",
      terminal_surface_opacity: 0.82,
      line_height: 1.4,
      ligatures: true,
      window_effect: "mica",
      opacity: 1,
      theme_overrides: {},
      mood_material_overrides: {},
      wallpaper_settings_by_mood: {},
    },
    terminal: {
      default_shell: shell,
      scrollback: 10000,
      cursor_style: "bar",
      cursor_blink: true,
      paste_guard: true,
      shutdown_sidecar_on_exit: false,
    },
    ghost_diff: {
      live_mode: liveMode,
    },
  };
}

// Mirror of Rust `AppConfig` in src-tauri/src/config/settings.rs. Holding the
// full shape lets `handleSave` round-trip every field — even the ones the UI
// can't edit (window state, ui_font_family, opacity, scrollback…) — instead
// of resetting them to default whenever the user clicks Save.
interface LoadedConfig {
  appearance: {
    theme: string;
    mood_preset?: string;
    ui_font_family: string;
    terminal_font_family: string;
    font_size: number;
    terminal_text_clarity?: TerminalTextClarity;
    terminal_surface_opacity?: number;
    line_height: number;
    ligatures: boolean;
    window_effect: string;
    opacity: number;
    theme_overrides?: Record<string, AccentOverrides>;
    mood_material_overrides?: Partial<Record<MoodPresetId, MoodMaterialOverrides>>;
    wallpaper_settings_by_mood?: Partial<Record<MoodPresetId, Partial<WallpaperSettings>>>;
  };
  terminal: {
    default_shell: string;
    scrollback: number;
    cursor_style: string;
    cursor_blink: boolean;
    paste_guard?: boolean;
    shutdown_sidecar_on_exit?: boolean;
  };
  window?: {
    width: number;
    height: number;
    x?: number | null;
    y?: number | null;
    maximized: boolean;
    sidebar_visible: boolean;
    last_directory?: string | null;
    tab_count: number;
  };
  ghost_diff?: {
    live_mode?: boolean;
  };
  workspace_profile?: unknown;
}

export function Settings({ visible, onClose }: SettingsProps) {
  const storeTheme = useAppStore((s) => s.themeId);
  const setThemeId = useAppStore((s) => s.setThemeId);
  const storeMood = useAppStore((s) => s.moodPresetId);
  const setMoodPresetId = useAppStore((s) => s.setMoodPresetId);
  const moodMaterialOverrides = useAppStore((s) => s.moodMaterialOverrides);
  const setMoodMaterialOverride = useAppStore((s) => s.setMoodMaterialOverride);
  const resetMoodMaterialOverrides = useAppStore((s) => s.resetMoodMaterialOverrides);
  const replaceThemeOverrides = useAppStore((s) => s.replaceThemeOverrides);
  const replaceMoodMaterialOverrides = useAppStore((s) => s.replaceMoodMaterialOverrides);
  const wallpaperSettingsByMood = useAppStore((s) => s.wallpaperSettingsByMood);
  const setWallpaperSettingsForMood = useAppStore((s) => s.setWallpaperSettingsForMood);
  const replaceWallpaperSettingsByMood = useAppStore((s) => s.replaceWallpaperSettingsByMood);
  const ghostDiffLiveMode = useAppStore((s) => s.ghostDiffLiveMode);
  const setGhostDiffLiveMode = useAppStore((s) => s.setGhostDiffLiveMode);
  const storeWindowOpacity = useAppStore((s) => s.appWindowOpacity);
  const setAppWindowOpacity = useAppStore((s) => s.setAppWindowOpacity);
  const setTerminalAppearance = useAppStore((s) => s.setTerminalAppearance);
  const storeTerminalTextClarity = useAppStore((s) => s.terminalTextClarity);
  const storeTerminalSurfaceOpacity = useAppStore((s) => s.terminalSurfaceOpacity);
  const storeTerminalRendererMode = useAppStore((s) => s.terminalRendererMode);
  const setStoreCursorStyle = useAppStore((s) => s.setCursorStyle);
  const setStoreCursorBlink = useAppStore((s) => s.setCursorBlink);
  const setStorePasteGuard = useAppStore((s) => s.setPasteGuard);
  const setStoreDefaultShell = useAppStore((s) => s.setDefaultShell);
  const setStoreUiFontFamily = useAppStore((s) => s.setUiFontFamily);
  const setStoreWindowEffect = useAppStore((s) => s.setWindowEffect);
  const storeUiFontFamily = useAppStore((s) => s.uiFontFamily);
  const storeWindowEffect = useAppStore((s) => s.windowEffect);
  const [theme, setTheme] = useState(storeTheme);
  const [mood, setMood] = useState(storeMood);
  const [font, setFont] = useState("Cascadia Code");
  const [fontSize, setFontSize] = useState(14);
  const [terminalTextClarity, setTerminalTextClarity] = useState<TerminalTextClarity>(storeTerminalTextClarity);
  const [terminalSurfaceOpacity, setTerminalSurfaceOpacity] = useState(storeTerminalSurfaceOpacity);
  const [terminalRendererMode, setTerminalRendererMode] = useState<TerminalRendererMode>(storeTerminalRendererMode);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [ligatures, setLigatures] = useState(true);
  const [defaultShell, setDefaultShell] = useState("powershell");
  const [cursorStyle, setCursorStyle] = useState("bar");
  const [cursorBlink, setCursorBlink] = useState(true);
  const [pasteGuard, setPasteGuard] = useState(true);
  const [uiFont, setUiFont] = useState(storeUiFontFamily);
  const [windowEffect, setWindowEffect] = useState<WindowEffect>(storeWindowEffect);
  const [shutdownSidecarOnExit, setShutdownSidecarOnExit] = useState(false);
  const [liveMode, setLiveMode] = useState(ghostDiffLiveMode);
  const [windowOpacity, setWindowOpacity] = useState(storeWindowOpacity);
  const [editorOpenMode, setEditorOpenMode] = useState<EditorOpenMode>(() => loadEditorOpenMode());
  // Keep the full config snapshot so Save can round-trip fields the UI can't
  // edit (window state, ui_font_family, opacity, scrollback). Without this,
  // every Save click resets those fields to the Rust defaults.
  const [loadedConfig, setLoadedConfig] = useState<LoadedConfig | null>(null);
  const userEditedRef = useRef(false);
  const wallpaperFileInputRef = useRef<HTMLInputElement | null>(null);
  const browserWallpaperUrlRef = useRef<string | null>(null);
  const materialDefaults = MOOD_MATERIAL_DEFAULTS[mood];
  const materialOverrides = moodMaterialOverrides[mood] ?? {};
  const wallpaper = wallpaperSettingsByMood[mood] ?? {
    imagePath: null,
    opacity: 0,
    positionX: 50,
    positionY: 50,
    scale: 100,
  };

  useEffect(() => {
    // Re-load every time the dialog opens so a user who edited config.toml
    // directly between sessions doesn't have their changes overwritten by
    // the previous mount's stale state when they click Save.
    if (!visible) return;
    setEditorOpenMode(loadEditorOpenMode());
    // Reset the snapshot BEFORE the invoke fires so a rapid open/close/open
    // cycle (or a Save click before the load resolves) cannot round-trip
    // the previous mount's `loadedConfig`. Without this, the user could
    // edit config.toml externally, reopen Settings, hit Save before the
    // fresh fetch completes, and overwrite their disk edits with the
    // stale in-memory snapshot. The null-guard in handleSave then surfaces
    // a "Settings not saved" warning instead of silently corrupting disk.
    // (Same defect class fixed in WatchdogDialog round 4 / codex r2.)
    setLoadedConfig(null);
    userEditedRef.current = false;
    if (!isTauriRuntime()) {
      const current = useAppStore.getState();
      const cfg = previewConfig(current.themeId, current.moodPresetId, "powershell", current.ghostDiffLiveMode);
      setLoadedConfig(cfg);
      setTheme(cfg.appearance.theme);
      setMood(normalizeMoodPreset(cfg.appearance.mood_preset));
      setFont(terminalPrimaryFont(cfg.appearance.terminal_font_family));
      setFontSize(cfg.appearance.font_size);
      setTerminalTextClarity(cfg.appearance.terminal_text_clarity ?? "solid");
      setTerminalSurfaceOpacity(cfg.appearance.terminal_surface_opacity ?? storeTerminalSurfaceOpacity);
      setTerminalRendererMode(storeTerminalRendererMode);
      setLineHeight(cfg.appearance.line_height);
      setLigatures(cfg.appearance.ligatures);
      setUiFont(matchUiFontValue(cfg.appearance.ui_font_family));
      setWindowEffect(sanitizeWindowEffect(cfg.appearance.window_effect));
      replaceThemeOverrides(cfg.appearance.theme_overrides ?? {});
      setDefaultShell(cfg.terminal.default_shell);
      setCursorStyle(cfg.terminal.cursor_style);
      setCursorBlink(cfg.terminal.cursor_blink);
      setPasteGuard(cfg.terminal.paste_guard ?? true);
      setShutdownSidecarOnExit(cfg.terminal.shutdown_sidecar_on_exit ?? false);
      setLiveMode(cfg.ghost_diff?.live_mode ?? false);
      setWindowOpacity(cfg.appearance.opacity);
      setAppWindowOpacity(cfg.appearance.opacity);
      setTerminalAppearance({
        fontFamily: terminalFontStack(cfg.appearance.terminal_font_family),
        fontSize: cfg.appearance.font_size,
        textClarity: cfg.appearance.terminal_text_clarity ?? "solid",
        surfaceOpacity: cfg.appearance.terminal_surface_opacity,
        lineHeight: cfg.appearance.line_height,
        ligatures: cfg.appearance.ligatures,
        rendererMode: storeTerminalRendererMode,
      });
      return;
    }
    let cancelled = false;
    invoke<LoadedConfig>("load_app_config")
      .then((cfg) => {
        if (cancelled) return;
        setLoadedConfig(cfg);
        if (userEditedRef.current) return;
        setTheme(cfg.appearance.theme);
        const persistedMood = normalizeMoodPreset(cfg.appearance.mood_preset ?? useAppStore.getState().moodPresetId);
        replaceThemeOverrides(cfg.appearance.theme_overrides ?? {});
        replaceMoodMaterialOverrides(cfg.appearance.mood_material_overrides ?? {});
        replaceWallpaperSettingsByMood(cfg.appearance.wallpaper_settings_by_mood ?? {});
        setMood(persistedMood);
        setMoodPresetId(persistedMood);
        setFont(terminalPrimaryFont(cfg.appearance.terminal_font_family));
        setFontSize(cfg.appearance.font_size);
        setTerminalTextClarity(cfg.appearance.terminal_text_clarity ?? "solid");
        setTerminalSurfaceOpacity(cfg.appearance.terminal_surface_opacity ?? storeTerminalSurfaceOpacity);
        setTerminalRendererMode(useAppStore.getState().terminalRendererMode);
        setLineHeight(cfg.appearance.line_height);
        setLigatures(cfg.appearance.ligatures);
        setUiFont(matchUiFontValue(cfg.appearance.ui_font_family));
        setWindowEffect(sanitizeWindowEffect(cfg.appearance.window_effect));
        setDefaultShell(cfg.terminal.default_shell);
        setCursorStyle(cfg.terminal.cursor_style);
        setCursorBlink(cfg.terminal.cursor_blink);
        setPasteGuard(cfg.terminal.paste_guard ?? true);
        setShutdownSidecarOnExit(cfg.terminal.shutdown_sidecar_on_exit ?? false);
        setWindowOpacity(cfg.appearance.opacity);
        setAppWindowOpacity(cfg.appearance.opacity);
        setTerminalAppearance({
          fontFamily: terminalFontStack(cfg.appearance.terminal_font_family),
          fontSize: cfg.appearance.font_size,
          textClarity: cfg.appearance.terminal_text_clarity ?? "solid",
          surfaceOpacity: cfg.appearance.terminal_surface_opacity,
          lineHeight: cfg.appearance.line_height,
          ligatures: cfg.appearance.ligatures,
          rendererMode: useAppStore.getState().terminalRendererMode,
        });
        // Rehydrate from disk so config.toml is the source of truth — this
        // corrects the localStorage bootstrap value if the user edited the
        // file directly.
        const persisted = cfg.ghost_diff?.live_mode ?? false;
        setLiveMode(persisted);
        setGhostDiffLiveMode(persisted);
      })
      .catch((err) => {
        if (cancelled) return;
        // Surface load failure so the user knows their edits will not
        // round-trip — without this, Save silently bails out via the
        // null-guard in handleSave and looks like a no-op.
        toast.error("Failed to load settings", String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [
    visible,
    setGhostDiffLiveMode,
    setMoodPresetId,
    setAppWindowOpacity,
    replaceThemeOverrides,
    replaceMoodMaterialOverrides,
    replaceWallpaperSettingsByMood,
    setTerminalAppearance,
    storeTerminalSurfaceOpacity,
    storeTerminalRendererMode,
  ]);

  const markEdited = () => {
    userEditedRef.current = true;
  };

  const selectMoodPreset = (value: string) => {
    markEdited();
    const preset = normalizeMoodPreset(value);
    setMood(preset);
    setMoodPresetId(preset);
  };

  const chooseWallpaperImage = async () => {
    markEdited();
    if (!isTauriRuntime()) {
      wallpaperFileInputRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose Background Image",
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"],
          },
        ],
      });
      if (typeof selected === "string") {
        // The picker can return a path on any drive, but the Tauri
        // assetProtocol.scope only allows `$HOME/**`. Copy the image into the
        // app-data wallpapers dir (under $HOME) so the stored imagePath always
        // resolves via the asset protocol. Fall back to the raw path if the
        // copy fails (e.g. the image is already inside $HOME).
        let imagePath = selected;
        try {
          imagePath = await invoke<string>("persist_wallpaper_image", { src: selected });
        } catch (copyErr) {
          toast.warning(
            "Background image not copied into app data",
            `Using the original path; it may not display if it is outside your home folder. ${String(copyErr)}`,
          );
        }
        // Seed a visible opacity when none was set yet, otherwise a freshly-chosen
        // wallpaper stays invisible at the default opacity 0 over the transparent window.
        setWallpaperSettingsForMood(mood, {
          imagePath,
          ...(wallpaper.opacity <= 0 ? { opacity: 1 } : {}),
        });
      }
    } catch (err) {
      toast.error("Failed to choose background image", String(err));
    }
  };

  const handleBrowserWallpaperFile = (file: File | undefined) => {
    markEdited();
    if (!file) return;
    if (browserWallpaperUrlRef.current) {
      URL.revokeObjectURL(browserWallpaperUrlRef.current);
      browserWallpaperUrlRef.current = null;
    }
    const objectUrl = URL.createObjectURL(file);
    browserWallpaperUrlRef.current = objectUrl;
    setWallpaperSettingsForMood(mood, {
      imagePath: objectUrl,
      ...(wallpaper.opacity <= 0 ? { opacity: 1 } : {}),
    });
  };

  useEffect(() => {
    return () => {
      if (browserWallpaperUrlRef.current) {
        URL.revokeObjectURL(browserWallpaperUrlRef.current);
        browserWallpaperUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (visible) setMood(storeMood);
  }, [visible, storeMood]);

  const handleSave = () => {
    if (!loadedConfig) {
      // Open and immediately close before the load resolves (or load
      // failed). Preserve disk contents by skipping save entirely rather
      // than writing UI defaults — but warn the user instead of silently
      // discarding their edits, otherwise Save behaves like a no-op.
      toast.warning(
        "Settings not saved",
        "Config has not finished loading yet — please reopen the dialog and try again.",
      );
      onClose();
      return;
    }
    if (!isTauriRuntime()) {
      setThemeId(theme);
      setMoodPresetId(mood);
      setGhostDiffLiveMode(liveMode);
      setAppWindowOpacity(windowOpacity);
      const terminalFontFamily = terminalFontStack(font);
      setTerminalAppearance({
        fontFamily: terminalFontFamily,
        fontSize,
        textClarity: terminalTextClarity,
        surfaceOpacity: terminalSurfaceOpacity,
        lineHeight,
        ligatures,
        rendererMode: terminalRendererMode,
      });
      setStoreCursorStyle(cursorStyle as TerminalCursorStyle);
      setStoreCursorBlink(cursorBlink);
      setStoreDefaultShell(defaultShell);
      setStoreUiFontFamily(uiFont);
      setStoreWindowEffect(windowEffect);
      saveEditorOpenMode(editorOpenMode);
      onClose();
      return;
    }
    const latestStore = useAppStore.getState();
    const terminalFontFamily = terminalFontStack(font);
    const merged: LoadedConfig = {
      ...loadedConfig,
      appearance: {
        ...loadedConfig.appearance,
        theme,
        mood_preset: mood,
        ui_font_family: uiFont,
        terminal_font_family: terminalFontFamily,
        font_size: fontSize,
        terminal_text_clarity: terminalTextClarity,
        terminal_surface_opacity: terminalSurfaceOpacity,
        line_height: lineHeight,
        ligatures,
        window_effect: windowEffect,
        opacity: windowOpacity,
        theme_overrides: latestStore.themeOverrides,
        mood_material_overrides: latestStore.moodMaterialOverrides,
        wallpaper_settings_by_mood: latestStore.wallpaperSettingsByMood,
      },
      terminal: {
        ...loadedConfig.terminal,
        default_shell: defaultShell,
        cursor_style: cursorStyle,
        cursor_blink: cursorBlink,
        paste_guard: pasteGuard,
        shutdown_sidecar_on_exit: shutdownSidecarOnExit,
      },
      ghost_diff: {
        ...(loadedConfig.ghost_diff ?? {}),
        live_mode: liveMode,
      },
    };
    invoke("save_app_config", { config: merged })
      .then(() => {
        // Window backdrop is applied live by the dropdown's onValueChange (see
        // set_window_effect there), so Save only needs to persist the config —
        // re-applying here would touch the DWM on every unrelated settings save.
        setThemeId(theme);
        setMoodPresetId(mood);
        setGhostDiffLiveMode(liveMode);
        setAppWindowOpacity(windowOpacity);
        setTerminalAppearance({
          fontFamily: terminalFontFamily,
          fontSize,
          textClarity: terminalTextClarity,
          surfaceOpacity: terminalSurfaceOpacity,
          lineHeight,
          ligatures,
          rendererMode: terminalRendererMode,
        });
        setStoreCursorStyle(cursorStyle as TerminalCursorStyle);
        setStoreCursorBlink(cursorBlink);
        setStorePasteGuard(pasteGuard);
        setStoreDefaultShell(defaultShell);
        setStoreUiFontFamily(uiFont);
        setStoreWindowEffect(windowEffect);
        saveEditorOpenMode(editorOpenMode);
        onClose();
      })
      .catch((err) => {
        // Surface failure instead of swallowing — user otherwise sees the
        // dialog close with no indication that disk write failed.
        toast.error("Failed to save settings", String(err));
      });
  };

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>Settings</Dialog.Title>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              <button type="button" className={styles.saveBtn} onClick={handleSave}>
                Save
              </button>
              <Dialog.Close asChild>
                <button type="button" className={styles.closeBtn} aria-label="Close settings">
                  <span aria-hidden="true">×</span>
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className={styles.content}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Appearance</h3>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-theme">
                  Theme
                </label>
                <Select
                  id="settings-theme"
                  value={theme}
                  onValueChange={(next) => {
                    markEdited();
                    setTheme(next);
                    // Apply immediately so the palette editor below targets
                    // the live theme (the running window is the preview).
                    setThemeId(next);
                  }}
                  options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
                  ariaLabel="Theme"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-mood">
                  Mood
                </label>
                <Select
                  id="settings-mood"
                  value={mood}
                  onValueChange={selectMoodPreset}
                  options={MOOD_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                    hint: preset.tone,
                  }))}
                  ariaLabel="Mood"
                />
                <div className={styles.moodGrid} role="radiogroup" aria-label="Mood presets">
                  {MOOD_PRESETS.map((preset) => (
                    <label
                      key={preset.id}
                      className={styles.moodCard}
                      data-active={mood === preset.id ? "true" : undefined}
                      data-mood={preset.id}
                    >
                      <input
                        className={styles.radioInput}
                        type="radio"
                        name="settings-mood-preset"
                        value={preset.id}
                        checked={mood === preset.id}
                        onChange={() => selectMoodPreset(preset.id)}
                      />
                      <span className={styles.moodSwatch} aria-hidden="true" />
                      <span className={styles.moodCopy}>
                        <span className={styles.moodName}>{preset.label}</span>
                        <span className={styles.moodTone}>{preset.tone}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-window-opacity">
                  Window opacity
                </label>
                <p className={styles.materialHint}>Controls the global backdrop strength without dimming text.</p>
                <div className={styles.materialRow}>
                  <span className={styles.materialColorPreview} aria-hidden="true" />
                  <input
                    id="settings-window-opacity"
                    className={styles.materialSlider}
                    type="range"
                    aria-label="Window opacity"
                    min={0.2}
                    max={1}
                    step={0.01}
                    value={windowOpacity}
                    onChange={(e) => {
                      markEdited();
                      const next = Number(e.target.value);
                      setWindowOpacity(next);
                      setAppWindowOpacity(next);
                    }}
                  />
                  <span className={styles.materialValue}>{Math.round(windowOpacity * 100)}%</span>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-terminal-surface-opacity">
                  Terminal surface opacity
                </label>
                <p className={styles.materialHint}>Lower values make only the backing clearer; glyphs stay solid.</p>
                <div className={styles.materialRow}>
                  <span className={styles.materialColorPreview} aria-hidden="true" />
                  <input
                    id="settings-terminal-surface-opacity"
                    className={styles.materialSlider}
                    type="range"
                    aria-label="Terminal surface opacity"
                    min={0.24}
                    max={1}
                    step={0.01}
                    value={terminalSurfaceOpacity}
                    onChange={(e) => {
                      markEdited();
                      const next = Number(e.target.value);
                      setTerminalSurfaceOpacity(next);
                      setTerminalAppearance({ surfaceOpacity: next });
                    }}
                  />
                  <span className={styles.materialValue}>{Math.round(terminalSurfaceOpacity * 100)}%</span>
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.materialHeader}>
                  <div>
                    <div className={styles.label}>Surface Material</div>
                    <p className={styles.materialHint}>Customize colors and opacity for the selected mood preset.</p>
                  </div>
                  <button
                    type="button"
                    className={styles.materialReset}
                    onClick={() => {
                      markEdited();
                      resetMoodMaterialOverrides(mood);
                    }}
                  >
                    Reset
                  </button>
                </div>
                <div className={styles.materialGrid}>
                  {MATERIAL_CONTROLS.map((control) => {
                    const color = materialOverrides[control.colorKey] ?? materialDefaults[control.colorKey];
                    const alpha = materialOverrides[control.alphaKey] ?? materialDefaults[control.alphaKey];
                    return (
                      <div className={styles.materialRow} key={control.alphaKey}>
                        <label className={styles.materialName} htmlFor={`settings-${control.alphaKey}`}>
                          {control.label}
                        </label>
                        <input
                          className={styles.materialColor}
                          type="color"
                          value={color}
                          aria-label={`${control.label} color`}
                          onChange={(e) => {
                            markEdited();
                            setMoodMaterialOverride(mood, control.colorKey, e.target.value);
                          }}
                        />
                        <input
                          id={`settings-${control.alphaKey}`}
                          className={styles.materialSlider}
                          type="range"
                          aria-label={`${control.label} opacity`}
                          min={control.min}
                          max={control.max}
                          step={0.01}
                          value={alpha}
                          onChange={(e) => {
                            markEdited();
                            setMoodMaterialOverride(mood, control.alphaKey, Number(e.target.value));
                          }}
                        />
                        <span className={styles.materialValue}>{Math.round(alpha * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.materialHeader}>
                  <div>
                    <div className={styles.label}>Background Image</div>
                    <p className={styles.materialHint}>
                      Saved per mood preset. Tune the backdrop image, opacity, scale, and placement.
                    </p>
                  </div>
                  <div className={styles.wallpaperActions}>
                    <button type="button" className={styles.materialReset} onClick={chooseWallpaperImage}>
                      Choose
                    </button>
                    <button
                      type="button"
                      className={styles.materialReset}
                      onClick={() => {
                        markEdited();
                        setWallpaperSettingsForMood(mood, { imagePath: null });
                      }}
                      disabled={!wallpaper.imagePath}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className={styles.wallpaperBox}>
                  <input
                    ref={wallpaperFileInputRef}
                    className={styles.wallpaperFileInput}
                    type="file"
                    aria-label="Choose background image file"
                    accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
                    tabIndex={-1}
                    onChange={(event) => {
                      handleBrowserWallpaperFile(event.currentTarget.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                  <label className={styles.label} htmlFor="settings-wallpaper-path">
                    Image path
                  </label>
                  <input
                    id="settings-wallpaper-path"
                    className={styles.wallpaperInput}
                    value={wallpaper.imagePath ?? ""}
                    onChange={(event) => {
                      markEdited();
                      const next = event.currentTarget.value.trim();
                      setWallpaperSettingsForMood(mood, {
                        imagePath: next.length > 0 ? next : null,
                        ...(next.length > 0 && wallpaper.opacity <= 0 ? { opacity: 1 } : {}),
                      });
                    }}
                    placeholder="C:/Users/example/Pictures/background.jpg"
                  />
                  <div className={styles.wallpaperPath} title={wallpaper.imagePath ?? "No image selected"}>
                    {wallpaper.imagePath ?? "No image selected"}
                  </div>
                  <div className={styles.materialRow}>
                    <label className={styles.materialName} htmlFor="settings-wallpaper-opacity">
                      Opacity
                    </label>
                    <span className={styles.materialColorPreview} aria-hidden="true" />
                    <input
                      id="settings-wallpaper-opacity"
                      className={styles.materialSlider}
                      type="range"
                      aria-label="Background image opacity"
                      min={0}
                      max={1}
                      step={0.01}
                      value={wallpaper.opacity}
                      onChange={(e) => {
                        markEdited();
                        setWallpaperSettingsForMood(mood, { opacity: Number(e.target.value) });
                      }}
                    />
                    <span className={styles.materialValue}>{Math.round(wallpaper.opacity * 100)}%</span>
                  </div>
                  <div className={styles.materialRow}>
                    <label className={styles.materialName} htmlFor="settings-wallpaper-scale">
                      Scale
                    </label>
                    <span className={styles.materialColorPreview} aria-hidden="true" />
                    <input
                      id="settings-wallpaper-scale"
                      className={styles.materialSlider}
                      type="range"
                      aria-label="Background image scale"
                      min={25}
                      max={300}
                      step={1}
                      value={wallpaper.scale}
                      onChange={(e) => {
                        markEdited();
                        setWallpaperSettingsForMood(mood, { scale: Number(e.target.value) });
                      }}
                    />
                    <span className={styles.materialValue}>{Math.round(wallpaper.scale)}%</span>
                  </div>
                  <div className={styles.materialRow}>
                    <label className={styles.materialName} htmlFor="settings-wallpaper-position-x">
                      X
                    </label>
                    <span className={styles.materialColorPreview} aria-hidden="true" />
                    <input
                      id="settings-wallpaper-position-x"
                      className={styles.materialSlider}
                      type="range"
                      aria-label="Background image horizontal position"
                      min={0}
                      max={100}
                      step={1}
                      value={wallpaper.positionX}
                      onChange={(e) => {
                        markEdited();
                        setWallpaperSettingsForMood(mood, { positionX: Number(e.target.value) });
                      }}
                    />
                    <span className={styles.materialValue}>{Math.round(wallpaper.positionX)}%</span>
                  </div>
                  <div className={styles.materialRow}>
                    <label className={styles.materialName} htmlFor="settings-wallpaper-position-y">
                      Y
                    </label>
                    <span className={styles.materialColorPreview} aria-hidden="true" />
                    <input
                      id="settings-wallpaper-position-y"
                      className={styles.materialSlider}
                      type="range"
                      aria-label="Background image vertical position"
                      min={0}
                      max={100}
                      step={1}
                      value={wallpaper.positionY}
                      onChange={(e) => {
                        markEdited();
                        setWallpaperSettingsForMood(mood, { positionY: Number(e.target.value) });
                      }}
                    />
                    <span className={styles.materialValue}>{Math.round(wallpaper.positionY)}%</span>
                  </div>
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Palette</div>
                <ThemePaletteEditor themeId={theme} onDirty={markEdited} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-font">
                  Terminal Font
                </label>
                <Select
                  id="settings-font"
                  value={font}
                  onValueChange={(next) => {
                    markEdited();
                    setFont(next);
                  }}
                  options={FONTS.map((f) => ({ value: f, label: f }))}
                  ariaLabel="Terminal font"
                />
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-font-size">
                    Font Size
                  </label>
                  <input
                    id="settings-font-size"
                    type="number"
                    className={styles.input}
                    value={fontSize}
                    min={10}
                    max={24}
                    onChange={(e) => {
                      markEdited();
                      setFontSize(Number(e.target.value));
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-terminal-text-clarity">
                    Text Clarity
                  </label>
                  <Select
                    id="settings-terminal-text-clarity"
                    value={terminalTextClarity}
                    onValueChange={(next) => {
                      markEdited();
                      setTerminalTextClarity(next as TerminalTextClarity);
                      setTerminalAppearance({ textClarity: next as TerminalTextClarity });
                    }}
                    options={TERMINAL_TEXT_CLARITY_OPTIONS}
                    ariaLabel="Terminal text clarity"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-line-height">
                    Line Height
                  </label>
                  <input
                    id="settings-line-height"
                    type="number"
                    className={styles.input}
                    value={lineHeight}
                    min={1}
                    max={2}
                    step={0.1}
                    onChange={(e) => {
                      markEdited();
                      const raw = Number(e.target.value);
                      setLineHeight(raw);
                      // Live-apply (clamped 1.0..2.0) so the running terminals
                      // re-measure cell height immediately; Save persists it.
                      if (Number.isFinite(raw)) {
                        setTerminalAppearance({ lineHeight: Math.min(2, Math.max(1, raw)) });
                      }
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="settings-terminal-renderer">
                    Renderer
                  </label>
                  <Select
                    id="settings-terminal-renderer"
                    value={terminalRendererMode}
                    onValueChange={(next) => {
                      markEdited();
                      const rendererMode = next as TerminalRendererMode;
                      setTerminalRendererMode(rendererMode);
                      setTerminalAppearance({ rendererMode });
                    }}
                    options={TERMINAL_RENDERER_OPTIONS}
                    ariaLabel="Terminal renderer"
                  />
                </div>
              </div>
              <div className={styles.field}>
                <Switch
                  id="settings-ligatures"
                  label="Font Ligatures"
                  checked={ligatures}
                  onCheckedChange={(next) => {
                    markEdited();
                    setLigatures(next);
                    setTerminalAppearance({ ligatures: next });
                  }}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-ui-font">
                  UI Font
                </label>
                <Select
                  id="settings-ui-font"
                  value={matchUiFontValue(uiFont)}
                  onValueChange={(next) => {
                    markEdited();
                    setUiFont(next);
                    // Live-apply to the app chrome font variable; Save persists it.
                    setStoreUiFontFamily(next);
                  }}
                  options={UI_FONTS}
                  ariaLabel="UI font"
                />
                <p className={styles.hint}>Font for the app chrome (menus, panels, labels) — not the terminal.</p>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-window-effect">
                  Window Backdrop
                </label>
                <Select
                  id="settings-window-effect"
                  value={windowEffect}
                  onValueChange={(next) => {
                    markEdited();
                    const effect = sanitizeWindowEffect(next);
                    setWindowEffect(effect);
                    setStoreWindowEffect(effect);
                    // Apply the backdrop live the moment the effect changes, so
                    // transparent<->mica<->acrylic switches are immediate (no
                    // restart). Persisted on Save via save_app_config. Best-effort:
                    // an OS refusal must not break the dropdown.
                    invoke("set_window_effect", { effect }).catch((err) => {
                      toast.error("Failed to apply window effect", String(err));
                    });
                  }}
                  options={WINDOW_EFFECT_OPTIONS}
                  ariaLabel="Window backdrop"
                />
                <p className={styles.hint}>
                  Transparent shows the desktop and windows behind through the app (see-through). Mica and Acrylic are
                  opaque Windows materials that cover the desktop. Applies immediately.
                </p>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Terminal</h3>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-default-shell">
                  Default Shell
                </label>
                <Select
                  id="settings-default-shell"
                  // Normalize so a raw config value (`pwsh.exe`) maps onto a
                  // real picker option instead of leaving the Select blank.
                  value={sanitizeDefaultShell(defaultShell)}
                  onValueChange={(next) => {
                    markEdited();
                    setDefaultShell(next);
                    // Live-apply so newly opened tabs use the chosen shell
                    // without an app restart; Save persists it to config.toml.
                    setStoreDefaultShell(next);
                  }}
                  options={SHELLS.map((s) => ({ value: s.id, label: s.label }))}
                  ariaLabel="Default shell"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-editor-open-mode">
                  Open Files With
                </label>
                <Select
                  id="settings-editor-open-mode"
                  value={editorOpenMode}
                  onValueChange={(next) => {
                    markEdited();
                    setEditorOpenMode(next === "builtin" ? "builtin" : "vscode");
                  }}
                  options={[
                    { value: "vscode", label: "VS Code" },
                    { value: "builtin", label: "Built-in editor" },
                  ]}
                  ariaLabel="Open files with"
                />
                <p className={styles.hint}>File tree, search results, and terminal file links use this target.</p>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="settings-cursor-style">
                  Cursor Style
                </label>
                <Select
                  id="settings-cursor-style"
                  value={cursorStyle}
                  onValueChange={(next) => {
                    markEdited();
                    setCursorStyle(next);
                    // Live-apply so the rendered cursor updates immediately.
                    setStoreCursorStyle(next as TerminalCursorStyle);
                  }}
                  options={[
                    { value: "bar", label: "Bar" },
                    { value: "block", label: "Block" },
                    { value: "underline", label: "Underline" },
                  ]}
                  ariaLabel="Cursor style"
                />
              </div>
              <div className={styles.field}>
                <Switch
                  id="settings-cursor-blink"
                  label="Cursor Blink"
                  checked={cursorBlink}
                  onCheckedChange={(next) => {
                    markEdited();
                    setCursorBlink(next);
                    setStoreCursorBlink(next);
                  }}
                />
              </div>
              <div className={styles.field}>
                <Switch
                  id="settings-shutdown-sidecar-on-exit"
                  label="Close sessions on app exit"
                  checked={shutdownSidecarOnExit}
                  onCheckedChange={(next) => {
                    markEdited();
                    setShutdownSidecarOnExit(next);
                  }}
                />
                <p className={styles.hint}>
                  Off (default): terminal sessions keep running in the background daemon and reattach with their
                  scrollback after an app restart or crash. On: quitting Aelyris also stops the daemon and every session
                  it hosts.
                </p>
              </div>
              <div className={styles.field}>
                <Switch
                  id="settings-terminal-paste-guard"
                  label="Confirm multi-line paste"
                  checked={pasteGuard}
                  onCheckedChange={(next) => {
                    markEdited();
                    setPasteGuard(next);
                    setStorePasteGuard(next);
                  }}
                />
                <p className={styles.hint}>Preview and confirm commands that span more than one pasted line.</p>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Updates</h3>
              <UpdateCheckSection />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Shell Integration</h3>
              <p className={styles.hint}>
                Aelyris parses OSC 133 prompt marks for "jump to previous prompt" and exit-code coloring. Install the
                helper script for your shell to enable these features.
              </p>
              <ShellIntegrationSection />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Ghost Diff Overlay</h3>
              <div className={styles.field}>
                <Switch
                  id="settings-ghost-live"
                  label="Live mode (paint in-progress layers)"
                  hint="When off, ghost paint appears only after the agent run finishes. When on, every fs change from the agent's worktree streams into the editor as it happens."
                  checked={liveMode}
                  onCheckedChange={(next) => {
                    markEdited();
                    setLiveMode(next);
                  }}
                />
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Keyboard Shortcuts</h3>
              <div className={styles.shortcutList}>
                {getShortcutHelpItems().map(({ id, label, display }) => (
                  <div key={id} className={styles.shortcutRow}>
                    <span>{label}</span>
                    <kbd className={styles.kbd}>{display}</kbd>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
