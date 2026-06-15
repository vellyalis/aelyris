/**
 * Canvas 2D paint primitives for the terminal renderer.
 *
 * Pure move out of TerminalCanvas: each function takes a
 * CanvasRenderingContext2D plus already-computed geometry/colours and draws
 * one layer (row glyphs, search bands, link/selection underlines, ghost text,
 * inline images, cursor). They are not unit-testable under jsdom (no real 2D
 * context); the mounted-component tests exercise them through a mocked ctx.
 * Behaviour is identical to the inline versions — this module only relocates
 * them so the renderer shrinks toward the 800-line budget.
 */
import {
  CURSOR_COLOR,
  CURSOR_TEXT_BG,
  DEFAULT_FG,
  isDefaultBg,
  LINK_HOVER_FG,
  resolveColor,
  SEARCH_ACTIVE_BG,
  SEARCH_MATCH_BG,
  SELECTION_BG,
} from "../../shared/lib/ansiPalette";
import type { TerminalTextClarity } from "../../shared/store/appStore";
import { CellAttr, type CellSnapshot, type GridSnapshot, hasAttr, type ImageRef } from "../../shared/types/terminal";
import { isVisibleCursor, shouldClampGlyphToCell } from "./aiInputAnchor";
import type { LinkSpan } from "./links";
import { type AnyMatch, viewportRowOf } from "./search";
import { snapCanvasTextCoord } from "./terminalCanvasGeometry";
import { dimAlphaForTextClarity, enhanceTerminalTextColor } from "./terminalColors";
import type { TerminalCellMetrics } from "./terminalMetrics";
import { matchAnchor } from "./terminalRowDirty";

/* Single source of truth for the "underline" baseline (character
 * underline, link-hover underline, cursor's underline-shape). All
 * three previously rendered at slightly different y offsets — the
 * link rule was 1 px lower than the character rule, and the cursor
 * shape was 2 px tall instead of 1 — so a hovered link sitting on
 * an SGR-underlined word produced a visible double-bar. */
const UNDERLINE_INSET_FROM_BOTTOM = 2;

function buildFont(cell: CellSnapshot, fontSize: number, fontFamily: string): string {
  const bold = hasAttr(cell, CellAttr.BOLD);
  const italic = hasAttr(cell, CellAttr.ITALIC);
  const weight = bold ? "bold " : "";
  const style = italic ? "italic " : "";
  return `${style}${weight}${fontSize}px ${fontFamily}`;
}

export function paintRow(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  row: number,
  metrics: TerminalCellMetrics,
  fontSize: number,
  fontFamily: string,
  devicePixelRatio: number,
  rasterBackground: string,
  textClarity: TerminalTextClarity,
) {
  const { width, height } = metrics;
  const y = row * height;

  // Clear stale glyph pixels, then paint an in-canvas raster backing before
  // text. Drawing glyphs directly into a transparent bitmap makes WebView2
  // composite antialiased edges against Acrylic/wallpaper twice, which is why
  // terminal text looked softer than ordinary DOM preview text.
  ctx.globalAlpha = 1;
  ctx.clearRect?.(0, y, cells.length * width, height);
  ctx.fillStyle = rasterBackground;
  ctx.fillRect(0, y, cells.length * width, height);

  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];

    // Wide-char spacer occupies the second column of a 2-wide glyph —
    // paint nothing so the wide glyph from the previous cell isn't covered.
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;

    const inverse = hasAttr(cell, CellAttr.INVERSE);
    const hidden = hasAttr(cell, CellAttr.HIDDEN);
    const dim = hasAttr(cell, CellAttr.DIM);

    let fgCss = resolveColor(cell.fg, true);
    let bgCss = resolveColor(cell.bg, false);
    if (inverse) {
      const tmp = fgCss;
      fgCss = bgCss;
      bgCss = tmp;
    }

    const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
    const cellW = wide ? width * 2 : width;

    const hasCustomBg = inverse || !isDefaultBg(cell.bg);
    if (hasCustomBg) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = bgCss;
      ctx.fillRect(col * width, y, cellW, height);
    }

    if (hidden) continue;
    const ch = cell.ch;
    const x = col * width;
    if (ch === " " || ch === "\0") {
      drawDecorations(ctx, cell, x, y, cellW, height, fgCss, dim);
      continue;
    }

    const contrastBackground = hasCustomBg ? bgCss : rasterBackground;
    const readableFgCss = enhanceTerminalTextColor(fgCss, contrastBackground, textClarity);
    ctx.globalAlpha = dim ? dimAlphaForTextClarity(textClarity) : 1;
    ctx.font = buildFont(cell, fontSize, fontFamily);
    ctx.fillStyle = readableFgCss;
    const glyphX = snapCanvasTextCoord(x, devicePixelRatio);
    const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
    /* Clamp only glyphs that can genuinely exceed their terminal cell
     * (CJK/full-width/fallback glyphs). Passing maxWidth for every ASCII
     * cell makes WebView2 horizontally resample ordinary monospace text,
     * which reads softer than native terminal text. */
    if (shouldClampGlyphToCell(cell, ch)) {
      ctx.fillText(ch, glyphX, glyphY, cellW);
    } else {
      ctx.fillText(ch, glyphX, glyphY);
    }

    drawDecorations(ctx, cell, x, y, cellW, height, readableFgCss, dim);
  }
  ctx.globalAlpha = 1;
}

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  cell: CellSnapshot,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  fgCss: string,
  dim: boolean,
) {
  const underline = hasAttr(cell, CellAttr.UNDERLINE);
  const strike = hasAttr(cell, CellAttr.STRIKEOUT);
  if (!underline && !strike) return;
  ctx.globalAlpha = dim ? 0.6 : 1;
  ctx.fillStyle = fgCss;
  if (underline) ctx.fillRect(x, y + cellH - UNDERLINE_INSET_FROM_BOTTOM, cellW, 1);
  if (strike) ctx.fillRect(x, y + Math.round(cellH / 2), cellW, 1);
}

