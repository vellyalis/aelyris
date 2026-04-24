/**
 * ANSI 256-color palette resolver for the native terminal renderer
 * (Phase 2 / Task 7).
 *
 * Mirrors the NamedColor discriminants emitted by `src-tauri/src/term/snapshot.rs`
 * (see vte-0.15 `NamedColor` enum):
 *   0..=15   basic + bright (Black..BrightWhite)
 *   256      Foreground
 *   257      Background
 *   258      Cursor
 *   259..=266 DimBlack..DimWhite
 *   267      BrightForeground
 *   268      DimForeground
 *
 * For the 256-color palette: 0..=15 map to the Catppuccin Mocha ANSI slots,
 * 16..=231 to the standard 6×6×6 xterm cube, 232..=255 to the 24-step
 * grayscale ramp.
 */

import { ColorKind, decodeColor, type TerminalColor } from "../types/terminal";

export const DEFAULT_FG = "#cdd6f4"; // Catppuccin Mocha text
export const DEFAULT_BG = "#1e1e2e"; // Catppuccin Mocha base
export const CURSOR_COLOR = "#cba6f7"; // Catppuccin Mocha mauve
export const SELECTION_BG = "#585b70"; // Catppuccin Mocha surface2
export const SEARCH_MATCH_BG = "#f9e2af"; // Catppuccin Mocha yellow
export const SEARCH_ACTIVE_BG = "#fab387"; // Catppuccin Mocha peach
export const LINK_HOVER_FG = "#89b4fa"; // Catppuccin Mocha blue
export const BRIGHT_FG = "#ffffff";
export const DIM_FG = "#7f849c"; // Catppuccin Mocha overlay1

const CATPPUCCIN_ANSI_16: readonly string[] = [
  "#45475a", // 0  Black       — surface1
  "#f38ba8", // 1  Red
  "#a6e3a1", // 2  Green
  "#f9e2af", // 3  Yellow
  "#89b4fa", // 4  Blue
  "#f5c2e7", // 5  Magenta     — pink
  "#94e2d5", // 6  Cyan        — teal
  "#bac2de", // 7  White       — subtext1
  "#585b70", // 8  BrightBlack — surface2
  "#f38ba8", // 9  BrightRed
  "#a6e3a1", // 10 BrightGreen
  "#f9e2af", // 11 BrightYellow
  "#89b4fa", // 12 BrightBlue
  "#f5c2e7", // 13 BrightMagenta
  "#94e2d5", // 14 BrightCyan
  "#a6adc8", // 15 BrightWhite — subtext0
];

const NAMED = {
  FOREGROUND: 256,
  BACKGROUND: 257,
  CURSOR: 258,
  DIM_BLACK: 259,
  DIM_WHITE: 266,
  BRIGHT_FOREGROUND: 267,
  DIM_FOREGROUND: 268,
} as const;

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function rgbToCss(r: number, g: number, b: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function indexedToCss(index: number): string {
  if (index < 16) return CATPPUCCIN_ANSI_16[index];
  if (index < 232) {
    const n = index - 16;
    const r = CUBE_STEPS[Math.floor(n / 36) % 6];
    const g = CUBE_STEPS[Math.floor(n / 6) % 6];
    const b = CUBE_STEPS[n % 6];
    return rgbToCss(r, g, b);
  }
  // 232..=255 — 24-step grayscale ramp
  const step = index - 232;
  const level = 8 + step * 10;
  return rgbToCss(level, level, level);
}

function namedToCss(named: number, isFg: boolean): string {
  if (named < 16) return CATPPUCCIN_ANSI_16[named];
  switch (named) {
    case NAMED.FOREGROUND:
      return DEFAULT_FG;
    case NAMED.BACKGROUND:
      return DEFAULT_BG;
    case NAMED.CURSOR:
      return CURSOR_COLOR;
    case NAMED.BRIGHT_FOREGROUND:
      return BRIGHT_FG;
    case NAMED.DIM_FOREGROUND:
      return DIM_FG;
    default:
      if (named >= NAMED.DIM_BLACK && named <= NAMED.DIM_WHITE) {
        return CATPPUCCIN_ANSI_16[named - NAMED.DIM_BLACK];
      }
      return isFg ? DEFAULT_FG : DEFAULT_BG;
  }
}

/**
 * Resolve a packed color (as carried in `CellSnapshot.fg` / `.bg`) to a CSS
 * color string. `isFg` is used to pick a sensible fallback when a Named slot
 * doesn't have a direct mapping.
 */
export function resolveColor(packed: number, isFg: boolean): string {
  const decoded: TerminalColor = decodeColor(packed);
  switch (decoded.kind) {
    case ColorKind.RGB:
      return rgbToCss(decoded.r, decoded.g, decoded.b);
    case ColorKind.INDEXED:
      return indexedToCss(decoded.index);
    case ColorKind.NAMED:
      return namedToCss(decoded.named, isFg);
    default:
      return isFg ? DEFAULT_FG : DEFAULT_BG;
  }
}

/** `true` when the packed color is the Named Background sentinel (257). */
export function isDefaultBg(packed: number): boolean {
  const decoded = decodeColor(packed);
  return decoded.kind === ColorKind.NAMED && decoded.named === NAMED.BACKGROUND;
}

/** `true` when the packed color is the Named Foreground sentinel (256). */
export function isDefaultFg(packed: number): boolean {
  const decoded = decodeColor(packed);
  return decoded.kind === ColorKind.NAMED && decoded.named === NAMED.FOREGROUND;
}
