use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::db::{AuditJournalAppend, AuditJournalEventRecord, ManagedDb};

pub const AUDIT_EVENT_BUS_EVENT: &str = "audit:event";
pub const AUDIT_EVENT_BUS_INCIDENT: &str = "audit:incident";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditJournalWriteIncident {
    pub kind: String,
    pub severity: String,
    pub source: String,
    pub operation: String,
    pub workspace_id: Option<String>,
    pub correlation_id: Option<String>,
    pub message: String,
}

pub trait AuditEventEmitter {
    fn emit_audit_payload<S: Serialize + Clone>(
        &self,
        event: &str,
        payload: S,
    ) -> Result<(), String>;
}

impl<R: Runtime> AuditEventEmitter for AppHandle<R> {
    fn emit_audit_payload<S: Serialize + Clone>(
        &self,
        event: &str,
        payload: S,
    ) -> Result<(), String> {
        self.emit(event, payload)
            .map_err(|e| format!("Emit audit payload: {}", e))
    }
}

pub fn append_audit_event_and_emit(
    app: &AppHandle<impl Runtime>,
    event: AuditJournalAppend,
) -> Result<AuditJournalEventRecord, String> {
    let db = app.state::<ManagedDb>();
    append_audit_event_with_emitter(&db, app, event)
}

pub fn append_audit_event_with_emitter<E: AuditEventEmitter>(
    db: &ManagedDb,
    emitter: &E,
    event: AuditJournalAppend,
) -> Result<AuditJournalEventRecord, String> {
    let workspace_id = Some(event.workspace_id.clone());
    let correlation_id = event.correlation_id.clone();
    match db.with(|d| d.append_audit_journal_event(&event)) {
        Ok(record) => {
            emitter.emit_audit_payload(AUDIT_EVENT_BUS_EVENT, &record)?;
            Ok(record)
        }
        Err(error) => {
            emit_audit_write_incident(
                emitter,
                "append_audit_event",
                workspace_id,
                correlation_id,
                &error,
            );
            Err(error)
        }
    }
}

pub fn append_audit_events_and_emit(
    app: &AppHandle<impl Runtime>,
    events: Vec<AuditJournalAppend>,
) -> Result<Vec<AuditJournalEventRecord>, String> {
    let db = app.state::<ManagedDb>();
    append_audit_events_with_emitter(&db, app, events)
}

pub fn append_audit_events_with_emitter<E: AuditEventEmitter>(
    db: &ManagedDb,
    emitter: &E,
    events: Vec<AuditJournalAppend>,
) -> Result<Vec<AuditJournalEventRecord>, String> {
    let first_context = events.first().map(|event| {
        (
            Some(event.workspace_id.clone()),
            event.correlation_id.clone(),
        )
    });
    match db.with(|d| d.append_audit_journal_events(&events)) {
        Ok(records) => {
            for record in &records {
                emitter.emit_audit_payload(AUDIT_EVENT_BUS_EVENT, record)?;
            }
            Ok(records)
        }
        Err(error) => {
            let (workspace_id, correlation_id) = first_context.unwrap_or((None, None));
            emit_audit_write_incident(
                emitter,
                "append_audit_events",
                workspace_id,
                correlation_id,
                &error,
            );
            Err(error)
        }
    }
}

fn emit_audit_write_incident<E: AuditEventEmitter>(
    emitter: &E,
    operation: &str,
    workspace_id: Option<String>,
    correlation_id: Option<String>,
    message: &str,
) {
    let incident = AuditJournalWriteIncident {
        kind: "audit_journal_write_failed".to_string(),
        severity: "error".to_string(),
        source: "audit-event-bus".to_string(),
        operation: operation.to_string(),
        workspace_id,
        correlation_id,
        message: message.to_string(),
    };
    let _ = emitter.emit_audit_payload(AUDIT_EVENT_BUS_INCIDENT, incident);
}
