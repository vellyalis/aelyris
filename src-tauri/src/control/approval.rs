use crate::watchdog::engine::{WatchdogDecision, WatchdogEngine};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalGateDecision {
    AutoApprove { rule: String },
    AutoDeny { rule: String },
    PendingUser,
}

pub fn evaluate(engine: &WatchdogEngine, tool_name: &str) -> ApprovalGateDecision {
    match engine.evaluate(tool_name) {
        WatchdogDecision::AutoApprove { rule } => ApprovalGateDecision::AutoApprove { rule },
        WatchdogDecision::AutoDeny { rule } => ApprovalGateDecision::AutoDeny { rule },
        WatchdogDecision::AskUser => ApprovalGateDecision::PendingUser,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watchdog::WatchdogRules;

    #[test]
    fn asks_user_when_policy_does_not_grant() {
        let engine = WatchdogEngine::new(WatchdogRules {
            enabled: false,
            ..Default::default()
        });
        assert_eq!(
            evaluate(&engine, "Write"),
            ApprovalGateDecision::PendingUser
        );
    }
}
