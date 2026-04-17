use std::collections::HashMap;
use std::io::BufRead;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty::{PtyManager, ShellType};
use crate::pty::buffer::{OutputBuffer, strip_ansi};
use crate::term::NativeTerminalRegistry;

/// Global registry of output buffers for capture-pane
#[derive(Clone)]
pub struct OutputBufferRegistry {
    buffers: Arc<Mutex<HashMap<String, OutputBuffer>>>,
}

impl OutputBufferRegistry {
    pub fn new() -> Self {
        Self {
            buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create(&self, id: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            buffers.insert(id.to_string(), OutputBuffer::new(1000));
        }
    }

    pub fn feed(&self, id: &str, data: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            if let Some(buf) = buffers.get_mut(id) {
                buf.feed(data);
            }
        }
    }

    pub fn command_blocks(&self, id: &str) -> Result<Vec<crate::pty::buffer::CommandBlock>, String> {
        let buffers = self.buffers.lock().map_err(|_| "Lock poisoned".to_string())?;
        let buf = buffers.get(id).ok_or_else(|| format!("No buffer for terminal {}", id))?;
        let lines = buf.tail(500);
        Ok(crate::pty::buffer::extract_command_blocks(&lines))
    }

    pub fn capture(&self, id: &str, lines: usize, clean: bool) -> Result<String, String> {
        let buffers = self.buffers.lock().map_err(|_| "Lock poisoned".to_string())?;
        let buf = buffers.get(id).ok_or_else(|| format!("No buffer for terminal {}", id))?;
        let output = buf.tail(lines).join("\n");
        if clean {
            Ok(strip_ansi(&output))
        } else {
            Ok(output)
        }
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            buffers.remove(id);
        }
    }
}

/// Validate path is not dangerous (no traversal, no system dirs)
fn validate_path(path: &str) -> Result<(), String> {
    // Block path traversal
    if path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    // Block UNC paths
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err("UNC paths not allowed".to_string());
    }
    // Normalize and compare case-insensitively (Windows is case-insensitive)
    let normalized = path.replace('\\', "/").to_lowercase();
    let dangerous = [
        "c:/windows", "c:/program files", "c:/program files (x86)",
        "d:/windows",
        "/etc", "/usr", "/bin", "/sbin",
    ];
    for d in &dangerous {
        if normalized.starts_with(d) {
            return Err(format!("Access to system directory not allowed"));
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
    // Validate cwd before spawning
    if let Some(ref dir) = cwd {
        validate_path(dir)?;
    }
    let pty_manager = app.state::<PtyManager>();
    let id = pty_manager.spawn(&shell, cols, rows, cwd.as_deref())?;

    // Start streaming PTY output via events + capture buffer
    let reader = pty_manager.take_reader(&id)?;
    let terminal_id = id.clone();
    let app_handle = app.clone();
    let buffer_registry = app.state::<OutputBufferRegistry>().inner().clone();
    buffer_registry.create(&id);

    // Register in pane registry for name-based operations
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let shell_name = format!("{:?}", shell).to_lowercase();
    pane_registry.register(&id, &shell_name, cwd.as_deref().unwrap_or("."));

    // Native engine session (Phase 2).
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
    if let Err(e) = native_registry.create(&id, cols, rows) {
        log::warn!("native engine create failed for {}: {}", id, e);
    }

    // Per-terminal flush ticker: the 16ms coalesce in `advance()` swallows
    // the very last edit if no follow-up bytes arrive (e.g., user types one
    // char and stops). The ticker bypasses the window and ships any pending
    // diff so the canvas never lags behind alacritty's grid.
    let flush_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    {
        let alive = flush_alive.clone();
        let flush_registry = native_registry.clone();
        let flush_handle = app_handle.clone();
        let flush_id = terminal_id.clone();
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering;
            while alive.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(33));
                if let Some(diff) = flush_registry.flush(&flush_id) {
                    let _ = flush_handle.emit(&format!("term:diff-{}", flush_id), diff);
                }
            }
        });
    }
    let reader_alive = flush_alive.clone();

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut detected_ports = std::collections::HashSet::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    let event_name = format!("pty-output-{}", terminal_id);
                    // Send as number array — avoids base64 encode/decode overhead
                    let bytes_vec: Vec<u8> = data.to_vec();
                    let _ = app_handle.emit(&event_name, bytes_vec);
                    // Feed raw text into capture buffer
                    let text = String::from_utf8_lossy(data);
                    buffer_registry.feed(&terminal_id, &text);

                    // Native engine fan-out (Phase 2).
                    if let Some(diff) = native_registry.advance(&terminal_id, data) {
                        let _ = app_handle.emit(&format!("term:diff-{}", terminal_id), diff);
                    }

                    // Port auto-detection: scan for localhost:<port> patterns
                    for segment in text.split_whitespace() {
                        let segment = segment.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '.');
                        if let Some(port_str) = segment
                            .strip_prefix("localhost:")
                            .or_else(|| segment.strip_prefix("127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("http://localhost:"))
                            .or_else(|| segment.strip_prefix("http://127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("https://localhost:"))
                        {
                            let port_digits: String = port_str.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if let Ok(port) = port_digits.parse::<u16>() {
                                if port >= 1024 && !detected_ports.contains(&port) {
                                    detected_ports.insert(port);
                                    let _ = app_handle.emit("port-detected", serde_json::json!({
                                        "terminal_id": terminal_id,
                                        "port": port,
                                    }));
                                }
                            }
                        }
                    }

                    // Bell detection: \x07 in raw output → notify frontend
                    if data.contains(&0x07) {
                        let _ = app_handle.emit("terminal:bell", serde_json::json!({
                            "terminal_id": terminal_id,
                        }));
                    }
                }
                Err(_) => break,
            }
        }
        // Terminal exited — stop the native flush ticker so it can join.
        reader_alive.store(false, std::sync::atomic::Ordering::Release);
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
    pty_manager.resize(&id, cols, rows)?;

    // Native engine resize — emits a full frame so the frontend can reflow.
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>();
    if let Some(diff) = native_registry.resize(&id, cols, rows)? {
        let _ = app.emit(&format!("term:diff-{}", id), diff);
    }
    Ok(())
}

