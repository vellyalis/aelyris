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
            ShellType::PowerShell => "pwsh.exe",
            ShellType::Cmd => "cmd.exe",
            ShellType::GitBash => "C:/Program Files/Git/bin/bash.exe",
            ShellType::Wsl => "wsl.exe",
        }
    }

    /// Returns extra arguments for the shell
    pub fn args(&self) -> Vec<&str> {
        match self {
            ShellType::PowerShell => vec!["-NoLogo"],
            ShellType::Wsl => vec!["-d", "Ubuntu"],
            _ => vec![],
        }
    }

    /// Detects available shells on the system
    pub fn detect_available() -> Vec<ShellType> {
        let mut shells = Vec::new();

        // PowerShell 7 (pwsh) or 5.1 (powershell)
        if which("pwsh.exe") || which("powershell.exe") {
            shells.push(ShellType::PowerShell);
        }

        // CMD is always available
        shells.push(ShellType::Cmd);

        // Git Bash
        if std::path::Path::new("C:/Program Files/Git/bin/bash.exe").exists() {
            shells.push(ShellType::GitBash);
        }

        // WSL
        if which("wsl.exe") {
            shells.push(ShellType::Wsl);
        }

        shells
    }
}

fn which(cmd: &str) -> bool {
    std::process::Command::new("where")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
