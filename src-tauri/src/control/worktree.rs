use std::path::PathBuf;

use crate::control::ControlResult;
use crate::git::{self, WorktreeInfo};

pub fn validate_branch(name: &str) -> ControlResult<()> {
    git::validate_branch_name(name)
}

pub fn predict_path(repo_path: &str, branch_name: &str) -> PathBuf {
    git::predict_worktree_path(repo_path, branch_name)
}

pub fn list(repo_path: &str) -> ControlResult<Vec<WorktreeInfo>> {
    git::list_worktrees(repo_path)
}

pub fn create(repo_path: &str, branch_name: &str) -> ControlResult<WorktreeInfo> {
    git::create_worktree(repo_path, branch_name)
}

pub fn remove(repo_path: &str, worktree_name: &str, delete_branch: bool) -> ControlResult<()> {
    git::remove_worktree(repo_path, worktree_name, delete_branch)
}

/// Remove a task's worktree by its BRANCH (resolves to the predicted path, which
/// `git worktree remove` actually accepts). Used by the loop to reclaim a merged
/// task's isolated worktree.
pub fn remove_for_branch(repo_path: &str, branch: &str, delete_branch: bool) -> ControlResult<()> {
    git::remove_worktree_for_branch(repo_path, branch, delete_branch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delegates_branch_validation_and_path_prediction() {
        assert!(validate_branch("agent/implementer-demo").is_ok());
        assert!(validate_branch("../main").is_err());
        let predicted = predict_path("C:/repo/aether", "agent/demo")
            .to_string_lossy()
            .replace('\\', "/");
        assert!(predicted.ends_with("repo/aether-agent/demo"));
    }
}
