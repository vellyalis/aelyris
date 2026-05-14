use std::collections::HashMap;

use super::graph::{
    graph_from_single_pane, LifecycleState, MuxGraph, MuxGraphError, PaneRecord, PtyBinding,
};
use super::layout::SplitAxis;

#[derive(Debug, Default)]
pub struct MuxManager {
    graphs: HashMap<String, MuxGraph>,
}

impl MuxManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_graph(&mut self, graph: MuxGraph) -> Result<(), MuxManagerError> {
        graph.validate()?;
        let id = graph.active_workspace_id.clone();
        if self.graphs.contains_key(&id) {
            return Err(MuxManagerError::GraphAlreadyExists(id));
        }
        self.graphs.insert(id, graph);
        Ok(())
    }

    pub fn upsert_graph(&mut self, graph: MuxGraph) -> Result<(), MuxManagerError> {
        graph.validate()?;
        self.graphs.insert(graph.active_workspace_id.clone(), graph);
        Ok(())
    }

    pub fn graph(&self, workspace_id: &str) -> Option<&MuxGraph> {
        self.graphs.get(workspace_id)
    }

    pub fn remove_graph(&mut self, workspace_id: &str) -> Option<MuxGraph> {
        self.graphs.remove(workspace_id)
    }

    pub fn graph_mut(&mut self, workspace_id: &str) -> Result<&mut MuxGraph, MuxManagerError> {
        self.graphs
            .get_mut(workspace_id)
            .ok_or_else(|| MuxManagerError::GraphNotFound(workspace_id.to_string()))
    }

    pub fn workspace_ids(&self) -> Vec<String> {
        let mut ids = self.graphs.keys().cloned().collect::<Vec<_>>();
        ids.sort();
        ids
    }

    pub fn upsert_standalone_terminal(
        &mut self,
        terminal_id: &str,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), MuxManagerError> {
        let mut pane = PaneRecord::new(terminal_id, shell, shell, cwd);
        pane.lifecycle = LifecycleState::Active;
        pane.pty = Some(PtyBinding {
            terminal_id: terminal_id.to_string(),
            process_id: None,
            cols,
            rows,
        });
        let graph = graph_from_single_pane(
            terminal_id,
            format!("terminal:{terminal_id}"),
            format!("{terminal_id}:window"),
            format!("{terminal_id}:tab"),
            pane,
        );
        self.upsert_graph(graph)
    }

    pub fn split_active_pane(
        &mut self,
        workspace_id: &str,
        target_pane_id: &str,
        pane: PaneRecord,
        axis: SplitAxis,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph
            .active_tab_mut()?
            .split_pane(target_pane_id, pane, axis)?;
        graph.validate()?;
        Ok(())
    }

    pub fn close_active_pane(
        &mut self,
        workspace_id: &str,
        pane_id: &str,
    ) -> Result<PaneRecord, MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        let removed = graph.active_tab_mut()?.close_pane(pane_id)?;
        graph.validate()?;
        Ok(removed)
    }

    pub fn swap_active_panes(
        &mut self,
        workspace_id: &str,
        first_pane_id: &str,
        second_pane_id: &str,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph
            .active_tab_mut()?
            .swap_panes(first_pane_id, second_pane_id)?;
        graph.validate()?;
        Ok(())
    }

    pub fn move_active_pane_next_to(
        &mut self,
        workspace_id: &str,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: SplitAxis,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph
            .active_tab_mut()?
            .move_pane_next_to(source_pane_id, target_pane_id, axis)?;
        graph.validate()?;
        Ok(())
    }

    pub fn apply_even_to_active_tab(
        &mut self,
        workspace_id: &str,
        axis: SplitAxis,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.apply_even(axis)?;
        graph.validate()?;
        Ok(())
    }

    pub fn equalize_active_tab(&mut self, workspace_id: &str) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.equalize_ratios()?;
        graph.validate()?;
        Ok(())
    }

    pub fn apply_tiled_to_active_tab(&mut self, workspace_id: &str) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.apply_tiled()?;
        graph.validate()?;
        Ok(())
    }

    pub fn rotate_active_tab(
        &mut self,
        workspace_id: &str,
        reverse: bool,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.rotate_panes(reverse)?;
        graph.validate()?;
        Ok(())
    }

    pub fn break_active_pane_to_new_tab(
        &mut self,
        workspace_id: &str,
        pane_id: &str,
    ) -> Result<String, MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        let new_tab_id = format!("{}:break:{}", pane_id, uuid::Uuid::new_v4().simple());
        let new_tab_id = graph.break_active_pane_to_tab(pane_id, new_tab_id)?;
        graph.validate()?;
        Ok(new_tab_id)
    }

    pub fn join_pane_into_active_tab(
        &mut self,
        workspace_id: &str,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: SplitAxis,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.join_pane_into_active_tab(source_pane_id, target_pane_id, axis)?;
        graph.validate()?;
        Ok(())
    }

    pub fn set_active_tab_zoom(
        &mut self,
        workspace_id: &str,
        pane_id: Option<String>,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.set_zoomed_pane(pane_id)?;
        graph.validate()?;
        Ok(())
    }

    pub fn set_active_tab_synchronized_panes(
        &mut self,
        workspace_id: &str,
        enabled: bool,
    ) -> Result<(), MuxManagerError> {
        let graph = self.graph_mut(workspace_id)?;
        graph.active_tab_mut()?.set_synchronized_panes(enabled)?;
        graph.validate()?;
        Ok(())
    }

    pub fn synchronized_input_targets_for_pane(&self, pane_id: &str) -> Option<Vec<String>> {
        for graph in self.graphs.values() {
            for workspace in graph.workspaces.values() {
                for window in workspace.windows.values() {
                    for tab in window.tabs.values() {
                        if !tab.panes.contains_key(pane_id) {
                            continue;
                        }
                        if !tab.synchronized_panes {
                            return None;
                        }
                        let mut targets = tab
                            .panes
                            .values()
                            .filter_map(|pane| pane.pty.as_ref().map(|pty| pty.terminal_id.clone()))
                            .collect::<Vec<_>>();
                        targets.sort();
                        targets.dedup();
                        return Some(targets);
                    }
                }
            }
        }
        None
    }

    pub fn validate_all(&self) -> Result<(), MuxManagerError> {
        for graph in self.graphs.values() {
            graph.validate()?;
        }
        Ok(())
    }

    pub fn update_pane_name(&mut self, pane_id: &str, name: &str) -> Result<(), MuxManagerError> {
        let pane = self
            .find_pane_mut(pane_id)
            .ok_or_else(|| MuxManagerError::PaneNotFound(pane_id.to_string()))?;
        pane.title = normalize_label(name, 64);
        Ok(())
    }

    pub fn update_pane_role(&mut self, pane_id: &str, role: &str) -> Result<(), MuxManagerError> {
        let pane = self
            .find_pane_mut(pane_id)
            .ok_or_else(|| MuxManagerError::PaneNotFound(pane_id.to_string()))?;
        let role = normalize_label(role, 32);
        pane.role = if role.is_empty() { None } else { Some(role) };
        Ok(())
    }

    pub fn update_pane_size(
        &mut self,
        pane_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), MuxManagerError> {
        let pane = self
            .find_pane_mut(pane_id)
            .ok_or_else(|| MuxManagerError::PaneNotFound(pane_id.to_string()))?;
        if let Some(pty) = pane.pty.as_mut() {
            pty.cols = cols;
            pty.rows = rows;
        }
        Ok(())
    }

    fn find_pane_mut(&mut self, pane_id: &str) -> Option<&mut PaneRecord> {
        for graph in self.graphs.values_mut() {
            for workspace in graph.workspaces.values_mut() {
                for window in workspace.windows.values_mut() {
                    for tab in window.tabs.values_mut() {
                        if let Some(pane) = tab.panes.get_mut(pane_id) {
                            return Some(pane);
                        }
                    }
                }
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MuxManagerError {
    Graph(MuxGraphError),
    GraphAlreadyExists(String),
    GraphNotFound(String),
    PaneNotFound(String),
}

impl std::fmt::Display for MuxManagerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Graph(err) => write!(f, "{err}"),
            Self::GraphAlreadyExists(id) => write!(f, "mux graph already exists: {id}"),
            Self::GraphNotFound(id) => write!(f, "mux graph not found: {id}"),
            Self::PaneNotFound(id) => write!(f, "mux pane not found: {id}"),
        }
    }
}

