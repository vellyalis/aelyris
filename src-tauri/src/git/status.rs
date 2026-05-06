use git2::{BranchType, Diff, DiffFormat, DiffOptions, Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    #[serde(default)]
    pub additions: u32,
    #[serde(default)]
    pub deletions: u32,
    #[serde(default)]
    pub binary: bool,
}

pub fn git_status(repo_path: &str) -> Result<GitStatusInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

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
    opts.include_untracked(true).recurse_untracked_dirs(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Status error: {}", e))?;
    let diff_stats = build_diff_stats(&repo).unwrap_or_default();

    let mut changed_files = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let path_key = normalize_path(&path).to_lowercase();
        let diff_stat = diff_stats.get(&path_key).copied().unwrap_or_default();
        let s = entry.status();
        let conflicted = s.is_conflicted();
        let staged = s.is_index_new()
            || s.is_index_modified()
            || s.is_index_deleted()
            || s.is_index_renamed();
        let status_str = if conflicted {
            "conflicted"
        } else if s.is_index_new() || s.is_wt_new() {
            if s.is_wt_new() && !staged {
                "untracked"
            } else {
                "added"
            }
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
            additions: diff_stat.additions,
            deletions: diff_stat.deletions,
            binary: diff_stat.binary,
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

#[derive(Debug, Clone, Copy, Default)]
struct FileDiffStat {
    additions: u32,
    deletions: u32,
    binary: bool,
}

fn build_diff_stats(repo: &Repository) -> Result<HashMap<String, FileDiffStat>, String> {
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let mut stats = HashMap::new();

    let mut index_opts = diff_options();
    let index_diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut index_opts))
        .map_err(|e| format!("Index diff error: {}", e))?;
    collect_diff_stats(&index_diff, &mut stats)?;

    let mut workdir_opts = diff_options();
    let workdir_diff = repo
        .diff_index_to_workdir(None, Some(&mut workdir_opts))
        .map_err(|e| format!("Workdir diff error: {}", e))?;
    collect_diff_stats(&workdir_diff, &mut stats)?;

    Ok(stats)
}

fn diff_options() -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(false)
        .show_untracked_content(true)
        .show_binary(true);
    opts
}

fn collect_diff_stats(
    diff: &Diff<'_>,
    stats: &mut HashMap<String, FileDiffStat>,
) -> Result<(), String> {
    for delta in diff.deltas() {
        if let Some(path) = delta_path(&delta) {
            let entry = stats.entry(path).or_default();
            entry.binary =
                entry.binary || delta.old_file().is_binary() || delta.new_file().is_binary();
        }
    }

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        let Some(path) = delta_path(&delta) else {
            return true;
        };
        let entry = stats.entry(path).or_default();
        match line.origin() {
            '+' | '>' => entry.additions = entry.additions.saturating_add(line.num_lines().max(1)),
            '-' | '<' => entry.deletions = entry.deletions.saturating_add(line.num_lines().max(1)),
            'B' => entry.binary = true,
            _ => {}
        }
        true
    })
    .map_err(|e| format!("Diff print error: {}", e))
}

fn delta_path(delta: &git2::DiffDelta<'_>) -> Option<String> {
    delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|path| normalize_path(&path.to_string_lossy()).to_lowercase())
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_string()
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
