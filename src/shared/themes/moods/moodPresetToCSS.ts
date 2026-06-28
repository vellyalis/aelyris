import { applyReadableDarkGlassFloor } from "./material";
import { normalizeMoodPreset } from "./registry";
import { MOOD_SURFACE_CSS } from "./surfaces";
import { MOOD_CSS } from "./tokens";

export function moodPresetToCSS(value: string | null | undefined): Record<string, string> {
  const mood = normalizeMoodPreset(value);
  return applyReadableDarkGlassFloor(mood, {
    ...MOOD_CSS[mood],
    ...MOOD_SURFACE_CSS[mood],
  });
}
