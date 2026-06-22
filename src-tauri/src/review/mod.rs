//! Review verdict — the pure merge-eligibility decision.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 9. Under full autonomy the Reviewer agent merges with no human
//! gate, but only with the compensating controls: all quality gates green and
//! reviewer != implementer (separation of duties). This module owns that
//! deterministic decision; the actual git merge is the runtime controller's
//! job, so the policy stays unit-testable with 100% confidence.

pub mod branch;
pub mod gates;
pub mod judge;

pub use branch::{detect_gate_commands, review_branch, BranchReview, ReviewInputs};
pub use gates::{
    run_deterministic_gates, spawn_run, CommandRun, DeterministicGates, GateCommand, GateKind,
};
pub use judge::{judge_semantics, SemanticVerdict};

use serde::{Deserialize, Serialize};

/// The quality gates a task's branch must pass before merge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateResults {
    pub tests_pass: bool,
    pub lint_pass: bool,
    pub types_pass: bool,
    pub design_consistent: bool,
    pub context_aligned: bool,
}

impl GateResults {
    /// The names of the gates that are red (empty when all green).
    pub fn failed_gates(&self) -> Vec<String> {
        let mut failed = Vec::new();
        if !self.tests_pass {
            failed.push("tests".to_string());
        }
        if !self.lint_pass {
            failed.push("lint".to_string());
        }
        if !self.types_pass {
            failed.push("types".to_string());
        }
        if !self.design_consistent {
            failed.push("design".to_string());
        }
        if !self.context_aligned {
            failed.push("context".to_string());
        }
        failed
    }

    pub fn all_green(&self) -> bool {
        self.failed_gates().is_empty()
    }
}

/// The Reviewer's decision for a task's branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "verdict")]
pub enum ReviewVerdict {
    /// All gates green and reviewer != implementer — the Reviewer may merge.
    Merge,
    /// One or more gates are red — send the task back (lists the red gates).
    Reject { failed_gates: Vec<String> },
    /// Reviewer is the implementer — a self-merge would break separation of
    /// duties, so it is refused regardless of gate state.
    SelfReviewBlocked,
}

/// Decide whether the Reviewer may merge `implementer_id`'s branch.
pub fn review(gates: &GateResults, reviewer_id: &str, implementer_id: &str) -> ReviewVerdict {
    if reviewer_id == implementer_id {
        return ReviewVerdict::SelfReviewBlocked;
    }
    let failed_gates = gates.failed_gates();
    if failed_gates.is_empty() {
        ReviewVerdict::Merge
    } else {
        ReviewVerdict::Reject { failed_gates }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GREEN: GateResults = GateResults {
        tests_pass: true,
        lint_pass: true,
        types_pass: true,
        design_consistent: true,
        context_aligned: true,
    };

    #[test]
    fn all_green_and_distinct_reviewer_merges() {
        assert_eq!(
            review(&GREEN, "reviewer", "implementer"),
            ReviewVerdict::Merge
        );
    }

    #[test]
    fn self_review_is_blocked_even_when_green() {
        assert_eq!(
            review(&GREEN, "agent-1", "agent-1"),
            ReviewVerdict::SelfReviewBlocked
        );
    }

    #[test]
    fn a_failed_gate_rejects_with_that_gate() {
        let red = GateResults {
            tests_pass: false,
            ..GREEN
        };
        assert_eq!(
            review(&red, "reviewer", "implementer"),
            ReviewVerdict::Reject {
                failed_gates: vec!["tests".to_string()]
            }
        );
    }

    #[test]
    fn multiple_failures_are_all_listed_in_order() {
        let red = GateResults {
            tests_pass: false,
            lint_pass: true,
            types_pass: false,
            design_consistent: true,
            context_aligned: false,
        };
        assert_eq!(red.failed_gates(), ["tests", "types", "context"]);
        assert!(!red.all_green());
    }

    #[test]
    fn green_reports_no_failed_gates() {
        assert!(GREEN.all_green());
        assert!(GREEN.failed_gates().is_empty());
    }
}
