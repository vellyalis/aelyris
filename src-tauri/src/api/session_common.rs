use std::path::{Component, Path as FsPath, PathBuf};

use crate::pty::ShellType;

use super::ApiError;

pub(super) fn parse_shell(s: &str) -> Result<ShellType, ApiError> {
    match s.to_lowercase().as_str() {
        "pwsh" | "powershell" | "ps" => Ok(ShellType::PowerShell),
        "cmd" => Ok(ShellType::Cmd),
        "gitbash" | "bash" => Ok(ShellType::GitBash),
        "wsl" => Ok(ShellType::Wsl),
        other => Err(ApiError::BadRequest(format!("unknown shell: {}", other))),
    }
}

pub(super) fn validate_api_cwd(path: &str) -> Result<(), ApiError> {
    if path.trim().is_empty() {
        return Ok(());
    }
    if path.contains('\0') {
        return Err(ApiError::BadRequest("cwd contains a NUL byte".into()));
    }
    let slash_path = path.replace('\\', "/");
    let lower_slash_path = slash_path.to_lowercase();
    if lower_slash_path.starts_with("//?/unc/")
        || ((slash_path.starts_with("//") || slash_path.starts_with("\\\\"))
            && !lower_slash_path.starts_with("//?/"))
    {
        return Err(ApiError::BadRequest("UNC cwd paths are not allowed".into()));
    }
    let raw_path = FsPath::new(path);
    if raw_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ApiError::BadRequest(
            "cwd path traversal is not allowed".into(),
        ));
    }
    if is_dangerous_api_cwd(raw_path) {
        return Err(ApiError::BadRequest(
            "cwd cannot point at a system directory".into(),
        ));
    }
    let canonical = std::fs::canonicalize(raw_path)
        .map_err(|_| ApiError::BadRequest("cwd must exist and be accessible".into()))?;
    if !canonical.is_dir() {
        return Err(ApiError::BadRequest("cwd must be a directory".into()));
    }
    if is_dangerous_api_cwd(&canonical) {
        return Err(ApiError::BadRequest(
            "cwd cannot point at a system directory".into(),
        ));
    }
    Ok(())
}

pub(super) fn home_dir_for_cwd() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn expand_api_cwd(path: &str) -> Result<String, ApiError> {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir_for_cwd()
            .map(|home| home.to_string_lossy().to_string())
            .ok_or_else(|| ApiError::BadRequest("cwd home directory is unavailable".into()));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = home_dir_for_cwd()
            .ok_or_else(|| ApiError::BadRequest("cwd home directory is unavailable".into()))?;
        return Ok(home.join(rest).to_string_lossy().to_string());
    }
    Ok(trimmed.to_string())
}

/// Strip Windows extended-length (`\\?\C:\...`) prefixes that `canonicalize()`
/// returns, while preserving UNC paths. Shared with the MCP merge-intent path so
/// a canonicalized `repo_path` is stored in its plain form.
pub(crate) fn strip_local_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest.to_lowercase().starts_with(r"unc\") {
            return path.to_string();
        }
        return rest.to_string();
    }
    if let Some(rest) = path.strip_prefix("//?/") {
        if rest.to_lowercase().starts_with("unc/") {
            return path.to_string();
        }
        return rest.to_string();
    }
    path.to_string()
}

fn api_cwd_policy_text(path: &FsPath) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_string();
    }
    normalized
}

fn is_dangerous_api_cwd(path: &FsPath) -> bool {
    let normalized = api_cwd_policy_text(path);
    let dangerous = [
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "d:/windows",
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
    ];
    dangerous
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}/")))
}

pub(super) fn normalize_api_cwd(cwd: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(cwd) = cwd else {
        return Ok(None);
    };
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let expanded = expand_api_cwd(trimmed)?;
    validate_api_cwd(&expanded)?;
    Ok(Some(strip_local_verbatim_prefix(&expanded)))
}
