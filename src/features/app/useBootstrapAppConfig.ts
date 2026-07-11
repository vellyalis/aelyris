import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { BootstrapAppConfig } from "../right-rail/bootstrapAppConfig";
import {
  hydrateRightRailGuardrailSelectionFromConfig,
  hydrateRightRailWidgetOpenFromConfig,
} from "../right-rail/rightRailModel";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import {
  sanitizeDefaultShell,
  sanitizeTerminalCursorStyle,
  sanitizeWindowEffect,
  useAppStore,
} from "../../shared/store/appStore";
import { normalizeMoodPreset } from "../../shared/themes/moods";

export function useBootstrapAppConfig(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    invoke<BootstrapAppConfig>("load_app_config")
      .then((cfg) => {
        if (cancelled) return;
        const store = useAppStore.getState();
        store.setThemeId(cfg.appearance.theme);
        store.setMoodPresetId(normalizeMoodPreset(cfg.appearance.mood_preset ?? store.moodPresetId));
        store.replaceThemeOverrides(cfg.appearance.theme_overrides ?? {});
        store.replaceMoodMaterialOverrides(cfg.appearance.mood_material_overrides ?? {});
        store.replaceWallpaperSettingsByMood(cfg.appearance.wallpaper_settings_by_mood ?? {});
        if (typeof cfg.appearance.opacity === "number") store.setAppWindowOpacity(cfg.appearance.opacity);
        store.setTerminalAppearance({
          fontFamily: cfg.appearance.terminal_font_family,
          fontSize: cfg.appearance.font_size,
          textClarity: cfg.appearance.terminal_text_clarity,
          surfaceOpacity: cfg.appearance.terminal_surface_opacity,
          lineHeight: cfg.appearance.line_height,
          ligatures: cfg.appearance.ligatures,
        });
        if (cfg.appearance.ui_font_family !== undefined) store.setUiFontFamily(cfg.appearance.ui_font_family);
        if (cfg.appearance.window_effect !== undefined) store.setWindowEffect(sanitizeWindowEffect(cfg.appearance.window_effect));
        if (cfg.terminal?.default_shell !== undefined) store.setDefaultShell(sanitizeDefaultShell(cfg.terminal.default_shell));
        if (cfg.terminal?.cursor_style !== undefined) store.setCursorStyle(sanitizeTerminalCursorStyle(cfg.terminal.cursor_style));
        if (cfg.terminal?.cursor_blink !== undefined) store.setCursorBlink(cfg.terminal.cursor_blink);
        store.setGhostDiffLiveMode(cfg.ghost_diff?.live_mode ?? false);
        hydrateRightRailGuardrailSelectionFromConfig(cfg.workspace_profile?.global_defaults?.pane_layout?.right_rail_guardrail_profile);
        hydrateRightRailWidgetOpenFromConfig(cfg.workspace_profile?.global_defaults?.pane_layout?.right_rail_widgets);
      })
      .catch((err) => reportInvokeFailure({ source: "app", operation: "load_app_config_bootstrap", err, severity: "warning" }));
    return () => { cancelled = true; };
  }, []);
}
