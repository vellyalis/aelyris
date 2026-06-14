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
  isMoodMaterialLight,
  MOOD_MATERIAL_DEFAULTS,
  MOOD_PRESETS,
  MOOD_SURFACE_CSS_KEYS,
  materialOverridesToCSS,
  moodPresetToCSS,
  normalizeMoodPreset,
  sakuraMaterialOverridesToCSS,
  sanitizeSakuraMaterialOverrides,
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
      "aether-crystal",
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

  it("keeps mood glass presets translucent while preserving pane hierarchy", () => {
    const darkRanges = {
      "--glass-clear": 0.02,
      "--glass-ground": [0.32, 0.42],
      "--glass-frame": [0.26, 0.36],
      "--glass-standard": [0.34, 0.44],
      "--glass-dense": [0.42, 0.52],
      "--glass-thick": [0.48, 0.58],
    } as const;
    const lightCeilings = {
      "--glass-clear": 0.4,
      "--glass-ground": 0.78,
      "--glass-frame": 0.84,
      "--glass-standard": 0.76,
      "--glass-dense": 0.82,
      "--glass-thick": 0.88,
    } as const;
    const crystalRanges = {
      "--glass-ground": [0.16, 0.24],
      "--glass-frame": [0.12, 0.2],
      "--glass-standard": [0.2, 0.28],
      "--glass-dense": [0.26, 0.34],
      "--glass-thick": [0.32, 0.4],
    } as const;

    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      if (preset.id === "aether-sakura") {
        for (const [key, ceiling] of Object.entries(lightCeilings)) {
          expect(rgbaAlpha(vars[key]), `${preset.id} ${key}`).toBeLessThanOrEqual(ceiling);
        }
        continue;
      }
      if (preset.id === "aether-crystal") {
        expect(rgbaAlpha(vars["--glass-clear"]), `${preset.id} --glass-clear`).toBeLessThanOrEqual(
          darkRanges["--glass-clear"],
        );
        for (const [key, [floor, ceiling]] of Object.entries(crystalRanges)) {
          const alpha = rgbaAlpha(vars[key]);
          expect(alpha, `${preset.id} ${key} floor`).toBeGreaterThanOrEqual(floor);
          expect(alpha, `${preset.id} ${key} ceiling`).toBeLessThanOrEqual(ceiling);
        }
        continue;
      }
      expect(rgbaAlpha(vars["--glass-clear"]), `${preset.id} --glass-clear`).toBeLessThanOrEqual(
        darkRanges["--glass-clear"],
      );
      const paneRanges = [
        ["--glass-ground", darkRanges["--glass-ground"]],
        ["--glass-frame", darkRanges["--glass-frame"]],
        ["--glass-standard", darkRanges["--glass-standard"]],
        ["--glass-dense", darkRanges["--glass-dense"]],
        ["--glass-thick", darkRanges["--glass-thick"]],
      ] as const;
      for (const [key, [floor, ceiling]] of paneRanges) {
        const alpha = rgbaAlpha(vars[key]);
        expect(alpha, `${preset.id} ${key} floor`).toBeGreaterThanOrEqual(floor);
        expect(alpha, `${preset.id} ${key} ceiling`).toBeLessThanOrEqual(ceiling);
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

  it("defines Aether Crystal as a clearer glass preset without dimming glyphs", () => {
    const vars = moodPresetToCSS("aether-crystal");

    expect(normalizeMoodPreset("aether-crystal")).toBe("aether-crystal");
    expect(vars["--accent"]).toBe("#8be9ff");
    expect(vars["--gold"]).toBe("#d8f7ff");
    expect(vars["--text-primary"]).toBe("#f8fdff");
    expect(vars["--mood-left-panel-bg"]).toContain("rgba(5, 24, 40, 0.22)");
    expect(vars["--mood-right-panel-bg"]).toContain("rgba(5, 24, 40, 0.28)");
    expect(vars["--settings-card-bg"]).toContain("0.28");
    expect(vars["--terminal-canvas-bg"]).toBe(DEFAULT_BG);
    expect(rgbaAlpha(vars["--glass-standard"])).toBeLessThanOrEqual(0.28);
    expect(Number(vars["--mood-root-texture-opacity"])).toBeLessThanOrEqual(0.03);
  });

  it("keeps Aether Pro graphite deep instead of cloudy grey", () => {
    const vars = moodPresetToCSS("aether-pro");

    expect(vars["--chrome-frame-bg"]).toContain("rgba(2, 8, 16, 0.42)");
    expect(vars["--mood-left-panel-bg"]).toContain("rgba(4, 13, 23, 0.42)");
    expect(vars["--mood-right-panel-bg"]).toContain("rgba(4, 13, 23, 0.48)");
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
    expect(rgbaAlpha(vars["--glass-standard"])).toBeGreaterThanOrEqual(0.64);
    expect(rgbaAlpha(vars["--terminal-canvas-bg"])).toBeLessThanOrEqual(0.56);
    expect(vars["--toolkit-tile-bg"]).not.toContain("0, 7, 15");
    expect(vars["--statusbar-bg"]).toContain("255, 238, 247");
    expect(rgbaAlpha(vars["--settings-card-bg"])).toBeGreaterThanOrEqual(0.72);
  });

  it("keeps Aether Sakura rails as white-peach material instead of grey glass", () => {
    const vars = moodPresetToCSS("aether-sakura");

    expect(vars["--mood-left-panel-bg"]).toContain("255, 241, 248");
    expect(vars["--mood-right-panel-bg"]).toContain("255, 241, 248");
    expect(rgbaAlpha(vars["--statusbar-bg"])).toBeGreaterThanOrEqual(0.8);
    expect(vars["--glass-ground"]).toContain("255, 243, 249");
    expect(vars["--glass-frame"]).toContain("255, 241, 248");
    expect(rgbaAlpha(vars["--glass-ground"])).toBeGreaterThanOrEqual(0.56);
    expect(vars["--mood-left-panel-bg"]).not.toContain("97, 37, 61");
    expect(vars["--mood-right-panel-bg"]).not.toContain("4, 13, 23");
  });

  it("sanitizes Sakura material controls and emits custom white-peach surfaces", () => {
    const sanitized = sanitizeSakuraMaterialOverrides({
      panelColor: "#FFFAFC",
      terminalAlpha: 9,
      chromeAlpha: 0.4,
      unknown: "#000000",
    });

    expect(sanitized).toEqual({
      panelColor: "#fffafc",
      terminalAlpha: 0.9,
      chromeAlpha: 0.4,
    });

    const vars = sakuraMaterialOverridesToCSS({ panelColor: "#fffafc", panelAlpha: 0.94, terminalAlpha: 0.48 });
    expect(vars["--mood-left-panel-bg"]).toContain("255, 250, 252");
    expect(vars["--mood-left-panel-bg"]).toContain("0.94");
    expect(vars["--terminal-canvas-bg"]).toContain("0.48");
  });

  it("switches custom material text to dark ink when a dark preset is tuned to pale surfaces", () => {
    const vars = materialOverridesToCSS(
      { panelColor: "#fff1f8", chromeColor: "#ffeef7", panelAlpha: 0.88, chromeAlpha: 0.84 },
      MOOD_MATERIAL_DEFAULTS["aether-sky"],
    );

    expect(vars["--text-primary"]).toBe("#24121b");
    expect(contrastRatio(vars["--text-primary"], "#fff1f8")).toBeGreaterThanOrEqual(10);
    expect(vars["--toolkit-tile-text"]).toBe("#24121b");
  });

  it("does not switch low-opacity pale material to light text mode", () => {
    expect(
      isMoodMaterialLight("aether-sky", {
        panelColor: "#fff1f8",
        chromeColor: "#ffeef7",
        panelAlpha: 0.18,
        chromeAlpha: 0.16,
      }),
    ).toBe(false);
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

  it("keeps chrome text tokens solid instead of opacity-dimming glyphs", () => {
    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      expect(vars["--text-primary"], `${preset.id} primary`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(vars["--text-secondary"], `${preset.id} secondary`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(vars["--text-muted"], `${preset.id} muted`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps core chrome text contrast readable across every mood", () => {
    const checks = [
      { fg: "--text-primary", bg: "--mood-left-panel-bg", min: 4.5 },
      { fg: "--text-primary", bg: "--mood-right-panel-bg", min: 4.5 },
      { fg: "--text-primary", bg: "--settings-card-bg", min: 4.5 },
      { fg: "--text-primary", bg: "--toolkit-tile-bg", min: 4.5 },
      { fg: "--text-secondary", bg: "--mood-widget-bg", min: 3 },
      { fg: "--text-muted", bg: "--statusbar-bg", min: 3 },
    ] as const;

    for (const preset of MOOD_PRESETS) {
      const vars = moodPresetToCSS(preset.id);
      for (const check of checks) {
        const fg = resolveTokenColor(vars, vars[check.fg]);
        const bg = resolveTokenColor(vars, vars[check.bg]);
        expect(
          contrastRatioFromRgb(fg.rgb, bg.rgb),
          `${preset.id} ${check.fg} on ${check.bg}: ${formatRgb(fg.rgb)} / ${formatRgb(bg.rgb)}`,
        ).toBeGreaterThanOrEqual(check.min);
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

function contrastRatioFromRgb(a: [number, number, number], b: [number, number, number]): number {
  const lighter = Math.max(relativeLuminanceRgb(a), relativeLuminanceRgb(b));
  const darker = Math.min(relativeLuminanceRgb(a), relativeLuminanceRgb(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  return relativeLuminanceRgb(hexToRgb(hex));
}

function relativeLuminanceRgb(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
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

function resolveTokenColor(vars: Record<string, string>, raw: string): { rgb: [number, number, number] } {
  let value = raw;
  for (let i = 0; i < 8; i += 1) {
    const next = value.replace(/var\((--[^),\s]+)(?:,[^)]+)?\)/g, (_match, key: string) => vars[key] ?? "");
    if (next === value) break;
    value = next;
  }

  const colorMatches = Array.from(
    value.matchAll(
      /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/gi,
    ),
  );
  if (colorMatches.length === 0) {
    throw new Error(`Expected color token, received ${raw}`);
  }

  const match = colorMatches[colorMatches.length - 1];
  if (match[0].startsWith("#")) {
    return { rgb: hexToRgb(normalizeHex(match[0])) };
  }
  return {
    rgb: [Math.round(Number(match[1])), Math.round(Number(match[2])), Math.round(Number(match[3]))],
  };
}

function formatRgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}
