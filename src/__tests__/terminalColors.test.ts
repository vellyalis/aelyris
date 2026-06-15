import { describe, expect, it } from "vitest";
import {
  compositeOverFallback,
  contrastRatio,
  dimAlphaForTextClarity,
  enhanceTerminalTextColor,
  forceOpaqueCssColor,
  minimumTerminalContrastRatio,
  parseCssRgbColor,
} from "../features/terminal/terminalColors";

describe("parseCssRgbColor", () => {
  it("parses 3- and 6-digit hex", () => {
    expect(parseCssRgbColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssRgbColor("#ff8800")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it("parses rgb() and rgba()", () => {
    expect(parseCssRgbColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssRgbColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("clamps out-of-range channels and alpha", () => {
    expect(parseCssRgbColor("rgb(300, -5, 10)")).toEqual({ r: 255, g: 0, b: 10, a: 1 });
    expect(parseCssRgbColor("rgba(0, 0, 0, 4)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("returns null for formats it cannot resolve", () => {
    expect(parseCssRgbColor("color-mix(in srgb, red, blue)")).toBeNull();
    expect(parseCssRgbColor("oklch(0.7 0.1 200)")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("reports the WCAG black/white extreme", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
  });

  it("is 1 for identical colours", () => {
    expect(contrastRatio({ r: 90, g: 90, b: 90 }, { r: 90, g: 90, b: 90 })).toBeCloseTo(1, 5);
  });
});

describe("compositeOverFallback", () => {
  it("returns the colour untouched when fully opaque", () => {
    expect(compositeOverFallback({ r: 10, g: 20, b: 30, a: 1 })).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it("blends translucent colours toward the fallback background", () => {
    const blended = compositeOverFallback({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 });
    expect(blended).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });
});

describe("forceOpaqueCssColor", () => {
  it("forces an rgba alpha to 1", () => {
    expect(forceOpaqueCssColor("rgba(10, 20, 30, 0.4)")).toBe("rgba(10, 20, 30, 1)");
  });

  it("normalises hex to rgb()", () => {
    expect(forceOpaqueCssColor("#abc")).toBe("rgb(170, 187, 204)");
  });

  it("passes through formats it cannot parse", () => {
    expect(forceOpaqueCssColor("color-mix(in srgb, red, blue)")).toBe("color-mix(in srgb, red, blue)");
  });
});

describe("text-clarity tuning", () => {
  it("maps clarity to its contrast floor and dim alpha", () => {
    expect(minimumTerminalContrastRatio("solid")).toBe(7);
    expect(minimumTerminalContrastRatio("balanced")).toBe(5.5);
    expect(minimumTerminalContrastRatio("glass")).toBe(0);
    expect(dimAlphaForTextClarity("solid")).toBe(0.78);
    expect(dimAlphaForTextClarity("balanced")).toBe(0.68);
    expect(dimAlphaForTextClarity("glass")).toBe(0.6);
  });
});

describe("enhanceTerminalTextColor", () => {
  it("leaves colours untouched in glass mode (no contrast floor)", () => {
    expect(enhanceTerminalTextColor("#222222", "#000000", "glass")).toBe("#222222");
  });

  it("leaves already-legible colours untouched", () => {
    expect(enhanceTerminalTextColor("#ffffff", "#000000", "solid")).toBe("#ffffff");
  });

  it("passes through colours it cannot parse", () => {
    expect(enhanceTerminalTextColor("var(--ctp-text)", "#000000", "solid")).toBe("var(--ctp-text)");
  });

  it("boosts a low-contrast colour until it clears the solid floor", () => {
    const boosted = enhanceTerminalTextColor("#222222", "#000000", "solid");
    expect(boosted).not.toBe("#222222");

    const fg = parseCssRgbColor(boosted);
    const bg = parseCssRgbColor("#000000");
    expect(fg).not.toBeNull();
    expect(bg).not.toBeNull();
    if (!fg || !bg) return;
    expect(contrastRatio(compositeOverFallback(fg), compositeOverFallback(bg))).toBeGreaterThanOrEqual(7);
  });
});
