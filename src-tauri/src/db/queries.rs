use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use uuid::Uuid;

use super::migrations;

/// Core database handle for Aether Terminal
pub struct Database {
    conn: Connection,
}

// --- Data types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Window {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub sort_order: i32,
    pub layout_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pane {
    pub id: String,
    pub window_id: String,
    pub shell_type: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub flex_basis: f64,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoredSession {
    pub session: Session,
    pub windows: Vec<RestoredWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoredWindow {
    pub window: Window,
    pub panes: Vec<Pane>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneTreeLayoutRecord {
    pub storage_key: String,
    pub project_path: String,
    pub layout_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventRecord {
    pub id: i64,
    pub timestamp: String,
    pub category: String,
    pub action: String,
    pub severity: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub summary: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalAppend {
    pub workspace_id: String,
    pub thread_id: Option<String>,
    pub session_id: Option<String>,
    pub pane_id: Option<String>,
    pub terminal_id: Option<String>,
    pub agent_id: Option<String>,
    pub workflow_id: Option<String>,
    pub task_id: Option<String>,
    pub correlation_id: Option<String>,
    pub kind: String,
    pub severity: String,
    pub source: String,
    pub confidence: Option<f64>,
    pub payload_json: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalFilter {
    pub workspace_id: Option<String>,
    pub thread_id: Option<String>,
    pub session_id: Option<String>,
    pub pane_id: Option<String>,
    pub terminal_id: Option<String>,
    pub agent_id: Option<String>,
    pub workflow_id: Option<String>,
    pub task_id: Option<String>,
    pub correlation_id: Option<String>,
    pub kind: Option<String>,
    pub severity: Option<String>,
    pub source: Option<String>,
    pub after_sequence: Option<i64>,
    pub before_sequence: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalEventRecord {
    pub id: i64,
    pub workspace_id: String,
    pub thread_id: Option<String>,
    pub session_id: Option<String>,
    pub pane_id: Option<String>,
    pub terminal_id: Option<String>,
    pub agent_id: Option<String>,
    pub workflow_id: Option<String>,
    pub task_id: Option<String>,
    pub correlation_id: String,
    pub sequence: i64,
    pub kind: String,
    pub severity: String,
    pub source: String,
    pub confidence: f64,
    pub created_at: String,
    pub redacted_payload_json: serde_json::Value,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalSnapshotRecord {
    pub id: i64,
    pub workspace_id: String,
    pub through_sequence: i64,
    pub event_count: i64,
    pub snapshot_json: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalCompactResult {
    pub workspace_id: String,
    pub before_sequence: i64,
    pub compacted_count: i64,
    pub snapshot: AuditJournalSnapshotRecord,
}

const MAX_PANE_LAYOUT_KEY_BYTES: usize = 256;
const MAX_PANE_LAYOUT_JSON_BYTES: usize = 256 * 1024;
const MAX_AGENT_TELEMETRY_JSON_BYTES: usize = 512 * 1024;
const MAX_TERMINAL_OUTPUT_JOURNAL_TEXT_BYTES: usize = 256 * 1024;
const MAX_TERMINAL_OUTPUT_JOURNAL_ROWS_PER_TERMINAL: usize = 2_000;
const MAX_AUDIT_JOURNAL_PAYLOAD_BYTES: usize = 256 * 1024;
const MAX_AUDIT_JOURNAL_ID_BYTES: usize = 256;

impl Database {
    /// Open (or create) the database at the given path and run migrations
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create db directory: {}", e))?;
        }

        let conn = Connection::open(path).map_err(|e| format!("Failed to open database: {}", e))?;

        migrations::run_migrations(&conn).map_err(|e| format!("Migration failed: {}", e))?;

        Ok(Self { conn })
    }

    /// Open an in-memory database (for testing)
    pub fn open_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory db: {}", e))?;

        migrations::run_migrations(&conn).map_err(|e| format!("Migration failed: {}", e))?;

        Ok(Self { conn })
    }

    // --- Session CRUD ---

    pub fn create_session(&self, name: &str) -> Result<Session, String> {
        let id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO sessions (id, name) VALUES (?1, ?2)",
                params![id, name],
            )
            .map_err(|e| format!("Insert session: {}", e))?;

        self.get_session(&id)
    }

    pub fn get_session(&self, id: &str) -> Result<Session, String> {
        self.conn
            .query_row(
                "SELECT id, name, created_at, updated_at, is_active FROM sessions WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Session {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                        is_active: row.get::<_, i32>(4)? != 0,
                    })
                },
            )
            .map_err(|e| format!("Get session: {}", e))
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, created_at, updated_at, is_active FROM sessions ORDER BY updated_at DESC")
            .map_err(|e| format!("Prepare: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    is_active: row.get::<_, i32>(4)? != 0,
                })
            })
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete session: {}", e))?;
        Ok(())
    }

    pub fn touch_session(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("Touch session: {}", e))?;
        Ok(())
    }

    // --- Window CRUD ---

    pub fn create_window(&self, session_id: &str, title: &str) -> Result<Window, String> {
        let id = Uuid::new_v4().to_string();

        // Auto-increment sort_order
        let max_order: i32 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM windows WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        self.conn
            .execute(
                "INSERT INTO windows (id, session_id, title, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![id, session_id, title, max_order + 1],
            )
            .map_err(|e| format!("Insert window: {}", e))?;

        self.get_window(&id)
    }

    pub fn get_window(&self, id: &str) -> Result<Window, String> {
        self.conn
            .query_row(
                "SELECT id, session_id, title, sort_order, layout_type FROM windows WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Window {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        title: row.get(2)?,
                        sort_order: row.get(3)?,
                        layout_type: row.get(4)?,
                    })
                },
            )
            .map_err(|e| format!("Get window: {}", e))
    }

    pub fn list_windows(&self, session_id: &str) -> Result<Vec<Window>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, session_id, title, sort_order, layout_type FROM windows WHERE session_id = ?1 ORDER BY sort_order",
            )
            .map_err(|e| format!("Prepare: {}", e))?;

        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(Window {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    sort_order: row.get(3)?,
                    layout_type: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    pub fn update_window_layout(&self, id: &str, layout_type: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE windows SET layout_type = ?1 WHERE id = ?2",
                params![layout_type, id],
            )
            .map_err(|e| format!("Update layout: {}", e))?;
        Ok(())
    }

    // --- Pane CRUD ---

    pub fn create_pane(
        &self,
        window_id: &str,
        shell_type: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Pane, String> {
        let id = Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO panes (id, window_id, shell_type, cwd, cols, rows) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, window_id, shell_type, cwd, cols, rows],
            )
            .map_err(|e| format!("Insert pane: {}", e))?;

        self.get_pane(&id)
    }

    pub fn get_pane(&self, id: &str) -> Result<Pane, String> {
        self.conn
            .query_row(
                "SELECT id, window_id, shell_type, cwd, cols, rows, flex_basis, position FROM panes WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Pane {
                        id: row.get(0)?,
                        window_id: row.get(1)?,
                        shell_type: row.get(2)?,
                        cwd: row.get(3)?,
                        cols: row.get::<_, u16>(4)?,
                        rows: row.get::<_, u16>(5)?,
                        flex_basis: row.get(6)?,
                        position: row.get(7)?,
                    })
                },
            )
            .map_err(|e| format!("Get pane: {}", e))
    }

    pub fn list_panes(&self, window_id: &str) -> Result<Vec<Pane>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, window_id, shell_type, cwd, cols, rows, flex_basis, position FROM panes WHERE window_id = ?1",
            )
            .map_err(|e| format!("Prepare: {}", e))?;

        let rows = stmt
            .query_map(params![window_id], |row| {
                Ok(Pane {
                    id: row.get(0)?,
                    window_id: row.get(1)?,
                    shell_type: row.get(2)?,
                    cwd: row.get(3)?,
                    cols: row.get::<_, u16>(4)?,
                    rows: row.get::<_, u16>(5)?,
                    flex_basis: row.get(6)?,
                    position: row.get(7)?,
                })
            })
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    pub fn update_pane_layout(
        &self,
        id: &str,
        flex_basis: f64,
        position: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE panes SET flex_basis = ?1, position = ?2 WHERE id = ?3",
                params![flex_basis, position, id],
            )
            .map_err(|e| format!("Update pane layout: {}", e))?;
        Ok(())
    }

    pub fn delete_pane(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM panes WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete pane: {}", e))?;
        Ok(())
    }

    // --- Pane tree layout snapshots ---

    pub fn save_pane_tree_layout(
        &self,
        storage_key: &str,
        project_path: &str,
        layout_json: &str,
    ) -> Result<(), String> {
        validate_pane_layout_key(storage_key)?;
        validate_pane_layout_json(layout_json)?;
        self.conn
            .execute(
                "INSERT INTO pane_tree_layouts (storage_key, project_path, layout_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(storage_key) DO UPDATE SET
                    project_path = excluded.project_path,
                    layout_json = excluded.layout_json,
                    updated_at = datetime('now')",
                params![storage_key, project_path, layout_json],
            )
            .map_err(|e| format!("Save pane tree layout: {}", e))?;
        Ok(())
    }

    pub fn get_pane_tree_layout(
        &self,
        storage_key: &str,
    ) -> Result<Option<PaneTreeLayoutRecord>, String> {
        validate_pane_layout_key(storage_key)?;
        self.conn
            .query_row(
                "SELECT storage_key, project_path, layout_json, updated_at
                 FROM pane_tree_layouts
                 WHERE storage_key = ?1",
                params![storage_key],
                |row| {
                    Ok(PaneTreeLayoutRecord {
                        storage_key: row.get(0)?,
                        project_path: row.get(1)?,
                        layout_json: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Get pane tree layout: {}", e))
    }

    pub fn delete_pane_tree_layout(&self, storage_key: &str) -> Result<(), String> {
        validate_pane_layout_key(storage_key)?;
        self.conn
            .execute(
                "DELETE FROM pane_tree_layouts WHERE storage_key = ?1",
                params![storage_key],
            )
            .map_err(|e| format!("Delete pane tree layout: {}", e))?;
        Ok(())
    }

    // --- Restore ---

    /// Restore the most recent active session with all windows and panes
    pub fn restore_last_session(&self) -> Result<Option<RestoredSession>, String> {
        let sessions = self.list_sessions()?;
        let session = match sessions.into_iter().find(|s| s.is_active) {
            Some(s) => s,
            None => return Ok(None),
        };

        self.restore_session(&session.id)
    }

    /// Restore a specific session by ID
    pub fn restore_session(&self, session_id: &str) -> Result<Option<RestoredSession>, String> {
        let session = match self.get_session(session_id) {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };

        let windows = self.list_windows(&session.id)?;
        let mut restored_windows = Vec::new();

        for window in windows {
            let panes = self.list_panes(&window.id)?;
            restored_windows.push(RestoredWindow { window, panes });
        }

        Ok(Some(RestoredSession {
            session,
            windows: restored_windows,
        }))
    }

    /// Mark all sessions as inactive (called on clean shutdown)
    pub fn deactivate_all_sessions(&self) -> Result<(), String> {
        self.conn
            .execute("UPDATE sessions SET is_active = 0", [])
            .map_err(|e| format!("Deactivate: {}", e))?;
        Ok(())
    }

    // --- Agent Session persistence ---

    /// Save an agent session to the database
    pub fn save_agent_session(
        &self,
        id: &str,
        model: &str,
        prompt: &str,
        status: &str,
        cost: f64,
        tokens_used: u64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO agent_sessions (id, model, prompt, status, cost, tokens_used) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, model, prompt, status, cost, tokens_used as i64],
            )
            .map_err(|e| format!("Save agent session: {}", e))?;
        Ok(())
    }

    /// Update agent session status and cost
    pub fn update_agent_session(
        &self,
        id: &str,
        status: &str,
        cost: f64,
        tokens_used: u64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE agent_sessions SET status = ?1, cost = ?2, tokens_used = ?3 WHERE id = ?4",
                params![status, cost, tokens_used as i64, id],
            )
            .map_err(|e| format!("Update agent session: {}", e))?;
        Ok(())
    }

    /// Mark agent session as ended
    pub fn end_agent_session(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE agent_sessions SET status = 'done', ended_at = datetime('now') WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("End agent session: {}", e))?;
        Ok(())
    }

    /// List recent agent sessions (for session history display)
    pub fn list_agent_sessions(&self, limit: usize) -> Result<Vec<AgentSessionRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, model, prompt, status, cost, tokens_used, started_at, ended_at FROM agent_sessions ORDER BY started_at DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(AgentSessionRecord {
                    id: row.get(0)?,
                    model: row.get(1)?,
                    prompt: row.get(2)?,
                    status: row.get(3)?,
                    cost: row.get(4)?,
                    tokens_used: row.get::<_, i64>(5)? as u64,
                    started_at: row.get(6)?,
                    ended_at: row.get(7)?,
                })
            })
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    /// Persist a bounded frontend-enriched telemetry snapshot for recovery
    /// after localStorage loss or WebView profile reset.
    pub fn save_agent_telemetry_snapshot(&self, snapshot_json: &str) -> Result<(), String> {
        validate_agent_telemetry_snapshot(snapshot_json)?;
        self.conn
            .execute(
                "INSERT INTO agent_telemetry_snapshots (snapshot_json, source)
                 VALUES (?1, 'frontend')",
                params![snapshot_json],
            )
            .map_err(|e| format!("Save agent telemetry snapshot: {}", e))?;
        self.conn
            .execute(
                "DELETE FROM agent_telemetry_snapshots
                 WHERE id NOT IN (
                    SELECT id FROM agent_telemetry_snapshots
                    ORDER BY id DESC
                    LIMIT 20
                 )",
                [],
            )
            .map_err(|e| format!("Prune agent telemetry snapshots: {}", e))?;
        Ok(())
    }

    pub fn list_agent_telemetry_snapshots(
        &self,
        limit: usize,
    ) -> Result<Vec<AgentTelemetrySnapshotRecord>, String> {
        let bounded = limit.clamp(1, 20);
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, snapshot_json, source, saved_at
                 FROM agent_telemetry_snapshots
                 ORDER BY id DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Prepare agent telemetry snapshots: {}", e))?;

        let rows = stmt
            .query_map(params![bounded as i64], |row| {
                Ok(AgentTelemetrySnapshotRecord {
                    id: row.get(0)?,
                    snapshot_json: row.get(1)?,
                    source: row.get(2)?,
                    saved_at: row.get(3)?,
                })
            })
            .map_err(|e| format!("Query agent telemetry snapshots: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect agent telemetry snapshots: {}", e))
    }

    // --- Command History ---

    /// Save a command to history
    pub fn save_command(&self, terminal_id: &str, command: &str, cwd: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO command_history (terminal_id, command, cwd) VALUES (?1, ?2, ?3)",
                params![terminal_id, command, cwd],
            )
            .map_err(|e| format!("Save command: {}", e))?;
        Ok(())
    }

    /// Return the id of the most recent command_history row that matches the
    /// given (terminal_id, command) pair. Used by the semantic indexer to
    /// attach an embedding to the row we just inserted.
    pub fn last_command_id_for(
        &self,
        terminal_id: &str,
        command: &str,
    ) -> Result<Option<i64>, String> {
        self.conn
            .query_row(
                "SELECT id FROM command_history
                 WHERE terminal_id = ?1 AND command = ?2
                 ORDER BY id DESC LIMIT 1",
                params![terminal_id, command],
                |r| r.get::<_, i64>(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                _ => Err(format!("last_command_id_for: {e}")),
            })
    }

    /// Search command history by substring match
    pub fn search_commands(&self, query: &str, limit: usize) -> Result<Vec<CommandRecord>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, terminal_id, command, cwd, exit_code, executed_at FROM command_history WHERE command LIKE ?1 ORDER BY executed_at DESC LIMIT ?2",
            )
            .map_err(|e| format!("Prepare: {}", e))?;

        let pattern = format!("%{}%", query);
        let rows = stmt
            .query_map(params![pattern, limit as i64], |row| {
                Ok(CommandRecord {
                    id: row.get(0)?,
                    terminal_id: row.get(1)?,
                    command: row.get(2)?,
                    cwd: row.get(3)?,
                    exit_code: row.get(4)?,
                    executed_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    /// Get recent commands (for suggestions)
    pub fn recent_commands(&self, limit: usize) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT command FROM command_history ORDER BY executed_at DESC LIMIT ?1",
            )
            .map_err(|e| format!("Prepare: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| row.get(0))
            .map_err(|e| format!("Query: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect: {}", e))
    }

    // --- Activity Log ---

    /// Save an activity event to persistent storage.
    pub fn save_activity(
        &self,
        session_name: &str,
        event_type: &str,
        summary: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO activity_log (session_name, event_type, summary) VALUES (?1, ?2, ?3)",
                params![session_name, event_type, summary],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Save a usage record to persistent storage.
    pub fn save_usage(&self, cli: &str, cost: f64, tokens: u64) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO usage_log (cli, cost, tokens) VALUES (?1, ?2, ?3)",
                params![cli, cost, tokens as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Retrieve recent activity entries (timestamp, session_name, event_type, summary).
    pub fn recent_activity(
        &self,
        limit: usize,
    ) -> Result<Vec<(String, String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT timestamp, session_name, event_type, summary FROM activity_log ORDER BY id DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Get total usage across all CLI sessions (total_cost, total_tokens).
    pub fn total_usage(&self) -> Result<(f64, i64), String> {
        let mut stmt = self
            .conn
            .prepare("SELECT COALESCE(SUM(cost), 0), COALESCE(SUM(tokens), 0) FROM usage_log")
            .map_err(|e| e.to_string())?;
        stmt.query_row([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())
    }

    // --- Audit Events ---

    /// Save a structured operational audit event. Metadata must already be
    /// redacted by the caller when the source may contain terminal input.
    pub fn save_audit_event(
        &self,
        category: &str,
        action: &str,
        severity: &str,
        entity_type: Option<&str>,
        entity_id: Option<&str>,
        summary: &str,
        metadata: &serde_json::Value,
    ) -> Result<(), String> {
        validate_audit_atom("category", category)?;
        validate_audit_atom("action", action)?;
        validate_audit_atom("severity", severity)?;
        let metadata =
            audit_metadata_with_correlation(category, action, entity_type, entity_id, metadata);
        let metadata_json = serde_json::to_string(&metadata)
            .map_err(|e| format!("Serialize audit metadata: {}", e))?;
        self.conn
            .execute(
                "INSERT INTO audit_events
                    (category, action, severity, entity_type, entity_id, summary, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    category,
                    action,
                    severity,
                    entity_type,
                    entity_id,
                    summary,
                    metadata_json
                ],
            )
            .map_err(|e| format!("Save audit event: {}", e))?;
        Ok(())
    }

    /// Persist a bounded PTY output chunk so crash/restart review has an
    /// authoritative trail outside the in-memory alacritty grid. Callers
    /// should batch before invoking this; this method also clamps oversized
    /// rows and prunes oldest rows per terminal to keep the DB bounded.
    pub fn save_terminal_output_chunk(
        &self,
        terminal_id: &str,
        text: &str,
        byte_count: usize,
        chunk_count: usize,
    ) -> Result<(), String> {
        validate_audit_atom("terminal id", terminal_id)?;
        if text.is_empty() {
            return Ok(());
        }
        let bounded_text = clamp_utf8_bytes(text, MAX_TERMINAL_OUTPUT_JOURNAL_TEXT_BYTES);
        self.conn
            .execute(
                "INSERT INTO terminal_output_journal
                    (terminal_id, byte_count, chunk_count, text)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    terminal_id,
                    byte_count.min(i64::MAX as usize) as i64,
                    chunk_count.min(i64::MAX as usize) as i64,
                    bounded_text
                ],
            )
            .map_err(|e| format!("Insert terminal output journal: {}", e))?;
        self.conn
            .execute(
                "DELETE FROM terminal_output_journal
                 WHERE terminal_id = ?1
                   AND id NOT IN (
                     SELECT id FROM terminal_output_journal
                     WHERE terminal_id = ?1
                     ORDER BY id DESC
                     LIMIT ?2
                   )",
                params![
                    terminal_id,
                    MAX_TERMINAL_OUTPUT_JOURNAL_ROWS_PER_TERMINAL as i64
                ],
            )
            .map_err(|e| format!("Prune terminal output journal: {}", e))?;
        Ok(())
    }

    pub fn recent_audit_events(&self, limit: usize) -> Result<Vec<AuditEventRecord>, String> {
        self.query_audit_events(limit, None, None, None)
    }

    pub fn query_audit_events(
        &self,
        limit: usize,
        category: Option<&str>,
        severity: Option<&str>,
        entity_id: Option<&str>,
    ) -> Result<Vec<AuditEventRecord>, String> {
        if let Some(category) = category {
            validate_audit_atom("category filter", category)?;
        }
        if let Some(severity) = severity {
            validate_audit_atom("severity filter", severity)?;
        }
        if let Some(entity_id) = entity_id {
            validate_audit_atom("entity id filter", entity_id)?;
        }
        let bounded = limit.clamp(1, 500);
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, timestamp, category, action, severity,
                        entity_type, entity_id, summary, metadata
                 FROM audit_events
                 WHERE (?2 IS NULL OR category = ?2)
                   AND (?3 IS NULL OR severity = ?3)
                   AND (?4 IS NULL OR entity_id = ?4)
                 ORDER BY id DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Prepare audit events: {}", e))?;
        let rows = stmt
            .query_map(
                params![bounded as i64, category, severity, entity_id],
                |row| {
                    let metadata_text: String = row.get(8)?;
                    let metadata = serde_json::from_str(&metadata_text)
                        .unwrap_or_else(|_| serde_json::json!({ "parseError": true }));
                    Ok(AuditEventRecord {
                        id: row.get(0)?,
                        timestamp: row.get(1)?,
                        category: row.get(2)?,
                        action: row.get(3)?,
                        severity: row.get(4)?,
                        entity_type: row.get(5)?,
                        entity_id: row.get(6)?,
                        summary: row.get(7)?,
                        metadata,
                    })
                },
            )
            .map_err(|e| format!("Query audit events: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect audit events: {}", e))
    }

    // --- Authoritative audit event journal ---

    pub fn append_audit_journal_event(
        &self,
        event: &AuditJournalAppend,
    ) -> Result<AuditJournalEventRecord, String> {
        validate_audit_journal_append(event)?;
        let sequence = self.next_audit_sequence()?;
        let confidence = event.confidence.unwrap_or(1.0);
        let correlation_id = event
            .correlation_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "{}:{}:{}",
                    sanitize_correlation_part(&event.workspace_id),
                    sanitize_correlation_part(&event.kind),
                    sequence
                )
            });
        validate_audit_journal_id("correlation_id", &correlation_id)?;

        let payload_json = canonical_json(&event.payload_json)?;
        let redacted_payload = redact_audit_payload(&event.payload_json);
        let redacted_payload_json = canonical_json(&redacted_payload)?;
        let created_at = self.audit_now()?;
        let hash = audit_journal_hash(&[
            sequence.to_string(),
            event.workspace_id.trim().to_string(),
            correlation_id.clone(),
            event.kind.trim().to_string(),
            event.severity.trim().to_string(),
            event.source.trim().to_string(),
            format!("{confidence:.6}"),
            created_at.clone(),
            payload_json.clone(),
            redacted_payload_json.clone(),
        ]);

        self.conn
            .execute(
                "INSERT INTO audit_event_journal
                    (workspace_id, thread_id, session_id, pane_id, terminal_id,
                     agent_id, workflow_id, task_id, correlation_id, sequence,
                     kind, severity, source, confidence, created_at, payload_json,
                     redacted_payload_json, hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    event.workspace_id.trim(),
                    trimmed_optional(event.thread_id.as_deref()),
                    trimmed_optional(event.session_id.as_deref()),
                    trimmed_optional(event.pane_id.as_deref()),
                    trimmed_optional(event.terminal_id.as_deref()),
                    trimmed_optional(event.agent_id.as_deref()),
                    trimmed_optional(event.workflow_id.as_deref()),
                    trimmed_optional(event.task_id.as_deref()),
                    correlation_id,
                    sequence,
                    event.kind.trim(),
                    event.severity.trim(),
                    event.source.trim(),
                    confidence,
                    created_at,
                    payload_json,
                    redacted_payload_json,
                    hash,
                ],
            )
            .map_err(|e| format!("Append audit journal event: {}", e))?;

        self.get_audit_journal_event_by_sequence(sequence)
    }

    pub fn append_audit_journal_events(
        &self,
        events: &[AuditJournalAppend],
    ) -> Result<Vec<AuditJournalEventRecord>, String> {
        events
            .iter()
            .map(|event| self.append_audit_journal_event(event))
            .collect()
    }

    pub fn list_audit_journal_events(
        &self,
        filter: &AuditJournalFilter,
    ) -> Result<Vec<AuditJournalEventRecord>, String> {
        validate_audit_journal_filter(filter)?;
        let bounded = filter.limit.unwrap_or(100).clamp(1, 500);
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, workspace_id, thread_id, session_id, pane_id, terminal_id,
                        agent_id, workflow_id, task_id, correlation_id, sequence,
                        kind, severity, source, confidence, created_at,
                        redacted_payload_json, hash
                 FROM audit_event_journal
                 WHERE (?2 IS NULL OR workspace_id = ?2)
                   AND (?3 IS NULL OR thread_id = ?3)
                   AND (?4 IS NULL OR session_id = ?4)
                   AND (?5 IS NULL OR pane_id = ?5)
                   AND (?6 IS NULL OR terminal_id = ?6)
                   AND (?7 IS NULL OR agent_id = ?7)
                   AND (?8 IS NULL OR workflow_id = ?8)
                   AND (?9 IS NULL OR task_id = ?9)
                   AND (?10 IS NULL OR correlation_id = ?10)
                   AND (?11 IS NULL OR kind = ?11)
                   AND (?12 IS NULL OR severity = ?12)
                   AND (?13 IS NULL OR source = ?13)
                   AND (?14 IS NULL OR sequence > ?14)
                   AND (?15 IS NULL OR sequence < ?15)
                 ORDER BY sequence ASC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Prepare audit journal events: {}", e))?;
        let rows = stmt
            .query_map(
                params![
                    bounded as i64,
                    filter.workspace_id.as_deref(),
                    filter.thread_id.as_deref(),
                    filter.session_id.as_deref(),
                    filter.pane_id.as_deref(),
                    filter.terminal_id.as_deref(),
                    filter.agent_id.as_deref(),
                    filter.workflow_id.as_deref(),
                    filter.task_id.as_deref(),
                    filter.correlation_id.as_deref(),
                    filter.kind.as_deref(),
                    filter.severity.as_deref(),
                    filter.source.as_deref(),
                    filter.after_sequence,
                    filter.before_sequence,
                ],
                audit_journal_row,
            )
            .map_err(|e| format!("Query audit journal events: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect audit journal events: {}", e))
    }

    pub fn get_audit_trace(
        &self,
        correlation_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<Vec<AuditJournalEventRecord>, String> {
        validate_audit_journal_id("correlation_id", correlation_id)?;
        if let Some(workspace_id) = workspace_id {
            validate_audit_journal_id("workspace_id", workspace_id)?;
        }
        self.list_audit_journal_events(&AuditJournalFilter {
            workspace_id: workspace_id.map(ToOwned::to_owned),
            correlation_id: Some(correlation_id.to_string()),
            limit: Some(500),
            ..empty_audit_journal_filter()
        })
    }

    pub fn get_latest_audit_snapshot(
        &self,
        workspace_id: &str,
    ) -> Result<AuditJournalSnapshotRecord, String> {
        validate_audit_journal_id("workspace_id", workspace_id)?;
        let existing = self
            .conn
            .query_row(
                "SELECT id, workspace_id, through_sequence, event_count, snapshot_json, created_at
                 FROM audit_event_snapshots
                 WHERE workspace_id = ?1
                 ORDER BY through_sequence DESC, id DESC
                 LIMIT 1",
                params![workspace_id],
                audit_snapshot_row,
            )
            .optional()
            .map_err(|e| format!("Get latest audit snapshot: {}", e))?;
        let latest_sequence = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sequence), 0)
                 FROM audit_event_journal
                 WHERE workspace_id = ?1",
                params![workspace_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("Get latest audit event sequence: {}", e))?;
        match existing {
            Some(snapshot) if snapshot.through_sequence >= latest_sequence => Ok(snapshot),
            _ => self.rebuild_audit_snapshot_from_events(workspace_id),
        }
    }

    pub fn rebuild_audit_snapshot_from_events(
        &self,
        workspace_id: &str,
    ) -> Result<AuditJournalSnapshotRecord, String> {
        validate_audit_journal_id("workspace_id", workspace_id)?;
        self.rebuild_audit_snapshot_until(workspace_id, None)
    }

    pub fn compact_audit_event_journal(
        &self,
        workspace_id: &str,
        before_sequence: i64,
    ) -> Result<AuditJournalCompactResult, String> {
        validate_audit_journal_id("workspace_id", workspace_id)?;
        if before_sequence <= 0 {
            return Err("Audit compact before_sequence must be positive".to_string());
        }
        let snapshot = self.rebuild_audit_snapshot_until(workspace_id, Some(before_sequence))?;
        let compacted_count =
            self.conn
                .execute(
                    "DELETE FROM audit_event_journal
                 WHERE workspace_id = ?1 AND sequence < ?2",
                    params![workspace_id, before_sequence],
                )
                .map_err(|e| format!("Compact audit journal: {}", e))? as i64;
        Ok(AuditJournalCompactResult {
            workspace_id: workspace_id.to_string(),
            before_sequence,
            compacted_count,
            snapshot,
        })
    }

    fn next_audit_sequence(&self) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO audit_event_sequence (id, next_sequence) VALUES (1, 1)",
                [],
            )
            .map_err(|e| format!("Seed audit sequence: {}", e))?;
        self.conn
            .execute(
                "UPDATE audit_event_sequence
                 SET next_sequence = next_sequence + 1
                 WHERE id = 1",
                [],
            )
            .map_err(|e| format!("Advance audit sequence: {}", e))?;
        self.conn
            .query_row(
                "SELECT next_sequence - 1 FROM audit_event_sequence WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Read audit sequence: {}", e))
    }

    fn audit_now(&self) -> Result<String, String> {
        self.conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Read audit timestamp: {}", e))
    }

    fn get_audit_journal_event_by_sequence(
        &self,
        sequence: i64,
    ) -> Result<AuditJournalEventRecord, String> {
        self.conn
            .query_row(
                "SELECT id, workspace_id, thread_id, session_id, pane_id, terminal_id,
                        agent_id, workflow_id, task_id, correlation_id, sequence,
                        kind, severity, source, confidence, created_at,
                        redacted_payload_json, hash
                 FROM audit_event_journal
                 WHERE sequence = ?1",
                params![sequence],
                audit_journal_row,
            )
            .map_err(|e| format!("Get audit journal event: {}", e))
    }

    fn rebuild_audit_snapshot_until(
        &self,
        workspace_id: &str,
        before_sequence: Option<i64>,
    ) -> Result<AuditJournalSnapshotRecord, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, workspace_id, thread_id, session_id, pane_id, terminal_id,
                        agent_id, workflow_id, task_id, correlation_id, sequence,
                        kind, severity, source, confidence, created_at,
                        redacted_payload_json, hash
                 FROM audit_event_journal
                 WHERE workspace_id = ?1
                   AND (?2 IS NULL OR sequence < ?2)
                 ORDER BY sequence ASC",
            )
            .map_err(|e| format!("Prepare audit snapshot rebuild: {}", e))?;
        let rows = stmt
            .query_map(params![workspace_id, before_sequence], audit_journal_row)
            .map_err(|e| format!("Query audit snapshot rebuild: {}", e))?;
        let events = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Collect audit snapshot rebuild: {}", e))?;
        let snapshot_json = build_audit_snapshot_json(workspace_id, &events);
        let through_sequence = events.last().map(|event| event.sequence).unwrap_or(0);
        let event_count = events.len() as i64;
        let snapshot_text = canonical_json(&snapshot_json)?;
        self.conn
            .execute(
                "INSERT INTO audit_event_snapshots
                    (workspace_id, through_sequence, event_count, snapshot_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![workspace_id, through_sequence, event_count, snapshot_text],
            )
            .map_err(|e| format!("Save audit snapshot: {}", e))?;
        let id = self.conn.last_insert_rowid();
        self.conn
            .query_row(
                "SELECT id, workspace_id, through_sequence, event_count, snapshot_json, created_at
                 FROM audit_event_snapshots
                 WHERE id = ?1",
                params![id],
                audit_snapshot_row,
            )
            .map_err(|e| format!("Read audit snapshot: {}", e))
    }
}

