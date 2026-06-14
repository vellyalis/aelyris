use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::mux::graph::{LifecycleState, MuxGraph, PaneRecord, PtyBinding, MUX_GRAPH_VERSION};
use crate::mux::layout::SplitAxis;
use crate::mux::manager::MuxManagerError;
use crate::mux::store::{graph_for_snapshot_restore, VersionedMuxSnapshot};
use crate::pty::{PtyError, ShellType};

use super::{
    default_cols, default_rows,
    session_common::{normalize_api_cwd, parse_shell},
    validate_session_id, ApiError, ApiResult, ApiState, CreateSessionResponse, InputBody,
    WS_MAX_INPUT_FRAME_BYTES,
};

pub(super) fn router() -> Router<ApiState> {
    Router::new()
        .route("/mux/workspaces", get(list_mux_workspaces))
        .route("/mux/workspaces/import", post(import_mux_workspace))
        .route("/mux/workspaces/{id}", get(get_mux_workspace))
        .route("/mux/workspaces/{id}/export", get(export_mux_workspace))
        .route("/mux/workspaces/{id}/detach", post(detach_mux_workspace))
        .route("/mux/workspaces/{id}/attach", post(attach_mux_workspace))
        .route(
            "/mux/workspaces/{id}/input",
            post(broadcast_mux_workspace_input),
        )
        .route("/mux/workspaces/{id}/panes/split", post(split_mux_pane))
        .route("/mux/workspaces/{id}/panes/swap", post(swap_mux_panes))
        .route("/mux/workspaces/{id}/panes/move", post(move_mux_pane))
        .route("/mux/workspaces/{id}/panes/join", post(join_mux_pane))
        .route(
            "/mux/workspaces/{id}/panes/synchronize",
            post(set_mux_panes_synchronized),
        )
        .route(
            "/mux/workspaces/{id}/panes/{pane_id}/break",
            post(break_mux_pane),
        )
        .route(
            "/mux/workspaces/{id}/panes/{pane_id}/zoom",
            post(set_mux_pane_zoom),
        )
        .route(
            "/mux/workspaces/{id}/panes/{pane_id}",
            delete(close_mux_pane),
        )
        .route(
            "/mux/workspaces/{id}/layout/even",
            post(apply_mux_even_layout),
        )
        .route(
            "/mux/workspaces/{id}/layout/equalize",
            post(equalize_mux_layout),
        )
        .route(
            "/mux/workspaces/{id}/layout/tiled",
            post(apply_mux_tiled_layout),
        )
        .route(
            "/mux/workspaces/{id}/layout/rotate",
            post(rotate_mux_layout),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitMuxPaneBody {
    target_pane_id: String,
    axis: SplitAxis,
    #[serde(default)]
    shell: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    cols: Option<u16>,
    #[serde(default)]
    rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwapMuxPanesBody {
    first_pane_id: String,
    second_pane_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveMuxPaneBody {
    source_pane_id: String,
    target_pane_id: String,
    axis: SplitAxis,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinMuxPaneBody {
    source_pane_id: String,
    target_pane_id: String,
    axis: SplitAxis,
}

#[derive(Deserialize)]
struct SynchronizePanesBody {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RotateLayoutBody {
    direction: RotateDirection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum RotateDirection {
    Next,
    Previous,
}

impl RotateDirection {
    fn is_reverse(&self) -> bool {
        matches!(self, Self::Previous)
    }
}

#[derive(Deserialize)]
struct ZoomMuxPaneBody {
    zoomed: bool,
}

#[derive(Deserialize)]
struct EvenLayoutBody {
    axis: SplitAxis,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportMuxWorkspaceQuery {
    #[serde(default)]
    replace: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MuxWorkspaceSummary {
    pub(super) id: String,
    active: bool,
    window_count: usize,
    tab_count: usize,
    pane_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MuxBroadcastResponse {
    workspace_id: String,
    targets: usize,
    accepted: usize,
    failed: usize,
}

#[derive(Debug, Clone)]
struct AttachPanePlan {
    pane_id: String,
    shell: ShellType,
    cwd: String,
    cols: u16,
    rows: u16,
}

pub(super) fn sync_spawn(
    state: &ApiState,
    id: &str,
    shell: &ShellType,
    cwd: Option<&str>,
    cols: u16,
    rows: u16,
) -> ApiResult<()> {
    let shell_name = format!("{:?}", shell).to_lowercase();
    let cwd = cwd.unwrap_or(".");
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.upsert_standalone_terminal(id, &shell_name, cwd, cols, rows)
            .map_err(|err| map_mux_err(id, err))?;
        mux.graph(id)
            .cloned()
            .ok_or_else(|| ApiError::Internal(format!("mux graph missing after spawn: {id}")))?
    };
    persist_mux_graph(state, &graph)
}

pub(super) fn sync_resize(state: &ApiState, id: &str, cols: u16, rows: u16) -> ApiResult<()> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.update_pane_size(id, cols, rows)
            .map_err(|err| map_mux_err(id, err))?;
        mux.graph(id)
            .cloned()
            .or_else(|| {
                mux.workspace_ids()
                    .into_iter()
                    .filter_map(|workspace_id| mux.graph(&workspace_id).cloned())
                    .find(|graph| graph_has_pane(graph, id))
            })
            .ok_or_else(|| ApiError::Internal(format!("mux graph missing after resize: {id}")))?
    };
    persist_mux_graph(state, &graph)
}

pub(super) fn take_graph(state: &ApiState, id: &str) -> Result<Option<MuxGraph>, ApiError> {
    state
        .mux
        .lock()
        .map(|mut mux| mux.remove_graph(id))
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))
}

pub(super) fn collect_pty_ids(graph: &MuxGraph) -> Vec<String> {
    let mut ids = Vec::new();
    for workspace in graph.workspaces.values() {
        for window in workspace.windows.values() {
            for tab in window.tabs.values() {
                for pane in tab.panes.values() {
                    if let Some(pty) = &pane.pty {
                        ids.push(pty.terminal_id.clone());
                    }
                }
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

fn collect_live_pty_ids(graph: &MuxGraph) -> Vec<String> {
    let mut ids = Vec::new();
    for workspace in graph.workspaces.values() {
        for window in workspace.windows.values() {
            for tab in window.tabs.values() {
                for pane in tab.panes.values() {
                    if !matches!(
                        pane.lifecycle,
                        LifecycleState::Active | LifecycleState::Detached
                    ) {
                        continue;
                    }
                    let Some(pty) = &pane.pty else {
                        continue;
                    };
                    if is_restore_pending_terminal_id(&pty.terminal_id) {
                        continue;
                    }
                    ids.push(pty.terminal_id.clone());
                }
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

fn restore_pending_terminal_id(pane_id: &str) -> String {
    format!("restore-pending:{pane_id}")
}

fn is_restore_pending_terminal_id(terminal_id: &str) -> bool {
    terminal_id.starts_with("restore-pending:")
}

fn mark_mux_graph_detached(graph: &mut MuxGraph) -> Result<(), ApiError> {
    for workspace in graph.workspaces.values_mut() {
        for window in workspace.windows.values_mut() {
            for tab in window.tabs.values_mut() {
                for pane in tab.panes.values_mut() {
                    let (cols, rows) = pane
                        .pty
                        .as_ref()
                        .map(|pty| (pty.cols, pty.rows))
                        .unwrap_or_else(|| (default_cols(), default_rows()));
                    pane.lifecycle = LifecycleState::Detached;
                    if pane.pty.is_none() {
                        pane.pty = Some(PtyBinding {
                            terminal_id: restore_pending_terminal_id(&pane.id),
                            process_id: None,
                            cols,
                            rows,
                        });
                    }
                }
            }
        }
    }
    graph
        .validate()
        .map_err(|err| ApiError::Internal(err.to_string()))?;
    Ok(())
}

fn collect_mux_attach_plan(
    state: &ApiState,
    graph: &MuxGraph,
) -> Result<Vec<AttachPanePlan>, ApiError> {
    let mut plan = Vec::new();
    for workspace in graph.workspaces.values() {
        for window in workspace.windows.values() {
            for tab in window.tabs.values() {
                for pane in tab.panes.values() {
                    let live_bound_terminal = pane
                        .pty
                        .as_ref()
                        .map(|pty| {
                            !is_restore_pending_terminal_id(&pty.terminal_id)
                                && state.pty.contains(&pty.terminal_id)
                        })
                        .unwrap_or(false);
                    if live_bound_terminal {
                        continue;
                    }
                    if state.pty.contains(&pane.id) {
                        return Err(ApiError::BadRequest(format!(
                            "cannot attach pane {} because that terminal id is already live",
                            pane.id
                        )));
                    }
                    let shell = parse_shell(&pane.shell)?;
                    let (cols, rows) = pane
                        .pty
                        .as_ref()
                        .map(|pty| (pty.cols.max(1), pty.rows.max(1)))
                        .unwrap_or_else(|| (default_cols(), default_rows()));
                    plan.push(AttachPanePlan {
                        pane_id: pane.id.clone(),
                        shell,
                        cwd: pane.cwd.clone(),
                        cols,
                        rows,
                    });
                }
            }
        }
    }
    Ok(plan)
}

fn mark_mux_graph_attached(graph: &mut MuxGraph, plan: &[AttachPanePlan]) -> Result<(), ApiError> {
    for workspace in graph.workspaces.values_mut() {
        for window in workspace.windows.values_mut() {
            for tab in window.tabs.values_mut() {
                for pane in tab.panes.values_mut() {
                    pane.lifecycle = LifecycleState::Active;
                    if let Some(item) = plan.iter().find(|item| item.pane_id == pane.id) {
                        pane.pty = Some(PtyBinding {
                            terminal_id: pane.id.clone(),
                            process_id: None,
                            cols: item.cols,
                            rows: item.rows,
                        });
                    }
                }
            }
        }
    }
    graph
        .validate()
        .map_err(|err| ApiError::Internal(err.to_string()))
}

fn map_mux_err(workspace_id: &str, err: MuxManagerError) -> ApiError {
    match err {
        MuxManagerError::GraphNotFound(_) => ApiError::NotFound(workspace_id.to_string()),
        MuxManagerError::PaneNotFound(id) => ApiError::NotFound(id),
        other => ApiError::BadRequest(other.to_string()),
    }
}

fn graph_has_pane(graph: &MuxGraph, pane_id: &str) -> bool {
    graph.workspaces.values().any(|workspace| {
        workspace.windows.values().any(|window| {
            window
                .tabs
                .values()
                .any(|tab| tab.panes.contains_key(pane_id))
        })
    })
}

fn persist_mux_graph(state: &ApiState, graph: &MuxGraph) -> ApiResult<()> {
    if let Some(store) = &state.mux_store {
        store
            .save_graph(graph)
            .map_err(|err| ApiError::Internal(err.to_string()))?;
    }
    Ok(())
}

pub(super) fn delete_graph_snapshot(state: &ApiState, workspace_id: &str) -> ApiResult<()> {
    if let Some(store) = &state.mux_store {
        store
            .delete_graph(workspace_id)
            .map_err(|err| ApiError::Internal(err.to_string()))?;
    }
    Ok(())
}

fn close_mux_pty_ids(state: &ApiState, terminal_ids: Vec<String>) -> ApiResult<()> {
    for terminal_id in terminal_ids {
        match state.pty.close(&terminal_id) {
            Ok(()) | Err(PtyError::NotFound(_)) => {}
            Err(err) => return Err(ApiError::Internal(err.to_string())),
        }
    }
    Ok(())
}

pub(super) fn workspace_summary(graph: &MuxGraph) -> MuxWorkspaceSummary {
    let mut window_count = 0;
    let mut tab_count = 0;
    let mut pane_count = 0;
    for workspace in graph.workspaces.values() {
        window_count += workspace.windows.len();
        for window in workspace.windows.values() {
            tab_count += window.tabs.len();
            for tab in window.tabs.values() {
                pane_count += tab.panes.len();
            }
        }
    }
    MuxWorkspaceSummary {
        id: graph.active_workspace_id.clone(),
        active: true,
        window_count,
        tab_count,
        pane_count,
    }
}

pub(super) fn send_workspace_input(
    state: &ApiState,
    workspace_id: &str,
    bytes: &[u8],
) -> ApiResult<serde_json::Value> {
    if bytes.len() > WS_MAX_INPUT_FRAME_BYTES {
        return Err(ApiError::BadRequest(format!(
            "input frame exceeds {} bytes",
            WS_MAX_INPUT_FRAME_BYTES
        )));
    }
    let graph = {
        let mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.graph(workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.to_string()))?
    };
    let targets = collect_live_pty_ids(&graph);
    if targets.is_empty() {
        return Err(ApiError::BadRequest(
            "mux workspace has no live PTY targets".to_string(),
        ));
    }

    let mut accepted = 0usize;
    let mut failed = 0usize;
    let mut last_error: Option<String> = None;
    for terminal_id in &targets {
        if !state.pty.contains(terminal_id) {
            failed += 1;
            last_error = Some(format!("terminal not live: {terminal_id}"));
            continue;
        }
        match state.pty.write(terminal_id, bytes) {
            Ok(()) => accepted += 1,
            Err(err) => {
                failed += 1;
                last_error = Some(err);
            }
        }
    }
    if accepted == 0 {
        return Err(ApiError::BadRequest(last_error.unwrap_or_else(|| {
            "mux workspace input was not accepted by any pane".to_string()
        })));
    }
    Ok(serde_json::json!({
        "workspaceId": workspace_id,
        "targets": targets.len(),
        "accepted": accepted,
        "failed": failed,
    }))
}

async fn list_mux_workspaces(
    State(state): State<ApiState>,
) -> ApiResult<Json<Vec<MuxWorkspaceSummary>>> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let mut summaries = mux
        .workspace_ids()
        .into_iter()
        .filter_map(|id| mux.graph(&id).map(workspace_summary))
        .collect::<Vec<_>>();
    summaries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Json(summaries))
}

async fn get_mux_workspace(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<MuxGraph>> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let graph = mux
        .graph(&id)
        .cloned()
        .ok_or_else(|| ApiError::NotFound(id.clone()))?;
    Ok(Json(graph))
}

async fn export_mux_workspace(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<VersionedMuxSnapshot>> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let graph = mux
        .graph(&id)
        .cloned()
        .ok_or_else(|| ApiError::NotFound(id.clone()))?;
    let snapshot =
        VersionedMuxSnapshot::new(graph).map_err(|err| ApiError::Internal(err.to_string()))?;
    Ok(Json(snapshot))
}

async fn import_mux_workspace(
    State(state): State<ApiState>,
    Query(query): Query<ImportMuxWorkspaceQuery>,
    Json(snapshot): Json<VersionedMuxSnapshot>,
) -> ApiResult<Json<MuxGraph>> {
    if snapshot.schema != format!("aether.mux.v{MUX_GRAPH_VERSION}") {
        return Err(ApiError::BadRequest(format!(
            "unsupported mux snapshot schema: {}",
            snapshot.schema
        )));
    }

    let graph = graph_for_snapshot_restore(snapshot.graph)
        .map_err(|err| ApiError::BadRequest(err.to_string()))?;
    let workspace_id = graph.active_workspace_id.clone();
    let replaced_live_pty_ids = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        let existing = mux.graph(&workspace_id).cloned();
        if existing.is_some() && !query.replace {
            return Err(ApiError::Conflict(format!(
                "mux workspace already exists: {workspace_id}; pass replace=true to overwrite"
            )));
        }
        let replaced_live_pty_ids = existing
            .as_ref()
            .map(collect_live_pty_ids)
            .unwrap_or_default();
        mux.upsert_graph(graph.clone())
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        replaced_live_pty_ids
    };

    close_mux_pty_ids(&state, replaced_live_pty_ids)?;
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn detach_mux_workspace(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
) -> ApiResult<Json<MuxGraph>> {
    let _create_guard = state.create_lock.lock().await;
    let mut graph = {
        let mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };

    mark_mux_graph_detached(&mut graph)?;

    {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.upsert_graph(graph.clone())
            .map_err(|err| map_mux_err(&workspace_id, err))?;
    }
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn attach_mux_workspace(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
) -> ApiResult<Json<MuxGraph>> {
    let _create_guard = state.create_lock.lock().await;
    let mut graph = {
        let mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    let plan = collect_mux_attach_plan(&state, &graph)?;
    let active_count = state.pty.list_info().len();
    if active_count + plan.len() > state.max_sessions {
        return Err(ApiError::BadRequest(format!(
            "session limit reached ({})",
            state.max_sessions
        )));
    }

    let mut spawned_ids: Vec<String> = Vec::new();
    for item in &plan {
        if let Err(err) = state.pty.spawn_with_id(
            &item.pane_id,
            &item.shell,
            item.cols,
            item.rows,
            Some(&item.cwd),
        ) {
            for spawned_id in spawned_ids {
                let _ = state.pty.close(&spawned_id);
            }
            return Err(ApiError::Internal(err));
        }
        if !state.pty.reap_child_on_exit(&item.pane_id) {
            log::warn!(
                "api: mux attach PTY {} was created without an exit reaper",
                item.pane_id
            );
        }
        spawned_ids.push(item.pane_id.clone());
    }

    mark_mux_graph_attached(&mut graph, &plan)?;
    {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.upsert_graph(graph.clone())
            .map_err(|err| map_mux_err(&workspace_id, err))?;
    }
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn broadcast_mux_workspace_input(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<InputBody>,
) -> ApiResult<Json<MuxBroadcastResponse>> {
    let result = send_workspace_input(&state, &workspace_id, body.text.as_bytes())?;
    Ok(Json(MuxBroadcastResponse {
        workspace_id,
        targets: result["targets"].as_u64().unwrap_or_default() as usize,
        accepted: result["accepted"].as_u64().unwrap_or_default() as usize,
        failed: result["failed"].as_u64().unwrap_or_default() as usize,
    }))
}

async fn split_mux_pane(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<SplitMuxPaneBody>,
) -> ApiResult<Json<CreateSessionResponse>> {
    let shell = parse_shell(body.shell.as_deref().unwrap_or("powershell"))?;
    let cols = body.cols.unwrap_or_else(default_cols);
    let rows = body.rows.unwrap_or_else(default_rows);
    if cols == 0 || rows == 0 {
        return Err(ApiError::BadRequest("cols and rows must be > 0".into()));
    }
    let cwd = normalize_api_cwd(body.cwd)?;
    let pane_id = if let Some(id) = body.id.as_deref() {
        validate_session_id(id)?;
        id.to_string()
    } else {
        uuid::Uuid::new_v4().to_string()
    };

    let _create_guard = state.create_lock.lock().await;
    if state.pty.list_info().len() >= state.max_sessions {
        return Err(ApiError::BadRequest(format!(
            "session limit reached ({})",
            state.max_sessions
        )));
    }

    state
        .pty
        .spawn_with_id(&pane_id, &shell, cols, rows, cwd.as_deref())
        .map_err(ApiError::Internal)?;
    if !state.pty.reap_child_on_exit(&pane_id) {
        log::warn!(
            "api: mux split PTY {} was created without an exit reaper",
            pane_id
        );
    }

    let shell_name = format!("{:?}", shell).to_lowercase();
    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(&shell_name);
    let cwd_for_graph = cwd.unwrap_or_else(|| {
        std::env::current_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string())
    });
    let mut pane = PaneRecord::new(&pane_id, title, &shell_name, &cwd_for_graph);
    pane.lifecycle = LifecycleState::Active;
    pane.pty = Some(PtyBinding {
        terminal_id: pane_id.clone(),
        process_id: None,
        cols,
        rows,
    });

    let split_result = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.split_active_pane(&workspace_id, &body.target_pane_id, pane, body.axis)
            .map_err(|err| map_mux_err(&workspace_id, err))
            .and_then(|_| {
                mux.graph(&workspace_id)
                    .cloned()
                    .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))
            })
    };

    match split_result {
        Ok(graph) => persist_mux_graph(&state, &graph)?,
        Err(err) => {
            let _ = state.pty.close(&pane_id);
            return Err(err);
        }
    }

    Ok(Json(CreateSessionResponse { id: pane_id }))
}

async fn close_mux_pane(
    State(state): State<ApiState>,
    Path((workspace_id, pane_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    let (removed, graph) = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        let removed = mux
            .close_active_pane(&workspace_id, &pane_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        let graph = mux
            .graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?;
        (removed, graph)
    };
    persist_mux_graph(&state, &graph)?;
    if let Some(pty) = removed.pty {
        match state.pty.close(&pty.terminal_id) {
            Ok(()) | Err(PtyError::NotFound(_)) => {}
            Err(err) => return Err(ApiError::Internal(err.to_string())),
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn swap_mux_panes(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<SwapMuxPanesBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.swap_active_panes(&workspace_id, &body.first_pane_id, &body.second_pane_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn move_mux_pane(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<MoveMuxPaneBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.move_active_pane_next_to(
            &workspace_id,
            &body.source_pane_id,
            &body.target_pane_id,
            body.axis,
        )
        .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn break_mux_pane(
    State(state): State<ApiState>,
    Path((workspace_id, pane_id)): Path<(String, String)>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.break_active_pane_to_new_tab(&workspace_id, &pane_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn join_mux_pane(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<JoinMuxPaneBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.join_pane_into_active_tab(
            &workspace_id,
            &body.source_pane_id,
            &body.target_pane_id,
            body.axis,
        )
        .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn set_mux_panes_synchronized(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<SynchronizePanesBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.set_active_tab_synchronized_panes(&workspace_id, body.enabled)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn set_mux_pane_zoom(
    State(state): State<ApiState>,
    Path((workspace_id, pane_id)): Path<(String, String)>,
    Json(body): Json<ZoomMuxPaneBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        let pane_id = if body.zoomed {
            Some(pane_id.clone())
        } else {
            None
        };
        mux.set_active_tab_zoom(&workspace_id, pane_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn apply_mux_even_layout(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<EvenLayoutBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.apply_even_to_active_tab(&workspace_id, body.axis)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn equalize_mux_layout(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.equalize_active_tab(&workspace_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn apply_mux_tiled_layout(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.apply_tiled_to_active_tab(&workspace_id)
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}

async fn rotate_mux_layout(
    State(state): State<ApiState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<RotateLayoutBody>,
) -> ApiResult<Json<MuxGraph>> {
    let graph = {
        let mut mux = state
            .mux
            .lock()
            .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
        mux.rotate_active_tab(&workspace_id, body.direction.is_reverse())
            .map_err(|err| map_mux_err(&workspace_id, err))?;
        mux.graph(&workspace_id)
            .cloned()
            .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?
    };
    persist_mux_graph(&state, &graph)?;
    Ok(Json(graph))
}
