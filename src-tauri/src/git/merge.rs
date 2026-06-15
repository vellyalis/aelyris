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

/// The result of merging `source_branch` into `target_branch` (BR9).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MergeOutcome {
    /// Source has nothing ahead of target — nothing to do.
    AlreadyMerged,
    /// Target was fast-forwarded to the source tip (no merge commit).
    FastForwarded { target_oid: String },
    /// A merge commit was created on target with both parents.
    Merged { merge_commit_oid: String },
    /// The 3-way merge has conflicts; nothing was committed.
    Conflict { paths: Vec<String> },
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

fn repo_signature(repo: &git2::Repository) -> Result<git2::Signature<'static>, String> {
    repo.signature()
        .or_else(|_| git2::Signature::now("Aether", "aether@local"))
        .map_err(|err| format!("signature: {err}"))
}

fn head_is_branch(repo: &git2::Repository, branch: &str) -> bool {
    repo.head()
        .ok()
        .and_then(|head| head.shorthand().map(|name| name == branch))
        .unwrap_or(false)
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

/// Merge `source_branch` into `target_branch` at the object/ref level. Fast-
/// forwards when target has no unique commits, otherwise creates a merge
/// commit; reports conflicts without committing anything. When the target
/// branch is the checked-out HEAD, the working tree is updated to match.
pub fn perform_merge(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeOutcome, String> {
    validate_branch_name(source_branch)?;
    validate_branch_name(target_branch)?;
    if source_branch == target_branch {
        return Err("source and target branch must be different".to_string());
    }

    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    let source_oid = resolve_branchish(&repo, source_branch)?;
    let target_oid = resolve_branchish(&repo, target_branch)?;
    let (source_ahead, source_behind) = repo
        .graph_ahead_behind(source_oid, target_oid)
        .map_err(|err| format!("ahead/behind: {err}"))?;

    if source_ahead == 0 {
        return Ok(MergeOutcome::AlreadyMerged);
    }

    let target_refname = format!("refs/heads/{target_branch}");

    if source_behind == 0 {
        let mut reference = repo
            .find_reference(&target_refname)
            .map_err(|err| format!("find target ref: {err}"))?;
        reference
            .set_target(source_oid, "aether fast-forward merge")
            .map_err(|err| format!("fast-forward: {err}"))?;
        if head_is_branch(&repo, target_branch) {
            repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
                .map_err(|err| format!("checkout after fast-forward: {err}"))?;
        }
        return Ok(MergeOutcome::FastForwarded {
            target_oid: source_oid.to_string(),
        });
    }

    let target_commit = repo
        .find_commit(target_oid)
        .map_err(|err| format!("find target commit: {err}"))?;
    let source_commit = repo
        .find_commit(source_oid)
        .map_err(|err| format!("find source commit: {err}"))?;
    let mut index = repo
        .merge_commits(&target_commit, &source_commit, None)
        .map_err(|err| format!("merge: {err}"))?;

    if index.has_conflicts() {
        let mut paths = Vec::new();
        for conflict in index
            .conflicts()
            .map_err(|err| format!("conflicts: {err}"))?
        {
            let conflict = conflict.map_err(|err| format!("conflict entry: {err}"))?;
            if let Some(entry) = conflict.our.or(conflict.their).or(conflict.ancestor) {
                if let Ok(path) = std::str::from_utf8(&entry.path) {
                    paths.push(path.to_string());
                }
            }
        }
        paths.sort();
        paths.dedup();
        return Ok(MergeOutcome::Conflict { paths });
    }

    let tree_oid = index
        .write_tree_to(&repo)
        .map_err(|err| format!("write merged tree: {err}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|err| format!("find merged tree: {err}"))?;
    let sig = repo_signature(&repo)?;
    let message = format!("Merge branch '{source_branch}' into {target_branch}");
    let merge_commit = repo
        .commit(
            Some(&target_refname),
            &sig,
            &sig,
            &message,
            &tree,
            &[&target_commit, &source_commit],
        )
        .map_err(|err| format!("create merge commit: {err}"))?;
    if head_is_branch(&repo, target_branch) {
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(|err| format!("checkout after merge: {err}"))?;
    }
    Ok(MergeOutcome::Merged {
        merge_commit_oid: merge_commit.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{build::CheckoutBuilder, Repository};
    use std::path::Path;

    fn init_repo() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        (dir, repo)
    }

    /// Stage `files` and commit them to HEAD on top of `parents`.
    fn commit(
        repo: &Repository,
        files: &[(&str, &str)],
        msg: &str,
        parents: &[git2::Oid],
    ) -> git2::Oid {
        let workdir = repo.workdir().unwrap().to_path_buf();
        for (name, content) in files {
            std::fs::write(workdir.join(name), content).unwrap();
        }
        let mut index = repo.index().unwrap();
        for (name, _) in files {
            index.add_path(Path::new(name)).unwrap();
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "t@test").unwrap();
        let parent_commits: Vec<git2::Commit> = parents
            .iter()
            .map(|oid| repo.find_commit(*oid).unwrap())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap()
    }

    fn checkout_branch(repo: &Repository, branch: &str) {
        repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
    }

    fn path_of(repo: &Repository) -> String {
        repo.workdir().unwrap().to_str().unwrap().to_string()
    }

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

    #[test]
    fn merge_of_unchanged_branch_is_already_merged() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        let outcome = perform_merge(&path_of(&repo), "feature", "main").unwrap();
        assert_eq!(outcome, MergeOutcome::AlreadyMerged);
    }

    #[test]
    fn fast_forwards_when_target_has_no_unique_commits() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout_branch(&repo, "feature");
        let b = commit(&repo, &[("b.txt", "B")], "B", &[a]);
        // HEAD is `feature`, so merging into `main` only moves main's ref.
        let outcome = perform_merge(&path_of(&repo), "feature", "main").unwrap();
        assert_eq!(
            outcome,
            MergeOutcome::FastForwarded {
                target_oid: b.to_string()
            }
        );
        assert_eq!(resolve_branchish(&repo, "main").unwrap(), b);
    }

    #[test]
    fn three_way_merges_divergent_non_conflicting_branches() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout_branch(&repo, "feature");
        commit(&repo, &[("b.txt", "B")], "B", &[a]);
        checkout_branch(&repo, "main");
        commit(&repo, &[("c.txt", "C")], "C", &[a]);
        let outcome = perform_merge(&path_of(&repo), "feature", "main").unwrap();
        assert!(
            matches!(outcome, MergeOutcome::Merged { .. }),
            "got {outcome:?}"
        );
        // The merge brought feature's file into the checked-out main worktree.
        assert!(repo.workdir().unwrap().join("b.txt").exists());
    }

    #[test]
    fn reports_conflicting_paths_without_committing() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("shared.txt", "base")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout_branch(&repo, "feature");
        commit(&repo, &[("shared.txt", "feature change")], "B", &[a]);
        checkout_branch(&repo, "main");
        let main_tip = commit(&repo, &[("shared.txt", "main change")], "C", &[a]);
        let outcome = perform_merge(&path_of(&repo), "feature", "main").unwrap();
        assert_eq!(
            outcome,
            MergeOutcome::Conflict {
                paths: vec!["shared.txt".to_string()]
            }
        );
        // Nothing was committed: main still points at its own tip.
        assert_eq!(resolve_branchish(&repo, "main").unwrap(), main_tip);
    }
}
