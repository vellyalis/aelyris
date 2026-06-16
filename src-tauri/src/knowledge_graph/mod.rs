//! Knowledge Graph — the code dependency map agents reason over (structure, not
//! files).
//!
//! Agents don't really care about `auth.ts`; they care that `User ->
//! AuthService -> JWTProvider -> Redis`. This module holds that dependency graph
//! and answers the question that matters when something changes: *what is the
//! blast radius?* — `impact_of(node)` is the transitive set of everything that
//! depends on `node`, so a decision/intent touching one symbol immediately
//! tells the fleet which other symbols (and their owners) are affected.
//!
//! This is the pure, fully-testable core. Populating it from real source (LSP
//! aggregation across the repo) is a thin adapter layered on top later; the
//! graph + impact analysis stand alone.

pub mod manager;

pub use manager::KnowledgeGraphManager;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// What a node is. Coarse on purpose — the graph cares about dependencies, not a
/// full type system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Module,
    Service,
    Function,
    Class,
    Component,
    #[default]
    Other,
}

/// A node in the code graph: a symbol/module the fleet reasons about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeNode {
    pub id: String,
    #[serde(default)]
    pub kind: NodeKind,
    /// The file this symbol lives in, if known (links structure back to files).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// In-memory code dependency graph. Edges point dependent -> dependency
/// (`User -> AuthService` means User needs AuthService).
#[derive(Debug, Default)]
pub struct CodeGraph {
    nodes: BTreeMap<String, CodeNode>,
    /// dependent id -> the set of ids it depends on.
    deps: BTreeMap<String, BTreeSet<String>>,
}

