use std::collections::BTreeMap;

use serde::Serialize;

use crate::mux::graph::{
    LifecycleState, MuxGraph, PaneRecord, TabRecord, WindowRecord, WorkspaceRecord,
};
use crate::mux::layout::TabLayout;

use super::super::{ApiError, ApiResult, ApiState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
enum PaneLifecycleProjection {
    Active,
    Detached,
    Exited { code: Option<i32> },
    Dead,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyBindingProjection {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneProjection {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    lifecycle: PaneLifecycleProjection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pty: Option<PtyBindingProjection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabProjection {
    id: String,
    layout: TabLayout,
    panes: BTreeMap<String, PaneProjection>,
    synchronized_panes: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowProjection {
    id: String,
    tabs: BTreeMap<String, TabProjection>,
    active_tab_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProjection {
    id: String,
    windows: BTreeMap<String, WindowProjection>,
    active_window_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphProjection {
    version: u32,
    workspaces: BTreeMap<String, WorkspaceProjection>,
    active_workspace_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummaryProjection {
    id: String,
    active: bool,
    window_count: usize,
    tab_count: usize,
    pane_count: usize,
}

fn project_lifecycle(lifecycle: &LifecycleState) -> PaneLifecycleProjection {
    match lifecycle {
        LifecycleState::Active => PaneLifecycleProjection::Active,
        LifecycleState::Detached => PaneLifecycleProjection::Detached,
        LifecycleState::Exited { code } => PaneLifecycleProjection::Exited { code: *code },
        LifecycleState::Dead { .. } => PaneLifecycleProjection::Dead,
    }
}

fn project_pane(pane: &PaneRecord) -> PaneProjection {
    PaneProjection {
        id: pane.id.clone(),
        role: pane.role.clone(),
        lifecycle: project_lifecycle(&pane.lifecycle),
        pty: pane.pty.as_ref().map(|pty| PtyBindingProjection {
            terminal_id: pty.terminal_id.clone(),
            cols: pty.cols,
            rows: pty.rows,
        }),
    }
}

fn project_tab(tab: &TabRecord) -> TabProjection {
    TabProjection {
        id: tab.id.clone(),
        layout: tab.layout.clone(),
        panes: tab
            .panes
            .values()
            .map(|pane| (pane.id.clone(), project_pane(pane)))
            .collect(),
        synchronized_panes: tab.synchronized_panes,
    }
}

fn project_window(window: &WindowRecord) -> WindowProjection {
    WindowProjection {
        id: window.id.clone(),
        tabs: window
            .tabs
            .values()
            .map(|tab| (tab.id.clone(), project_tab(tab)))
            .collect(),
        active_tab_id: window.active_tab_id.clone(),
    }
}

fn project_workspace(workspace: &WorkspaceRecord) -> WorkspaceProjection {
    WorkspaceProjection {
        id: workspace.id.clone(),
        windows: workspace
            .windows
            .values()
            .map(|window| (window.id.clone(), project_window(window)))
            .collect(),
        active_window_id: workspace.active_window_id.clone(),
    }
}

fn workspace_summary(graph: &MuxGraph) -> WorkspaceSummaryProjection {
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
    WorkspaceSummaryProjection {
        id: graph.active_workspace_id.clone(),
        active: true,
        window_count,
        tab_count,
        pane_count,
    }
}

fn exposure_metadata() -> serde_json::Value {
    serde_json::json!({
        "filesystemPathsExposed": false,
        "titlesExposed": false,
        "processIdentityExposed": false,
        "clientRecordsExposed": false,
        "projectMetadataExposed": false,
        "agentMetadataExposed": false,
        "readOnly": true,
    })
}

pub(super) fn project_list(mut graphs: Vec<&MuxGraph>) -> serde_json::Value {
    graphs.sort_by(|left, right| left.active_workspace_id.cmp(&right.active_workspace_id));
    let workspaces = graphs
        .into_iter()
        .map(workspace_summary)
        .collect::<Vec<_>>();
    let mut result = serde_json::json!({
        "source": "rust-mux-manager",
        "workspaceCount": workspaces.len(),
        "workspaces": workspaces,
        "exactWorkspaceIdentityReturned": true,
    });
    result
        .as_object_mut()
        .expect("mux list projection is an object")
        .extend(
            exposure_metadata()
                .as_object()
                .expect("exposure metadata is an object")
                .clone(),
        );
    result
}

pub(super) fn project_graph(graph: &MuxGraph) -> serde_json::Value {
    let projection = GraphProjection {
        version: graph.version,
        workspaces: graph
            .workspaces
            .values()
            .map(|workspace| (workspace.id.clone(), project_workspace(workspace)))
            .collect(),
        active_workspace_id: graph.active_workspace_id.clone(),
    };
    let mut result = serde_json::json!({
        "workspaceId": graph.active_workspace_id,
        "graph": projection,
        "source": "rust-mux-manager",
        "exactTopologyReturned": true,
        "exactTerminalBindingReturned": true,
    });
    result
        .as_object_mut()
        .expect("mux graph projection is an object")
        .extend(
            exposure_metadata()
                .as_object()
                .expect("exposure metadata is an object")
                .clone(),
        );
    result
}

pub(super) fn list(state: &ApiState) -> ApiResult<serde_json::Value> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let graphs = mux
        .workspace_ids()
        .into_iter()
        .filter_map(|id| mux.graph(&id))
        .collect::<Vec<_>>();
    Ok(project_list(graphs))
}

pub(super) fn get(state: &ApiState, workspace_id: &str) -> ApiResult<serde_json::Value> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let graph = mux
        .graph(workspace_id)
        .ok_or_else(|| ApiError::NotFound(workspace_id.to_string()))?;
    Ok(project_graph(graph))
}
