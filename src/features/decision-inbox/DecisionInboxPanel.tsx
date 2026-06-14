import { AlertTriangle, CheckCircle2, Clock3, Inbox, ShieldQuestion, UserRoundCheck } from "lucide-react";
import { useMemo } from "react";
import {
  buildDecisionInbox,
  type DecisionInboxSummary,
  type DecisionWorkflowStatus,
  type HumanDecisionItem,
  type HumanDecisionRisk,
  type HumanDecisionType,
} from "../../shared/lib/decisionInbox";
import type { AgentSession } from "../../shared/types/agent";
import type { AuditEventRecord } from "../../shared/types/audit";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./DecisionInboxPanel.module.css";

interface DecisionInboxPanelProps {
  sessions: AgentSession[];
  auditEvents: AuditEventRecord[];
  workflows?: DecisionWorkflowStatus[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onOpenWorkflow?: (id: string) => void;
  onOpenAudit?: (id: number) => void;
}

const TYPE_LABELS: Record<HumanDecisionType, string> = {
  permission_required: "Permission",
  product_direction: "Product",
  destructive_operation: "Destructive",
  external_account_login: "Account",
  merge_conflict_strategy: "Conflict",
  test_expectation_changed: "Tests",
  security_exception: "Security",
};

const RISK_LABELS: Record<HumanDecisionRisk, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function formatAge(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function DecisionInboxPanel({
  sessions,
  auditEvents,
  workflows = [],
  activeSessionId,
  onSelectSession,
  onOpenWorkflow,
  onOpenAudit,
}: DecisionInboxPanelProps) {
  const inbox = useMemo<DecisionInboxSummary>(
    () => buildDecisionInbox({ sessions, auditEvents, workflows }),
    [auditEvents, sessions, workflows],
  );
  const pending = inbox.pendingItems.slice(0, 5);
  const history = inbox.historyItems.slice(0, 4);

  return (
    <section className={styles.panel} aria-label="Human decision inbox" data-empty={inbox.items.length === 0}>
      <PanelHeader
        title="Decisions"
        subtitle="human gates"
        leadingIcon={<Inbox size={12} />}
        count={inbox.pendingCount > 0 ? inbox.pendingCount : undefined}
      />

      {inbox.items.length === 0 ? (
        <EmptyState
          icon={<ShieldQuestion size={18} />}
          title="No human decisions"
          description="Use Run to launch work, Review to inspect diffs, or Health to recover live panes."
        />
      ) : (
        <div className={styles.body}>
          <fieldset className={styles.metrics} aria-label="Decision inbox summary">
            <Metric label="Pending" value={inbox.pendingCount} />
            <Metric label="Risk" value={inbox.highRiskCount} />
            <Metric label="History" value={inbox.historyItems.length} />
            <Metric label="Types" value={Object.values(inbox.byType).filter(Boolean).length} />
          </fieldset>

          {pending.length > 0 && (
            <section className={styles.queue} aria-label="Pending human decisions">
              {pending.map((item) => (
                <DecisionRow
                  key={item.id}
                  item={item}
                  active={item.sessionId === activeSessionId}
                  onSelectSession={onSelectSession}
                  onOpenWorkflow={onOpenWorkflow}
                  onOpenAudit={onOpenAudit}
                />
              ))}
            </section>
          )}

          {history.length > 0 && (
            <section className={styles.history} aria-label="Decision history">
              <div className={styles.historyHeader}>
                <span>History</span>
                <span>{history.length}</span>
              </div>
              {history.map((item) => (
                <DecisionRow
                  key={item.id}
                  item={item}
                  active={item.sessionId === activeSessionId}
                  onSelectSession={onSelectSession}
                  onOpenWorkflow={onOpenWorkflow}
                  onOpenAudit={onOpenAudit}
                  compact
                />
              ))}
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function DecisionRow({
  item,
  active,
  compact = false,
  onSelectSession,
  onOpenWorkflow,
  onOpenAudit,
}: {
  item: HumanDecisionItem;
  active: boolean;
  compact?: boolean;
  onSelectSession: (id: string) => void;
  onOpenWorkflow?: (id: string) => void;
  onOpenAudit?: (id: number) => void;
}) {
  const canFocus = Boolean(item.sessionId);
  const auditEventId = parseAuditEventId(item.id);
  const latestHistory = item.history[0];
  const visibleEvidence = item.evidence.slice(0, compact ? 1 : 3);
  const route =
    item.sessionId && canFocus
      ? { label: "Focus", route: "session" as const, hint: "Focus session" }
      : item.workflowId && onOpenWorkflow
        ? { label: "Open workflow", route: "workflow" as const, hint: "Workflow gate" }
        : auditEventId != null && onOpenAudit
          ? { label: "Open audit", route: "audit" as const, hint: "Audit trail" }
          : null;
  const handoffLabel = route?.hint ?? (item.workflowId ? "Workflow gate" : "Audit trail");
  const icon =
    item.status === "decided" ? (
      <CheckCircle2 size={12} />
    ) : item.risk === "critical" || item.risk === "high" ? (
      <AlertTriangle size={12} />
    ) : (
      <Clock3 size={12} />
    );

  return (
    <article
      className={styles.item}
      data-status={item.status}
      data-risk={item.risk}
      data-active={active || undefined}
      data-compact={compact || undefined}
      data-source={item.source}
    >
      <div className={styles.itemTop}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.titleBlock}>
          <span className={styles.title}>{item.title}</span>
          <span className={styles.context}>{item.context}</span>
        </div>
        <span className={styles.typeBadge}>{TYPE_LABELS[item.type]}</span>
        <span className={styles.riskBadge} data-risk={item.risk}>
          {RISK_LABELS[item.risk]}
        </span>
      </div>

      {!compact && (
        <div className={styles.actionLine}>
          <span>Action</span>
          <strong>{item.recommendedOption}</strong>
        </div>
      )}

      {!compact && (
        <dl className={styles.details}>
          <div>
            <dt>Consequence</dt>
            <dd>{item.consequence}</dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>{item.timeoutPolicy}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{visibleEvidence.length > 0 ? visibleEvidence.join(" / ") : "No evidence attached"}</dd>
          </div>
        </dl>
      )}

      <div className={styles.footer}>
        <span>{formatAge(item.requestedAt)}</span>
        <span>{item.source}</span>
        <span>{handoffLabel}</span>
        {latestHistory && <span>{latestHistory.action}</span>}
        {visibleEvidence.map((entry) => (
          <span key={entry} title={entry}>
            {entry}
          </span>
        ))}
        {route && (
          <button
            type="button"
            className={styles.routeBtn}
            data-route={route.route}
            onClick={() => {
              if (route.route === "session") onSelectSession(item.sessionId ?? "");
              if (route.route === "workflow" && item.workflowId) onOpenWorkflow?.(item.workflowId);
              if (route.route === "audit" && auditEventId != null) onOpenAudit?.(auditEventId);
            }}
            aria-label={`${route.label} ${item.title}`}
            title={`${route.label} ${item.title}`}
          >
            <UserRoundCheck size={11} aria-hidden="true" />
            {route.label}
          </button>
        )}
      </div>
    </article>
  );
}

function parseAuditEventId(id: string): number | null {
  const match = id.match(/^audit:(\d+):/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
