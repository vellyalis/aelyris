import { memo } from "react";
import styles from "./ContextGauge.module.css";

interface ContextGaugeProps {
  percent: number; // 0-100
  width?: number;
}

function gaugeColor(pct: number): string {
  if (pct >= 95) return "#f38ba8"; // critical red
  if (pct >= 80) return "#fab387"; // warning orange
  if (pct >= 60) return "#f9e2af"; // caution yellow
  return "#a6e3a1"; // safe green
}

export const ContextGauge = memo(function ContextGauge({ percent, width = 60 }: ContextGaugeProps) {
  const color = gaugeColor(percent);
  const isCritical = percent >= 95;
  return (
    <div className={styles.gauge} style={{ width }}>
      <div className={styles.track}>
        <div
          className={`${styles.bar} ${isCritical ? styles.barCritical : ""}`}
          style={{ width: `${Math.min(100, percent)}%`, background: color }}
        />
      </div>
      <span className={styles.label} style={{ color }}>{Math.round(percent)}%</span>
    </div>
  );
});
