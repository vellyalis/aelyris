import { DEFAULT_BG } from "../lib/ansiPalette";
import { isValidHex, normalizeHex } from "./catppuccin";

export type MoodPresetId =
  | "aether-sky"
  | "aether-moonwater"
  | "aether-crystal"
  | "aether-dream"
  | "aether-cute"
  | "aether-sakura"
  | "aether-obsidian"
  | "aether-pro";

export interface MoodPreset {
  id: MoodPresetId;
  label: string;
  tone: string;
}

export const DEFAULT_MOOD_PRESET: MoodPresetId = "aether-sky";

export const MOOD_PRESETS: readonly MoodPreset[] = [
  { id: "aether-sky", label: "Aether Sky", tone: "Airy blue glass" },
  { id: "aether-moonwater", label: "Aether Moonwater", tone: "Moonlit cyan tide" },
  { id: "aether-crystal", label: "Aether Crystal", tone: "Clear cinematic glass" },
  { id: "aether-dream", label: "Aether Dream", tone: "Soft lavender aurora" },
  { id: "aether-cute", label: "Aether Cute", tone: "Clear mint and rose" },
  { id: "aether-sakura", label: "Aether Sakura", tone: "Cherry blossom glass" },
  { id: "aether-obsidian", label: "Aether Obsidian", tone: "Midnight gold cockpit" },
  { id: "aether-pro", label: "Aether Pro", tone: "Quiet graphite focus" },
] as const;

const MOOD_SET = new Set<string>(MOOD_PRESETS.map((preset) => preset.id));

export function normalizeMoodPreset(value: string | null | undefined): MoodPresetId {
  return value && MOOD_SET.has(value) ? (value as MoodPresetId) : DEFAULT_MOOD_PRESET;
}

