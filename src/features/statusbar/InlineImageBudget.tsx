import { Image as ImageIcon } from "lucide-react";
import { memo } from "react";

import type { ImageMetrics } from "../../shared/types/terminal";
import styles from "./StatusBar.module.css";

/**
 * Sprint 3 wave 3 status-bar badge for the per-pane inline-image cap.
 *
 * Visible only when the active terminal has at least one retained
 * image — an empty pane shows nothing, so the badge never adds noise
 * to a normal shell session.
 *
 * Two warning tiers escalate as the FIFO eviction threshold approaches:
 * - >80 % usage → `warn` tint (catppuccin yellow). Plenty of pixels
 *   left, but the user should know we're trending toward a drop.
 * - >95 % usage → `danger` tint (catppuccin red) plus a tooltip telling
 *   the user the next inline image will start evicting older ones.
 *
 * The byte string is rendered via `formatMiB` so a 50 MiB cap shows as
 * "12.3 / 50 MiB" instead of "12345678 / 52428800". Tabular figures
 * keep the count aligned column-wise as it changes.
 */

export interface InlineImageBudgetProps {
  metrics: ImageMetrics | null;
}

const WARN_RATIO = 0.8;
const DANGER_RATIO = 0.95;

export const InlineImageBudget = memo(function InlineImageBudget({
  metrics,
}: InlineImageBudgetProps) {
  if (!metrics || metrics.count <= 0) return null;

  const ratio = metrics.cap > 0 ? metrics.bytesUsed / metrics.cap : 0;
  const tier = ratio >= DANGER_RATIO ? "danger" : ratio >= WARN_RATIO ? "warn" : "ok";

  const tierClass =
    tier === "danger"
      ? styles.imageBudgetDanger
      : tier === "warn"
        ? styles.imageBudgetWarn
        : "";

  const usedMiB = formatMiB(metrics.bytesUsed);
  const capMiB = formatMiB(metrics.cap);
  const countLabel = `${metrics.count} image${metrics.count === 1 ? "" : "s"}`;
  const ratioPct = Math.min(100, Math.round(ratio * 100));

  const baseTooltip = `Inline images: ${countLabel}, ${usedMiB} / ${capMiB} retained (${ratioPct}% of FIFO cap)`;
  const tooltip =
    tier === "danger"
      ? `${baseTooltip}. FIFO eviction imminent — older images will be dropped on the next add.`
      : tier === "warn"
        ? `${baseTooltip}. Approaching FIFO cap.`
        : baseTooltip;

  return (
    <span
      className={`${styles.item} ${styles.imageBudget} ${tierClass}`.trim()}
      role="status"
      aria-label={tooltip}
      title={tooltip}
    >
      <ImageIcon size={10} strokeWidth={1.75} aria-hidden="true" />
      <span className={styles.imageBudgetText}>
        {usedMiB} / {capMiB} · {metrics.count}
      </span>
    </span>
  );
});

/**
 * Format bytes as MiB. Whole-number MiB values render without a
 * decimal (`50 MiB` instead of `50.0 MiB`) so a fixed cap reads
 * cleanly; fractional values keep one decimal so a 600 KB icon shows
 * as `0.6 MiB` rather than rounding to zero, which would imply the
 * cap is empty. Three-digit MiB values always round to an integer
 * so the badge stays narrow even on long-running sessions.
 */
export function formatMiB(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib >= 100) return `${Math.round(mib)} MiB`;
  // Within ~0.05 MiB of an integer reads as the integer — prevents
  // "12.0 MiB" jitter when the byte count is exactly N MiB.
  if (Math.abs(mib - Math.round(mib)) < 0.05) return `${Math.round(mib)} MiB`;
  return `${mib.toFixed(1)} MiB`;
}