fn audit_journal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditJournalEventRecord> {
    let redacted_payload_text: String = row.get(16)?;
    let redacted_payload_json = serde_json::from_str(&redacted_payload_text)
        .unwrap_or_else(|_| serde_json::json!({ "parseError": true }));
    Ok(AuditJournalEventRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        thread_id: row.get(2)?,
        session_id: row.get(3)?,
        pane_id: row.get(4)?,
        terminal_id: row.get(5)?,
        agent_id: row.get(6)?,
        workflow_id: row.get(7)?,
        task_id: row.get(8)?,
        correlation_id: row.get(9)?,
        sequence: row.get(10)?,
        kind: row.get(11)?,
        severity: row.get(12)?,
        source: row.get(13)?,
        confidence: row.get(14)?,
        created_at: row.get(15)?,
        redacted_payload_json,
        hash: row.get(17)?,
    })
}

fn audit_snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditJournalSnapshotRecord> {
    let snapshot_text: String = row.get(4)?;
    let snapshot_json = serde_json::from_str(&snapshot_text)
        .unwrap_or_else(|_| serde_json::json!({ "parseError": true }));
    Ok(AuditJournalSnapshotRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        through_sequence: row.get(2)?,
        event_count: row.get(3)?,
        snapshot_json,
        created_at: row.get(5)?,
    })
}

