import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { formatFallbackError, reportFallback } from "../lib/fallbackTelemetry";
import { type AccentOverrides, applyAccentOverrides, getPalette, isLightTheme, themeToCSS } from "../themes/catppuccin";
import {
  DEFAULT_MOOD_PRESET,
  isMoodMaterialLight,
  MOOD_CSS_KEYS,
  MOOD_MATERIAL_DEFAULTS,
  type MoodMaterialOverrides,
  type MoodPresetId,
  materialOverridesToCSS,
  moodPresetToCSS,
  normalizeMoodPreset,
} from "../themes/moods";

const STORAGE_KEY = "aelyris:theme";
const MOOD_STORAGE_KEY = "aelyris:moodPreset";

function reportThemeCustomizationFailure(operation: string, err: unknown) {
  reportFallback(
    {
      source: "theme-customization",
      operation,
      severity: "warning",
      message: formatFallbackError(err),
      userVisible: true,
    },
    { throttleMs: 5_000 },
  );
}

function resolveWallpaperImageUrl(imagePath: string): string {
  try {
    return convertFileSrc(imagePath);
  } catch {
    if (/^(https?:|data:|blob:|asset:|file:)/i.test(imagePath)) return imagePath;
    return `file:///${imagePath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  }
}

function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "aelyris-dark";
  } catch {
    return "aelyris-dark";
  }
}

function loadMoodPresetId(): MoodPresetId {
  try {
    return normalizeMoodPreset(localStorage.getItem(MOOD_STORAGE_KEY));
  } catch {
    return DEFAULT_MOOD_PRESET;
  }
}

/**
 * Apply the given theme's CSS custom properties to :root.
 * Call from App.tsx to keep the theme in sync. Optional `overrides` layer
 * accent values from the in-app palette editor on top of the base palette.
 */
export function useThemeApplier(
  themeId: string,
  overrides?: AccentOverrides,
  moodPresetId: MoodPresetId = DEFAULT_MOOD_PRESET,
  materialOverrides?: MoodMaterialOverrides,
  wallpaper?: { imagePath?: string | null; opacity?: number; positionX?: number; positionY?: number; scale?: number },
  windowOpacity = 0.95,
  terminalSurfaceOpacity = 0.82,
  // See-through window (window_effect="transparent", the default): the wallpaper
  // is a translucent layer over the live desktop, so its backstop must stay
  // transparent. When false (opaque mica/acrylic material) the backstop covers
  // the desktop so the wallpaper reads as a solid backdrop.
  seeThrough = true,
) {
  const mood = normalizeMoodPreset(moodPresetId);

  useEffect(() => {
    const base = getPalette(themeId);
    const palette = applyAccentOverrides(base, overrides);
    const paletteLight = isLightTheme(themeId);
    const materialLight = isMoodMaterialLight(mood, materialOverrides);
    const light = materialLight;
    const vars = {
      ...themeToCSS(palette, paletteLight),
      ...moodPresetToCSS(mood),
      ...materialOverridesToCSS(materialOverrides, MOOD_MATERIAL_DEFAULTS[mood]),
    };

    const root = document.documentElement;
    for (const key of MOOD_CSS_KEYS) {
      root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    const imagePath = wallpaper?.imagePath?.trim();
    if (imagePath) {
      root.style.setProperty("--aelyris-wallpaper-image", `url("${resolveWallpaperImageUrl(imagePath)}")`);
      // See-through (default): keep the backstop transparent so the wallpaper
      // image floats as a translucent layer and the live desktop/windows behind
      // bleed through at the wallpaper's opacity. Opaque material modes use a
      // mood-appropriate backstop so a scaled/letterboxed/alpha image still
      // fully covers the desktop.
      root.style.setProperty(
        "--aelyris-wallpaper-backstop",
        seeThrough ? "transparent" : light ? "#fbf2f7" : "#05070e",
      );
    } else {
      root.style.setProperty("--aelyris-wallpaper-image", "none");
      root.style.setProperty("--aelyris-wallpaper-backstop", "transparent");
    }
    const opacity =
      typeof wallpaper?.opacity === "number" && Number.isFinite(wallpaper.opacity) ? wallpaper.opacity : 0;
    // Ceiling is 1 (not 0.85): a set wallpaper is meant to be an opaque in-app backdrop
    // that covers the desktop, not a faint tint over the transparent window.
    root.style.setProperty("--aelyris-wallpaper-opacity", String(Math.min(1, Math.max(0, opacity))));
    const appOpacity = Number.isFinite(windowOpacity) ? Math.min(1, Math.max(0.2, windowOpacity)) : 0.95;
    root.style.setProperty("--aelyris-window-opacity", String(Number(appOpacity.toFixed(2))));
    // Low window opacity should reveal the native backdrop, not add a dark scrim over solid text.
    const veilOpacity = Math.min(0.08, Math.max(0, (1 - appOpacity) * 0.12));
    root.style.setProperty("--aelyris-window-veil-opacity", String(Number(veilOpacity.toFixed(3))));
    const terminalOpacity = Number.isFinite(terminalSurfaceOpacity)
      ? Math.min(1, Math.max(0.24, terminalSurfaceOpacity))
      : 0.82;
    root.style.setProperty("--terminal-surface-opacity", String(Number(terminalOpacity.toFixed(2))));
    const positionX =
      typeof wallpaper?.positionX === "number" && Number.isFinite(wallpaper.positionX) ? wallpaper.positionX : 50;
    const positionY =
      typeof wallpaper?.positionY === "number" && Number.isFinite(wallpaper.positionY) ? wallpaper.positionY : 50;
    const scale = typeof wallpaper?.scale === "number" && Number.isFinite(wallpaper.scale) ? wallpaper.scale : 100;
    root.style.setProperty("--aelyris-wallpaper-position-x", `${Math.min(100, Math.max(0, positionX))}%`);
    root.style.setProperty("--aelyris-wallpaper-position-y", `${Math.min(100, Math.max(0, positionY))}%`);
    root.style.setProperty("--aelyris-wallpaper-size", `${Math.min(300, Math.max(25, scale))}% auto`);
    root.dataset.theme = themeId;
    root.dataset.mood = mood;

    // Toggle light/dark class for components that need it
    root.classList.toggle("light-theme", light);
    root.classList.toggle("dark-theme", !light);

    // Persist
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
      localStorage.setItem(MOOD_STORAGE_KEY, mood);
    } catch (err) {
      reportThemeCustomizationFailure("persist_theme_preferences", err);
    }
  }, [
    themeId,
    overrides,
    mood,
    materialOverrides,
    wallpaper?.imagePath,
    wallpaper?.opacity,
    wallpaper?.positionX,
    wallpaper?.positionY,
    wallpaper?.scale,
    windowOpacity,
    terminalSurfaceOpacity,
    seeThrough,
  ]);
}

export { loadMoodPresetId, loadThemeId };
