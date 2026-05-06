use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub file_type: String,
    pub children_count: u32,
}

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    "dist",
    ".turbo",
    ".cache",
    "coverage",
];

pub fn list_directory(dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(dir_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    let entries = std::fs::read_dir(path).map_err(|e| format!("Read error: {}", e))?;

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();

        if is_dir && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let full_path = entry_path.to_string_lossy().to_string().replace('\\', "/");
        let file_type = if is_dir {
            "folder".to_string()
        } else {
            ext_to_type(&name)
        };

        let children_count = if is_dir {
            std::fs::read_dir(&entry_path)
                .map(|rd| rd.count() as u32)
                .unwrap_or(0)
        } else {
            0
        };

        let fe = FileEntry {
            name,
            path: full_path,
            is_dir,
            file_type,
            children_count,
        };
        if is_dir {
            dirs.push(fe);
        } else {
            files.push(fe);
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.append(&mut files);
    Ok(dirs)
}

pub fn ext_to_type(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "ts" | "tsx" => "ts",
        "js" | "jsx" | "mjs" | "cjs" => "js",
        "json" => "json",
        "md" => "md",
        "rs" => "rs",
        "toml" => "toml",
        "css" | "scss" | "less" => "css",
        "html" => "html",
        "yaml" | "yml" => "yaml",
        "svg" => "svg",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico" => "image",
        "lock" => "lock",
        "gitignore" => "git",
        "py" => "py",
        "sh" | "bash" => "shell",
        _ => "file",
    }
    .to_string()
}
