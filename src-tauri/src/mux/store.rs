use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::queries::{Pane, RestoredSession};

use super::graph::{
    graph_from_single_pane, LifecycleState, MuxGraph, MuxGraphError, PaneRecord, PtyBinding,
    TabRecord, WindowRecord, MUX_GRAPH_VERSION,
};
use super::layout::SplitAxis;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedMuxSnapshot {
    pub schema: String,
    pub graph: MuxGraph,
}

impl VersionedMuxSnapshot {
    pub fn new(graph: MuxGraph) -> Result<Self, MuxStoreError> {
        graph.validate()?;
        Ok(Self {
            schema: format!("aether.mux.v{MUX_GRAPH_VERSION}"),
            graph,
        })
    }

    pub fn to_json(&self) -> Result<String, MuxStoreError> {
        serde_json::to_string(self).map_err(MuxStoreError::Serde)
    }

    pub fn from_json(json: &str) -> Result<Self, MuxStoreError> {
        let snapshot: Self = serde_json::from_str(json).map_err(MuxStoreError::Serde)?;
        if snapshot.schema != format!("aether.mux.v{MUX_GRAPH_VERSION}") {
            return Err(MuxStoreError::UnsupportedSchema(snapshot.schema));
        }
        snapshot.graph.validate()?;
        Ok(snapshot)
    }
}

#[derive(Debug, Clone)]
pub struct FileMuxSnapshotStore {
    root: PathBuf,
}

impl FileMuxSnapshotStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn save_graph(&self, graph: &MuxGraph) -> Result<PathBuf, MuxStoreError> {
        let snapshot = VersionedMuxSnapshot::new(graph.clone())?;
        fs::create_dir_all(&self.root).map_err(MuxStoreError::Io)?;
        let path = self.snapshot_path(&graph.active_workspace_id);
        let tmp_path = self.tmp_snapshot_path(&graph.active_workspace_id);
        fs::write(&tmp_path, snapshot.to_json()?).map_err(MuxStoreError::Io)?;
        fs::rename(&tmp_path, &path).map_err(|err| {
            let _ = fs::remove_file(&tmp_path);
            MuxStoreError::Io(err)
        })?;
        Ok(path)
    }

    pub fn load_graph(&self, workspace_id: &str) -> Result<MuxGraph, MuxStoreError> {
        let text =
            fs::read_to_string(self.snapshot_path(workspace_id)).map_err(MuxStoreError::Io)?;
        Ok(VersionedMuxSnapshot::from_json(&text)?.graph)
    }

    pub fn load_all_graphs(&self) -> Result<Vec<MuxGraph>, MuxStoreError> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut graphs = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(MuxStoreError::Io)? {
            let entry = entry.map_err(MuxStoreError::Io)?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let text = fs::read_to_string(&path).map_err(MuxStoreError::Io)?;
            graphs.push(VersionedMuxSnapshot::from_json(&text)?.graph);
        }
        graphs.sort_by(|a, b| a.active_workspace_id.cmp(&b.active_workspace_id));
        Ok(graphs)
    }

    pub fn delete_graph(&self, workspace_id: &str) -> Result<(), MuxStoreError> {
        let path = self.snapshot_path(workspace_id);
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(MuxStoreError::Io(err)),
        }
    }

    fn snapshot_path(&self, workspace_id: &str) -> PathBuf {
        self.root
            .join(format!("{}.json", encode_workspace_id(workspace_id)))
    }

    fn tmp_snapshot_path(&self, workspace_id: &str) -> PathBuf {
        self.root.join(format!(
            "{}.{}.tmp",
            encode_workspace_id(workspace_id),
            std::process::id()
        ))
    }
}

fn encode_workspace_id(workspace_id: &str) -> String {
    let mut encoded = String::new();
    for byte in workspace_id.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    if encoded.is_empty() {
        "%00".to_string()
    } else {
        encoded
    }
}

