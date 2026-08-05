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

/// A7 authority path: exact accepted base, clean registered worktree, and no
/// unrelated path reuse. Compatibility callers keep `ensure_for_branch`.
pub fn ensure_for_mission(
    repo_path: &str,
    branch: &str,
    accepted_base_oid: &str,
) -> ControlResult<WorktreeInfo> {
    git::ensure_worktree_at_base(repo_path, branch, accepted_base_oid)
}

/// A7 authority path: freeze only backend-derived owned targets. This creates
/// an immutable candidate for fresh testing but does not review or merge it.
pub fn freeze_mission_candidate(
    repo_path: &str,
    branch: &str,
    accepted_base_oid: &str,
    owned_paths: &[String],
    message: &str,
) -> ControlResult<git::ScopedCandidateFreeze> {
    git::freeze_owned_candidate(repo_path, branch, accepted_base_oid, owned_paths, message)
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

/// Commit only backend-declared task outputs. Incidental runtime/build files
/// remain outside the candidate and are removed with the isolated worktree.
pub fn commit_owned_for_branch(
    repo_path: &str,
    branch: &str,
    owned_paths: &[String],
    message: &str,
) -> ControlResult<Option<String>> {
    git::commit_owned_worktree(repo_path, branch, owned_paths, message)
}

/// Remove a task's worktree by its BRANCH (resolves to the predicted path, which
/// `git worktree remove` accepts) after its work has merged — loop cleanup. See
/// [`git::remove_worktree_for_branch`].
pub fn remove_for_branch(repo_path: &str, branch: &str, delete_branch: bool) -> ControlResult<()> {
    git::remove_worktree_for_branch(repo_path, branch, delete_branch)
}

/// Restart-safe post-merge cleanup. Unlike `remove_for_branch`, this succeeds
/// when a previous attempt already removed the worktree and still verifies that
/// the local source branch is gone.
pub fn remove_for_branch_idempotent(repo_path: &str, branch: &str) -> ControlResult<()> {
    git::remove_worktree_for_branch_idempotent(repo_path, branch)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delegates_branch_validation_and_path_prediction() {
        assert!(validate_branch("agent/implementer-demo").is_ok());
        assert!(validate_branch("../main").is_err());
        let predicted = predict_path("C:/repo/aelyris", "agent/demo")
            .to_string_lossy()
            .replace('\\', "/");
        assert!(predicted.ends_with("repo/aelyris-agent/demo"));
    }
}
