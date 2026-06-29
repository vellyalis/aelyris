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
  { id: "aether-sky", label: "Quorum Sky", tone: "Airy blue glass" },
  { id: "aether-moonwater", label: "Quorum Moonwater", tone: "Moonlit cyan tide" },
  { id: "aether-crystal", label: "Quorum Crystal", tone: "Clear cinematic glass" },
  { id: "aether-dream", label: "Quorum Dream", tone: "Soft lavender aurora" },
  { id: "aether-cute", label: "Quorum Cute", tone: "Clear mint and rose" },
  { id: "aether-sakura", label: "Quorum Sakura", tone: "Cherry blossom glass" },
  { id: "aether-obsidian", label: "Quorum Obsidian", tone: "Midnight gold cockpit" },
  { id: "aether-pro", label: "Quorum Pro", tone: "Quiet graphite focus" },
] as const;

export const MOOD_SET = new Set<string>(MOOD_PRESETS.map((preset) => preset.id));

export function normalizeMoodPreset(value: string | null | undefined): MoodPresetId {
  return value && MOOD_SET.has(value) ? (value as MoodPresetId) : DEFAULT_MOOD_PRESET;
}
