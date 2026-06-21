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
    let (nodes, edges) =
        tauri::async_runtime::spawn_blocking(move || index::index_project(&root_path))
            .await
            .map_err(|e| format!("knowledge graph index task failed: {e}"))?;
    let count = nodes.len();
    kg.replace_graph(nodes, edges);
    Ok(count)
}
