/**
 * Catppuccin color palettes + Aether custom theme.
 * Each palette maps semantic names to hex values.
 * Applied as CSS custom properties via useTheme hook.
 */

export interface ThemePalette {
  // Base colors
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  surface2: string;
  overlay0: string;
  overlay1: string;
  overlay2: string;
  text: string;
  subtext0: string;
  subtext1: string;

  // Accent colors
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  peach: string;
  mauve: string;
  pink: string;
  teal: string;
  sky: string;
  lavender: string;
  flamingo: string;
  rosewater: string;
  sapphire: string;
  maroon: string;
}

export const palettes: Record<string, ThemePalette> = {
  mocha: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    surface2: "#585b70",
    overlay0: "#6c7086",
    overlay1: "#7f849c",
    overlay2: "#9399b2",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    subtext1: "#bac2de",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    peach: "#fab387",
    mauve: "#cba6f7",
    pink: "#f5c2e7",
    teal: "#94e2d5",
    sky: "#89dceb",
    lavender: "#b4befe",
    flamingo: "#f2cdcd",
    rosewater: "#f5e0dc",
    sapphire: "#74c7ec",
    maroon: "#eba0ac",
  },
  frappe: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    surface2: "#626880",
    overlay0: "#737994",
    overlay1: "#838ba7",
    overlay2: "#949cbb",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    subtext1: "#b5bfe2",
    red: "#e78284",
    green: "#a6d189",
    yellow: "#e5c890",
    blue: "#8caaee",
    magenta: "#f4b8e4",
    cyan: "#81c8be",
    peach: "#ef9f76",
    mauve: "#ca9ee6",
    pink: "#f4b8e4",
    teal: "#81c8be",
    sky: "#99d1db",
    lavender: "#babbf1",
    flamingo: "#eebebe",
    rosewater: "#f2d5cf",
    sapphire: "#85c1dc",
    maroon: "#ea999c",
  },
  macchiato: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    surface2: "#5b6078",
    overlay0: "#6e738d",
    overlay1: "#8087a2",
    overlay2: "#939ab7",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    subtext1: "#b8c0e0",
    red: "#ed8796",
    green: "#a6da95",
    yellow: "#eed49f",
    blue: "#8aadf4",
    magenta: "#f5bde6",
    cyan: "#8bd5ca",
    peach: "#f5a97f",
    mauve: "#c6a0f6",
    pink: "#f5bde6",
    teal: "#8bd5ca",
    sky: "#91d7e3",
    lavender: "#b7bdf8",
    flamingo: "#f0c6c6",
    rosewater: "#f4dbd6",
    sapphire: "#7dc4e4",
    maroon: "#ee99a0",
  },
  latte: {
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
    surface0: "#ccd0da",
    surface1: "#bcc0cc",
    surface2: "#acb0be",
    overlay0: "#9ca0b0",
    overlay1: "#8c8fa1",
    overlay2: "#7c7f93",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    subtext1: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    peach: "#fe640b",
    mauve: "#8839ef",
    pink: "#ea76cb",
    teal: "#179299",
    sky: "#04a5e5",
    lavender: "#7287fd",
    flamingo: "#dd7878",
    rosewater: "#dc8a78",
    sapphire: "#209fb5",
    maroon: "#e64553",
  },
};

/** Theme IDs used in settings */
export type ThemeId =
  | "aether-dark"
  | "catppuccin-mocha"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-latte"
  | "tokyo-night"
  | "dracula";

/** Map theme setting ID to a catppuccin palette key */
export function getPalette(themeId: string): ThemePalette {
  switch (themeId) {
    case "catppuccin-frappe":
      return palettes.frappe;
    case "catppuccin-macchiato":
      return palettes.macchiato;
    case "catppuccin-latte":
      return palettes.latte;
    case "catppuccin-mocha":
    case "aether-dark":
    case "tokyo-night":
    case "dracula":
    default:
      // All dark themes default to mocha base for now
      return palettes.mocha;
  }
}

/** Whether the palette is a light theme */
export function isLightTheme(themeId: string): boolean {
  return themeId === "catppuccin-latte";
}

/** Subset of the palette that the user is allowed to override via the editor. */
export type AccentKey =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "peach"
  | "mauve"
  | "pink"
  | "teal"
  | "sky"
  | "lavender"
  | "flamingo"
  | "rosewater"
  | "sapphire"
  | "maroon";

/** Stable display order for the palette editor — accents that drive the
 * largest visible surfaces come first. */
