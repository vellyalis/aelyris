import { ClipboardCheck, FolderSearch, GitBranch, Terminal } from "lucide-react";
import { type CSSProperties, memo, type ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyPreset = "agents" | "files" | "tasks" | "worktrees";

interface EmptyStateProps {
  icon?: ReactNode;
  preset?: EmptyPreset;
  title: string;
  description?: string;
}

const PRESET_ICONS: Record<EmptyPreset, typeof Terminal> = {
  agents: Terminal,
  files: FolderSearch,
  tasks: ClipboardCheck,
  worktrees: GitBranch,
};

const PRESET_COLORS: Record<EmptyPreset, string> = {
  agents: "var(--gold)",
  files: "var(--ctp-blue)",
  tasks: "var(--ctp-mauve)",
  worktrees: "var(--ctp-green)",
};

export const EmptyState = memo(function EmptyState({ icon, preset, title, description }: EmptyStateProps) {
  const PresetIcon = preset ? PRESET_ICONS[preset] : null;
  const presetColor = preset ? PRESET_COLORS[preset] : "var(--text-muted)";

  return (
    <div className={styles.root}>
      {PresetIcon ? (
        <div
          className={styles.presetIcon}
          aria-hidden="true"
          style={
            {
              "--empty-accent": presetColor,
            } as CSSProperties
          }
        >
          <PresetIcon size={18} color={presetColor} strokeWidth={1.5} />
        </div>
      ) : icon ? (
        <span className={styles.customIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.title}>{title}</span>
      {description && <span className={styles.description}>{description}</span>}
    </div>
  );
});
