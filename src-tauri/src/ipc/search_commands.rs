//! File search command handlers: filename search and content grep.
//!
//! Pure recursive filesystem traversal with hardcoded ignore lists
//! (.git, node_modules, target, ...). No Tauri state. Extracted verbatim
//! from `commands.rs` during the IPC god-file split.

/// Search files by name in a directory tree
#[tauri::command]
pub fn search_files(
    root_path: String,
    query: String,
    max_results: u32,
) -> Result<Vec<crate::git::FileEntry>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    search_recursive(
        std::path::Path::new(&root_path),
        &query_lower,
        max_results,
        &mut results,
    );
    Ok(results)
}

fn search_recursive(
    dir: &std::path::Path,
    query: &str,
    max: u32,
    results: &mut Vec<crate::git::FileEntry>,
) {
    if results.len() >= max as usize {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= max as usize {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let is_dir = path.is_dir();
        if is_dir
            && [
                ".git",
                "node_modules",
                "target",
                "__pycache__",
                ".venv",
                "dist",
                ".next",
                ".turbo",
            ]
            .contains(&name.as_str())
        {
            continue;
        }
        if name.to_lowercase().contains(query) {
            let full = path.to_string_lossy().to_string().replace('\\', "/");
            let file_type = if is_dir {
                "folder".to_string()
            } else {
                crate::git::ext_to_type(&name)
            };
            results.push(crate::git::FileEntry {
                name: name.clone(),
                path: full,
                is_dir,
                file_type,
                children_count: 0,
            });
        }
        if is_dir {
            search_recursive(&path, query, max, results);
        }
    }
}

/// Search file contents (grep-like)
#[tauri::command]
pub fn grep_files(
    root_path: String,
    pattern: String,
    max_results: u32,
) -> Result<Vec<GrepResult>, String> {
    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    grep_recursive(
        std::path::Path::new(&root_path),
        &pattern_lower,
        max_results,
        &mut results,
    );
    Ok(results)
}

#[derive(serde::Serialize)]
pub struct GrepResult {
    pub file: String,
    pub line: u32,
    pub content: String,
}

fn grep_recursive(dir: &std::path::Path, pattern: &str, max: u32, results: &mut Vec<GrepResult>) {
    if results.len() >= max as usize {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= max as usize {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            if [
                ".git",
                "node_modules",
                "target",
                "__pycache__",
                ".venv",
                "dist",
                ".next",
                ".turbo",
                "coverage",
            ]
            .contains(&name.as_str())
            {
                continue;
            }
            grep_recursive(&path, pattern, max, results);
        } else {
            // Skip binary/large files
            let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
            if [
                "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "otf", "eot", "lock",
                "db",
            ]
            .contains(&ext.as_str())
            {
                continue;
            }
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 1024 * 1024 {
                    continue;
                } // Skip >1MB
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if results.len() >= max as usize {
                        break;
                    }
                    if line.to_lowercase().contains(pattern) {
                        results.push(GrepResult {
                            file: path.to_string_lossy().to_string().replace('\\', "/"),
                            line: (i + 1) as u32,
                            content: line.chars().take(200).collect(),
                        });
                    }
                }
            }
        }
    }
}
