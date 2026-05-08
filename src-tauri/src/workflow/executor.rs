use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::types::*;

/// Manages running workflow instances
#[derive(Clone)]
pub struct WorkflowExecutor {
    instances: Arc<Mutex<HashMap<String, WorkflowInstance>>>,
}

#[derive(Clone, Serialize, Deserialize)]
struct WorkflowInstance {
    workflow: Workflow,
    status: WorkflowStatus,
    task_title: String,
    project_path: String,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn runtime_timestamp() -> String {
    now_millis().to_string()
}

fn duration_from(started_at: &Option<String>, completed_at: &str) -> Option<u64> {
    let start = started_at.as_deref()?.parse::<u64>().ok()?;
    let end = completed_at.parse::<u64>().ok()?;
    Some(end.saturating_sub(start))
}

fn workflow_runs_path(project_path: &str) -> PathBuf {
    Path::new(project_path)
        .join(".aether")
        .join("workflow-runs.json")
}

fn workflow_is_finished(status: &WorkflowStatus) -> bool {
    status.current_phase >= status.phases.len()
        || status.phases.iter().all(|phase| {
            matches!(
                phase.status,
                PhaseStatus::Passed | PhaseStatus::Failed | PhaseStatus::Skipped
            )
        })
}

fn load_project_instances(project_path: &str) -> Result<Vec<WorkflowInstance>, String> {
    let path = workflow_runs_path(project_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read workflow run state: {err}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<WorkflowInstance>>(&content)
        .map(|instances| {
            instances
                .into_iter()
                .filter(|instance| !workflow_is_finished(&instance.status))
                .collect()
        })
        .map_err(|err| format!("Failed to parse workflow run state: {err}"))
}

fn save_project_instances(
    project_path: &str,
    instances: Vec<WorkflowInstance>,
) -> Result<(), String> {
    let path = workflow_runs_path(project_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create workflow state directory: {err}"))?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(&instances)
        .map_err(|err| format!("Failed to serialize workflow run state: {err}"))?;
    std::fs::write(&tmp_path, format!("{content}\n"))
        .map_err(|err| format!("Failed to write workflow run state: {err}"))?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|err| format!("Failed to replace workflow run state: {err}"))?;
    }
    std::fs::rename(&tmp_path, &path)
        .map_err(|err| format!("Failed to commit workflow run state: {err}"))?;
    Ok(())
}

fn persist_project_locked(
    instances: &HashMap<String, WorkflowInstance>,
    project_path: &str,
) -> Result<(), String> {
    let project_instances = instances
        .values()
        .filter(|instance| {
            instance.project_path == project_path && !workflow_is_finished(&instance.status)
        })
        .cloned()
        .collect();
    save_project_instances(project_path, project_instances)
}

fn gate_type_name(gate_type: &GateType) -> &'static str {
    match gate_type {
        GateType::TestPass => "test_pass",
        GateType::BuildSuccess => "build_success",
        GateType::HumanReview => "human_review",
        GateType::AgentReview => "agent_review",
        GateType::Custom => "custom",
    }
}

fn phase_result_from_phase(phase: &Phase) -> PhaseResult {
    PhaseResult {
        name: phase.name.clone(),
        status: PhaseStatus::Pending,
        agent_session_id: None,
        target_pane: phase.target_pane.clone(),
        agent_role: phase.agent_role.clone(),
        cost: 0.0,
        started_at: None,
        completed_at: None,
        duration_ms: None,
        retry_count: 0,
        artifacts: Vec::new(),
        commands: Vec::new(),
        validation: Vec::new(),
        final_report: None,
        decision_request: None,
        gate_decision: None,
        split_from: None,
        split_reason: None,
        blocked_reason: None,
    }
}

fn decision_request(
    kind: impl Into<String>,
    reason: impl Into<String>,
    options: Vec<String>,
    default_option: Option<String>,
) -> WorkflowDecisionRequest {
    WorkflowDecisionRequest {
        kind: kind.into(),
        reason: reason.into(),
        options,
        default_option,
        requested_at: runtime_timestamp(),
    }
}

