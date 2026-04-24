use git2::{BranchType, Repository, StatusOptions};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub is_dirty: bool,
    pub changed_files: Vec<ChangedFile>,
    /// Upstream tracking branch short name (e.g. `origin/main`) — empty when
    /// the local branch is not tracking a remote.
    #[serde(default)]
    pub upstream: String,
    /// Commits the local branch is ahead of `upstream`.
    #[serde(default)]
    pub ahead: u32,
    /// Commits the local branch is behind `upstream`.
    #[serde(default)]
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
    pub staged: bool,
    pub conflicted: bool,
}

pub fn git_status(repo_path: &str) -> Result<GitStatusInfo, String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "HEAD".to_string());

    // Upstream tracking info — best-effort. Detached HEAD, no upstream
    // configured, or a non-existent remote ref all collapse to "no upstream"
    // without erroring the whole call.
    let (upstream, ahead, behind) = resolve_upstream(&repo, &branch);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Status error: {}", e))?;

    let mut changed_files = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        let conflicted = s.is_conflicted();
        let staged = s.is_index_new() || s.is_index_modified() || s.is_index_deleted() || s.is_index_renamed();
        let status_str = if conflicted {
            "conflicted"
        } else if s.is_index_new() || s.is_wt_new() {
            if s.is_wt_new() && !staged { "untracked" } else { "added" }
        } else if s.is_index_deleted() || s.is_wt_deleted() {
            "deleted"
        } else if s.is_index_renamed() || s.is_wt_renamed() {
            "renamed"
        } else {
            "modified"
        };
        changed_files.push(ChangedFile {
            path,
            status: status_str.to_string(),
            staged,
            conflicted,
        });
    }

    Ok(GitStatusInfo {
        branch,
        is_dirty: !changed_files.is_empty(),
        changed_files,
        upstream,
        ahead,
        behind,
    })
}

fn resolve_upstream(repo: &Repository, branch_name: &str) -> (String, u32, u32) {
    let Ok(local) = repo.find_branch(branch_name, BranchType::Local) else {
        return (String::new(), 0, 0);
    };
    let Ok(upstream) = local.upstream() else {
        return (String::new(), 0, 0);
    };
    let upstream_name = upstream
        .name()
        .ok()
        .flatten()
        .map(String::from)
        .unwrap_or_default();

    let local_oid = match local.get().target() {
        Some(oid) => oid,
        None => return (upstream_name, 0, 0),
    };
    let upstream_oid = match upstream.get().target() {
        Some(oid) => oid,
        None => return (upstream_name, 0, 0),
    };
    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0));
    (upstream_name, ahead as u32, behind as u32)
}
