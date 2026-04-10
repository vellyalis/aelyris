use std::io::BufRead;
use tauri::{AppHandle, Emitter, Manager};

use crate::pty::{PtyManager, ShellType};

/// Validate path is not dangerous (no traversal, no system dirs)
fn validate_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    // Block path traversal
    if path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    // Block system directories
    let dangerous = ["C:/Windows", "C:/Program Files", "/etc", "/usr", "/bin", "/sbin"];
    let normalized = p.to_string_lossy().to_string().replace('\\', "/");
    for d in &dangerous {
        if normalized.starts_with(d) {
            return Err(format!("Access to {} not allowed", d));
        }
    }
    Ok(())
}

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

/// Create a git worktree
#[tauri::command]
pub fn create_worktree(repo_path: String, branch_name: String) -> Result<crate::git::WorktreeInfo, String> {
    crate::git::create_worktree(&repo_path, &branch_name)
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

/// Search file contents (grep-like)
#[tauri::command]
pub fn grep_files(root_path: String, pattern: String, max_results: u32) -> Result<Vec<GrepResult>, String> {
    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    grep_recursive(std::path::Path::new(&root_path), &pattern_lower, max_results, &mut results);
    Ok(results)
}

#[derive(serde::Serialize)]
pub struct GrepResult {
    pub file: String,
    pub line: u32,
    pub content: String,
}

fn grep_recursive(dir: &std::path::Path, pattern: &str, max: u32, results: &mut Vec<GrepResult>) {
    if results.len() >= max as usize { return; }
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
    for entry in entries.flatten() {
        if results.len() >= max as usize { return; }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            if [".git","node_modules","target","__pycache__",".venv","dist",".next",".turbo","coverage"].contains(&name.as_str()) { continue; }
            grep_recursive(&path, pattern, max, results);
        } else {
            // Skip binary/large files
            let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
            if ["png","jpg","jpeg","gif","ico","woff","woff2","ttf","otf","eot","lock","db"].contains(&ext.as_str()) { continue; }
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 1024 * 1024 { continue; } // Skip >1MB
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if results.len() >= max as usize { break; }
                    if line.to_lowercase().contains(pattern) {
                        results.push(GrepResult {
                            file: path.to_string_lossy().to_string().replace('\\', "/"),
                            line: (i + 1) as u32,
                            content: line.chars().take(200).collect(),
                        });
                    }
                }
            }
        }
    }
}

/// Get original file content from git HEAD (for diff)
#[tauri::command]
pub fn git_file_original(repo_path: String, file_path: String) -> Result<String, String> {
    // Get relative path from repo root
    let relative = file_path
        .replace(&repo_path, "")
        .trim_start_matches('/')
        .to_string();

    let output = std::process::Command::new("git")
        .args(["show", &format!("HEAD:{}", relative)])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git show failed: {}", e))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("UTF-8 error: {}", e))
    } else {
        Err("File not in git HEAD".to_string())
    }
}

/// List GitHub PRs for a repo
#[tauri::command]
pub fn list_pull_requests(cwd: String) -> Result<Vec<PullRequestInfo>, String> {
    let output = std::process::Command::new("gh")
        .args(["pr", "list", "--json", "number,title,state,author,headRefName,url", "--limit", "10"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh CLI not found: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Parse error: {}", e))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PullRequestInfo {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub author: serde_json::Value,
    #[serde(rename = "headRefName")]
    pub head_ref_name: String,
    pub url: String,
}

/// View a specific PR's diff
#[tauri::command]
pub fn get_pr_diff(cwd: String, pr_number: u32) -> Result<String, String> {
    let output = std::process::Command::new("gh")
        .args(["pr", "diff", &pr_number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh diff failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    String::from_utf8(output.stdout).map_err(|e| format!("UTF-8: {}", e))
}

/// Load app config
#[tauri::command]
pub fn load_app_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

/// Save app config
#[tauri::command]
pub fn save_app_config(config: crate::config::AppConfig) -> Result<(), String> {
    crate::config::save_config(&config)
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
    validate_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))
}

/// Create a new file
#[tauri::command]
pub fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    validate_path(&path)?;
    if std::path::Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    std::fs::write(&path, content.unwrap_or_default()).map_err(|e| format!("Create: {}", e))
}

/// Rename a file or directory
#[tauri::command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    validate_path(&old_path)?;
    validate_path(&new_path)?;
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Rename: {}", e))
}

