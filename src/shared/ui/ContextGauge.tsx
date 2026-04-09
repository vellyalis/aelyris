import { memo } from "react";
import styles from "./ContextGauge.module.css";

interface ContextGaugeProps {
  percent: number; // 0-100
  width?: number;
}

function gaugeColor(pct: number): string {
  if (pct >= 80) return "#f38ba8"; // red
  if (pct >= 60) return "#fab387"; // orange
  if (pct >= 40) return "#f9e2af"; // yellow
  return "#a6e3a1"; // green
}

export const ContextGauge = memo(function ContextGauge({ percent, width = 60 }: ContextGaugeProps) {
  const color = gaugeColor(percent);
  return (
    <div className={styles.gauge} style={{ width }}>
      <div className={styles.track}>
        <div className={styles.bar} style={{ width: `${Math.min(100, percent)}%`, background: color }} />
      </div>
      <span className={styles.label} style={{ color }}>{Math.round(percent)}%</span>
    </div>
  );
});
