use serde::{Deserialize, Serialize};

/// Rules for auto-responding to AI agent prompts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogRules {
    pub enabled: bool,
    pub auto_approve: Vec<AutoApproveRule>,
    /// Auto-repair configuration (Phase 3A-1). `serde(default)` so existing
    /// `watchdog.json` files without this field keep loading.
    #[serde(default)]
    pub auto_repair: AutoRepairConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoApproveRule {
    /// Pattern to match against the tool/command name
    pub pattern: String,
    /// Whether to auto-approve (true) or auto-deny (false)
    pub approve: bool,
    /// Description for UI display
    pub description: String,
}

/// Auto-repair pipeline configuration.
///
/// When `enabled`, the PTY reader watches each chunk against `pattern` and
/// triggers `AutoRepairManager` (error → worktree → AI fix → tests → notify)
/// on the first matching line within the 60s debounce window.
///
/// `pattern` uses pipe-separated alternatives (`"error:|panicked|FAILED"`),
/// matched case-insensitively — same grammar as `pane_watcher::matches_trigger`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoRepairConfig {
    pub enabled: bool,
    pub pattern: String,
}

impl Default for AutoRepairConfig {
    fn default() -> Self {
        Self {
            enabled: false, // Conservative default — user opts in via UI
            pattern: "error:|exception:|panicked|fatal:|FAILED|compilation failed".to_string(),
        }
    }
}

impl Default for WatchdogRules {
    fn default() -> Self {
        Self {
            enabled: false, // Conservative default
            auto_approve: vec![
                AutoApproveRule {
                    pattern: "Read".to_string(),
                    approve: true,
                    description: "Auto-approve file reads".to_string(),
                },
                AutoApproveRule {
                    pattern: "Glob".to_string(),
                    approve: true,
                    description: "Auto-approve file search".to_string(),
                },
                AutoApproveRule {
                    pattern: "Grep".to_string(),
                    approve: true,
                    description: "Auto-approve content search".to_string(),
                },
                AutoApproveRule {
                    pattern: "Bash(git status*)".to_string(),
                    approve: true,
                    description: "Auto-approve git status".to_string(),
                },
                AutoApproveRule {
                    pattern: "Bash(npm run dev*)".to_string(),
                    approve: true,
                    description: "Auto-approve dev server".to_string(),
                },
            ],
            auto_repair: AutoRepairConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_auto_repair_is_disabled() {
        let cfg = AutoRepairConfig::default();
        assert!(!cfg.enabled);
        assert!(!cfg.pattern.is_empty());
    }

    #[test]
    fn watchdog_rules_deserialize_without_auto_repair_field() {
        // Legacy watchdog.json files do not have the auto_repair field —
        // confirm serde(default) brings it in without error.
        let legacy = r#"{
            "enabled": false,
            "auto_approve": []
        }"#;
        let rules: WatchdogRules = serde_json::from_str(legacy).unwrap();
        assert!(!rules.auto_repair.enabled);
        assert_eq!(
            rules.auto_repair.pattern,
            AutoRepairConfig::default().pattern
        );
    }

    #[test]
    fn watchdog_rules_roundtrip_with_auto_repair() {
        let rules = WatchdogRules {
            enabled: true,
            auto_approve: vec![],
            auto_repair: AutoRepairConfig {
                enabled: true,
                pattern: "panic:".to_string(),
            },
        };
        let json = serde_json::to_string(&rules).unwrap();
        let parsed: WatchdogRules = serde_json::from_str(&json).unwrap();
        assert!(parsed.auto_repair.enabled);
        assert_eq!(parsed.auto_repair.pattern, "panic:");
    }
}
