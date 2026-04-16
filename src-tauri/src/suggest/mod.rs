//! Command suggestion engine — fish-style autosuggestion from history.
//!
//! Maintains an in-memory cache of recent commands, populated from the
//! database at startup and updated on each command execution.
//!
//! Usage:
//!   engine.suggest("git st") → Some("atus")  // completion suffix only

use std::collections::VecDeque;

const MAX_HISTORY: usize = 500;

/// Suggestion engine backed by command history.
pub struct SuggestEngine {
    /// Recent commands, newest first. Used for prefix matching.
    history: VecDeque<String>,
}

impl SuggestEngine {
    pub fn new() -> Self {
        Self {
            history: VecDeque::new(),
        }
    }

    /// Seed history from the database (call once at startup).
    pub fn seed(&mut self, commands: Vec<String>) {
        self.history.clear();
        for cmd in commands {
            if !cmd.is_empty() {
                self.history.push_back(cmd);
            }
        }
        self.truncate();
    }

    /// Record a new command (call on Enter).
    pub fn record(&mut self, command: &str) {
        let cmd = command.trim().to_string();
        if cmd.is_empty() {
            return;
        }
        // Remove duplicate if exists (move to front)
        self.history.retain(|c| c != &cmd);
        self.history.push_front(cmd);
        self.truncate();
    }

    /// Find a completion for the given prefix.
    ///
    /// Returns the *suffix* only (the part after the prefix), or `None`
    /// if no match is found. Prefix must be non-empty and at least 2 chars.
    ///
    /// Matching is case-sensitive because shell commands are case-sensitive.
    pub fn suggest(&self, prefix: &str) -> Option<String> {
        if prefix.len() < 2 {
            return None;
        }
        self.history
            .iter()
            .find(|cmd| cmd.starts_with(prefix) && cmd.len() > prefix.len())
            .map(|cmd| cmd[prefix.len()..].to_string())
    }

    fn truncate(&mut self) {
        while self.history.len() > MAX_HISTORY {
            self.history.pop_back();
        }
    }
}

impl Default for SuggestEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suggest_basic_match() {
        let mut engine = SuggestEngine::new();
        engine.record("git status");
        engine.record("git push");

        // "git s" → "tatus" (matches "git status")
        assert_eq!(engine.suggest("git s"), Some("tatus".into()));
    }

    #[test]
    fn test_suggest_returns_most_recent() {
        let mut engine = SuggestEngine::new();
        engine.record("git status --short");
        engine.record("git stash pop");
        engine.record("git status");

        // Most recently recorded matching command wins
        assert_eq!(engine.suggest("git st"), Some("atus".into()));
    }

    #[test]
    fn test_suggest_no_match() {
        let mut engine = SuggestEngine::new();
        engine.record("cargo build");

        assert_eq!(engine.suggest("git"), None);
    }

    #[test]
    fn test_suggest_exact_match_returns_none() {
        let mut engine = SuggestEngine::new();
        engine.record("git status");

        // Exact match → no suffix to suggest
        assert_eq!(engine.suggest("git status"), None);
    }

    #[test]
    fn test_suggest_prefix_too_short() {
        let mut engine = SuggestEngine::new();
        engine.record("git status");

        assert_eq!(engine.suggest("g"), None);
        assert_eq!(engine.suggest(""), None);
    }

    #[test]
    fn test_suggest_case_sensitive() {
        let mut engine = SuggestEngine::new();
        engine.record("Git Status");

        assert_eq!(engine.suggest("git"), None);
        assert_eq!(engine.suggest("Git"), Some(" Status".into()));
    }

    #[test]
    fn test_record_deduplicates() {
        let mut engine = SuggestEngine::new();
        engine.record("git status");
        engine.record("cargo build");
        engine.record("git status"); // duplicate, should move to front

        assert_eq!(engine.history.len(), 2);
        assert_eq!(engine.history[0], "git status");
    }

    #[test]
    fn test_record_trims_whitespace() {
        let mut engine = SuggestEngine::new();
        engine.record("  git status  ");

        assert_eq!(engine.history[0], "git status");
    }

    #[test]
    fn test_record_ignores_empty() {
        let mut engine = SuggestEngine::new();
        engine.record("");
        engine.record("   ");

        assert!(engine.history.is_empty());
    }

    #[test]
    fn test_seed_from_database() {
        let mut engine = SuggestEngine::new();
        engine.seed(vec![
            "git status".into(),
            "cargo build".into(),
            "npm test".into(),
        ]);

        assert_eq!(engine.history.len(), 3);
        // seed order preserved (DB returns newest first)
        assert_eq!(engine.suggest("gi"), Some("t status".into()));
    }

    #[test]
    fn test_max_history_cap() {
        let mut engine = SuggestEngine::new();
        for i in 0..600 {
            engine.record(&format!("cmd-{}", i));
        }
        assert_eq!(engine.history.len(), MAX_HISTORY);
        // Most recent should still be accessible
        assert_eq!(engine.suggest("cmd-59"), Some("9".into()));
    }

    #[test]
    fn test_suggest_multiword_prefix() {
        let mut engine = SuggestEngine::new();
        engine.record("docker compose up -d");
        engine.record("docker compose down");

        assert_eq!(engine.suggest("docker compose d"), Some("own".into()));
    }
}
