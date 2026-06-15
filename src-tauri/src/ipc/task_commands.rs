use tauri::{AppHandle, Emitter, State};

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
    manager: State<'_, TaskManager>,
    task: Task,
) -> Result<Vec<String>, String> {
    let changed = manager.create(task).map_err(|e| e.to_string())?;
    emit_task_graph(&app, &manager);
    Ok(changed)
}

/// Transition a task (lifecycle-validated), re-run the gate, and broadcast.
#[tauri::command]
pub fn task_transition(
    app: AppHandle,
    manager: State<'_, TaskManager>,
    id: String,
    to: TaskStatus,
) -> Result<Vec<String>, String> {
    let changed = manager.transition(&id, to).map_err(|e| e.to_string())?;
    emit_task_graph(&app, &manager);
    Ok(changed)
}

/// Snapshot of every task, insertion-ordered.
#[tauri::command]
pub fn task_list(manager: State<'_, TaskManager>) -> Vec<Task> {
    manager.list()
}

/// Re-run the dependency gate explicitly and broadcast the new graph.
#[tauri::command]
pub fn task_recompute_ready(app: AppHandle, manager: State<'_, TaskManager>) -> Vec<String> {
    let changed = manager.recompute_ready();
    emit_task_graph(&app, &manager);
    changed
}