export function paintSearchBands(
  ctx: CanvasRenderingContext2D,
  row: number,
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  metrics: TerminalCellMetrics,
  totalRows: number,
  scrollOffset: number,
) {
  if (!matches || matches.length === 0) return;
  const activeKey = active ? matchAnchor(active) : null;
  for (const m of matches) {
    const vr = viewportRowOf(m, totalRows, scrollOffset);
    if (vr !== row) continue;
    const isActive = activeKey !== null && matchAnchor(m) === activeKey;
    const { width, height } = metrics;
    const x = m.startCol * width;
    const y = vr * height;
    const w = (m.endCol - m.startCol + 1) * width;
    if (w <= 0) continue;
    ctx.save();
    ctx.globalAlpha = isActive ? 0.65 : 0.4;
    ctx.fillStyle = isActive ? SEARCH_ACTIVE_BG : SEARCH_MATCH_BG;
    ctx.fillRect(x, y, w, height);
    ctx.restore();
  }
}

export function paintLinkUnderline(
  ctx: CanvasRenderingContext2D,
  row: number,
  link: LinkSpan | null,
  totalCols: number,
  metrics: TerminalCellMetrics,
) {
  if (!link) return;
  if (row < link.startRow || row > link.endRow) return;
  const startCol = row === link.startRow ? link.startCol : 0;
  const endColExclusive = row === link.endRow ? link.endCol + 1 : totalCols;
  const { width, height } = metrics;
  const x = startCol * width;
  const y = row * height;
  const w = (endColExclusive - startCol) * width;
  if (w <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = LINK_HOVER_FG;
  /* Match `drawDecorations`'s SGR-underline baseline so a hovered
   * link on an already-underlined word doesn't render a visible
   * second bar 1 px lower than the first. */
  ctx.fillRect(x, y + height - UNDERLINE_INSET_FROM_BOTTOM, w, 1);
  ctx.restore();
}

export function paintSelectionBand(
  ctx: CanvasRenderingContext2D,
  row: number,
  band: { startCol: number; endColExclusive: number },
  { width, height }: TerminalCellMetrics,
) {
  const x = band.startCol * width;
  const y = row * height;
  const w = (band.endColExclusive - band.startCol) * width;
  if (w <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = SELECTION_BG;
  ctx.fillRect(x, y, w, height);
  ctx.restore();
}

export function paintGhostSuggestion(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  text: string,
  { width, height }: TerminalCellMetrics,
  fontSize: number,
  fontFamily: string,
  devicePixelRatio: number,
) {
  const { row, col } = snapshot.cursor;
  const y = row * height;
  ctx.save();
  ctx.globalAlpha = 0.45;
  /* Use the palette's named foreground constant so a future theme
   * swap (or an unbundled-build hex audit) doesn't have to chase
   * a stray hex literal here. Same value, named source. */
  ctx.fillStyle = DEFAULT_FG;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";
  let x = col * width;
  const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
  for (const ch of text) {
    // Stop drawing if we would overflow the row — shells wrap the echoed
    // acceptance on their own; we only hint inline.
    if (x >= snapshot.cols * width) break;
    /* `maxWidth` clamps a glyph to one cell so CJK fallback fonts
     * don't bleed into the neighbour ghost-text cell. */
    ctx.fillText(ch, snapCanvasTextCoord(x, devicePixelRatio), glyphY, width);
    x += width;
  }
  ctx.restore();
}

/**
 * Paint inline image overlays. Each entry is anchored at its
 * `(cellRow, cellCol)` and stretched to `(cellW × cellH)` cells when
 * the source declared an explicit cell rectangle (Kitty `c=` / `r=`),
 * otherwise the rectangle is computed from `widthPx / heightPx` divided
 * by the live cell metrics.
 *
 * Entries whose `id` has not yet resolved in `bitmaps` are silently
 * skipped — the bitmap cache fills lazily as IPC fetches complete and
 * the next paint pass picks them up.
 *
 * v1 keeps the rendering deliberately minimal: integer cell rectangles,
 * `drawImage` scaled to the rectangle, no sub-pixel placement, no alpha
 * compositing tweaks, no clipping at the live screen edge (the snapshot
 * already filtered by anchor-row, but a wide image at row N could
 * extend past row N+rows; that's a future polish item).
 */
export function paintImages(
  ctx: CanvasRenderingContext2D,
  images: readonly ImageRef[],
  bitmaps: ReadonlyMap<number, ImageBitmap>,
  { width, height }: TerminalCellMetrics,
) {
  for (const ref of images) {
    const bmp = bitmaps.get(ref.id);
    if (!bmp) continue;
    const cellW = ref.cellW ?? Math.max(1, Math.ceil(ref.widthPx / width));
    const cellH = ref.cellH ?? Math.max(1, Math.ceil(ref.heightPx / height));
    const x = ref.cellCol * width;
    const y = ref.cellRow * height;
    ctx.drawImage(bmp, x, y, cellW * width, cellH * height);
  }
}

export function paintCursor(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  { width, height }: TerminalCellMetrics,
  devicePixelRatio: number,
) {
  if (!isVisibleCursor(snapshot.cursor)) return;
  const { row, col, shape } = snapshot.cursor;
  const x = col * width;
  const y = row * height;
  ctx.globalAlpha = 1;
  ctx.fillStyle = CURSOR_COLOR;
  switch (shape) {
    case "block": {
      ctx.fillRect(x, y, width, height);
      const cell = snapshot.cells[row]?.[col];
      if (cell && cell.ch !== " ") {
        ctx.fillStyle = CURSOR_TEXT_BG;
        /* Cursor-cell glyph respects the cell's wide-char status so a
         * CJK char under the cursor still occupies its 2-column slot
         * without spilling. */
        const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
        const glyphX = snapCanvasTextCoord(x, devicePixelRatio);
        const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
        if (wide || shouldClampGlyphToCell(cell, cell.ch)) {
          ctx.fillText(cell.ch, glyphX, glyphY, wide ? width * 2 : width);
        } else {
          ctx.fillText(cell.ch, glyphX, glyphY);
        }
      }
      return;
    }
    case "hollowBlock": {
      /* Alacritty emits HollowBlock when the OS focus leaves our
       * terminal — `block` and `hollowBlock` previously rendered
       * identically, which silently dropped the focus signal. A 1-px
       * outline matches the convention every modern terminal
       * (iTerm2, Terminal.app, Windows Terminal, Wezterm) uses for
       * "I'm not the keyboard target right now". The 0.5-px inset is
       * needed because canvas strokeRect centres the line on the
       * coordinate, so a 1-px stroke at integer coords would split
       * across two pixels and look fuzzy. */
      ctx.lineWidth = 1;
      ctx.strokeStyle = CURSOR_COLOR;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      return;
    }
    case "underline":
      /* Cursor's underline shape uses the same y baseline as the
       * SGR-underline + link-hover underline so a cursor parked
       * on an underlined word reads as one continuous bar instead
       * of a stacked pair. Height stays 2 px (vs the 1-px decoration
       * underline) so the cursor remains distinguishable. */
      ctx.fillRect(x, y + height - UNDERLINE_INSET_FROM_BOTTOM, width, UNDERLINE_INSET_FROM_BOTTOM);
      return;
    case "beam":
      ctx.fillRect(x, y, 2, height);
      return;
  }
}