pub fn restored_session_to_mux_graph(
    restored: &RestoredSession,
) -> Result<MuxGraph, MuxStoreError> {
    let first_window = restored.windows.first().ok_or(MuxStoreError::NoWindows)?;
    let first_pane = first_window.panes.first().ok_or(MuxStoreError::NoPanes {
        window_id: first_window.window.id.clone(),
    })?;

    let first_record = db_pane_to_record(first_pane);
    let mut graph = graph_from_single_pane(
        restored.session.id.clone(),
        restored.session.name.clone(),
        first_window.window.id.clone(),
        format!("{}:tab", first_window.window.id),
        first_record,
    );

    {
        let workspace = graph
            .workspaces
            .get_mut(&graph.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        workspace.windows.clear();
        workspace.active_window_id = first_window.window.id.clone();

        for restored_window in &restored.windows {
            let tab = tab_from_window_panes(
                &restored_window.window.id,
                &restored_window.window.title,
                &restored_window.panes,
                axis_from_layout_type(&restored_window.window.layout_type),
            )?;
            let window = WindowRecord::new(
                restored_window.window.id.clone(),
                restored_window.window.title.clone(),
                tab,
            );
            workspace.windows.insert(window.id.clone(), window);
        }
    }

    graph.validate()?;
    Ok(graph)
}

pub fn graph_for_snapshot_restore(mut graph: MuxGraph) -> Result<MuxGraph, MuxStoreError> {
    for workspace in graph.workspaces.values_mut() {
        workspace.clients.clear();
        for window in workspace.windows.values_mut() {
            for tab in window.tabs.values_mut() {
                for pane in tab.panes.values_mut() {
                    pane.lifecycle = LifecycleState::Detached;
                    if let Some(pty) = pane.pty.as_mut() {
                        pty.terminal_id = format!("restore-pending:{}", pane.id);
                        pty.process_id = None;
                    }
                }
            }
        }
    }
    graph.validate()?;
    Ok(graph)
}

fn tab_from_window_panes(
    window_id: &str,
    title: &str,
    panes: &[Pane],
    axis: SplitAxis,
) -> Result<TabRecord, MuxStoreError> {
    let first = panes.first().ok_or_else(|| MuxStoreError::NoPanes {
        window_id: window_id.to_string(),
    })?;
    let mut tab = TabRecord::new(
        format!("{window_id}:tab"),
        title.to_string(),
        db_pane_to_record(first),
    );
    for pane in panes.iter().skip(1) {
        tab.split_pane(
            &tab.layout.active_pane_id.clone(),
            db_pane_to_record(pane),
            axis,
        )?;
    }
    Ok(tab)
}

fn db_pane_to_record(pane: &Pane) -> PaneRecord {
    let mut record = PaneRecord::new(
        pane.id.clone(),
        pane.shell_type.clone(),
        pane.shell_type.clone(),
        pane.cwd.clone(),
    );
    record.lifecycle = LifecycleState::Detached;
    record.pty = Some(PtyBinding {
        terminal_id: format!("restore-pending:{}", pane.id),
        process_id: None,
        cols: pane.cols,
        rows: pane.rows,
    });
    record
}

fn axis_from_layout_type(layout_type: &str) -> SplitAxis {
    match layout_type {
        "vsplit" | "vertical" => SplitAxis::Vertical,
        _ => SplitAxis::Horizontal,
    }
}

#[derive(Debug)]
pub enum MuxStoreError {
    Graph(MuxGraphError),
    Io(std::io::Error),
    NoPanes { window_id: String },
    NoWindows,
    Serde(serde_json::Error),
    UnsupportedSchema(String),
}

impl std::fmt::Display for MuxStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Graph(err) => write!(f, "{err}"),
            Self::Io(err) => write!(f, "mux snapshot I/O error: {err}"),
            Self::NoPanes { window_id } => write!(f, "window has no panes: {window_id}"),
            Self::NoWindows => write!(f, "restored session has no windows"),
            Self::Serde(err) => write!(f, "mux snapshot JSON error: {err}"),
            Self::UnsupportedSchema(schema) => {
                write!(f, "unsupported mux snapshot schema: {schema}")
            }
        }
    }
}

impl std::error::Error for MuxStoreError {}

impl From<MuxGraphError> for MuxStoreError {
    fn from(value: MuxGraphError) -> Self {
        Self::Graph(value)
    }
}

impl From<std::io::Error> for MuxStoreError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

#[cfg(test)]
mod tests {
    use crate::db::queries::{RestoredWindow, Session, Window};
    use crate::mux::graph::{MuxClientMode, MuxClientRecord};

    use super::*;

    fn restored() -> RestoredSession {
        RestoredSession {
            session: Session {
                id: "session-a".to_string(),
                name: "Aether".to_string(),
                created_at: "now".to_string(),
                updated_at: "now".to_string(),
                is_active: true,
            },
            windows: vec![RestoredWindow {
                window: Window {
                    id: "window-a".to_string(),
                    session_id: "session-a".to_string(),
                    title: "main".to_string(),
                    sort_order: 0,
                    layout_type: "vsplit".to_string(),
                },
                panes: vec![
                    Pane {
                        id: "pane-a".to_string(),
                        window_id: "window-a".to_string(),
                        shell_type: "powershell".to_string(),
                        cwd: "C:/repo".to_string(),
                        cols: 80,
                        rows: 24,
                        flex_basis: 0.5,
                        position: "first".to_string(),
                    },
                    Pane {
                        id: "pane-b".to_string(),
                        window_id: "window-a".to_string(),
                        shell_type: "cmd".to_string(),
                        cwd: "C:/repo".to_string(),
                        cols: 80,
                        rows: 24,
                        flex_basis: 0.5,
                        position: "second".to_string(),
                    },
                ],
            }],
        }
    }

