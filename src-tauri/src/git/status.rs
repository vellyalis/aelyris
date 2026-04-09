use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusInfo {
    pub branch: String,
    pub is_dirty: bool,
    pub changed_files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String, // "modified" | "added" | "deleted" | "renamed" | "untracked"
}

pub fn git_status(repo_path: &str) -> Result<GitStatusInfo, String> {
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "HEAD".to_string());

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
        let status_str = if s.is_index_new() || s.is_wt_new() {
            if s.is_wt_new() { "untracked" } else { "added" }
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
        });
    }

    Ok(GitStatusInfo {
        branch,
        is_dirty: !changed_files.is_empty(),
        changed_files,
    })
}