impl WorkflowExecutor {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Load unfinished workflow runs for a project from disk into memory.
    /// Existing in-memory instances win so live updates are not overwritten.
    pub fn restore_project(&self, project_path: &str) -> Result<usize, String> {
        let loaded = load_project_instances(project_path)?;
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let mut restored = 0;
        for instance in loaded {
            let id = instance.status.id.clone();
            if instances.contains_key(&id) {
                continue;
            }
            instances.insert(id, instance);
            restored += 1;
        }
        Ok(restored)
    }

    /// Start a new workflow execution
    pub fn start(
        &self,
        workflow: Workflow,
        task_title: &str,
        project_path: &str,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        let now = runtime_timestamp();
        let phase_results: Vec<PhaseResult> = workflow
            .phases
            .iter()
            .map(phase_result_from_phase)
            .collect();

        let status = WorkflowStatus {
            id: id.clone(),
            workflow_name: workflow.name.clone(),
            task_title: task_title.to_string(),
            current_phase: 0,
            started_at: now.clone(),
            updated_at: now,
            resume_point: None,
            final_report: None,
            phases: phase_results,
        };

        let instance = WorkflowInstance {
            workflow,
            status,
            task_title: task_title.to_string(),
            project_path: project_path.to_string(),
        };

        let phase_count = instance.status.phases.len();
        let workflow_name = instance.status.workflow_name.clone();
        {
            let mut instances = self
                .instances
                .lock()
                .map_err(|_| "Lock poisoned".to_string())?;
            instances.insert(id.clone(), instance);
            persist_project_locked(&instances, project_path)?;
        }

        log::info!(
            "workflow start id={} name={:?} task={:?} phases={}",
            id,
            workflow_name,
            task_title,
            phase_count,
        );
        Ok(id)
    }

    /// Get the current phase config (model, prompt, etc.) for the agent to execute
    pub fn current_phase_config(&self, workflow_id: &str) -> Result<(Phase, String), String> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get(workflow_id).ok_or("Workflow not found")?;
        let idx = inst.status.current_phase;
        let phase = inst.workflow.phases.get(idx).ok_or("No more phases")?;

        // Substitute placeholders in prompt
        let prompt = phase
            .agent
            .prompt
            .replace("{task_title}", &inst.task_title)
            .replace("{project_path}", &inst.project_path);

