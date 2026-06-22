use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::knowledge_graph::{index, KnowledgeGraphManager};

/// Populate (re-index) the Knowledge Graph from a project's source files, then
/// persist it. Returns the number of nodes indexed. The file walk + import parse
/// runs on a blocking worker so it never janks the UI thread; the result replaces
/// the graph wholesale (idempotent — safe to re-run on project switch / change).
#[tauri::command]
pub async fn populate_knowledge_graph(app: AppHandle, root_path: String) -> Result<usize, String> {
    let kg: Arc<KnowledgeGraphManager> = app.state::<Arc<KnowledgeGraphManager>>().inner().clone();
    // Run BOTH the file scan AND replace_graph (which locks the graph and does the
    // whole-graph SQLite write) on the blocking pool, so neither the FS walk nor the
    // synchronous DB transaction ever blocks an async runtime worker thread.
    tauri::async_runtime::spawn_blocking(move || {
        let (nodes, edges) = index::index_project(&root_path);
        let count = nodes.len();
        kg.replace_graph(nodes, edges);
        count
    })
    .await
    .map_err(|e| format!("knowledge graph index task failed: {e}"))
}
