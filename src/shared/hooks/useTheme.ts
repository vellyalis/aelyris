import { useEffect, useMemo } from "react";
import {
  type AccentOverrides,
  applyAccentOverrides,
  getPalette,
  isLightTheme,
  themeToCSS,
} from "../themes/catppuccin";

const STORAGE_KEY = "aether:theme";

function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "aether-dark";
  } catch {
    return "aether-dark";
  }
}

/**
 * Apply the given theme's CSS custom properties to :root.
 * Call from App.tsx to keep the theme in sync. Optional `overrides` layer
 * accent values from the in-app palette editor on top of the base palette.
 */
export function useThemeApplier(themeId: string, overrides?: AccentOverrides) {
  // Stabilise the override identity across renders so unchanged maps don't
  // re-trigger the effect (the editor calls setState on each keystroke).
  const overrideKey = overrides ? JSON.stringify(overrides) : "";
  const stableOverrides = useMemo(() => overrides, [overrideKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const base = getPalette(themeId);
    const palette = applyAccentOverrides(base, stableOverrides);
    const light = isLightTheme(themeId);
    const vars = themeToCSS(palette, light);

    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }

    // Toggle light/dark class for components that need it
    root.classList.toggle("light-theme", light);
    root.classList.toggle("dark-theme", !light);

    // Persist
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {}
  }, [themeId, stableOverrides]);
}

export { loadThemeId };
