import { useEffect, useMemo } from "react";
import { getPalette, isLightTheme, themeToCSS, xtermTheme } from "../themes/catppuccin";

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
 * Call from App.tsx to keep the theme in sync.
 */
export function useThemeApplier(themeId: string) {
  useEffect(() => {
    const palette = getPalette(themeId);
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
  }, [themeId]);
}

/**
 * Returns the current xterm.js theme object, reactive to themeId changes.
 */
export function useXtermTheme(themeId: string) {
  return useMemo(() => {
    const palette = getPalette(themeId);
    const light = isLightTheme(themeId);
    return xtermTheme(palette, light);
  }, [themeId]);
}

export { loadThemeId };
