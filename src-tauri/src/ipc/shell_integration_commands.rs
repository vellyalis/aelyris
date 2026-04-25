//! IPC surface for the shell-integration installer (Tier 🔴 #2).
//!
//! Three commands, one per UI verb:
//!   - `shell_integration_status` → snapshot per-shell so the Settings
//!     panel can render the row state without a follow-up call.
//!   - `shell_integration_one_liner` → just the source line for the
//!     "Copy to clipboard" affordance, in case the user installs by hand.
//!   - `shell_integration_install` → write script + append to profile.
//!     Idempotent on the marker; never silent — the UI must collect the
//!     click before invoking.

use crate::shell_integration::{self, InstallResult, ShellIntegrationStatus, ShellKind};

#[tauri::command]
pub fn shell_integration_status() -> Vec<ShellIntegrationStatus> {
    shell_integration::status_all()
}

#[tauri::command]
pub fn shell_integration_one_liner(shell: ShellKind) -> Result<String, String> {
    let path = shell_integration::script_path(shell)?;
    Ok(shell_integration::source_line(shell, &path))
}

#[tauri::command]
pub fn shell_integration_install(shell: ShellKind) -> Result<InstallResult, String> {
    shell_integration::install(shell)
}
