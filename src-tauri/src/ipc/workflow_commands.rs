//! Workflow execution IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change. Shared helpers remain in `commands`.
use tauri::{AppHandle, Emitter, Manager};

use super::commands::record_audit_event;

// ── Workflow commands ──

/// List available workflow definitions for a project
#[tauri::command]
pub fn list_workflows(project_path: String) -> Vec<crate::workflow::WorkflowSummary> {
    crate::workflow::list_workflow_files(&project_path)
}

/// Start a workflow execution
#[tauri::command]
pub fn start_workflow(
    app: AppHandle,
    project_path: String,
    workflow_path: String,
    task_title: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let workflow = crate::workflow::parse_workflow(&workflow_path)?;
    let workflow_name = workflow.name.clone();
    let phase_count = workflow.phases.len();
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    if let Err(err) = executor.restore_project(&project_path) {
        log::warn!(
            "failed to restore workflow runs before start for project={:?}: {}",
            project_path,
            err
        );
    }
    let id = executor.start(workflow, &task_title, &project_path)?;
    record_audit_event(
        &app,
        "workflow",
        "start",
        "info",
        Some("workflow"),
        Some(&id),
        "Workflow started",
        serde_json::json!({
            "name": workflow_name,
            "phases": phase_count,
            "projectPath": project_path,
            "workflowPath": workflow_path,
            "taskTitle": task_title,
        }),
    );
    executor.status(&id)
}

/// Get the current phase config for a workflow (so frontend can start the agent)
#[tauri::command]
pub fn workflow_current_phase(
    app: AppHandle,
    workflow_id: String,
) -> Result<WorkflowPhaseInfo, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let (phase, prompt) = executor.current_phase_config(&workflow_id)?;
    Ok(WorkflowPhaseInfo {
        name: phase.name,
        model: phase.agent.model,
        prompt,
        max_cost: phase.agent.max_cost,
        target_pane: phase.target_pane,
        agent_role: phase.agent_role,
        allowed_tools: phase.agent.allowed_tools,
        has_gate: phase.quality_gate.is_some(),
        gate_type: phase.quality_gate.map(|g| format!("{:?}", g.gate_type)),
    })
}

#[derive(serde::Serialize)]
pub struct WorkflowPhaseInfo {
    pub name: String,
    pub model: String,
    pub prompt: String,
    pub max_cost: f64,
    pub target_pane: Option<String>,
    pub agent_role: Option<String>,
    pub allowed_tools: Vec<String>,
    pub has_gate: bool,
    pub gate_type: Option<String>,
}

/// Emit workflow status update event to frontend
fn emit_workflow_update(app: &AppHandle, executor: &crate::workflow::WorkflowExecutor) {
    let statuses = executor.list();
    let _ = app.emit("workflow-updated", statuses);
}

