use std::sync::{Mutex, OnceLock};

use super::{CodeGraph, CodeNode};
use crate::db::ManagedDb;

/// Thread-safe owner of the Knowledge Graph, managed in Tauri state. Mutations
/// (add node/edge) and reads (dependencies/dependents/impact) go through the
/// lock; the orchestrator populates the graph and queries the blast radius of a
/// change over MCP.
///
/// The graph is durably persisted: once [`attach_db`](Self::attach_db) wires a DB
/// handle at launch, every mutation writes the whole graph through to SQLite so a
/// populated graph survives an app restart instead of resetting to empty.
/// Persistence is best-effort (a DB error never fails the in-memory op) and runs
/// UNDER the graph lock. All mutations funnel through this manager, so it is the
/// single save-on-write choke point. The bulk re-index path uses [`replace_graph`]
/// (one write) rather than a loop of add_* (which would write the whole graph N times).
#[derive(Default)]
pub struct KnowledgeGraphManager {
    graph: Mutex<CodeGraph>,
    db: OnceLock<ManagedDb>,
}

impl KnowledgeGraphManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Wire the durable store, once at launch AFTER `hydrate`. A second call logs.
    pub fn attach_db(&self, db: ManagedDb) {
        if self.db.set(db).is_err() {
            log::warn!(
                "knowledge graph: attach_db called more than once; keeping the first DB handle"
            );
        }
    }

    /// Silently restore the graph at launch from a persisted snapshot. Bypasses
    /// persistence — a restore must not re-write the rows it just read. Call
    /// BEFORE `attach_db`.
    pub fn hydrate(&self, nodes: Vec<CodeNode>, edges: Vec<(String, String)>) {
        self.lock().replace(nodes, edges);
    }

    /// Replace the whole graph (used by the indexer to rebuild from source), then
    /// persist once. Idempotent — re-indexing is safe and a single DB write.
    pub fn replace_graph(&self, nodes: Vec<CodeNode>, edges: Vec<(String, String)>) {
        let mut graph = self.lock();
        graph.replace(nodes, edges);
        self.persist_locked(&graph);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CodeGraph> {
        self.graph
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Best-effort whole-graph write-through under the caller's held lock. Errors
    /// log; the in-memory mutation already succeeded. No-op when no DB is attached.
    fn persist_locked(&self, graph: &CodeGraph) {
        let Some(db) = self.db.get() else {
            return;
        };
        let nodes = graph.nodes();
        let edges = graph.edges();
        if let Err(err) = db.with(|d| d.replace_code_graph(&nodes, &edges)) {
            log::warn!("knowledge graph: persist failed: {err}");
        }
    }

    pub fn add_node(&self, node: CodeNode) {
        let mut graph = self.lock();
        graph.add_node(node);
        self.persist_locked(&graph);
    }

    pub fn add_edge(&self, dependent: &str, dependency: &str) {
        let mut graph = self.lock();
        graph.add_edge(dependent, dependency);
        self.persist_locked(&graph);
    }

    pub fn remove_node(&self, id: &str) -> bool {
        let mut graph = self.lock();
        let existed = graph.remove_node(id);
        if existed {
            self.persist_locked(&graph);
        }
        existed
    }

    pub fn remove_edge(&self, dependent: &str, dependency: &str) -> bool {
        let mut graph = self.lock();
        let existed = graph.remove_edge(dependent, dependency);
        if existed {
            self.persist_locked(&graph);
        }
        existed
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

    #[test]
    fn persists_and_restores_after_restart() {
        use crate::db::{Database, ManagedDb};
        let db = ManagedDb::new(Database::open_memory().unwrap());

        let mgr = KnowledgeGraphManager::new();
        mgr.attach_db(db.clone());
        mgr.add_node(CodeNode {
            id: "AuthService".to_string(),
            kind: NodeKind::Service,
            file: Some("src/auth.ts".to_string()),
        });
        mgr.add_edge("AuthService", "JWTProvider");
        mgr.add_edge("JWTProvider", "Redis");

        // Restart: a fresh manager hydrated from the SAME db.
        let reloaded = KnowledgeGraphManager::new();
        let (nodes, edges) = db.with(|d| d.load_code_graph()).unwrap();
        reloaded.hydrate(nodes, edges);

        assert_eq!(reloaded.nodes().len(), 3);
        // The blast-radius topology survived the restart.
        assert_eq!(reloaded.impact_of("Redis"), ["AuthService", "JWTProvider"]);
        // The explicitly-added node kept its kind/file through persistence.
        let auth = reloaded
            .nodes()
            .into_iter()
            .find(|n| n.id == "AuthService")
            .unwrap();
        assert_eq!(auth.kind, NodeKind::Service);
        assert_eq!(auth.file.as_deref(), Some("src/auth.ts"));
    }

    #[test]
    fn replace_graph_rebuilds_and_no_db_is_a_noop() {
        // Without an attached DB, mutations stay in-memory (persist is a no-op).
        let mgr = KnowledgeGraphManager::new();
        mgr.replace_graph(
            vec![CodeNode {
                id: "x".to_string(),
                kind: NodeKind::Module,
                file: None,
            }],
            vec![("x".to_string(), "y".to_string())],
        );
        assert_eq!(mgr.dependencies_of("x"), ["y"]);
        // Re-index replaces wholesale.
        mgr.replace_graph(vec![], vec![]);
        assert!(mgr.nodes().is_empty());
    }
}
