use serde::{Deserialize, Serialize};

use super::validate_branch_name;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeReadiness {
    pub repo_path: String,
    pub source_branch: String,
    pub target_branch: String,
    pub source_oid: String,
    pub target_oid: String,
    pub merge_base_oid: Option<String>,
    pub source_ahead: usize,
    pub source_behind: usize,
    pub can_fast_forward: bool,
    pub already_merged: bool,
    pub status: String,
}

fn resolve_branchish(repo: &git2::Repository, name: &str) -> Result<git2::Oid, String> {
    let local_ref = format!("refs/heads/{name}");
    let remote_ref = format!("refs/remotes/{name}");
    for candidate in [local_ref.as_str(), remote_ref.as_str(), name] {
        if let Ok(reference) = repo.find_reference(candidate) {
            return reference
                .peel_to_commit()
                .map(|commit| commit.id())
                .map_err(|err| format!("resolve branch `{name}`: {err}"));
        }
    }

    repo.revparse_single(name)
        .and_then(|object| object.peel_to_commit())
        .map(|commit| commit.id())
        .map_err(|err| format!("branch `{name}` not found: {err}"))
}

pub fn inspect_merge_worktree_branch(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeReadiness, String> {
    validate_branch_name(source_branch)?;
    validate_branch_name(target_branch)?;
    if source_branch == target_branch {
        return Err("source and target branch must be different".to_string());
    }

    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    let source_oid = resolve_branchish(&repo, source_branch)?;
    let target_oid = resolve_branchish(&repo, target_branch)?;
    let merge_base_oid = repo.merge_base(source_oid, target_oid).ok();
    let (source_ahead, source_behind) = repo
        .graph_ahead_behind(source_oid, target_oid)
        .map_err(|err| format!("ahead/behind: {err}"))?;

    let already_merged = source_ahead == 0;
    let can_fast_forward = source_ahead > 0 && source_behind == 0;
    let status = if already_merged {
        "already_merged"
    } else if can_fast_forward {
        "fast_forward_ready"
    } else {
        "merge_review_required"
    };

    Ok(MergeReadiness {
        repo_path: repo_path.to_string(),
        source_branch: source_branch.to_string(),
        target_branch: target_branch.to_string(),
        source_oid: source_oid.to_string(),
        target_oid: target_oid.to_string(),
        merge_base_oid: merge_base_oid.map(|oid| oid.to_string()),
        source_ahead,
        source_behind,
        can_fast_forward,
        already_merged,
        status: status.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_same_branch() {
        let err = inspect_merge_worktree_branch(".", "main", "main").expect_err("rejects");
        assert!(err.contains("different"));
    }

    #[test]
    fn rejects_invalid_branch_before_opening_repo() {
        let err = inspect_merge_worktree_branch(".", "../agent", "main").expect_err("rejects");
        assert!(!err.is_empty());
    }
}