export const ACCENT_KEYS: readonly AccentKey[] = [
  "sapphire",
  "mauve",
  "blue",
  "green",
  "yellow",
  "red",
  "peach",
  "cyan",
  "magenta",
  "pink",
  "teal",
  "sky",
  "lavender",
  "flamingo",
  "rosewater",
  "maroon",
] as const;

const ACCENT_KEY_SET = new Set<string>(ACCENT_KEYS);

/** Human-friendly label for the editor UI. */
export function accentLabel(key: AccentKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate a CSS-style hex color (`#abc` or `#aabbcc`). */
export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

/** Expand `#abc` → `#aabbcc`. Pass-through for already 6-digit input. */
export function normalizeHex(value: string): string {
  if (!isValidHex(value)) return value;
  if (value.length === 7) return value.toLowerCase();
  const r = value[1];
  const g = value[2];
  const b = value[3];
  return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

export type AccentOverrides = Partial<Record<AccentKey, string>>;

/**
 * Apply accent overrides on top of a base palette. Unknown keys and invalid
 * hex values are dropped — the base palette is the safe default. The base
 * input is treated as immutable; a fresh palette is returned.
 */
export function applyAccentOverrides(base: ThemePalette, overrides: AccentOverrides | undefined): ThemePalette {
  if (!overrides) return base;
  const next: ThemePalette = { ...base };
  let touched = false;
  for (const [key, value] of Object.entries(overrides)) {
    if (!ACCENT_KEY_SET.has(key)) continue;
    if (typeof value !== "string" || !isValidHex(value)) continue;
    next[key as AccentKey] = normalizeHex(value);
    touched = true;
  }
  return touched ? next : base;
}

/**
 * Generate CSS custom property overrides for a given palette.
 * Returns a Record<string, string> suitable for setting on document.documentElement.style.
 */
export function themeToCSS(palette: ThemePalette, light: boolean): Record<string, string> {
  const textAlpha = light ? "rgba(0, 0, 0," : "rgba(255, 255, 255,";
  return {
    // Backgrounds
    "--aether-bg": light ? palette.base : `${palette.crust}b3`,
    "--aether-bg-sidebar": light ? palette.mantle : `${palette.mantle}99`,
    "--aether-bg-elevated": light ? palette.surface0 : `${palette.base}bf`,
    "--aether-bg-card": light ? palette.surface0 : `${palette.surface0}d9`,
    "--aether-bg-surface": light ? palette.surface1 : `${palette.surface0}d9`,

    // Borders
    "--aether-border": light ? `${palette.surface2}80` : `rgba(255, 255, 255, 0.06)`,
    "--aether-border-strong": light ? palette.surface2 : `rgba(255, 255, 255, 0.1)`,

    // Text
    "--text-primary": light ? palette.text : `${textAlpha} 0.88)`,
    "--text-secondary": light ? palette.subtext0 : `${textAlpha} 0.5)`,
    "--text-muted": light ? palette.overlay0 : `${textAlpha} 0.3)`,

    // Catppuccin accent colors
    "--ctp-red": palette.red,
    "--ctp-green": palette.green,
    "--ctp-yellow": palette.yellow,
    "--ctp-blue": palette.blue,
    "--ctp-magenta": palette.magenta,
    "--ctp-cyan": palette.cyan,
    "--ctp-peach": palette.peach,
    "--ctp-mauve": palette.mauve,
    "--ctp-sky": palette.sky,

    // Status colors (derived from palette)
    "--status-idle": palette.green,
    "--status-edit": palette.yellow,
    "--status-thinking": palette.mauve,
    "--status-error": palette.red,
    "--status-done": palette.blue,

    // Accent
    "--accent": palette.sapphire,
    "--gold": light ? "#b08030" : "#c8a050",
    "--purple": palette.mauve,
    "--purple-text": palette.lavender,
  };
}

/**
 * Generate Monaco editor theme colors from the palette.
 */
export function monacoThemeColors(palette: ThemePalette, light: boolean) {
  return {
    "editor.background": light ? palette.base : palette.crust,
    "editor.foreground": light ? palette.text : "#D4D4D4",
    "editorLineNumber.foreground": light ? palette.overlay0 : palette.surface2,
    "editorLineNumber.activeForeground": light ? palette.text : palette.overlay2,
    "editor.selectionBackground": light ? `${palette.blue}40` : "#264F78",
    "editor.inactiveSelectionBackground": light ? `${palette.blue}20` : "#3A3D41",
    "editorGutter.background": light ? palette.base : palette.crust,
    "editorIndentGuide.background": light ? palette.surface1 : "#404040",
    "editorIndentGuide.activeBackground": light ? palette.surface2 : "#707070",
  };
}
