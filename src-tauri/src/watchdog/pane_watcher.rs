use serde::{Deserialize, Serialize};

/// Rule for watching a pane's output and triggering actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneWatchRule {
    /// Name or terminal ID of the pane to watch
    pub source_pane: String,
    /// Regex pattern to match against output lines
    pub trigger_pattern: String,
    /// Action to take when triggered
    pub action: WatchAction,
    /// Whether this rule is active
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WatchAction {
    /// Emit an event to Agent Inspector for manual review
    Notify,
    /// Capture context and start an AI agent to investigate
    AgentInvestigate {
        prompt_template: String,
    },
    /// Send a command to another pane
    SendKeys {
        target_pane: String,
        keys: String,
    },
}

/// Result of evaluating output against watch rules
#[derive(Debug, Clone, Serialize)]
pub struct WatchTrigger {
    pub rule_index: usize,
    pub source_pane: String,
    pub matched_line: String,
    pub action: WatchAction,
}

/// Evaluate a set of output lines against watch rules.
/// Returns all triggers that fired.
pub fn evaluate_output(rules: &[PaneWatchRule], source_pane: &str, lines: &[String]) -> Vec<WatchTrigger> {
    let mut triggers = Vec::new();

    for (i, rule) in rules.iter().enumerate() {
        if !rule.enabled {
            continue;
        }

        // Match by pane name/ID
        if rule.source_pane != source_pane && rule.source_pane != "*" {
            continue;
        }

        // Simple pattern matching (substring or basic regex-like)
        for line in lines {
            if matches_trigger(&rule.trigger_pattern, line) {
                triggers.push(WatchTrigger {
                    rule_index: i,
                    source_pane: source_pane.to_string(),
                    matched_line: line.clone(),
                    action: rule.action.clone(),
                });
                break; // One trigger per rule per evaluation cycle
            }
        }
    }

    triggers
}

/// Match a trigger pattern against a line.
/// Supports: pipe-separated alternatives (Error|Exception|FATAL)
pub(crate) fn matches_trigger(pattern: &str, line: &str) -> bool {
    let line_lower = line.to_lowercase();

    // Pipe-separated alternatives
    if pattern.contains('|') {
        return pattern
            .split('|')
            .any(|alt| line_lower.contains(&alt.trim().to_lowercase()));
    }

    // Simple substring match (case-insensitive)
    line_lower.contains(&pattern.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rule(source: &str, pattern: &str, action: WatchAction) -> PaneWatchRule {
        PaneWatchRule {
            source_pane: source.to_string(),
            trigger_pattern: pattern.to_string(),
            action,
            enabled: true,
        }
    }

    #[test]
    fn test_notify_on_error() {
        let rules = vec![make_rule("server", "Error|Exception", WatchAction::Notify)];
        let lines = vec![
            "Starting server...".to_string(),
            "Error: Cannot find module './config'".to_string(),
        ];

        let triggers = evaluate_output(&rules, "server", &lines);
        assert_eq!(triggers.len(), 1);
        assert!(triggers[0].matched_line.contains("Error"));
    }

    #[test]
    fn test_wildcard_source() {
        let rules = vec![make_rule("*", "FATAL", WatchAction::Notify)];
        let lines = vec!["FATAL: out of memory".to_string()];

        let triggers = evaluate_output(&rules, "any-pane", &lines);
        assert_eq!(triggers.len(), 1);
    }

    #[test]
    fn test_no_match() {
        let rules = vec![make_rule("server", "Error", WatchAction::Notify)];
        let lines = vec!["Everything is fine".to_string()];

        let triggers = evaluate_output(&rules, "server", &lines);
        assert!(triggers.is_empty());
    }

    #[test]
    fn test_disabled_rule() {
        let mut rule = make_rule("server", "Error", WatchAction::Notify);
        rule.enabled = false;
        let lines = vec!["Error: something".to_string()];

        let triggers = evaluate_output(&[rule], "server", &lines);
        assert!(triggers.is_empty());
    }

    #[test]
    fn test_wrong_source_pane() {
        let rules = vec![make_rule("server", "Error", WatchAction::Notify)];
        let lines = vec!["Error: something".to_string()];

        let triggers = evaluate_output(&rules, "database", &lines);
        assert!(triggers.is_empty());
    }

    #[test]
    fn test_send_keys_action() {
        let rules = vec![make_rule(
            "build",
            "BUILD FAILED",
            WatchAction::SendKeys {
                target_pane: "editor".to_string(),
                keys: "npm run fix\r\n".to_string(),
            },
        )];
        let lines = vec!["BUILD FAILED with 3 errors".to_string()];

        let triggers = evaluate_output(&rules, "build", &lines);
        assert_eq!(triggers.len(), 1);
        match &triggers[0].action {
            WatchAction::SendKeys { target_pane, keys } => {
                assert_eq!(target_pane, "editor");
                assert!(keys.contains("npm run fix"));
            }
            _ => panic!("Wrong action type"),
        }
    }

    #[test]
    fn test_agent_investigate_action() {
        let rules = vec![make_rule(
            "server",
            "Error|Exception|FATAL",
            WatchAction::AgentInvestigate {
                prompt_template: "Investigate this error: {matched_line}".to_string(),
            },
        )];
        let lines = vec!["Exception: NullPointerException at line 42".to_string()];

        let triggers = evaluate_output(&rules, "server", &lines);
        assert_eq!(triggers.len(), 1);
        match &triggers[0].action {
            WatchAction::AgentInvestigate { prompt_template } => {
                assert!(prompt_template.contains("{matched_line}"));
            }
            _ => panic!("Wrong action type"),
        }
    }

    #[test]
    fn test_case_insensitive() {
        let rules = vec![make_rule("server", "error", WatchAction::Notify)];
        let lines = vec!["ERROR: something went wrong".to_string()];

        let triggers = evaluate_output(&rules, "server", &lines);
        assert_eq!(triggers.len(), 1);
    }
}