/// Record that an agent was started for the current phase
#[tauri::command]
pub fn workflow_set_agent(
    app: AppHandle,
    workflow_id: String,
    agent_session_id: String,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.set_phase_agent(&workflow_id, &agent_session_id)?;
    record_audit_event(
        &app,
        "workflow",
        "set_agent",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase agent assigned",
        serde_json::json!({
            "agentSessionId": agent_session_id,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Mark current phase's agent as complete. Ungated phases auto-advance.
#[tauri::command]
pub fn workflow_phase_done(
    app: AppHandle,
    workflow_id: String,
    cost: f64,
) -> Result<WorkflowPhaseDoneResult, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let outcome = executor.phase_agent_done(&workflow_id, cost)?;
    record_audit_event(
        &app,
        "workflow",
        "phase_done",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase completed",
        serde_json::json!({
            "cost": cost,
            "done": outcome.done,
            "waitingGate": outcome.waiting_gate,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(WorkflowPhaseDoneResult {
        done: outcome.done,
        waiting_gate: outcome.waiting_gate,
    })
}

#[derive(serde::Serialize)]
pub struct WorkflowPhaseDoneResult {
    pub done: bool,
    pub waiting_gate: bool,
}

/// Approve the current quality gate → advance to next phase
#[tauri::command]
pub fn workflow_approve_gate(app: AppHandle, workflow_id: String) -> Result<bool, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let done = executor.approve_gate(&workflow_id)?;
    record_audit_event(
        &app,
        "workflow",
        "approve_gate",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate approved",
        serde_json::json!({
            "done": done,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(done)
}

/// Approve the current quality gate with comment/conditional metadata.
#[tauri::command]
pub fn workflow_approve_gate_decision(
    app: AppHandle,
    workflow_id: String,
    comment: Option<String>,
    conditional: Option<bool>,
) -> Result<bool, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let conditional = conditional.unwrap_or(false);
    let comment = comment.unwrap_or_default();
    let done = executor.approve_gate_with_decision(&workflow_id, &comment, conditional)?;
    record_audit_event(
        &app,
        "workflow",
        "approve_gate_decision",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate approved with decision metadata",
        serde_json::json!({
            "done": done,
            "conditional": conditional,
            "comment": comment,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(done)
}

/// Reject the current quality gate → retry the phase
#[tauri::command]
pub fn workflow_reject_gate(app: AppHandle, workflow_id: String) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.reject_gate(&workflow_id)?;
    record_audit_event(
        &app,
        "workflow",
        "reject_gate",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate rejected",
        serde_json::json!({}),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Reject the current quality gate with a preserved reviewer comment.
#[tauri::command]
pub fn workflow_reject_gate_decision(
    app: AppHandle,
    workflow_id: String,
    comment: Option<String>,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let comment = comment.unwrap_or_default();
    executor.reject_gate_with_comment(&workflow_id, &comment)?;
    record_audit_event(
        &app,
        "workflow",
        "reject_gate_decision",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate rejected with decision metadata",
        serde_json::json!({
            "comment": comment,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Resume a workflow from a named phase and preserve the reason.
#[tauri::command]
pub fn workflow_resume_from_phase(
    app: AppHandle,
    workflow_id: String,
    phase_name: String,
    reason: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.resume_from_phase(&workflow_id, &phase_name, &reason)?;
    record_audit_event(
        &app,
        "workflow",
        "resume_phase",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow resumed from phase",
        serde_json::json!({
            "phaseName": phase_name,
            "reason": reason,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Split the current oversized phase into narrower child phases.
#[tauri::command]
pub fn workflow_split_current_phase(
    app: AppHandle,
    workflow_id: String,
    child_phase_names: Vec<String>,
    reason: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.split_current_phase(&workflow_id, child_phase_names.clone(), &reason)?;
    record_audit_event(
        &app,
        "workflow",
        "split_phase",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase split",
        serde_json::json!({
            "childPhaseNames": child_phase_names,
            "reason": reason,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Convert a blocker into an explicit decision request/gate.
#[tauri::command]
pub fn workflow_request_decision(
    app: AppHandle,
    workflow_id: String,
    kind: String,
    reason: String,
    options: Vec<String>,
    default_option: Option<String>,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.request_decision_for_current_phase(
        &workflow_id,
        &kind,
        &reason,
        options.clone(),
        default_option.clone(),
    )?;
    record_audit_event(
        &app,
        "workflow",
        "decision_requested",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow blocker converted to decision request",
        serde_json::json!({
            "kind": kind,
            "reason": reason,
            "options": options,
            "defaultOption": default_option,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Append phase artifacts, commands, validation evidence, and final report.
#[tauri::command]
pub fn workflow_record_phase_evidence(
    app: AppHandle,
    workflow_id: String,
    phase_name: Option<String>,
    artifacts: Vec<crate::workflow::WorkflowArtifact>,
    commands: Vec<crate::workflow::WorkflowCommandRecord>,
    validation: Vec<crate::workflow::WorkflowValidationRecord>,
    final_report: Option<String>,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.record_phase_evidence(
        &workflow_id,
        phase_name.as_deref(),
        artifacts,
        commands,
        validation,
        final_report,
    )?;
    record_audit_event(
        &app,
        "workflow",
        "phase_evidence",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase evidence recorded",
        serde_json::json!({
            "phaseName": phase_name,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Get workflow execution status
#[tauri::command]
pub fn workflow_status(
    app: AppHandle,
    workflow_id: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.status(&workflow_id)
}

/// List all running workflows
#[tauri::command]
pub fn list_running_workflows(
    app: AppHandle,
    project_path: Option<String>,
) -> Vec<crate::workflow::WorkflowStatus> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    if let Some(project_path) = project_path.as_deref() {
        if let Err(err) = executor.restore_project(project_path) {
            log::warn!(
                "failed to restore workflow runs for project={:?}: {}",
                project_path,
                err
            );
        }
    }
    executor.list()
}

/// Remove a completed/cancelled workflow from the executor
#[tauri::command]
pub fn workflow_remove(app: AppHandle, workflow_id: String) {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.remove(&workflow_id);
    record_audit_event(
        &app,
        "workflow",
        "remove",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow removed",
        serde_json::json!({}),
    );
}
