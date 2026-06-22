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

/// Create the worktree for `branch` if it is not already on disk (idempotent).
/// The autonomy loop calls this at dispatch so each worker has its isolated
/// worktree without the conductor pre-creating it. See [`git::ensure_worktree`].
pub fn ensure_for_branch(repo_path: &str, branch: &str) -> ControlResult<()> {
    git::ensure_worktree(repo_path, branch)
}

/// Commit a green-reviewed task's worktree on its BRANCH before the loop merges
/// it, so `perform_merge` sees the worker's real work as ahead of the target
/// instead of an empty tip. `Ok(None)` means there was nothing to commit
/// (idempotent / empty diff). See [`git::commit_worktree`].
pub fn commit_for_branch(
    repo_path: &str,
    branch: &str,
    message: &str,
) -> ControlResult<Option<String>> {
    git::commit_worktree(repo_path, branch, message)
}

/// Remove the worktree for `branch` after its work has merged (loop cleanup), by
/// its predicted path. See [`git::remove_worktree_for_branch`].
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
