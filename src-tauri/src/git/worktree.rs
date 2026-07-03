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
    let main_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().ok().map(String::from))
        .unwrap_or_else(|| "HEAD".to_string());
    let main_sha = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string())
        .unwrap_or_default();
    let main_path = repo
        .workdir()
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

    for name in worktrees.iter().filter_map(|name| name.ok().flatten()) {
        if let Ok(wt) = repo.find_worktree(name) {
            let wt_path = wt.path().to_string_lossy().to_string().replace('\\', "/");
            let (branch, head_sha, status) = match Repository::open(wt.path()) {
                Ok(wt_repo) => {
                    let b = wt_repo
                        .head()
                        .ok()
                        .and_then(|h| h.shorthand().ok().map(String::from))
                        .unwrap_or_else(|| "detached".to_string());
                    let sha = wt_repo
                        .head()
                        .ok()
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
pub fn remove_worktree(
    repo_path: &str,
    worktree_name: &str,
    delete_branch: bool,
) -> Result<(), String> {
    validate_branch_name(worktree_name)?;
    // Use git CLI for reliable worktree removal (handles locked worktrees)
    let output = crate::process::hidden_command("git")
        .args(["worktree", "remove", worktree_name, "--force"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git worktree remove failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worktree removal failed: {}", stderr));
    }

    // Prune stale worktree references
    let _ = crate::process::hidden_command("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output();

    if delete_branch {
        let branch_output = crate::process::hidden_command("git")
            .args(["branch", "-D", worktree_name])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Git branch delete failed: {}", e))?;
        if !branch_output.status.success() {
            let still_exists = crate::process::hidden_command("git")
                .args([
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{}", worktree_name),
                ])
                .current_dir(repo_path)
                .status()
                .map(|s| s.success())
                .unwrap_or(true);
            if still_exists {
                let stderr = String::from_utf8_lossy(&branch_output.stderr);
                return Err(format!("Branch deletion failed: {}", stderr));
            }
        }
    }

    Ok(())
}

/// Remove the worktree that `create_worktree(repo_path, branch)` placed, by its
/// PREDICTED PATH. `git worktree remove` resolves a path, NOT a branch name
/// (`git worktree remove <branch>` fails with "not a working tree"), so callers
/// that only know the branch must route through here rather than `remove_worktree`.
/// When `delete_branch`, the now-merged branch is deleted too. Prunes stale refs.
pub fn remove_worktree_for_branch(
    repo_path: &str,
    branch: &str,
    delete_branch: bool,
) -> Result<(), String> {
    validate_branch_name(branch)?;
    let path = predict_worktree_path(repo_path, branch)
        .to_string_lossy()
        .replace('\\', "/");
    let output = crate::process::hidden_command("git")
        .args(["worktree", "remove", &path, "--force"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git worktree remove failed: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Worktree removal failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let _ = crate::process::hidden_command("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output();
    if delete_branch {
        let _ = crate::process::hidden_command("git")
            .args(["branch", "-D", branch])
            .current_dir(repo_path)
            .output();
    }
    Ok(())
}

/// Validate branch name: ASCII alphanumeric, hyphens, underscores, slashes, dots only.
/// Rejects path traversal, absolute-ish paths, unsafe prefixes, and overlong names.
pub fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 200 {
        return Err("Branch name must be 1-200 characters".to_string());
    }
    if name.contains("..")
        || name.contains("/.")
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.starts_with('-')
        || name.starts_with('.')
        || name.contains(':')
    {
        // `/.` blocks a path-component dot-prefix (feat/.git, feat/.env) that would
        // otherwise resolve a worktree path into a `.git`/dotfile dir, matching
        // git's own check-ref-format rule.
        return Err(format!("Invalid branch name: {}", name));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.')
    {
        return Err(format!("Branch name contains invalid characters: {}", name));
    }
    Ok(())
}

/// Predict where `create_worktree(repo_path, branch_name)` will place the
/// worktree — used by ghostdiff to register a layer before the worktree
/// exists on disk, so the fs watcher can start as soon as it does.
pub fn predict_worktree_path(repo_path: &str, branch_name: &str) -> std::path::PathBuf {
    let repo = std::path::Path::new(repo_path);
    let parent = repo.parent().unwrap_or(repo);
    let name = repo.file_name().unwrap_or_default().to_string_lossy();
    parent.join(format!("{}-{}", name, branch_name))
}

/// Stage every change in the worktree on `branch` and commit it on that branch's
/// tip. Returns `Ok(Some(oid))` for a new commit, `Ok(None)` when there was
/// nothing to commit (an empty diff — NOT an error). Idempotent: a second call
/// after a clean commit finds no change and returns `Ok(None)`.
///
/// The autonomy loop calls this to make a green-reviewed worker's work durable
/// BEFORE it is merged: committing to the worktree's checked-out `branch` advances
/// `refs/heads/<branch>`, which is exactly the ref `perform_merge` resolves as the
/// merge source (without this the source tip never moves and the merge is empty).
/// The identity reuses the repo config, else a deterministic `Aelyris
/// <aelyris@local>` fallback, matching the merge commit.
pub fn commit_worktree(
    repo_path: &str,
    branch: &str,
    message: &str,
) -> Result<Option<String>, String> {
    validate_branch_name(branch)?;
    let worktree_dir = predict_worktree_path(repo_path, branch);
    let repo = Repository::open(&worktree_dir)
        .map_err(|e| format!("Open worktree {}: {}", worktree_dir.display(), e))?;

    // Stage everything: add_all (DEFAULT honors .gitignore) covers new + modified
    // files; update_all covers deletions/renames of tracked files. The `None`
    // callback is a path-match FILTER, not an error channel — a genuine read/stage
    // failure (e.g. a file still locked by a not-yet-dead agent on Windows) is
    // returned as an Err here and propagated, failing the merge so the loop
    // requeues for rework; a file is never silently dropped from the commit.
    let mut index = repo.index().map_err(|e| format!("Worktree index: {}", e))?;
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Stage all: {}", e))?;
    index
        .update_all(["*"], None)
        .map_err(|e| format!("Stage deletions: {}", e))?;
    index.write().map_err(|e| format!("Write index: {}", e))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Find tree: {}", e))?;

    // Empty-diff guard: if the staged tree matches HEAD's tree there is nothing to
    // commit (also covers "already committed on a prior tick / by a legacy script").
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    match &parent {
        Some(parent_commit) if parent_commit.tree_id() == tree_oid => return Ok(None),
        Some(_) => {}
        // Unborn HEAD + empty tree -> nothing to commit.
        None if tree.is_empty() => return Ok(None),
        // Unborn HEAD + staged changes must never happen: create_worktree always
        // starts the worktree on a born branch. Enforce the invariant rather than
        // make a parentless root commit, which perform_merge would see as
        // unrelated history and fail to merge (burning a rework budget).
        None => {
            return Err(format!(
                "commit_worktree: worktree for '{branch}' has an unborn HEAD with staged changes"
            ));
        }
    }

    let signature = repo
        .signature()
        .or_else(|_| git2::Signature::now("Aelyris", "aelyris@local"))
        .map_err(|e| format!("Commit signature: {}", e))?;

    // Commit on HEAD (the worktree's checked-out source branch), parented on its
    // current tip, so refs/heads/<branch> advances to the new commit.
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .map_err(|e| format!("Commit worktree: {}", e))?;
    Ok(Some(oid.to_string()))
}

/// Create the worktree for `branch` if it is not already on disk; a no-op when it
/// is (idempotent — a task re-dispatched after rework reuses its worktree). This
/// is what lets the autonomy loop OWN worktree creation at dispatch instead of
/// relying on the conductor to pre-create them.
pub fn ensure_worktree(repo_path: &str, branch_name: &str) -> Result<(), String> {
    validate_branch_name(branch_name)?;
    if predict_worktree_path(repo_path, branch_name).is_dir() {
        return Ok(());
    }
    create_worktree(repo_path, branch_name).map(|_| ())
}

/// Create a new worktree for a branch
pub fn create_worktree(repo_path: &str, branch_name: &str) -> Result<WorktreeInfo, String> {
    validate_branch_name(branch_name)?;
    let _repo = Repository::open(repo_path).map_err(|e| format!("Open repo: {}", e))?;
    let worktree_dir = predict_worktree_path(repo_path, branch_name);

    let worktree_path = worktree_dir
        .to_string_lossy()
        .to_string()
        .replace('\\', "/");

    // Use git command directly for reliability
    let output = crate::process::hidden_command("git")
        .args([
            "worktree",
            "add",
            &worktree_dir.to_string_lossy(),
            "-b",
            branch_name,
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git command failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try without -b (branch already exists)
        let output2 = crate::process::hidden_command("git")
            .args([
                "worktree",
                "add",
                &worktree_dir.to_string_lossy(),
                branch_name,
            ])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("Git command failed: {}", e))?;
        if !output2.status.success() {
            return Err(format!("Worktree creation failed: {}", stderr));
        }
    }

    // Get the HEAD sha of the new worktree
    let head_sha = match Repository::open(&worktree_dir) {
        Ok(wt_repo) => wt_repo
            .head()
            .ok()
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

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;

    /// A real git repo (temp dir) with one base commit on `main`. Returns the dir
    /// (kept alive by the caller) and the forward-slashed repo path. git runs via
    /// hidden_command so the spawn-hygiene gate stays green (no raw std spawn) and
    /// there is no console flash on Windows.
    fn base_repo() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        let repo_str = repo.to_string_lossy().replace('\\', "/");
        let git = |args: &[&str]| {
            crate::process::hidden_command("git")
                .args(args)
                .current_dir(&repo)
                .output()
                .expect("git available")
        };
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t.t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(repo.join("base.txt"), "base").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "base"]);
        (tmp, repo_str)
    }

    /// Proves the path-based removal actually reclaims a created worktree —
    /// `git worktree remove <branch>` (the old behaviour) fails with "not a
    /// working tree", so this is the regression guard for the disk leak fix. Also
    /// covers delete_branch = true.
    #[test]
    fn remove_worktree_for_branch_actually_removes_it() {
        let (_tmp, repo_str) = base_repo();
        create_worktree(&repo_str, "agent/x").expect("create worktree");
        let wt = predict_worktree_path(&repo_str, "agent/x");
        assert!(wt.exists(), "worktree should exist at {wt:?}");

        remove_worktree_for_branch(&repo_str, "agent/x", true).expect("remove worktree");
        assert!(!wt.exists(), "worktree dir should be gone after removal");
        // The merged branch was deleted too (delete_branch = true).
        let branches = list_branches(&repo_str).unwrap_or_default();
        assert!(
            !branches.iter().any(|b| b.name == "agent/x"),
            "merged branch should be deleted"
        );
    }

    #[test]
    fn commit_worktree_stages_uncommitted_work_and_makes_the_merge_real() {
        let (_tmp, repo_str) = base_repo();
        create_worktree(&repo_str, "agent/y").expect("create worktree");
        let wt = predict_worktree_path(&repo_str, "agent/y");
        let tip_before = Repository::open(&wt)
            .unwrap()
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();

        // The worker writes a file but never commits — the real production gap.
        std::fs::write(wt.join("GREETING.md"), "hello").unwrap();

        let oid = commit_worktree(&repo_str, "agent/y", "aelyris: task-greeting")
            .expect("commit ok")
            .expect("a commit was made");

        // The source branch tip advanced to the new commit in the MAIN repo, so
        // perform_merge will now see real work ahead.
        let main_repo = Repository::open(&repo_str).unwrap();
        assert_ne!(oid, tip_before);
        assert_eq!(
            main_repo
                .refname_to_id("refs/heads/agent/y")
                .unwrap()
                .to_string(),
            oid
        );

        // Without any external script, perform_merge now fast-forwards main and
        // main's tip tree contains the worker's file — the audit gap is closed.
        let outcome = crate::git::perform_merge(&repo_str, "agent/y", "main").expect("merge");
        assert!(
            matches!(outcome, crate::git::MergeOutcome::FastForwarded { .. }),
            "expected fast-forward, got {outcome:?}"
        );
        let main_tip = main_repo.head().unwrap().peel_to_commit().unwrap();
        assert!(
            main_tip
                .tree()
                .unwrap()
                .get_path(std::path::Path::new("GREETING.md"))
                .is_ok(),
            "main's tip now contains the worker's committed file"
        );

        // Idempotency: committing the now-clean worktree again is a no-op.
        assert!(commit_worktree(&repo_str, "agent/y", "aelyris: again")
            .expect("ok")
            .is_none());
    }

    #[test]
    fn ensure_worktree_creates_once_then_is_idempotent() {
        let (_tmp, repo_str) = base_repo();
        let path = predict_worktree_path(&repo_str, "agent/z");
        assert!(!path.is_dir(), "no worktree yet");
        ensure_worktree(&repo_str, "agent/z").expect("first ensure creates");
        assert!(path.is_dir(), "worktree now on disk");
        // Second call is a no-op (does not error on the existing worktree, unlike
        // a raw create_worktree which would fail).
        ensure_worktree(&repo_str, "agent/z").expect("second ensure is a no-op");
        assert!(
            create_worktree(&repo_str, "agent/z").is_err(),
            "raw create would fail"
        );
    }

    #[test]
    fn remove_worktree_for_branch_keeps_branch_when_not_deleting() {
        let (_tmp, repo_str) = base_repo();
        ensure_worktree(&repo_str, "agent/gone").expect("create");
        let path = predict_worktree_path(&repo_str, "agent/gone");
        assert!(path.is_dir());
        remove_worktree_for_branch(&repo_str, "agent/gone", false).expect("remove");
        assert!(!path.is_dir(), "worktree dir removed");
        // The branch ref is kept (delete_branch = false).
        assert!(Repository::open(&repo_str)
            .unwrap()
            .refname_to_id("refs/heads/agent/gone")
            .is_ok());
    }

    #[test]
    fn validates_safe_agent_branch_names() {
        for name in [
            "agent/implementer-add-login-form",
            "task/123",
            "feature/foo_bar.1",
        ] {
            assert!(validate_branch_name(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn rejects_unsafe_branch_names() {
        for name in [
            "",
            "-leading",
            ".leading",
            "/absolute",
            "\\absolute",
            "feature/../main",
            "feature/.git",
            "feature/.env",
            "feature:main",
            "feature/日本語",
            &"a".repeat(201),
        ] {
            assert!(validate_branch_name(name).is_err(), "{name}");
        }
    }
}