impl CodeGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Add or replace a node.
    pub fn add_node(&mut self, node: CodeNode) {
        self.nodes.insert(node.id.clone(), node);
    }

    /// Record that `dependent` depends on `dependency`. Unknown endpoints are
    /// auto-created as `Other` nodes so an edge is never silently dropped. A
    /// self-edge is ignored (a node does not depend on itself).
    pub fn add_edge(&mut self, dependent: &str, dependency: &str) {
        if dependent == dependency {
            return;
        }
        for id in [dependent, dependency] {
            self.nodes
                .entry(id.to_string())
                .or_insert_with(|| CodeNode {
                    id: id.to_string(),
                    kind: NodeKind::Other,
                    file: None,
                });
        }
        self.deps
            .entry(dependent.to_string())
            .or_default()
            .insert(dependency.to_string());
    }

    /// Remove a node and every edge touching it (the symbol was deleted or
    /// renamed). Returns whether it existed. Keeps the graph from accumulating
    /// ghost symbols whose blast radius would be misleading.
    pub fn remove_node(&mut self, id: &str) -> bool {
        let existed = self.nodes.remove(id).is_some();
        self.deps.remove(id); // outgoing edges
        for set in self.deps.values_mut() {
            set.remove(id); // incoming edges
        }
        existed
    }

    /// Remove a single dependency edge. Returns whether it existed.
    pub fn remove_edge(&mut self, dependent: &str, dependency: &str) -> bool {
        self.deps
            .get_mut(dependent)
            .map(|set| set.remove(dependency))
            .unwrap_or(false)
    }

    pub fn get(&self, id: &str) -> Option<&CodeNode> {
        self.nodes.get(id)
    }

    pub fn nodes(&self) -> Vec<CodeNode> {
        self.nodes.values().cloned().collect()
    }

    /// All edges as `(dependent, dependency)` pairs.
    pub fn edges(&self) -> Vec<(String, String)> {
        self.deps
            .iter()
            .flat_map(|(dependent, set)| {
                set.iter()
                    .map(move |dependency| (dependent.clone(), dependency.clone()))
            })
            .collect()
    }

    /// Direct dependencies of `id` (what it needs), sorted.
    pub fn dependencies_of(&self, id: &str) -> Vec<String> {
        self.deps
            .get(id)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Direct dependents of `id` (who needs it), sorted. The sort is explicit so
    /// the contract holds regardless of the underlying map type.
    pub fn dependents_of(&self, id: &str) -> Vec<String> {
        let mut dependents: Vec<String> = self
            .deps
            .iter()
            .filter(|(_, set)| set.contains(id))
            .map(|(dependent, _)| dependent.clone())
            .collect();
        dependents.sort();
        dependents
    }

    /// Transitive blast radius: every node that (transitively) depends on `id`.
    /// If `id` changes, these are the nodes affected. Excludes `id` itself and
    /// is cycle-safe (a visited set bounds the walk).
    pub fn impact_of(&self, id: &str) -> Vec<String> {
        let mut visited = BTreeSet::new();
        let mut queue: VecDeque<String> = self.dependents_of(id).into_iter().collect();
        while let Some(node) = queue.pop_front() {
            if node == id || !visited.insert(node.clone()) {
                continue;
            }
            for dependent in self.dependents_of(&node) {
                if !visited.contains(&dependent) {
                    queue.push_back(dependent);
                }
            }
        }
        visited.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: NodeKind) -> CodeNode {
        CodeNode {
            id: id.to_string(),
            kind,
            file: None,
        }
    }

    /// Build User -> AuthService -> JWTProvider -> Redis.
    fn chain() -> CodeGraph {
        let mut g = CodeGraph::new();
        g.add_node(node("User", NodeKind::Component));
        g.add_node(node("AuthService", NodeKind::Service));
        g.add_node(node("JWTProvider", NodeKind::Service));
        g.add_node(node("Redis", NodeKind::Module));
        g.add_edge("User", "AuthService");
        g.add_edge("AuthService", "JWTProvider");
        g.add_edge("JWTProvider", "Redis");
        g
    }

    #[test]
    fn direct_dependencies_and_dependents() {
        let g = chain();
        assert_eq!(g.dependencies_of("AuthService"), ["JWTProvider"]);
        assert_eq!(g.dependents_of("JWTProvider"), ["AuthService"]);
        assert!(g.dependencies_of("Redis").is_empty());
        assert!(g.dependents_of("User").is_empty());
    }

    #[test]
    fn impact_is_the_transitive_blast_radius() {
        let g = chain();
        // Changing Redis affects everything upstream of it.
        assert_eq!(g.impact_of("Redis"), ["AuthService", "JWTProvider", "User"]);
        // Changing JWTProvider affects AuthService + User (not Redis below it).
        assert_eq!(g.impact_of("JWTProvider"), ["AuthService", "User"]);
        // A leaf consumer affects nobody.
        assert!(g.impact_of("User").is_empty());
    }

    #[test]
    fn add_edge_auto_creates_unknown_nodes() {
        let mut g = CodeGraph::new();
        g.add_edge("a", "b");
        assert!(g.get("a").is_some());
        assert!(g.get("b").is_some());
        assert_eq!(g.get("a").unwrap().kind, NodeKind::Other);
    }

    #[test]
    fn self_edge_is_ignored() {
        let mut g = CodeGraph::new();
        g.add_edge("x", "x");
        assert!(g.dependencies_of("x").is_empty());
    }

    #[test]
    fn impact_is_cycle_safe() {
        let mut g = CodeGraph::new();
        g.add_edge("a", "b");
        g.add_edge("b", "c");
        g.add_edge("c", "a"); // cycle a -> b -> c -> a
                              // impact terminates and includes the other two nodes in the cycle.
        let impact = g.impact_of("a");
        assert!(impact.contains(&"b".to_string()));
        assert!(impact.contains(&"c".to_string()));
        assert_eq!(impact.len(), 2); // a excluded
    }

    #[test]
    fn remove_node_evicts_it_and_severs_its_edges() {
        let mut g = chain();
        assert!(g.remove_node("JWTProvider"));
        assert!(g.get("JWTProvider").is_none());
        // The chain is cut at JWTProvider: Redis has no dependents, AuthService
        // no longer depends on the removed node.
        assert!(g.impact_of("Redis").is_empty());
        assert!(g.dependencies_of("AuthService").is_empty());
        // Removing again is a no-op.
        assert!(!g.remove_node("JWTProvider"));
    }

    #[test]
    fn remove_edge_severs_one_dependency() {
        let mut g = chain();
        assert!(g.remove_edge("AuthService", "JWTProvider"));
        assert!(g.dependencies_of("AuthService").is_empty());
        // Redis impact no longer routes up through AuthService/User.
        assert_eq!(g.impact_of("Redis"), ["JWTProvider"]);
        assert!(!g.remove_edge("AuthService", "JWTProvider"));
    }

    #[test]
    fn diamond_dependency_dedupes_impact() {
        // d depends on b and c; both depend on a. Changing a impacts b, c, d once.
        let mut g = CodeGraph::new();
        g.add_edge("b", "a");
        g.add_edge("c", "a");
        g.add_edge("d", "b");
        g.add_edge("d", "c");
        assert_eq!(g.impact_of("a"), ["b", "c", "d"]);
    }
}
