import { AlertTriangle, CheckCircle2, GitBranch, Layers, Route } from "lucide-react";
import { useMemo } from "react";
import { buildRunGraph, type RunGraphNode, type WorkstationGraph } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { ToolBadge } from "../../shared/ui/ToolBadge";
import styles from "./RunGraphPanel.module.css";

interface RunGraphPanelProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  workstationGraph?: WorkstationGraph;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function lineageLabel(node: RunGraphNode): string {
  if (node.parentName) return `from ${node.parentName}`;
  if (node.parentId) return "orphan handoff";
  return "root run";
}

function compactScope(scope: string): string {
  const parts = scope.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return scope || "workspace";
  return `.../${parts.slice(-2).join("/")}`;
}

function reportStatusForAgent(workstationGraph: WorkstationGraph | undefined): Map<string, string> {
  const statusByNodeId = new Map(workstationGraph?.nodes.map((node) => [node.id, node.status ?? "ready"]) ?? []);
  const map = new Map<string, string>();
  for (const edge of workstationGraph?.edges ?? []) {
    if (edge.kind !== "reports_to" || !edge.source.startsWith("agent:") || !edge.target.startsWith("final_report:")) {
      continue;
    }
    map.set(edge.source.slice("agent:".length), statusByNodeId.get(edge.target) ?? "ready");
  }
  return map;
}

export function RunGraphPanel({ sessions, activeSessionId, onSelectSession, workstationGraph }: RunGraphPanelProps) {
  const graphAgentIds = useMemo(() => {
    if (!workstationGraph) return null;
    const ids = workstationGraph.nodes
      .filter((node) => node.kind === "agent" && node.id.startsWith("agent:"))
      .map((node) => node.id.slice("agent:".length));
    return new Set(ids);
  }, [workstationGraph]);
  const graph = useMemo(() => {
    const options = { now: Date.now(), staleAfterMs: 15 * 60 * 1000 };
    if (!graphAgentIds) return buildRunGraph(sessions, options);
    if (graphAgentIds.size === 0) return buildRunGraph([], options);
    const scopedSessions = sessions.filter((session) => graphAgentIds.has(session.id));
    return buildRunGraph(scopedSessions, options);
  }, [graphAgentIds, sessions]);
  const graphReportStatusByAgent = useMemo(() => reportStatusForAgent(workstationGraph), [workstationGraph]);
  const graphAgentCount = workstationGraph?.nodeCountByKind.agent ?? graph.nodes.length;
  const handoffLinkCount = workstationGraph?.edgeCountByKind.spawned ?? graph.edgeCount;
  const finalReportCount = workstationGraph?.nodeCountByKind.final_report ?? graph.finalReportCount;
  const danglingEdges = workstationGraph?.integrity.danglingEdgeCount ?? 0;
  const visibleNodes = graph.nodes.slice(0, 7);
  const isEmpty = graph.nodes.length === 0;

  return (
    <section
      className={styles.panel}
      aria-label="Agent run graph"
      data-empty={isEmpty}
      data-graph-source={workstationGraph ? "workstation-graph" : "run-summary"}
    >
      <PanelHeader
        title="Run Graph"
        leadingIcon={<Route size={12} />}
        count={graphAgentCount > 0 ? graphAgentCount : undefined}
        actions={
          handoffLinkCount > 0 ? (
            <span className={styles.edgeBadge} title="Tracked handoff links">
              <GitBranch size={11} />
              {handoffLinkCount}
            </span>
          ) : null
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={<Layers size={18} />}
          title="No run graph yet"
          description="Agents, roles, and handoffs will appear here."
        />
      ) : (
        <div className={styles.body}>
          <fieldset className={styles.metrics} aria-label="Run graph summary">
            <Metric label="Live" value={String(graph.liveCount)} />
            <Metric label="Done" value={String(graph.doneCount)} />
            <Metric label="Stale" value={String(graph.staleCount)} />
            <Metric label="Links" value={String(handoffLinkCount)} />
            <Metric label="Roles" value={`${graph.roleCoveragePct}%`} />
            <Metric label="Reports" value={String(finalReportCount)} />
            <Metric label="Collect" value={String(graph.collectableCount)} />
            <Metric label="Integrity" value={danglingEdges === 0 ? "OK" : String(danglingEdges)} />
          </fieldset>

          {graph.orphanCount > 0 && (
            <div className={styles.warning} role="status">
              <AlertTriangle size={12} aria-hidden="true" />
              <span>{graph.orphanCount} handoff without parent telemetry</span>
            </div>
          )}

          <div className={styles.list}>
            {visibleNodes.map((node) => {
              const reportStatus = graphReportStatusByAgent.get(node.id) ?? node.finalReportStatus;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={styles.row}
                  data-state={node.state}
                  data-context={node.contextBand}
                  data-active={node.id === activeSessionId || undefined}
                  onClick={() => onSelectSession(node.id)}
                  title={`${node.name}: ${node.latestSummary}`}
                >
                  <span
                    className={styles.depth}
                    style={{ width: `${Math.min(node.depth, 4) * 10}px` }}
                    aria-hidden="true"
                  />
                  <span className={styles.stateDot} aria-hidden="true" />
                  <span className={styles.main}>
                    <span className={styles.topLine}>
                      <span className={styles.name}>{node.name}</span>
                      {node.role && <span className={styles.role}>{node.role}</span>}
                      {node.childCount > 0 && <span className={styles.childCount}>{node.childCount}</span>}
                      {node.closeState === "collectable" && (
                        <span className={styles.closeTag}>
                          <CheckCircle2 size={10} aria-hidden="true" />
                          Collect
                        </span>
                      )}
                    </span>
                    <span className={styles.meta}>
                      <span>{lineageLabel(node)}</span>
                      <span>{node.status}</span>
                      <span>{compactNumber(node.tokensUsed)} tok</span>
                    </span>
                    <span className={styles.detailLine}>
                      <span>owner {node.owner}</span>
                      <span title={node.workspaceScope}>scope {compactScope(node.workspaceScope)}</span>
                      <span>{node.writeSet.length} writes</span>
                      <span>report {reportStatus}</span>
                    </span>
                    {node.state === "blocked" && (
                      <span className={styles.policyLine}>
                        {node.blockedReason ?? "blocked"} · next {node.nextActor ?? "owner"}
                      </span>
                    )}
                    <span className={styles.summary}>{node.latestSummary}</span>
                  </span>
                  <span className={styles.side}>
                    <span className={styles.contextValue}>{Math.round(node.contextPct)}%</span>
                    <span className={styles.contextTrack} aria-hidden="true">
                      <span className={styles.contextFill} style={{ width: `${Math.round(node.contextPct)}%` }} />
                    </span>
                    <span className={styles.sideMeta}>
                      {node.latestTool ? <ToolBadge tool={node.latestTool} /> : `${node.filesChanged} files`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {graph.nodes.length > visibleNodes.length && (
            <div className={styles.more}>+{graph.nodes.length - visibleNodes.length} more runs in Sessions</div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
