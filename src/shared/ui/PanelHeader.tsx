import { ChevronRight } from "lucide-react";
import { memo, type ReactNode } from "react";
import styles from "./PanelHeader.module.css";

interface PanelHeaderProps {
  title: string;
  /** Small icon rendered to the left of the title. */
  leadingIcon?: ReactNode;
  /** Secondary text rendered next to the title in a muted tone (e.g. project
   *  name, session subtitle). */
  subtitle?: ReactNode;
  /** Numeric badge rendered after the title (e.g. task count). */
  count?: number | string;
  /** Right-side cluster (buttons, cost readout, etc.). */
  actions?: ReactNode;
  /** Switch to a denser padding scale — used by InlineResultPanel where the
   *  header sits inside a narrower card. */
  dense?: boolean;
  /** When provided the header becomes an expand/collapse button. */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}

export const PanelHeader = memo(function PanelHeader({
  title,
  leadingIcon,
  subtitle,
  count,
  actions,
  dense = false,
  collapsible = false,
  collapsed = false,
  onToggle,
  className,
}: PanelHeaderProps) {
  const classes = [styles.header, dense ? styles.dense : "", className].filter(Boolean).join(" ");

  const titleBody = (
    <>
      {collapsible && (
        <ChevronRight
          size={12}
          className={`${styles.chevron} ${collapsed ? "" : styles.chevronOpen}`}
          aria-hidden="true"
        />
      )}
      {leadingIcon && (
        <span className={styles.leading} aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      <span className={styles.title}>{title}</span>
      {subtitle != null && <span className={styles.subtitle}>{subtitle}</span>}
      {count != null && <span className={styles.count}>{count}</span>}
    </>
  );

  if (collapsible) {
    return (
      <div className={classes} data-collapsible="true">
        <button type="button" className={styles.toggle} onClick={onToggle} aria-expanded={!collapsed}>
          {titleBody}
        </button>
        {actions && <span className={styles.actions}>{actions}</span>}
      </div>
    );
  }

  return (
    <div className={classes}>
      {titleBody}
      {actions && <span className={styles.actions}>{actions}</span>}
    </div>
  );
});
