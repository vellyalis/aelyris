import { memo } from "react";
import type { ToolName } from "../types/toolBadge";
import { TOOL_COLORS } from "../types/toolBadge";
import styles from "./ToolBadge.module.css";

interface ToolBadgeProps {
  tool: ToolName;
}

export const ToolBadge = memo(function ToolBadge({ tool }: ToolBadgeProps) {
  const color = TOOL_COLORS[tool];
  return (
    <span className={styles.badge} style={{ color, borderColor: `${color}40` }}>
      {tool}
    </span>
  );
});
