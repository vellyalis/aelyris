//! Watchdog system — autonomous monitoring of agent sessions with auto-response.
//!
//! Watches PTY output for permission prompts and evaluates them against
//! user-defined approve/deny patterns. Can auto-approve, auto-deny,
//! ask the user, or ignore non-permission output.

use regex::Regex;

/// Current status of a watchdog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchdogStatus {
    Active,
    Paused,
    Completed,
}

/// Action determined by watchdog evaluation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchdogAction {
    /// Send "y\n" to PTY automatically.
    AutoApprove,
    /// Send "n\n" to PTY automatically.
    AutoDeny,
    /// Show notification, wait for user input.
    AskUser,
    /// Not a permission request — do nothing.
    Ignore,
}

/// A single watchdog monitoring a PTY session.
pub struct Watchdog {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub target_pty_id: String,
    pub auto_approve: Vec<Regex>,
    pub auto_deny: Vec<Regex>,
    pub status: WatchdogStatus,
    pub action_log: Vec<WatchdogLogEntry>,
}

/// Log entry recording a watchdog action.
pub struct WatchdogLogEntry {
    pub timestamp: std::time::Instant,
    pub matched_pattern: String,
    pub action: String, // "approved", "denied", "asked_user"
}

/// Patterns that indicate a permission prompt in agent output.
const PERMISSION_PATTERNS: &[&str] = &[
    "Allow",
    "allow",
    "permit",
    "Do you want to",
    "y/n",
    "[Y/n]",
    "[y/N]",
];

/// Manages all active watchdogs.
pub struct WatchdogManager {
    pub watchdogs: Vec<Watchdog>,
}

impl WatchdogManager {
    /// Create a new empty manager.
    pub fn new() -> Self {
        Self {
            watchdogs: Vec::new(),
        }
    }

    /// Create a new watchdog monitoring a target PTY.
    ///
    /// Returns the index of the newly created watchdog on success.
    pub fn create(
        &mut self,
        name: String,
        instructions: String,
        target_pty_id: String,
        approve_patterns: Vec<String>,
        deny_patterns: Vec<String>,
    ) -> Result<usize, String> {
        let auto_approve = approve_patterns
            .iter()
            .map(|p| Regex::new(p).map_err(|e| format!("Invalid approve pattern '{}': {}", p, e)))
            .collect::<Result<Vec<_>, _>>()?;

        let auto_deny = deny_patterns
            .iter()
            .map(|p| Regex::new(p).map_err(|e| format!("Invalid deny pattern '{}': {}", p, e)))
            .collect::<Result<Vec<_>, _>>()?;

        let id = format!("wd-{}", self.watchdogs.len());
        let watchdog = Watchdog {
            id,
            name,
            instructions,
            target_pty_id,
            auto_approve,
            auto_deny,
            status: WatchdogStatus::Active,
            action_log: Vec::new(),
        };

        self.watchdogs.push(watchdog);
        Ok(self.watchdogs.len() - 1)
    }

    /// Evaluate PTY output against all watchdogs targeting the given PTY.
    ///
    /// Returns the first matching watchdog index and the action to take,
    /// or `None` if no watchdog matches or the output is not a permission prompt.
    pub fn evaluate(&self, pty_id: &str, output_text: &str) -> Option<(usize, WatchdogAction)> {
        // First check if the output contains a permission prompt at all
        let is_permission_prompt = PERMISSION_PATTERNS
            .iter()
            .any(|pattern| output_text.contains(pattern));

        for (idx, watchdog) in self.watchdogs.iter().enumerate() {
            // Skip watchdogs not targeting this PTY
            if watchdog.target_pty_id != pty_id {
                continue;
            }

            // Skip paused or completed watchdogs
            if watchdog.status != WatchdogStatus::Active {
                continue;
            }

            if !is_permission_prompt {
                // Not a permission prompt — ignore
                return Some((idx, WatchdogAction::Ignore));
            }

            // Check auto-approve patterns
            for pattern in &watchdog.auto_approve {
                if pattern.is_match(output_text) {
                    return Some((idx, WatchdogAction::AutoApprove));
                }
            }

            // Check auto-deny patterns
            for pattern in &watchdog.auto_deny {
                if pattern.is_match(output_text) {
                    return Some((idx, WatchdogAction::AutoDeny));
                }
            }

            // Permission prompt detected but no pattern matched — ask user
            return Some((idx, WatchdogAction::AskUser));
        }

        None
    }

    /// Record an action in the watchdog's log.
    pub fn log_action(&mut self, watchdog_idx: usize, pattern: &str, action: &str) {
        if let Some(watchdog) = self.watchdogs.get_mut(watchdog_idx) {
            watchdog.action_log.push(WatchdogLogEntry {
                timestamp: std::time::Instant::now(),
                matched_pattern: pattern.to_string(),
                action: action.to_string(),
            });
        }
    }

