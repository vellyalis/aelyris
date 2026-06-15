import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { GitBranch, TerminalSquare, Zap } from "lucide-react";
import { formatRelativeAge } from "../../shared/lib/relativeTime";
import { computeTokenProgress } from "../../shared/lib/tokenProgress";
import { getSessionColor, isAgentStatus, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import type { InteractiveSession } from "../../shared/types/interactiveAgent";
import { getCliColor, getCliLabel } from "../../shared/types/interactiveAgent";
import { getMaxTokens } from "../../shared/types/model";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { StopButton } from "../../shared/ui/StopButton";
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
  const maxTokens = getMaxTokens(is.model);
  const backendLabel =
    is.backend === "sidecar" ? "sidecar" : is.backend === "native" ? "native fallback" : "backend unknown";
  const pct = computeTokenProgress(is.status, is.tokens_used, maxTokens);
  const knownStatus = isAgentStatus(is.status) ? is.status : null;

  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: This context-menu card contains nested action buttons, so a button wrapper would be invalid HTML. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Focus interactive session ${getCliLabel(is.cli)}`}
          className={`${styles.card} ${styles.cardInteractive}`}
          onClick={() => onFocus?.(is.id)}
          onKeyDown={(e) => {
            if (e.currentTarget !== e.target) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocus?.(is.id);
            }
          }}
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
            <PixelAvatar seed={is.id} size={30} />
            <div className={styles.cardInfo}>
              <div className={styles.cardNameRow}>
                <TerminalSquare size={10} style={{ color: cliColor }} />
                <span className={styles.cardName}>{getCliLabel(is.cli)}</span>
                {is.worktree_branch && (
                  <span className={styles.cardBranch} title={`Worktree branch: ${is.worktree_branch}`}>
                    <Zap size={10} strokeWidth={1.75} aria-hidden="true" />
                    {is.worktree_branch}
                  </span>
                )}
              </div>
              <div className={styles.cardStatusRow}>
                {knownStatus && <StatusIcon status={knownStatus} size={10} />}
                <span
                  className={styles.cardStatusLabel}
                  style={{ color: knownStatus ? STATUS_COLORS[knownStatus] : "#cdd6f4" }}
                >
                  {knownStatus ? STATUS_LABELS[knownStatus] : is.status}
                </span>
                {pct > 0 && pct < 100 && <span className={styles.cardPct}>{pct}%</span>}
                <span className={styles.cardPct} title={`PTY backend: ${backendLabel}`}>
                  {backendLabel}
                </span>
                <span className={styles.cardAge}>{formatRelativeAge(is.started_at * 1000)}</span>
              </div>
            </div>
          </div>
          {is.initial_prompt && (
            <div className={styles.cardPreview}>
              <span className={styles.cardPreviewText}>{is.initial_prompt}</span>
            </div>
          )}
          {is.status !== "done" && is.status !== "idle" && (
            <div className={styles.cardMeta}>
              <StopButton
                className={styles.stopBtn}
                label={`Stop interactive session ${is.id}`}
                onStop={() => onStop?.(is.id)}
              />
            </div>
          )}
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
          </div>
          {is.worktree_branch && (
            <div className={styles.worktreeInfo}>
              <GitBranch size={10} />
              <span className={styles.worktreeBranch}>{is.worktree_branch}</span>
            </div>
          )}
        </div>
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
