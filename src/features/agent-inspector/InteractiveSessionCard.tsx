import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { GitBranch, RefreshCw, TerminalSquare, Zap } from "lucide-react";
import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import { formatRelativeAge } from "../../shared/lib/relativeTime";
import { computeTokenProgress } from "../../shared/lib/tokenProgress";
import {
  type AgentLineageEntry,
  getSessionColor,
  isAgentStatus,
  STATUS_COLORS,
  STATUS_LABELS,
} from "../../shared/types/agent";
import type { AgentRunStatus } from "../../shared/types/agentStatus";
import type { InteractiveSession } from "../../shared/types/interactiveAgent";
import { getCliColor, getCliLabel } from "../../shared/types/interactiveAgent";
import { getMaxTokens } from "../../shared/types/model";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { StopButton } from "../../shared/ui/StopButton";
import styles from "./AgentInspector.module.css";

type InteractiveCardSession = InteractiveSession | AgentFleetSession;

interface InteractiveSessionCardProps {
  session: InteractiveCardSession;
  onFocus?: (id: string) => void;
  onStop?: (id: string) => void;
  onEndAndRemoveWorktree?: (id: string) => void;
}

function isFleetSession(session: InteractiveCardSession): session is AgentFleetSession {
  return "runtime" in session;
}

function compactId(id: string): string {
  if (id.length <= 22) return id;
  return `${id.slice(0, 10)}...${id.slice(-7)}`;
}

function runStatusLabel(status: AgentRunStatus | string): string {
  switch (status) {
    case "waiting_approval":
      return "Waiting approval";
    case "running_tests":
      return "Running tests";
    case "summarizing":
      return "Summarizing";
    case "retiring":
      return "Retiring";
    default:
      return status.replace(/_/g, " ");
  }
}

function recycleStateLabel(state: string): string {
  return state.replace(/_/g, " ");
}

function lineageTitle(lineage: AgentLineageEntry[]): string {
  return lineage.map((entry) => entry.logicalSessionId).join(" -> ");
}

