import { CellAttr, ColorKind, type CellSnapshot, type GridSnapshot, type ImageRef } from "../../../shared/types/terminal";
import type { LinkSpan } from "../links";
import type { AnyMatch } from "../search";

const NAMED_FG = 256;
const NAMED_BG = 257;

export interface RendererFixtureImage {
  id: number;
  widthPx: number;
  heightPx: number;
  pattern: "checker" | "stripes";
}

export interface RendererFixture {
  id: string;
  label: string;
  snapshot: GridSnapshot;
  rasterBackground: string;
  searchMatches?: AnyMatch[];
  activeSearchMatch?: AnyMatch | null;
  selectionBands?: Record<number, { startCol: number; endColExclusive: number }>;
  hoveredLink?: LinkSpan | null;
  ghostSuggestion?: string | null;
  images?: RendererFixtureImage[];
  opaqueSampleCells?: Array<{ row: number; col: number }>;
}

export function namedColor(named: number): number {
  return (ColorKind.NAMED << 24) | named;
}

export function rgbColor(r: number, g: number, b: number): number {
  return (ColorKind.RGB << 24) | (r << 16) | (g << 8) | b;
}

export function indexedColor(index: number): number {
  return (ColorKind.INDEXED << 24) | index;
}

function cell(ch = " ", attrs = 0, fg = namedColor(NAMED_FG), bg = namedColor(NAMED_BG)): CellSnapshot {
  return { ch, fg, bg, attrs };
}

function blankRow(cols: number): CellSnapshot[] {
  return Array.from({ length: cols }, () => cell());
}

function blankSnapshot(cols: number, rows: number): GridSnapshot {
  return {
    cols,
    rows,
    cells: Array.from({ length: rows }, () => blankRow(cols)),
    cursor: { row: Math.max(0, rows - 1), col: 0, shape: "block", blinking: false, visible: true },
  };
}

function writeText(
  snapshot: GridSnapshot,
  row: number,
  col: number,
  text: string,
  attrs = 0,
  fg = namedColor(NAMED_FG),
  bg = namedColor(NAMED_BG),
) {
  let x = col;
  for (const ch of Array.from(text)) {
    if (x >= snapshot.cols) break;
    const wide = /[\u3000-\u9fff]/u.test(ch);
    snapshot.cells[row][x] = cell(ch, attrs | (wide ? CellAttr.WIDE_CHAR : 0), fg, bg);
    if (wide && x + 1 < snapshot.cols) {
      snapshot.cells[row][x + 1] = cell(" ", CellAttr.WIDE_CHAR_SPACER, fg, bg);
      x += 2;
    } else {
      x += 1;
    }
  }
}

function denseAsciiFixture(): RendererFixture {
  const snapshot = blankSnapshot(48, 12);
  const glyphs = "Aelyris Qralis 0123456789 <>[]{} $PATH ./src";
  for (let row = 0; row < snapshot.rows; row++) {
    const text = `${row.toString().padStart(2, "0")} ${glyphs}`.padEnd(snapshot.cols, ".");
    writeText(snapshot, row, 0, text.slice(0, snapshot.cols));
  }
  snapshot.cursor = { row: 10, col: 7, shape: "block", blinking: false, visible: true };
  return {
    id: "dense-ascii",
    label: "Dense ASCII grid",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
    opaqueSampleCells: [
      { row: 0, col: 3 },
      { row: 5, col: 12 },
    ],
  };
}

function cjkWideFixture(): RendererFixture {
  const snapshot = blankSnapshot(36, 8);
  writeText(snapshot, 0, 0, "Aelyris 日本語 Cycle Master");
  writeText(snapshot, 1, 0, "wide: 表計算 財務 監査");
  writeText(snapshot, 2, 0, "emoji-like width guard: 漢字仮名");
  writeText(snapshot, 4, 2, "███ opaque sample blocks", CellAttr.BOLD, rgbColor(244, 244, 245));
  snapshot.cursor = { row: 4, col: 4, shape: "hollowBlock", blinking: false, visible: true };
  return {
    id: "cjk-wide",
    label: "CJK and wide-cell spacers",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
    opaqueSampleCells: [{ row: 4, col: 3 }],
  };
}

