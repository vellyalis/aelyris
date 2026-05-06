use std::sync::{Arc, Mutex};

use crate::db::queries::{Pane, RestoredSession, Session, Window};
use crate::db::{self, Database};
use crate::pty::{PtyManager, ShellType};

/// Bridges database persistence with live PTY management.
///
/// SessionManager owns the Database and coordinates with PtyManager
/// to create, persist, and restore terminal sessions.
pub struct SessionManager {
    db: Arc<Mutex<Database>>,
}

impl SessionManager {
    /// Create a new SessionManager, opening the database at the default path
    pub fn open_default() -> Result<Self, String> {
        let db = Database::open(&db::db_path())?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
        })
    }

    /// Create a SessionManager with an in-memory database (for testing)
    pub fn open_memory() -> Result<Self, String> {
        let db = Database::open_memory()?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
        })
    }

    // --- Session operations ---

    pub fn create_session(&self, name: &str) -> Result<Session, String> {
        self.with_db(|db| db.create_session(name))
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>, String> {
        self.with_db(|db| db.list_sessions())
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        self.with_db(|db| db.delete_session(id))
    }

    // --- Window operations ---

    pub fn create_window(&self, session_id: &str, title: &str) -> Result<Window, String> {
        self.with_db(|db| {
            db.touch_session(session_id)?;
            db.create_window(session_id, title)
        })
    }

    pub fn list_windows(&self, session_id: &str) -> Result<Vec<Window>, String> {
        self.with_db(|db| db.list_windows(session_id))
    }

    pub fn set_window_layout(&self, window_id: &str, layout: &str) -> Result<(), String> {
        self.with_db(|db| db.update_window_layout(window_id, layout))
    }

    // --- Pane operations ---

    /// Create a new pane in a window and spawn its PTY
    pub fn create_pane(
        &self,
        window_id: &str,
        shell: &ShellType,
        cwd: &str,
        cols: u16,
        rows: u16,
        pty_manager: &PtyManager,
    ) -> Result<(Pane, String), String> {
        let shell_name = format!("{:?}", shell).to_lowercase();

        let terminal_id = pty_manager.spawn(shell, cols, rows, Some(cwd))?;
        let pane = match self.with_db(|db| db.create_pane(window_id, &shell_name, cwd, cols, rows))
        {
            Ok(pane) => pane,
            Err(err) => {
                let _ = pty_manager.close(&terminal_id);
                return Err(err);
            }
        };

        Ok((pane, terminal_id))
    }

    /// Split an existing pane: create a new pane in the same window
    pub fn split_pane(
        &self,
        window_id: &str,
        direction: SplitDirection,
        shell: &ShellType,
        cwd: &str,
        cols: u16,
        rows: u16,
        pty_manager: &PtyManager,
    ) -> Result<(Pane, String), String> {
        // Update window layout type
        let layout = match direction {
            SplitDirection::Horizontal => "hsplit",
            SplitDirection::Vertical => "vsplit",
        };
        self.set_window_layout(window_id, layout)?;

        // Create the new pane
        self.create_pane(window_id, shell, cwd, cols, rows, pty_manager)
    }

    /// Remove a pane from DB and close its PTY
    pub fn close_pane(
        &self,
        pane_id: &str,
        terminal_id: &str,
        pty_manager: &PtyManager,
    ) -> Result<(), String> {
        pty_manager.close(terminal_id).map_err(|e| e.to_string())?;
        self.with_db(|db| db.delete_pane(pane_id))
    }

    // --- Save / Restore ---

    /// Save current state: mark the active session's updated_at
    pub fn save_state(&self, session_id: &str) -> Result<(), String> {
        self.with_db(|db| db.touch_session(session_id))
    }

    /// Restore the most recent active session
    pub fn restore_last_session(&self) -> Result<Option<RestoredSession>, String> {
        self.with_db(|db| db.restore_last_session())
    }

    /// Restore and spawn PTYs for all panes in a session
    pub fn restore_and_spawn(
        &self,
        pty_manager: &PtyManager,
    ) -> Result<Option<Vec<(Pane, String)>>, String> {
        let restored = match self.restore_last_session()? {
            Some(r) => r,
            None => return Ok(None),
        };

        let mut results = Vec::new();
        for rw in &restored.windows {
            for pane in &rw.panes {
                let shell = shell_from_str(&pane.shell_type);
                match pty_manager.spawn(&shell, pane.cols, pane.rows, Some(&pane.cwd)) {
                    Ok(terminal_id) => results.push((pane.clone(), terminal_id)),
                    Err(e) => {
                        log::warn!(
                            "Failed to restore pane {} (shell: {}): {}. Falling back to CMD.",
                            pane.id,
                            pane.shell_type,
                            e
                        );
                        // Fallback to CMD
                        if let Ok(tid) = pty_manager.spawn(
                            &ShellType::Cmd,
                            pane.cols,
                            pane.rows,
                            Some(&pane.cwd),
                        ) {
                            results.push((pane.clone(), tid));
                        }
                    }
                }
            }
        }

        Ok(Some(results))
    }

    /// Deactivate all sessions (on clean shutdown)
    pub fn deactivate_all(&self) -> Result<(), String> {
        self.with_db(|db| db.deactivate_all_sessions())
    }

    // --- Helpers ---

    fn with_db<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Database) -> Result<T, String>,
    {
        let db = self.db.lock().map_err(|_| "DB lock poisoned".to_string())?;
        f(&db)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

/// Parse a shell type string back to ShellType enum
fn shell_from_str(s: &str) -> ShellType {
    match s {
        "powershell" => ShellType::PowerShell,
        "gitbash" => ShellType::GitBash,
        "wsl" => ShellType::Wsl,
        _ => ShellType::Cmd,
    }
}
