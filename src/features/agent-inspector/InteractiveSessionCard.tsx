import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { GitBranch, TerminalSquare, Zap } from "lucide-react";
import { type AgentStatus, getSessionColor, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import type { InteractiveSession } from "../../shared/types/interactiveAgent";
import { getCliColor, getCliLabel } from "../../shared/types/interactiveAgent";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import styles from "./AgentInspector.module.css";

interface InteractiveSessionCardProps {
  session: InteractiveSession;
  onFocus?: (id: string) => void;
  onStop?: (id: string) => void;
  onEndAndRemoveWorktree?: (id: string) => void;
}

export function InteractiveSessionCard({
  session: is,
  onFocus,
  onStop,
  onEndAndRemoveWorktree,
}: InteractiveSessionCardProps) {
  const sColor = getSessionColor(is.id);
  const cliColor = getCliColor(is.cli);
  const pct =
    is.status === "done"
      ? 100
      : is.status === "idle"
        ? 0
        : is.tokens_used > 0
          ? Math.min(95, Math.round((is.tokens_used / 10000) * 100))
          : 2;

  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        <button
          className={`${styles.card} ${styles.cardInteractive}`}
          onClick={() => onFocus?.(is.id)}
          style={
            {
              "--session-accent": sColor.accent,
              "--session-dim": sColor.dim,
              "--session-subtle": sColor.subtle,
              "--session-glow": sColor.glow,
            } as React.CSSProperties
          }
        >
          <div className={styles.cardTop}>
            <PixelAvatar seed={is.id} size={36} />
            <div className={styles.cardInfo}>
              <div className={styles.cardNameRow}>
                <TerminalSquare size={10} style={{ color: cliColor }} />
                <span className={styles.cardName}>{getCliLabel(is.cli)}</span>
                {is.worktree_branch && (
                  <span className={styles.cardBranch} title={`Worktree branch: ${is.worktree_branch}`}>
                    <Zap size={9} strokeWidth={1.75} aria-hidden="true" />
                    {is.worktree_branch}
                  </span>
                )}
              </div>
              <div className={styles.cardStatusRow}>
                <StatusIcon status={is.status as AgentStatus} size={10} />
                <span
                  className={styles.cardStatusLabel}
                  style={{ color: STATUS_COLORS[is.status as AgentStatus] ?? "#cdd6f4" }}
                >
                  {STATUS_LABELS[is.status as AgentStatus] ?? is.status}
                </span>
                <span className={styles.cardAge}>{formatAge(is.started_at * 1000)}</span>
              </div>
            </div>
            <ContextGauge percent={pct} />
          </div>
          {is.initial_prompt && (
            <div className={styles.cardPreview}>
              <span className={styles.cardPreviewText}>{is.initial_prompt}</span>
            </div>
          )}
          <div className={styles.cardMeta}>
            <span className={styles.cardModel}>{is.model}</span>
            <span className={styles.cardCost}>&lt;${is.cost.toFixed(2)}</span>
            {is.status !== "done" && is.status !== "idle" && (
              <span
                className={styles.stopBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onStop?.(is.id);
                }}
              >
                ■
              </span>
            )}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
          </div>
          {is.worktree_branch && (
            <div className={styles.worktreeInfo}>
              <GitBranch size={10} />
              <span className={styles.worktreeBranch}>{is.worktree_branch}</span>
            </div>
          )}
        </button>
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={styles.ctxMenu}>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onFocus?.(is.id)}>
            <TerminalSquare size={10} style={{ marginRight: 4 }} />
            Open Terminal
          </RadixContextMenu.Item>
          <RadixContextMenu.Separator className={styles.ctxDivider} />
          {is.worktree_branch ? (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onEndAndRemoveWorktree?.(is.id)}>
              End Session &amp; Remove Worktree
            </RadixContextMenu.Item>
          ) : (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStop?.(is.id)}>
              End Session
            </RadixContextMenu.Item>
          )}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}

function formatAge(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
