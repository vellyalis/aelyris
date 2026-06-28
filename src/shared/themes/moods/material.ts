import { isValidHex, normalizeHex } from "../catppuccin";
import type { MoodPresetId } from "./registry";

export type MoodMaterialDefaults = {
  backdropColor: string;
  panelColor: string;
  chromeColor: string;
  terminalColor: string;
  backdropAlpha: number;
  panelAlpha: number;
  chromeAlpha: number;
  terminalAlpha: number;
};

export const SAKURA_MATERIAL_DEFAULTS: MoodMaterialDefaults = {
  backdropColor: "#fff8fc",
  panelColor: "#fff1f8",
  chromeColor: "#ffeef7",
  terminalColor: "#532138",
  backdropAlpha: 0.08,
  panelAlpha: 0.88,
  chromeAlpha: 0.84,
  terminalAlpha: 0.54,
};

export const MOOD_MATERIAL_DEFAULTS: Record<MoodPresetId, MoodMaterialDefaults> = {
  "aether-sky": {
    backdropColor: "#020812",
    panelColor: "#061424",
    chromeColor: "#020812",
    terminalColor: "#020814",
    backdropAlpha: 0.04,
    panelAlpha: 0.42,
    chromeAlpha: 0.38,
    terminalAlpha: 0.48,
  },
  "aether-moonwater": {
    backdropColor: "#00112a",
    panelColor: "#021930",
    chromeColor: "#00102a",
    terminalColor: "#000612",
    backdropAlpha: 0.05,
    panelAlpha: 0.42,
    chromeAlpha: 0.38,
    terminalAlpha: 0.5,
  },
  "aether-crystal": {
    backdropColor: "#020914",
    panelColor: "#041827",
    chromeColor: "#03101d",
    terminalColor: "#020814",
    backdropAlpha: 0.03,
    panelAlpha: 0.3,
    chromeAlpha: 0.28,
    terminalAlpha: 0.36,
  },
  "aether-dream": {
    backdropColor: "#120d20",
    panelColor: "#221932",
    chromeColor: "#10091e",
    terminalColor: "#120e1d",
    backdropAlpha: 0.05,
    panelAlpha: 0.44,
    chromeAlpha: 0.4,
    terminalAlpha: 0.48,
  },
  "aether-cute": {
    backdropColor: "#071916",
    panelColor: "#12302c",
    chromeColor: "#031313",
    terminalColor: "#0a1a19",
    backdropAlpha: 0.05,
    panelAlpha: 0.44,
    chromeAlpha: 0.4,
    terminalAlpha: 0.48,
  },
  "aether-sakura": SAKURA_MATERIAL_DEFAULTS,
  "aether-obsidian": {
    backdropColor: "#090b13",
    panelColor: "#1b1920",
    chromeColor: "#111017",
    terminalColor: "#0a0b12",
    backdropAlpha: 0.04,
    panelAlpha: 0.46,
    chromeAlpha: 0.42,
    terminalAlpha: 0.52,
  },
  "aether-pro": {
    backdropColor: "#040d17",
    panelColor: "#05121f",
    chromeColor: "#030a12",
    terminalColor: "#040d17",
    backdropAlpha: 0.04,
    panelAlpha: 0.42,
    chromeAlpha: 0.38,
    terminalAlpha: 0.48,
  },
};

export type SakuraMaterialColorKey = "backdropColor" | "panelColor" | "chromeColor" | "terminalColor";
export type SakuraMaterialAlphaKey = "backdropAlpha" | "panelAlpha" | "chromeAlpha" | "terminalAlpha";
export type SakuraMaterialKey = SakuraMaterialColorKey | SakuraMaterialAlphaKey;
export type SakuraMaterialOverrides = Partial<Record<SakuraMaterialColorKey, string>> &
  Partial<Record<SakuraMaterialAlphaKey, number>>;
export type MoodMaterialColorKey = SakuraMaterialColorKey;
export type MoodMaterialAlphaKey = SakuraMaterialAlphaKey;
export type MoodMaterialKey = SakuraMaterialKey;
export type MoodMaterialOverrides = SakuraMaterialOverrides;

export const SAKURA_MATERIAL_COLOR_KEYS: readonly SakuraMaterialColorKey[] = [
  "backdropColor",
  "panelColor",
  "chromeColor",
  "terminalColor",
] as const;