function heavySgrFixture(): RendererFixture {
  const snapshot = blankSnapshot(42, 10);
  writeText(snapshot, 0, 0, "bold underline truecolor reverse dim strike");
  writeText(snapshot, 2, 0, "bold green", CellAttr.BOLD, rgbColor(166, 227, 161));
  writeText(snapshot, 3, 0, "underline blue", CellAttr.UNDERLINE, rgbColor(137, 180, 250));
  writeText(snapshot, 4, 0, "reverse yellow", CellAttr.INVERSE, rgbColor(249, 226, 175), rgbColor(17, 24, 39));
  writeText(snapshot, 5, 0, "dim red", CellAttr.DIM, rgbColor(248, 113, 113));
  writeText(snapshot, 6, 0, "strike indexed", CellAttr.STRIKEOUT, indexedColor(45));
  writeText(snapshot, 8, 0, "hidden should leave backing", CellAttr.HIDDEN, rgbColor(255, 255, 255));
  snapshot.cursor = { row: 3, col: 10, shape: "underline", blinking: false, visible: true };
  return {
    id: "heavy-sgr",
    label: "SGR attrs and truecolor runs",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
    opaqueSampleCells: [{ row: 2, col: 1 }],
  };
}

function overlaysFixture(): RendererFixture {
  const snapshot = blankSnapshot(52, 10);
  writeText(snapshot, 0, 0, "selection search links ghost cursor variants");
  writeText(snapshot, 2, 2, "select this command output region");
  writeText(snapshot, 4, 2, "search target target target");
  writeText(snapshot, 6, 2, "https://aelyris.local/docs");
  writeText(snapshot, 8, 2, "prompt> ");
  snapshot.cursor = { row: 8, col: 9, shape: "beam", blinking: false, visible: true };
  return {
    id: "overlays",
    label: "Selection, search, link, ghost, cursor overlays",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
    searchMatches: [
      { row: 4, startCol: 9, endCol: 14 },
      { row: 4, startCol: 16, endCol: 21 },
    ],
    activeSearchMatch: { row: 4, startCol: 16, endCol: 21 },
    selectionBands: {
      2: { startCol: 2, endColExclusive: 21 },
    },
    hoveredLink: { url: "https://aelyris.local/docs", startRow: 6, startCol: 2, endRow: 6, endCol: 27 },
    ghostSuggestion: "pnpm verify:renderer:parity",
    opaqueSampleCells: [{ row: 0, col: 1 }],
  };
}

function imageFixture(): RendererFixture {
  const snapshot = blankSnapshot(40, 10);
  writeText(snapshot, 0, 0, "inline image cell overlay fixture");
  writeText(snapshot, 6, 4, "image should paint above cells");
  const imageRef: ImageRef = { id: 9001, cellRow: 2, cellCol: 6, widthPx: 32, heightPx: 24, cellW: 5, cellH: 3 };
  snapshot.images = [imageRef];
  snapshot.cursor = { row: 7, col: 4, shape: "block", blinking: false, visible: true };
  return {
    id: "image-cells",
    label: "Inline image cell overlay",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
    images: [{ id: imageRef.id, widthPx: 32, heightPx: 24, pattern: "checker" }],
    opaqueSampleCells: [{ row: 0, col: 1 }],
  };
}

export function createDenseAsciiSnapshot(cols: number, rows: number): GridSnapshot {
  const snapshot = blankSnapshot(cols, rows);
  const rowSeed = "Aelyris renderer baseline abcdefghijklmnopqrstuvwxyz 0123456789 ";
  for (let row = 0; row < rows; row++) {
    const shifted = `${row.toString().padStart(3, "0")} ${rowSeed.repeat(Math.ceil(cols / rowSeed.length) + 1)}`;
    writeText(snapshot, row, 0, shifted.slice(0, cols), row % 7 === 0 ? CellAttr.BOLD : 0);
  }
  snapshot.cursor = { row: rows - 1, col: Math.min(cols - 1, 12), shape: "block", blinking: false, visible: true };
  return snapshot;
}

export const rendererFixtures: RendererFixture[] = [
  denseAsciiFixture(),
  cjkWideFixture(),
  heavySgrFixture(),
  overlaysFixture(),
  imageFixture(),
];
