use serde::{Deserialize, Serialize};

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
                if which("pwsh.exe") {
                    "pwsh.exe"
                } else {
                    "powershell.exe"
                }
            }
            ShellType::Cmd => "cmd.exe",
            ShellType::GitBash => detect_gitbash_path(),
            ShellType::Wsl => "wsl.exe",
        }
    }

    /// Returns extra arguments for the shell
    pub fn args(&self) -> Vec<&str> {
        match self {
            // PSReadLine's inline prediction (enabled by default in PowerShell 7.2+)
            // leaves dim-italic ghost characters on the screen when predictions span
            // multiple rows or the terminal resizes — xterm/ConPTY reproduces exactly
            // what PSReadLine writes, and the feature is not commonly used, so we
            // disable it at startup. Wrapped in try/catch to survive older hosts
            // that lack the -PredictionSource option.
            ShellType::PowerShell => vec![
                "-NoLogo",
                "-NoExit",
                "-Command",
                "try { Set-PSReadLineOption -PredictionSource None } catch {}",
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
        matches!(self, ShellType::PowerShell) && which("pwsh.exe")
    }

    /// List available WSL distributions
    pub fn list_wsl_distros() -> Vec<String> {
        std::process::Command::new("wsl.exe")
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
    std::process::Command::new("where")
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
