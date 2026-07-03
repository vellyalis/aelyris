//! Git / SCM command handlers: project discovery, branches, worktrees,
//! status/stage/commit/push, file diffs, and GitHub PR listing.
//!
//! Pure move from `commands.rs` during the IPC god-file split.
//! `git_relative_path` (pub(crate)) is a shared helper also used by
//! `fs_commands`.

/// Discover Git projects in scan directories
#[tauri::command]
pub fn discover_projects(scan_dirs: Vec<String>) -> Vec<crate::git::ProjectInfo> {
    crate::git::discover_projects(&scan_dirs)
}

/// Default project scan directories for the current user — Documents,
/// Desktop, and the user's home. Returned as platform-absolute paths so the
/// frontend can hand them straight to `discover_projects` without pulling
/// in `~` expansion or environment-variable logic in JS.
///
/// Returns an empty vec if the user profile can't be resolved (extremely
/// rare on Windows; the frontend should have its own fallback).
#[tauri::command]
pub fn default_project_scan_dirs() -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    // `home_dir` is deprecated in the std crate but the Tauri v2 ecosystem
    // still relies on it. The frontend will dedupe any duplicate paths.
    #[allow(deprecated)]
    if let Some(home) = std::env::home_dir() {
        let home_str = home.to_string_lossy().replace('\\', "/");
        dirs.push(format!("{}/Documents", home_str));
        dirs.push(format!("{}/Desktop", home_str));
        dirs.push(home_str);
    }
    dirs
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
pub fn create_worktree(
    repo_path: String,
    branch_name: String,
) -> Result<crate::git::WorktreeInfo, String> {
    crate::git::create_worktree(&repo_path, &branch_name)
}

/// Validate a branch name against the same rules `create_worktree` enforces
/// server-side, so the UI can fail fast with a clean error before any git
/// side-effect instead of relying on the validation buried inside
/// `create_worktree`.
#[tauri::command]
pub fn validate_branch_name(name: String) -> Result<(), String> {
    crate::git::validate_branch_name(&name)
}

/// Remove a git worktree (and optionally its branch)
#[tauri::command]
pub fn remove_worktree(
    repo_path: String,
    worktree_name: String,
    delete_branch: bool,
) -> Result<(), String> {
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

fn run_git_cmd_with_output(
    repo_path: &str,
    args: &[impl AsRef<std::ffi::OsStr>],
) -> Result<String, String> {
    let output = crate::process::hidden_command("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git command failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get original file content from git HEAD (for diff)
#[tauri::command]
pub fn git_file_original(repo_path: String, file_path: String) -> Result<String, String> {
    let relative = git_relative_path(&repo_path, &file_path);

    let output = crate::process::hidden_command("git")
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

pub(crate) fn git_relative_path(repo_path: &str, file_path: &str) -> String {
    let repo_norm = repo_path.replace('\\', "/");
    let file_norm = file_path.replace('\\', "/");
    file_norm
        .strip_prefix(&repo_norm)
        .unwrap_or(&file_norm)
        .trim_start_matches('/')
        .to_string()
}

/// Get unified diff for a specific file against HEAD.
#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String) -> Result<String, String> {
    let relative = git_relative_path(&repo_path, &file_path);

    let output = crate::process::hidden_command("git")
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
pub fn git_diff_files(
    repo_path: String,
    file_paths: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::new();

    for file_path in file_paths {
        let relative = git_relative_path(&repo_path, &file_path);

        let output = crate::process::hidden_command("git")
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
    let output = crate::process::hidden_command("gh")
        .args([
            "pr",
            "list",
            "--json",
            "number,title,state,author,headRefName,url,isDraft,updatedAt,reviewDecision,statusCheckRollup",
            "--limit",
            "10",
        ])
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
    #[serde(rename = "isDraft", default)]
    pub is_draft: bool,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    /// `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` / `COMMENTED` / ``.
    #[serde(rename = "reviewDecision", default)]
    pub review_decision: String,
    /// Each check entry has at minimum a `conclusion` ("SUCCESS" / "FAILURE" /
    /// "NEUTRAL" / "CANCELLED" / "SKIPPED" / "TIMED_OUT" / "ACTION_REQUIRED")
    /// and a `status` ("QUEUED" / "IN_PROGRESS" / "COMPLETED"). We keep it as
    /// a JSON value and let the frontend aggregate.
    #[serde(rename = "statusCheckRollup", default)]
    pub status_check_rollup: serde_json::Value,
}

/// View a specific PR's diff
#[tauri::command]
pub fn get_pr_diff(cwd: String, pr_number: u32) -> Result<String, String> {
    let output = crate::process::hidden_command("gh")
        .args(["pr", "diff", &pr_number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh diff failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    String::from_utf8(output.stdout).map_err(|e| format!("UTF-8: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_relative_path_accepts_absolute_or_relative_file_path() {
        assert_eq!(
            git_relative_path("C:/repo/project", "C:/repo/project/src/main.rs"),
            "src/main.rs"
        );
        assert_eq!(
            git_relative_path("C:/repo/project", "src/main.rs"),
            "src/main.rs"
        );
    }
}