fn empty_audit_journal_filter() -> AuditJournalFilter {
    AuditJournalFilter {
        workspace_id: None,
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: None,
        workflow_id: None,
        task_id: None,
        correlation_id: None,
        kind: None,
        severity: None,
        source: None,
        after_sequence: None,
        before_sequence: None,
        limit: None,
    }
}

fn validate_audit_journal_append(event: &AuditJournalAppend) -> Result<(), String> {
    validate_audit_journal_id("workspace_id", &event.workspace_id)?;
    validate_optional_audit_journal_id("thread_id", event.thread_id.as_deref())?;
    validate_optional_audit_journal_id("session_id", event.session_id.as_deref())?;
    validate_optional_audit_journal_id("pane_id", event.pane_id.as_deref())?;
    validate_optional_audit_journal_id("terminal_id", event.terminal_id.as_deref())?;
    validate_optional_audit_journal_id("agent_id", event.agent_id.as_deref())?;
    validate_optional_audit_journal_id("workflow_id", event.workflow_id.as_deref())?;
    validate_optional_audit_journal_id("task_id", event.task_id.as_deref())?;
    validate_optional_audit_journal_id("correlation_id", event.correlation_id.as_deref())?;
    validate_audit_journal_label("kind", &event.kind)?;
    validate_audit_atom("severity", &event.severity)?;
    validate_audit_atom("source", &event.source)?;
    let confidence = event.confidence.unwrap_or(1.0);
    if !confidence.is_finite() || !(0.0..=1.0).contains(&confidence) {
        return Err("Audit confidence must be between 0 and 1".to_string());
    }
    if !event.payload_json.is_object() {
        return Err("Audit payload_json must be a JSON object".to_string());
    }
    let payload_json = canonical_json(&event.payload_json)?;
    if payload_json.len() > MAX_AUDIT_JOURNAL_PAYLOAD_BYTES {
        return Err("Audit payload_json is too large".to_string());
    }
    Ok(())
}

