//! Application config and watchdog rule command handlers.
//!
//! Thin wrappers over `crate::config` and `crate::watchdog` persistence.
//! Extracted verbatim from `commands.rs` during the IPC god-file split.

/// Load app config
#[tauri::command]
pub fn load_app_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

/// Save app config
#[tauri::command]
pub fn save_app_config(config: crate::config::AppConfig) -> Result<(), String> {
    crate::config::save_config(&config)
}

/// Get watchdog rules
#[tauri::command]
pub fn get_watchdog_rules() -> crate::watchdog::WatchdogRules {
    crate::watchdog::load_watchdog_rules()
}

/// Save watchdog rules
#[tauri::command]
pub fn save_watchdog_rules(rules: crate::watchdog::WatchdogRules) -> Result<(), String> {
    crate::watchdog::save_watchdog_rules(&rules)
}

/// Create a named watchdog
#[tauri::command]
pub fn create_watchdog(name: String, instructions: String) -> Result<(), String> {
    crate::watchdog::create_watchdog(&name, &instructions)
}
