import { useState, useRef, useCallback, type ReactNode } from "react";
import styles from "./SplitPane.module.css";

interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  first: ReactNode;
  second: ReactNode;
  defaultRatio?: number; // 0-1, default 0.5
  minSize?: number; // min pixels for each pane
}

export function SplitPane({
  direction,
  first,
  second,
  defaultRatio = 0.5,
  minSize = 100,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const container = containerRef.current;
      if (!container) return;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current || !container) return;
        const rect = container.getBoundingClientRect();
        const isHorizontal = direction === "horizontal";
        const total = isHorizontal ? rect.width : rect.height;
        const pos = isHorizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        const newRatio = Math.max(minSize / total, Math.min(1 - minSize / total, pos / total));
        setRatio(newRatio);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [direction, minSize],
  );

  const isHorizontal = direction === "horizontal";
  const firstSize = `${ratio * 100}%`;
  const secondSize = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ flexDirection: isHorizontal ? "row" : "column" }}
    >
      <div className={styles.pane} style={{ [isHorizontal ? "width" : "height"]: firstSize }}>
        {first}
      </div>
      <div
        className={`${styles.handle} ${isHorizontal ? styles.handleH : styles.handleV}`}
        onMouseDown={handleMouseDown}
      />
      <div className={styles.pane} style={{ [isHorizontal ? "width" : "height"]: secondSize }}>
        {second}
      </div>
    </div>
  );
}