        Ok((phase.clone(), prompt))
    }

    /// Record that an agent session has been started for the current phase
    pub fn set_phase_agent(&self, workflow_id: &str, agent_session_id: &str) -> Result<(), String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let now = runtime_timestamp();
            if let Some(pr) = inst.status.phases.get_mut(idx) {
                pr.status = PhaseStatus::Running;
                pr.agent_session_id = Some(agent_session_id.to_string());
                if pr.started_at.is_none() {
                    pr.started_at = Some(now.clone());
                }
            }
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(())
    }

    /// Mark the current phase as waiting for a quality gate
    pub fn phase_waiting_gate(&self, workflow_id: &str, cost: f64) -> Result<(), String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let now = runtime_timestamp();
            let gate = inst
                .workflow
                .phases
                .get(idx)
                .and_then(|phase| phase.quality_gate.as_ref());
            if let Some(pr) = inst.status.phases.get_mut(idx) {
                pr.status = PhaseStatus::WaitingGate;
                pr.cost = cost;
                if let Some(gate) = gate {
                    pr.decision_request = Some(decision_request(
                        gate_type_name(&gate.gate_type),
                        gate.criteria.clone(),
                        vec!["approve".to_string(), "reject".to_string()],
                        Some("approve".to_string()),
                    ));
                }
            }
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(())
    }

    /// Mark the current phase's agent as finished. Phases with an explicit
    /// quality gate pause for approval; phases without a gate pass and advance.
    pub fn phase_agent_done(
        &self,
        workflow_id: &str,
        cost: f64,
    ) -> Result<PhaseDoneOutcome, String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let outcome;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let gate = inst
                .workflow
                .phases
                .get(idx)
                .map(|phase| phase.quality_gate.clone())
                .ok_or("Workflow already complete")?;
            let now = runtime_timestamp();
            let pr = inst
                .status
                .phases
                .get_mut(idx)
                .ok_or("Workflow already complete")?;
            pr.cost = cost;
            if gate.is_some() {
                pr.status = PhaseStatus::WaitingGate;
                if let Some(gate) = gate {
                    pr.decision_request = Some(decision_request(
                        gate_type_name(&gate.gate_type),
                        if gate.criteria.is_empty() {
                            "Phase quality gate requires approval.".to_string()
                        } else {
                            gate.criteria
                        },
                        vec!["approve".to_string(), "reject".to_string()],
                        Some("approve".to_string()),
                    ));
                }
                inst.status.updated_at = now;
                project_path = inst.project_path.clone();
                outcome = PhaseDoneOutcome {
                    done: false,
                    waiting_gate: true,
                };
            } else {
                pr.status = PhaseStatus::Passed;
                pr.completed_at = Some(now.clone());
                pr.duration_ms = duration_from(&pr.started_at, &now);
                pr.decision_request = None;
                inst.status.current_phase += 1;
                inst.status.updated_at = now;
                project_path = inst.project_path.clone();
                outcome = PhaseDoneOutcome {
                    done: inst.status.current_phase >= inst.workflow.phases.len(),
                    waiting_gate: false,
                };
            }
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(outcome)
    }

    /// Approve the current phase's quality gate and advance to the next phase
    pub fn approve_gate(&self, workflow_id: &str) -> Result<bool, String> {
        self.approve_gate_with_decision(workflow_id, "", false)
    }

    /// Approve the current phase's quality gate with an auditable comment.
    pub fn approve_gate_with_decision(
        &self,
        workflow_id: &str,
        comment: &str,
        conditional: bool,
    ) -> Result<bool, String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let done;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let now = runtime_timestamp();
            let pr = inst
                .status
                .phases
                .get_mut(idx)
                .ok_or("Workflow already complete")?;
            pr.status = PhaseStatus::Passed;
            pr.completed_at = Some(now.clone());
            pr.duration_ms = duration_from(&pr.started_at, &now);
            pr.decision_request = None;
            pr.gate_decision = Some(WorkflowGateDecision {
                decision: if conditional {
                    GateDecisionKind::Conditional
                } else {
                    GateDecisionKind::Approved
                },
                comment: comment.to_string(),
                conditional,
                decided_at: now.clone(),
            });
            // Advance
            inst.status.current_phase += 1;
            done = inst.status.current_phase >= inst.workflow.phases.len();
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(done)
    }

    /// Reject the current phase's quality gate (agent needs to redo)
    pub fn reject_gate(&self, workflow_id: &str) -> Result<(), String> {
        self.reject_gate_with_comment(workflow_id, "")
    }

    /// Reject the current phase's quality gate and preserve the rejection
    /// comment as an auditable decision before retrying the same phase.
    pub fn reject_gate_with_comment(&self, workflow_id: &str, comment: &str) -> Result<(), String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let now = runtime_timestamp();
            if let Some(pr) = inst.status.phases.get_mut(idx) {
                pr.status = PhaseStatus::Pending; // Reset to retry
                pr.agent_session_id = None;
                pr.retry_count = pr.retry_count.saturating_add(1);
                pr.started_at = None;
                pr.completed_at = None;
                pr.duration_ms = None;
                pr.decision_request = None;
                pr.gate_decision = Some(WorkflowGateDecision {
                    decision: GateDecisionKind::Rejected,
                    comment: comment.to_string(),
                    conditional: false,
                    decided_at: now.clone(),
                });
            }
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(())
    }

    /// Move execution back to a named phase and record why this is the
    /// resumable checkpoint. Earlier phase results are preserved.
    pub fn resume_from_phase(
        &self,
        workflow_id: &str,
        phase_name: &str,
        reason: &str,
    ) -> Result<WorkflowStatus, String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let status;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst
                .status
                .phases
                .iter()
                .position(|phase| phase.name == phase_name)
                .ok_or_else(|| format!("Phase not found: {phase_name}"))?;
            let now = runtime_timestamp();
            inst.status.current_phase = idx;
            inst.status.resume_point = Some(WorkflowResumePoint {
                phase_index: idx,
                phase_name: phase_name.to_string(),
                reason: reason.to_string(),
                recorded_at: now.clone(),
            });
            if let Some(phase) = inst.status.phases.get_mut(idx) {
                phase.status = PhaseStatus::Pending;
                phase.agent_session_id = None;
                phase.retry_count = phase.retry_count.saturating_add(1);
                phase.started_at = None;
                phase.completed_at = None;
                phase.duration_ms = None;
                phase.blocked_reason = Some(reason.to_string());
            }
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
            status = inst.status.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(status)
    }

    /// Split the current oversized phase into narrower child phases. The
    /// original phase is skipped with split metadata and execution continues at
    /// the first generated child.
    pub fn split_current_phase(
        &self,
        workflow_id: &str,
        child_phase_names: Vec<String>,
        reason: &str,
    ) -> Result<WorkflowStatus, String> {
        let child_phase_names: Vec<String> = child_phase_names
            .into_iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect();
        if child_phase_names.is_empty() {
            return Err("At least one child phase is required".to_string());
        }

        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let status;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let original_phase = inst
                .workflow
                .phases
                .get(idx)
                .cloned()
                .ok_or("Workflow already complete")?;
            let original_name = original_phase.name.clone();
            let now = runtime_timestamp();

            let mut inserted_phases = Vec::new();
            let mut inserted_results = Vec::new();
            for child_name in child_phase_names {
                let mut child_phase = original_phase.clone();
                child_phase.name = child_name.clone();
                child_phase.depends_on = vec![original_name.clone()];
                let mut result = phase_result_from_phase(&child_phase);
                result.split_from = Some(original_name.clone());
                result.split_reason = Some(reason.to_string());
                inserted_phases.push(child_phase);
                inserted_results.push(result);
            }

            if let Some(result) = inst.status.phases.get_mut(idx) {
                result.status = PhaseStatus::Skipped;
                result.completed_at = Some(now.clone());
                result.duration_ms = duration_from(&result.started_at, &now);
                result.split_reason = Some(reason.to_string());
                result.blocked_reason = Some(reason.to_string());
            }
            inst.workflow
                .phases
                .splice((idx + 1)..(idx + 1), inserted_phases);
            inst.status
                .phases
                .splice((idx + 1)..(idx + 1), inserted_results);
            inst.status.current_phase = idx + 1;
            inst.status.resume_point = Some(WorkflowResumePoint {
                phase_index: idx + 1,
                phase_name: inst.status.phases[idx + 1].name.clone(),
                reason: format!("split from {original_name}: {reason}"),
                recorded_at: now.clone(),
            });
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
            status = inst.status.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(status)
    }

    /// Convert a blocker into an explicit decision request/gate for the current
    /// phase so the workflow can resume once the decision is answered.
    pub fn request_decision_for_current_phase(
        &self,
        workflow_id: &str,
        kind: &str,
        reason: &str,
        options: Vec<String>,
        default_option: Option<String>,
    ) -> Result<WorkflowStatus, String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let status;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = inst.status.current_phase;
            let now = runtime_timestamp();
            if let Some(pr) = inst.status.phases.get_mut(idx) {
                pr.status = PhaseStatus::WaitingGate;
                pr.blocked_reason = Some(reason.to_string());
                pr.decision_request = Some(decision_request(kind, reason, options, default_option));
            }
            inst.status.resume_point =
                inst.status
                    .phases
                    .get(idx)
                    .map(|phase| WorkflowResumePoint {
                        phase_index: idx,
                        phase_name: phase.name.clone(),
                        reason: reason.to_string(),
                        recorded_at: now.clone(),
                    });
            inst.status.updated_at = now;
            project_path = inst.project_path.clone();
            status = inst.status.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(status)
    }

    /// Attach artifacts, commands, validation evidence, and final report text to
    /// a phase. When phase_name is None, the current phase is updated.
    pub fn record_phase_evidence(
        &self,
        workflow_id: &str,
        phase_name: Option<&str>,
        artifacts: Vec<WorkflowArtifact>,
        commands: Vec<WorkflowCommandRecord>,
        validation: Vec<WorkflowValidationRecord>,
        final_report: Option<String>,
    ) -> Result<WorkflowStatus, String> {
        let mut instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let project_path;
        let status;
        {
            let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
            let idx = match phase_name {
                Some(name) => inst
                    .status
                    .phases
                    .iter()
                    .position(|phase| phase.name == name)
                    .ok_or_else(|| format!("Phase not found: {name}"))?,
                None => inst.status.current_phase,
            };
            let phase = inst
                .status
                .phases
                .get_mut(idx)
                .ok_or("Workflow already complete")?;
            phase.artifacts.extend(artifacts);
            phase.commands.extend(commands);
            phase.validation.extend(validation);
            if let Some(report) = final_report {
                phase.final_report = Some(report.clone());
                inst.status.final_report = Some(report);
            }
            inst.status.updated_at = runtime_timestamp();
            project_path = inst.project_path.clone();
            status = inst.status.clone();
        }
        persist_project_locked(&instances, &project_path)?;
        Ok(status)
    }

    /// Get workflow status
    pub fn status(&self, workflow_id: &str) -> Result<WorkflowStatus, String> {
        let instances = self
            .instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get(workflow_id).ok_or("Workflow not found")?;
        Ok(inst.status.clone())
    }

    /// List all active workflows
    pub fn list(&self) -> Vec<WorkflowStatus> {
        self.instances
            .lock()
            .map(|i| i.values().map(|inst| inst.status.clone()).collect())
            .unwrap_or_default()
    }

    /// Remove a completed/cancelled workflow
    pub fn remove(&self, workflow_id: &str) {
        if let Ok(mut instances) = self.instances.lock() {
            let project_path = instances
                .get(workflow_id)
                .map(|instance| instance.project_path.clone());
            instances.remove(workflow_id);
            if let Some(project_path) = project_path {
                if let Err(err) = persist_project_locked(&instances, &project_path) {
                    log::warn!(
                        "failed to persist workflow removal id={} project={:?}: {}",
                        workflow_id,
                        project_path,
                        err
                    );
                }
            }
        }
    }
}

