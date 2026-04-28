import { describe, expect, it } from "vitest";

import { DEFAULT_BG, DEFAULT_FG, isDefaultBg, isDefaultFg, resolveColor } from "../shared/lib/ansiPalette";

// Packed color encoding (must mirror src-tauri/src/term/snapshot.rs).
function packNamed(index: number): number {
  return (0 << 24) | (index & 0x00ff_ffff);
}

function packRgb(r: number, g: number, b: number): number {
  return (1 << 24) | (r << 16) | (g << 8) | b;
}

function packIndexed(i: number): number {
  return (2 << 24) | (i & 0xff);
}

describe("resolveColor", () => {
  it("keeps the default terminal canvas on the recessed black stage", () => {
    expect(DEFAULT_BG).toBe("#07080d");
  });

  it("maps NamedColor 0..15 to Catppuccin ANSI slots", () => {
    expect(resolveColor(packNamed(0), true)).toBe("#45475a"); // Black
    expect(resolveColor(packNamed(1), true)).toBe("#f38ba8"); // Red
    expect(resolveColor(packNamed(4), true)).toBe("#89b4fa"); // Blue
    expect(resolveColor(packNamed(15), true)).toBe("#a6adc8"); // BrightWhite
  });

  it("maps Named Foreground / Background sentinels", () => {
    expect(resolveColor(packNamed(256), true)).toBe(DEFAULT_FG);
    expect(resolveColor(packNamed(257), false)).toBe(DEFAULT_BG);
  });

  it("maps Dim slots back to the base ANSI swatch", () => {
    // DimRed (260) → same as Red (1)
    expect(resolveColor(packNamed(260), true)).toBe("#f38ba8");
  });

  it("decodes RGB truecolor", () => {
    expect(resolveColor(packRgb(0, 0, 0), true)).toBe("#000000");
    expect(resolveColor(packRgb(0xde, 0xad, 0xbe), true)).toBe("#deadbe");
  });

  it("decodes indexed cube entries", () => {
    // Index 16 = 6×6×6 cube start = (0,0,0) = black
    expect(resolveColor(packIndexed(16), true)).toBe("#000000");
    // Index 231 = cube end = (255,255,255) = white
    expect(resolveColor(packIndexed(231), true)).toBe("#ffffff");
  });

  it("decodes indexed grayscale ramp", () => {
    // Index 232 = 8/8/8
    expect(resolveColor(packIndexed(232), true)).toBe("#080808");
    // Index 255 = 238/238/238 (8 + 23*10)
    expect(resolveColor(packIndexed(255), true)).toBe("#eeeeee");
  });

  it("indexed 0..15 falls back to the Catppuccin swatches", () => {
    expect(resolveColor(packIndexed(1), true)).toBe("#f38ba8");
  });
});

describe("isDefaultBg / isDefaultFg", () => {
  it("detects the Background sentinel", () => {
    expect(isDefaultBg(packNamed(257))).toBe(true);
    expect(isDefaultBg(packNamed(0))).toBe(false);
    expect(isDefaultBg(packRgb(0, 0, 0))).toBe(false);
  });

  it("detects the Foreground sentinel", () => {
    expect(isDefaultFg(packNamed(256))).toBe(true);
    expect(isDefaultFg(packNamed(7))).toBe(false);
  });
});