fn validate_audit_journal_filter(filter: &AuditJournalFilter) -> Result<(), String> {
    validate_optional_audit_journal_id("workspace_id", filter.workspace_id.as_deref())?;
    validate_optional_audit_journal_id("thread_id", filter.thread_id.as_deref())?;
    validate_optional_audit_journal_id("session_id", filter.session_id.as_deref())?;
    validate_optional_audit_journal_id("pane_id", filter.pane_id.as_deref())?;
    validate_optional_audit_journal_id("terminal_id", filter.terminal_id.as_deref())?;
    validate_optional_audit_journal_id("agent_id", filter.agent_id.as_deref())?;
    validate_optional_audit_journal_id("workflow_id", filter.workflow_id.as_deref())?;
    validate_optional_audit_journal_id("task_id", filter.task_id.as_deref())?;
    validate_optional_audit_journal_id("correlation_id", filter.correlation_id.as_deref())?;
    if let Some(kind) = &filter.kind {
        validate_audit_journal_label("kind filter", kind)?;
    }
    if let Some(severity) = &filter.severity {
        validate_audit_atom("severity filter", severity)?;
    }
    if let Some(source) = &filter.source {
        validate_audit_atom("source filter", source)?;
    }
    Ok(())
}

fn validate_optional_audit_journal_id(field: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        if !value.trim().is_empty() {
            validate_audit_journal_id(field, value)?;
        }
    }
    Ok(())
}

