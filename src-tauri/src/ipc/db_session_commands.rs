//! Session / DB persistence IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change.
use tauri::{AppHandle, Manager};

// --- Session management commands ---

use crate::db::queries::{Pane, RestoredSession, Session};
use crate::db::{self, Database};

#[tauri::command]
pub fn create_session(name: &str) -> Result<Session, String> {
    let db = Database::open(&db::db_path())?;
    db.create_session(name)
}

#[tauri::command]
pub fn list_db_sessions() -> Result<Vec<Session>, String> {
    let db = Database::open(&db::db_path())?;
    db.list_sessions()
}

#[tauri::command]
pub fn delete_session(id: &str) -> Result<(), String> {
    let db = Database::open(&db::db_path())?;
    db.delete_session(id)
}

#[tauri::command]
pub fn restore_last_session() -> Result<Option<RestoredSession>, String> {
    let db = Database::open(&db::db_path())?;
    db.restore_last_session()
}

#[tauri::command]
pub fn create_window(session_id: &str, title: &str) -> Result<crate::db::queries::Window, String> {
    let db = Database::open(&db::db_path())?;
    db.create_window(session_id, title)
}

#[tauri::command]
pub fn create_pane(
    window_id: &str,
    shell_type: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<Pane, String> {
    let db = Database::open(&db::db_path())?;
    db.create_pane(window_id, shell_type, cwd, cols, rows)
}

#[tauri::command]
pub fn save_session_state(session_id: &str) -> Result<(), String> {
    let db = Database::open(&db::db_path())?;
    db.touch_session(session_id)
}

#[tauri::command]
pub fn save_pane_tree_layout(
    app: AppHandle,
    storage_key: String,
    project_path: String,
    layout_json: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_pane_tree_layout(&storage_key, &project_path, &layout_json))
}

#[tauri::command]
pub fn get_pane_tree_layout(
    app: AppHandle,
    storage_key: String,
) -> Result<Option<crate::db::PaneTreeLayoutRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_pane_tree_layout(&storage_key))
}

#[tauri::command]
pub fn delete_pane_tree_layout(app: AppHandle, storage_key: String) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.delete_pane_tree_layout(&storage_key))
}
