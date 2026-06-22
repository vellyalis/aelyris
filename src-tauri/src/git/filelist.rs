use git2::Repository;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct FileListEntry {
    pub relative_path: String,
    pub size: u64,
}

/// List all tracked files in a git repo (respects .gitignore).
/// Falls back to directory walk if not a git repo.
pub fn list_all_files(root_path: &str, max_files: usize) -> Result<Vec<FileListEntry>, String> {
    // Try git-aware listing first
    if let Ok(entries) = list_git_tracked(root_path, max_files) {
        if !entries.is_empty() {
            return Ok(entries);
        }
    }

    // Fallback: walk directory, skip common ignores
    list_dir_walk(root_path, max_files)
}

fn list_git_tracked(root_path: &str, max_files: usize) -> Result<Vec<FileListEntry>, String> {
    let repo = Repository::open(root_path).map_err(|e| format!("Not a git repo: {}", e))?;
    let workdir = repo.workdir().ok_or("Bare repository")?;

    let index = repo.index().map_err(|e| format!("Index error: {}", e))?;
    let mut entries = Vec::with_capacity(index.len().min(max_files));

    for entry in index.iter() {
        if entries.len() >= max_files {
            break;
        }
        let path_str = String::from_utf8_lossy(&entry.path).replace('\\', "/");
        let full_path = workdir.join(&path_str);
        let size = std::fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);
        entries.push(FileListEntry {
            relative_path: path_str,
            size,
        });
    }

    Ok(entries)
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    "coverage",
];

fn list_dir_walk(root_path: &str, max_files: usize) -> Result<Vec<FileListEntry>, String> {
    let root = Path::new(root_path);
    let mut entries = Vec::new();
    walk_dir_recursive(root, root, max_files, &mut entries);
    Ok(entries)
}

fn walk_dir_recursive(base: &Path, dir: &Path, max_files: usize, entries: &mut Vec<FileListEntry>) {
    if entries.len() >= max_files {
        return;
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if entries.len() >= max_files {
            return;
        }

        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Skip hidden and ignored directories
        if path.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
                continue;
            }
            walk_dir_recursive(base, &path, max_files, entries);
        } else {
            let relative = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string()
                .replace('\\', "/");
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            entries.push(FileListEntry {
                relative_path: relative,
                size,
            });
        }
    }
}
