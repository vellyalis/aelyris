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
        .or_else(|_| git2::Signature::now("Aelyris", "aelyris@local"))
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

/// Resolve a branch (local/remote/ref) to its current tip OID as a hex string.
/// Used to capture immutable merge-intent OIDs at request time and to re-check
/// branch tips during restart reconciliation (P0-3). Errs if the branch is gone.
pub fn resolve_branch_oid(repo_path: &str, branch: &str) -> Result<String, String> {
    validate_branch_name(branch)?;
    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    Ok(resolve_branchish(&repo, branch)?.to_string())
}

/// Does `branch`'s current tip contain `commit_oid` (i.e. is that commit an
/// ancestor of, or equal to, the tip)? Used by P0-3 restart reconciliation to
/// detect a merge that actually landed before a crash. Errs if the repo/branch
/// is unavailable or `commit_oid` is malformed.
pub fn branch_contains_commit(
    repo_path: &str,
    branch: &str,
    commit_oid: &str,
) -> Result<bool, String> {
    validate_branch_name(branch)?;
    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    let branch_oid = resolve_branchish(&repo, branch)?;
    let commit = git2::Oid::from_str(commit_oid)
        .map_err(|err| format!("invalid commit oid `{commit_oid}`: {err}"))?;
    if branch_oid == commit {
        return Ok(true);
    }
    repo.graph_descendant_of(branch_oid, commit)
        .map_err(|err| format!("ancestry check: {err}"))
}

/// The result of an OID-BOUND merge (P0-3 `perform_merge_bound`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BoundMergeResult {
    /// The merge ran against exactly the reviewed commits.
    Merged(MergeOutcome),
    /// A branch tip no longer matches the reviewed OID, so the bound merge was
    /// NOT performed — the caller must reconcile (this is not the reviewed merge).
    StaleTips,
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
    merge_resolved(&repo, source_branch, target_branch, source_oid, target_oid)
}

/// OID-BOUND merge (P0-3): like [`perform_merge`], but the caller passes the
/// branch tip OIDs it reviewed. The repo is opened ONCE; the live tips are
/// resolved and compared to the expected OIDs, and only if BOTH still match is
/// the merge performed — against those exact commits, with no second name
/// re-resolution. A tip that moved since review yields `StaleTips` instead of
/// silently merging an unreviewed commit. This is what makes
/// `aelyris.review.approve` merge only the reviewed change (hard boundary #4).
pub fn perform_merge_bound(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
    expected_source_oid: &str,
    expected_target_oid: &str,
) -> Result<BoundMergeResult, String> {
    validate_branch_name(source_branch)?;
    validate_branch_name(target_branch)?;
    if source_branch == target_branch {
        return Err("source and target branch must be different".to_string());
    }
    let expected_source = git2::Oid::from_str(expected_source_oid)
        .map_err(|err| format!("invalid expected source oid: {err}"))?;
    let expected_target = git2::Oid::from_str(expected_target_oid)
        .map_err(|err| format!("invalid expected target oid: {err}"))?;

    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    let source_oid = resolve_branchish(&repo, source_branch)?;
    let target_oid = resolve_branchish(&repo, target_branch)?;
    // The reviewed commits must still be the live tips, or this is not the merge
    // that was approved.
    if source_oid != expected_source || target_oid != expected_target {
        return Ok(BoundMergeResult::StaleTips);
    }
    merge_resolved(&repo, source_branch, target_branch, source_oid, target_oid)
        .map(BoundMergeResult::Merged)
}

