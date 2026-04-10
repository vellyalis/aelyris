import { memo, type ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
}

export const EmptyState = memo(function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-16)",
        color: "var(--text-muted)",
        textAlign: "center",
      }}
    >
      {icon && <span style={{ fontSize: 24, opacity: 0.5 }}>{icon}</span>}
      <span style={{ fontSize: "var(--text-lg)", fontWeight: 500, color: "var(--text-secondary)" }}>
        {title}
      </span>
      {description && (
        <span style={{ fontSize: "var(--text-base)", maxWidth: 260 }}>{description}</span>
      )}
    </div>
  );
});
