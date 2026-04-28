use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::types::*;

/// Manages running workflow instances
#[derive(Clone)]
pub struct WorkflowExecutor {
    instances: Arc<Mutex<HashMap<String, WorkflowInstance>>>,
}

struct WorkflowInstance {
    workflow: Workflow,
    status: WorkflowStatus,
    task_title: String,
    project_path: String,
}

impl WorkflowExecutor {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a new workflow execution
    pub fn start(
        &self,
        workflow: Workflow,
        task_title: &str,
        project_path: &str,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();

        let phase_results: Vec<PhaseResult> = workflow
            .phases
            .iter()
            .map(|p| PhaseResult {
                name: p.name.clone(),
                status: PhaseStatus::Pending,
                agent_session_id: None,
                cost: 0.0,
            })
            .collect();

        let status = WorkflowStatus {
            id: id.clone(),
            workflow_name: workflow.name.clone(),
            task_title: task_title.to_string(),
            current_phase: 0,
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
        self.instances
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?
            .insert(id.clone(), instance);

        log::info!(
            "workflow start id={} name={:?} task={:?} phases={}",
            id, workflow_name, task_title, phase_count,
        );
        Ok(id)
    }

    /// Get the current phase config (model, prompt, etc.) for the agent to execute
    pub fn current_phase_config(&self, workflow_id: &str) -> Result<(Phase, String), String> {
        let instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
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
        let mut instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
        let idx = inst.status.current_phase;
        if let Some(pr) = inst.status.phases.get_mut(idx) {
            pr.status = PhaseStatus::Running;
            pr.agent_session_id = Some(agent_session_id.to_string());
        }
        Ok(())
    }

    /// Mark the current phase as waiting for a quality gate
    pub fn phase_waiting_gate(&self, workflow_id: &str, cost: f64) -> Result<(), String> {
        let mut instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
        let idx = inst.status.current_phase;
        if let Some(pr) = inst.status.phases.get_mut(idx) {
            pr.status = PhaseStatus::WaitingGate;
            pr.cost = cost;
        }
        Ok(())
    }

    /// Approve the current phase's quality gate and advance to the next phase
    pub fn approve_gate(&self, workflow_id: &str) -> Result<bool, String> {
        let mut instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
        let idx = inst.status.current_phase;
        let pr = inst
            .status
            .phases
            .get_mut(idx)
            .ok_or("Workflow already complete")?;
        pr.status = PhaseStatus::Passed;
        // Advance
        inst.status.current_phase += 1;
        let done = inst.status.current_phase >= inst.workflow.phases.len();
        Ok(done)
    }

    /// Reject the current phase's quality gate (agent needs to redo)
    pub fn reject_gate(&self, workflow_id: &str) -> Result<(), String> {
        let mut instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
        let inst = instances.get_mut(workflow_id).ok_or("Workflow not found")?;
        let idx = inst.status.current_phase;
        if let Some(pr) = inst.status.phases.get_mut(idx) {
            pr.status = PhaseStatus::Pending; // Reset to retry
            pr.agent_session_id = None;
        }
        Ok(())
    }

    /// Get workflow status
    pub fn status(&self, workflow_id: &str) -> Result<WorkflowStatus, String> {
        let instances = self.instances.lock().map_err(|_| "Lock poisoned".to_string())?;
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
            instances.remove(workflow_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_phase_workflow() -> Workflow {
        Workflow {
            name: "single".to_string(),
            description: "single phase".to_string(),
            phases: vec![Phase {
                name: "review".to_string(),
                depends_on: Vec::new(),
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

    #[test]
    fn approve_gate_rejects_repeated_approval_after_completion() {
        let executor = WorkflowExecutor::new();
        let id = executor
            .start(one_phase_workflow(), "task", "C:/repo")
            .expect("workflow starts");

        assert_eq!(executor.approve_gate(&id), Ok(true));
        let after_first = executor.status(&id).expect("status after first approval");
        assert_eq!(after_first.current_phase, 1);
        assert_eq!(after_first.phases[0].status, PhaseStatus::Passed);

        assert!(executor.approve_gate(&id).is_err());
        let after_second = executor.status(&id).expect("status after rejected approval");
        assert_eq!(after_second.current_phase, 1);
        assert_eq!(after_second.phases[0].status, PhaseStatus::Passed);
    }
}