/// The shared merge body, operating on ALREADY-RESOLVED tip OIDs (no name
/// re-resolution). Just before each ref-mutating write it re-checks that the
/// target ref is still at `target_oid`, so a concurrent writer moving the target
/// between resolution and write can never be clobbered (it errors instead).
fn merge_resolved(
    repo: &git2::Repository,
    source_branch: &str,
    target_branch: &str,
    source_oid: git2::Oid,
    target_oid: git2::Oid,
) -> Result<MergeOutcome, String> {
    let (source_ahead, source_behind) = repo
        .graph_ahead_behind(source_oid, target_oid)
        .map_err(|err| format!("ahead/behind: {err}"))?;

    if source_ahead == 0 {
        return Ok(MergeOutcome::AlreadyMerged);
    }

    let target_refname = format!("refs/heads/{target_branch}");

    if source_behind == 0 {
        // ATOMIC old-OID-bound update (no check-then-set window): move the target
        // ref to the source tip ONLY if it still points at `target_oid`. A
        // concurrent move makes this fail rather than clobber the other write.
        repo.reference_matching(
            &target_refname,
            source_oid,
            true,
            target_oid,
            "aelyris fast-forward merge",
        )
        .map_err(|err| format!("fast-forward (target moved?): {err}"))?;
        if head_is_branch(repo, target_branch) {
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
        .write_tree_to(repo)
        .map_err(|err| format!("write merged tree: {err}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|err| format!("find merged tree: {err}"))?;
    let sig = repo_signature(repo)?;
    let message = format!("Merge branch '{source_branch}' into {target_branch}");
    // Build the merge commit WITHOUT moving the ref (update_ref=None), then move
    // the target ref atomically from `target_oid` to the new commit — so a
    // concurrent target move is detected and never clobbered.
    let merge_commit = repo
        .commit(
            None,
            &sig,
            &sig,
            &message,
            &tree,
            &[&target_commit, &source_commit],
        )
        .map_err(|err| format!("create merge commit: {err}"))?;
    repo.reference_matching(
        &target_refname,
        merge_commit,
        true,
        target_oid,
        "aelyris merge",
    )
    .map_err(|err| format!("advance target ref (moved?): {err}"))?;
    if head_is_branch(repo, target_branch) {
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(|err| format!("checkout after merge: {err}"))?;
    }
    Ok(MergeOutcome::Merged {
        merge_commit_oid: merge_commit.to_string(),
    })
}

/// Unified diff of what `branch` introduces relative to `base`: the three-dot
/// diff `merge-base(base, branch)..branch`, rendered as patch text for the
/// semantic reviewer. The patch body is a HARD-capped at `max_bytes` — lines are
/// added whole and a line that would exceed the cap is dropped (a marker is then
/// appended), so the body never exceeds `max_bytes` (the appended marker aside) and
/// a large branch can't blow the LLM's context. When the branches share no merge
/// base, falls back to diffing against `base`'s tip.
pub fn diff_three_dot(
    repo_path: &str,
    base: &str,
    branch: &str,
    max_bytes: usize,
) -> Result<String, String> {
    validate_branch_name(base)?;
    validate_branch_name(branch)?;

    let repo = git2::Repository::open(repo_path).map_err(|err| format!("open repo: {err}"))?;
    let base_oid = resolve_branchish(&repo, base)?;
    let branch_oid = resolve_branchish(&repo, branch)?;
    // Diff against the common ancestor (three-dot) so only the branch's own work
    // shows, not commits the target gained meanwhile.
    let from_oid = repo.merge_base(base_oid, branch_oid).unwrap_or(base_oid);

    let from_tree = repo
        .find_commit(from_oid)
        .and_then(|c| c.tree())
        .map_err(|err| format!("base tree: {err}"))?;
    let branch_tree = repo
        .find_commit(branch_oid)
        .and_then(|c| c.tree())
        .map_err(|err| format!("branch tree: {err}"))?;

    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3);
    let diff = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&branch_tree), Some(&mut opts))
        .map_err(|err| format!("diff: {err}"))?;

    let mut buf = String::new();
    let mut truncated = false;
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let origin = line.origin();
        let prefix_len = usize::from(matches!(origin, '+' | '-' | ' '));
        let content = String::from_utf8_lossy(line.content());
        // Hard cap: only add the line if the whole line fits, so `buf` never
        // exceeds `max_bytes`; the first line that would overflow stops the patch.
        if buf.len() + prefix_len + content.len() <= max_bytes {
            if prefix_len == 1 {
                buf.push(origin);
            }
            buf.push_str(&content);
        } else {
            truncated = true;
        }
        true
    })
    .map_err(|err| format!("render diff: {err}"))?;
    if truncated {
        buf.push_str("\n…(diff truncated for review)\n");
    }
    Ok(buf)
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

    /// P0-3 OID-bound merge: `perform_merge_bound` merges only when the live tips
    /// still equal the reviewed OIDs; a moved tip yields `StaleTips` and never
    /// merges an unreviewed commit.
    #[test]
    fn perform_merge_bound_merges_on_match_and_stales_on_drift() {
        let (_dir, repo) = init_repo();
        let base = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        checkout_branch(&repo, "feature");
        let feat = commit(&repo, &[("b.txt", "B")], "B", &[base]);
        checkout_branch(&repo, "main");
        let rp = path_of(&repo);

        // Wrong expected target OID -> StaleTips (no merge), even though the live
        // tips would otherwise fast-forward cleanly.
        let stale =
            perform_merge_bound(&rp, "feature", "main", &feat.to_string(), &feat.to_string())
                .unwrap();
        assert_eq!(stale, BoundMergeResult::StaleTips);
        // main is untouched (still at base).
        assert_eq!(resolve_branchish(&repo, "main").unwrap(), base);

        // Correct expected OIDs (source=feat, target=base) -> the bound merge runs.
        let merged =
            perform_merge_bound(&rp, "feature", "main", &feat.to_string(), &base.to_string())
                .unwrap();
        assert!(
            matches!(merged, BoundMergeResult::Merged(_)),
            "got {merged:?}"
        );
        assert_eq!(resolve_branchish(&repo, "main").unwrap(), feat);
    }

    #[test]
    fn diff_three_dot_shows_only_the_branchs_own_work() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        // Target moves on independently after the fork...
        commit(&repo, &[("main_only.txt", "M")], "main work", &[a]);
        // ...and the feature branch adds its own file.
        checkout_branch(&repo, "feature");
        commit(&repo, &[("feature.txt", "hello from worker")], "feat", &[a]);

        let diff = diff_three_dot(&path_of(&repo), "main", "feature", 10_000).unwrap();
        // Three-dot: the branch's added file shows, the target-only file does not.
        assert!(diff.contains("feature.txt"), "{diff}");
        assert!(diff.contains("+hello from worker"), "{diff}");
        assert!(
            !diff.contains("main_only.txt"),
            "three-dot hides target work: {diff}"
        );
    }

    #[test]
    fn diff_three_dot_truncates_and_validates_branch_names() {
        let (_dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], "A", &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout_branch(&repo, "feature");
        // Many lines so the cap genuinely SKIPS later lines once the body is full.
        let big = "a line of demo text\n".repeat(500);
        commit(&repo, &[("big.txt", big.as_str())], "big", &[a]);
        let diff = diff_three_dot(&path_of(&repo), "main", "feature", 200).unwrap();
        assert!(
            diff.contains("(diff truncated for review)"),
            "capped output: {diff}"
        );
        // Hard cap: the patch body (before the truncation marker) never exceeds max_bytes.
        let body = diff.split("\n…(diff truncated").next().unwrap();
        assert!(
            body.len() <= 200,
            "body hard-capped at max_bytes, got {}",
            body.len()
        );

        // A traversal-style branch name is rejected before opening anything.
        assert!(diff_three_dot(".", "../evil", "feature", 100).is_err());
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
