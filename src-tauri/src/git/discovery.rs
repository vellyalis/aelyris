use git2::Repository;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub has_changes: bool,
}

/// Scan directories for Git repositories (max 2 levels deep)
pub fn discover_projects(scan_dirs: &[String]) -> Vec<ProjectInfo> {
    let mut projects = Vec::new();
    for dir in scan_dirs {
        let path = Path::new(dir);
        if path.is_dir() {
            scan_dir(path, 0, 2, &mut projects);
        }
    }
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    projects
}

fn scan_dir(dir: &Path, depth: usize, max_depth: usize, results: &mut Vec<ProjectInfo>) {
    if depth > max_depth {
        return;
    }

    // Check if this directory is a git repo
    if let Ok(repo) = Repository::open(dir) {
        if let Some(info) = extract_project_info(&repo, dir) {
            results.push(info);
            return; // Don't recurse into git repos
        }
    }

    // Recurse into subdirectories
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // Skip hidden dirs and common non-project dirs
            if name_str.starts_with('.')
                || name_str == "node_modules"
                || name_str == "target"
                || name_str == "__pycache__"
                || name_str == "venv"
                || name_str == ".venv"
            {
                continue;
            }
            scan_dir(&path, depth + 1, max_depth, results);
        }
    }
}

fn extract_project_info(repo: &Repository, dir: &Path) -> Option<ProjectInfo> {
    let name = dir.file_name()?.to_string_lossy().to_string();
    let path = dir.to_string_lossy().to_string().replace('\\', "/");

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .unwrap_or_else(|| "HEAD".to_string());

    let has_changes = repo.statuses(None).map(|s| !s.is_empty()).unwrap_or(false);

    Some(ProjectInfo {
        name,
        path,
        branch,
        has_changes,
    })
}
