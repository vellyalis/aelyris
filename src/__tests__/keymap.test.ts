import { describe, expect, it } from "vitest";

import { keyEventToBytes, pixelToCell } from "../features/terminal/keymap";

function ev(overrides: Partial<Parameters<typeof keyEventToBytes>[0]> & { key: string }) {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe("keyEventToBytes — basic printable keys", () => {
  it("passes through a plain ASCII character", () => {
    expect(keyEventToBytes(ev({ key: "a" }))).toBe("a");
    expect(keyEventToBytes(ev({ key: "Z" }))).toBe("Z");
    expect(keyEventToBytes(ev({ key: " " }))).toBe(" ");
  });

  it("ignores Shift alone on letters (browser already cases the key)", () => {
    expect(keyEventToBytes(ev({ key: "A", shiftKey: true }))).toBe("A");
  });
});

describe("keyEventToBytes — editing keys", () => {
  it("maps Enter to CR", () => {
    expect(keyEventToBytes(ev({ key: "Enter" }))).toBe("\r");
  });

  it("maps Backspace to DEL (0x7f) by default", () => {
    expect(keyEventToBytes(ev({ key: "Backspace" }))).toBe("\x7f");
  });

  it("maps Ctrl+Backspace to BS (0x08)", () => {
    expect(keyEventToBytes(ev({ key: "Backspace", ctrlKey: true }))).toBe("\x08");
  });

  it("maps Tab to HT and Shift+Tab to CSI Z (reverse tab)", () => {
    expect(keyEventToBytes(ev({ key: "Tab" }))).toBe("\t");
    expect(keyEventToBytes(ev({ key: "Tab", shiftKey: true }))).toBe("\x1b[Z");
  });

  it("maps Escape to ESC", () => {
    expect(keyEventToBytes(ev({ key: "Escape" }))).toBe("\x1b");
  });
});

describe("keyEventToBytes — arrow / navigation keys", () => {
  it("maps bare arrows to CSI A-D", () => {
    expect(keyEventToBytes(ev({ key: "ArrowUp" }))).toBe("\x1b[A");
    expect(keyEventToBytes(ev({ key: "ArrowDown" }))).toBe("\x1b[B");
    expect(keyEventToBytes(ev({ key: "ArrowRight" }))).toBe("\x1b[C");
    expect(keyEventToBytes(ev({ key: "ArrowLeft" }))).toBe("\x1b[D");
  });

  it("encodes Ctrl+ArrowLeft as CSI 1;5D", () => {
    expect(keyEventToBytes(ev({ key: "ArrowLeft", ctrlKey: true }))).toBe("\x1b[1;5D");
  });

  it("encodes Alt+ArrowRight as CSI 1;3C", () => {
    expect(keyEventToBytes(ev({ key: "ArrowRight", altKey: true }))).toBe("\x1b[1;3C");
  });

  it("maps Home/End/PageUp/PageDown/Insert/Delete", () => {
    expect(keyEventToBytes(ev({ key: "Home" }))).toBe("\x1b[H");
    expect(keyEventToBytes(ev({ key: "End" }))).toBe("\x1b[F");
    expect(keyEventToBytes(ev({ key: "PageUp" }))).toBe("\x1b[5~");
    expect(keyEventToBytes(ev({ key: "PageDown" }))).toBe("\x1b[6~");
    expect(keyEventToBytes(ev({ key: "Insert" }))).toBe("\x1b[2~");
    expect(keyEventToBytes(ev({ key: "Delete" }))).toBe("\x1b[3~");
  });
});

describe("keyEventToBytes — function keys", () => {
  it("maps F1-F4 with SS3 encoding", () => {
    expect(keyEventToBytes(ev({ key: "F1" }))).toBe("\x1bOP");
    expect(keyEventToBytes(ev({ key: "F2" }))).toBe("\x1bOQ");
    expect(keyEventToBytes(ev({ key: "F3" }))).toBe("\x1bOR");
    expect(keyEventToBytes(ev({ key: "F4" }))).toBe("\x1bOS");
  });

  it("maps F5-F12 with CSI tilde encoding", () => {
    expect(keyEventToBytes(ev({ key: "F5" }))).toBe("\x1b[15~");
    expect(keyEventToBytes(ev({ key: "F12" }))).toBe("\x1b[24~");
  });
});

describe("keyEventToBytes — Ctrl modifiers", () => {
  it("maps Ctrl+A..Ctrl+Z to 0x01..0x1a", () => {
    expect(keyEventToBytes(ev({ key: "a", ctrlKey: true }))).toBe("\x01");
    expect(keyEventToBytes(ev({ key: "c", ctrlKey: true }))).toBe("\x03");
    expect(keyEventToBytes(ev({ key: "d", ctrlKey: true }))).toBe("\x04");
    expect(keyEventToBytes(ev({ key: "z", ctrlKey: true }))).toBe("\x1a");
  });

  it("uppercase Ctrl letters also fold to the C0 range", () => {
    expect(keyEventToBytes(ev({ key: "C", ctrlKey: true }))).toBe("\x03");
  });

  it("maps Ctrl+Space to NUL and Ctrl+[ to ESC", () => {
    expect(keyEventToBytes(ev({ key: " ", ctrlKey: true }))).toBe("\x00");
    expect(keyEventToBytes(ev({ key: "[", ctrlKey: true }))).toBe("\x1b");
  });
});

describe("keyEventToBytes — Alt modifier", () => {
  it("prefixes Alt+char with ESC", () => {
    expect(keyEventToBytes(ev({ key: "b", altKey: true }))).toBe("\x1bb");
    expect(keyEventToBytes(ev({ key: ".", altKey: true }))).toBe("\x1b.");
  });
});

describe("keyEventToBytes — events that should bubble", () => {
  it("returns null for IME composition (isComposing or keyCode 229)", () => {
    expect(keyEventToBytes(ev({ key: "a", isComposing: true }))).toBeNull();
    expect(keyEventToBytes(ev({ key: "Process", keyCode: 229 }))).toBeNull();
  });

  it("returns null for Meta (Cmd/Win) combos — reserved for OS/app", () => {
    expect(keyEventToBytes(ev({ key: "c", metaKey: true }))).toBeNull();
  });

  it("returns null for Ctrl+Shift combos (app shortcuts)", () => {
    expect(keyEventToBytes(ev({ key: "P", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(keyEventToBytes(ev({ key: "J", ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("returns null for modifier-only events", () => {
    expect(keyEventToBytes(ev({ key: "Shift" }))).toBeNull();
    expect(keyEventToBytes(ev({ key: "Control" }))).toBeNull();
    expect(keyEventToBytes(ev({ key: "Alt" }))).toBeNull();
    expect(keyEventToBytes(ev({ key: "Meta" }))).toBeNull();
  });

  it("returns null for unhandled named keys", () => {
    expect(keyEventToBytes(ev({ key: "Pause" }))).toBeNull();
  });
});

describe("pixelToCell", () => {
  it("maps a pixel inside the canvas to the expected cell", () => {
    const rect = { left: 100, top: 50 };
    expect(pixelToCell(108, 58, rect, 8, 16, 10, 5)).toEqual({ row: 0, col: 1 });
    expect(pixelToCell(124, 82, rect, 8, 16, 10, 5)).toEqual({ row: 2, col: 3 });
  });

  it("clamps negative or out-of-range coords into the grid", () => {
    const rect = { left: 0, top: 0 };
    expect(pixelToCell(-5, -5, rect, 8, 16, 4, 4)).toEqual({ row: 0, col: 0 });
    expect(pixelToCell(10000, 10000, rect, 8, 16, 4, 4)).toEqual({ row: 3, col: 3 });
  });
});
