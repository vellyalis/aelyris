import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

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

export function useCanvasIME({ terminalId, textarea, writeBytes = defaultWriteBytes }: UseCanvasIMEArgs) {
  // Hold `writeBytes` in a ref so its identity does NOT appear in the
  // effect's dependency array. If it did, any parent passing an inline
  // function literal (common in tests, easy in production) would
  // re-register all five listeners on every render — and an unlucky
  // re-register during a live `compositionstart → …` flow would reset
  // `composingRef` / `pendingCompositionRef` below and silently drop the
  // in-flight IME commit.
  const writeBytesRef = useRef(writeBytes);
  writeBytesRef.current = writeBytes;

  // Track composition state across listeners via refs so handlers stay
  // stable under React's re-renders.
  const composingRef = useRef(false);
  // Remembers the most recent interim composition text so we can fall back
  // to it on `compositionend` if the browser/IME fires the two events in the
  // TSF order `input(isComposing, data=final)` → `compositionend(data="")`.
  const pendingCompositionRef = useRef<string>("");
  // When we commit from `compositionend`, Chromium fires a trailing
  // `input(isComposing=false, data=final)` with the same text. This flag
  // tells that next `input` handler to drop the duplicate.
  const skipNextCommittedInputRef = useRef<string | null>(null);

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
      writeBytesRef.current(terminalId, bytes);
    };

    const onInput = (e: Event) => {
      const ev = e as InputEvent;
      // During composition, record the latest interim text so we can
      // recover it on `compositionend` if the browser/IME commits through
      // the interim path (Windows TSF: some Japanese IMEs fire the final
      // `input` while `isComposing` is still `true`, then `compositionend`
      // with an empty `data`).
      if (ev.isComposing || composingRef.current) {
        if (ev.data) pendingCompositionRef.current = ev.data;
        // Keep the backing value clear so a later commit lands on an empty
        // buffer — some IMEs otherwise leave interim text behind.
        textarea.value = "";
        return;
      }

      const data = ev.data ?? textarea.value;
      textarea.value = "";
      if (!data || data.length === 0) return;

      // Chromium fires `compositionend` before the final `input` event;
      // we already sent the committed text from the compositionend handler,
      // so drop the duplicate echo here.
      if (skipNextCommittedInputRef.current === data) {
        skipNextCommittedInputRef.current = null;
        return;
      }
      skipNextCommittedInputRef.current = null;

      writeBytesRef.current(terminalId, data);
    };

    const onCompositionStart = () => {
      composingRef.current = true;
      pendingCompositionRef.current = "";
      // Deliberately leave `skipNextCommittedInputRef` alone — see the
      // block comment below `onCompositionEnd`.
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      composingRef.current = false;
      // Prefer the compositionend event's own `data` (Chromium / WebKit
      // spec-compliant path). Fall back to whatever the last interim
      // `input(isComposing=true)` reported — the TSF order on Windows.
      const text = e.data || pendingCompositionRef.current;
      pendingCompositionRef.current = "";
      textarea.value = "";
      if (!text || text.length === 0) return;

      writeBytesRef.current(terminalId, text);
      // Arm the dedup flag so the trailing `input(!isComposing, data=text)`
      // we expect on Chromium doesn't send the same characters twice.
      skipNextCommittedInputRef.current = text;
    };

    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      textarea.value = "";
      writeBytesRef.current(terminalId, text);
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
  }, [terminalId, textarea]);
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
export function useImePosition({ textarea, cursor, cellWidth, cellHeight, canvas }: UseImePositionArgs) {
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
