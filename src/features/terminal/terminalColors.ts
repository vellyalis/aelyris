/**
 * Pure colour + WCAG-contrast helpers for the terminal canvas renderer.
 *
 * Extracted from `TerminalCanvas` so this maths is unit-testable without a
 * canvas 2D context and so the 1900-line renderer shrinks toward the
 * 800-line budget. Nothing here touches the DOM or React — callers pass CSS
 * colour strings in and get CSS colour strings (or parsed structs) back.
 */
import type { TerminalTextClarity } from "../../shared/store/appStore";

export type RgbColor = { r: number; g: number; b: number };
export type RgbaColor = RgbColor & { a: number };

/** Background composited under translucent cell colours for contrast maths. */
export const TERMINAL_CONTRAST_FALLBACK_BG: RgbColor = { r: 3, g: 10, b: 22 };

export function forceOpaqueCssColor(color: string): string {
  const rgba = color.match(/^rgba\((.*),\s*(0|0?\.\d+|1(?:\.0+)?)\s*\)$/i);
  if (rgba) return `rgba(${rgba[1]}, 1)`;
  // Also normalize hex / rgb() / loosely formatted rgba() values; formats
  // parseCssRgbColor cannot resolve (color-mix, oklch, ...) pass through.
  const parsed = parseCssRgbColor(color);
  if (parsed) return rgbToCanvasCss(parsed);
  return color;
}

export function parseCssRgbColor(color: string): RgbaColor | null {
  const text = color.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    if (value.length === 3) {
      return {
        r: Number.parseInt(value[0] + value[0], 16),
        g: Number.parseInt(value[1] + value[1], 16),
        b: Number.parseInt(value[2] + value[2], 16),
        a: 1,
      };
    }
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgba = text.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgba) return null;
  const parts = rgba[1].split(",").map((part) => part.trim());
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  const a = parts[3] == null ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
    a: Math.min(1, Math.max(0, a)),
  };
}

export function compositeOverFallback(color: RgbaColor, fallback: RgbColor = TERMINAL_CONTRAST_FALLBACK_BG): RgbColor {
  if (color.a >= 1) return color;
  const inverseAlpha = 1 - color.a;
  return {
    r: color.r * color.a + fallback.r * inverseAlpha,
    g: color.g * color.a + fallback.g * inverseAlpha,
    b: color.b * color.a + fallback.b * inverseAlpha,
  };
}

function linearizeChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function rgbToCanvasCss({ r, g, b }: RgbColor): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function mixRgbColor(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  const keep = 1 - amount;
  return {
    r: source.r * keep + target.r * amount,
    g: source.g * keep + target.g * amount,
    b: source.b * keep + target.b * amount,
  };
}

export function minimumTerminalContrastRatio(textClarity: TerminalTextClarity): number {
  if (textClarity === "solid") return 7;
  if (textClarity === "balanced") return 5.5;
  return 0;
}

export function dimAlphaForTextClarity(textClarity: TerminalTextClarity): number {
  if (textClarity === "solid") return 0.78;
  if (textClarity === "balanced") return 0.68;
  return 0.6;
}

export function enhanceTerminalTextColor(color: string, background: string, textClarity: TerminalTextClarity): string {
  const minimumContrast = minimumTerminalContrastRatio(textClarity);
  if (minimumContrast <= 0) return color;

  const fg = parseCssRgbColor(color);
  const bg = parseCssRgbColor(background);
  if (!fg || !bg) return color;

  const fgRgb = compositeOverFallback(fg);
  const bgRgb = compositeOverFallback(bg);
  if (contrastRatio(fgRgb, bgRgb) >= minimumContrast) return color;

  const target = relativeLuminance(bgRgb) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const step = textClarity === "solid" ? 0.08 : 0.12;
  for (let amount = step; amount <= 0.92; amount += step) {
    const candidate = mixRgbColor(fgRgb, target, amount);
    if (contrastRatio(candidate, bgRgb) >= minimumContrast) {
      return rgbToCanvasCss(candidate);
    }
  }

  return rgbToCanvasCss(mixRgbColor(fgRgb, target, 0.92));
}