    /// Remove a watchdog by index.
    pub fn remove(&mut self, idx: usize) {
        if idx < self.watchdogs.len() {
            self.watchdogs.remove(idx);
        }
    }

    /// Pause a watchdog.
    pub fn pause(&mut self, idx: usize) {
        if let Some(watchdog) = self.watchdogs.get_mut(idx) {
            watchdog.status = WatchdogStatus::Paused;
        }
    }

    /// Resume a paused watchdog.
    pub fn resume(&mut self, idx: usize) {
        if let Some(watchdog) = self.watchdogs.get_mut(idx) {
            if watchdog.status == WatchdogStatus::Paused {
                watchdog.status = WatchdogStatus::Active;
            }
        }
    }
}

impl Default for WatchdogManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_watchdog_with_approve_pattern() {
        let mut manager = WatchdogManager::new();
        let idx = manager
            .create(
                "test".to_string(),
                "Auto approve cargo".to_string(),
                "pty-1".to_string(),
                vec!["allow.*execute".to_string()],
                vec![],
            )
            .unwrap();
        assert_eq!(idx, 0);
        assert_eq!(manager.watchdogs.len(), 1);
        assert_eq!(manager.watchdogs[0].status, WatchdogStatus::Active);
    }

    #[test]
    fn test_evaluate_auto_approve() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec!["(?i)allow.*execute".to_string()],
                vec![],
            )
            .unwrap();

        let result = manager.evaluate("pty-1", "Allow tool to execute cargo build? [y/n]");
        assert_eq!(result, Some((0, WatchdogAction::AutoApprove)));
    }

    #[test]
    fn test_evaluate_auto_deny() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec![],
                vec!["(?i)delete.*files".to_string()],
            )
            .unwrap();

        let result = manager.evaluate("pty-1", "Allow tool to delete files? [y/n]");
        assert_eq!(result, Some((0, WatchdogAction::AutoDeny)));
    }

    #[test]
    fn test_evaluate_ask_user_on_unmatched_permission() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec!["cargo".to_string()],
                vec!["rm".to_string()],
            )
            .unwrap();

        // Permission prompt but no pattern matches
        let result = manager.evaluate("pty-1", "Do you want to install this package? [Y/n]");
        assert_eq!(result, Some((0, WatchdogAction::AskUser)));
    }

    #[test]
    fn test_evaluate_ignore_non_permission() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec!["cargo".to_string()],
                vec![],
            )
            .unwrap();

        // Normal output with no permission prompt indicators
        let result = manager.evaluate("pty-1", "Compiling aether-terminal v0.1.0");
        assert_eq!(result, Some((0, WatchdogAction::Ignore)));
    }

    #[test]
    fn test_pause_and_resume() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec!["(?i)allow".to_string()],
                vec![],
            )
            .unwrap();

        // Pause
        manager.pause(0);
        assert_eq!(manager.watchdogs[0].status, WatchdogStatus::Paused);

        // Paused watchdog should not match
        let result = manager.evaluate("pty-1", "Allow this? [y/n]");
        assert_eq!(result, None);

        // Resume
        manager.resume(0);
        assert_eq!(manager.watchdogs[0].status, WatchdogStatus::Active);

        // Active again — should match
        let result = manager.evaluate("pty-1", "Allow this? [y/n]");
        assert_eq!(result, Some((0, WatchdogAction::AutoApprove)));
    }

    #[test]
    fn test_log_action() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "test".to_string(),
                "instructions".to_string(),
                "pty-1".to_string(),
                vec![],
                vec![],
            )
            .unwrap();

        manager.log_action(0, "allow.*execute", "approved");
        assert_eq!(manager.watchdogs[0].action_log.len(), 1);
        assert_eq!(manager.watchdogs[0].action_log[0].action, "approved");
        assert_eq!(
            manager.watchdogs[0].action_log[0].matched_pattern,
            "allow.*execute"
        );
    }

    #[test]
    fn test_remove_watchdog() {
        let mut manager = WatchdogManager::new();
        manager
            .create(
                "a".to_string(),
                "".to_string(),
                "pty-1".to_string(),
                vec![],
                vec![],
            )
            .unwrap();
        manager
            .create(
                "b".to_string(),
                "".to_string(),
                "pty-2".to_string(),
                vec![],
                vec![],
            )
            .unwrap();

        assert_eq!(manager.watchdogs.len(), 2);
        manager.remove(0);
        assert_eq!(manager.watchdogs.len(), 1);
        assert_eq!(manager.watchdogs[0].name, "b");
    }

    #[test]
    fn test_invalid_regex_returns_error() {
        let mut manager = WatchdogManager::new();
        let result = manager.create(
            "bad".to_string(),
            "".to_string(),
            "pty-1".to_string(),
            vec!["[invalid".to_string()],
            vec![],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_no_watchdog_for_pty_returns_none() {
        let manager = WatchdogManager::new();
        let result = manager.evaluate("pty-1", "Allow this? [y/n]");
        assert_eq!(result, None);
    }
}