type MoodMaterialDefaults = {
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

const SAKURA_MATERIAL_CSS_KEYS = [
  "--sakura-root-rgb",
  "--sakura-root-alpha",
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampAlpha(value: number, min = 0, max = 1): number {
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

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbString(hex: string): string {
  return hexToRgbTuple(hex).join(", ");
}

function rgba(hex: string, alpha: number): string {
  return `rgba(${rgbString(hex)}, ${alpha})`;
}

function relativeLuminance(hex: string): number {
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

  return {
    "--sakura-root-rgb": backdropRgb,
    "--sakura-root-alpha": String(backdropAlpha),
    "--text-primary": textPrimary,
    "--text-secondary": textSecondary,
    "--text-muted": textMuted,
    "--chrome-frame-bg": `linear-gradient(180deg, ${softLight}, transparent 72%), linear-gradient(90deg, ${softAccent}, transparent 34%, transparent 66%, rgba(${panelRgb}, 0.06)), ${rgba(chrome, chromeAlpha)}`,
    "--statusbar-bg": rgba(chrome, chromeAlpha),
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
    "--terminal-raster-bg": `rgba(${terminalRgb}, ${clampAlpha(terminalAlpha + 0.34, 0.82, 0.96)})`,
    "--terminal-well-bg": `radial-gradient(ellipse at 44% -18%, rgba(${panelRgb}, 0.18), transparent 46%), radial-gradient(ellipse at 78% 18%, rgba(${chromeRgb}, 0.1), transparent 38%), linear-gradient(180deg, rgba(${terminalRgb}, ${Math.min(0.68, terminalAlpha + 0.06)}), rgba(${terminalRgb}, ${Math.min(0.72, terminalAlpha + 0.08)}))`,
    "--terminal-chrome-bg": `rgba(${terminalRgb}, ${Math.min(0.7, terminalAlpha + 0.04)})`,
    "--terminal-chrome-bg-focus": `rgba(${terminalRgb}, ${Math.min(0.78, terminalAlpha + 0.12)})`,
  };
}

export function sakuraMaterialOverridesToCSS(overrides?: SakuraMaterialOverrides): Record<string, string> {
  return materialOverridesToCSS(overrides, SAKURA_MATERIAL_DEFAULTS);
}

function withMinimumAlpha(value: string | undefined, minimum: number): string | undefined {
  if (!value) return value;
  return value.replace(
    /rgba\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d*\.?\d+)\)/,
    (_match, r, g, b, alpha) => `rgba(${r}, ${g}, ${b}, ${Math.max(Number(alpha), minimum)})`,
  );
}

function applyReadableDarkGlassFloor(mood: MoodPresetId, vars: Record<string, string>): Record<string, string> {
  if (mood === "aether-sakura" || mood === "aether-crystal") return vars;
  return {
    ...vars,
    "--glass-ground": withMinimumAlpha(vars["--glass-ground"], 0.32) ?? vars["--glass-ground"],
    "--glass-frame": withMinimumAlpha(vars["--glass-frame"], 0.26) ?? vars["--glass-frame"],
    "--glass-standard": withMinimumAlpha(vars["--glass-standard"], 0.34) ?? vars["--glass-standard"],
    "--glass-dense": withMinimumAlpha(vars["--glass-dense"], 0.42) ?? vars["--glass-dense"],
    "--glass-thick": withMinimumAlpha(vars["--glass-thick"], 0.48) ?? vars["--glass-thick"],
  };
}

export function moodPresetToCSS(value: string | null | undefined): Record<string, string> {
  const mood = normalizeMoodPreset(value);
  return applyReadableDarkGlassFloor(mood, {
    ...MOOD_CSS[mood],
    ...MOOD_SURFACE_CSS[mood],
  });
}

export const MOOD_SURFACE_CSS_KEYS = [
  "--chrome-frame-bg",
  "--chrome-frame-filter",
  "--chrome-frame-shadow",
  "--chrome-control-hover-bg",
  "--chrome-control-hover-border",
  "--chrome-separator-bg",
  "--statusbar-bg",
  "--statusbar-filter",
  "--statusbar-shadow",
  "--material-panel-filter",
  "--terminal-shell-filter",
  "--material-panel-shadow",
  "--material-card-shadow",
  "--popup-glass-bg",
  "--popup-glass-border",
  "--popup-glass-shadow",
  "--scrim-standard-bg",
  "--scrim-heavy-bg",
  "--dialog-surface",
  "--dialog-surface-blur",
  "--settings-control-bg",
  "--settings-card-bg",
  "--settings-card-bg-hover",
  "--settings-card-bg-active",
  "--toolkit-grid-bg",
  "--toolkit-grid-shadow",
  "--toolkit-tile-bg",
  "--toolkit-tile-primary-bg",
  "--toolkit-tile-hover-bg",
  "--toolkit-tile-text",
  "--toolkit-icon-bg",
  "--toolkit-bottom-bg",
  "--toolkit-bottom-btn-bg",
] as const;

type MoodSurfaceKey = (typeof MOOD_SURFACE_CSS_KEYS)[number];
type MoodSurfaceCSS = Record<MoodSurfaceKey, string>;

function darkMoodSurfaces(tone: {
  shell: string;
  panel: string;
  panelStrong: string;
  accent: string;
  gold: string;
  text: string;
}): MoodSurfaceCSS {
  return {
    "--chrome-frame-bg": `linear-gradient(180deg, rgba(${tone.accent}, 0.026), transparent 72%), linear-gradient(90deg, rgba(${tone.accent}, 0.022), transparent 36%, transparent 66%, rgba(${tone.gold}, 0.012)), rgba(${tone.shell}, 0.42)`,
    "--chrome-frame-filter": "blur(14px) saturate(1.12) brightness(0.82) contrast(1.1)",
    "--chrome-frame-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.08), inset 0 -1px 0 rgba(${tone.accent}, 0.08)`,
    "--chrome-control-hover-bg": `rgba(${tone.accent}, 0.095)`,
    "--chrome-control-hover-border": `rgba(${tone.accent}, 0.16)`,
    "--chrome-separator-bg": `linear-gradient(180deg, transparent, rgba(${tone.accent}, 0.18), transparent)`,
    "--statusbar-bg": `rgba(${tone.shell}, 0.4)`,
    "--statusbar-filter": "blur(14px) saturate(1.12) brightness(0.82) contrast(1.08)",
    "--statusbar-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.055), inset 0 -1px 0 rgba(${tone.accent}, 0.07)`,
    "--material-panel-filter": "blur(16px) saturate(1.14) brightness(0.8) contrast(1.08)",
    "--terminal-shell-filter": "blur(16px) saturate(1.14) brightness(0.82) contrast(1.08)",
    "--material-panel-shadow": `var(--rim-top), inset 0 0 0 1px rgba(${tone.accent}, 0.055), 0 12px 30px rgba(0, 0, 0, 0.2)`,
    "--material-card-shadow": `var(--rim-top), 0 0 0 1px rgba(${tone.accent}, 0.05), 0 8px 20px rgba(0, 0, 0, 0.18)`,
    "--popup-glass-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.045), transparent 40%), linear-gradient(145deg, rgba(${tone.accent}, 0.04), transparent 52%), rgba(${tone.panelStrong}, 0.7)`,
    "--popup-glass-border": `rgba(${tone.accent}, 0.14)`,
    "--popup-glass-shadow": `var(--rim-top), inset 0 0 0 1px rgba(${tone.accent}, 0.055), 0 16px 38px rgba(0, 0, 0, 0.26)`,
    "--scrim-standard-bg": `linear-gradient(180deg, rgba(0, 0, 0, 0.34), rgba(${tone.shell}, 0.46)), rgba(${tone.shell}, 0.2)`,
    "--scrim-heavy-bg": `linear-gradient(180deg, rgba(0, 0, 0, 0.42), rgba(${tone.shell}, 0.58)), rgba(${tone.shell}, 0.28)`,
    "--dialog-surface": `linear-gradient(180deg, rgba(${tone.text}, 0.045), transparent 32%), linear-gradient(145deg, rgba(${tone.accent}, 0.045), transparent 50%), rgba(${tone.panelStrong}, 0.78)`,
    "--dialog-surface-blur": "blur(20px)",
    "--settings-control-bg": `rgba(${tone.panel}, 0.54)`,
    "--settings-card-bg": `rgba(${tone.panel}, 0.44)`,
    "--settings-card-bg-hover": `rgba(${tone.panelStrong}, 0.54)`,
    "--settings-card-bg-active": `rgba(${tone.panelStrong}, 0.62)`,
    "--toolkit-grid-bg": `linear-gradient(135deg, rgba(${tone.accent}, 0.075), transparent 38%, rgba(${tone.gold}, 0.04)), rgba(${tone.panel}, 0.32)`,
    "--toolkit-grid-shadow": `inset 0 1px 0 rgba(${tone.text}, 0.055), inset 0 -1px 0 rgba(${tone.accent}, 0.06)`,
    "--toolkit-tile-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.035), rgba(${tone.accent}, 0.022)), rgba(${tone.panel}, 0.42)`,
    "--toolkit-tile-primary-bg": `linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 14%, transparent), transparent 46%), rgba(${tone.panelStrong}, 0.48)`,
    "--toolkit-tile-hover-bg": `linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 12%, transparent), transparent 58%), rgba(${tone.panelStrong}, 0.56)`,
    "--toolkit-tile-text": "var(--text-primary)",
    "--toolkit-icon-bg": `linear-gradient(180deg, rgba(${tone.text}, 0.055), rgba(${tone.accent}, 0.035)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(${tone.panelStrong}, 0.52))`,
    "--toolkit-bottom-bg": `linear-gradient(90deg, rgba(${tone.accent}, 0.07), transparent 52%, rgba(${tone.gold}, 0.045)), rgba(${tone.panel}, 0.34)`,
    "--toolkit-bottom-btn-bg": `rgba(${tone.panelStrong}, 0.46)`,
  };
}

function crystalMoodSurfaces(): MoodSurfaceCSS {
  return {
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(225, 247, 255, 0.052), transparent 70%), linear-gradient(90deg, rgba(139, 233, 255, 0.04), transparent 34%, transparent 66%, rgba(216, 247, 255, 0.025)), rgba(2, 10, 20, 0.24)",
    "--chrome-frame-filter": "blur(22px) saturate(1.28) brightness(0.9) contrast(1.08)",
    "--chrome-frame-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.11), inset 0 -1px 0 rgba(139, 233, 255, 0.08)",
    "--chrome-control-hover-bg": "rgba(139, 233, 255, 0.1)",
    "--chrome-control-hover-border": "rgba(139, 233, 255, 0.16)",
    "--chrome-separator-bg": "linear-gradient(180deg, transparent, rgba(139, 233, 255, 0.18), transparent)",
    "--statusbar-bg": "rgba(2, 10, 20, 0.24)",
    "--statusbar-filter": "blur(22px) saturate(1.24) brightness(0.9) contrast(1.08)",
    "--statusbar-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.075), inset 0 -1px 0 rgba(139, 233, 255, 0.06)",
    "--material-panel-filter": "blur(24px) saturate(1.3) brightness(0.88) contrast(1.08)",
    "--terminal-shell-filter": "blur(22px) saturate(1.24) brightness(0.86) contrast(1.08)",
    "--material-panel-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(139, 233, 255, 0.052), 0 16px 38px rgba(0, 0, 0, 0.16)",
    "--material-card-shadow": "var(--rim-top), 0 0 0 1px rgba(139, 233, 255, 0.055), 0 10px 26px rgba(0, 0, 0, 0.14)",
    "--popup-glass-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.055), transparent 40%), linear-gradient(145deg, rgba(139, 233, 255, 0.045), transparent 52%), rgba(4, 18, 31, 0.5)",
    "--popup-glass-border": "rgba(139, 233, 255, 0.14)",
    "--popup-glass-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(139, 233, 255, 0.06), 0 18px 42px rgba(0, 0, 0, 0.22)",
    "--scrim-standard-bg": "linear-gradient(180deg, rgba(0, 0, 0, 0.3), rgba(2, 10, 20, 0.38)), rgba(2, 10, 20, 0.14)",
    "--scrim-heavy-bg": "linear-gradient(180deg, rgba(0, 0, 0, 0.38), rgba(2, 10, 20, 0.5)), rgba(2, 10, 20, 0.22)",
    "--dialog-surface":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.052), transparent 32%), linear-gradient(145deg, rgba(139, 233, 255, 0.05), transparent 50%), rgba(5, 22, 36, 0.54)",
    "--dialog-surface-blur": "blur(26px)",
    "--settings-control-bg": "rgba(4, 18, 31, 0.36)",
    "--settings-card-bg": "rgba(4, 20, 34, 0.28)",
    "--settings-card-bg-hover": "rgba(6, 28, 45, 0.38)",
    "--settings-card-bg-active": "rgba(7, 34, 54, 0.46)",
    "--toolkit-grid-bg":
      "linear-gradient(135deg, rgba(139, 233, 255, 0.07), transparent 38%, rgba(216, 247, 255, 0.04)), rgba(4, 20, 34, 0.24)",
    "--toolkit-grid-shadow": "inset 0 1px 0 rgba(238, 252, 255, 0.07), inset 0 -1px 0 rgba(139, 233, 255, 0.06)",
    "--toolkit-tile-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.04), rgba(139, 233, 255, 0.024)), rgba(4, 20, 34, 0.3)",
    "--toolkit-tile-primary-bg":
      "linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 14%, transparent), transparent 46%), rgba(7, 34, 54, 0.36)",
    "--toolkit-tile-hover-bg":
      "linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 12%, transparent), transparent 58%), rgba(7, 34, 54, 0.44)",
    "--toolkit-tile-text": "var(--text-primary)",
    "--toolkit-icon-bg":
      "linear-gradient(180deg, rgba(238, 252, 255, 0.055), rgba(139, 233, 255, 0.036)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(7, 34, 54, 0.42))",
    "--toolkit-bottom-bg":
      "linear-gradient(90deg, rgba(139, 233, 255, 0.06), transparent 52%, rgba(216, 247, 255, 0.035)), rgba(4, 20, 34, 0.25)",
    "--toolkit-bottom-btn-bg": "rgba(7, 34, 54, 0.34)",
  };
}

