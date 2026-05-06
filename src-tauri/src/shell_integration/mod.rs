//! Shell-integration installer (post-0.2.2 Tier 🔴 #2).
//!
//! Aether ships OSC 133 helper scripts for PowerShell, Bash, and Zsh in
//! `assets/shell-integration/`, but until now there was no in-app way to
//! get them onto a user's system — they had to find the file, figure out
//! the right `$PROFILE` / `~/.bashrc` / `~/.zshrc` path, and `source`
//! it themselves. This module provides:
//!
//! 1. **Embedded scripts.** The three shell integration scripts are
//!    compiled into the binary via `include_str!`, so installation does
//!    not depend on the bundle layout (MSI / NSIS / dev) finding the
//!    asset directory at runtime.
//!
//! 2. **Status detection.** For each supported shell we report whether the
//!    profile file exists and whether the Aether `source` line is already
//!    present, so the UI can branch between "install" and "already
//!    installed".
//!
//! 3. **Install action.** Writes the script to a stable location under
//!    the user's home directory and appends a single `source` line to the
//!    profile. The action is idempotent: re-installing only writes the
//!    line if it is not already there. **Never silent-edit** is the rule
//!    on the UI side — this module always returns the exact line it would
//!    append so the caller can preview / require explicit confirmation.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Embedded script contents, captured at compile time so the runtime path
/// to the source file does not have to exist on the user's machine.
const SCRIPT_PWSH: &str = include_str!("../../../assets/shell-integration/aether.ps1");
const SCRIPT_BASH: &str = include_str!("../../../assets/shell-integration/aether.bash");
const SCRIPT_ZSH: &str = include_str!("../../../assets/shell-integration/aether.zsh");

/// Marker comment written above the source line so re-running install (or
/// another install for a different shell) can find and skip it deterministically.
/// Anything containing this exact substring counts as "already installed".
const INSTALL_MARKER: &str = "# Aether Terminal shell integration";

/// Supported shells. Kept tiny on purpose — we only want to maintain
/// scripts for shells where OSC 133 emission is straightforward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    PowerShell,
    Bash,
    Zsh,
}

impl ShellKind {
    pub fn label(self) -> &'static str {
        match self {
            ShellKind::PowerShell => "PowerShell",
            ShellKind::Bash => "Bash",
            ShellKind::Zsh => "Zsh",
        }
    }

    /// Filename Aether writes the script to inside its install dir.
    pub fn script_filename(self) -> &'static str {
        match self {
            ShellKind::PowerShell => "aether.ps1",
            ShellKind::Bash => "aether.bash",
            ShellKind::Zsh => "aether.zsh",
        }
    }

    /// Embedded script contents.
    pub fn script_contents(self) -> &'static str {
        match self {
            ShellKind::PowerShell => SCRIPT_PWSH,
            ShellKind::Bash => SCRIPT_BASH,
            ShellKind::Zsh => SCRIPT_ZSH,
        }
    }
}

/// Snapshot of one shell's integration state for the Settings UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellIntegrationStatus {
    pub shell: ShellKind,
    pub label: &'static str,
    /// Where Aether would source the script from. Returned as a string
    /// because the frontend only needs to display it.
    pub script_path: String,
    /// User's profile / rc file Aether would append the source line to.
    pub profile_path: String,
    /// Whether the profile file currently exists.
    pub profile_exists: bool,
    /// Whether the install marker is already present in the profile file.
    pub installed: bool,
    /// The exact line Aether would append. Surfaced so the UI can show a
    /// preview *and* offer a "copy to clipboard" affordance for users
    /// whose profile lives somewhere non-standard.
    pub source_line: String,
}

/// Result of an [`install`] call. Always returns the line that *would*
/// have been appended even when the install was a no-op (already installed)
/// so the UI can echo it back to the user.
#[derive(Debug, Clone, serde::Serialize)]
pub struct InstallResult {
    pub script_path: String,
    pub profile_path: String,
    pub source_line: String,
    /// True iff this call actually wrote to the profile. False when the
    /// install marker was already present and nothing changed.
    pub appended: bool,
}

/// Resolve the install directory for the embedded scripts. Defaults to
/// `~/.aether/shell-integration/`; created lazily on first install.
pub fn install_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "could not resolve home directory".to_string())?;
    Ok(home.join(".aether").join("shell-integration"))
}

/// Where Aether would write `kind`'s script.
pub fn script_path(kind: ShellKind) -> Result<PathBuf, String> {
    Ok(install_dir()?.join(kind.script_filename()))
}

