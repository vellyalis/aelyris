import * as RadixContextMenu from "@radix-ui/react-context-menu";
import {
  AlertTriangle,
  BarChart3,
  FileWarning,
  GitBranch,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Send,
  Zap,
} from "lucide-react";
import { type BudgetThresholds, getBudgetWarning } from "../../shared/lib/budgetStatus";
import { getRole } from "../../shared/lib/orchestrator";
import { type AgentSession, getSessionColor, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import { getMaxTokens } from "../../shared/types/model";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { StopButton } from "../../shared/ui/StopButton";
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
  budgetThresholds?: BudgetThresholds;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  worktreeInputId: string | null;
  worktreeBranch: string;
  onWorktreeBranchChange: (value: string) => void;
  onWorktreeSubmit: (id: string) => void;
  onWorktreeCancel: () => void;
  /** Paths this session edits that another session is also editing. */
  conflictingPaths?: readonly string[];
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
  budgetThresholds,
  isSelected,
  onToggleSelect,
  worktreeInputId,
  worktreeBranch,
  onWorktreeBranchChange,
  onWorktreeSubmit,
  onWorktreeCancel,
  conflictingPaths,
}: SessionCardProps) {
  const sColor = getSessionColor(s.id);
  const lastLog = s.logs.length > 0 ? s.logs[s.logs.length - 1] : null;
  const pct =
    s.status === "done"
      ? 100
      : s.status === "idle"
        ? 0
        : s.tokensUsed > 0
          ? Math.min(99, Math.round((s.tokensUsed / getMaxTokens(s.model)) * 100))
          : 2;
  const warning = getBudgetWarning(s, budgetThresholds);
  const isLive = s.status !== "done" && s.status !== "idle";
  const role = getRole(s.role);
  const conflictCount = conflictingPaths?.length ?? 0;

  // Secondary info folded behind a single MoreHorizontal badge so the status
  // row no longer carries 8+ pill-shaped chips. Branch / model ID / cost live
  // in .cardMeta already; these are the "nice-to-know, not eye-anchor" bits.
  const secondaryInfo: string[] = [];
  if (s.permissionMode) secondaryInfo.push(`Permission: ${s.permissionMode === "full" ? "auto" : s.permissionMode}`);
  if (s.detectedPort) secondaryInfo.push(`Port: localhost:${s.detectedPort}`);
  const secondaryTitle = secondaryInfo.join("\n");

  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        <button
          className={`${styles.card} ${s.watchdog ? styles.cardWatchdog : ""} ${isActive ? styles.cardActive : ""} ${isSelected ? styles.cardSelected : ""}`}
          data-live={isLive || undefined}
          onClick={(e) => {
            if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
              e.preventDefault();
              onToggleSelect(s.id);
              return;
            }
            onSelect(s.id);
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
            <PixelAvatar seed={s.id} size={36} />
            <div className={styles.cardInfo}>
              <div className={styles.cardNameRow}>
                <span className={styles.cardName}>{s.name}</span>
                {role && (
                  <span
                    className={styles.roleBadge}
                    style={{
                      background: role.color,
                      color: "rgba(0,0,0,0.78)",
                    }}
                    title={`Orchestra role: ${role.label}`}
                  >
                    {role.icon} {role.label}
                  </span>
                )}
                {s.branch && (
                  <span className={styles.cardBranch} title={`Branch: ${s.branch}`}>
                    <Zap size={10} strokeWidth={1.75} aria-hidden="true" />
                    {s.branch}
                  </span>
                )}
                <span className={styles.cardIcons}>
                  <Pencil size={10} />
                </span>
              </div>
              <div className={styles.cardStatusRow}>
                <StatusIcon status={s.status} size={10} />
                <span className={styles.cardStatusLabel} style={{ color: STATUS_COLORS[s.status] }}>
                  {STATUS_LABELS[s.status]}
                </span>
                {pct > 0 && pct < 100 && <span className={styles.cardPct}>{pct}%</span>}
                {s.filesChanged !== undefined && s.filesChanged > 0 && (
                  <span
                    className={styles.cardFiles}
                    title={`${s.filesChanged} file${s.filesChanged === 1 ? "" : "s"} changed`}
                  >
                    <Paperclip size={10} strokeWidth={1.75} aria-hidden="true" />
                    {s.filesChanged}
                  </span>
                )}
                {secondaryInfo.length > 0 && (
                  <span
                    className={styles.moreInfo}
                    title={secondaryTitle}
                    aria-label={`More details: ${secondaryTitle.replace(/\n/g, ", ")}`}
                  >
                    <MoreHorizontal size={10} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                )}
                {warning && (
                  <span
                    className={styles.budgetWarn}
                    data-kind={warning}
                    title={
                      warning === "cost"
                        ? `Cost $${s.cost.toFixed(2)} exceeds per-session cap`
                        : `Context ${pct}% exceeds warning threshold`
                    }
                  >
                    <AlertTriangle size={10} />
                    {warning === "cost" ? "$" : `${pct}%`}
                  </span>
                )}
                {conflictCount > 0 && (
                  <span
                    className={styles.conflictBadge}
                    title={`File conflict with another session:\n${(conflictingPaths ?? []).slice(0, 5).join("\n")}${conflictCount > 5 ? `\n+${conflictCount - 5} more` : ""}`}
                  >
                    <FileWarning size={10} />
                    {conflictCount}
                  </span>
                )}
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
              <StopButton
                className={styles.stopBtn}
                label={`Stop session ${s.name}`}
                onStop={() => onStop?.(s.id)}
              />
            )}
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
          </div>
          {s.worktree ? (
            <div className={styles.worktreeInfo}>
              <GitBranch size={10} />
              <span className={styles.worktreeBranch}>{s.worktree.branch}</span>
              <span className={styles.worktreeStatus} data-status={s.worktree.status}>
                {s.worktree.status === "Clean" ? "✓" : s.worktree.status === "Modified" ? "●" : "⚠"}
              </span>
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
              <button className={styles.worktreeBtn} onClick={() => onWorktreeSubmit(s.id)}>
                Create
              </button>
            </div>
          ) : null}
          {s.watchdog && <div className={styles.watchdogInfo}>🐕 {s.watchdog}</div>}
        </button>
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={styles.ctxMenu}>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onSelect(s.id)}>
            Switch to Session
          </RadixContextMenu.Item>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onRename(s)}>
            Rename
          </RadixContextMenu.Item>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onViewAnalytics(s.id)}>
            <BarChart3 size={10} style={{ marginRight: 4 }} />
            View Analytics
          </RadixContextMenu.Item>
          {(s.filesChanged ?? 0) > 0 && (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onViewDiffs?.(s.id)}>
              <GitBranch size={10} style={{ marginRight: 4 }} />
              View Diffs ({s.filesChanged})
            </RadixContextMenu.Item>
          )}
          {onHandoff && (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onHandoff(s)}>
              <Send size={10} style={{ marginRight: 4 }} />
              Hand off to new agent…
            </RadixContextMenu.Item>
          )}
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onCopyInfo(s)}>
            Copy Info
          </RadixContextMenu.Item>
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
          <RadixContextMenu.Item
            className={styles.ctxItem}
            onSelect={() => onStartAgent?.(`Attach watchdog to ${s.name}`)}
          >
            Attach Watchdog
          </RadixContextMenu.Item>
          <RadixContextMenu.Separator className={styles.ctxDivider} />
          <RadixContextMenu.Item
            className={styles.ctxItem}
            disabled={s.status === "idle" || s.status === "done"}
            onSelect={() => onStop?.(s.id)}
          >
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