/// Close a terminal
#[tauri::command]
pub fn close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.close(&id)?;
    // Clean up associated registries
    app.state::<OutputBufferRegistry>().remove(&id);
    app.state::<crate::pty::PaneRegistry>().remove(&id);
    app.state::<Arc<NativeTerminalRegistry>>().remove(&id);
    Ok(())
}

/// Bootstrap the frontend with a full grid snapshot — used when React
/// (re)mounts the TerminalCanvas and needs the starting state.
#[tauri::command]
pub fn term_snapshot(
    app: AppHandle,
    id: String,
) -> Option<crate::term::GridSnapshot> {
    app.state::<Arc<NativeTerminalRegistry>>().snapshot(&id)
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

/// Remove a git worktree (and optionally its branch)
#[tauri::command]
pub fn remove_worktree(repo_path: String, worktree_name: String, delete_branch: bool) -> Result<(), String> {
    crate::git::remove_worktree(&repo_path, &worktree_name, delete_branch)
}

/// Get git status for a repository
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<crate::git::GitStatusInfo, String> {
    crate::git::git_status(&repo_path)
}

/// Stage files for commit
#[tauri::command]
pub fn git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Unstage files (reset HEAD)
#[tauri::command]
pub fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Stage all changes
#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["add", "-A"])
}

/// Discard changes in working tree
#[tauri::command]
pub fn git_discard(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["checkout".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Create a commit
#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    run_git_cmd_with_output(&repo_path, &["commit", "-m", &message])
}

/// Push to remote
#[tauri::command]
pub fn git_push(repo_path: String) -> Result<String, String> {
    run_git_cmd_with_output(&repo_path, &["push"])
}

fn run_git_cmd(repo_path: &str, args: &[impl AsRef<std::ffi::OsStr>]) -> Result<(), String> {
    run_git_cmd_with_output(repo_path, args).map(|_| ())
}

fn run_git_cmd_with_output(repo_path: &str, args: &[impl AsRef<std::ffi::OsStr>]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git command failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
    // Normalize separators then compute relative path via strip_prefix
    let repo_norm = repo_path.replace('\\', "/");
    let file_norm = file_path.replace('\\', "/");
    let relative = file_norm
        .strip_prefix(&repo_norm)
        .unwrap_or(&file_norm)
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

/// Get unified diff for a specific file against HEAD.
#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo_norm = repo_path.replace('\\', "/");
    let file_norm = file_path.replace('\\', "/");
    let relative = file_norm
        .strip_prefix(&repo_norm)
        .unwrap_or(&file_norm)
        .trim_start_matches('/')
        .to_string();

    let output = std::process::Command::new("git")
        .args(["diff", "HEAD", "--", &relative])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("UTF-8 error: {}", e))
    } else {
        // File might be untracked — show full content as "new file"
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("git diff failed: {}", stderr))
    }
}

