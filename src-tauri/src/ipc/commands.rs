use tauri::{AppHandle, Emitter, Manager};

use crate::pty::{PtyManager, ShellType};

/// Spawn a new terminal session
#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_manager = app.state::<PtyManager>();
    let id = pty_manager.spawn(&shell, cols, rows, cwd.as_deref())?;

    // Start streaming PTY output via events
    let reader = pty_manager.take_reader(&id)?;
    let terminal_id = id.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    let event_name = format!("pty-output-{}", terminal_id);
                    // Send as base64 to avoid JSON encoding issues with binary data
                    let encoded = base64_encode(data);
                    let _ = app_handle.emit(&event_name, encoded);
                }
                Err(_) => break,
            }
        }
        // Terminal exited
        let _ = app_handle.emit(&format!("pty-exit-{}", terminal_id), ());
    });

    Ok(id)
}

/// Write input to a terminal
#[tauri::command]
pub fn write_terminal(
    app: AppHandle,
    id: String,
    data: String,
) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.write(&id, data.as_bytes())
}

/// Resize a terminal
#[tauri::command]
pub fn resize_terminal(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.resize(&id, cols, rows)
}

/// Close a terminal
#[tauri::command]
pub fn close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.close(&id)
}

/// List active terminals
#[tauri::command]
pub fn list_terminals(app: AppHandle) -> Vec<String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.list()
}

/// Detect available shells
#[tauri::command]
pub fn detect_shells() -> Vec<ShellType> {
    ShellType::detect_available()
}

/// Discover Git projects in scan directories
#[tauri::command]
pub fn discover_projects(scan_dirs: Vec<String>) -> Vec<crate::git::ProjectInfo> {
    crate::git::discover_projects(&scan_dirs)
}

/// List branches for a project
#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<crate::git::BranchInfo>, String> {
    crate::git::list_branches(&repo_path)
}

/// List worktrees for a project
#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<crate::git::WorktreeInfo>, String> {
    crate::git::list_worktrees(&repo_path)
}

fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(data.len() * 4 / 3 + 4);
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        s.push(CHARS[((n >> 18) & 0x3F) as usize] as char);
        s.push(CHARS[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            s.push(CHARS[((n >> 6) & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
        if chunk.len() > 2 {
            s.push(CHARS[(n & 0x3F) as usize] as char);
        } else {
            s.push('=');
        }
    }
    s
}

use std::io::Read;
