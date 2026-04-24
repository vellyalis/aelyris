import { memo } from "react";
import styles from "./GitStatusPip.module.css";

export type GitStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted" | "ignored";

interface GitStatusPipProps {
  status: GitStatus | string;
  /** `letter` renders the M/A/D/R/?/! glyph (SCM row style). `dot` renders a
   *  small colored disc suitable for dense rows like the file tree. */
  variant?: "letter" | "dot";
  className?: string;
}

interface StatusMeta {
  letter: string;
  label: string;
  /** CSS color token — resolved at render time via `var()`. */
  tone: string;
}

const STATUS_META: Record<GitStatus, StatusMeta> = {
  modified: { letter: "M", label: "Modified", tone: "var(--ctp-yellow)" },
  added: { letter: "A", label: "Added", tone: "var(--ctp-green)" },
  deleted: { letter: "D", label: "Deleted", tone: "var(--ctp-red)" },
  renamed: { letter: "R", label: "Renamed", tone: "var(--ctp-cyan)" },
  untracked: { letter: "?", label: "Untracked", tone: "var(--ctp-green)" },
  conflicted: { letter: "!", label: "Conflicted", tone: "var(--ctp-red)" },
  ignored: { letter: "•", label: "Ignored", tone: "var(--text-muted)" },
};

function resolveMeta(status: string): StatusMeta {
  return STATUS_META[status as GitStatus] ?? STATUS_META.modified;
}

export const GitStatusPip = memo(function GitStatusPip({ status, variant = "letter", className }: GitStatusPipProps) {
  const meta = resolveMeta(status);
  const classes = [styles.pip, styles[variant], className].filter(Boolean).join(" ");

  if (variant === "dot") {
    return (
      <span
        className={classes}
        style={{ background: meta.tone }}
        role="img"
        aria-label={meta.label}
        data-status={status}
      />
    );
  }

  return (
    <span
      className={classes}
      style={{ color: meta.tone }}
      aria-label={meta.label}
      title={meta.label}
      data-status={status}
    >
      {meta.letter}
    </span>
  );
});

/** Re-exported map for callers that want to render their own chrome (e.g. a
 *  tooltip or legend) without duplicating the color/label pairs. */
export const GIT_STATUS_META = STATUS_META;
