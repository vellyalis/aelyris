import { memo } from "react";
import styles from "./LoadingSkeleton.module.css";

interface LoadingSkeletonProps {
  /** Which shape to paint. "row" stacks N row silhouettes, "card" stacks N
   *  card silhouettes. Use "line" for inline paragraph placeholders. */
  variant?: "row" | "card" | "line";
  /** How many placeholder rows/cards/lines to paint. Defaults to 3. */
  count?: number;
  /** When true, suppresses the shimmer animation (e.g. for tests or when
   *  the consumer wants a static silhouette). */
  static?: boolean;
  /** Optional accessible label announced to screen readers. */
  label?: string;
}

/**
 * Row-aware loading placeholder that matches the row height tokens used
 * by FileTree, SCM, PRInspector, QuickOpen, HistorySearch, CommandPalette
 * so the content shift when data arrives is minimal. Shimmer respects
 * prefers-reduced-motion via the global CSS rule.
 *
 * Shared primitive introduced in the 2026-04-24 Liquid Glass audit
 * (Wave 2.5) to replace ad-hoc "Loading..." text across async panels.
 */
export const LoadingSkeleton = memo(function LoadingSkeleton({
  variant = "row",
  count = 3,
  static: isStatic,
  label = "Loading",
}: LoadingSkeletonProps) {
  const shapeClass =
    variant === "card" ? styles.card : variant === "line" ? styles.line : styles.row;
  const staticClass = isStatic ? ` ${styles.static}` : "";
  return (
    <div className={styles.stack} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${shapeClass}${staticClass}`} aria-hidden="true" />
      ))}
    </div>
  );
});