export const SAKURA_MATERIAL_ALPHA_KEYS: readonly SakuraMaterialAlphaKey[] = [
  "backdropAlpha",
  "panelAlpha",
  "chromeAlpha",
  "terminalAlpha",
] as const;

const SAKURA_ALPHA_RANGES: Record<SakuraMaterialAlphaKey, { min: number; max: number }> = {
  backdropAlpha: { min: 0, max: 0.85 },
  panelAlpha: { min: 0.15, max: 1 },
  chromeAlpha: { min: 0.15, max: 1 },
  terminalAlpha: { min: 0.05, max: 0.9 },
};

export const SAKURA_MATERIAL_CSS_KEYS = [
  "--sakura-root-rgb",
  "--sakura-root-alpha",
  "--panel-text-scrim",
  "--chrome-frame-bg",
  "--statusbar-bg",
  "--dialog-surface",
  "--settings-control-bg",
  "--settings-card-bg",
  "--settings-card-bg-hover",
  "--settings-card-bg-active",
  "--toolkit-grid-bg",
  "--toolkit-tile-bg",
  "--toolkit-tile-primary-bg",
  "--toolkit-tile-hover-bg",
  "--toolkit-bottom-bg",
  "--toolkit-bottom-btn-bg",
  "--glass-clear",
  "--glass-ground",
  "--glass-frame",
  "--glass-standard",
  "--glass-dense",
  "--glass-thick",
  "--glass-solid",
  "--mood-root-glow",
  "--mood-left-panel-bg",
  "--mood-center-panel-bg",
  "--mood-right-panel-bg",
  "--mood-widget-bg",
  "--mood-sessions-widget-bg",
  "--mood-workflow-widget-bg",
  "--mood-toolkit-widget-bg",
  "--mood-logs-widget-bg",
  "--terminal-canvas-bg",
  "--terminal-raster-bg",
  "--terminal-well-bg",
  "--terminal-chrome-bg",
  "--terminal-chrome-bg-focus",
] as const;

/**
 * Per-tier minimum glass alpha applied by applyReadableDarkGlassFloor so dark
 * moods never become unreadably transparent. Hoisted to a single named place;
 * the values are unchanged from the previous inline literals.
 */
export const GLASS_TIER_ALPHA_FLOOR = {
  ground: 0.09,
  frame: 0.08,
  standard: 0.12,
  dense: 0.15,
  thick: 0.18,
} as const;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampAlpha(value: number, min = 0, max = 1): number {
  return Number(clampNumber(value, min, max).toFixed(2));
}

export function sanitizeMaterialOverrides(
  value: unknown,
  defaults: typeof SAKURA_MATERIAL_DEFAULTS = SAKURA_MATERIAL_DEFAULTS,
): MoodMaterialOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const next: MoodMaterialOverrides = {};

  for (const key of SAKURA_MATERIAL_COLOR_KEYS) {
    const color = raw[key];
    if (typeof color === "string" && isValidHex(color)) {
      const normalized = normalizeHex(color);
      if (normalized !== defaults[key]) next[key] = normalized;
    }
  }

  for (const key of SAKURA_MATERIAL_ALPHA_KEYS) {
    const alpha = raw[key];
    if (typeof alpha !== "number" || !Number.isFinite(alpha)) continue;
    const range = SAKURA_ALPHA_RANGES[key];
    const clamped = Number(clampNumber(alpha, range.min, range.max).toFixed(2));
    if (clamped !== defaults[key]) next[key] = clamped;
  }

  return next;
}

