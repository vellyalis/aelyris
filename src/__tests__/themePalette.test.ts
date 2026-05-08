import { describe, expect, it } from "vitest";
import { DEFAULT_BG } from "../shared/lib/ansiPalette";
import {
  ACCENT_KEYS,
  type AccentKey,
  type AccentOverrides,
  accentLabel,
  applyAccentOverrides,
  getPalette,
  isLightTheme,
  isValidHex,
  normalizeHex,
} from "../shared/themes/catppuccin";
import {
  DEFAULT_MOOD_PRESET,
  MOOD_PRESETS,
  MOOD_SURFACE_CSS_KEYS,
  moodPresetToCSS,
  normalizeMoodPreset,
} from "../shared/themes/moods";

describe("themes/catppuccin — hex helpers", () => {
  it("validates 6-digit hex", () => {
    expect(isValidHex("#aabbcc")).toBe(true);
    expect(isValidHex("#AABBCC")).toBe(true);
  });

  it("validates 3-digit shorthand", () => {
    expect(isValidHex("#abc")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidHex("aabbcc")).toBe(false); // missing leading #
    expect(isValidHex("#abcd")).toBe(false); // 4 digits
    expect(isValidHex("#xyzxyz")).toBe(false); // non-hex chars
    expect(isValidHex("#")).toBe(false);
    expect(isValidHex("")).toBe(false);
  });

  it("normalizes shorthand to 6 digits", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#FFF")).toBe("#ffffff");
  });

  it("lowercases 6-digit input", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
  });

  it("passes through invalid input unchanged", () => {
    expect(normalizeHex("not a color")).toBe("not a color");
  });
});

describe("themes/catppuccin — accent metadata", () => {
  it("ACCENT_KEYS contains every expected accent", () => {
    const expected: AccentKey[] = [
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "peach",
      "mauve",
      "pink",
      "teal",
      "sky",
      "lavender",
      "flamingo",
      "rosewater",
      "sapphire",
      "maroon",
    ];
    expect([...ACCENT_KEYS].sort()).toEqual([...expected].sort());
  });

  it("accentLabel capitalises", () => {
    expect(accentLabel("sapphire")).toBe("Sapphire");
    expect(accentLabel("rosewater")).toBe("Rosewater");
  });
});

describe("themes/catppuccin — Sakura theme", () => {
  it("exposes Sakura Hub as a light cherry-blossom palette", () => {
    const palette = getPalette("sakura-hub");

    expect(isLightTheme("sakura-hub")).toBe(true);
    expect(palette.base).toBe("#fff7fb");
    expect(palette.sapphire).toBe("#e83e7a");
    expect(palette.text).toBe("#402432");
  });
});

describe("themes/catppuccin — applyAccentOverrides", () => {
  const base = getPalette("aether-dark");

  it("returns the same reference when overrides is undefined", () => {
    expect(applyAccentOverrides(base, undefined)).toBe(base);
  });

  it("returns the same reference when overrides is empty", () => {
    expect(applyAccentOverrides(base, {})).toBe(base);
  });

  it("returns a new palette with the override applied", () => {
    const overrides: AccentOverrides = { sapphire: "#abcdef" };
    const result = applyAccentOverrides(base, overrides);
    expect(result).not.toBe(base);
    expect(result.sapphire).toBe("#abcdef");
    // Other accents stay intact
    expect(result.mauve).toBe(base.mauve);
    expect(result.red).toBe(base.red);
  });

  it("normalises hex values (lowercases, expands shorthand)", () => {
    const result = applyAccentOverrides(base, { sapphire: "#ABC" });
    expect(result.sapphire).toBe("#aabbcc");
  });

  it("ignores invalid hex values", () => {
    const result = applyAccentOverrides(base, { sapphire: "not-a-hex" });
    expect(result.sapphire).toBe(base.sapphire);
  });

  it("ignores keys outside the accent set", () => {
    // Casting through unknown to attempt smuggling a non-accent key.
    const result = applyAccentOverrides(base, { text: "#ffffff", sapphire: "#aabbcc" } as unknown as AccentOverrides);
    expect(result.sapphire).toBe("#aabbcc");
    // text should not be touched — applyAccentOverrides only writes accents.
    expect(result.text).toBe(base.text);
  });

  it("does not mutate the input palette", () => {
    const snapshot = { ...base };
    applyAccentOverrides(base, { sapphire: "#000000" });
    expect(base).toEqual(snapshot);
  });
});