fn validate_audit_journal_id(field: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Audit {} is required", field));
    }
    if trimmed.len() > MAX_AUDIT_JOURNAL_ID_BYTES {
        return Err(format!("Audit {} is too long", field));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(format!(
            "Audit {} contains unsupported control characters",
            field
        ));
    }
    Ok(())
}

fn validate_audit_journal_label(field: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Audit {} is required", field));
    }
    if trimmed.len() > 96 {
        return Err(format!("Audit {} is too long", field));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(format!(
            "Audit {} contains unsupported control characters",
            field
        ));
    }
    Ok(())
}

fn trimmed_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn canonical_json(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("Serialize audit JSON: {}", e))
}

fn redact_audit_payload(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut redacted = serde_json::Map::new();
            for (key, value) in map {
                let next = if is_sensitive_payload_key(key) {
                    serde_json::Value::String("[REDACTED]".to_string())
                } else {
                    redact_audit_payload(value)
                };
                redacted.insert(key.clone(), next);
            }
            serde_json::Value::Object(redacted)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(redact_audit_payload).collect())
        }
        serde_json::Value::String(value) => redact_audit_string(value),
        _ => value.clone(),
    }
}

fn is_sensitive_payload_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    matches!(
        key.as_str(),
        "authorization"
            | "cmd"
            | "command"
            | "content"
            | "env"
            | "environment"
            | "file_content"
            | "filecontent"
            | "input"
            | "key"
            | "password"
            | "prompt"
            | "secret"
            | "stderr"
            | "stdin"
            | "stdout"
            | "text"
            | "token"
    ) || key.ends_with("_key")
        || key.ends_with("_secret")
        || key.ends_with("_token")
        || key.contains("api_key")
}

