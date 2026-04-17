import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EmptyState } from "../../shared/ui/EmptyState";
import { Layers } from "lucide-react";
import {
  layoutConductor,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "../../shared/lib/conductorLayout";
import { getRole } from "../../shared/lib/orchestrator";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  getSessionColor,
  type AgentSession,
} from "../../shared/types/agent";
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
          <span
            className={styles.nodeRole}
            style={{ background: roleColor, color: "rgba(0,0,0,0.78)" }}
          >
            {roleIcon} {roleLabel}
          </span>
        )}
      </div>
      <div className={styles.nodeMeta}>
        <span
          className={styles.nodeStatus}
          style={{ color: STATUS_COLORS[session.status] }}
        >
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
  const { flowNodes, flowEdges, columnLabels } = useMemo(() => {
    const layout = layoutConductor(sessions);
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
    }));
    const columnLabels = layout.columns;
    return { flowNodes, flowEdges, columnLabels };
  }, [sessions, activeSessionId]);

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
      <div className={styles.columnLabels}>
        {columnLabels.map((c) => (
          <div key={c.id} className={styles.columnLabel} style={{ left: c.x }}>
            {c.label}
            <span className={styles.columnCount}>{c.count}</span>
          </div>
        ))}
      </div>
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
