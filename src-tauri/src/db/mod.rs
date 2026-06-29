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
use std::sync::{Arc, Mutex};

/// Thread-safe database wrapper for use as Tauri managed state.
///
/// The single `Connection` lives behind `Arc<Mutex<_>>` so the handle is cheaply
/// cloneable: the SAME connection can be shared with a long-lived owner (e.g. the
/// Context Store manager's save-on-write sink) without opening a second
/// connection. All access still serializes through the one Mutex.
#[derive(Clone)]
pub struct ManagedDb {
    inner: Arc<Mutex<Database>>,
}

impl ManagedDb {
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(Mutex::new(db)),
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

/// Returns the path to the Aelyris database file (~/.aelyris/aelyris.db)
pub fn db_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".aelyris").join("aelyris.db")
}
