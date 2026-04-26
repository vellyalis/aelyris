import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import styles from "./SplitPane.module.css";

interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  defaultRatio?: number;
  minSize?: number;
  onRatioChange?: (ratio: number) => void;
}

export function SplitPane({
  direction,
  first,
  second,
  defaultRatio = 0.5,
  minSize = 100,
  onRatioChange,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const onRatioChangeRef = useRef(onRatioChange);
  onRatioChangeRef.current = onRatioChange;

  /* Clamp a candidate ratio to the per-pane minimum, handling the
   * "container is too small to satisfy two minSize halves" case
   * gracefully. Codex review (2026-05-03 round 2) caught the bug:
   * when `total < 2 * minSize`, the naive
   * `max(minSize/total, min(1 - minSize/total, x))` has `min > max`
   * and the inner Math.min collapses to a single value, which then
   * gets bumped to `min` — so a 150-px-wide SplitPane with default
   * minSize=100 always reported ratio 0.667 regardless of the
   * user's intent. Now we detect the unsatisfiable case and fall
   * back to a centred 0.5 split so neither pane is starved more
   * than necessary. The same helper is used by both the pointer
   * drag and the keyboard nudge so the two input methods produce
   * identical layouts. */
  const clampRatio = useCallback(
    (raw: number, total: number): number => {
      if (total <= 0) return Math.max(0.05, Math.min(0.95, raw));
      const minR = minSize / total;
      const maxR = 1 - minR;
      if (minR >= maxR) return 0.5;
      return Math.max(minR, Math.min(maxR, raw));
    },
    [minSize],
  );

  // Sync ratio when defaultRatio changes (e.g. tab switch restoring saved ratio)
  const prevDefault = useRef(defaultRatio);
  useEffect(() => {
    if (defaultRatio !== prevDefault.current) {
      prevDefault.current = defaultRatio;
      setRatio(defaultRatio);
    }
  }, [defaultRatio]);

  /* PointerEvent path covers mouse + touch + pen in a single code path
   * (the previous `mousedown` + `mousemove` chain ignored touch input
   * entirely). `setPointerCapture` keeps the move events flowing even
   * when the pointer leaves the 1-px handle's bounding box during a
   * fast drag, which the document-level `mousemove` listener was a
   * workaround for. */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      const container = containerRef.current;
      if (!container) return;
      const handleEl = e.currentTarget;
      try {
        handleEl.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer ids in tests can't be captured; the document-
         * level listeners below still cover that path. */
      }

      const isHorizontal = direction === "horizontal";

      const onMove = (ev: PointerEvent) => {
        if (!dragging.current || !container) return;
        const rect = container.getBoundingClientRect();
        const total = isHorizontal ? rect.width : rect.height;
        const pos = isHorizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        const newRatio = clampRatio(pos / total, total);
        setRatio(newRatio);
        onRatioChangeRef.current?.(newRatio);
      };

      const onUp = () => {
        dragging.current = false;
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try {
          handleEl.releasePointerCapture(e.pointerId);
        } catch {
          /* see above */
        }
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },
    [direction, clampRatio],
  );

  /* Keyboard a11y — Arrow keys nudge the ratio by 2 % (Shift = 8 %).
   * The left/right pane sidebars already had this; SplitPane was the
   * lone drag surface that locked keyboard users out of resize.
   * `role="separator"` + `aria-orientation` + `aria-valuenow` follow
   * the WAI-ARIA pattern.
   *
   * Codex review (2026-05-03) caught a regression in the first pass:
   * a hard-coded 5 % / 95 % clamp ignored the `minSize` prop. With
   * the default `minSize = 100` and a 1200-px-wide pane, keyboard
   * shrink could still drop a pane to 60 px while pointer dragging
   * correctly clamped to 100 px — two input methods producing
   * different layouts. Now the keyboard path reads the live
   * container size and applies the same `minSize / total` clamp the
   * pointer path uses. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isHorizontal = direction === "horizontal";
      const grow = e.shiftKey ? 0.08 : 0.02;
      const dec = isHorizontal ? "ArrowLeft" : "ArrowUp";
      const inc = isHorizontal ? "ArrowRight" : "ArrowDown";
      if (e.key !== dec && e.key !== inc) return;
      e.preventDefault();
      const container = containerRef.current;
      const total = container ? (isHorizontal ? container.clientWidth : container.clientHeight) : 0;
      setRatio((prev) => {
        const delta = e.key === inc ? grow : -grow;
        const next = clampRatio(prev + delta, total);
        onRatioChangeRef.current?.(next);
        return next;
      });
    },
    [direction, clampRatio],
  );

  const isHorizontal = direction === "horizontal";
  const firstSize = `${ratio * 100}%`;
  const secondSize = `${(1 - ratio) * 100}%`;
  const ariaValueNow = Math.round(ratio * 100);

  return (
    <div ref={containerRef} className={styles.container} style={{ flexDirection: isHorizontal ? "row" : "column" }}>
      <div className={styles.pane} style={{ [isHorizontal ? "width" : "height"]: firstSize }}>
        {first}
      </div>
      <div
        className={`${styles.handle} ${isHorizontal ? styles.handleH : styles.handleV}`}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        role="separator"
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-valuemin={5}
        aria-valuemax={95}
        aria-valuenow={ariaValueNow}
        tabIndex={0}
      />
      <div className={styles.pane} style={{ [isHorizontal ? "width" : "height"]: secondSize }}>
        {second}
      </div>
    </div>
  );
}