/// Get unified diffs for multiple files against HEAD (batch operation).
#[tauri::command]
pub fn git_diff_files(repo_path: String, file_paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    let repo_norm = repo_path.replace('\\', "/");
    let mut results = Vec::new();

    for file_path in file_paths {
        let file_norm = file_path.replace('\\', "/");
        let relative = file_norm
            .strip_prefix(&repo_norm)
            .unwrap_or(&file_norm)
            .trim_start_matches('/')
            .to_string();

        let output = std::process::Command::new("git")
            .args(["diff", "HEAD", "--", &relative])
            .current_dir(&repo_path)
            .output();

        let diff = match output {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => String::new(),
        };
        results.push((relative, diff));
    }

    Ok(results)
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
    validate_path(&path)?;
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

/// Delete a file or directory (protects .git and other critical dirs)
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let p = std::path::Path::new(&path);
    // Protect critical directories from accidental deletion
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let protected = [".git", ".hg", "node_modules", ".env"];
    if p.is_dir() && protected.contains(&name) {
        return Err(format!("Cannot delete protected directory: {}", name));
    }
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
        // Process ended — update status to done, emit exit event + session list
        let _ = agent_mgr.update_status(&session_id, "done");
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

/// Route a prompt to the best model
#[tauri::command]
pub fn route_agent(prompt: String, budget: Option<f64>) -> crate::agent::router::RoutingDecision {
    crate::agent::router::AgentRouter::route(&prompt, budget)
}

/// Start a chat agent session (supports --resume for multi-turn)
#[tauri::command]
pub fn start_chat_agent(
    app: AppHandle,
    conversation_id: String,
    prompt: String,
    cwd: String,
    model: Option<String>,
    resume_id: Option<String>,
    images: Option<Vec<String>>,
) -> Result<String, String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();

    // Build image args: save base64 to temp files
    let image_paths: Vec<String> = if let Some(imgs) = &images {
        let tmp_dir = std::env::temp_dir().join("aether-chat-images");
        std::fs::create_dir_all(&tmp_dir).ok();
        imgs.iter().enumerate().filter_map(|(i, data)| {
            // Strip data URI prefix if present
            let raw = if let Some(pos) = data.find(",") { &data[pos + 1..] } else { data.as_str() };
            // Simple base64 decode
            let bytes = base64_decode(raw).ok()?;
            let path = tmp_dir.join(format!("img_{}_{}.png", conversation_id.replace('-', ""), i));
            std::fs::write(&path, &bytes).ok()?;
            Some(path.to_string_lossy().to_string())
        }).collect()
    } else {
        vec![]
    };

    let id = agent_manager.start_session(
        &prompt,
        &cwd,
        model.as_deref(),
        None,
        resume_id.as_deref(),
    )?;

    // Inject --image flags into the CLI process
    // Note: images are passed via start_session's command builder
    // For now, we handle it by modifying the prompt to include image references
    // TODO: Extend start_session to accept image paths

    let reader = agent_manager.take_stdout(&id)?;
    let session_id = id.clone();
    let conv_id = conversation_id.clone();
    let app_handle = app.clone();
    let agent_mgr = app.state::<crate::agent::AgentManager>().inner().clone();

    std::thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let event = format!("chat-stream-{}", conv_id);
                    let _ = app_handle.emit(&event, &line);

                    // Update session status from stream
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
                                    // Send session_id from result for --resume
                                    if let Some(sid) = val.get("session_id").and_then(|v| v.as_str()) {
                                        let _ = app_handle.emit(&format!("chat-session-id-{}", conv_id), sid);
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
        let _ = app_handle.emit(&format!("chat-complete-{}", conv_id), &session_id);

        // Clean up temp images
        for p in &image_paths {
            std::fs::remove_file(p).ok();
        }
    });

    Ok(id)
}

