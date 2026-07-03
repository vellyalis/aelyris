import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { Check, CheckCircle, Clock, Loader, Play, Workflow, X, XCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { StartAgentMeta } from "../../shared/hooks/useAgentFleet";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import type { OrchestraRoleId } from "../../shared/lib/orchestrator";
import { acceptedTerminalWrites, type SendKeysBatchResult } from "../../shared/lib/sendKeysResult";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import { normalizeCommandInput } from "../../shared/lib/terminalInput";
import { toast } from "../../shared/store/toastStore";
import type { AgentSession } from "../../shared/types/agent";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { PanelHeader } from "../../shared/ui/PanelHeader";
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
  target_pane: string | null;
  agent_role: string | null;
  cost: number;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  retry_count?: number;
  artifacts?: unknown[];
  commands?: unknown[];
  validation?: unknown[];
  final_report?: string | null;
  decision_request?: {
    kind: string;
    reason: string;
    options?: string[];
    default_option?: string | null;
    requested_at: string;
  } | null;
  gate_decision?: {
    decision: "approved" | "rejected" | "conditional";
    comment?: string;
    conditional?: boolean;
    decided_at: string;
  } | null;
  split_from?: string | null;
  split_reason?: string | null;
  blocked_reason?: string | null;
}

interface WorkflowStatus {
  id: string;
  workflow_name: string;
  task_title: string;
  current_phase: number;
  started_at?: string;
  updated_at?: string;
  resume_point?: {
    phase_index: number;
    phase_name: string;
    reason: string;
    recorded_at: string;
  } | null;
  final_report?: string | null;
  phases: PhaseResult[];
}

interface WorkflowPhaseInfo {
  name: string;
  model: string;
  prompt: string;
  max_cost: number;
  target_pane: string | null;
  agent_role: string | null;
  allowed_tools: string[];
  has_gate: boolean;
  gate_type: string | null;
}

interface WorkflowPhaseDoneResult {
  done: boolean;
  waiting_gate: boolean;
}

interface WorkflowPanelProps {
  projectPath: string;
  sessions?: AgentSession[];
  onStartAgent?: (prompt: string, model?: string, meta?: StartAgentMeta) => Promise<string | undefined>;
  onDestinationOutcome?: (outcome: WorkflowDestinationOutcome) => void;
}

interface WorkflowDestinationOutcome {
  label: string;
  detail: string;
  tone: "success" | "warn" | "error";
  routeWidget?: "workflow";
  routeLabel?: string;
  routeDetail?: string;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock size={12} className={styles.iconMuted} />,
  running: <Loader size={12} className={styles.iconRunning} />,
  waiting_gate: <Clock size={12} className={styles.iconWaiting} />,
  passed: <CheckCircle size={12} className={styles.iconPassed} />,
  failed: <XCircle size={12} className={styles.iconFailed} />,
  skipped: <Clock size={12} className={styles.iconMuted} />,
};

const ORCHESTRA_ROLE_IDS: ReadonlySet<string> = new Set(["implementer", "tester", "reviewer", "documenter"]);

function toOrchestraRoleId(value: string | null | undefined): OrchestraRoleId | undefined {
  const role = value?.trim();
  if (!role || !ORCHESTRA_ROLE_IDS.has(role)) return undefined;
  return role as OrchestraRoleId;
}

function paneSessionId(targetPane: string): string {
  return `pane:${targetPane}`;
}

interface PaneInfo {
  terminal_id: string;
  name: string;
  role: string;
}

function paneTargetRole(target: string): string | null {
  const trimmed = target.trim();
  const role = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed.startsWith("role:") ? trimmed.slice(5) : trimmed;
  return role.trim() || null;
}

