pub mod migrations;
pub mod queries;

pub use queries::{
    AgentIdentityRecord, AgentSessionRecord, AgentTelemetrySnapshotRecord, AuditEventRecord,
    AuditJournalAppend, AuditJournalCompactResult, AuditJournalEventRecord, AuditJournalFilter,
    AuditJournalSnapshotRecord, CommandRecord, Database, HistorySearchEntryRecord,
    ModePreservationSnapshotRecord, PaneTreeLayoutRecord, TerminalOutputJournalRow,
    WorkspaceItemRecord,
};

use std::path::PathBuf;
use std::sync::Mutex;

/// Thread-safe database wrapper for use as Tauri managed state
pub struct ManagedDb {
    inner: Mutex<Database>,
}

impl ManagedDb {
    pub fn new(db: Database) -> Self {
        Self {
            inner: Mutex::new(db),
        }
    }

    pub fn with<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Database) -> Result<T, String>,
    {
        let db = self
            .inner
            .lock()
            .map_err(|_| "Database lock poisoned".to_string())?;
        f(&db)
    }
}

/// Returns the path to the Aether database file (~/.aether/aether.db)
pub fn db_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".aether").join("aether.db")
}
