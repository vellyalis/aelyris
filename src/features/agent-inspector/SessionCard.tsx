import { type AgentSession, STATUS_COLORS, STATUS_LABELS, getSessionColor } from "../../shared/types/agent";
import { getMaxTokens } from "../../shared/types/model";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { Pencil, GitBranch, Globe, Shield, BarChart3, Send } from "lucide-react";
import styles from "./AgentInspector.module.css";

interface SessionCardProps {
  session: AgentSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onStop?: (id: string) => void;
  onRename: (session: AgentSession) => void;
  onCopyInfo: (session: AgentSession) => void;
  onViewAnalytics: (id: string) => void;
  onCreateWorktree?: (id: string) => void;
  onRemoveWorktree?: (id: string) => void;
  onStartAgent?: (prompt: string) => void;
  onHandoff?: (session: AgentSession) => void;
  onViewDiffs?: (id: string) => void;
  worktreeInputId: string | null;
  worktreeBranch: string;
  onWorktreeBranchChange: (value: string) => void;
  onWorktreeSubmit: (id: string) => void;
  onWorktreeCancel: () => void;
}

export function SessionCard({
  session: s,
  isActive,
  onSelect,
  onStop,
  onRename,
  onCopyInfo,
  onViewAnalytics,
  onCreateWorktree,
  onRemoveWorktree,
  onStartAgent,
  onHandoff,
  onViewDiffs,
  worktreeInputId,
  worktreeBranch,
  onWorktreeBranchChange,
  onWorktreeSubmit,
  onWorktreeCancel,
}: SessionCardProps) {
  const sColor = getSessionColor(s.id);
  const lastLog = s.logs.length > 0 ? s.logs[s.logs.length - 1] : null;
  const pct = s.status === "done" ? 100 : s.status === "idle" ? 0 : s.tokensUsed > 0 ? Math.min(99, Math.round((s.tokensUsed / getMaxTokens(s.model)) * 100)) : 2;

  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        <button
          className={`${styles.card} ${s.watchdog ? styles.cardWatchdog : ""} ${isActive ? styles.cardActive : ""}`}
          onClick={() => onSelect(s.id)}
          style={{
            "--session-accent": sColor.accent,
            "--session-dim": sColor.dim,
            "--session-subtle": sColor.subtle,
            "--session-glow": sColor.glow,
          } as React.CSSProperties}
        >
          <div className={styles.cardTop}>
            <PixelAvatar seed={s.id} size={36} />
            <div className={styles.cardInfo}>
              <div className={styles.cardNameRow}>
                <span className={styles.cardName}>{s.name}</span>
                {s.branch && <span className={styles.cardBranch}>⚡{s.branch}</span>}
                <span className={styles.cardIcons}><Pencil size={9} /></span>
              </div>
              <div className={styles.cardStatusRow}>
                <StatusIcon status={s.status} size={10} />
                <span className={styles.cardStatusLabel} style={{ color: STATUS_COLORS[s.status] }}>{STATUS_LABELS[s.status]}</span>
                {s.permissionMode && (
                  <span className={styles.permBadge} data-mode={s.permissionMode} title={`Permission: ${s.permissionMode}`}>
                    <Shield size={8} />{s.permissionMode === "full" ? "auto" : s.permissionMode}
                  </span>
                )}
                {s.detectedPort && (
                  <span className={styles.portBadge} title={`localhost:${s.detectedPort}`}>
                    <Globe size={8} />:{s.detectedPort}
                  </span>
                )}
                {pct > 0 && pct < 100 && <span className={styles.cardPct}>{pct}%</span>}
                {s.filesChanged !== undefined && s.filesChanged > 0 && <span className={styles.cardFiles}>📎{s.filesChanged}</span>}
                <span className={styles.cardAge}>{formatAge(s.startedAt)}</span>
              </div>
            </div>
            <ContextGauge percent={pct} />
          </div>
          {lastLog && (
            <div className={styles.cardPreview}>
              <span className={styles.cardPreviewText}>{lastLog.content}</span>
            </div>
          )}
          <div className={styles.cardMeta}>
            <span className={styles.cardModel}>{s.model}</span>
            <span className={styles.cardCost}>&lt;${s.cost.toFixed(2)}</span>
            {s.status !== "done" && s.status !== "idle" && (
              <span className={styles.stopBtn} onClick={(e) => { e.stopPropagation(); onStop?.(s.id); }}>■</span>
            )}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
          </div>
          {s.worktree ? (
            <div className={styles.worktreeInfo}>
              <GitBranch size={10} />
              <span className={styles.worktreeBranch}>{s.worktree.branch}</span>
              <span className={styles.worktreeStatus} data-status={s.worktree.status}>{s.worktree.status === "Clean" ? "✓" : s.worktree.status === "Modified" ? "●" : "⚠"}</span>
            </div>
          ) : worktreeInputId === s.id ? (
            <div className={styles.worktreeCreate} onClick={(e) => e.stopPropagation()}>
              <GitBranch size={10} />
              <input
                autoFocus
                className={styles.worktreeInput}
                placeholder="branch name"
                value={worktreeBranch}
                onChange={(e) => onWorktreeBranchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onWorktreeSubmit(s.id);
                  if (e.key === "Escape") onWorktreeCancel();
                }}
              />
              <button className={styles.worktreeBtn} onClick={() => onWorktreeSubmit(s.id)}>Create</button>
            </div>
          ) : null}
          {s.watchdog && (
            <div className={styles.watchdogInfo}>🐕 {s.watchdog}</div>
          )}
        </button>
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={styles.ctxMenu}>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onSelect(s.id)}>Switch to Session</RadixContextMenu.Item>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onRename(s)}>Rename</RadixContextMenu.Item>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onViewAnalytics(s.id)}>
            <BarChart3 size={10} style={{ marginRight: 4 }} />View Analytics
          </RadixContextMenu.Item>
          {(s.filesChanged ?? 0) > 0 && (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onViewDiffs?.(s.id)}>
              <GitBranch size={10} style={{ marginRight: 4 }} />View Diffs ({s.filesChanged})
            </RadixContextMenu.Item>
          )}
          {onHandoff && (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onHandoff(s)}>
              <Send size={10} style={{ marginRight: 4 }} />Hand off to new agent…
            </RadixContextMenu.Item>
          )}
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onCopyInfo(s)}>Copy Info</RadixContextMenu.Item>
          <RadixContextMenu.Separator className={styles.ctxDivider} />
          {s.worktree ? (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onRemoveWorktree?.(s.id)}>
              End Session &amp; Remove Worktree
            </RadixContextMenu.Item>
          ) : (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onCreateWorktree?.(s.id)}>
              Create Worktree
            </RadixContextMenu.Item>
          )}
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStartAgent?.(`Attach watchdog to ${s.name}`)}>Attach Watchdog</RadixContextMenu.Item>
          <RadixContextMenu.Separator className={styles.ctxDivider} />
          <RadixContextMenu.Item className={styles.ctxItem} disabled={s.status === "idle" || s.status === "done"} onSelect={() => onStop?.(s.id)}>
            End Session
          </RadixContextMenu.Item>
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