fn redact_audit_string(value: &str) -> serde_json::Value {
    let lower = value.to_ascii_lowercase();
    if value.len() > 2048
        || lower.contains("bearer ")
        || lower.contains("api_key")
        || lower.contains("password=")
        || lower.contains("token=")
        || lower.contains("sk-")
    {
        serde_json::Value::String("[REDACTED]".to_string())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn audit_journal_hash(parts: &[String]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for part in parts {
        for byte in part.as_bytes().iter().copied().chain(std::iter::once(0)) {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("fnv1a64:{hash:016x}")
}

fn build_audit_snapshot_json(
    workspace_id: &str,
    events: &[AuditJournalEventRecord],
) -> serde_json::Value {
    let mut by_kind: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_severity: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_source: BTreeMap<String, i64> = BTreeMap::new();
    let mut active_roadmap_id: Option<String> = None;
    let mut done_count: Option<i64> = None;
    let mut last_session_status: Option<String> = None;
    let mut last_correlation_id: Option<String> = None;
    for event in events {
        *by_kind.entry(event.kind.clone()).or_default() += 1;
        *by_severity.entry(event.severity.clone()).or_default() += 1;
        *by_source.entry(event.source.clone()).or_default() += 1;
        last_correlation_id = Some(event.correlation_id.clone());
        if let Some(value) = event.redacted_payload_json.get("activeRoadmapId") {
            active_roadmap_id = value.as_str().map(ToOwned::to_owned);
        }
        if let Some(value) = event
            .redacted_payload_json
            .get("doneCount")
            .and_then(|value| value.as_i64())
        {
            done_count = Some(value);
        }
        if event.kind == "session_complete" {
            last_session_status = Some("complete".to_string());
        } else if let Some(value) = event
            .redacted_payload_json
            .get("sessionStatus")
            .and_then(|value| value.as_str())
        {
            last_session_status = Some(value.to_string());
        }
    }
    let mut recent_events: Vec<_> = events
        .iter()
        .rev()
        .take(25)
        .map(|event| {
            serde_json::json!({
                "sequence": event.sequence,
                "createdAt": event.created_at,
                "correlationId": event.correlation_id,
                "kind": event.kind,
                "severity": event.severity,
                "source": event.source,
                "taskId": event.task_id,
                "agentId": event.agent_id,
                "terminalId": event.terminal_id,
                "redactedPayloadJson": event.redacted_payload_json,
                "hash": event.hash,
            })
        })
        .collect();
    recent_events.reverse();
    serde_json::json!({
        "workspaceId": workspace_id,
        "eventCount": events.len(),
        "firstSequence": events.first().map(|event| event.sequence),
        "lastSequence": events.last().map(|event| event.sequence).unwrap_or(0),
        "counts": {
            "byKind": by_kind,
            "bySeverity": by_severity,
            "bySource": by_source,
        },
        "replayState": {
            "activeRoadmapId": active_roadmap_id,
            "doneCount": done_count,
            "lastSessionStatus": last_session_status,
            "lastCorrelationId": last_correlation_id,
        },
        "recentEvents": recent_events,
    })
}

fn validate_pane_layout_key(storage_key: &str) -> Result<(), String> {
    if storage_key.trim().is_empty() {
        return Err("Pane layout storage key is required".to_string());
    }
    if storage_key.len() > MAX_PANE_LAYOUT_KEY_BYTES {
        return Err("Pane layout storage key is too long".to_string());
    }
    Ok(())
}

fn validate_audit_atom(field: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Audit {} is required", field));
    }
    if trimmed.len() > 64 {
        return Err(format!("Audit {} is too long", field));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(format!("Audit {} contains unsupported characters", field));
    }
    Ok(())
}

fn validate_agent_telemetry_snapshot(snapshot_json: &str) -> Result<(), String> {
    if snapshot_json.len() > MAX_AGENT_TELEMETRY_JSON_BYTES {
        return Err("Agent telemetry snapshot is too large".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(snapshot_json)
        .map_err(|e| format!("Agent telemetry snapshot is invalid JSON: {}", e))?;
    if !value.is_object() {
        return Err("Agent telemetry snapshot must be a JSON object".to_string());
    }
    Ok(())
}

fn clamp_utf8_bytes(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    &value[..end]
}

fn audit_metadata_with_correlation(
    category: &str,
    action: &str,
    entity_type: Option<&str>,
    entity_id: Option<&str>,
    metadata: &serde_json::Value,
) -> serde_json::Value {
    let mut metadata = metadata
        .as_object()
        .cloned()
        .unwrap_or_else(serde_json::Map::new);
    metadata
        .entry("correlationId".to_string())
        .or_insert_with(|| {
            serde_json::Value::String(audit_correlation_id(
                category,
                action,
                entity_type,
                entity_id,
            ))
        });
    serde_json::Value::Object(metadata)
}

fn audit_correlation_id(
    category: &str,
    action: &str,
    entity_type: Option<&str>,
    entity_id: Option<&str>,
) -> String {
    let category = sanitize_correlation_part(category);
    let action = sanitize_correlation_part(action);
    match (entity_type, entity_id) {
        (Some(entity_type), Some(entity_id)) => format!(
            "{}:{}:{}",
            category,
            sanitize_correlation_part(entity_type),
            sanitize_correlation_part(entity_id)
        ),
        (_, Some(entity_id)) => format!("{}:{}", category, sanitize_correlation_part(entity_id)),
        _ => format!("{}:{}", category, action),
    }
}

fn sanitize_correlation_part(value: &str) -> String {
    let sanitized: String = value
        .trim()
        .chars()
        .take(64)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

fn validate_pane_layout_json(layout_json: &str) -> Result<(), String> {
    if layout_json.len() > MAX_PANE_LAYOUT_JSON_BYTES {
        return Err("Pane layout snapshot is too large".to_string());
    }
    serde_json::from_str::<serde_json::Value>(layout_json)
        .map_err(|e| format!("Pane layout snapshot is invalid JSON: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_history_save_and_search() {
        let db = Database::open_memory().unwrap();
        db.save_command("term-1", "git status", "/project").unwrap();
        db.save_command("term-1", "git add -A", "/project").unwrap();
        db.save_command("term-1", "cargo test", "/project").unwrap();

        let results = db.search_commands("git", 10).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results[0].command.contains("git"));
    }

    #[test]
    fn test_recent_commands_deduplication() {
        let db = Database::open_memory().unwrap();
        db.save_command("t1", "git status", "/a").unwrap();
        db.save_command("t1", "git status", "/a").unwrap();
        db.save_command("t1", "cargo build", "/a").unwrap();

        let recent = db.recent_commands(10).unwrap();
        // DISTINCT ensures no duplicates
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn test_recent_commands_limit() {
        let db = Database::open_memory().unwrap();
        db.save_command("t1", "first", "/a").unwrap();
        db.save_command("t1", "second", "/a").unwrap();
        db.save_command("t1", "third", "/a").unwrap();

        let recent = db.recent_commands(2).unwrap();
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn test_search_commands_empty_query() {
        let db = Database::open_memory().unwrap();
        db.save_command("t1", "test", "/a").unwrap();

        let results = db.search_commands("", 10).unwrap();
        assert_eq!(results.len(), 1); // % matches all
    }

    #[test]
    fn test_audit_events_round_trip_metadata() {
        let db = Database::open_memory().unwrap();
        db.save_audit_event(
            "terminal",
            "write",
            "info",
            Some("terminal"),
            Some("term-1"),
            "Terminal input sent",
            &serde_json::json!({
                "bytes": 8,
                "containsEnter": true
            }),
        )
        .unwrap();

        let events = db.recent_audit_events(10).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].category, "terminal");
        assert_eq!(events[0].action, "write");
        assert_eq!(events[0].entity_id.as_deref(), Some("term-1"));
        assert_eq!(events[0].metadata["bytes"], 8);
        assert_eq!(events[0].metadata["containsEnter"], true);
        assert_eq!(
            events[0].metadata["correlationId"],
            "terminal:terminal:term-1"
        );
    }

    #[test]
    fn test_terminal_output_journal_clamps_large_rows() {
        let db = Database::open_memory().unwrap();
        db.save_terminal_output_chunk("term-1", "hello", 5, 1)
            .unwrap();
        db.save_terminal_output_chunk(
            "term-1",
            &"x".repeat(MAX_TERMINAL_OUTPUT_JOURNAL_TEXT_BYTES + 8),
            MAX_TERMINAL_OUTPUT_JOURNAL_TEXT_BYTES + 8,
            1,
        )
        .unwrap();

        let (rows, max_len): (i64, i64) = db
            .conn
            .query_row(
                "SELECT COUNT(*), MAX(LENGTH(text)) FROM terminal_output_journal WHERE terminal_id = 'term-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(rows, 2);
        assert_eq!(max_len, MAX_TERMINAL_OUTPUT_JOURNAL_TEXT_BYTES as i64);
    }

    #[test]
    fn test_audit_events_query_filters() {
        let db = Database::open_memory().unwrap();
        db.save_audit_event(
            "terminal",
            "send_keys_failed",
            "warn",
            Some("terminal"),
            Some("term-1"),
            "Terminal input failed",
            &serde_json::json!({ "bytes": 12 }),
        )
        .unwrap();
        db.save_audit_event(
            "workflow",
            "gate_rejected",
            "warn",
            Some("workflow"),
            Some("wf-1"),
            "Gate rejected",
            &serde_json::json!({ "phase": "verify" }),
        )
        .unwrap();
        db.save_audit_event(
            "terminal",
            "write",
            "info",
            Some("terminal"),
            Some("term-2"),
            "Terminal input sent",
            &serde_json::json!({}),
        )
        .unwrap();

        let terminal_warn = db
            .query_audit_events(10, Some("terminal"), Some("warn"), None)
            .unwrap();
        assert_eq!(terminal_warn.len(), 1);
        assert_eq!(terminal_warn[0].entity_id.as_deref(), Some("term-1"));

        let entity_events = db.query_audit_events(10, None, None, Some("wf-1")).unwrap();
        assert_eq!(entity_events.len(), 1);
        assert_eq!(entity_events[0].category, "workflow");
    }

    #[test]
    fn test_audit_events_query_rejects_bad_filter() {
        let db = Database::open_memory().unwrap();
        let err = db
            .query_audit_events(10, Some("terminal;drop"), None, None)
            .unwrap_err();
        assert!(err.contains("category filter"));
    }

    #[test]
    fn test_audit_events_preserve_explicit_correlation_id() {
        let db = Database::open_memory().unwrap();
        db.save_audit_event(
            "terminal",
            "force_restart",
            "info",
            Some("terminal"),
            Some("term-1"),
            "Terminal force restarted",
            &serde_json::json!({
                "correlationId": "manual-trace-1",
                "redacted": true
            }),
        )
        .unwrap();

        let events = db.recent_audit_events(10).unwrap();
        assert_eq!(events[0].metadata["correlationId"], "manual-trace-1");
    }

    #[test]
    fn test_audit_events_correlation_id_sanitizes_entity_id() {
        let db = Database::open_memory().unwrap();
        db.save_audit_event(
            "terminal",
            "send_keys_failed",
            "warn",
            Some("terminal"),
            Some("pane 1\nsecret"),
            "Terminal input failed",
            &serde_json::json!({}),
        )
        .unwrap();

        let events = db.recent_audit_events(10).unwrap();
        assert_eq!(
            events[0].metadata["correlationId"],
            "terminal:terminal:pane_1_secret"
        );
    }

    #[test]
    fn test_audit_events_reject_unbounded_taxonomy() {
        let db = Database::open_memory().unwrap();
        let err = db
            .save_audit_event(
                "terminal input",
                "write",
                "info",
                None,
                None,
                "bad category",
                &serde_json::json!({}),
            )
            .unwrap_err();
        assert!(err.contains("category"));
    }

    fn journal_event(
        workspace_id: &str,
        correlation_id: Option<&str>,
        kind: &str,
        payload_json: serde_json::Value,
    ) -> AuditJournalAppend {
        AuditJournalAppend {
            workspace_id: workspace_id.to_string(),
            thread_id: Some("thread-1".to_string()),
            session_id: Some("session-1".to_string()),
            pane_id: Some("pane-1".to_string()),
            terminal_id: Some("term-1".to_string()),
            agent_id: Some("agent-1".to_string()),
            workflow_id: None,
            task_id: Some("task-1".to_string()),
            correlation_id: correlation_id.map(ToOwned::to_owned),
            kind: kind.to_string(),
            severity: "info".to_string(),
            source: "test".to_string(),
            confidence: Some(0.9),
            payload_json,
        }
    }

    #[test]
    fn test_audit_journal_append_redacts_and_orders() {
        let db = Database::open_memory().unwrap();
        let first = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                Some("trace-1"),
                "terminal input",
                serde_json::json!({
                    "command": "deploy --token=secret",
                    "safe": "kept",
                    "nested": { "apiKey": "sk-test" }
                }),
            ))
            .unwrap();
        let second = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                Some("trace-1"),
                "watchdog decision",
                serde_json::json!({ "decision": "approved" }),
            ))
            .unwrap();

        assert_eq!(first.sequence + 1, second.sequence);
        assert_eq!(first.redacted_payload_json["command"], "[REDACTED]");
        assert_eq!(first.redacted_payload_json["safe"], "kept");
        assert_eq!(
            first.redacted_payload_json["nested"]["apiKey"],
            "[REDACTED]"
        );
        assert!(first.hash.starts_with("fnv1a64:"));

        let listed = db
            .list_audit_journal_events(&AuditJournalFilter {
                workspace_id: Some("workspace-a".to_string()),
                limit: Some(10),
                ..empty_audit_journal_filter()
            })
            .unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![first.sequence, second.sequence]
        );
    }

    #[test]
    fn test_audit_journal_workspace_isolation_and_trace() {
        let db = Database::open_memory().unwrap();
        db.append_audit_journal_event(&journal_event(
            "workspace-a",
            Some("trace-shared"),
            "agent started",
            serde_json::json!({ "agent": "a" }),
        ))
        .unwrap();
        db.append_audit_journal_event(&journal_event(
            "workspace-b",
            Some("trace-shared"),
            "agent started",
            serde_json::json!({ "agent": "b" }),
        ))
        .unwrap();

        let workspace_a = db
            .list_audit_journal_events(&AuditJournalFilter {
                workspace_id: Some("workspace-a".to_string()),
                limit: Some(10),
                ..empty_audit_journal_filter()
            })
            .unwrap();
        assert_eq!(workspace_a.len(), 1);
        assert_eq!(workspace_a[0].workspace_id, "workspace-a");

        let trace_a = db
            .get_audit_trace("trace-shared", Some("workspace-a"))
            .unwrap();
        assert_eq!(trace_a.len(), 1);
        assert_eq!(trace_a[0].workspace_id, "workspace-a");

        let trace_all = db.get_audit_trace("trace-shared", None).unwrap();
        assert_eq!(trace_all.len(), 2);
    }

    #[test]
    fn test_audit_journal_rebuild_snapshot_and_compact_keeps_sequence_monotonic() {
        let db = Database::open_memory().unwrap();
        let first = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                Some("trace-1"),
                "test started",
                serde_json::json!({ "name": "unit" }),
            ))
            .unwrap();
        let second = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                Some("trace-1"),
                "test completed",
                serde_json::json!({ "status": "pass" }),
            ))
            .unwrap();

        let snapshot = db
            .rebuild_audit_snapshot_from_events("workspace-a")
            .unwrap();
        assert_eq!(snapshot.workspace_id, "workspace-a");
        assert_eq!(snapshot.event_count, 2);
        assert_eq!(snapshot.through_sequence, second.sequence);
        assert_eq!(
            snapshot.snapshot_json["counts"]["byKind"]["test started"],
            1
        );

        let compacted = db
            .compact_audit_event_journal("workspace-a", second.sequence)
            .unwrap();
        assert_eq!(compacted.compacted_count, 1);
        let remaining = db
            .list_audit_journal_events(&AuditJournalFilter {
                workspace_id: Some("workspace-a".to_string()),
                limit: Some(10),
                ..empty_audit_journal_filter()
            })
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].sequence, second.sequence);

        let after_compact = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                Some("trace-2"),
                "final report written",
                serde_json::json!({ "ok": true }),
            ))
            .unwrap();
        assert!(after_compact.sequence > second.sequence);
        assert!(first.sequence < second.sequence);
    }

    #[test]
    fn test_audit_journal_rejects_corrupted_payload_shape() {
        let db = Database::open_memory().unwrap();
        let err = db
            .append_audit_journal_event(&journal_event(
                "workspace-a",
                None,
                "agent output",
                serde_json::json!("not-an-object"),
            ))
            .unwrap_err();
        assert!(err.contains("payload_json"));
    }

    #[test]
    fn test_agent_telemetry_snapshot_round_trip_and_prune() {
        let db = Database::open_memory().unwrap();

        db.save_agent_telemetry_snapshot(r#"{"version":1,"sessions":[{"id":"agent-1"}]}"#)
            .unwrap();
        let snapshots = db.list_agent_telemetry_snapshots(1).unwrap();

        assert_eq!(snapshots.len(), 1);
        assert!(snapshots[0].snapshot_json.contains("agent-1"));
        assert_eq!(snapshots[0].source, "frontend");

        for idx in 0..25 {
            db.save_agent_telemetry_snapshot(&format!(
                r#"{{"version":1,"sessions":[{{"id":"agent-{idx}"}}]}}"#
            ))
            .unwrap();
        }

        let snapshots = db.list_agent_telemetry_snapshots(50).unwrap();
        assert_eq!(snapshots.len(), 20);
        assert!(snapshots[0].snapshot_json.contains("agent-24"));
    }

    #[test]
    fn test_agent_telemetry_snapshot_rejects_invalid_json() {
        let db = Database::open_memory().unwrap();

        let err = db.save_agent_telemetry_snapshot("{").unwrap_err();

        assert!(err.contains("invalid JSON"));
    }

    #[test]
    fn test_pane_tree_layout_save_get_delete() {
        let db = Database::open_memory().unwrap();
        let key = "aether:paneTree:tab-test";
        let first = r#"{"version":1,"tree":{"type":"terminal","id":"pane-a","shell":"powershell"},"activePaneId":"pane-a"}"#;
        let second = r#"{"version":1,"tree":{"type":"terminal","id":"pane-a","shell":"cmd","title":"build"},"activePaneId":null}"#;

        db.save_pane_tree_layout(key, "C:/repo", first).unwrap();
        let saved = db.get_pane_tree_layout(key).unwrap().unwrap();
        assert_eq!(saved.storage_key, key);
        assert_eq!(saved.project_path, "C:/repo");
        assert_eq!(saved.layout_json, first);

        db.save_pane_tree_layout(key, "C:/repo", second).unwrap();
        let updated = db.get_pane_tree_layout(key).unwrap().unwrap();
        assert_eq!(updated.layout_json, second);

        db.delete_pane_tree_layout(key).unwrap();
        assert!(db.get_pane_tree_layout(key).unwrap().is_none());
    }

    #[test]
    fn test_pane_tree_layout_rejects_invalid_json() {
        let db = Database::open_memory().unwrap();
        let err = db
            .save_pane_tree_layout("aether:paneTree:bad", "", "{")
            .unwrap_err();
        assert!(err.contains("invalid JSON"));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRecord {
    pub id: i64,
    pub terminal_id: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionRecord {
    pub id: String,
    pub model: String,
    pub prompt: String,
    pub status: String,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTelemetrySnapshotRecord {
    pub id: i64,
    pub snapshot_json: String,
    pub source: String,
    pub saved_at: String,
}