const MOOD_SURFACE_CSS: Record<MoodPresetId, MoodSurfaceCSS> = {
  "aether-sky": darkMoodSurfaces({
    shell: "2, 8, 18",
    panel: "6, 20, 36",
    panelStrong: "8, 27, 50",
    accent: "120, 207, 255",
    gold: "240, 207, 122",
    text: "246, 251, 255",
  }),
  "aether-moonwater": darkMoodSurfaces({
    shell: "0, 8, 22",
    panel: "2, 25, 48",
    panelStrong: "3, 35, 65",
    accent: "82, 215, 255",
    gold: "245, 199, 227",
    text: "246, 253, 255",
  }),
  "aether-crystal": crystalMoodSurfaces(),
  "aether-dream": darkMoodSurfaces({
    shell: "10, 6, 20",
    panel: "34, 25, 50",
    panelStrong: "48, 38, 68",
    accent: "200, 182, 255",
    gold: "255, 217, 150",
    text: "253, 248, 255",
  }),
  "aether-cute": darkMoodSurfaces({
    shell: "3, 13, 13",
    panel: "18, 48, 44",
    panelStrong: "30, 70, 66",
    accent: "114, 240, 220",
    gold: "255, 209, 220",
    text: "246, 255, 253",
  }),
  "aether-sakura": {
    "--chrome-frame-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.46), transparent 72%), linear-gradient(90deg, rgba(189, 63, 104, 0.045), transparent 34%, transparent 66%, rgba(252, 201, 185, 0.06)), rgba(255, 238, 247, 0.72)",
    "--chrome-frame-filter": "blur(12px) saturate(1.14) brightness(1.02) contrast(1.02)",
    "--chrome-frame-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.56), inset 0 -1px 0 rgba(130, 49, 73, 0.09)",
    "--chrome-control-hover-bg": "rgba(189, 63, 104, 0.1)",
    "--chrome-control-hover-border": "rgba(130, 49, 73, 0.18)",
    "--chrome-separator-bg": "linear-gradient(180deg, transparent, rgba(130, 49, 73, 0.22), transparent)",
    "--statusbar-bg": "rgba(255, 238, 247, 0.82)",
    "--statusbar-filter": "blur(12px) saturate(1.12) brightness(1.02) contrast(1.02)",
    "--statusbar-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -1px 0 rgba(159, 75, 97, 0.07)",
    "--material-panel-filter": "blur(14px) saturate(1.14) brightness(1.02) contrast(1.02)",
    "--terminal-shell-filter": "blur(12px) saturate(1.12) brightness(0.96) contrast(1.06)",
    "--material-panel-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.06), 0 10px 28px rgba(80, 32, 52, 0.12)",
    "--material-card-shadow": "var(--rim-top), 0 0 0 1px rgba(159, 75, 97, 0.07), 0 8px 18px rgba(80, 32, 52, 0.1)",
    "--popup-glass-bg": "linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 38%), rgba(255, 242, 248, 0.9)",
    "--popup-glass-border": "rgba(130, 49, 73, 0.22)",
    "--popup-glass-shadow":
      "var(--rim-top), inset 0 0 0 1px rgba(159, 75, 97, 0.08), 0 14px 32px rgba(80, 32, 52, 0.16)",
    "--scrim-standard-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.18), rgba(54, 25, 39, 0.28)), rgba(255, 238, 245, 0.14)",
    "--scrim-heavy-bg":
      "linear-gradient(180deg, rgba(83, 37, 54, 0.24), rgba(54, 25, 39, 0.34)), rgba(255, 230, 240, 0.16)",
    "--dialog-surface":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.44), transparent 32%), linear-gradient(145deg, rgba(252, 201, 185, 0.1), transparent 50%), rgba(255, 248, 252, 0.88)",
    "--dialog-surface-blur": "blur(18px)",
    "--settings-control-bg": "rgba(255, 249, 252, 0.78)",
    "--settings-card-bg": "rgba(255, 246, 250, 0.74)",
    "--settings-card-bg-hover": "rgba(255, 241, 248, 0.84)",
    "--settings-card-bg-active": "rgba(255, 236, 246, 0.9)",
    "--toolkit-grid-bg":
      "linear-gradient(135deg, rgba(189, 63, 104, 0.075), transparent 38%, rgba(252, 201, 185, 0.09)), rgba(255, 245, 250, 0.72)",
    "--toolkit-grid-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.44), inset 0 -1px 0 rgba(130, 49, 73, 0.12)",
    "--toolkit-tile-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 218, 233, 0.08)), rgba(255, 247, 251, 0.78)",
    "--toolkit-tile-primary-bg":
      "linear-gradient(135deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 46%), rgba(255, 242, 249, 0.82)",
    "--toolkit-tile-hover-bg":
      "linear-gradient(180deg, color-mix(in srgb, var(--tone, var(--gold)) 10%, transparent), transparent 58%), rgba(255, 237, 246, 0.88)",
    "--toolkit-tile-text": "rgba(47, 22, 33, 0.92)",
    "--toolkit-icon-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(189, 63, 104, 0.06)), color-mix(in srgb, var(--tone, var(--accent)) 12%, rgba(255, 247, 251, 0.78))",
    "--toolkit-bottom-bg":
      "linear-gradient(90deg, rgba(189, 63, 104, 0.07), transparent 52%, rgba(252, 201, 185, 0.07)), rgba(255, 244, 250, 0.78)",
    "--toolkit-bottom-btn-bg": "rgba(255, 250, 253, 0.84)",
  },
  "aether-obsidian": darkMoodSurfaces({
    shell: "8, 8, 13",
    panel: "21, 20, 26",
    panelStrong: "31, 30, 37",
    accent: "216, 183, 102",
    gold: "137, 220, 235",
    text: "250, 246, 235",
  }),
  "aether-pro": darkMoodSurfaces({
    shell: "2, 8, 16",
    panel: "4, 13, 23",
    panelStrong: "8, 22, 34",
    accent: "155, 199, 223",
    gold: "199, 179, 122",
    text: "241, 247, 250",
  }),
};

