import { Activity, AlertTriangle, Clock3, ScrollText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildToolLedger,
  type ToolLedgerAttention,
  type ToolLedgerItem,
  type ToolLedgerState,
} from "../../shared/lib/toolLedger";
import { listWorkstationGraphAgentIds, type WorkstationGraph } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { ToolBadge } from "../../shared/ui/ToolBadge";
import styles from "./ToolLedgerPanel.module.css";

interface ToolLedgerPanelProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  workstationGraph?: WorkstationGraph;
}

const STATE_LABELS: Record<ToolLedgerState, string> = {
  blocked: "Blocked",
  running: "Running",
  quiet: "Quiet",
  recent: "Recent",
};

const ATTENTION_LABELS: Record<ToolLedgerAttention, string> = {
  manual: "Needs approval",
  denied: "Auto-denied",
  error: "Error",
  waiting: "Waiting",
};

const LEDGER_TICK_MS = 30_000;

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function ToolLedgerPanel({
  sessions,
  activeSessionId,
  onSelectSession,
  workstationGraph,
}: ToolLedgerPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const graphAgentIds = useMemo(() => listWorkstationGraphAgentIds(workstationGraph), [workstationGraph]);
  const graphSessions = useMemo(() => {
    if (graphAgentIds.length === 0) return sessions;
    const ids = new Set(graphAgentIds);
    return sessions.filter((session) => ids.has(session.id));
  }, [graphAgentIds, sessions]);

  useEffect(() => {
    if (graphSessions.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), LEDGER_TICK_MS);
    return () => window.clearInterval(id);
  }, [graphSessions.length]);

  const ledger = useMemo(() => buildToolLedger(graphSessions, now), [graphSessions, now]);
  const toolNodeCount = workstationGraph?.nodeCountByKind.tool ?? ledger.activeToolCount;
  const attentionItems = ledger.items.filter((item) => item.state === "blocked").slice(0, 3);
  const attentionIds = new Set(attentionItems.map((item) => item.sessionId));
  const visibleItems = ledger.items.filter((item) => !attentionIds.has(item.sessionId)).slice(0, 6);

  return (
    <section
      className={styles.panel}
      aria-label="Run and tool ledger"
      data-empty={graphSessions.length === 0}
      data-graph-source={workstationGraph ? "workstation-graph" : "tool-ledger"}
    >
      <PanelHeader
        title="Run Ledger"
        leadingIcon={<ScrollText size={12} />}
        count={ledger.attentionCount > 0 ? ledger.attentionCount : undefined}
      />

      {graphSessions.length === 0 ? (
        <EmptyState
          icon={<Activity size={18} />}
          title="No runs yet"
          description="Agent tool activity will appear here."
        />
      ) : (
        <div className={styles.body}>
          <fieldset className={styles.metrics} aria-label="Run ledger summary">
            <Metric label="Tools" value={toolNodeCount} />
            <Metric label="Manual" value={ledger.attentionBreakdown.manual} />
            <Metric label="Denied" value={ledger.attentionBreakdown.denied} />
            <Metric label="Quiet" value={ledger.quietCount} />
          </fieldset>

          <section className={styles.opsStrip} aria-label="Operational ledger breakdown">
            <span title="Sessions currently errored">
              Err <strong>{ledger.attentionBreakdown.error}</strong>
            </span>
            <span title="Sessions waiting for user or tool input">
              Wait <strong>{ledger.attentionBreakdown.waiting}</strong>
            </span>
            <span title="Longest live session without recent tool activity">
              Silent <strong>{ledger.oldestQuietAgeMs > 0 ? formatAge(ledger.oldestQuietAgeMs) : "0"}</strong>
            </span>
          </section>

          {attentionItems.length > 0 && (
            <section className={styles.attentionQueue} aria-label="Attention queue">
              <div className={styles.attentionHeader}>
                <span>Intervention</span>
                <span>{attentionItems.length}</span>
              </div>
              {attentionItems.map((item) => (
                <LedgerRow
                  key={item.sessionId}
                  item={item}
                  active={item.sessionId === activeSessionId}
                  onSelectSession={onSelectSession}
                  compact
                />
              ))}
            </section>
          )}

          <div className={styles.list}>
            {visibleItems.map((item) => (
              <LedgerRow
                key={item.sessionId}
                item={item}
                active={item.sessionId === activeSessionId}
                onSelectSession={onSelectSession}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LedgerRow({
  item,
  active,
  compact = false,
  onSelectSession,
}: {
  item: ToolLedgerItem;
  active: boolean;
  compact?: boolean;
  onSelectSession: (id: string) => void;
}) {
  const statusLabel = item.attention ? ATTENTION_LABELS[item.attention] : STATE_LABELS[item.state];
  const detail = item.rule ? `${statusLabel} / ${item.rule}` : statusLabel;
  const sideDetail = compact && item.tool ? detail : compact && item.rule ? item.rule : formatAge(item.ageMs);

  return (
    <button
      type="button"
      className={styles.row}
      data-state={item.state}
      data-attention={item.attention}
      data-active={active || undefined}
      data-compact={compact || undefined}
      onClick={() => onSelectSession(item.sessionId)}
      title={`${item.sessionName}: ${item.summary}`}
    >
      <span className={styles.stateIcon} aria-hidden="true">
        {item.state === "blocked" ? <AlertTriangle size={12} /> : <Clock3 size={12} />}
      </span>
      <span className={styles.main}>
        <span className={styles.topLine}>
          <span className={styles.name}>{item.sessionName}</span>
          {item.role && <span className={styles.role}>{item.role}</span>}
        </span>
        <span className={styles.summary}>{item.summary}</span>
      </span>
      <span className={styles.side}>
        {item.tool ? <ToolBadge tool={item.tool} /> : <span className={styles.state}>{detail}</span>}
        <span className={styles.age}>{sideDetail}</span>
      </span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