impl std::error::Error for MuxManagerError {}

impl From<MuxGraphError> for MuxManagerError {
    fn from(value: MuxGraphError) -> Self {
        Self::Graph(value)
    }
}

fn normalize_label(value: &str, max_len: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_len)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mux::graph::{graph_from_single_pane, PaneRecord};

    fn manager() -> MuxManager {
        let graph = graph_from_single_pane(
            "workspace-a",
            "Aether",
            "window-a",
            "tab-a",
            PaneRecord::new("pane-a", "PowerShell", "powershell", "C:/repo"),
        );
        let mut manager = MuxManager::new();
        manager.insert_graph(graph).unwrap();
        manager
    }

    #[test]
    fn manager_drives_tmux_style_active_tab_operations() {
        let mut manager = manager();

        manager
            .split_active_pane(
                "workspace-a",
                "pane-a",
                PaneRecord::new("pane-b", "Agent", "powershell", "C:/repo"),
                SplitAxis::Horizontal,
            )
            .unwrap();
        manager
            .split_active_pane(
                "workspace-a",
                "pane-b",
                PaneRecord::new("pane-c", "Tests", "cmd", "C:/repo"),
                SplitAxis::Vertical,
            )
            .unwrap();
        manager
            .swap_active_panes("workspace-a", "pane-a", "pane-c")
            .unwrap();
        manager
            .move_active_pane_next_to("workspace-a", "pane-a", "pane-b", SplitAxis::Horizontal)
            .unwrap();
        manager.apply_tiled_to_active_tab("workspace-a").unwrap();
        manager
            .apply_even_to_active_tab("workspace-a", SplitAxis::Vertical)
            .unwrap();
        manager.equalize_active_tab("workspace-a").unwrap();
        manager
            .set_active_tab_zoom("workspace-a", Some("pane-a".to_string()))
            .unwrap();
        assert_eq!(
            manager
                .graph("workspace-a")
                .unwrap()
                .workspaces
                .get("workspace-a")
                .unwrap()
                .windows
                .get("window-a")
                .unwrap()
                .tabs
                .get("tab-a")
                .unwrap()
                .layout
                .zoomed_pane_id
                .as_deref(),
            Some("pane-a")
        );
        manager.set_active_tab_zoom("workspace-a", None).unwrap();
        manager
            .set_active_tab_synchronized_panes("workspace-a", true)
            .unwrap();
        assert_eq!(
            manager.synchronized_input_targets_for_pane("pane-a"),
            Some(Vec::<String>::new())
        );
        manager
            .set_active_tab_synchronized_panes("workspace-a", false)
            .unwrap();

        let break_tab_id = manager
            .break_active_pane_to_new_tab("workspace-a", "pane-b")
            .unwrap();
        assert!(break_tab_id.starts_with("pane-b:break:"));
        manager
            .join_pane_into_active_tab("workspace-a", "pane-a", "pane-b", SplitAxis::Horizontal)
            .unwrap();

        manager.update_pane_name("pane-a", " Build ").unwrap();
        manager.update_pane_role("pane-a", "agent").unwrap();
        manager.update_pane_size("pane-a", 132, 43).unwrap();
        let removed = manager.close_active_pane("workspace-a", "pane-b").unwrap();
        assert_eq!(removed.id, "pane-b");
        let pane = manager
            .graph("workspace-a")
            .unwrap()
            .workspaces
            .get("workspace-a")
            .unwrap()
            .windows
            .get("window-a")
            .unwrap()
            .tabs
            .values()
            .find_map(|tab| tab.panes.get("pane-a"))
            .unwrap();
        assert_eq!(pane.title, "Build");
        assert_eq!(pane.role.as_deref(), Some("agent"));
        manager.validate_all().unwrap();
    }

    #[test]
    fn manager_rejects_duplicate_graph_insert() {
        let mut manager = manager();
        let graph = graph_from_single_pane(
            "workspace-a",
            "Aether",
            "window-b",
            "tab-b",
            PaneRecord::new("pane-b", "PowerShell", "powershell", "C:/repo"),
        );
        assert!(matches!(
            manager.insert_graph(graph),
            Err(MuxManagerError::GraphAlreadyExists(_))
        ));
    }

    #[test]
    fn manager_tracks_standalone_terminal_lifecycle_metadata() {
        let mut manager = MuxManager::new();
        manager
            .upsert_standalone_terminal("term-a", "powershell", "C:/repo", 120, 30)
            .unwrap();

        let graph = manager.graph("term-a").unwrap();
        let pane = graph
            .workspaces
            .get("term-a")
            .unwrap()
            .windows
            .get("term-a:window")
            .unwrap()
            .tabs
            .get("term-a:tab")
            .unwrap()
            .panes
            .get("term-a")
            .unwrap();
        assert_eq!(pane.pty.as_ref().unwrap().terminal_id, "term-a");
        assert_eq!(pane.pty.as_ref().unwrap().cols, 120);
        assert_eq!(pane.pty.as_ref().unwrap().rows, 30);
        manager.update_pane_size("term-a", 132, 43).unwrap();
        let pane = manager
            .graph("term-a")
            .unwrap()
            .workspaces
            .get("term-a")
            .unwrap()
            .windows
            .get("term-a:window")
            .unwrap()
            .tabs
            .get("term-a:tab")
            .unwrap()
            .panes
            .get("term-a")
            .unwrap();
        assert_eq!(pane.pty.as_ref().unwrap().cols, 132);
        assert_eq!(pane.pty.as_ref().unwrap().rows, 43);

        assert!(manager.remove_graph("term-a").is_some());
        assert!(manager.graph("term-a").is_none());
    }
}
