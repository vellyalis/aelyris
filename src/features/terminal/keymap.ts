/**
 * Phase 2 / Task 8 — Keyboard input mapper for TerminalCanvas.
 *
 * Converts KeyboardEvent-like input into the byte sequence that a PTY would
 * receive when the matching key is pressed in a VT-compatible terminal.
 *
 * - Returns a string of bytes (to be sent via `write_terminal`) when the key
 *   should be consumed by the terminal.
 * - Returns `null` when the key should bubble (app shortcuts, IME composition,
 *   modifier-only keys, unsupported combos).
 *
 * Tests inject this directly — no DOM dependency.
 */

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export function keyEventToBytes(ev: KeyEventLike): string | null {
  if (ev.isComposing || ev.keyCode === 229) return null;
  if (ev.metaKey) return null;

  switch (ev.key) {
    case "Shift":
    case "Control":
    case "Alt":
    case "Meta":
    case "CapsLock":
    case "NumLock":
    case "ScrollLock":
    case "Dead":
    case "Unidentified":
      return null;
  }

  // Ctrl+Shift+* is reserved for app shortcuts (palette, IME bar, splits).
  // Exception: allow bare Shift+Tab to reach the shell as reverse-tab.
  if (ev.ctrlKey && ev.shiftKey && ev.key !== "Tab") return null;

  const special = mapSpecialKey(ev);
  if (special !== undefined) return special;

  if (ev.key.length !== 1) return null;

  // Ctrl+Alt + printable is how Windows exposes AltGr on many keyboard
  // layouts. Let the browser text-input path emit the composed printable
  // glyph instead of preempting it from keydown and preventing default.
  if (ev.ctrlKey && ev.altKey) return null;

  if (ev.ctrlKey && !ev.altKey) {
    return ctrlChar(ev.key);
  }
  if (ev.altKey && !ev.ctrlKey) {
    return `\x1b${ev.key}`;
  }
  return ev.key;
}

function mapSpecialKey(ev: KeyEventLike): string | undefined {
  const mod = csiModifier(ev);
  switch (ev.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return ev.ctrlKey ? "\x08" : "\x7f";
    case "Tab":
      return ev.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return csiLetter("A", mod);
    case "ArrowDown":
      return csiLetter("B", mod);
    case "ArrowRight":
      return csiLetter("C", mod);
    case "ArrowLeft":
      return csiLetter("D", mod);
    case "Home":
      return csiLetter("H", mod);
    case "End":
      return csiLetter("F", mod);
    case "PageUp":
      return csiTilde(5, mod);
    case "PageDown":
      return csiTilde(6, mod);
    case "Insert":
      return csiTilde(2, mod);
    case "Delete":
      return csiTilde(3, mod);
    case "F1":
      return ssFn("P", mod);
    case "F2":
      return ssFn("Q", mod);
    case "F3":
      return ssFn("R", mod);
    case "F4":
      return ssFn("S", mod);
    case "F5":
      return csiTilde(15, mod);
    case "F6":
      return csiTilde(17, mod);
    case "F7":
      return csiTilde(18, mod);
    case "F8":
      return csiTilde(19, mod);
    case "F9":
      return csiTilde(20, mod);
    case "F10":
      return csiTilde(21, mod);
    case "F11":
      return csiTilde(23, mod);
    case "F12":
      return csiTilde(24, mod);
  }
  return undefined;
}

// CSI modifier encoding used by common terminal emulators:
// 1 + shift(1) + alt(2) + ctrl(4).
function csiModifier(ev: KeyEventLike): number {
  let m = 1;
  if (ev.shiftKey) m += 1;
  if (ev.altKey) m += 2;
  if (ev.ctrlKey) m += 4;
  return m;
}

function csiLetter(letter: string, mod: number): string {
  return mod === 1 ? `\x1b[${letter}` : `\x1b[1;${mod}${letter}`;
}

function csiTilde(n: number, mod: number): string {
  return mod === 1 ? `\x1b[${n}~` : `\x1b[${n};${mod}~`;
}

function ssFn(letter: string, mod: number): string {
  return mod === 1 ? `\x1bO${letter}` : `\x1b[1;${mod}${letter}`;
}

function ctrlChar(key: string): string | null {
  if (key === " ") return "\x00";
  if (key.length !== 1) return null;
  const code = key.toLowerCase().charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  switch (key) {
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    case "?":
      return "\x7f";
  }
  return null;
}

/**
 * Convert a mouse pixel coordinate (relative to the canvas bounding rect) to
 * a cell coordinate. Clamps into `[0, cols-1] × [0, rows-1]` — used by
 * Task 9 selection logic; exported here so the cell-metrics contract lives
 * next to the input layer.
 */
export interface CellCoord {
  row: number;
  col: number;
}

export function pixelToCell(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  cellWidth: number,
  cellHeight: number,
  cols: number,
  rows: number,
): CellCoord {
  const x = Math.max(0, clientX - rect.left);
  const y = Math.max(0, clientY - rect.top);
  const col = Math.min(cols - 1, Math.max(0, Math.floor(x / cellWidth)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(y / cellHeight)));
  return { row, col };
}
