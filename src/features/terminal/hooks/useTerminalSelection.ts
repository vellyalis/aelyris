import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeClipboardText } from "../../../shared/lib/nativeClipboard";
import type { GridSnapshot } from "../../../shared/types/terminal";
import { pixelToCell } from "../keymap";
import { extractSelection, lineRangeAt, type SelectionRange, wordRangeAt } from "../selection";

/**
 * Phase 2 / Task 9 — Mouse selection + copy wiring for TerminalCanvas.
 *
 * Manages a SelectionRange driven by mousedown/move/up on the canvas element,
 * and returns:
 *   - `selection` (range, or null when cleared)
 *   - bind props to spread onto the canvas
 *   - `copy()` to push the current selection to the clipboard
 *
 * Injectable `copyText` and `getSnapshot` keep the hook testable without a
 * DOM — default impls use native clipboard IPC with a browser fallback and
 * the caller's latest snapshot via ref.
 */

export type CopyTextFn = (text: string) => Promise<void> | void;

const defaultCopyText: CopyTextFn = (text) => {
  return writeClipboardText(text);
};

export { writeClipboardText };

export interface UseTerminalSelectionArgs {
  element: HTMLElement | null;
  snapshot: GridSnapshot | null;
  cellWidth: number;
  cellHeight: number;
  copyText?: CopyTextFn;
}

export interface UseTerminalSelectionResult {
  selection: SelectionRange | null;
  clear: () => void;
  copy: () => Promise<void>;
}

export function useTerminalSelection({
  element,
  snapshot,
  cellWidth,
  cellHeight,
  copyText = defaultCopyText,
}: UseTerminalSelectionArgs): UseTerminalSelectionResult {
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const snapshotRef = useRef<GridSnapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  const selectionRef = useRef<SelectionRange | null>(selection);
  selectionRef.current = selection;
  const draggingRef = useRef(false);
  /* Anchor of an in-progress drag — set on mousedown, consumed on the
   * first mousemove that produces a non-zero focus delta. Holding the
   * anchor here instead of synthesising a zero-width selection on
   * mousedown lets a plain click clear the selection without leaving
   * a single-cell highlight band ("dark rectangle") behind, which is
   * exactly what the dogfood screenshot caught on 2026-05-03. */
  const pendingAnchorRef = useRef<{ row: number; col: number } | null>(null);

  const clear = useCallback(() => setSelection(null), []);

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const snap = snapshotRef.current;
      if (!element || !snap) return null;
      const rect = element.getBoundingClientRect();
      return pixelToCell(clientX, clientY, rect, cellWidth, cellHeight, snap.cols, snap.rows);
    },
    [element, cellWidth, cellHeight],
  );

  useEffect(() => {
    if (!element) return;

    const onMouseDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      const currentSelection = selectionRef.current;
      // Shift-click extends the existing selection — that's a deliberate
      // "I want this range" gesture, so the selection lands immediately.
      if (ev.shiftKey && currentSelection) {
        const point = cellAt(ev.clientX, ev.clientY);
        if (!point) return;
        setSelection({
          anchor: currentSelection.anchor,
          focus: point,
          mode: "char",
        });
        draggingRef.current = true;
        pendingAnchorRef.current = null;
        ev.preventDefault();
        element.focus();
        return;
      }
      const point = cellAt(ev.clientX, ev.clientY);
      if (!point) return;
      // Plain click: stage the anchor and arm the drag flag, but don't
      // create a selection yet. `onMouseMove` upgrades to a real
      // selection the moment the focus cell differs from the anchor;
      // `onMouseUp` without movement clears any prior selection (native
      // text-editor behaviour).
      draggingRef.current = true;
      pendingAnchorRef.current = point;
      ev.preventDefault();
      element.focus();
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const point = cellAt(ev.clientX, ev.clientY);
      if (!point) return;
      const pending = pendingAnchorRef.current;
      if (pending) {
        // First detectable drag step: skip if focus hasn't left the
        // anchor cell, otherwise upgrade to a real selection range.
        if (pending.row === point.row && pending.col === point.col) return;
        setSelection({ anchor: pending, focus: point, mode: "char" });
        pendingAnchorRef.current = null;
        return;
      }
      setSelection((prev) => (prev ? { ...prev, focus: point } : prev));
    };

    const onMouseUp = () => {
      const wasPending = pendingAnchorRef.current !== null;
      draggingRef.current = false;
      pendingAnchorRef.current = null;
      // Click without drag: clear any pre-existing selection so a stray
      // tap doesn't leave a stale highlight on the previous gesture's
      // range either.
      if (wasPending && selectionRef.current) {
        setSelection(null);
      }
    };

    const onDoubleClick = (ev: MouseEvent) => {
      const snap = snapshotRef.current;
      const point = cellAt(ev.clientX, ev.clientY);
      if (!snap || !point) return;
      const range = wordRangeAt(snap, point.row, point.col);
      if (range) {
        setSelection(range);
        ev.preventDefault();
      }
    };

    // Triple-click: Browsers fire `click` with detail===3 after two prior
    // clicks. MouseEvent.detail is an accumulator reset by movement/delay.
    const onClick = (ev: MouseEvent) => {
      if (ev.detail < 3) return;
      const snap = snapshotRef.current;
      const point = cellAt(ev.clientX, ev.clientY);
      if (!snap || !point) return;
      const range = lineRangeAt(snap, point.row);
      if (range) {
        setSelection(range);
        ev.preventDefault();
      }
    };

    element.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("click", onClick);
    };
  }, [element, cellAt]);

  const copy = useCallback(async () => {
    const snap = snapshotRef.current;
    if (!snap || !selection) return;
    const text = extractSelection(snap, selection);
    if (!text) return;
    await copyText(text);
  }, [selection, copyText]);

  return useMemo(() => ({ selection, clear, copy }), [selection, clear, copy]);
}
