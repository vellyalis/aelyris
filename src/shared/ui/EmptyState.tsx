import { memo, type ReactNode } from "react";
import { Terminal, FolderSearch, ClipboardCheck, GitBranch } from "lucide-react";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 32,
        color: "var(--text-muted)",
        textAlign: "center",
      }}
    >
      {PresetIcon ? (
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${presetColor}12`,
          border: `1px solid ${presetColor}25`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <PresetIcon size={20} color={presetColor} strokeWidth={1.5} />
        </div>
      ) : icon ? (
        <span style={{ fontSize: 24, opacity: 0.5 }}>{icon}</span>
      ) : null}
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
        {title}
      </span>
      {description && (
        <span style={{ fontSize: 11, maxWidth: 220, lineHeight: 1.5 }}>{description}</span>
      )}
    </div>
  );
});
