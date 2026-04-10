import { memo } from "react";

interface SpinnerProps {
  size?: number;
  color?: string;
  label?: string;
}

export const Spinner = memo(function Spinner({ size = 16, color = "var(--text-muted)", label }: SpinnerProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" opacity="0.2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span style={{ fontSize: 11, color }}>{label}</span>}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
});
