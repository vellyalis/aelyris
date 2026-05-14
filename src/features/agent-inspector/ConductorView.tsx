import {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeTypes,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";

import { Layers } from "lucide-react";
import { layoutConductor, NODE_HEIGHT, NODE_WIDTH } from "../../shared/lib/conductorLayout";
import { getRole } from "../../shared/lib/orchestrator";
import { buildRunGraph } from "../../shared/lib/workstationGraph";
import { type AgentSession, getSessionColor, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import { EmptyState } from "../../shared/ui/EmptyState";
import styles from "./ConductorView.module.css";

interface ConductorViewProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

interface ConductorNodeData {
  session: AgentSession;
  isActive: boolean;
  accent: string;
  roleLabel?: string;
  roleIcon?: string;
  roleColor?: string;
}

function ConductorNode({ data }: { data: ConductorNodeData }) {
  const { session, isActive, accent, roleLabel, roleIcon, roleColor } = data;
  return (
    <div
      className={`${styles.node} ${isActive ? styles.nodeActive : ""}`}
      style={{
        borderColor: accent,
        boxShadow: isActive ? `0 0 0 2px ${accent} inset` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeHeader}>
        <span className={styles.nodeName}>{session.name}</span>
        {roleLabel && roleColor && (
          <span className={styles.nodeRole} style={{ background: roleColor, color: "rgba(0,0,0,0.78)" }}>
            {roleIcon} {roleLabel}
          </span>
        )}
      </div>
      <div className={styles.nodeMeta}>
        <span className={styles.nodeStatus} style={{ color: STATUS_COLORS[session.status] }}>
          {STATUS_LABELS[session.status]}
        </span>
        <span className={styles.nodeCost}>${session.cost.toFixed(2)}</span>
      </div>
      <div className={styles.nodeModel}>{session.model}</div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

const nodeTypes: NodeTypes = { conductor: ConductorNode };

/**
 * Phase 3B-1c — Conductor DAG view.
 *
 * Lays sessions out in columns by Orchestra role and draws edges from
 * parent → child for handoff chains. Clicking a node selects the session.
 */
export function ConductorView({ sessions, activeSessionId, onSelectSession }: ConductorViewProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { flowNodes, flowEdges, roleSummaries, runSummary } = useMemo(() => {
    const layout = layoutConductor(sessions);
    const runSummary = buildRunGraph(sessions, { now, staleAfterMs: 15 * 60 * 1000 });
    const flowNodes: Node[] = layout.nodes.map((n) => {
      const role = getRole(n.session.role);
      const accent = role?.color ?? getSessionColor(n.session.id).accent;
      return {
        id: n.id,
        type: "conductor",
        position: { x: n.x, y: n.y },
        data: {
          session: n.session,
          isActive: n.id === activeSessionId,
          accent,
          roleLabel: role?.label,
          roleIcon: role?.icon,
          roleColor: role?.color,
        } satisfies ConductorNodeData,
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      };
    });
    const flowEdges: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: "var(--gold)" },
      // Arrow on target so the handoff direction is visible; without this
      // the DAG is structurally ambiguous. `--gold` keeps the marker in
      // sync with the edge stroke.
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--gold)",
        width: 14,
        height: 14,
      },
    }));
    const roleSummaries = layout.columns;
    return { flowNodes, flowEdges, roleSummaries, runSummary };
  }, [sessions, activeSessionId, now]);

  if (sessions.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState
          icon={<Layers size={20} />}
          title="No sessions yet"
          description="Launch agents from Orchestra mode to see the graph."
        />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <section className={styles.roleSummary} aria-label="Conductor role summary">
        {roleSummaries.map((c) => (
          <div key={c.id} className={styles.roleChip}>
            <span className={styles.roleChipText}>{c.label}</span>
            <span className={styles.roleChipCount}>{c.count}</span>
          </div>
        ))}
      </section>
      <section className={styles.controlSummary} aria-label="Agent run control summary">
        <SummaryChip label="Live" value={runSummary.liveCount} />
        <SummaryChip label="Done" value={runSummary.doneCount} />
        <SummaryChip label="Blocked" value={runSummary.blockedCount} />
        <SummaryChip label="Stale" value={runSummary.staleCount} />
        <SummaryChip label="Collect" value={runSummary.collectableCount} />
      </section>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectSession(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background color="rgba(255,255,255,0.08)" gap={16} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryChip}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
