//! File-system and editor (VS Code) IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change. Shared helpers remain in `commands`.
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use super::commands::*;

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

pub(crate) fn vscode_open_args(
    path: &str,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<Vec<String>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }
    validate_path(trimmed)?;

    let line = line.filter(|value| *value > 0);
    let column = column.filter(|value| *value > 0);
    let Some(line) = line else {
        return Ok(vec![trimmed.to_string()]);
    };

    let target = match column {
        Some(column) => format!("{trimmed}:{line}:{column}"),
        None => format!("{trimmed}:{line}"),
    };
    Ok(vec!["-g".to_string(), target])
}

pub(crate) fn vscode_diff_args(left_path: &str, right_path: &str) -> Result<Vec<String>, String> {
    let left = left_path.trim();
    let right = right_path.trim();
    if left.is_empty() || right.is_empty() {
        return Err("Both diff paths are required".to_string());
    }
    validate_path(left)?;
    validate_path(right)?;
    Ok(vec![
        "--diff".to_string(),
        left.to_string(),
        right.to_string(),
    ])
}

fn vscode_command_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        candidates.push("code.cmd".to_string());
        candidates.push("code.exe".to_string());
        candidates.push("code".to_string());
        for base in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(root) = std::env::var(base) {
                candidates.push(
                    PathBuf::from(root)
                        .join("Microsoft VS Code")
                        .join("bin")
                        .join("code.cmd")
                        .to_string_lossy()
                        .to_string(),
                );
            }
        }
    }

    #[cfg(not(windows))]
    {
        candidates.push("code".to_string());
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

fn launch_vscode(args: &[String]) -> Result<(), String> {
    let mut errors = Vec::new();

    for candidate in vscode_command_candidates() {
        let mut command = crate::process::hidden_command(&candidate);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command.spawn() {
            Ok(_) => return Ok(()),
            Err(err) => errors.push(format!("{candidate}: {err}")),
        }
    }

    Err(format!(
        "Failed to launch VS Code. Install the `code` command or add VS Code to PATH. {}",
        errors.join("; ")
    ))
}

/// Open a file or directory in VS Code without flashing a foreground shell window.
#[tauri::command]
pub fn open_in_vscode(path: String, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
    let args = vscode_open_args(&path, line, column)?;
    launch_vscode(&args)
}

/// Open two concrete paths in VS Code's native diff view.
#[tauri::command]
pub fn open_in_vscode_diff(left_path: String, right_path: String) -> Result<(), String> {
    let args = vscode_diff_args(&left_path, &right_path)?;
    launch_vscode(&args)
}

pub(crate) fn safe_temp_diff_name(relative: &str) -> String {
    let sanitized: String = relative
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => ch,
            _ => '_',
        })
        .collect();
    if sanitized.is_empty() {
        "file".to_string()
    } else {
        sanitized
    }
}

fn current_diff_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Open a git working-tree file against HEAD in VS Code's native diff view.
#[tauri::command]
pub fn open_git_file_diff_in_vscode(repo_path: String, file_path: String) -> Result<(), String> {
    let repo = PathBuf::from(repo_path.trim());
    if repo.as_os_str().is_empty() {
        return Err("Repo path is required".to_string());
    }
    let repo_str = repo.to_string_lossy().to_string();
    validate_path(&repo_str)?;
    if !repo.is_dir() {
        return Err(format!("Not a directory: {}", repo.display()));
    }

    let raw_file = file_path.trim();
    if raw_file.is_empty() {
        return Err("File path is required".to_string());
    }
    let working_path = {
        let candidate = PathBuf::from(raw_file);
        if candidate.is_absolute() {
            candidate
        } else {
            repo.join(candidate)
        }
    };
    let working_str = working_path.to_string_lossy().to_string();
    validate_path(&working_str)?;

    let relative = git_relative_path(&repo_str, &working_str);
    let output = crate::process::hidden_command("git")
        .args(["show", &format!("HEAD:{}", relative)])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git show failed: {}", e))?;
    let original = if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("UTF-8 error: {}", e))?
    } else {
        String::new()
    };

    let temp_dir = std::env::temp_dir().join("aether-vscode-diff");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Create temp diff dir failed: {}", e))?;
    let safe_name = safe_temp_diff_name(&relative);
    let stamp = current_diff_stamp();
    let left_path = temp_dir.join(format!("{stamp}-HEAD-{safe_name}"));
    std::fs::write(&left_path, original)
        .map_err(|e| format!("Write original temp file failed: {}", e))?;

    let right_path = if working_path.exists() {
        working_path
    } else {
        let deleted_path = temp_dir.join(format!("{stamp}-WORKTREE-DELETED-{safe_name}"));
        std::fs::write(&deleted_path, "")
            .map_err(|e| format!("Write deleted temp file failed: {}", e))?;
        deleted_path
    };

    open_in_vscode_diff(
        left_path.to_string_lossy().to_string(),
        right_path.to_string_lossy().to_string(),
    )
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
