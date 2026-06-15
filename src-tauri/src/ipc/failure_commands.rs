use tauri::State;

use crate::failure_policy::{FailureEvent, FailurePolicy, RecoveryAction};

/// Decide the recovery action for a fleet failure (BR12). Thin pass-through
/// over the tested FailurePolicy::decide so the controller can ask the policy
/// what to do on a crash/task-failure/timeout (restart / notify reviewer /
/// escalate to planner).
#[tauri::command]
pub fn failure_decide(policy: State<'_, FailurePolicy>, event: FailureEvent) -> RecoveryAction {
    policy.decide(event)
}