function countPaneTargetMatches(panes: PaneInfo[], target: string): number {
  const trimmed = target.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.toLowerCase();
  if (panes.some((pane) => pane.terminal_id.toLowerCase() === normalized)) return 1;
  if (!trimmed.startsWith("@") && !trimmed.startsWith("role:")) {
    const nameMatches = panes.filter((pane) => pane.name.trim().toLowerCase() === normalized).length;
    if (nameMatches > 0) return nameMatches;
  }
  const role = paneTargetRole(trimmed)?.toLowerCase();
  if (!role) return 0;
  return panes.filter((pane) => pane.role.trim().toLowerCase() === role).length;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

async function confirmWorkflowPaneTarget(target: string): Promise<boolean> {
  let panes: PaneInfo[];
  try {
    panes = await invoke<PaneInfo[]>("list_panes_info");
  } catch (err) {
    reportInvokeFailure({
      source: "workflow",
      operation: "list_panes_info",
      err,
      severity: "error",
      userVisible: true,
    });
    toast.error("Workflow pane check failed", formatFallbackError(err));
    return false;
  }
  const targetCount = countPaneTargetMatches(panes, target);
  if (targetCount < 1) {
    toast.error("Workflow pane target changed", `No live pane matches "${target}".`);
    return false;
  }
  if (targetCount <= 1) return true;
  const ok = await showConfirm({
    title: "Send workflow phase to multiple panes",
    description: `Target "${target}" currently resolves to ${targetCount} live panes.`,
    confirmLabel: `Send to ${targetCount} panes`,
    cancelLabel: "Review first",
  });
  if (!ok) return false;
  let refreshed: PaneInfo[];
  try {
    refreshed = await invoke<PaneInfo[]>("list_panes_info");
  } catch (err) {
    reportInvokeFailure({
      source: "workflow",
      operation: "list_panes_info",
      err,
      severity: "error",
      userVisible: true,
    });
    toast.error("Workflow pane check failed", formatFallbackError(err));
    return false;
  }
  if (countPaneTargetMatches(refreshed, target) < 1) {
    toast.error("Workflow pane target changed", `No live pane matches "${target}".`);
    return false;
  }
  return true;
}

export function WorkflowPanel({ projectPath, sessions = [], onStartAgent, onDestinationOutcome }: WorkflowPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [running, setRunning] = useState<WorkflowStatus[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleExportYaml = useCallback(
    async (yaml: string, opts?: { runAfterSave?: boolean }) => {
      const filePath = `${projectPath}/.aelyris/workflows/custom-${Date.now()}.yaml`;
      let saved = false;
      try {
        await invoke("write_file", { path: filePath, content: yaml });
        toast.success("Workflow saved", filePath.split("/").pop());
        saved = true;
      } catch (err) {
        toast.error("Save failed", String(err));
      }
      // Only close the builder once disk write succeeded — otherwise the
      // user loses the YAML they just typed and has to reconstruct it.
      if (!saved) return;
      setBuilderOpen(false);
      const refreshed = invoke<WorkflowSummary[]>("list_workflows", { projectPath })
        .then((list) => {
          setWorkflows(list);
          setSyncError(null);
          return list;
        })
        .catch((err) => {
          const message = formatFallbackError(err);
          reportInvokeFailure({
            source: "workflow",
            operation: "list_workflows_after_save",
            err,
            severity: "error",
            userVisible: true,
          });
          setSyncError(`Workflow refresh failed: ${message}`);
          toast.error("Workflow refresh failed", message);
          return null;
        });

      if (opts?.runAfterSave) {
        const list = await refreshed;
        if (!list) return;
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
      .then((list) => {
        setWorkflows(list);
        setSyncError(null);
      })
      .catch((err) => {
        const message = formatFallbackError(err);
        reportInvokeFailure({
          source: "workflow",
          operation: "list_workflows",
          err,
          severity: "warning",
          userVisible: true,
        });
        setSyncError(`Workflow list unavailable: ${message}`);
      });
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
      setSyncError(null);
      for (const wf of statuses) {
        if (isFinished(wf)) {
          invoke("workflow_remove", { workflowId: wf.id }).catch((err) => {
            reportInvokeFailure({
              source: "workflow",
              operation: "workflow_remove",
              err,
              severity: "info",
            });
          });
        }
      }
    };

    // Listen for real-time updates from Rust. Both the dynamic import and
    // the listen() call are async, so cleanup may race ahead of the unlisten
    // assignment — guard with the `active` flag and tear down whatever has
    // resolved by the time we unmount, otherwise the listener leaks.
    let unlisten: (() => void) | null = null;
    if (isTauriRuntime()) {
      Promise.resolve({ listen: tauriListen })
        .then(({ listen }) => {
          if (!active) return Promise.resolve(null);
          return listen<WorkflowStatus[]>("workflow-updated", (e) => {
            processUpdate(e.payload);
          });
        })
        .then((u) => {
          if (!u) return;
          if (!active) {
            u();
            return;
          }
          unlisten = u;
        })
        .catch((err) => {
          if (!active || !isTauriRuntime()) return;
          reportInvokeFailure({
            source: "workflow",
            operation: "listen_workflow_updated",
            err,
            severity: "warning",
          });
        });
    }

    // Initial fetch + slow fallback poll (30s instead of 3s)
    const poll = () => {
      invoke<WorkflowStatus[]>("list_running_workflows", { projectPath })
        .then(processUpdate)
        .catch((err) => {
          if (!active) return;
          const message = formatFallbackError(err);
          reportInvokeFailure({
            source: "workflow",
            operation: "list_running_workflows",
            err,
            severity: "warning",
            userVisible: true,
          });
          setSyncError(`Workflow status unavailable: ${message}`);
        });
    };
    poll();
    const interval = setInterval(poll, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
      unlisten?.();
    };
  }, [projectPath]);

  const advancingRef = useRef(new Set<string>());
  const completedPhaseRef = useRef(new Set<string>());

  const handlePhaseDoneResult = useCallback(
    async (workflow: WorkflowStatus, phaseName: string, result: WorkflowPhaseDoneResult) => {
      if (result.done) {
        toast.success("Workflow completed", workflow.task_title);
        return;
      }
      if (result.waiting_gate) {
        toast.info("Phase ready for review", phaseName);
        return;
      }
      toast.info("Phase passed", `${phaseName} → next phase`);
      await advancePhaseRef.current?.(workflow.id);
    },
    [],
  );

  const advancePhase = useCallback(
    async (workflowId: string) => {
      // Prevent double execution if approve is clicked rapidly
      if (advancingRef.current.has(workflowId)) return;
      advancingRef.current.add(workflowId);
      try {
        const phase = await invoke<WorkflowPhaseInfo>("workflow_current_phase", { workflowId });
        const targetPane = phase.target_pane?.trim();
        if (targetPane) {
          if (!(await confirmWorkflowPaneTarget(targetPane))) return;
          const result = await invoke<SendKeysBatchResult>("send_keys_by_target", {
            target: targetPane,
            data: normalizeCommandInput(phase.prompt),
          });
          const sent = acceptedTerminalWrites(result);
          await invoke("workflow_set_agent", {
            workflowId,
            agentSessionId: paneSessionId(targetPane),
          });
          toast.info("Phase sent to pane", `${phase.name} → ${targetPane}${sent > 1 ? ` (${sent} panes)` : ""}`);
          return;
        }

        if (!onStartAgent) return;
        const sessionId = await onStartAgent(phase.prompt, phase.model, {
          role: toOrchestraRoleId(phase.agent_role),
          allowedTools: phase.allowed_tools.length > 0 ? phase.allowed_tools : undefined,
        });
        if (sessionId) {
          await invoke("workflow_set_agent", { workflowId, agentSessionId: sessionId });
        }
      } catch (err) {
        const message = formatFallbackError(err);
        if (/no more phases|already complete/i.test(message)) return;
        reportInvokeFailure({
          source: "workflow",
          operation: "advance_phase",
          err,
          severity: "error",
          userVisible: true,
        });
        toast.error("Workflow advance failed", message);
      } finally {
        advancingRef.current.delete(workflowId);
      }
    },
    [onStartAgent],
  );
  const advancePhaseRef = useRef(advancePhase);
  advancePhaseRef.current = advancePhase;

  const handleManualPhaseDone = useCallback(
    async (workflow: WorkflowStatus, phaseName: string) => {
      try {
        const result = await invoke<WorkflowPhaseDoneResult>("workflow_phase_done", {
          workflowId: workflow.id,
          cost: 0,
        });
        await handlePhaseDoneResult(workflow, phaseName, result);
      } catch (err) {
        toast.error("Phase completion failed", String(err));
      }
    },
    [handlePhaseDoneResult],
  );

  useEffect(() => {
    if (!onStartAgent || running.length === 0 || sessions.length === 0) return;
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));

    for (const workflow of running) {
      const phase = workflow.phases.find((candidate) => candidate.status === "running" && candidate.agent_session_id);
      if (!phase?.agent_session_id) continue;
      const session = sessionsById.get(phase.agent_session_id);
      if (session?.status !== "done") continue;

      const phaseKey = `${workflow.id}:${phase.name}:${phase.agent_session_id}`;
      if (completedPhaseRef.current.has(phaseKey)) continue;
      completedPhaseRef.current.add(phaseKey);

      invoke<WorkflowPhaseDoneResult>("workflow_phase_done", {
        workflowId: workflow.id,
        cost: session.cost,
      })
        .then((result) => handlePhaseDoneResult(workflow, phase.name, result))
        .catch((err) => {
          completedPhaseRef.current.delete(phaseKey);
          toast.error("Workflow sync failed", String(err));
        });
    }
  }, [handlePhaseDoneResult, onStartAgent, running, sessions]);

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
        const conditional = comment.trim().toLowerCase().startsWith("conditional:");
        const done = await invoke<boolean>("workflow_approve_gate_decision", {
          workflowId,
          comment,
          conditional,
        });
        if (done) {
          toast.success("Workflow completed", "All phases passed");
          onDestinationOutcome?.({
            label: "Workflow gate approved",
            detail: `${workflowId} completed`,
            tone: "success",
            routeWidget: "workflow",
            routeLabel: "Workflow",
            routeDetail: workflowId,
          });
        } else {
          toast.info("Phase approved", comment || "Advancing to next phase...");
          onDestinationOutcome?.({
            label: "Workflow gate approved",
            detail: comment || `${workflowId} advanced`,
            tone: "success",
            routeWidget: "workflow",
            routeLabel: "Workflow",
            routeDetail: workflowId,
          });
          await advancePhase(workflowId);
        }
      } catch (e) {
        toast.error("Gate approval failed", String(e));
        onDestinationOutcome?.({
          label: "Workflow gate approval failed",
          detail: formatFallbackError(e),
          tone: "error",
          routeWidget: "workflow",
          routeLabel: "Workflow",
          routeDetail: workflowId,
        });
      }
    },
    [advancePhase, onDestinationOutcome],
  );

  const handleReject = useCallback(
    async (workflowId: string) => {
      // Confirm before rejecting — this stops the entire workflow
      const confirmed = await showPrompt("Reject this phase?", {
        placeholder: "Type 'reject' to confirm",
        defaultValue: "",
      });
      if (confirmed !== "reject") return;

      try {
        await invoke("workflow_reject_gate_decision", { workflowId, comment: confirmed });
        setRunning((prev) => prev.filter((wf) => wf.id !== workflowId));
        toast.warning("Workflow rejected", "Workflow has been stopped");
        onDestinationOutcome?.({
          label: "Workflow gate rejected",
          detail: workflowId,
          tone: "warn",
          routeWidget: "workflow",
          routeLabel: "Workflow",
          routeDetail: workflowId,
        });
        invoke("workflow_remove", { workflowId }).catch((err) => {
          reportInvokeFailure({
            source: "workflow",
            operation: "workflow_remove",
            err,
            severity: "info",
          });
        });
      } catch (e) {
        toast.error("Gate rejection failed", String(e));
        onDestinationOutcome?.({
          label: "Workflow gate rejection failed",
          detail: formatFallbackError(e),
          tone: "error",
          routeWidget: "workflow",
          routeLabel: "Workflow",
          routeDetail: workflowId,
        });
      }
    },
    [onDestinationOutcome],
  );

  useEffect(() => {
    if (running.length > 0) setExpanded(true);
  }, [running.length]);

  return (
    <section className={styles.panel} aria-label="Workflow panel">
      <PanelHeader
        title="Workflows"
        subtitle="multi-step runs"
        leadingIcon={<Workflow size={12} />}
        count={running.length > 0 ? running.length : undefined}
        collapsible
        collapsed={!expanded}
        onToggle={() => setExpanded(!expanded)}
      />

      {expanded && (
        <div className={styles.content}>
          {syncError && (
            <div className={styles.syncError} role="status">
              {syncError}
            </div>
          )}
          {/* Running workflows */}
          {running.map((wf) => {
            const totalCost = wf.phases.reduce((sum, p) => sum + p.cost, 0);
            return (
              <div key={wf.id} className={styles.runningCard}>
                <div className={styles.runningTitle}>
                  <span className={styles.runningName}>{wf.task_title}</span>
                  {totalCost > 0 && <span className={styles.totalCost}>${totalCost.toFixed(2)}</span>}
                </div>
                {wf.resume_point && (
                  <div className={styles.phaseDetail}>
                    <div className={styles.phaseDetailRow}>
                      <span>Resume:</span> <span className={styles.phaseDetailMono}>{wf.resume_point.phase_name}</span>
                    </div>
                    <div className={styles.phaseDetailRow}>
                      <span>Reason:</span> <span>{wf.resume_point.reason}</span>
                    </div>
                  </div>
                )}
                <div className={styles.stepBar}>
                  {wf.phases.map((p, i) => {
                    const phaseKey = `${wf.id}:${p.name}`;
                    const isExpanded = expandedPhase === phaseKey;
                    const duration = formatDuration(p.duration_ms);
                    return (
                      <div key={p.name} className={styles.stepWrapper}>
                        <div className={styles.stepRow}>
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${p.name}: ${p.status}. Click to ${isExpanded ? "collapse" : "expand"}`}
                            className={`${styles.step} ${styles[`step_${p.status}`]}`}
                            title={`${p.name}: ${p.status} (click to expand)`}
                            onClick={() => setExpandedPhase(isExpanded ? null : phaseKey)}
                          >
                            {STATUS_ICON[p.status]}
                            <span className={styles.stepName}>{p.name}</span>
                            {p.target_pane && <span className={styles.stepTarget}>{p.target_pane}</span>}
                            {(p.retry_count ?? 0) > 0 && <span className={styles.stepCost}>r{p.retry_count}</span>}
                            {duration && <span className={styles.stepCost}>{duration}</span>}
                            {p.cost > 0 && <span className={styles.stepCost}>${p.cost.toFixed(2)}</span>}
                          </button>
                          {p.status === "running" && p.agent_session_id?.startsWith("pane:") && (
                            <span className={styles.gateActions}>
                              <button
                                type="button"
                                className={styles.approveBtn}
                                onClick={() => handleManualPhaseDone(wf, p.name)}
                                title="Mark pane phase done"
                                aria-label={`Mark ${p.name} done`}
                              >
                                <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                              </button>
                            </span>
                          )}
                          {p.status === "waiting_gate" && (
                            <span className={styles.gateActions}>
                              <button
                                type="button"
                                className={styles.approveBtn}
                                onClick={() => handleApprove(wf.id)}
                                title="Approve"
                                aria-label="Approve gate"
                              >
                                <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={styles.rejectBtn}
                                onClick={() => handleReject(wf.id)}
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
                            {(p.retry_count ?? 0) > 0 && (
                              <div className={styles.phaseDetailRow}>
                                <span>Retries:</span> <span>{p.retry_count}</span>
                              </div>
                            )}
                            {duration && (
                              <div className={styles.phaseDetailRow}>
                                <span>Duration:</span> <span>{duration}</span>
                              </div>
                            )}
                            {p.agent_session_id && (
                              <div className={styles.phaseDetailRow}>
                                <span>Agent:</span>{" "}
                                <span className={styles.phaseDetailMono}>{p.agent_session_id.slice(0, 12)}</span>
                              </div>
                            )}
                            {p.target_pane && (
                              <div className={styles.phaseDetailRow}>
                                <span>Target:</span> <span className={styles.phaseDetailMono}>{p.target_pane}</span>
                              </div>
                            )}
                            {p.agent_role && (
                              <div className={styles.phaseDetailRow}>
                                <span>Role:</span> <span>{p.agent_role}</span>
                              </div>
                            )}
                            {p.decision_request && (
                              <div className={styles.phaseDetailRow}>
                                <span>Decision:</span>{" "}
                                <span className={styles.phaseDetailMono}>{p.decision_request.kind}</span>
                              </div>
                            )}
                            {p.gate_decision && (
                              <div className={styles.phaseDetailRow}>
                                <span>Gate:</span> <span>{p.gate_decision.decision}</span>
                              </div>
                            )}
                            {p.split_from && (
                              <div className={styles.phaseDetailRow}>
                                <span>Split from:</span> <span className={styles.phaseDetailMono}>{p.split_from}</span>
                              </div>
                            )}
                            {p.blocked_reason && (
                              <div className={styles.phaseDetailRow}>
                                <span>Reason:</span> <span>{p.blocked_reason}</span>
                              </div>
                            )}
                            {Boolean(
                              (p.artifacts?.length ?? 0) + (p.commands?.length ?? 0) + (p.validation?.length ?? 0),
                            ) && (
                              <div className={styles.phaseDetailRow}>
                                <span>Evidence:</span>{" "}
                                <span>
                                  {p.artifacts?.length ?? 0} artifacts / {p.commands?.length ?? 0} commands /{" "}
                                  {p.validation?.length ?? 0} validation
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        {p.status === "waiting_gate" && (
                          <section className={styles.gateDecisionPanel} aria-label={`Gate action for ${p.name}`}>
                            <span className={styles.gateDecisionCopy}>
                              <span className={styles.gateDecisionKicker}>Gate decision</span>
                              <strong>{p.decision_request?.kind ?? "approval_required"}</strong>
                              <span>
                                {p.decision_request?.reason ??
                                  p.blocked_reason ??
                                  "Review this phase before continuing."}
                              </span>
                            </span>
                            <span className={styles.gateDecisionActions}>
                              <button
                                type="button"
                                className={styles.gateApproveAction}
                                onClick={() => handleApprove(wf.id)}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className={styles.gateRejectAction}
                                onClick={() => handleReject(wf.id)}
                              >
                                Reject
                              </button>
                            </span>
                          </section>
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
            <button type="button" key={wf.path} className={styles.templateBtn} onClick={() => handleStart(wf)}>
              <Play size={10} />
              <span>{wf.name}</span>
              <span className={styles.templatePhases}>{wf.phase_count} phases</span>
            </button>
          ))}
          {running.length === 0 && workflows.length === 0 && (
            <p className={styles.emptyHint}>Build a workflow or import recipes to run repeatable guarded work.</p>
          )}
          <button type="button" className={styles.templateBtn} onClick={() => setBuilderOpen(true)}>
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
    </section>
  );
}
