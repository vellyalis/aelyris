use rusqlite::params;

use super::Database;
use crate::knowledge_graph::CodeNode;

/// A loaded code-graph snapshot: `(nodes, edges)`, each edge `(dependent, dependency)`.
/// Aliased to keep query signatures readable (and satisfy clippy::type_complexity).
type CodeGraphRows = (Vec<CodeNode>, Vec<(String, String)>);

impl Database {
    /// Persist the whole code graph as a consistent snapshot: one transaction that
    /// clears both tables then re-inserts nodes (sort_order = index) and edges,
    /// mirroring replace_task_graph.
    pub fn replace_code_graph(
        &self,
        nodes: &[CodeNode],
        edges: &[(String, String)],
    ) -> Result<(), String> {
        // SAFETY: unchecked_transaction is sound here for the same reason as
        // replace_task_graph — Database is only reached through ManagedDb's
        // Arc<Mutex>, so the connection is always serialized; the txn rolls back
        // on drop if any step fails before commit.
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("Begin code graph txn: {}", e))?;
        tx.execute("DELETE FROM code_graph_edges", [])
            .map_err(|e| format!("Clear code graph edges: {}", e))?;
        tx.execute("DELETE FROM code_graph_nodes", [])
            .map_err(|e| format!("Clear code graph nodes: {}", e))?;
        for (index, node) in nodes.iter().enumerate() {
            let json = serde_json::to_string(node)
                .map_err(|e| format!("Serialize node {}: {}", node.id, e))?;
            let kind = serde_json::to_string(&node.kind)
                .map(|s| s.trim_matches('"').to_string())
                .unwrap_or_else(|_| "other".to_string());
            tx.execute(
                "INSERT INTO code_graph_nodes (id, sort_order, kind, node_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![node.id, index as i64, kind, json],
            )
            .map_err(|e| format!("Insert node {}: {}", node.id, e))?;
        }
        for (index, (dependent, dependency)) in edges.iter().enumerate() {
            tx.execute(
                "INSERT INTO code_graph_edges (dependent, dependency, sort_order)
                 VALUES (?1, ?2, ?3)",
                params![dependent, dependency, index as i64],
            )
            .map_err(|e| format!("Insert edge {}->{}: {}", dependent, dependency, e))?;
        }
        tx.commit().map_err(|e| format!("Commit code graph: {}", e))
    }

    /// Load the whole code graph (nodes in sort_order, then edges in sort_order).
    pub fn load_code_graph(&self) -> Result<CodeGraphRows, String> {
        let mut node_stmt = self
            .conn
            .prepare("SELECT node_json FROM code_graph_nodes ORDER BY sort_order")
            .map_err(|e| format!("Prepare load code graph nodes: {}", e))?;
        let node_rows = node_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Query code graph nodes: {}", e))?;
        let mut nodes = Vec::new();
        for row in node_rows {
            let json = row.map_err(|e| format!("Read node row: {}", e))?;
            let node: CodeNode =
                serde_json::from_str(&json).map_err(|e| format!("Deserialize node: {}", e))?;
            nodes.push(node);
        }
        let mut edge_stmt = self
            .conn
            .prepare("SELECT dependent, dependency FROM code_graph_edges ORDER BY sort_order")
            .map_err(|e| format!("Prepare load code graph edges: {}", e))?;
        let edge_rows = edge_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Query code graph edges: {}", e))?;
        let mut edges = Vec::new();
        for row in edge_rows {
            edges.push(row.map_err(|e| format!("Read edge row: {}", e))?);
        }
        Ok((nodes, edges))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge_graph::NodeKind;

    fn node(id: &str) -> CodeNode {
        CodeNode {
            id: id.to_string(),
            kind: NodeKind::Module,
            file: Some(id.to_string()),
        }
    }

    #[test]
    fn replace_code_graph_rolls_back_the_whole_snapshot_on_insert_failure() {
        let db = Database::open_memory().unwrap();
        db.replace_code_graph(&[node("stable.rs")], &[]).unwrap();

        let error = db
            .replace_code_graph(&[node("duplicate.rs"), node("duplicate.rs")], &[])
            .unwrap_err();
        assert!(error.contains("Insert node duplicate.rs"));

        let (nodes, edges) = db.load_code_graph().unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].id, "stable.rs");
        assert!(edges.is_empty());
    }
}
