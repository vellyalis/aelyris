use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static POWERSHELL_PROGRAM: OnceLock<String> = OnceLock::new();
static CMD_PROGRAM: OnceLock<String> = OnceLock::new();
static WSL_PROGRAM: OnceLock<String> = OnceLock::new();
const POWERSHELL_STARTUP_SCRIPT: &str = r#"try { Set-PSReadLineOption -PredictionSource None } catch {}; if ($env:QUORUM_SHELL_INTEGRATION -ne '1') { $env:QUORUM_SHELL_INTEGRATION = '1'; $script:__aether_esc = [char]27; $script:__aether_bel = [char]7; $script:__aether_original_prompt = (Get-Item function:prompt).ScriptBlock; function script:__aether_commandEnd([int]$exit) { "$($script:__aether_esc)]133;D;$exit$($script:__aether_bel)" }; function global:prompt { $success = $?; $lastExit = if ($success) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }; $body = & $script:__aether_original_prompt; "$(script:__aether_commandEnd $lastExit)$($script:__aether_esc)]133;A$($script:__aether_bel)$body$($script:__aether_esc)]133;B$($script:__aether_bel)" } }"#;

/// Supported shell types on Windows
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ShellType {
    PowerShell,
    Cmd,
    GitBash,
    Wsl,
}

impl ShellType {
    /// Returns the executable path for each shell
    pub fn program(&self) -> &str {
        match self {
            ShellType::PowerShell => {
                // Prefer pwsh.exe (PowerShell 7+) over powershell.exe (5.1)
                POWERSHELL_PROGRAM
                    .get_or_init(resolve_powershell_program)
                    .as_str()
            }
            ShellType::Cmd => CMD_PROGRAM.get_or_init(|| system32_exe("cmd.exe")).as_str(),
            ShellType::GitBash => detect_gitbash_path(),
            ShellType::Wsl => WSL_PROGRAM.get_or_init(|| system32_exe("wsl.exe")).as_str(),
        }
    }

    /// Returns extra arguments for the shell
    pub fn args(&self) -> Vec<&str> {
        match self {
            // PSReadLine's inline prediction (enabled by default in PowerShell 7.2+)
            // leaves dim-italic ghost characters on the screen when predictions span
            // multiple rows or the terminal resizes — terminal emulators/ConPTY reproduce exactly
            // what PSReadLine writes, and the feature is not commonly used, so we
            // disable it at startup. Wrapped in try/catch to survive older hosts
            // that lack the -PredictionSource option.
            ShellType::PowerShell => vec![
                "-NoLogo",
                "-NoProfile",
                "-NoExit",
                "-Command",
                POWERSHELL_STARTUP_SCRIPT,
            ],
            _ => vec![],
        }
    }

    /// Detects available shells on the system
    pub fn detect_available() -> Vec<ShellType> {
        let mut shells = Vec::new();

        // PowerShell (7+ or 5.1)
        if which("pwsh.exe") || which("powershell.exe") {
            shells.push(ShellType::PowerShell);
        }

        // CMD is always available on Windows
        shells.push(ShellType::Cmd);

        // Git Bash — try dynamic detection first
        if detect_gitbash_path() != "bash.exe" {
            shells.push(ShellType::GitBash);
        }

        // WSL
        if which("wsl.exe") {
            shells.push(ShellType::Wsl);
        }

        shells
    }

    /// Returns whether this is PowerShell 7+ (pwsh) vs 5.1 (powershell)
    pub fn is_pwsh7(&self) -> bool {
        matches!(self, ShellType::PowerShell)
            && std::path::Path::new(self.program())
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("pwsh.exe"))
    }

    /// List available WSL distributions
    pub fn list_wsl_distros() -> Vec<String> {
        crate::process::hidden_command("wsl.exe")
            .args(["--list", "--quiet"])
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    // wsl --list outputs UTF-16LE on Windows
                    let raw = output.stdout;
                    let decoded = decode_utf16le(&raw);
                    Some(
                        decoded
                            .lines()
                            .map(|l| l.trim().to_string())
                            .filter(|l| !l.is_empty())
                            .collect(),
                    )
                } else {
                    None
                }
            })
            .unwrap_or_default()
    }
}

fn resolve_powershell_program() -> String {
    let candidates = [
        std::env::var("ProgramFiles")
            .ok()
            .map(|root| format!("{root}\\PowerShell\\7\\pwsh.exe")),
        std::env::var("ProgramFiles")
            .ok()
            .map(|root| format!("{root}\\PowerShell\\7-preview\\pwsh.exe")),
        Some(system32_exe("WindowsPowerShell\\v1.0\\powershell.exe")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| std::path::Path::new(path).exists())
        .unwrap_or_else(|| {
            if which("pwsh.exe") {
                "pwsh.exe".to_string()
            } else {
                "powershell.exe".to_string()
            }
        })
}

fn system32_exe(name: &str) -> String {
    if let Ok(root) = std::env::var("SystemRoot") {
        let path = format!("{root}\\System32\\{name}");
        if std::path::Path::new(&path).exists() {
            return path;
        }
    }
    name.to_string()
}

/// Detect Git Bash path dynamically.
/// Tries: `where git` -> parent -> `bin/bash.exe`, then common install paths.
fn detect_gitbash_path() -> &'static str {
    // Check common paths (most reliable on Windows)
    static COMMON_PATHS: &[&str] = &[
        "C:/Program Files/Git/bin/bash.exe",
        "C:/Program Files (x86)/Git/bin/bash.exe",
    ];

    for path in COMMON_PATHS {
        if std::path::Path::new(path).exists() {
            return path;
        }
    }

    // Fallback: bare name (will fail at spawn time if not in PATH)
    "bash.exe"
}

fn which(cmd: &str) -> bool {
    crate::process::hidden_command("where")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Decode UTF-16LE bytes (wsl --list output on Windows)
fn decode_utf16le(bytes: &[u8]) -> String {
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    String::from_utf16_lossy(&u16s)
}

#[cfg(test)]
mod tests {
    use super::ShellType;

    #[test]
    fn powershell_startup_args_skip_profile_and_keep_prediction_guard() {
        let args = ShellType::PowerShell.args();

        assert!(args.contains(&"-NoLogo"));
        assert!(args.contains(&"-NoProfile"));
        assert!(args.contains(&"-NoExit"));
        assert!(args.contains(&"-Command"));
        assert!(args
            .iter()
            .any(|arg| arg.contains("Set-PSReadLineOption -PredictionSource None")));
        assert!(args
            .iter()
            .any(|arg| arg.contains("QUORUM_SHELL_INTEGRATION")));
        assert!(args.iter().any(|arg| arg.contains("133;A")));
        assert!(args.iter().any(|arg| arg.contains("133;D")));
    }
}
