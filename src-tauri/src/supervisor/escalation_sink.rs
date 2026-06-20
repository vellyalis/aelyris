//! Escalation Sink — the Supervisor's durable receiver for loop give-ups
//! (Runtime Hardening P4 / Binding Requirement: unattended-safe).
//!
//! When the autonomy loop exhausts a task's retry budget it raises an
//! `Escalation`. Previously that only became an in-memory `EscalationRaised`
//! event on the bounded (cap 256) Event Bus ring: evictable under load and lost
//! on restart — "fire and forget". This sink writes each give-up to the DURABLE
//! audit journal (survives restart, never evicted, queryable by task), so a
//! Failed task is never silently lost — the precise guarantee an unattended run
//! needs. It is invoked from the loop driver itself (`run_step` /
//! `run_step_visible`), so BOTH faces (autonomous MCP + cockpit IPC) persist
//! through one path — no asymmetry. Live operator visibility is unchanged: the
//! loop still publishes `EscalationRaised` to the Event Bus that the cockpit
//! feed renders; this is the durable half.

use crate::db::{AuditJournalAppend, ManagedDb};
use crate::orchestrator::autonomy::{Escalation, StepReport};

/// Audit-journal `kind` for a loop give-up. Matches the Event Bus
/// `escalation_raised` so both surfaces use one vocabulary.
pub const ESCALATION_KIND: &str = "escalation_raised";
/// Source tag for escalations written by the autonomy loop.
pub const ESCALATION_SOURCE: &str = "autonomy-loop";
/// Workspace bucket for autonomy escalations (single-operator default).
pub const ESCALATION_WORKSPACE: &str = "default";

/// Map one give-up into a durable audit-journal append. Pure → unit-testable.
/// `task_id`/`correlation_id` make every give-up traceable to its task; the
/// payload carries the exhausted budget (`reason`) and the failure policy's
/// recommended `action`.
pub fn escalation_audit_event(esc: &Escalation) -> AuditJournalAppend {
    AuditJournalAppend {
        workspace_id: ESCALATION_WORKSPACE.to_string(),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: None,
        workflow_id: None,
        task_id: Some(esc.task_id.clone()),
        correlation_id: Some(esc.task_id.clone()),
        kind: ESCALATION_KIND.to_string(),
        severity: "warning".to_string(),
        source: ESCALATION_SOURCE.to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "taskId": esc.task_id,
            "reason": esc.reason,
            "action": esc.action,
        }),
    }
}

/// Durably record every escalation from a completed step into the audit journal.
/// A write failure is logged loudly (never silently swallowed) and does not
/// abort the rest. Returns how many were persisted. A step with no give-ups — or
/// a manager with no attached db — is a cheap no-op.
pub fn persist_escalations(db: &ManagedDb, report: &StepReport) -> usize {
    let mut persisted = 0;
    for esc in &report.escalations {
        match db.with(|d| d.append_audit_journal_event(&escalation_audit_event(esc))) {
            Ok(_) => persisted += 1,
            Err(e) => {
                tracing::error!(task = %esc.task_id, error = %e, "escalation persist failed")
            }
        }
    }
    persisted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AuditJournalFilter, Database};
    use crate::failure_policy::RecoveryAction;
    use crate::orchestrator::LoopState;

    fn esc(task: &str, reason: &str) -> Escalation {
        Escalation {
            task_id: task.to_string(),
            reason: reason.to_string(),
            action: RecoveryAction::NotifyReviewer,
        }
    }

    fn report_with(escalations: Vec<Escalation>) -> StepReport {
        StepReport {
            dispatched: vec![],
            merged: vec![],
            rejected: vec![],
            recovered: vec![],
            escalations,
            state: LoopState::Active,
        }
    }

    fn count_escalation_rows(db: &ManagedDb) -> usize {
        db.with(|d| {
            d.list_audit_journal_events(&AuditJournalFilter {
                kind: Some(ESCALATION_KIND.to_string()),
                limit: Some(100),
                ..Default::default()
            })
        })
        .unwrap()
        .len()
    }

    #[test]
    fn maps_escalation_to_a_durable_audit_event() {
        let ev = escalation_audit_event(&esc("api", "rework"));
        assert_eq!(ev.kind, ESCALATION_KIND);
        assert_eq!(ev.source, ESCALATION_SOURCE);
        assert_eq!(ev.task_id.as_deref(), Some("api"));
        assert_eq!(ev.correlation_id.as_deref(), Some("api"));
        assert_eq!(ev.payload_json["reason"], "rework");
        assert!(ev.payload_json.is_object());
    }

    #[test]
    fn persists_each_escalation_durably() {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        let report = report_with(vec![esc("api", "rework"), esc("ui", "crash")]);
        assert_eq!(persist_escalations(&db, &report), 2);
        // Both rows are in the audit journal, queryable by kind/task.
        assert_eq!(count_escalation_rows(&db), 2);
    }

    #[test]
    fn empty_report_is_a_noop() {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        assert_eq!(persist_escalations(&db, &report_with(vec![])), 0);
        assert_eq!(count_escalation_rows(&db), 0);
    }
}
