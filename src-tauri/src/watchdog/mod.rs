pub mod auto_repair;
pub mod engine;
mod monitor;
pub mod pane_watcher;
mod rules;

pub use auto_repair::{ErrorContext, RepairJobInfo, RepairNotification, RepairPhase};
pub use monitor::SessionMonitor;
pub use rules::{AutoApproveRule, AutoRepairConfig, WatchdogRules};

use std::path::PathBuf;

fn watchdog_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".aether").join("watchdog.json")
}

pub fn load_watchdog_rules() -> WatchdogRules {
    let path = watchdog_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        WatchdogRules::default()
    }
}

pub fn save_watchdog_rules(rules: &WatchdogRules) -> Result<(), String> {
    let path = watchdog_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir error: {}", e))?;
    }
    let json = serde_json::to_string_pretty(rules).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("write: {}", e))
}

pub fn create_watchdog(name: &str, instructions: &str) -> Result<(), String> {
    let mut rules = load_watchdog_rules();
    rules.enabled = true;
    rules.auto_approve.push(AutoApproveRule {
        pattern: name.to_string(),
        approve: true,
        description: instructions.to_string(),
    });
    save_watchdog_rules(&rules)
}
