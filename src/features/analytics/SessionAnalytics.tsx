import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { AgentSession } from "../../shared/types/agent";
import { STATUS_COLORS } from "../../shared/types/agent";
import styles from "./SessionAnalytics.module.css";

interface SessionAnalyticsProps {
  session: AgentSession;
  onClose: () => void;
}

interface ToolStat {
  name: string;
  count: number;
}

export function SessionAnalytics({ session, onClose }: SessionAnalyticsProps) {
  const duration = Math.round((Date.now() - session.startedAt) / 1000);
  const durationStr = duration < 60 ? `${duration}s` : duration < 3600 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;

  const toolStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of session.logs) {
      if (log.type === "tool_use") {
        const tool = log.content.split("(")[0].trim() || "unknown";
        counts[tool] = (counts[tool] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([name, count]): ToolStat => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [session.logs]);

  const totalToolCalls = toolStats.reduce((sum, t) => sum + t.count, 0);
  const errorCount = session.logs.filter((l) => l.type === "error").length;
  const contextPct = session.tokensUsed > 0 ? Math.min(100, Math.round((session.tokensUsed / 200000) * 100)) : 0;

  const costBreakdown = useMemo(() => {
    // Estimate input/output split (rough: 70% input, 30% output for typical sessions)
    const inputCost = session.cost * 0.7;
    const outputCost = session.cost * 0.3;
    return { input: inputCost, output: outputCost, total: session.cost };
  }, [session.cost]);

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.modal} aria-describedby={undefined}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>Session Analytics</Dialog.Title>
            <Dialog.Close asChild>
              <button className={styles.closeBtn} aria-label="Close analytics">
                <X size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

        <div className={styles.sessionName}>{session.name}</div>
        <div className={styles.statusRow}>
          <span className={styles.statusDot} style={{ background: STATUS_COLORS[session.status] }} />
          <span>{session.status}</span>
          <span className={styles.model}>{session.model}</span>
        </div>

        {/* Key metrics */}
        <div className={styles.metricsGrid}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>${costBreakdown.total.toFixed(2)}</span>
            <span className={styles.metricLabel}>Total Cost</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{session.tokensUsed.toLocaleString()}</span>
            <span className={styles.metricLabel}>Tokens Used</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{durationStr}</span>
            <span className={styles.metricLabel}>Duration</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{contextPct}%</span>
            <span className={styles.metricLabel}>Context Used</span>
          </div>
        </div>

        {/* Cost breakdown bar */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Cost Breakdown</div>
          <div className={styles.costBar}>
            <div className={styles.costInput} style={{ width: `${costBreakdown.total > 0 ? 70 : 0}%` }} title={`Input: $${costBreakdown.input.toFixed(3)}`} />
            <div className={styles.costOutput} style={{ width: `${costBreakdown.total > 0 ? 30 : 0}%` }} title={`Output: $${costBreakdown.output.toFixed(3)}`} />
          </div>
          <div className={styles.costLegend}>
            <span><span className={styles.legendDot} style={{ background: "var(--ctp-blue)" }} /> Input ${costBreakdown.input.toFixed(3)}</span>
            <span><span className={styles.legendDot} style={{ background: "var(--ctp-green)" }} /> Output ${costBreakdown.output.toFixed(3)}</span>
          </div>
        </div>

        {/* Tool usage */}
        {toolStats.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Tool Usage ({totalToolCalls} calls)</div>
            <div className={styles.toolList}>
              {toolStats.slice(0, 10).map((t) => (
                <div key={t.name} className={styles.toolRow}>
                  <span className={styles.toolName}>{t.name}</span>
                  <div className={styles.toolBar}>
                    <div className={styles.toolFill} style={{ width: `${(t.count / totalToolCalls) * 100}%` }} />
                  </div>
                  <span className={styles.toolCount}>{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary stats */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Activity</div>
          <div className={styles.statsList}>
            <div className={styles.statRow}><span>Total logs</span><span>{session.logs.length}</span></div>
            <div className={styles.statRow}><span>Tool calls</span><span>{totalToolCalls}</span></div>
            <div className={styles.statRow}><span>Errors</span><span className={errorCount > 0 ? styles.errorCount : ""}>{errorCount}</span></div>
            {session.filesChanged !== undefined && <div className={styles.statRow}><span>Files changed</span><span>{session.filesChanged}</span></div>}
            {session.worktree && <div className={styles.statRow}><span>Worktree</span><span>{session.worktree.branch}</span></div>}
            {session.detectedPort && <div className={styles.statRow}><span>Port</span><span>:{session.detectedPort}</span></div>}
          </div>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