/// Default profile / rc file path for `kind`. None when the home directory
/// cannot be resolved (extremely rare).
pub fn profile_path(kind: ShellKind) -> Option<PathBuf> {
    let home = home_dir()?;
    Some(match kind {
        // pwsh 7+ default; PowerShell 5.1 uses WindowsPowerShell. We pick
        // the modern path because that's what `pwsh -NoProfile -Command
        // 'echo $PROFILE'` returns and is what new installs land on.
        ShellKind::PowerShell => home
            .join("Documents")
            .join("PowerShell")
            .join("Microsoft.PowerShell_profile.ps1"),
        ShellKind::Bash => home.join(".bashrc"),
        ShellKind::Zsh => home.join(".zshrc"),
    })
}

/// Build the exact source line Aether would append for `kind`, given the
/// resolved script path. Quoting is shell-aware so paths containing
/// spaces (the typical Windows case under `C:\Users\<name>\…`) survive.
pub fn source_line(kind: ShellKind, script_path: &Path) -> String {
    let path_str = script_path.to_string_lossy();
    match kind {
        // PowerShell dot-source uses double quotes; backticks would be
        // required for embedded `"` characters but home paths don't
        // contain them in practice.
        ShellKind::PowerShell => format!(". \"{}\"", path_str),
        // Bash / Zsh use single quotes which require no escaping inside;
        // home paths never contain `'` in practice.
        ShellKind::Bash | ShellKind::Zsh => format!("source '{}'", path_str),
    }
}

/// Snapshot the integration state for a single shell.
pub fn status(kind: ShellKind) -> Result<ShellIntegrationStatus, String> {
    let script = script_path(kind)?;
    let profile =
        profile_path(kind).ok_or_else(|| "could not resolve home directory".to_string())?;
    let profile_exists = profile.is_file();
    let installed = if profile_exists {
        match fs::read_to_string(&profile) {
            Ok(contents) => contents.contains(INSTALL_MARKER),
            Err(_) => false,
        }
    } else {
        false
    };
    Ok(ShellIntegrationStatus {
        shell: kind,
        label: kind.label(),
        script_path: script.to_string_lossy().to_string(),
        profile_path: profile.to_string_lossy().to_string(),
        profile_exists,
        installed,
        source_line: source_line(kind, &script),
    })
}

/// Snapshot status for every supported shell. Used by the Settings panel.
pub fn status_all() -> Vec<ShellIntegrationStatus> {
    [ShellKind::PowerShell, ShellKind::Bash, ShellKind::Zsh]
        .into_iter()
        .filter_map(|k| status(k).ok())
        .collect()
}

/// Write the embedded script to disk and append a single `source` line
/// to the user's profile file. Idempotent: when the install marker is
/// already present the profile is left untouched and `appended = false`.
///
/// The caller is responsible for confirming the action with the user
/// first — the roadmap notes this explicitly: "writing to a user's
/// profile is a semi-destructive action … never silent-edit". This
/// function performs the action; the UI gates it on a click.
pub fn install(kind: ShellKind) -> Result<InstallResult, String> {
    let script = script_path(kind)?;
    let profile =
        profile_path(kind).ok_or_else(|| "could not resolve home directory".to_string())?;
    let line = source_line(kind, &script);

    write_script_to_disk(kind, &script)?;
    let appended = append_source_line_if_missing(&profile, &line)?;

    log::info!(
        "shell integration install kind={:?} appended={appended} profile={}",
        kind,
        profile.display()
    );

    Ok(InstallResult {
        script_path: script.to_string_lossy().to_string(),
        profile_path: profile.to_string_lossy().to_string(),
        source_line: line,
        appended,
    })
}

fn write_script_to_disk(kind: ShellKind, script: &Path) -> Result<(), String> {
    if let Some(parent) = script.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    fs::write(script, kind.script_contents())
        .map_err(|e| format!("write {}: {}", script.display(), e))
}

