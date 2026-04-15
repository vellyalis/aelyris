use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
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

impl Database {
    /// Open (or create) the database at the given path and run migrations
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create db directory: {}", e))?;
        }

        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        migrations::run_migrations(&conn)
            .map_err(|e| format!("Migration failed: {}", e))?;

        Ok(Self { conn })
    }

    /// Open an in-memory database (for testing)
    pub fn open_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to open in-memory db: {}", e))?;

        migrations::run_migrations(&conn)
            .map_err(|e| format!("Migration failed: {}", e))?;

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

    pub fn update_pane_layout(&self, id: &str, flex_basis: f64, position: &str) -> Result<(), String> {
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
    pub fn update_agent_session(&self, id: &str, status: &str, cost: f64, tokens_used: u64) -> Result<(), String> {
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
