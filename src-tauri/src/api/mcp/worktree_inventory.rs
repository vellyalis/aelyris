use serde::Serialize;

use crate::git::{WorktreeInfo, WorktreeStatus};

use super::super::{ApiError, ApiResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorktreeInventoryProjection {
    name: String,
    branch: String,
    is_main: bool,
    head_sha: String,
    status: WorktreeStatus,
}

pub(super) fn repository_digest(repo_path: &str) -> String {
    let normalized = repo_path.replace('\\', "/").to_ascii_lowercase();
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.worktree-inventory-repository\n{normalized}"
    ))
    .as_str()
    .to_string()
}

pub(super) fn project_worktrees(
    mut worktrees: Vec<WorktreeInfo>,
) -> Vec<WorktreeInventoryProjection> {
    worktrees.sort_by(|left, right| {
        right
            .is_main
            .cmp(&left.is_main)
            .then_with(|| left.name.cmp(&right.name))
    });
    worktrees
        .into_iter()
        .map(|worktree| WorktreeInventoryProjection {
            name: worktree.name,
            branch: worktree.branch,
            is_main: worktree.is_main,
            head_sha: worktree.head_sha,
            status: worktree.status,
        })
        .collect()
}

pub(super) fn get(repo_path: &str) -> ApiResult<serde_json::Value> {
    let worktrees = crate::control::worktree::list(repo_path).map_err(ApiError::BadRequest)?;
    let worktrees = project_worktrees(worktrees);
    Ok(serde_json::json!({
        "repositoryDigest": repository_digest(repo_path),
        "source": "git-worktree-owner",
        "worktreeCount": worktrees.len(),
        "worktrees": worktrees,
        "repositoryPathExposed": false,
        "worktreePathsExposed": false,
        "readOnly": true,
    }))
}