/// Save a base64-encoded image to a temp file, return the file path
#[tauri::command]
pub fn save_temp_image(data: String) -> Result<String, String> {
    let tmp_dir = std::env::temp_dir().join("aether-chat-images");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    // Strip data URI prefix if present
    let raw = if let Some(pos) = data.find(',') { &data[pos + 1..] } else { data.as_str() };
    let bytes = base64_decode(raw)?;
    let name = format!("img_{}.png", uuid::Uuid::new_v4());
    let path = tmp_dir.join(&name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Stop a chat agent session
#[tauri::command]
pub fn stop_chat_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.stop_session(&id)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in input.as_bytes() {
        if b == b'=' || b == b'\n' || b == b'\r' { continue; }
        let val = CHARS.iter().position(|&c| c == b).ok_or("invalid base64")? as u32;
        acc = (acc << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            buf.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(buf)
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

// --- Workspace pane commands ---

const MAX_KEYS_BYTES: usize = 1024 * 1024; // 1 MB

fn validate_keys_size(data: &str) -> Result<(), String> {
    if data.len() > MAX_KEYS_BYTES {
        return Err("Input data exceeds maximum allowed size (1 MB)".to_string());
    }
    Ok(())
}

/// Send keystrokes to a specific terminal pane
#[tauri::command]
pub fn send_keys(app: AppHandle, terminal_id: String, data: String) -> Result<(), String> {
    validate_keys_size(&data)?;
    let pty_manager = app.state::<PtyManager>();
    pty_manager.write(&terminal_id, data.as_bytes())
}

/// Capture recent output from a terminal pane
#[tauri::command]
pub fn capture_pane(
    app: AppHandle,
    terminal_id: String,
    lines: Option<usize>,
    strip_ansi_codes: Option<bool>,
) -> Result<String, String> {
    let registry = app.state::<OutputBufferRegistry>();
    let n = lines.unwrap_or(50).min(1000);
    let clean = strip_ansi_codes.unwrap_or(false);
    registry.capture(&terminal_id, n, clean)
}

/// Extract command blocks from a terminal's output buffer
#[tauri::command]
pub fn command_blocks(
    app: AppHandle,
    terminal_id: String,
) -> Result<Vec<crate::pty::buffer::CommandBlock>, String> {
    let registry = app.state::<OutputBufferRegistry>();
    registry.command_blocks(&terminal_id)
}

/// Send keystrokes to all active terminal panes (synchronize-panes)
#[tauri::command]
pub fn broadcast_keys(app: AppHandle, data: String) -> Result<u32, String> {
    validate_keys_size(&data)?;
    let pty_manager = app.state::<PtyManager>();
    let ids = pty_manager.list();
    let mut count: u32 = 0;
    for id in &ids {
        if pty_manager.write(id, data.as_bytes()).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

/// Rename a terminal pane (for send-keys-by-name)
#[tauri::command]
pub fn rename_pane(app: AppHandle, terminal_id: String, name: String) -> Result<(), String> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.rename(&terminal_id, &name)
}

/// Send keystrokes to a pane by its user-assigned name
#[tauri::command]
pub fn send_keys_by_name(app: AppHandle, name: String, data: String) -> Result<(), String> {
    validate_keys_size(&data)?;
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let terminal_id = pane_registry
        .find_by_name(&name)
        .ok_or_else(|| format!("No pane named '{}'", name))?;
    let pty_manager = app.state::<PtyManager>();
    pty_manager.write(&terminal_id, data.as_bytes())
}

/// List all registered panes with metadata
#[tauri::command]
pub fn list_panes_info(app: AppHandle) -> Vec<crate::pty::registry::PaneEntry> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.list()
}

/// Start watching a directory for file changes (100ms debounce → "fs:changed" event)
#[tauri::command]
pub fn start_fs_watcher(app: AppHandle, watch_path: String) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.start(app.clone(), watch_path)
}

/// Stop watching a directory
#[tauri::command]
pub fn stop_fs_watcher(watch_path: String, app: AppHandle) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.stop(&watch_path);
    Ok(())
}

/// Registry for active file watchers
#[derive(Default)]
pub struct FsWatcherRegistry {
    watchers: Mutex<HashMap<String, crate::watcher::WatcherHandle>>,
}

impl FsWatcherRegistry {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self, app: AppHandle, path: String) -> Result<(), String> {
        let mut watchers = self.watchers.lock().map_err(|_| "Lock poisoned".to_string())?;
        if watchers.contains_key(&path) {
            return Ok(()); // Already watching
        }
        let handle = crate::watcher::start_watcher(app, path.clone())?;
        watchers.insert(path, handle);
        Ok(())
    }

    pub fn stop(&self, path: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(path); // WatcherHandle drop stops the watcher
        }
    }
}

