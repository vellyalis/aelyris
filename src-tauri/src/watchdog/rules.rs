use serde::{Deserialize, Serialize};

/// Rules for auto-responding to AI agent prompts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogRules {
    pub enabled: bool,
    pub auto_approve: Vec<AutoApproveRule>,
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
        }
    }
}
