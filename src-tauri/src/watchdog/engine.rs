#[cfg(test)]
use super::rules::AutoApproveRule;
use super::rules::WatchdogRules;

/// Decision made by the watchdog engine for a tool invocation
#[derive(Debug, Clone, PartialEq)]
pub enum WatchdogDecision {
    /// Auto-approve: matched an approve rule
    AutoApprove { rule: String },
    /// Auto-deny: matched a deny rule
    AutoDeny { rule: String },
    /// No rule matched, ask the user
    AskUser,
}

/// Evaluates tool invocations against watchdog rules
pub struct WatchdogEngine {
    rules: WatchdogRules,
}

impl WatchdogEngine {
    pub fn new(rules: WatchdogRules) -> Self {
        Self { rules }
    }

    /// Evaluate a tool invocation against the configured rules.
    ///
    /// If watchdog is disabled, always returns AskUser.
    /// Rules are checked in order; first match wins.
    pub fn evaluate(&self, tool_name: &str) -> WatchdogDecision {
        if !self.rules.enabled {
            return WatchdogDecision::AskUser;
        }

        for rule in &self.rules.auto_approve {
            if matches_pattern(&rule.pattern, tool_name) {
                if rule.approve {
                    return WatchdogDecision::AutoApprove {
                        rule: rule.pattern.clone(),
                    };
                } else {
                    return WatchdogDecision::AutoDeny {
                        rule: rule.pattern.clone(),
                    };
                }
            }
        }

        WatchdogDecision::AskUser
    }

    /// Update the rules at runtime
    pub fn set_rules(&mut self, rules: WatchdogRules) {
        self.rules = rules;
    }
}

/// Simple glob-style pattern matching.
///
/// Supports:
/// - `*` matches any sequence of characters
/// - Exact match for everything else
/// - Case-insensitive comparison
fn matches_pattern(pattern: &str, input: &str) -> bool {
    let pattern_lower = pattern.to_lowercase();
    let input_lower = input.to_lowercase();

    if !pattern_lower.contains('*') {
        // Exact match (case-insensitive)
        return pattern_lower == input_lower;
    }

    // Split on `*` and match segments in order
    let segments: Vec<&str> = pattern_lower.split('*').collect();

    // Edge case: pattern is just "*"
    if segments.iter().all(|s| s.is_empty()) {
        return true;
    }

    let mut pos = 0;
    for (i, seg) in segments.iter().enumerate() {
        if seg.is_empty() {
            continue;
        }

        match input_lower[pos..].find(seg) {
            Some(found) => {
                // First segment must match at the start (if pattern doesn't start with *)
                if i == 0 && found != 0 {
                    return false;
                }
                pos += found + seg.len();
            }
            None => return false,
        }
    }

    // If pattern doesn't end with *, the last segment must match at the end
    if let Some(last) = segments.last() {
        if !last.is_empty() && !input_lower.ends_with(last) {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rules(enabled: bool, rules: Vec<(&str, bool)>) -> WatchdogRules {
        WatchdogRules {
            enabled,
            auto_approve: rules
                .into_iter()
                .map(|(pattern, approve)| AutoApproveRule {
                    pattern: pattern.to_string(),
                    approve,
                    description: String::new(),
                })
                .collect(),
            auto_repair: Default::default(),
        }
    }

    #[test]
    fn test_approve_exact() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("Read", true)]));
        assert_eq!(
            engine.evaluate("Read"),
            WatchdogDecision::AutoApprove {
                rule: "Read".into()
            }
        );
    }

    #[test]
    fn test_deny_rule() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("Bash(rm*)", false)]));
        assert_eq!(
            engine.evaluate("Bash(rm -rf /)"),
            WatchdogDecision::AutoDeny {
                rule: "Bash(rm*)".into()
            }
        );
    }

    #[test]
    fn test_ask_user_no_match() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("Read", true)]));
        assert_eq!(engine.evaluate("Write"), WatchdogDecision::AskUser);
    }

    #[test]
    fn test_glob_pattern() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("Bash(git status*)", true)]));
        assert_eq!(
            engine.evaluate("Bash(git status --short)"),
            WatchdogDecision::AutoApprove {
                rule: "Bash(git status*)".into()
            }
        );
    }

    #[test]
    fn test_disabled_always_ask() {
        let engine = WatchdogEngine::new(make_rules(false, vec![("Read", true)]));
        assert_eq!(engine.evaluate("Read"), WatchdogDecision::AskUser);
    }

    #[test]
    fn test_case_insensitive() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("read", true)]));
        assert_eq!(
            engine.evaluate("Read"),
            WatchdogDecision::AutoApprove {
                rule: "read".into()
            }
        );
    }

    #[test]
    fn test_first_match_wins() {
        let engine = WatchdogEngine::new(make_rules(
            true,
            vec![("Bash*", false), ("Bash(git*)", true)],
        ));
        // First rule matches, so deny
        assert_eq!(
            engine.evaluate("Bash(git status)"),
            WatchdogDecision::AutoDeny {
                rule: "Bash*".into()
            }
        );
    }

    #[test]
    fn test_wildcard_only() {
        let engine = WatchdogEngine::new(make_rules(true, vec![("*", true)]));
        assert_eq!(
            engine.evaluate("anything"),
            WatchdogDecision::AutoApprove { rule: "*".into() }
        );
    }
}
