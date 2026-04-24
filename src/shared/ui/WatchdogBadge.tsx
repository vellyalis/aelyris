import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { memo } from "react";

export type WatchdogDecisionType = "approved" | "denied" | "manual";

interface WatchdogBadgeProps {
  decision: WatchdogDecisionType;
  tool: string;
  rule?: string;
}

const CONFIG: Record<WatchdogDecisionType, { icon: typeof ShieldCheck; colorVar: string; label: string }> = {
  approved: { icon: ShieldCheck, colorVar: "--ctp-green", label: "Approved" },
  denied: { icon: ShieldX, colorVar: "--ctp-red", label: "Denied" },
  manual: { icon: ShieldQuestion, colorVar: "--ctp-yellow", label: "Manual" },
};

export const WatchdogBadge = memo(function WatchdogBadge({ decision, tool, rule }: WatchdogBadgeProps) {
  const { icon: Icon, colorVar, label } = CONFIG[decision];
  const color = `var(${colorVar})`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        borderRadius: 3,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
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