describe("themes/moods — preset metadata", () => {
  it("normalizes unknown mood ids to the default", () => {
    expect(normalizeMoodPreset("aether-dream")).toBe("aether-dream");
    expect(normalizeMoodPreset("not-real")).toBe(DEFAULT_MOOD_PRESET);
    expect(normalizeMoodPreset(null)).toBe(DEFAULT_MOOD_PRESET);
  });

  it("defines every expected mood preset", () => {
    expect(MOOD_PRESETS.map((preset) => preset.id)).toEqual([
      "aether-sky",
      "aether-moonwater",
      "aether-dream",
      "aether-cute",
      "aether-sakura",
      "aether-obsidian",
      "aether-pro",
    ]);
  });

  it("returns a complete variable set for every mood", () => {
    const required = [
      "--glass-clear",
      "--aether-bg",
      "--accent",
      "--gold",
      "--terminal-canvas-bg",
      "--terminal-well-bg",
      "--terminal-shell-shadow",
      "--terminal-viewport-shadow",
      "--mood-root-glow",
      "--mood-center-panel-bg",
      "--mood-widget-bg",
      "--mood-selection-bg",
      "--text-on-accent",
    ];

    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      for (const key of [...required, ...MOOD_SURFACE_CSS_KEYS]) {
        expect(vars[key], `${preset.id} missing ${key}`).toBeTruthy();
      }
    }
  });

  it("does not let Sakura surface colors bleed into darker mood presets", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      if (preset.id === "aether-sakura") continue;

      expect(vars["--statusbar-bg"], preset.id).not.toContain("255, 248, 251");
      expect(vars["--dialog-surface"], preset.id).not.toContain("255, 240, 247");
      expect(vars["--settings-card-bg"], preset.id).not.toContain("255, 245, 250");
      expect(vars["--toolkit-grid-bg"], preset.id).not.toContain("255, 242, 248");
      expect(vars["--chrome-frame-bg"], preset.id).not.toContain("255, 236, 245");
    }
  });

  it("keeps mood glass presets translucent while allowing dark clear-water tint", () => {
    const darkCeilings = {
      "--glass-clear": 0.02,
      "--glass-ground": 0.28,
      "--glass-frame": 0.2,
      "--glass-standard": 0.18,
      "--glass-dense": 0.22,
      "--glass-thick": 0.26,
    } as const;
    const lightCeilings = {
      "--glass-clear": 0.4,
      "--glass-ground": 0.78,
      "--glass-frame": 0.84,
      "--glass-standard": 0.76,
      "--glass-dense": 0.82,
      "--glass-thick": 0.88,
    } as const;

    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      const ceilings = preset.id === "aether-sakura" ? lightCeilings : darkCeilings;
      for (const [key, ceiling] of Object.entries(ceilings)) {
        expect(rgbaAlpha(vars[key]), `${preset.id} ${key}`).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("keeps Aether Sky clear-water dark instead of whitewashed", () => {
    const vars = moodPresetToCSS("aether-sky");

    expect(Number(vars["--mood-root-texture-opacity"])).toBeLessThanOrEqual(0.05);
    expect(vars["--mood-widget-veil"]).not.toContain("235, 248, 255");
    expect(vars["--mood-right-panel-bg"]).not.toContain("235, 248, 255");
    expect(vars["--terminal-shadow-inset"]).not.toContain("235, 248, 255");
  });

  it("defines Aether Moonwater as a clear cyan water preset without scanlines", () => {
    const vars = moodPresetToCSS("aether-moonwater");

    expect(normalizeMoodPreset("aether-moonwater")).toBe("aether-moonwater");
    expect(vars["--accent"]).toBe("#52d7ff");
    expect(vars["--gold"]).toBe("#f5c7e3");
    expect(vars["--mood-root-texture"]).not.toContain("repeating-linear-gradient");
    expect(Number(vars["--mood-root-texture-opacity"])).toBeLessThanOrEqual(0.03);
    expect(vars["--mood-root-glow"]).toContain("12, 113, 203");
  });

  it("keeps Aether Pro graphite deep instead of cloudy grey", () => {
    const vars = moodPresetToCSS("aether-pro");

    expect(vars["--chrome-frame-bg"]).toContain("rgba(2, 8, 16, 0.62)");
    expect(vars["--mood-left-panel-bg"]).toContain("rgba(4, 13, 23, 0.58)");
    expect(vars["--mood-right-panel-bg"]).toContain("rgba(4, 13, 23, 0.66)");
    expect(vars["--mood-left-panel-bg"]).not.toContain("238, 246, 250");
    expect(vars["--mood-right-panel-bg"]).not.toContain("var(--glass-dense)");
  });

  it("defines Aether Sakura as a warm blossom preset with readable ink contrast", () => {
    const vars = moodPresetToCSS("aether-sakura");

    expect(vars["--accent"]).toBe("#bd3f68");
    expect(vars["--gold"]).toBe("#823149");
    expect(vars["--text-primary"]).toBe("#24121b");
    expect(vars["--mood-root-glow"]).toContain("252, 201, 185");
    expect(contrastRatio(vars["--text-primary"], "#fff9fc")).toBeGreaterThanOrEqual(10);
    expect(rgbaAlpha(vars["--glass-standard"])).toBeLessThanOrEqual(0.34);
    expect(rgbaAlpha(vars["--terminal-canvas-bg"])).toBeLessThanOrEqual(0.54);
    expect(vars["--toolkit-tile-bg"]).not.toContain("0, 7, 15");
    expect(vars["--statusbar-bg"]).toContain("255, 248, 251");
    expect(rgbaAlpha(vars["--settings-card-bg"])).toBeLessThanOrEqual(0.7);
  });

  it("keeps mood root textures clear instead of synthetic scanlines", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      expect(vars["--mood-root-texture"], preset.id).not.toContain("repeating-linear-gradient");
      expect(Number(vars["--mood-root-texture-opacity"]), preset.id).toBeLessThanOrEqual(0.05);
    }
  });

  it("keeps mood canvas tokens aligned with the native terminal renderer, except Sakura's rose ink well", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      if (preset.id === "aether-sakura") {
        expect(vars["--terminal-canvas-bg"], preset.id).toContain("83, 33, 56");
        continue;
      }
      expect(vars["--terminal-canvas-bg"], preset.id).toBe(DEFAULT_BG);
    }
  });

  it("keeps collapsed log widgets on the same light material as sibling bento cards", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      const token = vars["--mood-logs-widget-bg"];
      expect(token, preset.id).not.toContain("0.34");
      expect(token, preset.id).not.toContain("0.42");
      expect(token, preset.id).not.toContain("0.5");
    }
  });

  it("keeps primary action foreground contrast above AA for every mood", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      const ratio = contrastRatio(vars["--gold"], vars["--text-on-accent"]);
      expect(ratio, preset.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps muted metadata readable enough for compact chrome", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      const muted = vars["--text-muted"];
      if (preset.id === "aether-sakura") {
        expect(rgbaAlpha(muted), preset.id).toBeGreaterThanOrEqual(0.72);
      } else {
        expect(rgbaAlpha(muted), preset.id).toBeGreaterThanOrEqual(0.56);
      }
    }
  });
});

function rgbaAlpha(value: string): number {
  const match = /rgba\([^)]*,\s*(\d*\.?\d+)\)/.exec(value);
  if (!match) throw new Error(`Expected rgba token, received ${value}`);
  return Number(match[1]);
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected 6-digit hex, received ${hex}`);
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}
