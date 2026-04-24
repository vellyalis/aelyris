import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { memo } from "react";

export type WatchdogDecisionType = "approved" | "denied" | "manual";

interface WatchdogBadgeProps {
  decision: WatchdogDecisionType;
  tool: string;
  rule?: string;
}

const CONFIG: Record<WatchdogDecisionType, { icon: typeof ShieldCheck; color: string; label: string }> = {
  approved: { icon: ShieldCheck, color: "#a6e3a1", label: "Approved" },
  denied: { icon: ShieldX, color: "#f38ba8", label: "Denied" },
  manual: { icon: ShieldQuestion, color: "#f9e2af", label: "Manual" },
};

export const WatchdogBadge = memo(function WatchdogBadge({ decision, tool, rule }: WatchdogBadgeProps) {
  const { icon: Icon, color, label } = CONFIG[decision];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        borderRadius: 3,
        background: `${color}15`,
        border: `1px solid ${color}30`,
        fontSize: 9,
        color,
        fontFamily: "var(--font-mono)",
      }}
      title={rule ? `Rule: ${rule}` : `Tool: ${tool}`}
    >
      <Icon size={10} />
      {label}: {tool}
    </span>
  );
});
