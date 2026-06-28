// Mood preset theming. Split out of the former monolithic moods.ts into
// focused modules; this barrel re-exports the exact public surface that
// importers (useTheme, appStore, Settings, App, tests) previously consumed
// from "../themes/moods". Behavior and CSS output are unchanged.

export type {
  MoodMaterialAlphaKey,
  MoodMaterialColorKey,
  MoodMaterialKey,
  MoodMaterialOverrides,
  SakuraMaterialAlphaKey,
  SakuraMaterialColorKey,
  SakuraMaterialKey,
  SakuraMaterialOverrides,
} from "./material";
export {
  isMoodMaterialLight,
  MOOD_MATERIAL_DEFAULTS,
  materialOverridesToCSS,
  SAKURA_MATERIAL_ALPHA_KEYS,
  SAKURA_MATERIAL_COLOR_KEYS,
  SAKURA_MATERIAL_DEFAULTS,
  sakuraMaterialOverridesToCSS,
  sanitizeMaterialOverrides,
  sanitizeSakuraMaterialOverrides,
} from "./material";
export { moodPresetToCSS } from "./moodPresetToCSS";
export type { MoodPreset, MoodPresetId } from "./registry";
export { DEFAULT_MOOD_PRESET, MOOD_PRESETS, normalizeMoodPreset } from "./registry";
export { MOOD_SURFACE_CSS_KEYS } from "./surfaces";
export { MOOD_CSS_KEYS } from "./tokens";