export function sanitizeSakuraMaterialOverrides(value: unknown): SakuraMaterialOverrides {
  return sanitizeMaterialOverrides(value, SAKURA_MATERIAL_DEFAULTS);
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

export function rgbString(hex: string): string {
  return hexToRgbTuple(hex).join(", ");
}

export function rgba(hex: string, alpha: number): string {
  return `rgba(${rgbString(hex)}, ${alpha})`;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgbTuple(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isMoodMaterialLight(mood: MoodPresetId, overrides?: MoodMaterialOverrides): boolean {
  const defaults = MOOD_MATERIAL_DEFAULTS[mood];
  const clean = sanitizeMaterialOverrides(overrides, defaults);
  const panel = clean.panelColor ?? defaults.panelColor;
  const chrome = clean.chromeColor ?? defaults.chromeColor;
  const panelAlpha = clean.panelAlpha ?? defaults.panelAlpha;
  const chromeAlpha = clean.chromeAlpha ?? defaults.chromeAlpha;
  if (panelAlpha < 0.5 && chromeAlpha < 0.5) return false;
  const weightedLuminance = relativeLuminance(panel) * panelAlpha + relativeLuminance(chrome) * chromeAlpha;
  return weightedLuminance >= 0.78;
}

export function materialOverridesToCSS(
  overrides?: MoodMaterialOverrides,
  defaults: typeof SAKURA_MATERIAL_DEFAULTS = SAKURA_MATERIAL_DEFAULTS,
): Record<string, string> {
  const clean = sanitizeMaterialOverrides(overrides, defaults);
  if (Object.keys(clean).length === 0) return {};

  const backdrop = clean.backdropColor ?? defaults.backdropColor;
  const panel = clean.panelColor ?? defaults.panelColor;
  const chrome = clean.chromeColor ?? defaults.chromeColor;
  const terminal = clean.terminalColor ?? defaults.terminalColor;
  const backdropAlpha = clean.backdropAlpha ?? defaults.backdropAlpha;
  const panelAlpha = clean.panelAlpha ?? defaults.panelAlpha;
  const chromeAlpha = clean.chromeAlpha ?? defaults.chromeAlpha;
  const terminalAlpha = clean.terminalAlpha ?? defaults.terminalAlpha;
  const panelSoftAlpha = clampAlpha(panelAlpha - 0.08, 0.08, 0.98);
  const panelStrongAlpha = clampAlpha(panelAlpha + 0.04, 0.12, 1);
  const backdropRgb = rgbString(backdrop);
  const chromeRgb = rgbString(chrome);
  const panelRgb = rgbString(panel);
  const terminalRgb = rgbString(terminal);
  const softLight = `rgba(${backdropRgb}, ${clampAlpha(panelAlpha - 0.42, 0.03, 0.46)})`;
  const softAccent = `rgba(${chromeRgb}, ${clampAlpha(chromeAlpha - 0.74, 0.02, 0.14)})`;
  const usesLightChrome = relativeLuminance(panel) > 0.48 && panelAlpha >= 0.5;
  const textPrimary = usesLightChrome ? "#24121b" : "#f6fbff";
  const textSecondary = usesLightChrome ? "#3f2430" : "#cfe6f6";
  const textMuted = usesLightChrome ? "#674353" : "#a7c0d3";
  // Text-dense panel legibility scrim must follow the custom material's
  // brightness: a pale (light-chrome) panel needs a WHITE wash to lift its
  // dark ink, while a custom dark panel keeps the dark wash. Otherwise a dark
  // scrim from the base preset would darken a user's light material and
  // regress the very contrast it is meant to protect.
  const panelTextScrim = usesLightChrome
    ? "linear-gradient(180deg, rgba(255, 252, 254, 0.4), rgba(255, 250, 253, 0.32) 70%, rgba(255, 252, 254, 0.4))"
    : "linear-gradient(180deg, rgba(3, 9, 16, 0.42), rgba(3, 9, 16, 0.34) 70%, rgba(3, 9, 16, 0.42))";
  // Thin top/bottom chrome (header / tabs / status / mode-rail) needs the same
  // legibility wash as the panels — and it must follow the custom material's
  // brightness so a light material is lifted (white wash) and a dark material is
  // anchored (dark wash), never the reverse. Composed INTO chrome-frame-bg and
  // statusbar-bg below; the chromeAlpha-bearing rgba is kept underneath so the
  // user's chosen chrome density still reads through.
  const chromeScrim = usesLightChrome
    ? "linear-gradient(180deg, rgba(255, 252, 254, 0.46), rgba(255, 250, 253, 0.4) 60%, rgba(255, 252, 254, 0.5))"
    : "linear-gradient(180deg, rgba(3, 9, 16, 0.46), rgba(3, 9, 16, 0.4) 60%, rgba(3, 9, 16, 0.5))";
  const statusbarScrim = usesLightChrome
    ? "linear-gradient(180deg, rgba(255, 252, 254, 0.5), rgba(255, 250, 253, 0.56))"
    : "linear-gradient(180deg, rgba(3, 9, 16, 0.5), rgba(3, 9, 16, 0.56))";

  return {
    "--chrome-legibility-scrim": chromeScrim,
    "--statusbar-legibility-scrim": statusbarScrim,
    "--sakura-root-rgb": backdropRgb,
    "--sakura-root-alpha": String(backdropAlpha),
    "--text-primary": textPrimary,
    "--text-secondary": textSecondary,
    "--text-muted": textMuted,
    "--panel-text-scrim": panelTextScrim,
    "--chrome-frame-bg": `linear-gradient(180deg, ${softLight}, transparent 72%), linear-gradient(90deg, ${softAccent}, transparent 34%, transparent 66%, rgba(${panelRgb}, 0.06)), ${chromeScrim}, ${rgba(chrome, chromeAlpha)}`,
    "--statusbar-bg": `${statusbarScrim}, ${rgba(chrome, chromeAlpha)}`,
    "--dialog-surface": `linear-gradient(180deg, ${softLight}, transparent 32%), linear-gradient(145deg, rgba(${panelRgb}, 0.1), transparent 50%), ${rgba(backdrop, clampAlpha(panelAlpha, 0.08, 0.96))}`,
    "--settings-control-bg": rgba(backdrop, clampAlpha(panelAlpha - 0.04, 0.06, 0.96)),
    "--settings-card-bg": rgba(panel, panelSoftAlpha),
    "--settings-card-bg-hover": rgba(panel, panelAlpha),
    "--settings-card-bg-active": rgba(panel, panelStrongAlpha),
    "--toolkit-grid-bg": `linear-gradient(135deg, ${softAccent}, transparent 38%, rgba(${panelRgb}, 0.09)), ${rgba(panel, panelSoftAlpha)}`,
    "--toolkit-tile-bg": `linear-gradient(180deg, ${softLight}, rgba(${panelRgb}, 0.08)), ${rgba(backdrop, panelAlpha)}`,
    "--toolkit-tile-primary-bg": `linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 46%), ${rgba(panel, panelAlpha)}`,
    "--toolkit-tile-hover-bg": `linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 58%), ${rgba(panel, panelStrongAlpha)}`,
    "--toolkit-tile-text": textPrimary,
    "--toolkit-bottom-bg": `linear-gradient(90deg, ${softAccent}, transparent 52%, rgba(${panelRgb}, 0.07)), ${rgba(panel, panelSoftAlpha)}`,
    "--toolkit-bottom-btn-bg": rgba(backdrop, panelAlpha),
    "--glass-clear": rgba(backdrop, Math.min(0.18, backdropAlpha + 0.02)),
    "--glass-ground": rgba(panel, clampAlpha(panelAlpha - 0.3, 0.08, 0.86)),
    "--glass-frame": rgba(panel, clampAlpha(panelAlpha - 0.32, 0.08, 0.86)),
    "--glass-standard": rgba(panel, clampAlpha(panelAlpha - 0.18, 0.12, 0.9)),
    "--glass-dense": rgba(panel, clampAlpha(panelAlpha - 0.1, 0.18, 0.94)),
    "--glass-thick": rgba(panel, clampAlpha(panelAlpha - 0.04, 0.24, 0.98)),
    "--glass-solid": rgba(backdrop, clampAlpha(panelAlpha, 0.32, 1)),
    "--mood-root-glow": `linear-gradient(125deg, rgba(${panelRgb}, ${Math.min(0.16, backdropAlpha + 0.03)}), transparent 35%), linear-gradient(300deg, rgba(${chromeRgb}, ${Math.min(0.08, backdropAlpha)}), transparent 42%), linear-gradient(180deg, rgba(${backdropRgb}, ${backdropAlpha}), rgba(${panelRgb}, ${Math.max(0.02, backdropAlpha / 2)}))`,
    "--mood-left-panel-bg": `linear-gradient(180deg, ${softLight}, transparent 30%), linear-gradient(135deg, rgba(${panelRgb}, 0.14), rgba(${backdropRgb}, 0.16)), ${rgba(panel, panelAlpha)}`,
    "--mood-center-panel-bg": `radial-gradient(ellipse at 50% 0%, rgba(${chromeRgb}, 0.05), transparent 44%), linear-gradient(180deg, rgba(${backdropRgb}, ${Math.min(0.12, backdropAlpha + 0.02)}), rgba(${panelRgb}, ${Math.min(0.08, backdropAlpha)})), ${rgba(backdrop, backdropAlpha)}`,
    "--mood-right-panel-bg": `linear-gradient(180deg, ${softLight}, transparent 26%), linear-gradient(145deg, rgba(${panelRgb}, 0.14), rgba(${backdropRgb}, 0.17)), ${rgba(panel, panelStrongAlpha)}`,
    "--mood-widget-bg": `linear-gradient(160deg, ${softLight}, rgba(${backdropRgb}, 0.16)), rgba(${panelRgb}, ${panelAlpha})`,
    "--mood-sessions-widget-bg": `linear-gradient(160deg, ${softLight}, rgba(${backdropRgb}, 0.14)), rgba(${panelRgb}, ${panelSoftAlpha})`,
    "--mood-workflow-widget-bg": `linear-gradient(180deg, ${softLight}, rgba(${backdropRgb}, 0.14)), rgba(${panelRgb}, ${panelSoftAlpha})`,
    "--mood-toolkit-widget-bg": `linear-gradient(150deg, ${softLight}, rgba(${backdropRgb}, 0.14)), rgba(${panelRgb}, ${panelSoftAlpha})`,
    "--mood-logs-widget-bg": `linear-gradient(180deg, ${softLight}, rgba(${backdropRgb}, 0.12)), rgba(${panelRgb}, ${clampAlpha(panelSoftAlpha - 0.04, 0.12, 0.95)})`,
    "--terminal-canvas-bg": `rgba(${terminalRgb}, ${terminalAlpha})`,
    "--terminal-raster-bg": `rgba(${terminalRgb}, ${clampAlpha(terminalAlpha + 0.22, 0.28, 0.9)})`,
    "--terminal-well-bg": `radial-gradient(ellipse at 44% -18%, rgba(${panelRgb}, 0.18), transparent 46%), radial-gradient(ellipse at 78% 18%, rgba(${chromeRgb}, 0.1), transparent 38%), linear-gradient(180deg, rgba(${terminalRgb}, ${Math.min(0.68, terminalAlpha + 0.06)}), rgba(${terminalRgb}, ${Math.min(0.72, terminalAlpha + 0.08)}))`,
    "--terminal-chrome-bg": `rgba(${terminalRgb}, ${Math.min(0.7, terminalAlpha + 0.04)})`,
    "--terminal-chrome-bg-focus": `rgba(${terminalRgb}, ${Math.min(0.78, terminalAlpha + 0.12)})`,
  };
}

export function sakuraMaterialOverridesToCSS(overrides?: SakuraMaterialOverrides): Record<string, string> {
  return materialOverridesToCSS(overrides, SAKURA_MATERIAL_DEFAULTS);
}

export function withMinimumAlpha(value: string | undefined, minimum: number): string | undefined {
  if (!value) return value;
  return value.replace(
    /rgba\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d*\.?\d+)\)/,
    (_match, r, g, b, alpha) => `rgba(${r}, ${g}, ${b}, ${Math.max(Number(alpha), minimum)})`,
  );
}

export function applyReadableDarkGlassFloor(mood: MoodPresetId, vars: Record<string, string>): Record<string, string> {
  if (mood === "aether-sakura" || mood === "aether-crystal") return vars;
  return {
    ...vars,
    "--glass-ground": withMinimumAlpha(vars["--glass-ground"], GLASS_TIER_ALPHA_FLOOR.ground) ?? vars["--glass-ground"],
    "--glass-frame": withMinimumAlpha(vars["--glass-frame"], GLASS_TIER_ALPHA_FLOOR.frame) ?? vars["--glass-frame"],
    "--glass-standard":
      withMinimumAlpha(vars["--glass-standard"], GLASS_TIER_ALPHA_FLOOR.standard) ?? vars["--glass-standard"],
    "--glass-dense": withMinimumAlpha(vars["--glass-dense"], GLASS_TIER_ALPHA_FLOOR.dense) ?? vars["--glass-dense"],
    "--glass-thick": withMinimumAlpha(vars["--glass-thick"], GLASS_TIER_ALPHA_FLOOR.thick) ?? vars["--glass-thick"],
  };
}