    #[test]
    fn restored_session_converts_to_valid_mux_graph() {
        let graph = restored_session_to_mux_graph(&restored()).unwrap();
        graph.validate().unwrap();

        let workspace = graph.workspaces.get("session-a").unwrap();
        let window = workspace.windows.get("window-a").unwrap();
        let tab = window.tabs.get("window-a:tab").unwrap();
        assert_eq!(tab.layout.pane_ids(), vec!["pane-a", "pane-b"]);
        assert_eq!(tab.layout.active_pane_id, "pane-b");
    }

    #[test]
    fn versioned_snapshot_rejects_bad_schema_and_bad_graph() {
        let graph = restored_session_to_mux_graph(&restored()).unwrap();
        let json = VersionedMuxSnapshot::new(graph).unwrap().to_json().unwrap();
        VersionedMuxSnapshot::from_json(&json).unwrap();

        let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
        value["schema"] = serde_json::Value::String("aether.mux.v999".to_string());
        let err = VersionedMuxSnapshot::from_json(&value.to_string()).unwrap_err();
        assert!(matches!(err, MuxStoreError::UnsupportedSchema(_)));
    }

    #[test]
    fn restored_session_without_panes_is_not_silently_accepted() {
        let mut restored = restored();
        restored.windows[0].panes.clear();
        let err = restored_session_to_mux_graph(&restored).unwrap_err();
        assert!(matches!(err, MuxStoreError::NoPanes { .. }));
    }

    #[test]
    fn file_snapshot_store_saves_loads_and_deletes_atomically_named_graphs() {
        let temp = tempfile::tempdir().unwrap();
        let store = FileMuxSnapshotStore::new(temp.path());
        let graph = restored_session_to_mux_graph(&restored()).unwrap();

        let path = store.save_graph(&graph).unwrap();
        assert!(path.exists());
        assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("json"));

        let loaded = store.load_graph("session-a").unwrap();
        assert_eq!(loaded, graph);

        let all = store.load_all_graphs().unwrap();
        assert_eq!(all, vec![graph]);

        store.delete_graph("session-a").unwrap();
        assert!(!path.exists());
        store.delete_graph("session-a").unwrap();
    }

    #[test]
    fn file_snapshot_store_escapes_workspace_ids_for_paths() {
        let temp = tempfile::tempdir().unwrap();
        let store = FileMuxSnapshotStore::new(temp.path());
        let mut graph = restored_session_to_mux_graph(&restored()).unwrap();
        graph.active_workspace_id = "workspace:with/slash".to_string();
        let workspace = graph.workspaces.remove("session-a").unwrap();
        let mut workspace = workspace;
        workspace.id = graph.active_workspace_id.clone();
        graph
            .workspaces
            .insert(graph.active_workspace_id.clone(), workspace);

        let path = store.save_graph(&graph).unwrap();
        assert!(path.file_name().unwrap().to_string_lossy().contains("%3A"));
        assert!(path.file_name().unwrap().to_string_lossy().contains("%2F"));
        assert_eq!(store.load_graph("workspace:with/slash").unwrap(), graph);
    }

    #[test]
    fn snapshot_restore_marks_live_pty_bindings_detached() {
        let mut graph = restored_session_to_mux_graph(&restored()).unwrap();
        let pane = graph
            .workspaces
            .get_mut("session-a")
            .unwrap()
            .windows
            .get_mut("window-a")
            .unwrap()
            .tabs
            .get_mut("window-a:tab")
            .unwrap()
            .panes
            .get_mut("pane-a")
            .unwrap();
        pane.lifecycle = LifecycleState::Active;
        pane.pty.as_mut().unwrap().terminal_id = "live-pty-id".to_string();
        pane.pty.as_mut().unwrap().process_id = Some(123);

        let restored = graph_for_snapshot_restore(graph).unwrap();
        let pane = restored
            .workspaces
            .get("session-a")
            .unwrap()
            .windows
            .get("window-a")
            .unwrap()
            .tabs
            .get("window-a:tab")
            .unwrap()
            .panes
            .get("pane-a")
            .unwrap();
        assert_eq!(pane.lifecycle, LifecycleState::Detached);
        assert_eq!(
            pane.pty.as_ref().unwrap().terminal_id,
            "restore-pending:pane-a"
        );
        assert_eq!(pane.pty.as_ref().unwrap().process_id, None);
    }

    #[test]
    fn snapshot_restore_drops_live_client_records() {
        let mut graph = restored_session_to_mux_graph(&restored()).unwrap();
        graph
            .workspaces
            .get_mut("session-a")
            .unwrap()
            .clients
            .insert(
                "client-a".to_string(),
                MuxClientRecord::new(
                    "client-a",
                    "session-a",
                    "window-a",
                    MuxClientMode::ReadOnly,
                    1,
                ),
            );
        graph.validate().unwrap();

        let restored = graph_for_snapshot_restore(graph).unwrap();
        assert!(restored
            .workspaces
            .get("session-a")
            .unwrap()
            .clients
            .is_empty());
    }
}
