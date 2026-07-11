use std::fs::{self, OpenOptions};
#[cfg(not(windows))]
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const DEFAULT_DURABILITY_QUOTA_BYTES: u64 = 512 * 1024 * 1024;
pub const DEFAULT_RECOVERY_FILE_LIMIT: usize = 64;

#[derive(Debug, Clone, Copy)]
pub struct RetentionPolicy {
    pub max_total_bytes: u64,
    pub max_recovery_files: usize,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            max_total_bytes: std::env::var("AELYRIS_DURABILITY_QUOTA_BYTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_DURABILITY_QUOTA_BYTES),
            max_recovery_files: std::env::var("AELYRIS_DURABILITY_RECOVERY_FILES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(DEFAULT_RECOVERY_FILE_LIMIT),
        }
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_with_hook(path, bytes, || Ok(()))
}

fn atomic_write_with_hook<F>(
    path: &Path,
    bytes: &[u8],
    before_replace: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let parent = path
        .parent()
        .ok_or_else(|| format!("durable path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create durable directory {}: {error}", parent.display()))?;
    let roots = durability_roots(path);
    enforce_global_retention(&roots, RetentionPolicy::default())?;

    let stamp = unique_stamp();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("durable path has no UTF-8 file name: {}", path.display()))?;
    let temp = parent.join(format!(".{name}.aelyris-temp-{stamp}"));
    let recovery = parent.join(format!(".{name}.aelyris-recovery-{stamp}"));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("create durable temp {}: {error}", temp.display()))?;
        file.write_all(bytes)
            .map_err(|error| format!("write durable temp {}: {error}", temp.display()))?;
        file.sync_all()
            .map_err(|error| format!("flush durable temp {}: {error}", temp.display()))?;
        drop(file);

        before_replace()?;
        replace_preserving_previous(path, &temp, &recovery)?;
        sync_parent(parent)?;
        enforce_global_retention(&roots, RetentionPolicy::default())
    })();
    if temp.exists() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(windows)]
fn replace_preserving_previous(path: &Path, temp: &Path, recovery: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{ReplaceFileW, REPLACE_FILE_FLAGS};

    if !path.exists() {
        return fs::rename(temp, path)
            .map_err(|error| format!("commit new durable file {}: {error}", path.display()));
    }
    let wide = |value: &Path| {
        value
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>()
    };
    let target = wide(path);
    let replacement = wide(temp);
    let backup = wide(recovery);
    unsafe {
        ReplaceFileW(
            PCWSTR(target.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            PCWSTR(backup.as_ptr()),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| format!("replace durable file {}: {error}", path.display()))
}

#[cfg(not(windows))]
fn replace_preserving_previous(path: &Path, temp: &Path, recovery: &Path) -> Result<(), String> {
    if path.exists() {
        fs::copy(path, recovery).map_err(|error| {
            format!(
                "preserve durable recovery {} from {}: {error}",
                recovery.display(),
                path.display()
            )
        })?;
        File::open(recovery)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("flush durable recovery {}: {error}", recovery.display()))?;
    }
    fs::rename(temp, path)
        .map_err(|error| format!("replace durable file {}: {error}", path.display()))
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> Result<(), String> {
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("flush durable directory {}: {error}", parent.display()))
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> Result<(), String> {
    Ok(())
}

#[derive(Debug)]
struct RetainedFile {
    path: PathBuf,
    bytes: u64,
    modified: std::time::SystemTime,
    recovery: bool,
}

pub fn enforce_global_retention(
    roots: &[PathBuf],
    policy: RetentionPolicy,
) -> Result<(), String> {
    let mut files = Vec::new();
    for root in normalized_roots(roots) {
        collect_files(&root, &mut files)?;
    }
    let mut total = files.iter().map(|file| file.bytes).sum::<u64>();
    let mut recovery = files
        .drain(..)
        .filter(|file| file.recovery)
        .collect::<Vec<_>>();
    recovery.sort_by_key(|file| file.modified);
    while recovery.len() > policy.max_recovery_files || total > policy.max_total_bytes {
        let Some(oldest) = recovery.first() else {
            break;
        };
        fs::remove_file(&oldest.path).map_err(|error| {
            format!(
                "remove expired durability recovery {}: {error}",
                oldest.path.display()
            )
        })?;
        total = total.saturating_sub(oldest.bytes);
        recovery.remove(0);
    }
    if total > policy.max_total_bytes {
        return Err(format!(
            "durability quota exceeded: {total} > {} bytes with no removable recovery files",
            policy.max_total_bytes
        ));
    }
    Ok(())
}

fn normalized_roots(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut unique = Vec::new();
    for root in roots {
        if !unique.iter().any(|existing: &PathBuf| existing == root) {
            unique.push(root.clone());
        }
    }
    unique
}

pub fn durability_roots(path: &Path) -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut roots = path
        .parent()
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    #[cfg(not(test))]
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let global = PathBuf::from(home).join(".aelyris");
        if !roots.iter().any(|root| root == &global) {
            roots.push(global);
        }
    }
    roots
}

fn collect_files(root: &Path, output: &mut Vec<RetainedFile>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)
        .map_err(|error| format!("scan durability root {}: {error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("read durability entry: {error}"))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("read durability metadata {}: {error}", path.display()))?;
        if metadata.is_dir() {
            collect_files(&path, output)?;
        } else if metadata.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            output.push(RetainedFile {
                path,
                bytes: metadata.len(),
                modified: metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                recovery: name.contains(".aelyris-recovery-")
                    || name.contains(".pre-migration-v")
                    || name.contains(".aelyris-temp-"),
            });
        }
    }
    Ok(())
}

fn unique_stamp() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{}-{millis}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_failure_keeps_last_committed_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, b"old").unwrap();
        let result = atomic_write_with_hook(&path, b"new", || {
            Err("injected power loss".to_string())
        });
        assert!(result.unwrap_err().contains("injected power loss"));
        assert_eq!(fs::read(&path).unwrap(), b"old");
    }

    #[test]
    fn replacement_commits_new_bytes_and_preserves_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        let recovery = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.file_name().to_string_lossy().contains("aelyris-recovery"))
            .unwrap();
        assert_eq!(fs::read(recovery.path()).unwrap(), b"old");
    }

    #[test]
    fn quota_removes_recovery_before_rejecting_primary_data() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("primary.json"), vec![1; 8]).unwrap();
        fs::write(
            dir.path().join(".primary.json.aelyris-recovery-1"),
            vec![2; 8],
        )
        .unwrap();
        enforce_global_retention(
            &[dir.path().into()],
            RetentionPolicy {
                max_total_bytes: 8,
                max_recovery_files: 0,
            },
        )
        .unwrap();
        assert!(dir.path().join("primary.json").exists());
        assert!(!dir
            .path()
            .join(".primary.json.aelyris-recovery-1")
            .exists());
    }
}
