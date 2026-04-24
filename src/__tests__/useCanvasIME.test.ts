import { describe, expect, it } from "vitest";

import { isSpecialKeyEvent } from "../features/terminal/hooks/useCanvasIME";

function ev(overrides: Partial<Parameters<typeof isSpecialKeyEvent>[0]> = {}): Parameters<typeof isSpecialKeyEvent>[0] {
  return {
    key: "a",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 65,
    ...overrides,
  };
}

describe("isSpecialKeyEvent", () => {
  it("returns false for plain printable keys (they go through `input` event)", () => {
    expect(isSpecialKeyEvent(ev({ key: "a" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "1" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "あ" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "!" }))).toBe(false);
  });

  it("returns true for modifier combos", () => {
    expect(isSpecialKeyEvent(ev({ key: "c", ctrlKey: true }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "a", altKey: true }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "a", metaKey: true }))).toBe(true);
  });

  it("returns true for named editing keys", () => {
    expect(isSpecialKeyEvent(ev({ key: "Enter" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "ArrowUp" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Escape" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Backspace" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Tab" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "F1" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Home" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "PageDown" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Delete" }))).toBe(true);
  });

  it("returns false during IME composition so the IME keeps the key", () => {
    expect(isSpecialKeyEvent(ev({ key: "Enter", isComposing: true }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "a", keyCode: 229 }))).toBe(false);
  });

  it("Shift alone on a printable key stays printable", () => {
    // Shift-A is still a single-char event that flows through input event
    // (the browser emits `key: 'A'`).
    expect(isSpecialKeyEvent({ ...ev({ key: "A" }), ctrlKey: false })).toBe(false);
  });
});
