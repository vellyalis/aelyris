use std::sync::Mutex;

use super::{CodeGraph, CodeNode};

/// Thread-safe owner of the Knowledge Graph, managed in Tauri state. Mutations
/// (add node/edge) and reads (dependencies/dependents/impact) go through the
/// lock; the orchestrator populates the graph and queries the blast radius of a
/// change over MCP.
#[derive(Default)]
pub struct KnowledgeGraphManager {
    graph: Mutex<CodeGraph>,
}

impl KnowledgeGraphManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CodeGraph> {
        self.graph
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn add_node(&self, node: CodeNode) {
        self.lock().add_node(node);
    }

    pub fn add_edge(&self, dependent: &str, dependency: &str) {
        self.lock().add_edge(dependent, dependency);
    }

    pub fn remove_node(&self, id: &str) -> bool {
        self.lock().remove_node(id)
    }

    pub fn remove_edge(&self, dependent: &str, dependency: &str) -> bool {
        self.lock().remove_edge(dependent, dependency)
    }

    pub fn nodes(&self) -> Vec<CodeNode> {
        self.lock().nodes()
    }

    pub fn edges(&self) -> Vec<(String, String)> {
        self.lock().edges()
    }

    pub fn dependencies_of(&self, id: &str) -> Vec<String> {
        self.lock().dependencies_of(id)
    }

    pub fn dependents_of(&self, id: &str) -> Vec<String> {
        self.lock().dependents_of(id)
    }

    pub fn impact_of(&self, id: &str) -> Vec<String> {
        self.lock().impact_of(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge_graph::NodeKind;

    #[test]
    fn manager_round_trips_through_the_lock() {
        let mgr = KnowledgeGraphManager::new();
        mgr.add_node(CodeNode {
            id: "AuthService".to_string(),
            kind: NodeKind::Service,
            file: Some("src/auth/service.ts".to_string()),
        });
        mgr.add_edge("AuthService", "JWTProvider");
        mgr.add_edge("JWTProvider", "Redis");
        assert_eq!(mgr.dependencies_of("AuthService"), ["JWTProvider"]);
        // Changing Redis impacts JWTProvider + AuthService.
        assert_eq!(mgr.impact_of("Redis"), ["AuthService", "JWTProvider"]);
        assert_eq!(mgr.nodes().len(), 3);
    }
}