// ── Workflow commands ──

/// List available workflow definitions for a project
#[tauri::command]
pub fn list_workflows(project_path: String) -> Vec<crate::workflow::WorkflowSummary> {
    crate::workflow::list_workflow_files(&project_path)
}

/// Start a workflow execution
#[tauri::command]
pub fn start_workflow(
    app: AppHandle,
    project_path: String,
    workflow_path: String,
    task_title: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let workflow = crate::workflow::parse_workflow(&workflow_path)?;
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let id = executor.start(workflow, &task_title, &project_path)?;
    executor.status(&id)
}

/// Get the current phase config for a workflow (so frontend can start the agent)
#[tauri::command]
pub fn workflow_current_phase(
    app: AppHandle,
    workflow_id: String,
) -> Result<WorkflowPhaseInfo, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let (phase, prompt) = executor.current_phase_config(&workflow_id)?;
    Ok(WorkflowPhaseInfo {
        name: phase.name,
        model: phase.agent.model,
        prompt,
        max_cost: phase.agent.max_cost,
        has_gate: phase.quality_gate.is_some(),
        gate_type: phase.quality_gate.map(|g| format!("{:?}", g.gate_type)),
    })
}

#[derive(serde::Serialize)]
pub struct WorkflowPhaseInfo {
    pub name: String,
    pub model: String,
    pub prompt: String,
    pub max_cost: f64,
    pub has_gate: bool,
    pub gate_type: Option<String>,
}

/// Emit workflow status update event to frontend
fn emit_workflow_update(app: &AppHandle, executor: &crate::workflow::WorkflowExecutor) {
    let statuses = executor.list();
    let _ = app.emit("workflow-updated", statuses);
}

/// Record that an agent was started for the current phase
#[tauri::command]
pub fn workflow_set_agent(
    app: AppHandle,
    workflow_id: String,
    agent_session_id: String,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.set_phase_agent(&workflow_id, &agent_session_id)?;
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Mark current phase as waiting for gate approval
#[tauri::command]
pub fn workflow_phase_done(
    app: AppHandle,
    workflow_id: String,
    cost: f64,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.phase_waiting_gate(&workflow_id, cost)?;
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Approve the current quality gate → advance to next phase
#[tauri::command]
pub fn workflow_approve_gate(
    app: AppHandle,
    workflow_id: String,
) -> Result<bool, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let done = executor.approve_gate(&workflow_id)?;
    emit_workflow_update(&app, &executor);
    Ok(done)
}

/// Reject the current quality gate → retry the phase
#[tauri::command]
pub fn workflow_reject_gate(
    app: AppHandle,
    workflow_id: String,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.reject_gate(&workflow_id)?;
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Get workflow execution status
#[tauri::command]
pub fn workflow_status(
    app: AppHandle,
    workflow_id: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.status(&workflow_id)
}

/// List all running workflows
#[tauri::command]
pub fn list_running_workflows(app: AppHandle) -> Vec<crate::workflow::WorkflowStatus> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.list()
}

/// Remove a completed/cancelled workflow from the executor
#[tauri::command]
pub fn workflow_remove(app: AppHandle, workflow_id: String) {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.remove(&workflow_id);
}

// ── Agent session persistence ──

/// Save agent session to database for persistence across restarts
#[tauri::command]
pub fn save_agent_to_db(
    app: AppHandle,
    id: String,
    model: String,
    prompt: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_agent_session(&id, &model, &prompt, &status, cost, tokens_used))
}

/// Update agent session in database
#[tauri::command]
pub fn update_agent_in_db(
    app: AppHandle,
    id: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.update_agent_session(&id, &status, cost, tokens_used))
}

/// List recent agent sessions from database
#[tauri::command]
pub fn list_agent_history(app: AppHandle, limit: usize) -> Result<Vec<crate::db::AgentSessionRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_agent_sessions(limit))
}

// ── Command History ──

