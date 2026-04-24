import { memo } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string }> = {
  default: { bg: "var(--white-10)", color: "var(--text-secondary)" },
  success: { bg: "color-mix(in srgb, var(--ctp-green) 15%, transparent)", color: "var(--ctp-green)" },
  warning: { bg: "color-mix(in srgb, var(--ctp-yellow) 15%, transparent)", color: "var(--ctp-yellow)" },
  error: { bg: "color-mix(in srgb, var(--ctp-red) 15%, transparent)", color: "var(--ctp-red)" },
  info: { bg: "color-mix(in srgb, var(--ctp-blue) 15%, transparent)", color: "var(--ctp-blue)" },
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
        padding: "var(--space-1) var(--space-3)",
        fontSize: "var(--text-xs)",
        fontFamily: "var(--font-mono)",
        fontWeight: "var(--weight-medium)",
        borderRadius: "var(--radius-sm)",
        background: style.bg,
        color: style.color,
        lineHeight: "var(--leading-tight)",
      }}
    >
      {children}
    </span>
  );
});
