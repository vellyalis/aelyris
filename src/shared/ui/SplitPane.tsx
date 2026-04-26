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
        const newRatio = Math.max(minSize / total, Math.min(1 - minSize / total, pos / total));
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
    [direction, minSize],
  );

  /* Keyboard a11y — Arrow keys nudge the ratio by 2 % (Shift = 8 %).
   * The left/right pane sidebars already had this; SplitPane was the
   * lone drag surface that locked keyboard users out of resize.
   * `role="separator"` + `aria-orientation` + `aria-valuenow` follow
   * the WAI-ARIA pattern. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isHorizontal = direction === "horizontal";
      const grow = e.shiftKey ? 0.08 : 0.02;
      const dec = isHorizontal ? "ArrowLeft" : "ArrowUp";
      const inc = isHorizontal ? "ArrowRight" : "ArrowDown";
      if (e.key !== dec && e.key !== inc) return;
      e.preventDefault();
      setRatio((prev) => {
        const delta = e.key === inc ? grow : -grow;
        const next = Math.max(0.05, Math.min(0.95, prev + delta));
        onRatioChangeRef.current?.(next);
        return next;
      });
    },
    [direction],
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
