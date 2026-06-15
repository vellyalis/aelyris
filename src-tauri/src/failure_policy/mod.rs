//! Failure Policy — what the autonomous loop does when something fails.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 12. Pure decision logic: map a failure event to a recovery
//! action. The actual restart/notify/escalate side effects are the
//! controller's job (runtime); this module owns only the policy so it is
//! unit-testable and one source of truth.

use serde::{Deserialize, Serialize};

/// Something that went wrong in the fleet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum FailureEvent {
    /// An agent process crashed; `retries` = how many times it has already been
    /// restarted for this task.
    AgentCrashed { retries: u32 },
    /// A task's work failed (tests red, unrecoverable error).
    TaskFailed,
    /// An agent or task exceeded its time budget.
    Timeout,
}

/// The recovery action the controller should take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    /// Restart the crashed agent (still under the retry budget).
    Restart,
    /// Surface to the Reviewer (task failure, or a crash that keeps recurring).
    NotifyReviewer,
    /// Escalate to the Planner for re-plan / re-delegation (timeout).
    EscalateToPlanner,
}

#[derive(Debug, Clone, Copy)]
pub struct FailurePolicy {
    pub max_restarts: u32,
}

impl Default for FailurePolicy {
    fn default() -> Self {
        Self { max_restarts: 3 }
    }
}

impl FailurePolicy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_max_restarts(max_restarts: u32) -> Self {
        Self { max_restarts }
    }

    /// Decide the recovery action for a failure event:
    /// - crash under the retry budget -> `Restart`
    /// - crash with the budget exhausted -> `NotifyReviewer` (repeated failure)
    /// - task failure -> `NotifyReviewer`
    /// - timeout -> `EscalateToPlanner`
    pub fn decide(&self, event: FailureEvent) -> RecoveryAction {
        match event {
            FailureEvent::AgentCrashed { retries } if retries < self.max_restarts => {
                RecoveryAction::Restart
            }
            FailureEvent::AgentCrashed { .. } => RecoveryAction::NotifyReviewer,
            FailureEvent::TaskFailed => RecoveryAction::NotifyReviewer,
            FailureEvent::Timeout => RecoveryAction::EscalateToPlanner,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_under_budget_restarts() {
        let policy = FailurePolicy::new(); // max_restarts = 3
        assert_eq!(
            policy.decide(FailureEvent::AgentCrashed { retries: 0 }),
            RecoveryAction::Restart
        );
        assert_eq!(
            policy.decide(FailureEvent::AgentCrashed { retries: 2 }),
            RecoveryAction::Restart
        );
    }

    #[test]
    fn crash_with_budget_exhausted_notifies_reviewer() {
        let policy = FailurePolicy::new();
        assert_eq!(
            policy.decide(FailureEvent::AgentCrashed { retries: 3 }),
            RecoveryAction::NotifyReviewer
        );
        assert_eq!(
            policy.decide(FailureEvent::AgentCrashed { retries: 9 }),
            RecoveryAction::NotifyReviewer
        );
    }

    #[test]
    fn task_failure_notifies_reviewer() {
        assert_eq!(
            FailurePolicy::new().decide(FailureEvent::TaskFailed),
            RecoveryAction::NotifyReviewer
        );
    }

    #[test]
    fn timeout_escalates_to_planner() {
        assert_eq!(
            FailurePolicy::new().decide(FailureEvent::Timeout),
            RecoveryAction::EscalateToPlanner
        );
    }

    #[test]
    fn restart_budget_is_configurable() {
        let strict = FailurePolicy::with_max_restarts(1);
        assert_eq!(
            strict.decide(FailureEvent::AgentCrashed { retries: 0 }),
            RecoveryAction::Restart
        );
        assert_eq!(
            strict.decide(FailureEvent::AgentCrashed { retries: 1 }),
            RecoveryAction::NotifyReviewer
        );
    }

    #[test]
    fn events_round_trip_through_serde() {
        let event = FailureEvent::AgentCrashed { retries: 2 };
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(serde_json::from_str::<FailureEvent>(&json).unwrap(), event);
        assert_eq!(
            serde_json::to_value(RecoveryAction::EscalateToPlanner).unwrap(),
            serde_json::json!("escalate_to_planner")
        );
    }
}
