use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::layout::{LayoutError, LayoutNode, SplitAxis, TabLayout};

pub const MUX_GRAPH_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleState {
    Active,
    Detached,
    Exited { code: Option<i32> },
    Dead { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyBinding {
    pub terminal_id: String,
    pub process_id: Option<u32>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    pub project_path: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub task_id: Option<String>,
    pub workflow_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    pub agent_id: String,
    pub provider: String,
    pub role: Option<String>,
    pub permission_profile: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MuxClientMode {
    ReadWrite,
    ReadOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxClientRecord {
    pub id: String,
    pub attached_workspace_id: String,
    pub attached_window_id: String,
    pub mode: MuxClientMode,
    pub last_seen_at_ms: u64,
}

impl MuxClientRecord {
    pub fn new(
        id: impl Into<String>,
        attached_workspace_id: impl Into<String>,
        attached_window_id: impl Into<String>,
        mode: MuxClientMode,
        last_seen_at_ms: u64,
    ) -> Self {
        Self {
            id: id.into(),
            attached_workspace_id: attached_workspace_id.into(),
            attached_window_id: attached_window_id.into(),
            mode,
            last_seen_at_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneRecord {
    pub id: String,
    pub title: String,
    pub shell: String,
    pub cwd: String,
    pub role: Option<String>,
    pub lifecycle: LifecycleState,
    pub pty: Option<PtyBinding>,
    pub project: Option<ProjectContext>,
    pub agent: Option<AgentContext>,
}

impl PaneRecord {
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        shell: impl Into<String>,
        cwd: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            shell: shell.into(),
            cwd: cwd.into(),
            role: None,
            lifecycle: LifecycleState::Detached,
            pty: None,
            project: None,
            agent: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRecord {
    pub id: String,
    pub title: String,
    pub layout: TabLayout,
    pub panes: HashMap<String, PaneRecord>,
    #[serde(default)]
    pub synchronized_panes: bool,
}

impl TabRecord {
    pub fn new(id: impl Into<String>, title: impl Into<String>, pane: PaneRecord) -> Self {
        let pane_id = pane.id.clone();
        Self {
            id: id.into(),
            title: title.into(),
            layout: TabLayout::single(pane_id.clone()),
            panes: HashMap::from([(pane_id, pane)]),
            synchronized_panes: false,
        }
    }

    pub fn validate(&self) -> Result<(), MuxGraphError> {
        validate_id(&self.id, "tab")?;
        self.layout.validate()?;
        let layout_ids: HashSet<_> = self.layout.pane_ids().into_iter().collect();
        let record_ids: HashSet<_> = self.panes.keys().cloned().collect();
        if layout_ids != record_ids {
            return Err(MuxGraphError::PaneRecordMismatch {
                tab_id: self.id.clone(),
                layout_only: layout_ids.difference(&record_ids).cloned().collect(),
                record_only: record_ids.difference(&layout_ids).cloned().collect(),
            });
        }
        for pane in self.panes.values() {
            validate_id(&pane.id, "pane")?;
            if pane.title.trim().is_empty() {
                return Err(MuxGraphError::InvalidTitle {
                    object: "pane".to_string(),
                    id: pane.id.clone(),
                });
            }
            if pane.cwd.trim().is_empty() {
                return Err(MuxGraphError::InvalidCwd(pane.id.clone()));
            }
        }
        Ok(())
    }

    pub fn split_pane(
        &mut self,
        target_pane_id: &str,
        pane: PaneRecord,
        axis: SplitAxis,
    ) -> Result<(), MuxGraphError> {
        let pane_id = pane.id.clone();
        if self.panes.contains_key(&pane_id) {
            return Err(MuxGraphError::DuplicateId(pane_id));
        }
        self.layout
            .split_pane(target_pane_id, pane_id.clone(), axis, 0.5, true)?;
        self.panes.insert(pane_id, pane);
        self.validate()
    }

    pub fn close_pane(&mut self, pane_id: &str) -> Result<PaneRecord, MuxGraphError> {
        self.layout.close_pane(pane_id)?;
        let removed = self
            .panes
            .remove(pane_id)
            .ok_or_else(|| MuxGraphError::MissingPaneRecord(pane_id.to_string()))?;
        self.validate()?;
        Ok(removed)
    }

    fn take_pane_for_join(&mut self, pane_id: &str) -> Result<PaneRecord, MuxGraphError> {
        if self.panes.len() <= 1 {
            return self
                .panes
                .remove(pane_id)
                .ok_or_else(|| MuxGraphError::MissingPaneRecord(pane_id.to_string()));
        }
        self.close_pane(pane_id)
    }

    pub fn swap_panes(
        &mut self,
        first_pane_id: &str,
        second_pane_id: &str,
    ) -> Result<(), MuxGraphError> {
        self.layout.swap_panes(first_pane_id, second_pane_id)?;
        self.validate()
    }

    pub fn move_pane_next_to(
        &mut self,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: SplitAxis,
    ) -> Result<(), MuxGraphError> {
        self.layout
            .move_pane_next_to(source_pane_id, target_pane_id, axis, true)?;
        self.validate()
    }

    pub fn apply_even(&mut self, axis: SplitAxis) -> Result<(), MuxGraphError> {
        self.layout.apply_even(axis)?;
        self.validate()
    }

    pub fn equalize_ratios(&mut self) -> Result<(), MuxGraphError> {
        self.layout.equalize_ratios()?;
        self.validate()
    }

    pub fn apply_tiled(&mut self) -> Result<(), MuxGraphError> {
        self.layout.apply_tiled()?;
        self.validate()
    }

    pub fn rotate_panes(&mut self, reverse: bool) -> Result<(), MuxGraphError> {
        self.layout.rotate_panes(reverse)?;
        self.validate()
    }

    pub fn set_zoomed_pane(&mut self, pane_id: Option<String>) -> Result<(), MuxGraphError> {
        self.layout.set_zoomed(pane_id)?;
        self.validate()
    }

    pub fn set_synchronized_panes(&mut self, enabled: bool) -> Result<(), MuxGraphError> {
        self.synchronized_panes = enabled;
        self.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRecord {
    pub id: String,
    pub title: String,
    pub tabs: HashMap<String, TabRecord>,
    pub active_tab_id: String,
}

impl WindowRecord {
    pub fn new(id: impl Into<String>, title: impl Into<String>, tab: TabRecord) -> Self {
        let tab_id = tab.id.clone();
        Self {
            id: id.into(),
            title: title.into(),
            tabs: HashMap::from([(tab_id.clone(), tab)]),
            active_tab_id: tab_id,
        }
    }

    pub fn validate(&self) -> Result<(), MuxGraphError> {
        validate_id(&self.id, "window")?;
        validate_title("window", &self.id, &self.title)?;
        validate_active_ref("tab", &self.active_tab_id, self.tabs.keys())?;
        for tab in self.tabs.values() {
            tab.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub project_path: Option<String>,
    pub windows: HashMap<String, WindowRecord>,
    pub active_window_id: String,
    #[serde(default)]
    pub clients: HashMap<String, MuxClientRecord>,
}

impl WorkspaceRecord {
    pub fn new(id: impl Into<String>, name: impl Into<String>, window: WindowRecord) -> Self {
        let window_id = window.id.clone();
        Self {
            id: id.into(),
            name: name.into(),
            project_path: None,
            windows: HashMap::from([(window_id.clone(), window)]),
            active_window_id: window_id,
            clients: HashMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), MuxGraphError> {
        validate_id(&self.id, "workspace")?;
        validate_title("workspace", &self.id, &self.name)?;
        validate_active_ref("window", &self.active_window_id, self.windows.keys())?;
        for window in self.windows.values() {
            window.validate()?;
        }
        for (client_id, client) in &self.clients {
            if client_id != &client.id {
                return Err(MuxGraphError::ClientRecordMismatch {
                    key: client_id.clone(),
                    record_id: client.id.clone(),
                });
            }
            client.validate(&self.id, self.windows.keys())?;
        }
        Ok(())
    }
}

impl MuxClientRecord {
    fn validate<'a, I>(&self, workspace_id: &str, window_ids: I) -> Result<(), MuxGraphError>
    where
        I: IntoIterator<Item = &'a String>,
    {
        validate_id(&self.id, "client")?;
        validate_id(&self.attached_workspace_id, "client workspace")?;
        validate_id(&self.attached_window_id, "client window")?;
        if self.attached_workspace_id != workspace_id {
            return Err(MuxGraphError::ClientWorkspaceMismatch {
                client_id: self.id.clone(),
                workspace_id: self.attached_workspace_id.clone(),
                expected_workspace_id: workspace_id.to_string(),
            });
        }
        if !window_ids
            .into_iter()
            .any(|window_id| window_id == &self.attached_window_id)
        {
            return Err(MuxGraphError::MissingWindow(
                self.attached_window_id.clone(),
            ));
        }
        if self.last_seen_at_ms == 0 {
            return Err(MuxGraphError::InvalidTimestamp {
                object: "client".to_string(),
                id: self.id.clone(),
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxGraph {
    pub version: u32,
    pub workspaces: HashMap<String, WorkspaceRecord>,
    pub active_workspace_id: String,
}

impl MuxGraph {
    pub fn new(workspace: WorkspaceRecord) -> Self {
        let workspace_id = workspace.id.clone();
        Self {
            version: MUX_GRAPH_VERSION,
            workspaces: HashMap::from([(workspace_id.clone(), workspace)]),
            active_workspace_id: workspace_id,
        }
    }

    pub fn validate(&self) -> Result<(), MuxGraphError> {
        if self.version != MUX_GRAPH_VERSION {
            return Err(MuxGraphError::UnsupportedVersion(self.version));
        }
        validate_active_ref(
            "workspace",
            &self.active_workspace_id,
            self.workspaces.keys(),
        )?;
        for workspace in self.workspaces.values() {
            workspace.validate()?;
        }
        Ok(())
    }

    pub fn active_tab_mut(&mut self) -> Result<&mut TabRecord, MuxGraphError> {
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        let window = workspace
            .windows
            .get_mut(&workspace.active_window_id)
            .ok_or_else(|| MuxGraphError::MissingActive("window".to_string()))?;
        window
            .tabs
            .get_mut(&window.active_tab_id)
            .ok_or_else(|| MuxGraphError::MissingActive("tab".to_string()))
    }

    pub fn create_window(&mut self, window: WindowRecord) -> Result<(), MuxGraphError> {
        window.validate()?;
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        if workspace.windows.contains_key(&window.id) {
            return Err(MuxGraphError::DuplicateId(window.id));
        }
        let window_id = window.id.clone();
        workspace.windows.insert(window_id.clone(), window);
        workspace.active_window_id = window_id;
        self.validate()
    }

    pub fn rename_window(
        &mut self,
        window_id: &str,
        title: impl Into<String>,
    ) -> Result<(), MuxGraphError> {
        let title = title.into();
        validate_title("window", window_id, &title)?;
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        let window = workspace
            .windows
            .get_mut(window_id)
            .ok_or_else(|| MuxGraphError::MissingWindow(window_id.to_string()))?;
        window.title = title;
        self.validate()
    }

    pub fn remove_window(&mut self, window_id: &str) -> Result<WindowRecord, MuxGraphError> {
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        if workspace.windows.len() <= 1 {
            return Err(MuxGraphError::CannotRemoveLastWindow);
        }
        let removed = workspace
            .windows
            .remove(window_id)
            .ok_or_else(|| MuxGraphError::MissingWindow(window_id.to_string()))?;
        workspace
            .clients
            .retain(|_, client| client.attached_window_id != window_id);
        if workspace.active_window_id == window_id {
            let mut remaining = workspace.windows.keys().cloned().collect::<Vec<_>>();
            remaining.sort();
            workspace.active_window_id = remaining
                .first()
                .cloned()
                .ok_or(MuxGraphError::CannotRemoveLastWindow)?;
        }
        self.validate()?;
        Ok(removed)
    }

    pub fn upsert_client(&mut self, client: MuxClientRecord) -> Result<(), MuxGraphError> {
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        client.validate(&workspace.id, workspace.windows.keys())?;
        workspace.clients.insert(client.id.clone(), client);
        self.validate()
    }

    pub fn remove_client(
        &mut self,
        client_id: &str,
    ) -> Result<Option<MuxClientRecord>, MuxGraphError> {
        validate_id(client_id, "client")?;
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        let removed = workspace.clients.remove(client_id);
        self.validate()?;
        Ok(removed)
    }

    pub fn break_active_pane_to_tab(
        &mut self,
        pane_id: &str,
        new_tab_id: impl Into<String>,
    ) -> Result<String, MuxGraphError> {
        let new_tab_id = new_tab_id.into();
        validate_id(&new_tab_id, "tab")?;
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        let window = workspace
            .windows
            .get_mut(&workspace.active_window_id)
            .ok_or_else(|| MuxGraphError::MissingActive("window".to_string()))?;
        if window.tabs.contains_key(&new_tab_id) {
            return Err(MuxGraphError::DuplicateId(new_tab_id));
        }
        let active_tab_id = window.active_tab_id.clone();
        let source_tab = window
            .tabs
            .get_mut(&active_tab_id)
            .ok_or_else(|| MuxGraphError::MissingActive("tab".to_string()))?;
        let pane = source_tab.close_pane(pane_id)?;
        let title = pane.title.clone();
        window
            .tabs
            .insert(new_tab_id.clone(), TabRecord::new(&new_tab_id, title, pane));
        window.active_tab_id = new_tab_id.clone();
        self.validate()?;
        Ok(new_tab_id)
    }

    pub fn join_pane_into_active_tab(
        &mut self,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: SplitAxis,
    ) -> Result<(), MuxGraphError> {
        if source_pane_id == target_pane_id {
            return Ok(());
        }
        let workspace = self
            .workspaces
            .get_mut(&self.active_workspace_id)
            .ok_or_else(|| MuxGraphError::MissingActive("workspace".to_string()))?;
        let window = workspace
            .windows
            .get_mut(&workspace.active_window_id)
            .ok_or_else(|| MuxGraphError::MissingActive("window".to_string()))?;
        let active_tab_id = window.active_tab_id.clone();
        let source_tab_id = window
            .tabs
            .iter()
            .find_map(|(tab_id, tab)| {
                if tab.panes.contains_key(source_pane_id) {
                    Some(tab_id.clone())
                } else {
                    None
                }
            })
            .ok_or_else(|| MuxGraphError::MissingPaneRecord(source_pane_id.to_string()))?;

        if source_tab_id == active_tab_id {
            let target_tab = window
                .tabs
                .get_mut(&active_tab_id)
                .ok_or_else(|| MuxGraphError::MissingActive("tab".to_string()))?;
            target_tab.move_pane_next_to(source_pane_id, target_pane_id, axis)?;
            self.validate()?;
            return Ok(());
        }

        let pane = {
            let source_tab = window
                .tabs
                .get_mut(&source_tab_id)
                .ok_or_else(|| MuxGraphError::MissingActive("tab".to_string()))?;
            let pane = source_tab.take_pane_for_join(source_pane_id)?;
            if source_tab.panes.is_empty() {
                window.tabs.remove(&source_tab_id);
            }
            pane
        };

        let target_tab = window
            .tabs
            .get_mut(&active_tab_id)
            .ok_or_else(|| MuxGraphError::MissingActive("tab".to_string()))?;
        target_tab.split_pane(target_pane_id, pane, axis)?;
        self.validate()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MuxGraphError {
    ClientRecordMismatch {
        key: String,
        record_id: String,
    },
    ClientWorkspaceMismatch {
        client_id: String,
        workspace_id: String,
        expected_workspace_id: String,
    },
    DuplicateId(String),
    InvalidCwd(String),
    InvalidId {
        object: String,
    },
    InvalidTimestamp {
        object: String,
        id: String,
    },
    InvalidTitle {
        object: String,
        id: String,
    },
    Layout(LayoutError),
    CannotRemoveLastWindow,
    MissingActive(String),
    MissingPaneRecord(String),
    MissingWindow(String),
    PaneRecordMismatch {
        tab_id: String,
        layout_only: Vec<String>,
        record_only: Vec<String>,
    },
    UnsupportedVersion(u32),
}

impl std::fmt::Display for MuxGraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClientRecordMismatch { key, record_id } => write!(
                f,
                "client record key does not match record id: key={key}, record_id={record_id}"
            ),
            Self::ClientWorkspaceMismatch {
                client_id,
                workspace_id,
                expected_workspace_id,
            } => write!(
                f,
                "client {client_id} is attached to workspace {workspace_id}, expected {expected_workspace_id}"
            ),
            Self::DuplicateId(id) => write!(f, "duplicate id: {id}"),
            Self::InvalidCwd(id) => write!(f, "pane cwd must not be empty: {id}"),
            Self::InvalidId { object } => write!(f, "{object} id must not be empty"),
            Self::InvalidTimestamp { object, id } => {
                write!(f, "{object} timestamp must be positive: {id}")
            }
            Self::InvalidTitle { object, id } => write!(f, "{object} title must not be empty: {id}"),
            Self::Layout(err) => write!(f, "layout error: {err}"),
            Self::CannotRemoveLastWindow => write!(f, "cannot remove the last mux window"),
            Self::MissingActive(object) => write!(f, "active {object} is missing"),
            Self::MissingPaneRecord(id) => write!(f, "pane record is missing: {id}"),
            Self::MissingWindow(id) => write!(f, "mux window is missing: {id}"),
            Self::PaneRecordMismatch {
                tab_id,
                layout_only,
                record_only,
            } => write!(
                f,
                "pane records do not match layout in tab {tab_id}: layout_only={layout_only:?}, record_only={record_only:?}"
            ),
            Self::UnsupportedVersion(version) => write!(f, "unsupported mux graph version: {version}"),
        }
    }
}

impl std::error::Error for MuxGraphError {}

impl From<LayoutError> for MuxGraphError {
    fn from(value: LayoutError) -> Self {
        Self::Layout(value)
    }
}

fn validate_id(id: &str, object: &str) -> Result<(), MuxGraphError> {
    if id.trim().is_empty() {
        Err(MuxGraphError::InvalidId {
            object: object.to_string(),
        })
    } else {
        Ok(())
    }
}

fn validate_active_ref<'a, I>(object: &str, active_id: &str, ids: I) -> Result<(), MuxGraphError>
where
    I: IntoIterator<Item = &'a String>,
{
    if ids.into_iter().any(|id| id == active_id) {
        Ok(())
    } else {
        Err(MuxGraphError::MissingActive(object.to_string()))
    }
}

fn validate_title(object: &str, id: &str, title: &str) -> Result<(), MuxGraphError> {
    if title.trim().is_empty() {
        Err(MuxGraphError::InvalidTitle {
            object: object.to_string(),
            id: id.to_string(),
        })
    } else {
        Ok(())
    }
}

pub fn graph_from_single_pane(
    workspace_id: impl Into<String>,
    workspace_name: impl Into<String>,
    window_id: impl Into<String>,
    tab_id: impl Into<String>,
    pane: PaneRecord,
) -> MuxGraph {
    let tab = TabRecord::new(tab_id, "main", pane);
    let window = WindowRecord::new(window_id, "main", tab);
    let workspace = WorkspaceRecord::new(workspace_id, workspace_name, window);
    MuxGraph::new(workspace)
}

#[allow(dead_code)]
fn _layout_node_keeps_serde_public_contract(_: LayoutNode) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_graph() -> MuxGraph {
        graph_from_single_pane(
            "workspace-a",
            "Aether",
            "window-a",
            "tab-a",
            PaneRecord::new("pane-a", "PowerShell", "powershell", "C:/repo"),
        )
    }

    #[test]
    fn single_pane_graph_validates_and_round_trips_json() {
        let graph = sample_graph();
        graph.validate().unwrap();

        let encoded = serde_json::to_string(&graph).unwrap();
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        let root = &value["workspaces"]["workspace-a"]["windows"]["window-a"]["tabs"]["tab-a"]
            ["layout"]["root"];
        assert_eq!(root["paneId"], "pane-a");
        assert!(root.get("pane_id").is_none());

        let decoded: MuxGraph = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, graph);
        decoded.validate().unwrap();

        let legacy_encoded = encoded.replace("\"paneId\"", "\"pane_id\"");
        let legacy_decoded: MuxGraph = serde_json::from_str(&legacy_encoded).unwrap();
        assert_eq!(legacy_decoded, graph);
    }

    #[test]
    fn legacy_graph_without_clients_defaults_to_empty_client_map() {
        let graph = sample_graph();
        let mut value = serde_json::to_value(&graph).unwrap();
        value["workspaces"]["workspace-a"]
            .as_object_mut()
            .unwrap()
            .remove("clients");
        let decoded: MuxGraph = serde_json::from_value(value).unwrap();
        let workspace = decoded.workspaces.get("workspace-a").unwrap();
        assert!(workspace.clients.is_empty());
        decoded.validate().unwrap();
    }

    #[test]
    fn tab_operations_keep_layout_and_records_in_sync() {
        let mut graph = sample_graph();
        let tab = graph.active_tab_mut().unwrap();

        tab.split_pane(
            "pane-a",
            PaneRecord::new("pane-b", "Agent", "powershell", "C:/repo"),
            SplitAxis::Horizontal,
        )
        .unwrap();
        tab.split_pane(
            "pane-b",
            PaneRecord::new("pane-c", "Tests", "cmd", "C:/repo"),
            SplitAxis::Vertical,
        )
        .unwrap();
        tab.swap_panes("pane-a", "pane-c").unwrap();
        tab.move_pane_next_to("pane-a", "pane-b", SplitAxis::Horizontal)
            .unwrap();
        tab.apply_tiled().unwrap();

        let mut layout_ids = tab.layout.pane_ids();
        layout_ids.sort();
        let mut record_ids = tab.panes.keys().cloned().collect::<Vec<_>>();
        record_ids.sort();
        assert_eq!(layout_ids, record_ids);

        let removed = tab.close_pane("pane-c").unwrap();
        assert_eq!(removed.id, "pane-c");
        graph.validate().unwrap();
    }

    #[test]
    fn break_and_join_pane_moves_records_between_tabs() {
        let mut graph = sample_graph();
        graph
            .active_tab_mut()
            .unwrap()
            .split_pane(
                "pane-a",
                PaneRecord::new("pane-b", "Agent", "powershell", "C:/repo"),
                SplitAxis::Horizontal,
            )
            .unwrap();

        let new_tab_id = graph
            .break_active_pane_to_tab("pane-b", "tab-break")
            .unwrap();
        assert_eq!(new_tab_id, "tab-break");
        let window = graph
            .workspaces
            .get("workspace-a")
            .unwrap()
            .windows
            .get("window-a")
            .unwrap();
        assert_eq!(window.active_tab_id, "tab-break");
        assert!(window
            .tabs
            .get("tab-a")
            .unwrap()
            .panes
            .contains_key("pane-a"));
        assert!(window
            .tabs
            .get("tab-break")
            .unwrap()
            .panes
            .contains_key("pane-b"));

        graph
            .join_pane_into_active_tab("pane-a", "pane-b", SplitAxis::Horizontal)
            .unwrap();
        let window = graph
            .workspaces
            .get("workspace-a")
            .unwrap()
            .windows
            .get("window-a")
            .unwrap();
        assert_eq!(window.tabs.len(), 1);
        let tab = window.tabs.get("tab-break").unwrap();
        assert_eq!(tab.layout.pane_ids(), vec!["pane-b", "pane-a"]);
        graph.validate().unwrap();
    }

    #[test]
    fn window_lifecycle_keeps_active_window_valid() {
        let mut graph = sample_graph();
        let window = WindowRecord::new(
            "window-b",
            "Tests",
            TabRecord::new(
                "tab-b",
                "Tests",
                PaneRecord::new("pane-b", "Tests", "powershell", "C:/repo"),
            ),
        );

        graph.create_window(window).unwrap();
        let workspace = graph.workspaces.get("workspace-a").unwrap();
        assert_eq!(workspace.active_window_id, "window-b");
        assert_eq!(workspace.windows.len(), 2);

        graph.rename_window("window-b", "Review").unwrap();
        let workspace = graph.workspaces.get("workspace-a").unwrap();
        assert_eq!(workspace.windows.get("window-b").unwrap().title, "Review");

        let removed = graph.remove_window("window-b").unwrap();
        assert_eq!(removed.id, "window-b");
        let workspace = graph.workspaces.get("workspace-a").unwrap();
        assert_eq!(workspace.active_window_id, "window-a");
        graph.validate().unwrap();
    }

    #[test]
    fn window_lifecycle_rejects_last_window_removal() {
        let mut graph = sample_graph();
        let err = graph.remove_window("window-a").unwrap_err();
        assert_eq!(err, MuxGraphError::CannotRemoveLastWindow);
    }

    #[test]
    fn client_lifecycle_is_backend_owned_and_window_scoped() {
        let mut graph = sample_graph();
        graph
            .upsert_client(MuxClientRecord::new(
                "client-a",
                "workspace-a",
                "window-a",
                MuxClientMode::ReadOnly,
                1_000,
            ))
            .unwrap();
        let workspace = graph.workspaces.get("workspace-a").unwrap();
        assert_eq!(workspace.clients.len(), 1);
        assert_eq!(
            workspace.clients.get("client-a").unwrap().mode,
            MuxClientMode::ReadOnly
        );

        graph
            .upsert_client(MuxClientRecord::new(
                "client-a",
                "workspace-a",
                "window-a",
                MuxClientMode::ReadWrite,
                2_000,
            ))
            .unwrap();
        assert_eq!(
            graph
                .workspaces
                .get("workspace-a")
                .unwrap()
                .clients
                .get("client-a")
                .unwrap()
                .last_seen_at_ms,
            2_000
        );

        let removed = graph.remove_client("client-a").unwrap();
        assert_eq!(removed.unwrap().id, "client-a");
        assert!(graph
            .workspaces
            .get("workspace-a")
            .unwrap()
            .clients
            .is_empty());
    }

    #[test]
    fn client_record_rejects_missing_window_and_wrong_workspace() {
        let mut graph = sample_graph();
        let missing_window = graph
            .upsert_client(MuxClientRecord::new(
                "client-a",
                "workspace-a",
                "missing-window",
                MuxClientMode::ReadOnly,
                1,
            ))
            .unwrap_err();
        assert_eq!(
            missing_window,
            MuxGraphError::MissingWindow("missing-window".to_string())
        );

        let wrong_workspace = graph
            .upsert_client(MuxClientRecord::new(
                "client-a",
                "workspace-b",
                "window-a",
                MuxClientMode::ReadOnly,
                1,
            ))
            .unwrap_err();
        assert_eq!(
            wrong_workspace,
            MuxGraphError::ClientWorkspaceMismatch {
                client_id: "client-a".to_string(),
                workspace_id: "workspace-b".to_string(),
                expected_workspace_id: "workspace-a".to_string(),
            }
        );
    }

    #[test]
    fn removing_window_detaches_clients_bound_to_that_window() {
        let mut graph = sample_graph();
        graph
            .create_window(WindowRecord::new(
                "window-b",
                "Review",
                TabRecord::new(
                    "tab-b",
                    "Review",
                    PaneRecord::new("pane-b", "Review", "powershell", "C:/repo"),
                ),
            ))
            .unwrap();
        graph
            .upsert_client(MuxClientRecord::new(
                "client-a",
                "workspace-a",
                "window-b",
                MuxClientMode::ReadOnly,
                1,
            ))
            .unwrap();

        graph.remove_window("window-b").unwrap();
        assert!(graph
            .workspaces
            .get("workspace-a")
            .unwrap()
            .clients
            .is_empty());
        graph.validate().unwrap();
    }

    #[test]
    fn validation_rejects_layout_record_mismatch() {
        let mut graph = sample_graph();
        let tab = graph.active_tab_mut().unwrap();
        tab.layout.root = LayoutNode::single("ghost-pane");
        tab.layout.active_pane_id = "ghost-pane".to_string();

        let err = tab.validate().unwrap_err();
        assert!(matches!(err, MuxGraphError::PaneRecordMismatch { .. }));
    }

    #[test]
    fn validation_rejects_fake_live_layout_state() {
        let mut graph = sample_graph();
        graph.version = 0;
        assert_eq!(
            graph.validate().unwrap_err(),
            MuxGraphError::UnsupportedVersion(0)
        );
    }
}
