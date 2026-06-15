/**
 * Pure per-row repaint decision for the terminal canvas diff loop.
 *
 * Extracted from `TerminalCanvas` so the invariant can be unit-tested without
 * a canvas 2D context (jsdom does not implement `getContext`). The decision is
 * deliberately small but correctness-critical: a wrong "skip" leaves stale
 * pixels on the canvas — e.g. the scroll-to-live bug where composite
 * scrollback rows were left painted because the live snapshot was unchanged.
 */
export interface RowRepaintFlags {
  /** The grid dimensions (cols/rows) changed since the last paint. */
  dimsChanged: boolean;
  /** Cell metrics, canvas size, or device-pixel-ratio changed. */
  canvasGeometryChanged: boolean;
  /**
   * The paint source switched between the live grid and the composite
   * scrollback grid. The previous frame recorded the live snapshot even when
   * it painted composite cells, so this transition must repaint every row.
   */
  viewModeChanged: boolean;
  /** This row gained or lost selection highlighting. */
  selDirtyRow: boolean;
  /** A search band on this row appeared, moved, or changed active state. */
  matchDirtyRow: boolean;
  /** A hovered-link underline on this row appeared or cleared. */
  hoverDirtyRow: boolean;
  /** The cursor entered/left this row, blinked, or its ghost text changed. */
  cursorDirtyRow: boolean;
  /** This row's cell array differs by reference from the last painted frame. */
  rowContentChanged: boolean;
}

/**
 * Returns `true` when the row must be repainted this frame. A row may be
 * skipped only when every invalidation is absent and its content is
 * reference-equal to the previously painted row.
 */
export function shouldRepaintRow(flags: RowRepaintFlags): boolean {
  return (
    flags.dimsChanged ||
    flags.canvasGeometryChanged ||
    flags.viewModeChanged ||
    flags.selDirtyRow ||
    flags.matchDirtyRow ||
    flags.hoverDirtyRow ||
    flags.cursorDirtyRow ||
    flags.rowContentChanged
  );
}
