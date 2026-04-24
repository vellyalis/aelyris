import { invoke } from "@tauri-apps/api/core";
import { Check, CheckCircle, ChevronRight, Clock, Loader, Play, Workflow, X, XCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../../shared/store/toastStore";
import { showPrompt } from "../../shared/ui/PromptDialog";
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
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  const handleExportYaml = useCallback(
    async (yaml: string, opts?: { runAfterSave?: boolean }) => {
      const filePath = `${projectPath}/.aether/workflows/custom-${Date.now()}.yaml`;
      let saved = false;
      try {
        await invoke("write_file", { path: filePath, content: yaml });
        toast.success("Workflow saved", filePath.split("/").pop());
        saved = true;
      } catch (err) {
        toast.error("Save failed", String(err));
      }
      setBuilderOpen(false);
      const refreshed = invoke<WorkflowSummary[]>("list_workflows", { projectPath })
        .then((list) => {
          setWorkflows(list);
          return list;
        })
        .catch(() => [] as WorkflowSummary[]);

      if (saved && opts?.runAfterSave) {
        const list = await refreshed;
        const wf = list.find((w) => w.path === filePath) ?? list[list.length - 1];
        if (wf) {
          await handleStartRef.current?.(wf);
        } else {
          toast.error("Run failed", "Saved workflow did not reappear in the list");
        }
      }
    },
    [projectPath],
  );

  // handleStart is declared below (it depends on advancePhase which hasn't been
  // declared yet), so we hand the latest closure to handleExportYaml through a
  // ref to break the cycle without plumbing extra deps.
  const handleStartRef = useRef<((wf: WorkflowSummary) => Promise<void>) | null>(null);

  // Load available workflows
  useEffect(() => {
    invoke<WorkflowSummary[]>("list_workflows", { projectPath })
      .then(setWorkflows)
      .catch(() => {});
  }, [projectPath]);

  // Event-driven workflow status updates (with fallback polling)
  useEffect(() => {
    let active = true;
    const TERMINAL_STATUSES = new Set(["passed", "failed", "skipped"]);
    const isFinished = (wf: WorkflowStatus) => wf.phases.every((p) => TERMINAL_STATUSES.has(p.status));

    const processUpdate = (statuses: WorkflowStatus[]) => {
      if (!active) return;
      const stillRunning = statuses.filter((wf) => !isFinished(wf));
      setRunning(stillRunning);
      for (const wf of statuses) {
        if (isFinished(wf)) {
          invoke("workflow_remove", { workflowId: wf.id }).catch(() => {});
        }
      }
    };

    // Listen for real-time updates from Rust
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<WorkflowStatus[]>("workflow-updated", (e) => {
        processUpdate(e.payload);
      }).then((u) => {
        unlisten = u;
      });
    });

    // Initial fetch + slow fallback poll (30s instead of 3s)
    const poll = () => {
      invoke<WorkflowStatus[]>("list_running_workflows")
        .then(processUpdate)
        .catch(() => {
          if (active) setRunning([]);
        });
    };
    poll();
    const interval = setInterval(poll, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
      unlisten?.();
    };
  }, []);

  const advancingRef = useRef(new Set<string>());

  const advancePhase = useCallback(
    async (workflowId: string) => {
      if (!onStartAgent) return;
      // Prevent double execution if approve is clicked rapidly
      if (advancingRef.current.has(workflowId)) return;
      advancingRef.current.add(workflowId);
      try {
        const phase = await invoke<WorkflowPhaseInfo>("workflow_current_phase", { workflowId });
        const sessionId = await onStartAgent(phase.prompt, phase.model);
        if (sessionId) {
          await invoke("workflow_set_agent", { workflowId, agentSessionId: sessionId });
        }
      } catch {
        /* no more phases */
      } finally {
        advancingRef.current.delete(workflowId);
      }
    },
    [onStartAgent],
  );

  const handleStart = useCallback(
    async (wf: WorkflowSummary, taskTitle?: string) => {
      const title = taskTitle ?? wf.name;
      try {
        const status = await invoke<WorkflowStatus>("start_workflow", {
          projectPath,
          workflowPath: wf.path,
          taskTitle: title,
        });
        setRunning((prev) => [...prev, status]);
        toast.info("Workflow started", title);
        await advancePhase(status.id);
      } catch (e) {
        toast.error("Workflow failed to start", String(e));
      }
    },
    [projectPath, advancePhase],
  );
  handleStartRef.current = handleStart;

  const handleApprove = useCallback(
    async (workflowId: string) => {
      const comment = await showPrompt("Approve phase", {
        placeholder: "Optional comment (Enter to approve)...",
        defaultValue: "",
      });
      if (comment === null) return; // cancelled
      try {
        const done = await invoke<boolean>("workflow_approve_gate", { workflowId });
        if (done) {
          toast.success("Workflow completed", "All phases passed");
        } else {
          toast.info("Phase approved", comment || "Advancing to next phase...");
          await advancePhase(workflowId);
        }
      } catch (e) {
        toast.error("Gate approval failed", String(e));
      }
    },
    [advancePhase],
  );

  const handleReject = useCallback(async (workflowId: string) => {
    // Confirm before rejecting — this stops the entire workflow
    const confirmed = await showPrompt("Reject this phase?", {
      placeholder: "Type 'reject' to confirm",
      defaultValue: "",
    });
    if (confirmed !== "reject") return;

    try {
      await invoke("workflow_reject_gate", { workflowId });
      setRunning((prev) => prev.filter((wf) => wf.id !== workflowId));
      toast.warning("Workflow rejected", "Workflow has been stopped");
      invoke("workflow_remove", { workflowId }).catch(() => {});
    } catch (e) {
      toast.error("Gate rejection failed", String(e));
    }
  }, []);

  if (workflows.length === 0 && running.length === 0) return null;

  return (
    <div className={styles.panel} role="region" aria-label="Workflow panel">
      <button
        className={styles.header}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Toggle workflows"
      >
        <ChevronRight size={12} className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} />
        <span className={styles.headerTitle}>Workflows</span>
        {running.length > 0 && <span className={styles.badge}>{running.length}</span>}
      </button>

      {expanded && (
        <div className={styles.content}>
          {/* Running workflows */}
          {running.map((wf) => {
            const totalCost = wf.phases.reduce((sum, p) => sum + p.cost, 0);
            return (
              <div key={wf.id} className={styles.runningCard}>
                <div className={styles.runningTitle}>
                  {wf.task_title}
                  {totalCost > 0 && <span className={styles.totalCost}>${totalCost.toFixed(2)}</span>}
                </div>
                <div className={styles.stepBar}>
                  {wf.phases.map((p, i) => {
                    const phaseKey = `${wf.id}:${p.name}`;
                    const isExpanded = expandedPhase === phaseKey;
                    return (
                      <div key={p.name} className={styles.stepWrapper}>
                        <div
                          className={`${styles.step} ${styles[`step_${p.status}`]}`}
                          title={`${p.name}: ${p.status} (click to expand)`}
                          onClick={() => setExpandedPhase(isExpanded ? null : phaseKey)}
                          style={{ cursor: "pointer" }}
                        >
                          {STATUS_ICON[p.status]}
                          <span className={styles.stepName}>{p.name}</span>
                          {p.cost > 0 && <span className={styles.stepCost}>${p.cost.toFixed(2)}</span>}
                          {p.status === "waiting_gate" && (
                            <span className={styles.gateActions}>
                              <button
                                className={styles.approveBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApprove(wf.id);
                                }}
                                title="Approve"
                                aria-label="Approve gate"
                              >
                                <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                              </button>
                              <button
                                className={styles.rejectBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReject(wf.id);
                                }}
                                title="Reject"
                                aria-label="Reject gate"
                              >
                                <X size={12} strokeWidth={2.25} aria-hidden="true" />
                              </button>
                            </span>
                          )}
                          {i < wf.phases.length - 1 && <span className={styles.arrow}>→</span>}
                        </div>
                        {isExpanded && (
                          <div className={styles.phaseDetail}>
                            <div className={styles.phaseDetailRow}>
                              <span>Status:</span> <span>{p.status}</span>
                            </div>
                            <div className={styles.phaseDetailRow}>
                              <span>Cost:</span> <span>${p.cost.toFixed(4)}</span>
                            </div>
                            {p.agent_session_id && (
                              <div className={styles.phaseDetailRow}>
                                <span>Agent:</span>{" "}
                                <span className={styles.phaseDetailMono}>{p.agent_session_id.slice(0, 12)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

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
