use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const STARTUP_RECONCILIATION_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupReconciliationPhase {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReconciliationReport {
    pub phase: StartupReconciliationPhase,
    pub database_ready: bool,
    pub sidecar_connected: bool,
    pub adopted_terminals: usize,
    pub restored_sessions: usize,
    pub reconciled_handoffs: usize,
    pub completed_at_ms: Option<u64>,
    pub failure_stage: Option<String>,
    pub failure_reason: Option<String>,
}

impl Default for StartupReconciliationReport {
    fn default() -> Self {
        Self {
            phase: StartupReconciliationPhase::Pending,
            database_ready: false,
            sidecar_connected: false,
            adopted_terminals: 0,
            restored_sessions: 0,
            reconciled_handoffs: 0,
            completed_at_ms: None,
            failure_stage: None,
            failure_reason: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct StartupReconciliationState {
    report: Mutex<StartupReconciliationReport>,
}

impl StartupReconciliationState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> Result<StartupReconciliationReport, String> {
        self.report
            .lock()
            .map(|report| report.clone())
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())
    }

    pub fn mark_database_ready(&self) -> Result<(), String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase == StartupReconciliationPhase::Pending {
            report.database_ready = true;
        }
        Ok(())
    }

    pub fn complete(
        &self,
        adopted_terminals: usize,
        restored_sessions: usize,
        reconciled_handoffs: usize,
    ) -> Result<bool, String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Ok(false);
        }
        if !report.database_ready {
            return Err("startup reconciliation cannot complete before database readiness".into());
        }
        report.phase = StartupReconciliationPhase::Ready;
        report.sidecar_connected = true;
        report.adopted_terminals = adopted_terminals;
        report.restored_sessions = restored_sessions;
        report.reconciled_handoffs = reconciled_handoffs;
        report.completed_at_ms = Some(unix_now_ms());
        Ok(true)
    }

    pub fn fail(&self, stage: &str, reason: impl Into<String>) -> Result<bool, String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Ok(false);
        }
        report.phase = StartupReconciliationPhase::Failed;
        report.completed_at_ms = Some(unix_now_ms());
        report.failure_stage = Some(stage.to_string());
        report.failure_reason = Some(reason.into());
        Ok(true)
    }

    pub fn fail_if_pending(&self) -> Result<bool, String> {
        self.fail(
            "timeout",
            format!(
                "startup reconciliation exceeded {} seconds",
                STARTUP_RECONCILIATION_TIMEOUT_SECS
            ),
        )
    }

    pub fn require_spawn_admitted(&self) -> Result<(), String> {
        let report = self.snapshot()?;
        match report.phase {
            StartupReconciliationPhase::Ready => Ok(()),
            StartupReconciliationPhase::Pending => Err(serde_json::json!({
                "code": "startup_reconciliation_pending",
                "message": "terminal spawn is blocked until durable startup reconciliation completes",
                "report": report,
            })
            .to_string()),
            StartupReconciliationPhase::Failed => Err(serde_json::json!({
                "code": "startup_reconciliation_failed",
                "message": "terminal spawn is blocked because durable startup reconciliation failed",
                "report": report,
            })
            .to_string()),
        }
    }
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_is_blocked_until_database_and_reconciliation_are_ready() {
        let state = StartupReconciliationState::new();
        assert!(state
            .require_spawn_admitted()
            .unwrap_err()
            .contains("startup_reconciliation_pending"));
        assert!(state.complete(0, 0, 0).is_err());
        state.mark_database_ready().unwrap();
        assert!(state.complete(2, 1, 1).unwrap());
        state.require_spawn_admitted().unwrap();
        let report = state.snapshot().unwrap();
        assert_eq!(report.phase, StartupReconciliationPhase::Ready);
        assert_eq!(report.adopted_terminals, 2);
    }

    #[test]
    fn failure_is_terminal_and_cannot_be_overwritten_by_late_success() {
        let state = StartupReconciliationState::new();
        state.mark_database_ready().unwrap();
        assert!(state.fail("sidecar", "unavailable").unwrap());
        assert!(!state.complete(1, 1, 1).unwrap());
        let error = state.require_spawn_admitted().unwrap_err();
        assert!(error.contains("startup_reconciliation_failed"));
        assert!(error.contains("sidecar"));
    }

    #[test]
    fn timeout_fails_only_a_pending_state() {
        let state = StartupReconciliationState::new();
        assert!(state.fail_if_pending().unwrap());
        assert!(!state.fail_if_pending().unwrap());
        assert_eq!(
            state.snapshot().unwrap().failure_stage.as_deref(),
            Some("timeout")
        );
    }

    #[test]
    fn production_pty_owner_rejects_spawn_before_reconciliation() {
        let state = std::sync::Arc::new(StartupReconciliationState::new());
        let pty = crate::pty::PtyManager::new().with_startup_reconciliation(state.clone());
        let pending = pty
            .spawn_with_id("blocked-pending", &crate::pty::ShellType::Cmd, 80, 24, None)
            .unwrap_err();
        assert!(pending.contains("startup_reconciliation_pending"));
        state.fail("fixture", "failed").unwrap();
        let failed = pty
            .spawn_with_id("blocked-failed", &crate::pty::ShellType::Cmd, 80, 24, None)
            .unwrap_err();
        assert!(failed.contains("startup_reconciliation_failed"));
        assert!(pty.list().is_empty());
    }
}
