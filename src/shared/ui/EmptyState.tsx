import { ClipboardCheck, FolderSearch, GitBranch, Terminal } from "lucide-react";
import { memo, type ReactNode } from "react";

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
        gap: "var(--space-5)",
        padding: "var(--space-16)",
        color: "var(--text-muted)",
        textAlign: "center",
      }}
    >
      {PresetIcon ? (
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-lg)",
            background: `color-mix(in srgb, ${presetColor} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${presetColor} 25%, transparent)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PresetIcon size={20} color={presetColor} strokeWidth={1.5} />
        </div>
      ) : icon ? (
        <span aria-hidden="true" style={{ fontSize: "var(--text-4xl)", opacity: 0.5 }}>
          {icon}
        </span>
      ) : null}
      <span
        style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-medium)", color: "var(--text-secondary)" }}
      >
        {title}
      </span>
      {description && (
        <span style={{ fontSize: "var(--text-sm)", maxWidth: 220, lineHeight: "var(--leading-normal)" }}>
          {description}
        </span>
      )}
    </div>
  );
});
