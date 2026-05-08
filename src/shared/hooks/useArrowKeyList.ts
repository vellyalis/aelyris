import { useCallback, useRef } from "react";

interface UseArrowKeyListOptions<T> {
  /** Items in display order. */
  items: readonly T[];
  /** Called when the user selects an item via Enter or Space. */
  onSelect?: (item: T, index: number) => void;
  /** Whether typing Home/End should jump to first/last. Defaults to true. */
  enableHomeEnd?: boolean;
  /** Vertical (ArrowUp/Down) or horizontal (ArrowLeft/Right) traversal.
   *  Defaults to "vertical". */
  orientation?: "vertical" | "horizontal";
}

/**
 * WAI-ARIA roving-tabindex helper for listbox/tree/grid surfaces.
 * Returns a `handleKeyDown` to attach to the container, plus a ref
 * that the container should forward. The hook does not manage React
 * state — callers track `activeIndex` themselves (usually via existing
 * selection state) and pass it in via `activeIndex`.
 *
 * The consumer is responsible for:
 *   - setting `tabIndex={index === activeIndex ? 0 : -1}` on each row
 *   - calling `ref.current?.focus()` when activeIndex changes if
 *     keyboard focus should follow selection
 *
 * Introduced in Wave 2.6 of the 2026-04-24 Liquid Glass audit.
 */
export function useArrowKeyList<T>({
  items,
  onSelect,
  enableHomeEnd = true,
  orientation = "vertical",
}: UseArrowKeyListOptions<T>) {
  const activeIndexRef = useRef(0);

  const setActive = useCallback((i: number, container: HTMLElement | null) => {
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>("[data-list-row]");
    const row = rows[i];
    if (row) {
      // Roving tabindex: the newly-active row becomes the sole tab stop.
      rows.forEach((el, idx) => {
        el.tabIndex = idx === i ? 0 : -1;
      });
      row.focus();
    }
    activeIndexRef.current = i;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (items.length === 0) return;
      const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
      const prev = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
      // Clamp the stored index against the *current* item count: items
      // can shrink between renders (e.g. a search filter narrows the
      // list, an item is dismissed) and a stale activeIndexRef pointing
      // past the new tail would (a) make Enter/Space silently no-op
      // because `items[i]` is undefined and (b) make the next ArrowDown
      // jump back to the tail rather than advance from the visible
      // selection. Re-anchoring on every key event keeps the ref in
      // sync without forcing a re-render.
      const i = Math.min(items.length - 1, Math.max(0, activeIndexRef.current));
      activeIndexRef.current = i;
      if (e.key === next) {
        e.preventDefault();
        setActive(Math.min(items.length - 1, i + 1), e.currentTarget);
      } else if (e.key === prev) {
        e.preventDefault();
        setActive(Math.max(0, i - 1), e.currentTarget);
      } else if (enableHomeEnd && e.key === "Home") {
        e.preventDefault();
        setActive(0, e.currentTarget);
      } else if (enableHomeEnd && e.key === "End") {
        e.preventDefault();
        setActive(items.length - 1, e.currentTarget);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[i];
        if (item) onSelect?.(item, i);
      }
    },
    [items, orientation, enableHomeEnd, onSelect, setActive],
  );

  return { handleKeyDown, setActive, activeIndexRef };
}