export function InteractiveSessionCard({
  session: is,
  onFocus,
  onStop,
  onEndAndRemoveWorktree,
}: InteractiveSessionCardProps) {
  const fleet = isFleetSession(is) ? is : null;
  const id = is.id;
  const cli = fleet?.cli ?? ("cli" in is ? is.cli : undefined) ?? "agent";
  const status = fleet?.runStatus ?? is.status;
  const legacyStatus = fleet?.status ?? is.status;
  const model = is.model;
  const initialPrompt = fleet?.prompt ?? ("initial_prompt" in is ? is.initial_prompt : undefined);
  const worktreeBranch = fleet?.worktreeBranch ?? ("worktree_branch" in is ? is.worktree_branch : undefined);
  const backend = fleet?.backend ?? ("backend" in is ? is.backend : undefined);
  const tokensUsed = fleet?.tokensUsed ?? ("tokens_used" in is ? is.tokens_used : 0);
  const startedAt = fleet ? fleet.startedAt : "started_at" in is ? is.started_at : 0;
  const lineage = fleet?.lineage ?? [];
  const recycleStatus = fleet?.recycleStatus;
  const predecessorSessionId = fleet?.predecessorSessionId;
  const showLifecycle = lineage.length > 1 || predecessorSessionId != null || recycleStatus != null;
  const sColor = getSessionColor(id);
  const cliColor = getCliColor(cli);
  const maxTokens = getMaxTokens(model);
  const backendLabel = backend === "sidecar" ? "sidecar" : backend === "native" ? "native fallback" : "backend unknown";
  const pct = computeTokenProgress(legacyStatus, tokensUsed, maxTokens);
  const knownStatus = isAgentStatus(legacyStatus) ? legacyStatus : null;
  const statusText = knownStatus ? STATUS_LABELS[knownStatus] : runStatusLabel(status);
  const statusColor = knownStatus ? STATUS_COLORS[knownStatus] : "#cdd6f4";
  const startedAtMs = startedAt > 1_000_000_000_000 ? startedAt : startedAt * 1000;

  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger asChild>
        {/* biome-ignore lint/a11y/useSemanticElements: This context-menu card contains nested action buttons, so a button wrapper would be invalid HTML. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Focus interactive session ${getCliLabel(cli)}`}
          className={`${styles.card} ${styles.cardInteractive}`}
          onClick={() => onFocus?.(id)}
          onKeyDown={(e) => {
            if (e.currentTarget !== e.target) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocus?.(id);
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
            <PixelAvatar seed={id} size={30} />
            <div className={styles.cardInfo}>
              <div className={styles.cardNameRow}>
                <TerminalSquare size={10} style={{ color: cliColor }} />
                <span className={styles.cardName}>{getCliLabel(cli)}</span>
                {worktreeBranch && (
                  <span className={styles.cardBranch} title={`Worktree branch: ${worktreeBranch}`}>
                    <Zap size={10} strokeWidth={1.75} aria-hidden="true" />
                    {worktreeBranch}
                  </span>
                )}
              </div>
              <div className={styles.cardStatusRow}>
                {knownStatus && <StatusIcon status={knownStatus} size={10} />}
                <span className={styles.cardStatusLabel} style={{ color: statusColor }}>
                  {statusText}
                </span>
                {pct > 0 && pct < 100 && <span className={styles.cardPct}>{pct}%</span>}
                <span className={styles.cardPct} title={`PTY backend: ${backendLabel}`}>
                  {backendLabel}
                </span>
                <span className={styles.cardAge}>{formatRelativeAge(startedAtMs)}</span>
              </div>
            </div>
          </div>
          {initialPrompt && (
            <div className={styles.cardPreview}>
              <span className={styles.cardPreviewText}>{initialPrompt}</span>
            </div>
          )}
          {showLifecycle && (
            <section className={styles.lineagePanel} aria-label="Session lineage">
              {lineage.length > 1 ? (
                <div className={styles.lineageChain} title={lineageTitle(lineage)}>
                  <GitBranch size={10} aria-hidden="true" />
                  {lineage.map((entry, index) => (
                    <span key={entry.logicalSessionId} className={styles.lineageNode}>
                      {index > 0 && <span className={styles.lineageArrow}>-&gt;</span>}
                      <span>{compactId(entry.logicalSessionId)}</span>
                    </span>
                  ))}
                </div>
              ) : predecessorSessionId ? (
                <div className={styles.lineageChain} title={`Predecessor: ${predecessorSessionId}`}>
                  <GitBranch size={10} aria-hidden="true" />
                  <span className={styles.lineageNode}>from {compactId(predecessorSessionId)}</span>
                </div>
              ) : null}
              {recycleStatus && (
                <span
                  className={styles.recycleBadge}
                  title={`Recycle ${recycleStatus.state} #${recycleStatus.handoffSeq} · ${recycleStatus.correlationId}`}
                >
                  <RefreshCw size={10} aria-hidden="true" />
                  {recycleStateLabel(recycleStatus.state)}
                </span>
              )}
            </section>
          )}
          {legacyStatus !== "done" && (
            // Show Stop for any LIVE session. An interactive TUI agent is
            // persistent — it sits at "idle" (waiting at its prompt) when it has
            // nothing to do but is still alive — so "idle" must keep the Stop
            // affordance; only a finished ("done") session hides it.
            <div className={styles.cardMeta}>
              <StopButton
                className={styles.stopBtn}
                label={`Stop interactive session ${id}`}
                onStop={() => onStop?.(id)}
              />
            </div>
          )}
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
          </div>
          {worktreeBranch && (
            <div className={styles.worktreeInfo}>
              <GitBranch size={10} />
              <span className={styles.worktreeBranch}>{worktreeBranch}</span>
            </div>
          )}
        </div>
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={styles.ctxMenu}>
          <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onFocus?.(id)}>
            <TerminalSquare size={10} style={{ marginRight: 4 }} />
            Open Terminal
          </RadixContextMenu.Item>
          <RadixContextMenu.Separator className={styles.ctxDivider} />
          {worktreeBranch ? (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onEndAndRemoveWorktree?.(id)}>
              End Session &amp; Remove Worktree
            </RadixContextMenu.Item>
          ) : (
            <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStop?.(id)}>
              End Session
            </RadixContextMenu.Item>
          )}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
