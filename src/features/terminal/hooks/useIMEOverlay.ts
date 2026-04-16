import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Fixes IME candidate window positioning for CJK input in xterm.js.
 *
 * Problem: Windows places the OS IME candidate popup relative to the hidden
 * textarea. xterm.js doesn't update that textarea position when TUI apps
 * (Claude/Gemini CLI) move the cursor via ANSI escapes.
 *
 * Fix: On compositionstart, reposition the textarea to match buffer.active
 * cursor position. No custom overlay — xterm's built-in composition view
 * handles the visual display. This avoids ghost text / burn-in bugs.
 */
export function useIMEOverlay(
  term: Terminal | null,
  _containerRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!term) return;
    const textarea = term.textarea;
    if (!textarea) return;

    const origPosition = textarea.style.position;
    const origLeft = textarea.style.left;
    const origTop = textarea.style.top;

    const repositionTextarea = () => {
      const buf = term.buffer.active;
      const el = term.element;
      if (!el) return;

      const measureEl = el.querySelector(".xterm-char-measure-element");
      const cellW = measureEl?.getBoundingClientRect().width
        ?? (el.clientWidth / term.cols);

      const rowEl = el.querySelector(".xterm-rows > div");
      const cellH = rowEl?.getBoundingClientRect().height
        ?? (el.clientHeight / term.rows);

      const screen = el.querySelector(".xterm-screen") as HTMLElement | null;
      if (!screen) return;

      const screenRect = screen.getBoundingClientRect();
      const x = screenRect.left + buf.cursorX * cellW;
      const y = screenRect.top + buf.cursorY * cellH + cellH;

      textarea.style.position = "fixed";
      textarea.style.left = `${x}px`;
      textarea.style.top = `${y}px`;
    };

    const restoreTextarea = () => {
      textarea.style.position = origPosition;
      textarea.style.left = origLeft;
      textarea.style.top = origTop;
    };

    const onStart = () => repositionTextarea();
    const onEnd = () => restoreTextarea();

    textarea.addEventListener("compositionstart", onStart);
    textarea.addEventListener("compositionend", onEnd);

    return () => {
      textarea.removeEventListener("compositionstart", onStart);
      textarea.removeEventListener("compositionend", onEnd);
      restoreTextarea();
    };
  }, [term]);
}