/// Delete a file or empty directory
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("Delete dir: {}", e))
    } else {
        std::fs::remove_file(p).map_err(|e| format!("Delete file: {}", e))
    }
}

/// Create a new directory
#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    validate_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("mkdir: {}", e))
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
        None,
    )?;

    // Stream stdout to frontend via events
    let reader = agent_manager.take_stdout(&id)?;
    let session_id = id.clone();
    let app_handle = app.clone();
    let agent_mgr = app.state::<crate::agent::AgentManager>().inner().clone();

    // Initialize watchdog engine for this session
    let watchdog_rules = crate::watchdog::load_watchdog_rules();
    let watchdog = crate::watchdog::engine::WatchdogEngine::new(watchdog_rules);

    std::thread::spawn(move || {
        // Helper: emit full session list to frontend (push updates)
        let emit_sessions = |mgr: &crate::agent::AgentManager, handle: &AppHandle| {
            let sessions = mgr.list_sessions();
            let _ = handle.emit("agent-sessions-updated", &sessions);
        };

        // Notify frontend of initial session
        emit_sessions(&agent_mgr, &app_handle);

        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let event = format!("agent-output-{}", session_id);
                    let _ = app_handle.emit(&event, &line);

                    // Parse status from stream-json and push updates
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(msg_type) = val.get("type").and_then(|v| v.as_str()) {
                            let should_push = match msg_type {
                                "assistant" => {
                                    let _ = agent_mgr.update_status(&session_id, "coding");
                                    true
                                }
                                "result" => {
                                    let _ = agent_mgr.update_status(&session_id, "done");
                                    if let Some(cost) = val.get("cost_usd").and_then(|v| v.as_f64()) {
                                        let tokens = val.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                        let _ = agent_mgr.update_usage(&session_id, cost, tokens);
                                    }
                                    true
                                }
                                "tool_use" => {
                                    // Evaluate tool invocation against watchdog rules
                                    if let Some(tool_name) = val.get("name").and_then(|v| v.as_str()) {
                                        let decision = watchdog.evaluate(tool_name);
                                        let decision_str = match &decision {
                                            crate::watchdog::engine::WatchdogDecision::AutoApprove { rule } =>
                                                format!("{{\"decision\":\"approved\",\"tool\":\"{}\",\"rule\":\"{}\"}}", tool_name, rule),
                                            crate::watchdog::engine::WatchdogDecision::AutoDeny { rule } =>
                                                format!("{{\"decision\":\"denied\",\"tool\":\"{}\",\"rule\":\"{}\"}}", tool_name, rule),
                                            crate::watchdog::engine::WatchdogDecision::AskUser =>
                                                format!("{{\"decision\":\"manual\",\"tool\":\"{}\",\"rule\":\"\"}}", tool_name),
                                        };
                                        let _ = app_handle.emit(&format!("watchdog-decision-{}", session_id), &decision_str);
                                    }
                                    false
                                }
                                _ => false,
                            };
                            if should_push {
                                emit_sessions(&agent_mgr, &app_handle);
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        // Process ended — emit exit event + updated session list
        let _ = app_handle.emit(&format!("agent-exit-{}", session_id), ());
        emit_sessions(&agent_mgr, &app_handle);
    });

    Ok(id)
}

/// Stop an agent session
#[tauri::command]
pub fn stop_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.stop_session(&id)?;
    // Push updated session list
    let sessions = agent_manager.list_sessions();
    let _ = app.emit("agent-sessions-updated", &sessions);
    Ok(())
}

/// List agent sessions
#[tauri::command]
pub fn list_agents(app: AppHandle) -> Vec<crate::agent::AgentSessionInfo> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.list_sessions()
}

fn base64_encode(data: &[u8]) -> String {
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

// --- Session management commands ---

use crate::db::{self, Database};
use crate::db::queries::{Session, Pane, RestoredSession};

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
