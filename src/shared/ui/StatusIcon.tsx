import { memo } from "react";
import { useAttenuatedPulse } from "../hooks/useAttenuatedPulse";
import type { AgentStatus } from "../types/agent";
import { STATUS_COLORS } from "../types/agent";

const ICON_PATHS: Record<AgentStatus, string> = {
  idle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14H8V8h2v8zm6 0h-2V8h2v8z",
  thinking:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-4h2v2h-2v-2zm1-10c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2-1.79 2-4 2v3h2v-1.47c1.74-.65 3-2.31 3-4.28 0-2.52-2.09-4.25-3-4.25z",
  coding: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z",
  waiting:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  error: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z",
  done: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  generating: "M7 2v11h3v9l7-12h-4l4-8z",
};

const ACTIVE_CLASS: Partial<Record<AgentStatus, string>> = {
  thinking: "status-pulse",
  coding: "status-breathe",
  generating: "status-pulse-fast",
};

interface StatusIconProps {
  status: AgentStatus;
  size?: number;
}

export const StatusIcon = memo(function StatusIcon({ status, size = 12 }: StatusIconProps) {
  const color = STATUS_COLORS[status];
  const isAnimated = status in ACTIVE_CLASS;
  const phase = useAttenuatedPulse(isAnimated);

  const animClass =
    phase === "active" ? ACTIVE_CLASS[status] : phase === "ambient" ? "status-ambient" : undefined;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} className={animClass}>
      <path d={ICON_PATHS[status]} />
    </svg>
  );
});
