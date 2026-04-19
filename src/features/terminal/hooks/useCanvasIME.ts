import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { keyEventToBytes } from "../keymap";

/**
 * Phase B of the native-IME work — attaches keyboard + composition listeners
 * to an invisible `<textarea>` overlay so that IME (Japanese / Chinese /
 * Korean) composition can land somewhere the browser recognises as a text
 * input. Without a real text input element, `compositionstart` / `input`
 * events never fire and multi-byte characters cannot be typed at all.
 *
 * Event split:
 * - Plain printable keys (`'a'`, `'あ'` from IME)         → `input` event path.
 * - Special keys (Enter, Arrow*, Ctrl+C, Tab, …)         → `keydown` path.
 * - IME composition (keyCode=229, isComposing)           → ignored by keydown;
 *   the committed text arrives via `input` with `isComposing === false`.
 *
 * The `keydown` handler intentionally does NOT forward plain printables; if
 * it did, typing `a` would send `a` twice (once from keydown, once from
 * input).  `keymap.keyEventToBytes` already returns `null` for IME events.
 */

export type WriteBytesFn = (id: string, data: string) => void;

const defaultWriteBytes: WriteBytesFn = (id, data) => {
  invoke("write_terminal", { id, data }).catch(() => {});
};

/**
 * A key event should be consumed by `keydown` (rather than left to the
 * `input` event) when it either has a modifier the text-input layer wouldn't
 * emit (Ctrl/Alt/Meta), or when it's a named editing key whose default
 * browser behaviour doesn't produce an `input` event with the PTY byte we
 * want (arrows, Enter-as-\r, Escape, Backspace-as-\x7f, F-keys, …).
 */
export function isSpecialKeyEvent(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return true;
  // Anything whose `key` isn't a single code point is "special" (Enter,
  // ArrowUp, Escape, F1, Backspace, Tab, Home, …).  Plain printable chars
  // have single-character keys.
  return e.key.length !== 1;
}

export interface UseCanvasIMEArgs {
  terminalId: string | null;
  textarea: HTMLTextAreaElement | null;
  writeBytes?: WriteBytesFn;
}

export function useCanvasIME({
  terminalId,
  textarea,
  writeBytes = defaultWriteBytes,
}: UseCanvasIMEArgs) {
  // Track composition state across listeners via a ref so handlers stay
  // stable under React's re-renders.
  const composingRef = useRef(false);

  useEffect(() => {
    if (!textarea || !terminalId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // IME composition keys: let the IME handle them entirely.
      if (e.isComposing || e.keyCode === 229) return;

      if (!isSpecialKeyEvent(e)) {
        // Plain printable — let the `input` event handle it.  keymap.ts
        // would return the char itself here, which would double-send.
        return;
      }

      const bytes = keyEventToBytes(e);
      if (bytes === null) return;
      e.preventDefault();
      e.stopPropagation();
      writeBytes(terminalId, bytes);
    };

    const onInput = (e: Event) => {
      const ev = e as InputEvent;
      // During composition the browser fires interim `input` events with
      // `isComposing=true`; we ignore those and wait for the final
      // compositionend → input pair.
      if (ev.isComposing || composingRef.current) {
        // Keep the value clear so the committed text on compositionend
        // lands on an empty buffer rather than accumulating — some IMEs
        // leave interim text behind.
        textarea.value = "";
        return;
      }
      const data = ev.data ?? textarea.value;
      textarea.value = "";
      if (data && data.length > 0) {
        writeBytes(terminalId, data);
      }
    };

    const onCompositionStart = () => {
      composingRef.current = true;
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      composingRef.current = false;
      // Some browsers fire `compositionend` with the final text in `data`
      // and DO fire a subsequent `input` event.  Chromium fires
      // compositionend BEFORE the final input event, so clearing here
      // would swallow the next input's `data`.  Leave it alone — the
      // input handler sees `!isComposing` and sends the text.
      void e;
    };

    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      textarea.value = "";
      writeBytes(terminalId, text);
    };

    textarea.addEventListener("keydown", onKeyDown);
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionend", onCompositionEnd);
    textarea.addEventListener("paste", onPaste);

    return () => {
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.removeEventListener("paste", onPaste);
    };
  }, [terminalId, textarea, writeBytes]);
}

export interface UseImePositionArgs {
  /** Textarea element (position source). */
  textarea: HTMLTextAreaElement | null;
  /** Row/col in terminal grid. */
  cursor: { row: number; col: number } | null;
  /** Cell dimensions in CSS pixels. */
  cellWidth: number;
  cellHeight: number;
  /** Canvas bounding rect origin, used to convert cell coord to screen coord. */
  canvas: HTMLCanvasElement | null;
}

/**
 * Keep the invisible textarea aligned with the PTY cursor, and tell Windows
 * (via the `set_ime_position` IPC) where to park the IME candidate window so
 * it sits directly under the caret rather than in the top-left corner.
 */
export function useImePosition({
  textarea,
  cursor,
  cellWidth,
  cellHeight,
  canvas,
}: UseImePositionArgs) {
  useEffect(() => {
    if (!textarea || !cursor || !canvas) return;
    const left = cursor.col * cellWidth;
    const top = cursor.row * cellHeight;
    textarea.style.left = `${left}px`;
    textarea.style.top = `${top}px`;

    const rect = canvas.getBoundingClientRect();
    const screenX = rect.left + left;
    // +cellHeight so the candidate window sits just below the caret.
    const screenY = rect.top + top + cellHeight;
    invoke("set_ime_position", { x: screenX, y: screenY }).catch(() => {});
  }, [textarea, cursor?.row, cursor?.col, cellWidth, cellHeight, canvas]);
}