const MOOD_CSS: Record<MoodPresetId, Record<string, string>> = {
  "aether-sky": {
    "--aether-ink": "#07111d",
    "--aether-obsidian": "#0d1727",
    "--aether-graphite": "#162338",
    "--aether-smoke-mauve": "#20324a",
    "--aether-moon": "#d9ecff",
    "--aether-champagne": "#f0cf7a",
    "--glass-clear": "rgba(35, 104, 170, 0.014)",
    "--glass-ground": "rgba(4, 14, 27, 0.28)",
    "--glass-frame": "rgba(9, 24, 42, 0.19)",
    "--glass-standard": "rgba(8, 25, 47, 0.18)",
    "--glass-dense": "rgba(7, 22, 42, 0.22)",
    "--glass-thick": "rgba(8, 27, 50, 0.255)",
    "--glass-solid": "rgba(18, 30, 48, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(132, 214, 244, 0.078)",
    "--aether-border-strong": "rgba(162, 226, 250, 0.145)",
    "--accent": "#78cfff",
    "--gold": "#f0cf7a",
    "--gold-dim": "rgba(240, 207, 122, 0.38)",
    "--gold-subtle": "rgba(240, 207, 122, 0.16)",
    "--gold-surface": "linear-gradient(180deg, #fff0b2 0%, #f6d982 36%, #d2a94f 100%)",
    "--text-primary": "#f6fbff",
    "--text-secondary": "#cfe4f3",
    "--text-muted": "#9fb8cb",
    "--text-on-accent": "#07111d",
    "--row-hover": "rgba(118, 207, 245, 0.064)",
    "--row-hover-strong": "rgba(150, 222, 250, 0.1)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 48% -18%, rgba(76, 188, 224, 0.036), transparent 44%), linear-gradient(180deg, rgba(4, 15, 29, 0.38), rgba(1, 6, 15, 0.62))",
    "--terminal-chrome-bg": "rgba(5, 17, 30, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(7, 22, 38, 0.48)",
    "--terminal-rim-warm": "rgba(98, 207, 236, 0.074)",
    "--terminal-border": "rgba(111, 204, 238, 0.064)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(154, 224, 242, 0.032), inset 0 0 0 1px rgba(98, 190, 230, 0.044), inset 0 34px 78px rgba(2, 10, 23, 0.34), inset 0 -24px 62px rgba(1, 6, 16, 0.26)",
    "--terminal-shell-shadow": "0 24px 72px rgba(1, 8, 20, 0.34), 0 0 38px rgba(62, 170, 214, 0.038)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(116, 207, 238, 0.038), inset 0 26px 68px rgba(0, 6, 18, 0.29), inset 0 -20px 50px rgba(0, 4, 13, 0.22)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(1, 7, 18, 0.22), transparent 52px), linear-gradient(0deg, rgba(1, 7, 17, 0.16), transparent 42px), linear-gradient(90deg, rgba(62, 170, 214, 0.018), transparent 25%, transparent 74%, rgba(100, 204, 232, 0.012))",
    "--terminal-watermark-opacity": "0.042",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(62, 170, 214, 0.06))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(58, 163, 212, 0.036), transparent 34%), linear-gradient(305deg, rgba(115, 217, 238, 0.018), transparent 40%), linear-gradient(180deg, rgba(1, 9, 22, 0.06), rgba(1, 9, 22, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(110, 212, 238, 0.006) 50%, transparent)",
    "--mood-root-texture-opacity": "0.032",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(145, 226, 243, 0.052), inset 0 0 0 1px rgba(70, 184, 224, 0.046), inset 0 -1px 0 rgba(52, 150, 198, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(96, 205, 236, 0.01), transparent 26%), linear-gradient(135deg, rgba(9, 36, 66, 0.072), rgba(2, 14, 29, 0.1)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(58, 163, 212, 0.02), transparent 44%), linear-gradient(180deg, rgba(3, 17, 34, 0.058), rgba(1, 9, 22, 0.034)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(96, 205, 236, 0.01), transparent 24%), linear-gradient(145deg, rgba(8, 33, 61, 0.066), rgba(2, 16, 33, 0.1)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(8, 38, 70, 0.112), rgba(3, 20, 42, 0.14)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(105, 214, 240, 0.01), transparent 22%), linear-gradient(135deg, rgba(58, 163, 212, 0.016), transparent 44%), linear-gradient(315deg, rgba(91, 205, 233, 0.008), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(8, 36, 68, 0.14), rgba(3, 21, 45, 0.16)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(5, 29, 55, 0.128), rgba(3, 20, 43, 0.146)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(7, 34, 64, 0.122), rgba(2, 19, 41, 0.152)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(4, 22, 43, 0.14), rgba(2, 11, 26, 0.17)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(126, 207, 255, 0.28)",
  },
  "aether-moonwater": {
    "--aether-ink": "#03111f",
    "--aether-obsidian": "#061a2b",
    "--aether-graphite": "#0b2940",
    "--aether-smoke-mauve": "#14354c",
    "--aether-moon": "#e9fbff",
    "--aether-champagne": "#f5c7e3",
    "--glass-clear": "rgba(0, 118, 204, 0.014)",
    "--glass-ground": "rgba(0, 16, 34, 0.28)",
    "--glass-frame": "rgba(2, 34, 62, 0.18)",
    "--glass-standard": "rgba(2, 38, 70, 0.16)",
    "--glass-dense": "rgba(1, 31, 58, 0.2)",
    "--glass-thick": "rgba(2, 43, 77, 0.245)",
    "--glass-solid": "rgba(6, 23, 37, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(88, 214, 255, 0.082)",
    "--aether-border-strong": "rgba(156, 236, 255, 0.16)",
    "--accent": "#52d7ff",
    "--gold": "#f5c7e3",
    "--gold-dim": "rgba(245, 199, 227, 0.34)",
    "--gold-subtle": "rgba(245, 199, 227, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #fff4fb 0%, #f5c7e3 42%, #9adfff 100%)",
    "--text-primary": "#f6fdff",
    "--text-secondary": "#c6e8f3",
    "--text-muted": "#96b9c8",
    "--text-on-accent": "#03111f",
    "--row-hover": "rgba(82, 215, 255, 0.07)",
    "--row-hover-strong": "rgba(154, 226, 255, 0.12)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 42% -16%, rgba(90, 218, 255, 0.048), transparent 46%), radial-gradient(ellipse at 72% 18%, rgba(245, 199, 227, 0.018), transparent 36%), linear-gradient(180deg, rgba(1, 18, 39, 0.42), rgba(0, 6, 18, 0.66))",
    "--terminal-chrome-bg": "rgba(1, 20, 38, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(2, 30, 56, 0.5)",
    "--terminal-rim-warm": "rgba(156, 236, 255, 0.08)",
    "--terminal-border": "rgba(86, 216, 255, 0.07)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(176, 241, 255, 0.034), inset 0 0 0 1px rgba(75, 204, 246, 0.046), inset 0 34px 82px rgba(0, 9, 26, 0.38), inset 0 -24px 62px rgba(0, 4, 14, 0.28)",
    "--terminal-shell-shadow": "0 24px 74px rgba(0, 8, 24, 0.36), 0 0 42px rgba(48, 190, 238, 0.045)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(92, 222, 255, 0.042), inset 0 28px 72px rgba(0, 7, 22, 0.3), inset 0 -22px 54px rgba(0, 4, 13, 0.24)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 8, 24, 0.2), transparent 52px), linear-gradient(0deg, rgba(0, 6, 18, 0.18), transparent 42px), linear-gradient(90deg, rgba(74, 208, 255, 0.018), transparent 25%, transparent 74%, rgba(245, 199, 227, 0.012))",
    "--terminal-watermark-opacity": "0.05",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(82, 215, 255, 0.065))",
    "--mood-root-glow":
      "linear-gradient(120deg, rgba(12, 113, 203, 0.07), transparent 34%), linear-gradient(300deg, rgba(72, 212, 255, 0.05), transparent 40%), linear-gradient(180deg, rgba(0, 17, 42, 0.05), rgba(0, 7, 20, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(124, 226, 255, 0.006) 50%, transparent)",
    "--mood-root-texture-opacity": "0.022",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(172, 240, 255, 0.062), inset 0 0 0 1px rgba(70, 202, 246, 0.052), inset 0 -1px 0 rgba(245, 199, 227, 0.03)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(88, 214, 255, 0.008), transparent 24%), rgba(1, 18, 34, 0.14)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(48, 190, 238, 0.028), transparent 44%), linear-gradient(180deg, rgba(0, 19, 43, 0.048), rgba(0, 7, 20, 0.032)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(88, 214, 255, 0.01), transparent 24%), linear-gradient(145deg, rgba(1, 30, 56, 0.052), rgba(0, 13, 31, 0.078)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(2, 44, 76, 0.11), rgba(0, 18, 40, 0.13)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(116, 224, 255, 0.012), transparent 22%), linear-gradient(135deg, rgba(64, 190, 238, 0.016), transparent 44%), linear-gradient(315deg, rgba(245, 199, 227, 0.01), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(2, 40, 72, 0.13), rgba(0, 19, 42, 0.15)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(1, 32, 60, 0.12), rgba(0, 17, 39, 0.14)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(2, 39, 70, 0.116), rgba(0, 17, 38, 0.144)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(1, 25, 50, 0.13), rgba(0, 10, 26, 0.16)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(82, 215, 255, 0.28)",
  },
  "aether-crystal": {
    "--aether-ink": "#06101a",
    "--aether-obsidian": "#0b1724",
    "--aether-graphite": "#12263a",
    "--aether-smoke-mauve": "#1b3448",
    "--aether-moon": "#effcff",
    "--aether-champagne": "#d8f7ff",
    "--glass-clear": "rgba(94, 206, 255, 0.012)",
    "--glass-ground": "rgba(3, 15, 28, 0.18)",
    "--glass-frame": "rgba(6, 28, 45, 0.14)",
    "--glass-standard": "rgba(5, 24, 40, 0.22)",
    "--glass-dense": "rgba(5, 24, 40, 0.28)",
    "--glass-thick": "rgba(7, 34, 54, 0.34)",
    "--glass-solid": "rgba(14, 28, 42, 0.72)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(158, 235, 255, 0.085)",
    "--aether-border-strong": "rgba(210, 248, 255, 0.16)",
    "--accent": "#8be9ff",
    "--gold": "#d8f7ff",
    "--gold-dim": "rgba(216, 247, 255, 0.36)",
    "--gold-subtle": "rgba(216, 247, 255, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #ffffff 0%, #d8f7ff 42%, #8be9ff 100%)",
    "--text-primary": "#f8fdff",
    "--text-secondary": "#d7edf7",
    "--text-muted": "#abc7d4",
    "--text-on-accent": "#06101a",
    "--row-hover": "rgba(139, 233, 255, 0.07)",
    "--row-hover-strong": "rgba(205, 247, 255, 0.11)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 44% -18%, rgba(139, 233, 255, 0.052), transparent 46%), radial-gradient(ellipse at 78% 14%, rgba(216, 247, 255, 0.024), transparent 38%), linear-gradient(180deg, rgba(3, 14, 28, 0.28), rgba(0, 5, 15, 0.5))",
    "--terminal-chrome-bg": "rgba(3, 14, 27, 0.22)",
    "--terminal-chrome-bg-focus": "rgba(5, 24, 40, 0.36)",
    "--terminal-rim-warm": "rgba(190, 244, 255, 0.088)",
    "--terminal-border": "rgba(139, 233, 255, 0.07)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(238, 252, 255, 0.04), inset 0 0 0 1px rgba(139, 233, 255, 0.05), inset 0 34px 74px rgba(0, 8, 22, 0.26), inset 0 -24px 58px rgba(0, 4, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(0, 8, 20, 0.28), 0 0 44px rgba(139, 233, 255, 0.045)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(139, 233, 255, 0.04), inset 0 26px 64px rgba(0, 7, 22, 0.24), inset 0 -20px 48px rgba(0, 4, 13, 0.18)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(1, 7, 18, 0.16), transparent 52px), linear-gradient(0deg, rgba(1, 7, 17, 0.12), transparent 42px), linear-gradient(90deg, rgba(139, 233, 255, 0.018), transparent 25%, transparent 74%, rgba(216, 247, 255, 0.012))",
    "--terminal-watermark-opacity": "0.034",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(139, 233, 255, 0.065))",
    "--mood-root-glow":
      "linear-gradient(122deg, rgba(139, 233, 255, 0.058), transparent 34%), linear-gradient(305deg, rgba(216, 247, 255, 0.026), transparent 42%), linear-gradient(180deg, rgba(2, 9, 20, 0.032), rgba(2, 9, 20, 0.11))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(216, 247, 255, 0.005) 50%, transparent)",
    "--mood-root-texture-opacity": "0.02",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(238, 252, 255, 0.07), inset 0 0 0 1px rgba(139, 233, 255, 0.052), inset 0 -1px 0 rgba(139, 233, 255, 0.035)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.018), transparent 24%), linear-gradient(135deg, rgba(8, 42, 66, 0.052), rgba(2, 14, 28, 0.078)), rgba(5, 24, 40, 0.22)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(139, 233, 255, 0.03), transparent 44%), linear-gradient(180deg, rgba(2, 14, 30, 0.035), rgba(2, 9, 20, 0.025)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.018), transparent 24%), linear-gradient(145deg, rgba(8, 42, 66, 0.052), rgba(2, 14, 28, 0.078)), rgba(5, 24, 40, 0.28)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(8, 42, 66, 0.09), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.32)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(216, 247, 255, 0.014), transparent 22%), linear-gradient(135deg, rgba(139, 233, 255, 0.02), transparent 44%), linear-gradient(315deg, rgba(216, 247, 255, 0.01), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(8, 42, 66, 0.09), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.31)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(8, 42, 66, 0.088), rgba(2, 16, 34, 0.108)), rgba(7, 34, 54, 0.31)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(8, 42, 66, 0.086), rgba(2, 16, 34, 0.11)), rgba(7, 34, 54, 0.31)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(8, 42, 66, 0.086), rgba(2, 12, 28, 0.105)), rgba(5, 24, 40, 0.31)",
    "--mood-selection-bg": "rgba(139, 233, 255, 0.26)",
  },
  "aether-dream": {
    "--aether-ink": "#120d20",
    "--aether-obsidian": "#191329",
    "--aether-graphite": "#251d37",
    "--aether-smoke-mauve": "#342845",
    "--aether-moon": "#f2eaff",
    "--aether-champagne": "#ffd996",
    "--glass-clear": "rgba(128, 103, 190, 0.018)",
    "--glass-ground": "rgba(23, 17, 37, 0.24)",
    "--glass-frame": "rgba(82, 67, 119, 0.12)",
    "--glass-standard": "rgba(72, 58, 108, 0.14)",
    "--glass-dense": "rgba(61, 49, 91, 0.18)",
    "--glass-thick": "rgba(84, 68, 116, 0.22)",
    "--glass-solid": "rgba(30, 23, 45, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(224, 206, 255, 0.12)",
    "--aether-border-strong": "rgba(239, 225, 255, 0.21)",
    "--accent": "#c8b6ff",
    "--gold": "#ffd996",
    "--gold-dim": "rgba(255, 217, 150, 0.36)",
    "--gold-subtle": "rgba(255, 217, 150, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0c2 0%, #ffd996 42%, #d7a95c 100%)",
    "--text-primary": "#fdf8ff",
    "--text-secondary": "#dfd3f3",
    "--text-muted": "#b8a8d0",
    "--text-on-accent": "#120d20",
    "--row-hover": "rgba(203, 182, 255, 0.08)",
    "--row-hover-strong": "rgba(231, 217, 255, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.055), transparent 45%), linear-gradient(180deg, rgba(18, 14, 29, 0.32), rgba(6, 4, 13, 0.52))",
    "--terminal-chrome-bg": "rgba(31, 25, 47, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(48, 39, 68, 0.48)",
    "--terminal-rim-warm": "rgba(255, 217, 150, 0.17)",
    "--terminal-border": "rgba(223, 204, 255, 0.14)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(252, 240, 255, 0.09), inset 0 0 0 1px rgba(203, 182, 255, 0.075), inset 0 30px 72px rgba(11, 7, 21, 0.25), inset 0 -22px 58px rgba(9, 6, 18, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(8, 5, 19, 0.34), 0 0 44px rgba(203, 182, 255, 0.08)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(224, 206, 255, 0.075), inset 0 26px 68px rgba(8, 4, 18, 0.2), inset 0 -20px 50px rgba(6, 4, 15, 0.16)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(8, 5, 18, 0.16), transparent 52px), linear-gradient(0deg, rgba(9, 5, 18, 0.13), transparent 42px), linear-gradient(90deg, rgba(203, 182, 255, 0.04), transparent 25%, transparent 74%, rgba(255, 217, 150, 0.024))",
    "--terminal-watermark-opacity": "0.052",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(203, 182, 255, 0.09))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(203, 182, 255, 0.052), transparent 34%), linear-gradient(305deg, rgba(255, 217, 150, 0.032), transparent 40%), linear-gradient(180deg, rgba(18, 13, 32, 0.035), rgba(18, 13, 32, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(203, 182, 255, 0.008) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(252, 240, 255, 0.12), inset 0 0 0 1px rgba(203, 182, 255, 0.07), inset 0 -1px 0 rgba(255, 217, 150, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.02), transparent 26%), linear-gradient(135deg, rgba(101, 79, 141, 0.05), rgba(32, 24, 51, 0.07)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(203, 182, 255, 0.038), transparent 44%), linear-gradient(180deg, rgba(40, 30, 61, 0.05), rgba(18, 13, 32, 0.03)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.024), transparent 24%), linear-gradient(145deg, rgba(82, 64, 116, 0.05), rgba(33, 25, 52, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(92, 74, 126, 0.1), rgba(40, 31, 61, 0.12)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(252, 240, 255, 0.038), transparent 22%), linear-gradient(135deg, rgba(203, 182, 255, 0.034), transparent 44%), linear-gradient(315deg, rgba(255, 217, 150, 0.018), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(86, 70, 116, 0.14), rgba(37, 29, 56, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(54, 45, 78, 0.12), rgba(35, 27, 53, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(90, 70, 105, 0.12), rgba(31, 27, 55, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(28, 18, 48, 0.11), rgba(14, 9, 30, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(203, 182, 255, 0.27)",
  },
  "aether-cute": {
    "--aether-ink": "#071916",
    "--aether-obsidian": "#0e211f",
    "--aether-graphite": "#17302e",
    "--aether-smoke-mauve": "#223b39",
    "--aether-moon": "#e8fffb",
    "--aether-champagne": "#ffd1dc",
    "--glass-clear": "rgba(91, 207, 194, 0.018)",
    "--glass-ground": "rgba(11, 31, 29, 0.24)",
    "--glass-frame": "rgba(55, 116, 110, 0.12)",
    "--glass-standard": "rgba(43, 96, 91, 0.14)",
    "--glass-dense": "rgba(34, 78, 74, 0.18)",
    "--glass-thick": "rgba(54, 112, 105, 0.22)",
    "--glass-solid": "rgba(14, 35, 33, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(195, 255, 246, 0.12)",
    "--aether-border-strong": "rgba(218, 255, 250, 0.21)",
    "--accent": "#72f0dc",
    "--gold": "#ffd1dc",
    "--gold-dim": "rgba(255, 209, 220, 0.36)",
    "--gold-subtle": "rgba(255, 209, 220, 0.15)",
    "--gold-surface": "linear-gradient(180deg, #fff0f5 0%, #ffd1dc 42%, #d99aaa 100%)",
    "--text-primary": "#f6fffd",
    "--text-secondary": "#cfeae5",
    "--text-muted": "#a8c8c2",
    "--text-on-accent": "#071916",
    "--row-hover": "rgba(114, 240, 220, 0.08)",
    "--row-hover-strong": "rgba(188, 255, 244, 0.13)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.055), transparent 45%), linear-gradient(180deg, rgba(10, 26, 25, 0.32), rgba(3, 12, 12, 0.52))",
    "--terminal-chrome-bg": "rgba(18, 43, 41, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(30, 70, 66, 0.48)",
    "--terminal-rim-warm": "rgba(255, 209, 220, 0.17)",
    "--terminal-border": "rgba(195, 255, 246, 0.14)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(237, 255, 252, 0.09), inset 0 0 0 1px rgba(114, 240, 220, 0.075), inset 0 30px 72px rgba(4, 16, 16, 0.25), inset 0 -22px 58px rgba(3, 13, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 72px rgba(3, 13, 13, 0.34), 0 0 44px rgba(114, 240, 220, 0.08)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(195, 255, 246, 0.075), inset 0 26px 68px rgba(3, 12, 12, 0.2), inset 0 -20px 50px rgba(2, 9, 10, 0.16)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(2, 10, 11, 0.16), transparent 52px), linear-gradient(0deg, rgba(2, 10, 10, 0.13), transparent 42px), linear-gradient(90deg, rgba(114, 240, 220, 0.04), transparent 25%, transparent 74%, rgba(255, 209, 220, 0.024))",
    "--terminal-watermark-opacity": "0.052",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(114, 240, 220, 0.09))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(114, 240, 220, 0.052), transparent 34%), linear-gradient(305deg, rgba(255, 209, 220, 0.032), transparent 40%), linear-gradient(180deg, rgba(7, 25, 22, 0.035), rgba(7, 25, 22, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(114, 240, 220, 0.008) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(237, 255, 252, 0.12), inset 0 0 0 1px rgba(114, 240, 220, 0.07), inset 0 -1px 0 rgba(255, 209, 220, 0.04)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.02), transparent 26%), linear-gradient(135deg, rgba(66, 135, 126, 0.05), rgba(18, 48, 44, 0.07)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(114, 240, 220, 0.038), transparent 44%), linear-gradient(180deg, rgba(25, 55, 51, 0.05), rgba(7, 25, 22, 0.03)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.024), transparent 24%), linear-gradient(145deg, rgba(60, 116, 108, 0.05), rgba(17, 48, 45, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(67, 129, 120, 0.1), rgba(27, 62, 58, 0.12)), var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(237, 255, 252, 0.038), transparent 22%), linear-gradient(135deg, rgba(114, 240, 220, 0.034), transparent 44%), linear-gradient(315deg, rgba(255, 209, 220, 0.018), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(64, 118, 111, 0.14), rgba(24, 57, 53, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(40, 81, 76, 0.12), rgba(25, 58, 54, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(74, 118, 110, 0.12), rgba(20, 59, 55, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(8, 34, 32, 0.11), rgba(4, 20, 20, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(114, 240, 220, 0.26)",
  },
  "aether-sakura": {
    "--aether-ink": "#24121b",
    "--aether-obsidian": "#fff7fb",
    "--aether-graphite": "#ffe9f0",
    "--aether-smoke-mauve": "#e8a6b8",
    "--aether-moon": "#fffafd",
    "--aether-champagne": "#823149",
    "--glass-clear": "rgba(255, 242, 248, 0.075)",
    "--glass-ground": "rgba(255, 243, 249, 0.58)",
    "--glass-frame": "rgba(255, 241, 248, 0.56)",
    "--glass-standard": "rgba(255, 240, 248, 0.68)",
    "--glass-dense": "rgba(255, 237, 246, 0.76)",
    "--glass-thick": "rgba(255, 234, 244, 0.84)",
    "--glass-solid": "rgba(255, 247, 251, 0.88)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(147, 55, 83, 0.22)",
    "--aether-border-strong": "rgba(130, 49, 73, 0.34)",
    "--accent": "#bd3f68",
    "--gold": "#823149",
    "--gold-dim": "rgba(130, 49, 73, 0.4)",
    "--gold-subtle": "rgba(189, 63, 104, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #ffd6df 0%, #e88fa7 42%, #823149 100%)",
    "--text-primary": "#24121b",
    "--text-secondary": "#3f2430",
    "--text-muted": "#674353",
    "--text-on-accent": "#fffaff",
    "--row-hover": "rgba(189, 63, 104, 0.13)",
    "--row-hover-strong": "rgba(189, 63, 104, 0.2)",
    "--terminal-canvas-bg": "rgba(83, 33, 56, 0.54)",
    "--terminal-raster-bg": "rgba(83, 33, 56, 0.88)",
    "--terminal-well-bg":
      "radial-gradient(ellipse at 44% -18%, rgba(255, 198, 219, 0.18), transparent 46%), radial-gradient(ellipse at 78% 18%, rgba(252, 201, 185, 0.1), transparent 38%), linear-gradient(180deg, rgba(111, 43, 73, 0.4), rgba(54, 22, 42, 0.56))",
    "--terminal-chrome-bg": "rgba(78, 31, 54, 0.42)",
    "--terminal-chrome-bg-focus": "rgba(91, 35, 62, 0.58)",
    "--terminal-rim-warm": "rgba(255, 205, 220, 0.22)",
    "--terminal-border": "rgba(255, 184, 210, 0.24)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255, 226, 237, 0.14), inset 0 0 0 1px rgba(255, 168, 196, 0.12), inset 0 30px 72px rgba(72, 26, 46, 0.16), inset 0 -22px 58px rgba(42, 16, 31, 0.15)",
    "--terminal-shell-shadow": "0 24px 68px rgba(80, 32, 52, 0.18), 0 0 44px rgba(189, 63, 104, 0.1)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(255, 174, 204, 0.14), inset 0 1px 0 rgba(255, 238, 245, 0.1), inset 0 26px 68px rgba(86, 32, 54, 0.14), inset 0 -20px 50px rgba(46, 18, 34, 0.13)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(255, 218, 228, 0.06), transparent 52px), linear-gradient(0deg, rgba(31, 10, 24, 0.16), transparent 42px), linear-gradient(90deg, rgba(232, 62, 122, 0.035), transparent 25%, transparent 74%, rgba(255, 210, 220, 0.03))",
    "--terminal-watermark-opacity": "0.032",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(189, 63, 104, 0.1))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(252, 201, 185, 0.11), transparent 35%), linear-gradient(300deg, rgba(189, 63, 104, 0.05), transparent 42%), linear-gradient(180deg, rgba(255, 250, 253, 0.08), rgba(255, 224, 237, 0.04))",
    "--mood-root-glow-opacity": "0.16",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(189, 63, 104, 0.01) 50%, transparent)",
    "--mood-root-texture-opacity": "0.038",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(255, 255, 255, 0.46), inset 0 0 0 1px rgba(130, 49, 73, 0.12), inset 0 -1px 0 rgba(130, 49, 73, 0.06)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 30%), linear-gradient(135deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.16)), rgba(255, 241, 248, 0.86)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(189, 63, 104, 0.05), transparent 44%), linear-gradient(180deg, rgba(255, 248, 252, 0.1), rgba(255, 222, 236, 0.06)), rgba(255, 248, 252, 0.06)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent 26%), linear-gradient(145deg, rgba(252, 201, 185, 0.14), rgba(255, 218, 233, 0.17)), rgba(255, 241, 248, 0.88)",
    "--mood-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.36), rgba(255, 226, 237, 0.16)), rgba(255, 246, 250, 0.82)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 22%), linear-gradient(135deg, rgba(189, 63, 104, 0.075), transparent 44%), linear-gradient(315deg, rgba(252, 201, 185, 0.07), transparent 50%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(255, 255, 255, 0.34), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.78)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(255, 250, 253, 0.34), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.76)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(255, 250, 253, 0.32), rgba(255, 224, 235, 0.14)), rgba(255, 246, 250, 0.76)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(255, 247, 251, 0.3), rgba(255, 224, 235, 0.12)), rgba(255, 244, 250, 0.72)",
    "--mood-selection-bg": "rgba(189, 63, 104, 0.22)",
  },
  "aether-obsidian": {
    "--aether-ink": "#090b13",
    "--aether-obsidian": "#111017",
    "--aether-graphite": "#1b1920",
    "--aether-smoke-mauve": "#28232a",
    "--aether-moon": "#c7d2ee",
    "--aether-champagne": "#d8b766",
    "--glass-clear": "rgba(10, 9, 13, 0.018)",
    "--glass-ground": "rgba(13, 12, 15, 0.24)",
    "--glass-frame": "rgba(24, 22, 27, 0.12)",
    "--glass-standard": "rgba(26, 27, 32, 0.14)",
    "--glass-dense": "rgba(27, 26, 33, 0.18)",
    "--glass-thick": "rgba(36, 36, 44, 0.22)",
    "--glass-solid": "rgba(26, 26, 26, 0.78)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(231, 211, 168, 0.065)",
    "--aether-border-strong": "rgba(231, 211, 168, 0.12)",
    "--accent": "#4fc1ff",
    "--gold": "#d8b766",
    "--gold-dim": "rgba(216, 183, 102, 0.42)",
    "--gold-subtle": "rgba(216, 183, 102, 0.18)",
    "--gold-surface": "linear-gradient(180deg, #f4df9a 0%, #dfc27c 24%, #d8b766 52%, #b78c3f 82%, #8f682f 100%)",
    "--text-primary": "#faf6eb",
    "--text-secondary": "#d7d2c6",
    "--text-muted": "#aaa39a",
    "--text-on-accent": "#090b13",
    "--row-hover": "var(--white-6)",
    "--row-hover-strong": "var(--white-10)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.045), transparent 45%), linear-gradient(180deg, rgba(12, 13, 20, 0.34), rgba(4, 5, 9, 0.52))",
    "--terminal-chrome-bg": "rgba(16, 17, 24, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(24, 24, 31, 0.48)",
    "--terminal-rim-warm": "rgba(216, 183, 102, 0.16)",
    "--terminal-border": "rgba(216, 183, 102, 0.085)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(255, 244, 214, 0.055), inset 0 0 0 1px var(--terminal-border), inset 0 28px 70px rgba(0, 0, 0, 0.22), inset 0 -20px 56px rgba(5, 7, 13, 0.2)",
    "--terminal-shell-shadow": "0 24px 70px rgba(0, 0, 0, 0.24)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(137, 220, 235, 0.045), inset 0 22px 62px rgba(0, 0, 0, 0.18), inset 0 -18px 46px rgba(0, 0, 0, 0.14)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 0, 0, 0.14), transparent 48px), linear-gradient(0deg, rgba(0, 0, 0, 0.12), transparent 42px), linear-gradient(90deg, rgba(216, 183, 102, 0.035), transparent 26%, transparent 74%, rgba(137, 220, 235, 0.026))",
    "--terminal-watermark-opacity": "0.055",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(216, 183, 102, 0.08))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(216, 183, 102, 0.045), transparent 32%), linear-gradient(300deg, rgba(137, 220, 235, 0.032), transparent 38%), linear-gradient(180deg, rgba(9, 11, 19, 0.035), rgba(9, 11, 19, 0.1))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(216, 183, 102, 0.007) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(255, 244, 214, 0.1), inset 0 0 0 1px rgba(216, 183, 102, 0.055), inset 0 -1px 0 rgba(137, 220, 235, 0.035)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.018), transparent 26%), linear-gradient(135deg, rgba(42, 33, 28, 0.045), rgba(20, 23, 34, 0.065)), var(--glass-standard)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(216, 183, 102, 0.024), transparent 42%), linear-gradient(180deg, rgba(18, 15, 13, 0.04), rgba(9, 11, 18, 0.026)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.024), transparent 24%), linear-gradient(145deg, rgba(34, 25, 22, 0.045), rgba(22, 26, 38, 0.075)), var(--glass-dense)",
    "--mood-widget-bg": "var(--glass-thick)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(255, 244, 214, 0.035), transparent 22%), linear-gradient(135deg, rgba(216, 183, 102, 0.032), transparent 42%), linear-gradient(315deg, rgba(137, 220, 235, 0.024), transparent 48%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(41, 39, 48, 0.14), rgba(21, 22, 30, 0.14)), var(--glass-thick)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(30, 35, 42, 0.12), rgba(21, 20, 25, 0.12)), var(--glass-thick)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(42, 34, 25, 0.12), rgba(18, 23, 35, 0.14)), var(--glass-thick)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(21, 19, 25, 0.11), rgba(10, 10, 16, 0.14)), var(--glass-dense)",
    "--mood-selection-bg": "rgba(200, 160, 80, 0.25)",
  },
  "aether-pro": {
    "--aether-ink": "#080c10",
    "--aether-obsidian": "#0f1418",
    "--aether-graphite": "#1b2228",
    "--aether-smoke-mauve": "#273039",
    "--aether-moon": "#dce7ef",
    "--aether-champagne": "#c7b37a",
    "--glass-clear": "rgba(17, 25, 31, 0.018)",
    "--glass-ground": "rgba(13, 18, 22, 0.24)",
    "--glass-frame": "rgba(28, 36, 43, 0.12)",
    "--glass-standard": "rgba(32, 40, 48, 0.14)",
    "--glass-dense": "rgba(34, 42, 50, 0.18)",
    "--glass-thick": "rgba(45, 54, 63, 0.22)",
    "--glass-solid": "rgba(28, 34, 40, 0.8)",
    "--aether-bg": "var(--glass-clear)",
    "--aether-bg-sidebar": "var(--glass-standard)",
    "--aether-bg-elevated": "var(--glass-dense)",
    "--aether-bg-card": "var(--glass-thick)",
    "--aether-bg-surface": "var(--glass-dense)",
    "--aether-border": "rgba(203, 220, 232, 0.08)",
    "--aether-border-strong": "rgba(220, 235, 245, 0.14)",
    "--accent": "#9bc7df",
    "--gold": "#c7b37a",
    "--gold-dim": "rgba(199, 179, 122, 0.34)",
    "--gold-subtle": "rgba(199, 179, 122, 0.14)",
    "--gold-surface": "linear-gradient(180deg, #e7dba7 0%, #c7b37a 45%, #9a844b 100%)",
    "--text-primary": "#f1f7fa",
    "--text-secondary": "#ced9df",
    "--text-muted": "#a2b0b9",
    "--text-on-accent": "#080c10",
    "--row-hover": "rgba(155, 199, 223, 0.07)",
    "--row-hover-strong": "rgba(188, 220, 238, 0.11)",
    "--terminal-canvas-bg": DEFAULT_BG,
    "--terminal-well-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(155, 199, 223, 0.036), transparent 45%), linear-gradient(180deg, rgba(12, 17, 22, 0.32), rgba(4, 7, 10, 0.52))",
    "--terminal-chrome-bg": "rgba(21, 28, 34, 0.34)",
    "--terminal-chrome-bg-focus": "rgba(32, 42, 49, 0.48)",
    "--terminal-rim-warm": "rgba(199, 179, 122, 0.14)",
    "--terminal-border": "rgba(203, 220, 232, 0.1)",
    "--terminal-shadow-inset":
      "inset 0 1px 0 rgba(238, 246, 250, 0.055), inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 30px 72px rgba(0, 0, 0, 0.22), inset 0 -22px 58px rgba(0, 0, 0, 0.18)",
    "--terminal-shell-shadow": "0 24px 70px rgba(0, 0, 0, 0.28)",
    "--terminal-viewport-shadow":
      "inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 24px 64px rgba(0, 0, 0, 0.18), inset 0 -18px 46px rgba(0, 0, 0, 0.14)",
    "--terminal-viewport-occlusion":
      "linear-gradient(180deg, rgba(0, 0, 0, 0.14), transparent 48px), linear-gradient(0deg, rgba(0, 0, 0, 0.12), transparent 42px), linear-gradient(90deg, rgba(155, 199, 223, 0.026), transparent 26%, transparent 74%, rgba(199, 179, 122, 0.018))",
    "--terminal-watermark-opacity": "0.045",
    "--terminal-watermark-filter": "drop-shadow(0 18px 54px rgba(155, 199, 223, 0.055))",
    "--mood-root-glow":
      "linear-gradient(125deg, rgba(68, 178, 218, 0.036), transparent 32%), linear-gradient(300deg, rgba(199, 179, 122, 0.018), transparent 38%), linear-gradient(180deg, rgba(2, 9, 18, 0.06), rgba(1, 7, 14, 0.16))",
    "--mood-root-texture": "linear-gradient(90deg, transparent, rgba(155, 199, 223, 0.007) 50%, transparent)",
    "--mood-root-texture-opacity": "0.035",
    "--mood-window-rim":
      "inset 0 1px 0 rgba(238, 246, 250, 0.08), inset 0 0 0 1px rgba(203, 220, 232, 0.045), inset 0 -1px 0 rgba(199, 179, 122, 0.026)",
    "--mood-left-panel-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.016), transparent 26%), linear-gradient(145deg, rgba(0, 126, 190, 0.034), transparent 48%), rgba(4, 13, 23, 0.42)",
    "--mood-center-panel-bg":
      "radial-gradient(ellipse at 50% 0%, rgba(72, 185, 220, 0.024), transparent 42%), linear-gradient(180deg, rgba(4, 13, 23, 0.14), rgba(1, 6, 12, 0.12)), var(--aether-bg)",
    "--mood-right-panel-bg":
      "linear-gradient(180deg, rgba(124, 214, 235, 0.018), transparent 24%), linear-gradient(145deg, rgba(0, 126, 190, 0.042), transparent 48%), rgba(4, 13, 23, 0.48)",
    "--mood-widget-bg": "linear-gradient(160deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.26)",
    "--mood-widget-veil":
      "linear-gradient(180deg, rgba(238, 246, 250, 0.028), transparent 22%), linear-gradient(135deg, rgba(155, 199, 223, 0.022), transparent 42%), linear-gradient(315deg, rgba(199, 179, 122, 0.016), transparent 48%)",
    "--mood-sessions-widget-bg":
      "linear-gradient(160deg, rgba(5, 18, 31, 0.24), rgba(2, 9, 17, 0.3)), rgba(4, 13, 23, 0.24)",
    "--mood-workflow-widget-bg":
      "linear-gradient(180deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.22)",
    "--mood-toolkit-widget-bg":
      "linear-gradient(150deg, rgba(5, 18, 31, 0.22), rgba(2, 9, 17, 0.28)), rgba(4, 13, 23, 0.22)",
    "--mood-logs-widget-bg":
      "linear-gradient(180deg, rgba(5, 16, 28, 0.24), rgba(3, 10, 19, 0.3)), rgba(4, 13, 23, 0.28)",
    "--mood-selection-bg": "rgba(155, 199, 223, 0.22)",
  },
};

export const MOOD_CSS_KEYS: readonly string[] = Object.freeze(
  Array.from(
    new Set([
      ...Object.values(MOOD_CSS).flatMap((vars) => Object.keys(vars)),
      ...MOOD_SURFACE_CSS_KEYS,
      ...SAKURA_MATERIAL_CSS_KEYS,
    ]),
  ).sort(),
);
