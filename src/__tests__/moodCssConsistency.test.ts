// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOOD_PRESETS, type MoodPresetId, moodPresetToCSS } from "../shared/themes/moods";

declare const process: { cwd(): string };

type CssVarMap = Record<string, string>;

const INTENTIONAL_CSS_SIDE_OVERRIDES = new Set<string>([
  // TODO(unify): keep this set explicit when a CSS-side mood override is
  // intentionally different from src/shared/themes/moods.
]);
const INTENTIONAL_CSS_ONLY_MOOD_VARS = new Set<string>([
  // TODO(unify): Sakura rail controls still live only in global.css. Keeping
  // every CSS-only var enumerated makes future data-mood additions fail loudly.
  "aelyris-sakura:--rail-accent-wash",
  "aelyris-sakura:--rail-control-bg",
  "aelyris-sakura:--rail-control-hover-bg",
  "aelyris-sakura:--rail-control-border",
  "aelyris-sakura:--rail-control-border-strong",
  "aelyris-sakura:--rail-control-active-bg",
  "aelyris-sakura:--rail-chip-bg",
  "aelyris-sakura:--rail-focus-ring",
]);

function cssSource(): string {
  return readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8").replace(/\r\n/g, "\n");
}

function normalizeCssValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function blockBody(source: string, selector: string): string | null {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Unclosed CSS block: ${selector}`);
}

function parseCssVars(block: string | null): CssVarMap {
  if (!block) return {};
  const vars: CssVarMap = {};
  const lines = block.replace(/\/\*[\s\S]*?\*\//g, "").split("\n");
  let activeName: string | null = null;
  let activeValue: string[] = [];

  const flush = () => {
    if (!activeName) return;
    vars[activeName] = normalizeCssValue(activeValue.join(" ").replace(/;$/, ""));
    activeName = null;
    activeValue = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const declaration = line.match(/^(--[A-Za-z0-9_-]+):\s*(.*)$/);
    if (declaration) {
      flush();
      activeName = declaration[1];
      activeValue = [declaration[2]];
    } else if (activeName) {
      activeValue.push(line);
    }
    if (activeName && line.endsWith(";")) flush();
  }
  flush();
  return vars;
}

function cssVarsForMood(source: string, mood: MoodPresetId): CssVarMap {
  return parseCssVars(blockBody(source, `:root[data-mood="${mood}"]`));
}

describe("mood CSS single-source consistency", () => {
  it("keeps global.css mood variables aligned with src/shared/themes/moods", () => {
    const source = cssSource();
    const mismatches: string[] = [];
    const unknownCssOnlyVars: string[] = [];

    for (const preset of MOOD_PRESETS) {
      const cssVars = cssVarsForMood(source, preset.id);
      const themeVars = moodPresetToCSS(preset.id);
      for (const [name, cssValue] of Object.entries(cssVars)) {
        const key = `${preset.id}:${name}`;
        const themeValue = themeVars[name];
        if (themeValue === undefined) {
          if (!INTENTIONAL_CSS_ONLY_MOOD_VARS.has(key)) unknownCssOnlyVars.push(key);
          continue;
        }
        if (INTENTIONAL_CSS_SIDE_OVERRIDES.has(key)) continue;
        if (normalizeCssValue(themeValue) !== cssValue) {
          mismatches.push(`${key} css=${cssValue} ts=${normalizeCssValue(themeValue)}`);
        }
      }
    }

    expect(unknownCssOnlyVars).toEqual([]);
    expect(mismatches).toEqual([]);
  });
});
