use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub head_sha: String,
    pub status: WorktreeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WorktreeStatus {
    Clean,
    Modified,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
}

/// List worktrees for a repo (includes main worktree)
pub fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut result = Vec::new();

    // Add the main worktree first
    let main_branch = repo.head().ok()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "HEAD".to_string());
    let main_sha = repo.head().ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string())
        .unwrap_or_default();
    let main_path = repo.workdir()
        .map(|p| p.to_string_lossy().to_string().replace('\\', "/"))
        .unwrap_or_else(|| repo_path.replace('\\', "/"));
    let main_status = worktree_status_for_repo(&repo);
    result.push(WorktreeInfo {
        name: "main".to_string(),
        path: main_path,
        branch: main_branch,
        is_main: true,
        head_sha: main_sha,
        status: main_status,
    });

    // Add linked worktrees
    let worktrees = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    for name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(name) {
            let wt_path = wt.path().to_string_lossy().to_string().replace('\\', "/");
            let (branch, head_sha, status) = match Repository::open(wt.path()) {
                Ok(wt_repo) => {
                    let b = wt_repo.head().ok()
                        .and_then(|h| h.shorthand().map(String::from))
                        .unwrap_or_else(|| "detached".to_string());
                    let sha = wt_repo.head().ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .map(|c| c.id().to_string())
                        .unwrap_or_default();
                    let s = worktree_status_for_repo(&wt_repo);
                    (b, sha, s)
                }
                Err(_) => ("unknown".to_string(), String::new(), WorktreeStatus::Clean),
            };

            result.push(WorktreeInfo {
                name: name.to_string(),
                path: wt_path,
                branch,
                is_main: false,
                head_sha,
                status,
            });
        }
    }
    Ok(result)
}

/// Determine worktree status by checking for changes/conflicts
fn worktree_status_for_repo(repo: &Repository) -> WorktreeStatus {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(false);
    match repo.statuses(Some(&mut opts)) {
        Ok(statuses) => {
            let has_conflict = statuses.iter().any(|e| e.status().is_conflicted());
            if has_conflict {
                WorktreeStatus::Conflicted
            } else if statuses.is_empty() {
                WorktreeStatus::Clean
            } else {
                WorktreeStatus::Modified
            }
        }
        Err(_) => WorktreeStatus::Clean,
    }
}

/// Remove a worktree and optionally delete the branch
pub fn remove_worktree(repo_path: &str, worktree_name: &str, delete_branch: bool) -> Result<(), String> {
    validate_branch_name(worktree_name)?;
    // Use git CLI for reliable worktree removal (handles locked worktrees)
    let output = std::process::Command::new("git")
        .args(["worktree", "remove", worktree_name, "--force"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git worktree remove failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worktree removal failed: {}", stderr));
    }

    // Prune stale worktree references
    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output();

    if delete_branch {
        let _ = std::process::Command::new("git")
            .args(["branch", "-D", worktree_name])
            .current_dir(repo_path)
            .output();
    }

    Ok(())
}

/// Validate branch name: alphanumeric, hyphens, underscores, slashes, dots only. No ".." or absolute paths.
fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if name.contains("..") || name.starts_with('/') || name.starts_with('\\') || name.contains(':') {
        return Err(format!("Invalid branch name: {}", name));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.') {
        return Err(format!("Branch name contains invalid characters: {}", name));
    }
    Ok(())
}

/// Predict where `create_worktree(repo_path, branch_name)` will place the
/// worktree — used by ghostdiff to register a layer before the worktree
/// exists on disk, so the fs watcher can start as soon as it does.
///
/// Mirrors the formula in `create_worktree`; the two must stay in sync.
pub fn predict_worktree_path(repo_path: &str, branch_name: &str) -> std::path::PathBuf {
    let repo = std::path::Path::new(repo_path);
    let parent = repo.parent().unwrap_or(repo);
    let name = repo.file_name().unwrap_or_default().to_string_lossy();
    parent.join(format!("{}-{}", name, branch_name))
}

/// Create a new worktree for a branch
pub fn create_worktree(repo_path: &str, branch_name: &str) -> Result<WorktreeInfo, String> {
    validate_branch_name(branch_name)?;
    let _repo = Repository::open(repo_path).map_err(|e| format!("Open repo: {}", e))?;
    let worktree_dir = predict_worktree_path(repo_path, branch_name);

    let worktree_path = worktree_dir.to_string_lossy().to_string().replace('\\', "/");

    // Use git command directly for reliability
    let output = std::process::Command::new("git")
        .args(["worktree", "add", &worktree_dir.to_string_lossy(), "-b", branch_name])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git command failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try without -b (branch already exists)
        let output2 = std::process::Command::new("git")
            .args(["worktree", "add", &worktree_dir.to_string_lossy(), branch_name])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Git command failed: {}", e))?;
        if !output2.status.success() {
            return Err(format!("Worktree creation failed: {}", stderr));
        }
    }

    // Get the HEAD sha of the new worktree
    let head_sha = match Repository::open(&worktree_dir) {
        Ok(wt_repo) => wt_repo.head().ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string())
            .unwrap_or_default(),
        Err(_) => String::new(),
    };

    Ok(WorktreeInfo {
        name: branch_name.to_string(),
        path: worktree_path,
        branch: branch_name.to_string(),
        is_main: false,
        head_sha,
        status: WorktreeStatus::Clean,
    })
}

pub fn list_branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let branches = repo
        .branches(None)
        .map_err(|e| format!("Failed to list branches: {}", e))?;

    let mut result = Vec::new();
    for branch in branches.flatten() {
        let (branch_ref, branch_type) = branch;
        let name = branch_ref
            .name()
            .ok()
            .flatten()
            .unwrap_or("unknown")
            .to_string();
        let is_head = branch_ref.is_head();
        let is_remote = branch_type == git2::BranchType::Remote;
        result.push(BranchInfo {
            name,
            is_head,
            is_remote,
        });
    }
    Ok(result)
}
