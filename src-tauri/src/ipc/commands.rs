use std::io::BufRead;
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

/// List directory contents for file tree
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<crate::git::FileEntry>, String> {
    crate::git::list_directory(&path)
}

/// Get git status for a repository
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<crate::git::GitStatusInfo, String> {
    crate::git::git_status(&repo_path)
}

/// Search files by name in a directory tree
#[tauri::command]
pub fn search_files(root_path: String, query: String, max_results: u32) -> Result<Vec<crate::git::FileEntry>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    search_recursive(std::path::Path::new(&root_path), &query_lower, max_results, &mut results);
    Ok(results)
}

fn search_recursive(dir: &std::path::Path, query: &str, max: u32, results: &mut Vec<crate::git::FileEntry>) {
    if results.len() >= max as usize { return; }
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
    for entry in entries.flatten() {
        if results.len() >= max as usize { return; }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let is_dir = path.is_dir();
        if is_dir && [".git","node_modules","target","__pycache__",".venv","dist",".next",".turbo"].contains(&name.as_str()) {
            continue;
        }
        if name.to_lowercase().contains(query) {
            let full = path.to_string_lossy().to_string().replace('\\', "/");
            let file_type = if is_dir { "folder".to_string() } else { crate::git::ext_to_type(&name) };
            results.push(crate::git::FileEntry { name: name.clone(), path: full, is_dir, file_type, children_count: 0 });
        }
        if is_dir { search_recursive(&path, query, max, results); }
    }
}

/// Get watchdog rules
#[tauri::command]
pub fn get_watchdog_rules() -> crate::watchdog::WatchdogRules {
    crate::watchdog::load_watchdog_rules()
}

/// Save watchdog rules
#[tauri::command]
pub fn save_watchdog_rules(rules: crate::watchdog::WatchdogRules) -> Result<(), String> {
    crate::watchdog::save_watchdog_rules(&rules)
}

/// Create a named watchdog
#[tauri::command]
pub fn create_watchdog(name: String, instructions: String) -> Result<(), String> {
    crate::watchdog::create_watchdog(&name, &instructions)
}

/// Read a file's contents
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("Metadata error: {}", e))?;
    if meta.len() > 5 * 1024 * 1024 {
        return Err("File too large (>5MB)".to_string());
    }
    std::fs::read_to_string(p).map_err(|e| format!("Read error: {}", e))
}

/// Write content to a file
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))
}

/// Start a Claude Code agent session
#[tauri::command]
pub fn start_agent(
    app: AppHandle,
    prompt: String,
    cwd: String,
    model: Option<String>,
) -> Result<String, String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    let id = agent_manager.start_session(
        &prompt,
        &cwd,
        model.as_deref(),
        None,
    )?;

    // Stream stdout to frontend via events
    let reader = agent_manager.take_stdout(&id)?;
    let session_id = id.clone();
    let app_handle = app.clone();
    let agent_mgr = app.state::<crate::agent::AgentManager>().inner().clone();

    std::thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let event = format!("agent-output-{}", session_id);
                    let _ = app_handle.emit(&event, &line);

                    // Try to parse status from stream-json
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(msg_type) = val.get("type").and_then(|v| v.as_str()) {
                            match msg_type {
                                "assistant" => { let _ = agent_mgr.update_status(&session_id, "coding"); }
                                "result" => {
                                    let _ = agent_mgr.update_status(&session_id, "done");
                                    if let Some(cost) = val.get("cost_usd").and_then(|v| v.as_f64()) {
                                        let tokens = val.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                        let _ = agent_mgr.update_usage(&session_id, cost, tokens);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(&format!("agent-exit-{}", session_id), ());
    });

    Ok(id)
}

/// Stop an agent session
#[tauri::command]
pub fn stop_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.stop_session(&id)
}

/// List agent sessions
#[tauri::command]
pub fn list_agents(app: AppHandle) -> Vec<crate::agent::AgentSessionInfo> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.list_sessions()
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
