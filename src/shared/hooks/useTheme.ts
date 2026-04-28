import { useEffect, useMemo } from "react";
import {
  type AccentOverrides,
  applyAccentOverrides,
  getPalette,
  isLightTheme,
  themeToCSS,
} from "../themes/catppuccin";
import {
  DEFAULT_MOOD_PRESET,
  moodPresetToCSS,
  normalizeMoodPreset,
  type MoodPresetId,
} from "../themes/moods";

const STORAGE_KEY = "aether:theme";
const MOOD_STORAGE_KEY = "aether:moodPreset";

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
) {
  // Stabilise the override identity across renders so unchanged maps don't
  // re-trigger the effect (the editor calls setState on each keystroke).
  const overrideKey = overrides ? JSON.stringify(overrides) : "";
  const stableOverrides = useMemo(() => overrides, [overrideKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const mood = normalizeMoodPreset(moodPresetId);
  const themeKey = `${themeId}:${mood}`;

  useEffect(() => {
    const base = getPalette(themeId);
    const palette = applyAccentOverrides(base, stableOverrides);
    const light = isLightTheme(themeId);
    const vars = {
      ...themeToCSS(palette, light),
      ...moodPresetToCSS(mood),
    };

    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
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
  }, [themeKey, stableOverrides]); // eslint-disable-line react-hooks/exhaustive-deps
}

export { loadMoodPresetId, loadThemeId };
