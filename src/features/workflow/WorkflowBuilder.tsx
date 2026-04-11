import { useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Download, Plus, X } from "lucide-react";
import styles from "./WorkflowBuilder.module.css";

// ── Custom node types ──

interface PhaseData {
  label: string;
  model: string;
  prompt: string;
  maxCost: number;
  gateType: string | null;
}

function PhaseNode({ data }: { data: PhaseData }) {
  return (
    <div className={styles.phaseNode}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.phaseHeader}>{data.label}</div>
      <div className={styles.phaseBody}>
        <span className={styles.phaseModel}>{data.model}</span>
        <span className={styles.phaseCost}>${data.maxCost}</span>
      </div>
      {data.gateType && (
        <div className={styles.phaseGate}>🚦 {data.gateType}</div>
      )}
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  phase: PhaseNode,
};

// ── Presets ──

const PRESETS: { name: string; nodes: Node[]; edges: Edge[] }[] = [
  {
    name: "Feature (plan→implement→review)",
    nodes: [
      { id: "plan", type: "phase", position: { x: 50, y: 100 }, data: { label: "Plan", model: "opus", prompt: "{task_title}の実装計画", maxCost: 0.5, gateType: "human_review" } },
      { id: "implement", type: "phase", position: { x: 300, y: 100 }, data: { label: "Implement", model: "sonnet", prompt: "計画に基づいて実装 (TDD)", maxCost: 2.0, gateType: "test_pass" } },
      { id: "review", type: "phase", position: { x: 550, y: 100 }, data: { label: "Review", model: "opus", prompt: "実装をレビュー", maxCost: 0.5, gateType: "human_review" } },
    ],
    edges: [
      { id: "e1", source: "plan", target: "implement" },
      { id: "e2", source: "implement", target: "review" },
    ],
  },
  {
    name: "Bug Fix (reproduce→fix→verify)",
    nodes: [
      { id: "reproduce", type: "phase", position: { x: 50, y: 100 }, data: { label: "Reproduce", model: "sonnet", prompt: "バグを再現するテスト", maxCost: 0.5, gateType: "test_pass" } },
      { id: "fix", type: "phase", position: { x: 300, y: 100 }, data: { label: "Fix", model: "sonnet", prompt: "テストを通るよう修正", maxCost: 1.5, gateType: "test_pass" } },
      { id: "verify", type: "phase", position: { x: 550, y: 100 }, data: { label: "Verify", model: "sonnet", prompt: "回帰テスト実行", maxCost: 0.5, gateType: null } },
    ],
    edges: [
      { id: "e1", source: "reproduce", target: "fix" },
      { id: "e2", source: "fix", target: "verify" },
    ],
  },
];

// ── Builder component ──

interface WorkflowBuilderProps {
  onClose: () => void;
  onExport: (yaml: string) => void;
}

export function WorkflowBuilder({ onClose, onExport }: WorkflowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(PRESETS[0].nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(PRESETS[0].edges);
  const [workflowName, setWorkflowName] = useState("New Workflow");

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge(conn, eds));
  }, [setEdges]);

  const addPhase = useCallback(() => {
    const id = `phase-${Date.now()}`;
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x));
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "phase",
        position: { x: maxX + 250, y: 100 },
        data: { label: "New Phase", model: "sonnet", prompt: "{task_title}", maxCost: 1.0, gateType: null },
      },
    ]);
  }, [nodes, setNodes]);

  const loadPreset = useCallback((idx: number) => {
    setNodes(PRESETS[idx].nodes);
    setEdges(PRESETS[idx].edges);
    setWorkflowName(PRESETS[idx].name.split(" (")[0]);
  }, [setNodes, setEdges]);

  const exportYaml = useCallback(() => {
    const phaseNodes = nodes.filter((n) => n.type === "phase");
    const phases = phaseNodes.map((n) => {
      const d = n.data as unknown as PhaseData;
      const deps = edges.filter((e) => e.target === n.id).map((e) => e.source);
      const phase: Record<string, unknown> = {
        name: d.label.toLowerCase().replace(/\s+/g, "_"),
        agent: { model: d.model, prompt: d.prompt, max_cost: d.maxCost },
      };
      if (deps.length > 0) {
        const depNames = deps.map((depId) => {
          const depNode = phaseNodes.find((p) => p.id === depId);
          return (depNode?.data as unknown as PhaseData)?.label.toLowerCase().replace(/\s+/g, "_") ?? depId;
        });
        phase.depends_on = depNames;
      }
      if (d.gateType) {
        phase.quality_gate = { type: d.gateType };
      }
      return phase;
    });

    const yamlLines = [`name: ${workflowName}`, `description: Visual Workflow Builder で作成`, "", "phases:"];
    for (const p of phases) {
      yamlLines.push(`  - name: ${p.name}`);
      if (p.depends_on) yamlLines.push(`    depends_on: [${(p.depends_on as string[]).join(", ")}]`);
      const agent = p.agent as Record<string, unknown>;
      yamlLines.push(`    agent:`);
      yamlLines.push(`      model: ${agent.model}`);
      yamlLines.push(`      prompt: "${agent.prompt}"`);
      yamlLines.push(`      max_cost: ${agent.max_cost}`);
      if (p.quality_gate) {
        const gate = p.quality_gate as Record<string, unknown>;
        yamlLines.push(`    quality_gate:`);
        yamlLines.push(`      type: ${gate.type}`);
      }
    }

    onExport(yamlLines.join("\n"));
  }, [nodes, edges, workflowName, onExport]);

  return (
    <div className={styles.overlay}>
      <div className={styles.builder}>
        <div className={styles.toolbar}>
          <input className={styles.nameInput} value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
          <div className={styles.presets}>
            {PRESETS.map((p, i) => (
              <button key={i} className={styles.presetBtn} onClick={() => loadPreset(i)}>{p.name.split(" (")[0]}</button>
            ))}
          </div>
          <button className={styles.addBtn} onClick={addPhase}><Plus size={12} /> Phase</button>
          <button className={styles.exportBtn} onClick={exportYaml}><Download size={12} /> Export YAML</button>
          <button className={styles.closeBtn} onClick={onClose}><X size={14} /></button>
        </div>
        <div className={styles.canvas}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
          >
            <Background gap={20} />
            <Controls />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
