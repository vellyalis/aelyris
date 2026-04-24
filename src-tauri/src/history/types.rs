use serde::{Deserialize, Serialize};

/// Metadata the store persists alongside each embedded command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub command_id: i64,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub executed_at: String,
}

/// Optional filters applied on top of the semantic score.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SearchFilters {
    /// SQLite datetime() lower bound (inclusive). e.g. "2026-04-15 00:00:00".
    pub since: Option<String>,
    /// SQLite datetime() upper bound (inclusive).
    pub until: Option<String>,
    /// Restrict to commands executed with this cwd prefix.
    pub cwd_prefix: Option<String>,
    /// If true, restrict to commands that failed (exit_code != 0 && != null).
    pub only_failed: Option<bool>,
}

/// A single hit returned from a semantic search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub entry: HistoryEntry,
    /// Cosine similarity in [-1, 1]; higher is better.
    pub score: f32,
}
