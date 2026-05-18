import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { type AccentOverrides, applyAccentOverrides, getPalette, isLightTheme, themeToCSS } from "../themes/catppuccin";
import {
  DEFAULT_MOOD_PRESET,
  MOOD_MATERIAL_DEFAULTS,
  MOOD_CSS_KEYS,
  type MoodPresetId,
  type MoodMaterialOverrides,
  isMoodMaterialLight,
  materialOverridesToCSS,
  moodPresetToCSS,
  normalizeMoodPreset,
} from "../themes/moods";

const STORAGE_KEY = "aether:theme";
const MOOD_STORAGE_KEY = "aether:moodPreset";

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
    return localStorage.getItem(STORAGE_KEY) ?? "aether-dark";
  } catch {
    return "aether-dark";
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
      root.style.setProperty("--aether-wallpaper-image", `url("${resolveWallpaperImageUrl(imagePath)}")`);
    } else {
      root.style.setProperty("--aether-wallpaper-image", "none");
    }
    const opacity = typeof wallpaper?.opacity === "number" && Number.isFinite(wallpaper.opacity) ? wallpaper.opacity : 0;
    root.style.setProperty("--aether-wallpaper-opacity", String(Math.min(0.85, Math.max(0, opacity))));
    const appOpacity = Number.isFinite(windowOpacity) ? Math.min(1, Math.max(0.35, windowOpacity)) : 0.95;
    root.style.setProperty("--aether-window-opacity", String(Number(appOpacity.toFixed(2))));
    root.style.setProperty("--aether-window-veil-opacity", String(Number(((1 - appOpacity) * 0.72).toFixed(3))));
    const positionX =
      typeof wallpaper?.positionX === "number" && Number.isFinite(wallpaper.positionX) ? wallpaper.positionX : 50;
    const positionY =
      typeof wallpaper?.positionY === "number" && Number.isFinite(wallpaper.positionY) ? wallpaper.positionY : 50;
    const scale = typeof wallpaper?.scale === "number" && Number.isFinite(wallpaper.scale) ? wallpaper.scale : 100;
    root.style.setProperty("--aether-wallpaper-position-x", `${Math.min(100, Math.max(0, positionX))}%`);
    root.style.setProperty("--aether-wallpaper-position-y", `${Math.min(100, Math.max(0, positionY))}%`);
    root.style.setProperty("--aether-wallpaper-size", `${Math.min(300, Math.max(25, scale))}% auto`);
    root.dataset.theme = themeId;
    root.dataset.mood = mood;

    // Toggle light/dark class for components that need it
    root.classList.toggle("light-theme", light);
    root.classList.toggle("dark-theme", !light);

    // Persist
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
      localStorage.setItem(MOOD_STORAGE_KEY, mood);
    } catch {}
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
  ]);
}

export { loadMoodPresetId, loadThemeId };