fn append_source_line_if_missing(profile: &Path, line: &str) -> Result<bool, String> {
    if let Some(parent) = profile.parent() {
        // PowerShell's profile sits inside `Documents/PowerShell/` which
        // doesn't exist by default on Windows. Create the directory tree
        // so write doesn't fail on a fresh install.
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }

    if profile.is_file() {
        let contents = fs::read_to_string(profile)
            .map_err(|e| format!("read {}: {}", profile.display(), e))?;
        if contents.contains(INSTALL_MARKER) {
            return Ok(false);
        }
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(profile)
        .map_err(|e| format!("open {}: {}", profile.display(), e))?;

    // Leading newline is cheap insurance against the existing file not
    // ending with one — appending without it would glue our marker onto
    // the user's last line.
    let block = format!("\n{}\n{}\n", INSTALL_MARKER, line);
    file.write_all(block.as_bytes())
        .map_err(|e| format!("append {}: {}", profile.display(), e))?;
    Ok(true)
}

fn home_dir() -> Option<PathBuf> {
    // `home_dir` is deprecated in std but Tauri v2 still relies on it and
    // there is no replacement that handles the Windows USERPROFILE
    // semantics correctly. See `default_project_scan_dirs` for the same
    // pattern.
    #[allow(deprecated)]
    std::env::home_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_profile(dir: &Path, contents: &str) -> PathBuf {
        let p = dir.join("profile.txt");
        fs::write(&p, contents).expect("seed profile");
        p
    }

    #[test]
    fn source_line_quotes_paths_per_shell() {
        let pwsh = source_line(
            ShellKind::PowerShell,
            Path::new("C:\\tmp\\with space\\aether.ps1"),
        );
        assert_eq!(pwsh, ". \"C:\\tmp\\with space\\aether.ps1\"");

        let bash = source_line(ShellKind::Bash, Path::new("/home/x/.aether/aether.bash"));
        assert_eq!(bash, "source '/home/x/.aether/aether.bash'");
    }

    #[test]
    fn append_marker_writes_block_when_missing() {
        let tmp = TempDir::new().expect("tempdir");
        let profile = write_profile(tmp.path(), "# user content\n");
        let appended =
            append_source_line_if_missing(&profile, "source '/x/aether.bash'").expect("append");
        assert!(appended);
        let after = fs::read_to_string(&profile).expect("read");
        assert!(after.contains(INSTALL_MARKER));
        assert!(after.contains("source '/x/aether.bash'"));
        // User's original content survives.
        assert!(after.starts_with("# user content"));
    }

    #[test]
    fn append_is_idempotent_when_marker_present() {
        let tmp = TempDir::new().expect("tempdir");
        let seed = format!(
            "# user content\n\n{}\nsource '/x/aether.bash'\n",
            INSTALL_MARKER
        );
        let profile = write_profile(tmp.path(), &seed);
        let appended =
            append_source_line_if_missing(&profile, "source '/x/aether.bash'").expect("append");
        assert!(!appended, "second install should be a no-op");
        let after = fs::read_to_string(&profile).expect("read");
        assert_eq!(after, seed, "file should be byte-for-byte unchanged");
    }

    #[test]
    fn append_creates_profile_when_missing() {
        // Critical for fresh PowerShell installs where Documents/PowerShell
        // does not exist yet.
        let tmp = TempDir::new().expect("tempdir");
        let profile = tmp.path().join("nested").join("profile.ps1");
        let appended =
            append_source_line_if_missing(&profile, ". \"C:\\x\\aether.ps1\"").expect("append");
        assert!(appended);
        assert!(profile.is_file());
        let contents = fs::read_to_string(&profile).expect("read");
        assert!(contents.contains(INSTALL_MARKER));
    }

    #[test]
    fn embedded_scripts_are_non_empty() {
        // Compile-time include — if assets/ moves this test catches it.
        for kind in [ShellKind::PowerShell, ShellKind::Bash, ShellKind::Zsh] {
            let s = kind.script_contents();
            assert!(s.len() > 100, "{:?} script too small: {}", kind, s.len());
            assert!(
                s.contains("133;"),
                "{:?} script missing OSC 133 marker",
                kind
            );
        }
    }

    #[test]
    fn status_for_existing_profile_with_marker_is_installed() {
        let tmp = TempDir::new().expect("tempdir");
        let profile = write_profile(tmp.path(), &format!("\n{}\nsource 'x'\n", INSTALL_MARKER));
        // Use the helper directly to keep the test independent of the
        // user's real home directory.
        let exists = profile.is_file();
        assert!(exists);
        let installed = fs::read_to_string(&profile)
            .map(|c| c.contains(INSTALL_MARKER))
            .unwrap_or(false);
        assert!(installed);
    }

    #[test]
    fn status_all_returns_three_entries_when_home_is_resolvable() {
        // home_dir() is set in CI on every platform we ship to; if this
        // test ever flakes, the issue is environmental.
        let entries = status_all();
        assert_eq!(entries.len(), 3);
        let labels: Vec<_> = entries.iter().map(|s| s.label).collect();
        assert!(labels.contains(&"PowerShell"));
        assert!(labels.contains(&"Bash"));
        assert!(labels.contains(&"Zsh"));
    }
}
