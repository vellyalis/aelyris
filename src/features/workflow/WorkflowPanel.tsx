import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, CheckCircle, XCircle, Clock, ChevronRight, Loader, Workflow } from "lucide-react";
import styles from "./WorkflowPanel.module.css";

const WorkflowBuilder = lazy(() => import("./WorkflowBuilder").then((m) => ({ default: m.WorkflowBuilder })));

interface WorkflowSummary {
  name: string;
  description: string;
  path: string;
  phase_count: number;
}

interface PhaseResult {
  name: string;
  status: "pending" | "running" | "waiting_gate" | "passed" | "failed" | "skipped";
  agent_session_id: string | null;
  cost: number;
}

interface WorkflowStatus {
  id: string;
  workflow_name: string;
  task_title: string;
  current_phase: number;
  phases: PhaseResult[];
}

interface WorkflowPhaseInfo {
  name: string;
  model: string;
  prompt: string;
  max_cost: number;
  has_gate: boolean;
  gate_type: string | null;
}

interface WorkflowPanelProps {
  projectPath: string;
  onStartAgent?: (prompt: string, model?: string) => Promise<string | undefined>;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock size={12} className={styles.iconMuted} />,
  running: <Loader size={12} className={styles.iconRunning} />,
  waiting_gate: <Clock size={12} className={styles.iconWaiting} />,
  passed: <CheckCircle size={12} className={styles.iconPassed} />,
  failed: <XCircle size={12} className={styles.iconFailed} />,
  skipped: <Clock size={12} className={styles.iconMuted} />,
};

export function WorkflowPanel({ projectPath, onStartAgent }: WorkflowPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [running, setRunning] = useState<WorkflowStatus[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const handleExportYaml = useCallback(async (yaml: string) => {
    try {
      const filePath = `${projectPath}/.aether/workflows/custom-${Date.now()}.yaml`;
      await invoke("write_file", { path: filePath, content: yaml });
    } catch { /* ignore write errors */ }
    setBuilderOpen(false);
    invoke<WorkflowSummary[]>("list_workflows", { projectPath }).then(setWorkflows).catch(() => {});
  }, [projectPath]);

  // Load available workflows
  useEffect(() => {
    invoke<WorkflowSummary[]>("list_workflows", { projectPath }).then(setWorkflows).catch(() => {});
  }, [projectPath]);

  // Poll running workflows
  useEffect(() => {
    const poll = () => { invoke<WorkflowStatus[]>("list_running_workflows").then(setRunning).catch(() => {}); };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  const advancePhase = useCallback(async (workflowId: string) => {
    if (!onStartAgent) return;
    try {
      const phase = await invoke<WorkflowPhaseInfo>("workflow_current_phase", { workflowId });
      const sessionId = await onStartAgent(phase.prompt, phase.model);
      if (sessionId) {
        await invoke("workflow_set_agent", { workflowId, agentSessionId: sessionId });
      }
    } catch { /* no more phases */ }
  }, [onStartAgent]);

  const handleStart = useCallback(async (wf: WorkflowSummary, taskTitle?: string) => {
    const title = taskTitle ?? wf.name;
    try {
      const status = await invoke<WorkflowStatus>("start_workflow", {
        projectPath,
        workflowPath: wf.path,
        taskTitle: title,
      });
      setRunning((prev) => [...prev, status]);
      await advancePhase(status.id);
    } catch (e) {
      console.error("Failed to start workflow:", e);
    }
  }, [projectPath, advancePhase]);

  const handleApprove = useCallback(async (workflowId: string) => {
    try {
      const done = await invoke<boolean>("workflow_approve_gate", { workflowId });
      if (!done) {
        await advancePhase(workflowId);
      }
    } catch (e) {
      console.error("Failed to approve gate:", e);
    }
  }, [advancePhase]);

  const handleReject = useCallback(async (workflowId: string) => {
    try {
      await invoke("workflow_reject_gate", { workflowId });
      await advancePhase(workflowId);
    } catch (e) {
      console.error("Failed to reject gate:", e);
    }
  }, [advancePhase]);

  if (workflows.length === 0 && running.length === 0) return null;

  return (
    <div className={styles.panel}>
      <button className={styles.header} onClick={() => setExpanded(!expanded)}>
        <ChevronRight size={12} className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} />
        <span className={styles.headerTitle}>Workflows</span>
        {running.length > 0 && <span className={styles.badge}>{running.length}</span>}
      </button>

      {expanded && (
        <div className={styles.content}>
          {/* Running workflows */}
          {running.map((wf) => (
            <div key={wf.id} className={styles.runningCard}>
              <div className={styles.runningTitle}>{wf.task_title}</div>
              <div className={styles.stepBar}>
                {wf.phases.map((p, i) => (
                  <div key={p.name} className={`${styles.step} ${styles[`step_${p.status}`]}`} title={`${p.name}: ${p.status}`}>
                    {STATUS_ICON[p.status]}
                    <span className={styles.stepName}>{p.name}</span>
                    {p.cost > 0 && <span className={styles.stepCost}>${p.cost.toFixed(2)}</span>}
                    {p.status === "waiting_gate" && (
                      <span className={styles.gateActions}>
                        <button className={styles.approveBtn} onClick={() => handleApprove(wf.id)} title="Approve">✓</button>
                        <button className={styles.rejectBtn} onClick={() => handleReject(wf.id)} title="Reject">✗</button>
                      </span>
                    )}
                    {i < wf.phases.length - 1 && <span className={styles.arrow}>→</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Available workflows to start */}
          {workflows.map((wf) => (
            <button key={wf.path} className={styles.templateBtn} onClick={() => handleStart(wf)}>
              <Play size={10} />
              <span>{wf.name}</span>
              <span className={styles.templatePhases}>{wf.phase_count} phases</span>
            </button>
          ))}
          <button className={styles.templateBtn} onClick={() => setBuilderOpen(true)}>
            <Workflow size={10} />
            <span>Visual Builder</span>
          </button>
        </div>
      )}

      {builderOpen && (
        <Suspense fallback={null}>
          <WorkflowBuilder onClose={() => setBuilderOpen(false)} onExport={handleExportYaml} />
        </Suspense>
      )}
    </div>
  );
}
