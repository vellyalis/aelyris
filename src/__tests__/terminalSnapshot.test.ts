import { describe, expect, it } from "vitest";

import {
  CellAttr,
  type CellSnapshot,
  ColorKind,
  decodeColor,
  type GridSnapshot,
  hasAttr,
} from "../shared/types/terminal";

const baseCell: CellSnapshot = { ch: " ", fg: 0, bg: 0, attrs: 0 };

describe("terminal snapshot types", () => {
  it("parses Rust-packed Named color", () => {
    // Kind 0 (Named), payload 256 = Foreground
    const packed = (0 << 24) | 256;
    expect(decodeColor(packed)).toEqual({ kind: ColorKind.NAMED, named: 256 });
  });

  it("parses Rust-packed Rgb color", () => {
    const r = 0xaa;
    const g = 0xbb;
    const b = 0xcc;
    const packed = (1 << 24) | (r << 16) | (g << 8) | b;
    expect(decodeColor(packed)).toEqual({ kind: ColorKind.RGB, r, g, b });
  });

  it("parses Rust-packed Indexed color", () => {
    const packed = (2 << 24) | 42;
    expect(decodeColor(packed)).toEqual({ kind: ColorKind.INDEXED, index: 42 });
  });

  it("decodes attribute bitflags", () => {
    const bold = { ...baseCell, attrs: CellAttr.BOLD };
    const boldItalic = { ...baseCell, attrs: CellAttr.BOLD | CellAttr.ITALIC };
    expect(hasAttr(bold, CellAttr.BOLD)).toBe(true);
    expect(hasAttr(bold, CellAttr.ITALIC)).toBe(false);
    expect(hasAttr(boldItalic, CellAttr.ITALIC)).toBe(true);
  });

  it("accepts a serde-shaped GridSnapshot JSON payload", () => {
    // Matches GridSnapshot produced by serde_json::to_string in Rust.
    const wire = `{
      "cols": 2,
      "rows": 1,
      "cells": [[
        { "ch": "h", "fg": 256, "bg": 257, "attrs": 1 },
        { "ch": "i", "fg": 256, "bg": 257, "attrs": 0 }
      ]],
      "cursor": { "row": 0, "col": 2, "shape": "block", "blinking": false, "visible": true }
    }`;
    const snap = JSON.parse(wire) as GridSnapshot;
    expect(snap.cols).toBe(2);
    expect(snap.cells[0][0].ch).toBe("h");
    expect(hasAttr(snap.cells[0][0], CellAttr.BOLD)).toBe(true);
    expect(snap.cursor.shape).toBe("block");
  });
});
