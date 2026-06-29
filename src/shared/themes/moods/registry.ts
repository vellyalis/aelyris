export type MoodPresetId =
  | "aelyris-sky"
  | "aelyris-moonwater"
  | "aelyris-crystal"
  | "aelyris-dream"
  | "aelyris-cute"
  | "aelyris-sakura"
  | "aelyris-obsidian"
  | "aelyris-pro";

export interface MoodPreset {
  id: MoodPresetId;
  label: string;
  tone: string;
}

export const DEFAULT_MOOD_PRESET: MoodPresetId = "aelyris-sky";

export const MOOD_PRESETS: readonly MoodPreset[] = [
  { id: "aelyris-sky", label: "Aelyris Sky", tone: "Airy blue glass" },
  { id: "aelyris-moonwater", label: "Aelyris Moonwater", tone: "Moonlit cyan tide" },
  { id: "aelyris-crystal", label: "Aelyris Crystal", tone: "Clear cinematic glass" },
  { id: "aelyris-dream", label: "Aelyris Dream", tone: "Soft lavender aurora" },
  { id: "aelyris-cute", label: "Aelyris Cute", tone: "Clear mint and rose" },
  { id: "aelyris-sakura", label: "Aelyris Sakura", tone: "Cherry blossom glass" },
  { id: "aelyris-obsidian", label: "Aelyris Obsidian", tone: "Midnight gold cockpit" },
  { id: "aelyris-pro", label: "Aelyris Pro", tone: "Quiet graphite focus" },
] as const;

export const MOOD_SET = new Set<string>(MOOD_PRESETS.map((preset) => preset.id));

export function normalizeMoodPreset(value: string | null | undefined): MoodPresetId {
  return value && MOOD_SET.has(value) ? (value as MoodPresetId) : DEFAULT_MOOD_PRESET;
}
