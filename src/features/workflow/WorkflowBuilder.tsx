import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeTypes,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useState } from "react";
import "@xyflow/react/dist/style.css";
import { PlayCircle, Plus, Save, ShieldCheck, Upload, X } from "lucide-react";
import styles from "./WorkflowBuilder.module.css";

// ── Custom node types ──

interface PhaseData {
  label: string;
  model: string;
  prompt: string;
  maxCost: number;
  targetPane?: string;
  agentRole?: string;
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
        <div className={styles.phaseGate}>
          <ShieldCheck size={10} strokeWidth={1.75} aria-hidden="true" />
          {data.gateType}
        </div>
      )}
      {(data.targetPane || data.agentRole) && (
        <div className={styles.phaseRoute}>{data.targetPane || data.agentRole}</div>
      )}
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  phase: PhaseNode,
};

const MODEL_OPTIONS = ["sonnet", "opus", "haiku"] as const;
const ROLE_OPTIONS = ["", "implementer", "tester", "reviewer", "documenter"] as const;
const GATE_OPTIONS = ["", "human_review", "test_pass"] as const;

// ── Presets ──

const PRESETS: { name: string; nodes: Node[]; edges: Edge[] }[] = [
  {
    name: "Feature (plan→implement→review)",
    nodes: [
      {
        id: "plan",
        type: "phase",
        position: { x: 50, y: 100 },
        data: {
          label: "Plan",
          model: "opus",
          prompt: "{task_title}の実装計画",
          maxCost: 0.5,
          agentRole: "implementer",
          gateType: "human_review",
        },
      },
      {
        id: "implement",
        type: "phase",
        position: { x: 300, y: 100 },
        data: {
          label: "Implement",
          model: "sonnet",
          prompt: "計画に基づいて実装 (TDD)",
          maxCost: 2.0,
          agentRole: "implementer",
          gateType: "test_pass",
        },
      },
      {
        id: "review",
        type: "phase",
        position: { x: 550, y: 100 },
        data: {
          label: "Review",
          model: "opus",
          prompt: "実装をレビュー",
          maxCost: 0.5,
          agentRole: "reviewer",
          gateType: "human_review",
        },
      },
    ],
    edges: [
      { id: "e1", source: "plan", target: "implement" },
      { id: "e2", source: "implement", target: "review" },
    ],
  },
  {
    name: "Bug Fix (reproduce→fix→verify)",
    nodes: [
      {
        id: "reproduce",
        type: "phase",
        position: { x: 50, y: 100 },
        data: {
          label: "Reproduce",
          model: "sonnet",
          prompt: "バグを再現するテスト",
          maxCost: 0.5,
          agentRole: "tester",
          gateType: "test_pass",
        },
      },
      {
        id: "fix",
        type: "phase",
        position: { x: 300, y: 100 },
        data: {
          label: "Fix",
          model: "sonnet",
          prompt: "テストを通るよう修正",
          maxCost: 1.5,
          agentRole: "implementer",
          gateType: "test_pass",
        },
      },
      {
        id: "verify",
        type: "phase",
        position: { x: 550, y: 100 },
        data: {
          label: "Verify",
          model: "sonnet",
          prompt: "回帰テスト実行",
          maxCost: 0.5,
          agentRole: "tester",
          gateType: null,
        },
      },
    ],
    edges: [
      { id: "e1", source: "reproduce", target: "fix" },
      { id: "e2", source: "fix", target: "verify" },
    ],
  },
  {
    name: "Refactoring (analyze→refactor→test→review)",
    nodes: [
      {
        id: "analyze",
        type: "phase",
        position: { x: 50, y: 100 },
        data: {
          label: "Analyze",
          model: "opus",
          prompt: "コードの問題点と改善方針を分析",
          maxCost: 0.5,
          agentRole: "reviewer",
          gateType: "human_review",
        },
      },
      {
        id: "refactor",
        type: "phase",
        position: { x: 300, y: 100 },
        data: {
          label: "Refactor",
          model: "sonnet",
          prompt: "分析結果に基づきリファクタリング実施",
          maxCost: 2.0,
          agentRole: "implementer",
          gateType: "test_pass",
        },
      },
      {
        id: "test",
        type: "phase",
        position: { x: 550, y: 100 },
        data: {
          label: "Test",
          model: "sonnet",
          prompt: "リファクタリング後の全テスト実行",
          maxCost: 0.5,
          agentRole: "tester",
          gateType: "test_pass",
        },
      },
      {
        id: "review",
        type: "phase",
        position: { x: 800, y: 100 },
        data: {
          label: "Review",
          model: "opus",
          prompt: "変更差分をレビュー",
          maxCost: 0.5,
          agentRole: "reviewer",
          gateType: "human_review",
        },
      },
    ],
    edges: [
      { id: "e1", source: "analyze", target: "refactor" },
      { id: "e2", source: "refactor", target: "test" },
      { id: "e3", source: "test", target: "review" },
    ],
  },
  {
    name: "Code Review (scan→review→report)",
    nodes: [
      {
        id: "scan",
        type: "phase",
        position: { x: 50, y: 100 },
        data: {
          label: "Scan",
          model: "sonnet",
          prompt: "コードベースをスキャンして問題検出",
          maxCost: 1.0,
          agentRole: "reviewer",
          gateType: null,
        },
      },
      {
        id: "review",
        type: "phase",
        position: { x: 300, y: 100 },
        data: {
          label: "Review",
          model: "opus",
          prompt: "検出された問題を深掘りレビュー",
          maxCost: 1.0,
          agentRole: "reviewer",
          gateType: "human_review",
        },
      },
      {
        id: "report",
        type: "phase",
        position: { x: 550, y: 100 },
        data: {
          label: "Report",
          model: "sonnet",
          prompt: "レビュー結果をMarkdownレポート作成",
          maxCost: 0.5,
          agentRole: "documenter",
          gateType: null,
        },
      },
    ],
    edges: [
      { id: "e1", source: "scan", target: "review" },
      { id: "e2", source: "review", target: "report" },
    ],
  },
];

