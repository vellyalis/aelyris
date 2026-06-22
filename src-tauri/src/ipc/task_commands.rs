use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::event_commands::publish_and_emit;
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::task::{Task, TaskManager, TaskStatus};

/// Emitted with the full task snapshot after any mutation so the frontend hook
/// stays in sync (mirrors `agent-sessions-updated` / `agent-fleet-updated`).
const TASK_GRAPH_UPDATED: &str = "task-graph-updated";

fn emit_task_graph(app: &AppHandle, manager: &TaskManager) {
    let _ = app.emit(TASK_GRAPH_UPDATED, manager.list());
}

/// Create a task, run the dependency gate, and broadcast the new graph.
/// Returns the ids whose status changed by the gate (e.g. a root -> Ready).
#[tauri::command]
pub fn task_create(
    app: AppHandle,
    manager: State<'_, Arc<TaskManager>>,
    bus: State<'_, Arc<EventBus>>,
    task: Task,
) -> Result<Vec<String>, String> {
    let (id, title) = (task.id.clone(), task.title.clone());
    let changed = manager.create(task).map_err(|e| e.to_string())?;
    emit_task_graph(&app, &manager);
    publish_and_emit(
        &app,
        &bus,
        AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({ "id": id, "title": title }),
        ),
    );
    Ok(changed)
}

/// AUTONOMOUS PLANNING entry point: decompose a one-line `goal` into a build
/// plan with the planner LLM, then submit it atomically. The LLM self-corrects
/// against the validator (invalid plans are re-prompted with their errors) and,
/// if it still can't produce a valid plan, this fails loudly — there is no
/// hand-canned fallback. On success the task graph is populated + broadcast and a
/// `TaskCreated` event is published per task; the autonomy loop can then run it.
#[tauri::command]
pub async fn plan_build(
    app: AppHandle,
    manager: State<'_, Arc<TaskManager>>,
    bus: State<'_, Arc<EventBus>>,
    goal: String,
    context: Option<String>,
    model: Option<String>,
) -> Result<Vec<String>, String> {
    let ctx = context.unwrap_or_default();
    let mdl = model.unwrap_or_else(|| "sonnet".to_string());
    // The decomposition is a blocking subprocess + validation loop; run it off
    // the async runtime.
    let ordered = tauri::async_runtime::spawn_blocking(move || {
        crate::task::decompose_to_plan(
            &goal,
            &ctx,
            |prompt| crate::agent::claude_oneshot(prompt, &mdl),
            3,
        )
    })
    .await
    .map_err(|e| format!("planner task join error: {e}"))??;

    let created: Vec<(String, String)> = ordered
        .iter()
        .map(|t| (t.id.clone(), t.title.clone()))
        .collect();
    let changed = manager
        .submit_plan(ordered)
        .map_err(|errs| errs.join("; "))?;
    emit_task_graph(&app, &manager);
    for (id, title) in created {
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(
                AgentEventKind::TaskCreated,
                json!({ "id": id, "title": title }),
            ),
        );
    }
    Ok(changed)
}

/// Submit a whole LLM-authored build plan ATOMICALLY: it is validated (acyclic
/// DAG, declared lanes/owner/branches, parallel tasks own DISJOINT lanes) and
/// either added in full or rejected in full — the graph is never left partial.
/// On success the gate runs, the graph is broadcast, and one `TaskCreated` event
/// is published per task. On rejection EVERY problem is returned so the
/// orchestrator can re-plan; nothing is created. This is the safe entry point
/// for the orchestrator's goal decomposition.
#[tauri::command]
pub fn task_submit_plan(
    app: AppHandle,
    manager: State<'_, Arc<TaskManager>>,
    bus: State<'_, Arc<EventBus>>,
    tasks: Vec<Task>,
) -> Result<Vec<String>, Vec<String>> {
    let created: Vec<(String, String)> = tasks
        .iter()
        .map(|t| (t.id.clone(), t.title.clone()))
        .collect();
    let changed = manager.submit_plan(tasks)?;
    emit_task_graph(&app, &manager);
    for (id, title) in created {
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(
                AgentEventKind::TaskCreated,
                json!({ "id": id, "title": title }),
            ),
        );
    }
    Ok(changed)
}

/// Transition a task (lifecycle-validated), re-run the gate, and broadcast.
/// Reaching `Review`/`Done` also publishes the corresponding lifecycle event.
#[tauri::command]
pub fn task_transition(
    app: AppHandle,
    manager: State<'_, Arc<TaskManager>>,
    bus: State<'_, Arc<EventBus>>,
    id: String,
    to: TaskStatus,
) -> Result<Vec<String>, String> {
    let changed = manager.transition(&id, to).map_err(|e| e.to_string())?;
    emit_task_graph(&app, &manager);
    let lifecycle = match to {
        TaskStatus::Review => Some(AgentEventKind::ReviewRequired),
        TaskStatus::Done => Some(AgentEventKind::TaskCompleted),
        _ => None,
    };
    if let Some(kind) = lifecycle {
        publish_and_emit(&app, &bus, AgentEvent::new(kind, json!({ "id": id })));
    }
    Ok(changed)
}

/// Snapshot of every task, insertion-ordered.
#[tauri::command]
pub fn task_list(manager: State<'_, Arc<TaskManager>>) -> Vec<Task> {
    manager.list()
}

/// Re-run the dependency gate explicitly and broadcast the new graph.
#[tauri::command]
pub fn task_recompute_ready(app: AppHandle, manager: State<'_, Arc<TaskManager>>) -> Vec<String> {
    let changed = manager.recompute_ready();
    emit_task_graph(&app, &manager);
    changed
}