/// Save a command to history
#[tauri::command]
pub fn save_command_history(app: AppHandle, terminal_id: String, command: String, cwd: String) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_command(&terminal_id, &command, &cwd))
}

/// Search command history
#[tauri::command]
pub fn search_command_history(app: AppHandle, query: String, limit: usize) -> Result<Vec<crate::db::CommandRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.search_commands(&query, limit))
}

/// Get recent unique commands
#[tauri::command]
pub fn recent_commands(app: AppHandle, limit: usize) -> Result<Vec<String>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.recent_commands(limit))
}

// ── LSP commands ──

/// Start a language server for a file's language
#[tauri::command]
pub fn lsp_start(app: AppHandle, language: crate::lsp::LspLanguage, root_path: String) -> Result<crate::lsp::LspServerInfo, String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.start(language, &root_path)
}

/// Send a JSON-RPC request to a running language server
#[tauri::command]
pub fn lsp_request(app: AppHandle, language: crate::lsp::LspLanguage, root_path: String, json_rpc: String) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.send(&language, &root_path, &json_rpc)
}

/// Stop a language server
#[tauri::command]
pub fn lsp_stop(app: AppHandle, language: crate::lsp::LspLanguage, root_path: String) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.stop(&language, &root_path)
}

/// List running language servers
#[tauri::command]
pub fn lsp_list(app: AppHandle) -> Vec<crate::lsp::LspServerInfo> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.list()
}

/// List all files in a project (gitignore-aware for fuzzy finder)
#[tauri::command]
pub fn list_all_files(root_path: String, max_files: usize) -> Result<Vec<crate::git::FileListEntry>, String> {
    crate::git::list_all_files(&root_path, max_files)
}

/// Set the IME composition window position via Win32 API.
/// This directly tells Windows where to place the IME candidate popup,
/// bypassing WebView2's broken textarea-based positioning.
#[tauri::command]
pub fn set_ime_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::Input::Ime::*;
        use windows::Win32::Foundation::POINT;

        let window = app.get_webview_window("main")
            .ok_or("No main window")?;

        let hwnd = window.hwnd().map_err(|e| e.to_string())?;

        unsafe {
            let himc = ImmGetContext(hwnd);
            if himc.is_invalid() {
                return Err("Failed to get IME context".into());
            }

            let cf = COMPOSITIONFORM {
                dwStyle: CFS_POINT,
                ptCurrentPos: POINT { x: x as i32, y: y as i32 },
                ..Default::default()
            };
            let _ = ImmSetCompositionWindow(himc, &cf);

            // Also set candidate window position
            let cand = CANDIDATEFORM {
                dwIndex: 0,
                dwStyle: CFS_CANDIDATEPOS,
                ptCurrentPos: POINT { x: x as i32, y: y as i32 },
                ..Default::default()
            };
            let _ = ImmSetCandidateWindow(himc, &cand);

            let _ = ImmReleaseContext(hwnd, himc);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_allows_normal_paths() {
        assert!(validate_path("C:/Users/owner/project").is_ok());
        assert!(validate_path("/home/user/project").is_ok());
        assert!(validate_path("D:/work/code").is_ok());
    }

    #[test]
    fn validate_path_blocks_traversal() {
        assert!(validate_path("C:/Users/../etc").is_err());
        assert!(validate_path("../../etc/passwd").is_err());
    }

    #[test]
    fn validate_path_blocks_unc() {
        assert!(validate_path("\\\\server\\share").is_err());
        assert!(validate_path("//server/share").is_err());
    }

    #[test]
    fn validate_path_blocks_system_dirs() {
        assert!(validate_path("C:/Windows/System32").is_err());
        assert!(validate_path("c:\\windows\\system32").is_err());
        assert!(validate_path("C:/Program Files/app").is_err());
        assert!(validate_path("/etc/passwd").is_err());
        assert!(validate_path("/usr/bin/sh").is_err());
    }

    #[test]
    fn validate_path_case_insensitive_on_windows() {
        assert!(validate_path("C:/WINDOWS/temp").is_err());
        assert!(validate_path("c:/Program Files (x86)/app").is_err());
    }

    #[test]
    fn strip_ansi_removes_codes() {
        let input = "\x1b[31mError\x1b[0m: failed";
        let result = strip_ansi(input);
        assert_eq!(result, "Error: failed");
    }

    #[test]
    fn strip_ansi_preserves_plain_text() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }
}