// ── YAML codec helpers ──

// Quote/escape rules for YAML double-quoted scalars: backslash and the
// ASCII double-quote must be escaped, and embedded newlines become "\\n".
// Without this, a prompt like {"OK" と言ったら…} produces invalid YAML
// (`prompt: ""OK" と言ったら…"`) and the workflow fails to start with a
// generic parse error the user can't trace back to their input.
function escapeYamlString(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// Single-pass inverse of `escapeYamlString` so backslash-quote /
// backslash-newline / backslash-backslash all round-trip cleanly — without
// this, an exported prompt containing a `"` re-imports as the literal
// sequence `\"` and the next export double-escapes it.
function unescapeYamlString(raw: string): string {
  return raw.replace(/\\(.)/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === '"') return '"';
    if (ch === "\\") return "\\";
    return ch;
  });
}

// ── Builder component ──

interface WorkflowBuilderProps {
  onClose: () => void;
  onExport: (yaml: string, opts?: { runAfterSave?: boolean }) => void;
}

export function WorkflowBuilder({ onClose, onExport }: WorkflowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(PRESETS[0].nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(PRESETS[0].edges);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(String(PRESETS[0].nodes[0]?.id ?? ""));

  const selectedPhase = nodes.find((n) => n.type === "phase" && n.id === selectedPhaseId) ?? null;
  const selectedPhaseData = selectedPhase?.data as unknown as PhaseData | undefined;

  const updateSelectedPhase = useCallback(
    (patch: Partial<PhaseData>) => {
      if (!selectedPhaseId) return;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== selectedPhaseId || node.type !== "phase") return node;
          const data = node.data as unknown as PhaseData;
          return { ...node, data: { ...data, ...patch } };
        }),
      );
    },
    [selectedPhaseId, setNodes],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => addEdge(conn, eds));
    },
    [setEdges],
  );

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
    setSelectedPhaseId(id);
  }, [nodes, setNodes]);

  const loadPreset = useCallback(
    (idx: number) => {
      setNodes(PRESETS[idx].nodes);
      setEdges(PRESETS[idx].edges);
      setWorkflowName(PRESETS[idx].name.split(" (")[0]);
      setSelectedPhaseId(String(PRESETS[idx].nodes[0]?.id ?? ""));
    },
    [setNodes, setEdges],
  );

  const buildYaml = useCallback((): string => {
    const phaseNodes = nodes.filter((n) => n.type === "phase");
    const phases = phaseNodes.map((n) => {
      const d = n.data as unknown as PhaseData;
      const deps = edges.filter((e) => e.target === n.id).map((e) => e.source);
      const phase: Record<string, unknown> = {
        name: d.label.toLowerCase().replace(/\s+/g, "_"),
        agent: { model: d.model, prompt: d.prompt, max_cost: d.maxCost },
      };
      if (d.targetPane?.trim()) {
        phase.target_pane = d.targetPane.trim();
      }
      if (d.agentRole?.trim()) {
        phase.agent_role = d.agentRole.trim();
      }
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
      if (p.target_pane) yamlLines.push(`    target_pane: "${escapeYamlString(String(p.target_pane))}"`);
      if (p.agent_role) yamlLines.push(`    agent_role: ${p.agent_role}`);
      const agent = p.agent as Record<string, unknown>;
      yamlLines.push(`    agent:`);
      yamlLines.push(`      model: ${agent.model}`);
      yamlLines.push(`      prompt: "${escapeYamlString(String(agent.prompt))}"`);
      yamlLines.push(`      max_cost: ${agent.max_cost}`);
      if (p.quality_gate) {
        const gate = p.quality_gate as Record<string, unknown>;
        yamlLines.push(`    quality_gate:`);
        yamlLines.push(`      type: ${gate.type}`);
      }
    }

    return yamlLines.join("\n");
  }, [nodes, edges, workflowName]);

  const exportYaml = useCallback(() => {
    onExport(buildYaml());
  }, [buildYaml, onExport]);

  const saveAndRun = useCallback(() => {
    onExport(buildYaml(), { runAfterSave: true });
  }, [buildYaml, onExport]);

  const importYaml = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        try {
          // Simple YAML parser for workflow files
          const lines = reader.result.split("\n");
          let name = "Imported Workflow";
          const importedNodes: Node[] = [];
          const importedEdges: Edge[] = [];
          let currentPhase: Record<string, unknown> | null = null;
          let prevId: string | null = null;

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("name:")) {
              name = trimmed.slice(5).trim();
            } else if (trimmed.startsWith("- name:")) {
              if (currentPhase) {
                const id = String(currentPhase.name);
                importedNodes.push({
                  id,
                  type: "phase",
                  position: { x: importedNodes.length * 250 + 50, y: 100 },
                  data: {
                    label: id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                    model: String(currentPhase.model ?? "sonnet"),
                    prompt: String(currentPhase.prompt ?? ""),
                    maxCost: Number(currentPhase.max_cost ?? 1.0),
                    targetPane: currentPhase.target_pane ? String(currentPhase.target_pane) : undefined,
                    agentRole: currentPhase.agent_role ? String(currentPhase.agent_role) : undefined,
                    gateType: currentPhase.gate_type ? String(currentPhase.gate_type) : null,
                  },
                });
                if (prevId) {
                  importedEdges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
                }
                prevId = id;
              }
              currentPhase = { name: trimmed.slice(7).trim() };
            } else if (currentPhase) {
              if (trimmed.startsWith("model:")) currentPhase.model = trimmed.slice(6).trim();
              else if (trimmed.startsWith("prompt:"))
                currentPhase.prompt = unescapeYamlString(trimmed.slice(7).trim().replace(/^"|"$/g, ""));
              else if (trimmed.startsWith("max_cost:")) currentPhase.max_cost = parseFloat(trimmed.slice(9).trim());
              else if (trimmed.startsWith("target_pane:"))
                currentPhase.target_pane = unescapeYamlString(trimmed.slice(12).trim().replace(/^"|"$/g, ""));
              else if (trimmed.startsWith("targetPane:"))
                currentPhase.target_pane = unescapeYamlString(trimmed.slice(11).trim().replace(/^"|"$/g, ""));
              else if (trimmed.startsWith("agent_role:")) currentPhase.agent_role = trimmed.slice(11).trim();
              else if (trimmed.startsWith("agentRole:")) currentPhase.agent_role = trimmed.slice(10).trim();
              else if (trimmed.startsWith("type:")) currentPhase.gate_type = trimmed.slice(5).trim();
            }
          }
          // Last phase
          if (currentPhase) {
            const id = String(currentPhase.name);
            importedNodes.push({
              id,
              type: "phase",
              position: { x: importedNodes.length * 250 + 50, y: 100 },
              data: {
                label: id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                model: String(currentPhase.model ?? "sonnet"),
                prompt: String(currentPhase.prompt ?? ""),
                maxCost: Number(currentPhase.max_cost ?? 1.0),
                targetPane: currentPhase.target_pane ? String(currentPhase.target_pane) : undefined,
                agentRole: currentPhase.agent_role ? String(currentPhase.agent_role) : undefined,
                gateType: currentPhase.gate_type ? String(currentPhase.gate_type) : null,
              },
            });
            if (prevId) {
              importedEdges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id });
            }
          }

          if (importedNodes.length > 0) {
            setNodes(importedNodes);
            setEdges(importedEdges);
            setWorkflowName(name);
            setSelectedPhaseId(String(importedNodes[0]?.id ?? ""));
          }
        } catch {
          /* invalid YAML */
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [setNodes, setEdges]);

  return (
    <div className={styles.overlay}>
      <div className={styles.builder}>
        <div className={styles.toolbar}>
          <input className={styles.nameInput} value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} />
          <div className={styles.presets}>
            {PRESETS.map((p, i) => (
              <button type="button" key={p.name} className={styles.presetBtn} onClick={() => loadPreset(i)}>
                {p.name.split(" (")[0]}
              </button>
            ))}
          </div>
          <button type="button" className={styles.addBtn} onClick={addPhase}>
            <Plus size={12} /> Phase
          </button>
          <button type="button" className={styles.exportBtn} onClick={importYaml}>
            <Upload size={12} /> Import
          </button>
          <button type="button" className={styles.exportBtn} onClick={exportYaml}>
            <Save size={12} /> Save
          </button>
          <button type="button" className={styles.runBtn} onClick={saveAndRun} title="Save then start a run">
            <PlayCircle size={12} /> Save &amp; Run
          </button>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className={styles.workspace}>
          <div className={styles.canvas}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedPhaseId(node.id)}
              nodeTypes={nodeTypes}
              fitView
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{
                animated: true,
                style: { stroke: "var(--gold)" },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: "var(--gold)",
                  width: 14,
                  height: 14,
                },
              }}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <aside className={styles.inspector} aria-label="Phase inspector">
            <div className={styles.inspectorHeader}>
              <span className={styles.inspectorTitle}>Phase</span>
              {selectedPhase && <span className={styles.inspectorId}>{selectedPhase.id}</span>}
            </div>
            {selectedPhaseData ? (
              <div className={styles.inspectorFields}>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    value={selectedPhaseData.label}
                    onChange={(event) => updateSelectedPhase({ label: event.target.value })}
                  />
                </label>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Model</span>
                    <select
                      value={selectedPhaseData.model}
                      onChange={(event) => updateSelectedPhase({ model: event.target.value })}
                    >
                      {MODEL_OPTIONS.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Budget</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={selectedPhaseData.maxCost}
                      onChange={(event) => updateSelectedPhase({ maxCost: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Target pane</span>
                  <input
                    placeholder="PowerShell / claude / reviewer"
                    value={selectedPhaseData.targetPane ?? ""}
                    onChange={(event) => updateSelectedPhase({ targetPane: event.target.value })}
                  />
                </label>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Agent role</span>
                    <select
                      value={selectedPhaseData.agentRole ?? ""}
                      onChange={(event) => updateSelectedPhase({ agentRole: event.target.value || undefined })}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role || "none"} value={role}>
                          {role || "none"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Gate</span>
                    <select
                      value={selectedPhaseData.gateType ?? ""}
                      onChange={(event) => updateSelectedPhase({ gateType: event.target.value || null })}
                    >
                      {GATE_OPTIONS.map((gate) => (
                        <option key={gate || "none"} value={gate}>
                          {gate || "none"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Prompt</span>
                  <textarea
                    value={selectedPhaseData.prompt}
                    onChange={(event) => updateSelectedPhase({ prompt: event.target.value })}
                  />
                </label>
              </div>
            ) : (
              <div className={styles.emptyInspector}>Select a phase</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
