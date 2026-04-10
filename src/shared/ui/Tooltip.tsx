import { memo, useState, useRef, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export const Tooltip = memo(function Tooltip({
  content,
  children,
  position = "top",
  delay = 400,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  const positionStyle = getPositionStyle(position);

  return (
    <span
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ position: "relative", display: "inline-flex" }}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...positionStyle,
            padding: "var(--space-2) var(--space-4)",
            fontSize: "var(--text-sm)",
            color: "var(--text-primary)",
            background: "var(--aether-bg-card)",
            border: "1px solid var(--white-10)",
            borderRadius: "var(--radius-sm)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: "var(--z-tooltip)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
});

function getPositionStyle(position: string): React.CSSProperties {
  switch (position) {
    case "bottom":
      return { top: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)" };
    case "left":
      return { right: "calc(100% + 4px)", top: "50%", transform: "translateY(-50%)" };
    case "right":
      return { left: "calc(100% + 4px)", top: "50%", transform: "translateY(-50%)" };
    default: // top
      return { bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)" };
  }
}
