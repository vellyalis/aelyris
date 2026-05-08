import { describe, expect, it } from "vitest";

import { applyDiff } from "../shared/hooks/useTerminalSnapshot";
import type { CellSnapshot, CursorSnapshot, GridDiff, GridSnapshot, ImageRef } from "../shared/types/terminal";

const cursor: CursorSnapshot = {
  row: 0,
  col: 0,
  shape: "block",
  blinking: false,
  visible: true,
};

function cell(ch: string): CellSnapshot {
  return { ch, fg: 0, bg: 0, attrs: 0 };
}

function blankRow(cols: number): CellSnapshot[] {
  return Array.from({ length: cols }, () => cell(" "));
}

describe("applyDiff", () => {
  it("builds from scratch on a full frame", () => {
    const diff: GridDiff = {
      cols: 3,
      rows_total: 2,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [
        { row: 0, cells: [cell("a"), cell("b"), cell("c")] },
        { row: 1, cells: [cell("x"), cell("y"), cell("z")] },
      ],
    };
    const snap = applyDiff(null, diff);
    expect(snap.cols).toBe(3);
    expect(snap.rows).toBe(2);
    expect(snap.cells[0][0].ch).toBe("a");
    expect(snap.cells[1][2].ch).toBe("z");
  });

  it("treats missing rows in a full frame as blanks", () => {
    const diff: GridDiff = {
      cols: 2,
      rows_total: 3,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [{ row: 1, cells: [cell("h"), cell("i")] }],
    };
    const snap = applyDiff(null, diff);
    expect(snap.cells[0]).toEqual(blankRow(2));
    expect(snap.cells[1][0].ch).toBe("h");
    expect(snap.cells[2]).toEqual(blankRow(2));
  });

  it("forces a full frame when dimensions change", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 2,
      cells: [
        [cell("a"), cell("b")],
        [cell("c"), cell("d")],
      ],
      cursor,
    };
    const diff: GridDiff = {
      cols: 3,
      rows_total: 2,
      full: false,
      cursor,
      cursor_changed: false,
      rows: [{ row: 0, cells: [cell("x"), cell("y"), cell("z")] }],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cols).toBe(3);
    expect(snap.cells[0][2].ch).toBe("z");
    expect(snap.cells[1]).toEqual(blankRow(3));
  });

  it("patches only the rows listed in a partial diff", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 3,
      cells: [
        [cell("a"), cell("b")],
        [cell("c"), cell("d")],
        [cell("e"), cell("f")],
      ],
      cursor,
    };
    const nextCursor = { ...cursor, col: 1 };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 3,
      full: false,
      cursor: nextCursor,
      cursor_changed: true,
      rows: [{ row: 1, cells: [cell("C"), cell("D")] }],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cells[0][0].ch).toBe("a");
    expect(snap.cells[1][0].ch).toBe("C");
    expect(snap.cells[2][0].ch).toBe("e");
    expect(snap.cursor.col).toBe(1);
  });

  it("carries prev.images through partial diffs", () => {
    // P2 #1 from codex round-6 r1: GridDiff has no images field, so
    // dropping prev.images on every diff would strip every visible
    // inline image on the next 16ms frame.
    const image: ImageRef = { id: 1, cellRow: 0, cellCol: 0, widthPx: 100, heightPx: 50 };
    const prev: GridSnapshot = {
      cols: 2,
      rows: 1,
      cells: [[cell("a"), cell("b")]],
      cursor,
      images: [image],
    };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 1,
      full: false,
      cursor,
      cursor_changed: false,
      rows: [{ row: 0, cells: [cell("A"), cell("B")] }],
    };
    const next = applyDiff(prev, diff);
    expect(next.images).toEqual([image]);
  });

  it("carries prev.images through dim-match full diffs (forced reset case)", () => {
    // term_snapshot's snapshot_and_reset_tracker forces the next emit
    // to be full=true even when nothing changed. Without carry-through,
    // every (re)mount would briefly drop all visible images.
    const image: ImageRef = { id: 7, cellRow: 1, cellCol: 0, widthPx: 200, heightPx: 100 };
    const prev: GridSnapshot = {
      cols: 3,
      rows: 2,
      cells: [
        [cell("a"), cell("b"), cell("c")],
        [cell("x"), cell("y"), cell("z")],
      ],
      cursor,
      images: [image],
    };
    const diff: GridDiff = {
      cols: 3,
      rows_total: 2,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [
        { row: 0, cells: [cell("a"), cell("b"), cell("c")] },
        { row: 1, cells: [cell("x"), cell("y"), cell("z")] },
      ],
    };
    const next = applyDiff(prev, diff);
    expect(next.images).toEqual([image]);
  });

  it("clears images on dim-mismatch full diffs (resize case)", () => {
    // Resize emits a full=true diff with new dimensions. Image anchors
    // were valid only for the old layout; the engine has reflowed but
    // GridDiff can't carry the new image set, so the safest move is
    // to drop until the next snapshot fetch refreshes them.
    const image: ImageRef = { id: 1, cellRow: 0, cellCol: 0, widthPx: 100, heightPx: 50 };
    const prev: GridSnapshot = {
      cols: 2,
      rows: 1,
      cells: [[cell("a"), cell("b")]],
      cursor,
      images: [image],
    };
    const diff: GridDiff = {
      cols: 4,
      rows_total: 2,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [
        { row: 0, cells: [cell("a"), cell("b"), cell("c"), cell("d")] },
        { row: 1, cells: [cell("x"), cell("y"), cell("z"), cell("w")] },
      ],
    };
    const next = applyDiff(prev, diff);
    expect(next.images).toBeUndefined();
  });

  it("returns no images field when prev has none and diff is full", () => {
    // First-mount full=true with no images on the wire: no prev to
    // carry from. The field stays undefined (not an empty array) so
    // consumers can keep distinguishing "no images yet" from "an
    // empty image set".
    const diff: GridDiff = {
      cols: 1,
      rows_total: 1,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [{ row: 0, cells: [cell("a")] }],
    };
    const next = applyDiff(null, diff);
    expect(next.images).toBeUndefined();
  });

  it("adopts diff.images verbatim when defined on a full=true diff", () => {
    // Wire format: `Some(images)` means "replace the entire image set".
    // Always set on full=true so a (re)mount seeds correctly.
    const image: ImageRef = { id: 7, cellRow: 1, cellCol: 0, widthPx: 100, heightPx: 50 };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 1,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [{ row: 0, cells: [cell("a"), cell("b")] }],
      images: [image],
    };
    const next = applyDiff(null, diff);
    expect(next.images).toEqual([image]);
  });

  it("adopts diff.images verbatim on a partial diff (overrides prev.images)", () => {
    // The backend emits `Some(images)` on a partial whenever the image
    // set changed (e.g. anchor scrolled into a different row). The new
    // set must win over prev.
    const oldImage: ImageRef = { id: 1, cellRow: 0, cellCol: 0, widthPx: 100, heightPx: 50 };
    const newImage: ImageRef = { id: 1, cellRow: 1, cellCol: 0, widthPx: 100, heightPx: 50 };
    const prev: GridSnapshot = {
      cols: 2,
      rows: 2,
      cells: [
        [cell("a"), cell("b")],
        [cell(" "), cell(" ")],
      ],
      cursor,
      images: [oldImage],
    };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 2,
      full: false,
      cursor,
      cursor_changed: false,
      rows: [],
      images: [newImage],
    };
    const next = applyDiff(prev, diff);
    expect(next.images).toEqual([newImage]);
  });

  it("clears images when diff.images is an empty array (eviction)", () => {
    // `Some([])` is distinct from `None`/undefined: it explicitly
    // signals that all anchors evicted. The frontend must drop prev's
    // overlay rather than carry it (which would leave a phantom image).
    const image: ImageRef = { id: 1, cellRow: 0, cellCol: 0, widthPx: 100, heightPx: 50 };
    const prev: GridSnapshot = {
      cols: 2,
      rows: 1,
      cells: [[cell("a"), cell("b")]],
      cursor,
      images: [image],
    };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 1,
      full: false,
      cursor,
      cursor_changed: false,
      rows: [],
      images: [],
    };
    const next = applyDiff(prev, diff);
    expect(next.images).toEqual([]);
  });

  it("updates cursor even when no rows are sent", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 1,
      cells: [[cell("a"), cell("b")]],
      cursor,
    };
    const nextCursor = { ...cursor, col: 2 };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 1,
      full: false,
      cursor: nextCursor,
      cursor_changed: true,
      rows: [],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cursor.col).toBe(2);
    expect(snap.cells).toEqual(prev.cells);
  });
});