impl Default for WorkflowExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhaseDoneOutcome {
    pub done: bool,
    pub waiting_gate: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp project")
    }

    fn project_path(project: &tempfile::TempDir) -> String {
        project.path().to_string_lossy().to_string()
    }

    fn one_phase_workflow() -> Workflow {
        Workflow {
            name: "single".to_string(),
            description: "single phase".to_string(),
            phases: vec![Phase {
                name: "review".to_string(),
                depends_on: Vec::new(),
                target_pane: None,
                agent_role: None,
                agent: AgentConfig {
                    model: "sonnet".to_string(),
                    prompt: "check {task_title}".to_string(),
                    allowed_tools: Vec::new(),
                    max_cost: 1.0,
                    timeout_secs: 60,
                },
                quality_gate: None,
            }],
        }
    }

    fn gated_workflow() -> Workflow {
        let mut workflow = one_phase_workflow();
        workflow.phases[0].quality_gate = Some(QualityGate {
            gate_type: GateType::HumanReview,
            criteria: "check output".to_string(),
        });
        workflow
    }

    #[test]
    fn approve_gate_rejects_repeated_approval_after_completion() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(one_phase_workflow(), "task", &project_path(&project))
            .expect("workflow starts");

        assert_eq!(executor.approve_gate(&id), Ok(true));
        let after_first = executor.status(&id).expect("status after first approval");
        assert_eq!(after_first.current_phase, 1);
        assert_eq!(after_first.phases[0].status, PhaseStatus::Passed);

        assert!(executor.approve_gate(&id).is_err());
        let after_second = executor
            .status(&id)
            .expect("status after rejected approval");
        assert_eq!(after_second.current_phase, 1);
        assert_eq!(after_second.phases[0].status, PhaseStatus::Passed);
    }

    #[test]
    fn agent_done_auto_passes_phase_without_gate() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(one_phase_workflow(), "task", &project_path(&project))
            .expect("workflow starts");
        executor
            .set_phase_agent(&id, "agent-1")
            .expect("agent assigned");

        let outcome = executor
            .phase_agent_done(&id, 0.42)
            .expect("phase completes");

        assert_eq!(
            outcome,
            PhaseDoneOutcome {
                done: true,
                waiting_gate: false,
            }
        );
        let status = executor.status(&id).expect("status");
        assert_eq!(status.current_phase, 1);
        assert_eq!(status.phases[0].status, PhaseStatus::Passed);
        assert_eq!(status.phases[0].cost, 0.42);
    }

    #[test]
    fn agent_done_waits_when_phase_has_gate() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(gated_workflow(), "task", &project_path(&project))
            .expect("workflow starts");
        executor
            .set_phase_agent(&id, "agent-1")
            .expect("agent assigned");

        let outcome = executor.phase_agent_done(&id, 0.24).expect("phase waits");

        assert_eq!(
            outcome,
            PhaseDoneOutcome {
                done: false,
                waiting_gate: true,
            }
        );
        let status = executor.status(&id).expect("status");
        assert_eq!(status.current_phase, 0);
        assert_eq!(status.phases[0].status, PhaseStatus::WaitingGate);
        assert_eq!(status.phases[0].cost, 0.24);
    }

    #[test]
    fn restores_unfinished_project_workflows_from_disk() {
        let project = temp_project();
        let project_path = project_path(&project);
        let executor = WorkflowExecutor::new();
        let id = executor
            .start(gated_workflow(), "task", &project_path)
            .expect("workflow starts");
        executor
            .set_phase_agent(&id, "agent-1")
            .expect("agent assigned");
        executor.phase_agent_done(&id, 0.24).expect("phase waits");

        let restored = WorkflowExecutor::new();
        assert_eq!(
            restored
                .restore_project(&project_path)
                .expect("project restores"),
            1
        );
        let status = restored.status(&id).expect("restored status");
        assert_eq!(status.phases[0].status, PhaseStatus::WaitingGate);
        assert!(status.phases[0].decision_request.is_some());

        restored
            .approve_gate_with_decision(&id, "approved", false)
            .expect("gate completes");
        let clean = WorkflowExecutor::new();
        assert_eq!(
            clean
                .restore_project(&project_path)
                .expect("project restores"),
            0
        );
    }

    #[test]
    fn start_copies_phase_routing_metadata_into_status() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let mut workflow = one_phase_workflow();
        workflow.phases[0].target_pane = Some("@review".to_string());
        workflow.phases[0].agent_role = Some("reviewer".to_string());

        let id = executor
            .start(workflow, "task", &project_path(&project))
            .expect("workflow starts");

        let status = executor.status(&id).expect("status");
        assert_eq!(status.phases[0].target_pane.as_deref(), Some("@review"));
        assert_eq!(status.phases[0].agent_role.as_deref(), Some("reviewer"));
    }

    #[test]
    fn records_phase_evidence_and_resume_point() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(one_phase_workflow(), "task", &project_path(&project))
            .expect("workflow starts");

        let status = executor
            .record_phase_evidence(
                &id,
                Some("review"),
                vec![WorkflowArtifact {
                    path: "target/report.json".to_string(),
                    kind: "report".to_string(),
                }],
                vec![WorkflowCommandRecord {
                    command: "cargo test workflow".to_string(),
                    exit_code: Some(0),
                    result: "pass".to_string(),
                }],
                vec![WorkflowValidationRecord {
                    command: "cargo test workflow".to_string(),
                    status: "pass".to_string(),
                    evidence: "workflow tests passed".to_string(),
                }],
                Some("Workflow final report".to_string()),
            )
            .expect("evidence recorded");
        assert_eq!(status.phases[0].artifacts[0].path, "target/report.json");
        assert_eq!(status.phases[0].commands[0].result, "pass");
        assert_eq!(status.phases[0].validation[0].status, "pass");
        assert_eq!(
            status.final_report.as_deref(),
            Some("Workflow final report")
        );

        let resumed = executor
            .resume_from_phase(&id, "review", "resume after interrupted test run")
            .expect("workflow resumes");
        assert_eq!(resumed.current_phase, 0);
        assert_eq!(
            resumed
                .resume_point
                .as_ref()
                .map(|point| point.reason.as_str()),
            Some("resume after interrupted test run")
        );
        assert_eq!(resumed.phases[0].retry_count, 1);
        assert_eq!(resumed.phases[0].status, PhaseStatus::Pending);
    }

    #[test]
    fn split_current_phase_creates_resumeable_child_phases() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(one_phase_workflow(), "task", &project_path(&project))
            .expect("workflow starts");

        let status = executor
            .split_current_phase(
                &id,
                vec!["review-small-a".to_string(), "review-small-b".to_string()],
                "original phase exceeded timeout budget",
            )
            .expect("workflow splits");

        assert_eq!(status.current_phase, 1);
        assert_eq!(status.phases[0].status, PhaseStatus::Skipped);
        assert_eq!(
            status.phases[0].blocked_reason.as_deref(),
            Some("original phase exceeded timeout budget")
        );
        assert_eq!(status.phases[1].name, "review-small-a");
        assert_eq!(status.phases[1].split_from.as_deref(), Some("review"));
        assert_eq!(
            status
                .resume_point
                .as_ref()
                .map(|point| point.phase_name.as_str()),
            Some("review-small-a")
        );

        let (phase, prompt) = executor.current_phase_config(&id).expect("child config");
        assert_eq!(phase.name, "review-small-a");
        assert!(prompt.contains("check task"));
    }

    #[test]
    fn blocker_decision_request_waits_at_gate_until_approved() {
        let executor = WorkflowExecutor::new();
        let project = temp_project();
        let id = executor
            .start(gated_workflow(), "task", &project_path(&project))
            .expect("workflow starts");
        executor
            .request_decision_for_current_phase(
                &id,
                "product_decision",
                "Choose compatibility policy",
                vec!["strict".to_string(), "permissive".to_string()],
                Some("strict".to_string()),
            )
            .expect("decision requested");

        let waiting = executor.status(&id).expect("status");
        assert_eq!(waiting.phases[0].status, PhaseStatus::WaitingGate);
        let request = waiting.phases[0]
            .decision_request
            .as_ref()
            .expect("decision request");
        assert_eq!(request.kind, "product_decision");
        assert_eq!(request.default_option.as_deref(), Some("strict"));

        let done = executor
            .approve_gate_with_decision(&id, "conditional: keep strict mode for release", true)
            .expect("gate approval");
        assert!(done);
        let approved = executor.status(&id).expect("approved status");
        assert_eq!(approved.phases[0].status, PhaseStatus::Passed);
        assert_eq!(
            approved.phases[0]
                .gate_decision
                .as_ref()
                .map(|decision| &decision.decision),
            Some(&GateDecisionKind::Conditional)
        );
        assert!(approved.phases[0].decision_request.is_none());
    }
}
