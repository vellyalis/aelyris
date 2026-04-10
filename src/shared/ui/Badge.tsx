import { memo } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  default: { bg: "var(--white-10)", color: "var(--text-secondary)" },
  success: { bg: "rgba(166, 227, 161, 0.15)", color: "var(--ctp-green)" },
  warning: { bg: "rgba(249, 226, 175, 0.15)", color: "var(--ctp-yellow)" },
  error: { bg: "rgba(243, 139, 168, 0.15)", color: "var(--ctp-red)" },
  info: { bg: "rgba(137, 180, 250, 0.15)", color: "var(--ctp-blue)" },
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export const Badge = memo(function Badge({ children, variant = "default" }: BadgeProps) {
  const style = VARIANT_STYLES[variant];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "1px var(--space-3)",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        borderRadius: "var(--radius-sm)",
        background: style.bg,
        color: style.color,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
});
