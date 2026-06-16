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
    bus: State<'_, EventBus>,
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

/// Transition a task (lifecycle-validated), re-run the gate, and broadcast.
/// Reaching `Review`/`Done` also publishes the corresponding lifecycle event.
#[tauri::command]
pub fn task_transition(
    app: AppHandle,
    manager: State<'_, Arc<TaskManager>>,
    bus: State<'_, EventBus>,
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
