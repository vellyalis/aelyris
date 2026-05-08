import { memo } from "react";
import type { ToolName } from "../types/toolBadge";
import { TOOL_COLORS } from "../types/toolBadge";
import styles from "./ToolBadge.module.css";

interface ToolBadgeProps {
  tool: ToolName;
}

export const ToolBadge = memo(function ToolBadge({ tool }: ToolBadgeProps) {
  const color = TOOL_COLORS[tool];
  // `${color}40` pre-appended 25% alpha back when TOOL_COLORS held hex
  // strings. Now that the palette lives on CSS custom properties, that
  // concatenation would produce invalid CSS (`var(--ctp-yellow)40`). Use
  // `color-mix` to keep the 25%-alpha border effect theme-responsive.
  return (
    <span className={styles.badge} style={{ color, borderColor: `color-mix(in srgb, ${color} 25%, transparent)` }}>
      {tool}
    </span>
  );
});
