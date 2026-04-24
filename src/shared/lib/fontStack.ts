// Fallback must mirror --font-mono in global.css so Monaco keeps rendering
// the same glyphs when CSS custom properties aren't resolvable (SSR, test
// env without jsdom root styles, or the brief window before theme hydration).
const FALLBACK_MONO = "'IBM Plex Mono', 'Cascadia Code', monospace";

export function getMonoFontStack(): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return FALLBACK_MONO;
  }
  const resolved = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return resolved.length > 0 ? resolved : FALLBACK_MONO;
}
