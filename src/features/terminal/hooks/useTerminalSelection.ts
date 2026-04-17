import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pixelToCell } from "../keymap";
import {
  extractSelection,
  lineRangeAt,
  wordRangeAt,
  type SelectionRange,
} from "../selection";
import type { GridSnapshot } from "../../../shared/types/terminal";

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
 * DOM — default impls use `navigator.clipboard.writeText` and the caller's
 * latest snapshot via ref.
 */

export type CopyTextFn = (text: string) => Promise<void> | void;

const defaultCopyText: CopyTextFn = (text) => {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    return navigator.clipboard.writeText(text).catch(() => {});
  }
  return undefined;
};

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

  const clear = useCallback(() => setSelection(null), []);

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const snap = snapshotRef.current;
      if (!element || !snap) return null;
      const rect = element.getBoundingClientRect();
      return pixelToCell(
        clientX,
        clientY,
        rect,
        cellWidth,
        cellHeight,
        snap.cols,
        snap.rows,
      );
    },
    [element, cellWidth, cellHeight],
  );

  useEffect(() => {
    if (!element) return;

    const onMouseDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      const currentSelection = selectionRef.current;
      if (ev.shiftKey && currentSelection) {
        const point = cellAt(ev.clientX, ev.clientY);
        if (!point) return;
        setSelection({
          anchor: currentSelection.anchor,
          focus: point,
          mode: "char",
        });
        draggingRef.current = true;
        ev.preventDefault();
        element.focus();
        return;
      }
      const point = cellAt(ev.clientX, ev.clientY);
      if (!point) return;
      draggingRef.current = true;
      setSelection({
        anchor: point,
        focus: point,
        mode: "char",
      });
      ev.preventDefault();
      element.focus();
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const point = cellAt(ev.clientX, ev.clientY);
      if (!point) return;
      setSelection((prev) =>
        prev ? { ...prev, focus: point } : prev,
      );
    };

    const onMouseUp = () => {
      draggingRef.current = false;
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

  return useMemo(
    () => ({ selection, clear, copy }),
    [selection, clear, copy],
  );
}
