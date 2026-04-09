use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
}

/// List worktrees for a repo
pub fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let worktrees = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    let mut result = Vec::new();
    for name in worktrees.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(name) {
            let wt_path = wt.path().to_string_lossy().to_string().replace('\\', "/");
            // Get branch of worktree
            let branch = match Repository::open(wt.path()) {
                Ok(wt_repo) => wt_repo
                    .head()
                    .ok()
                    .and_then(|h| h.shorthand().map(String::from))
                    .unwrap_or_else(|| "detached".to_string()),
                Err(_) => "unknown".to_string(),
            };

            result.push(WorktreeInfo {
                name: name.to_string(),
                path: wt_path,
                branch,
            });
        }
    }
    Ok(result)
}

/// List branches for a repo
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
