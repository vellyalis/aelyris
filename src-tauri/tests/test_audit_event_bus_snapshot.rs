use aelyris_lib::audit::{
    append_audit_event_with_emitter, AuditEventEmitter, AUDIT_EVENT_BUS_EVENT,
    AUDIT_EVENT_BUS_INCIDENT,
};
use aelyris_lib::db::{
    AuditJournalAppend, AuditJournalEventRecord, AuditJournalFilter, Database, ManagedDb,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Duration;

const WORKSPACE: &str = "p0-12-workspace";

#[derive(Default)]
struct RecordingEmitter {
    events: Mutex<Vec<(String, Value)>>,
}

impl AuditEventEmitter for RecordingEmitter {
    fn emit_audit_payload<S: Serialize + Clone>(
        &self,
        event: &str,
        payload: S,
    ) -> Result<(), String> {
        let payload = serde_json::to_value(payload).map_err(|e| e.to_string())?;
        self.events
            .lock()
            .map_err(|_| "recording emitter lock poisoned".to_string())?
            .push((event.to_string(), payload));
        Ok(())
    }
}

impl RecordingEmitter {
    fn audit_events(&self) -> Vec<AuditJournalEventRecord> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .filter(|(event, _)| event == AUDIT_EVENT_BUS_EVENT)
            .map(|(_, payload)| {
                serde_json::from_value(payload.clone()).expect("audit event payload")
            })
            .collect()
    }

    fn incidents(&self) -> Vec<Value> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .filter(|(event, _)| event == AUDIT_EVENT_BUS_INCIDENT)
            .map(|(_, payload)| payload.clone())
            .collect()
    }
}

fn append_from_ipc_shape(
    db: &ManagedDb,
    emitter: &RecordingEmitter,
    body: Value,
) -> Result<AuditJournalEventRecord, String> {
    let event = serde_json::from_value::<AuditJournalAppend>(
        body.get("event")
            .cloned()
            .ok_or_else(|| "missing event IPC argument".to_string())?,
    )
    .map_err(|e| format!("decode IPC audit event argument: {}", e))?;
    append_audit_event_with_emitter(db, emitter, event)
}

fn append_body(
    kind: &str,
    severity: &str,
    source: &str,
    correlation_id: &str,
    payload: Value,
) -> Value {
    json!({
        "event": {
            "workspaceId": WORKSPACE,
            "threadId": "thread-p0-12",
            "sessionId": "session-p0-12",
            "paneId": "pane-p0-12",
            "terminalId": "terminal-p0-12",
            "agentId": "agent-p0-12",
            "taskId": "P0-12",
            "correlationId": correlation_id,
            "kind": kind,
            "severity": severity,
            "source": source,
            "confidence": 1.0,
            "payloadJson": payload,
        }
    })
}

fn assert_bus_and_db_match(
    bus_events: &[AuditJournalEventRecord],
    db_events: &[AuditJournalEventRecord],
) -> Result<(), String> {
    let bus_keys = event_keys(bus_events);
    let db_keys = event_keys(db_events);
    if let Some(missing) = bus_keys.difference(&db_keys).next() {
        return Err(format!(
            "event bus emitted event missing from DB: {missing:?}"
        ));
    }
    if let Some(missing) = db_keys.difference(&bus_keys).next() {
        return Err(format!("DB event missing from event bus: {missing:?}"));
    }
    Ok(())
}

fn event_keys(events: &[AuditJournalEventRecord]) -> BTreeSet<(i64, String, String)> {
    events
        .iter()
        .map(|event| {
            (
                event.sequence,
                event.correlation_id.clone(),
                event.kind.clone(),
            )
        })
        .collect()
}

fn empty_filter() -> AuditJournalFilter {
    AuditJournalFilter {
        workspace_id: None,
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: None,
        workflow_id: None,
        task_id: None,
        correlation_id: None,
        kind: None,
        severity: None,
        source: None,
        after_sequence: None,
        before_sequence: None,
        limit: None,
    }
}

#[test]
fn test_audit_event_bus_db_snapshot_replay_harness() {
    let db = ManagedDb::new(Database::open_memory().expect("memory db"));
    let emitter = RecordingEmitter::default();
    let scenarios = [
        (
            "agent_output",
            "info",
            "agent-runtime",
            "trace-agent-output",
            json!({
                "summary": "Agent output rendered",
                "activeRoadmapId": "P0-12",
                "doneCount": 11
            }),
        ),
        (
            "watchdog_decision",
            "warn",
            "watchdog",
            "trace-watchdog-decision",
            json!({
                "summary": "Watchdog requested attention",
                "decision": "needs_attention",
                "activeRoadmapId": "P0-12",
                "doneCount": 11
            }),
        ),
        (
            "tool_result",
            "info",
            "tool-runner",
            "trace-tool-result",
            json!({
                "summary": "cargo test audit harness passed",
                "toolName": "cargo",
                "status": "pass",
                "activeRoadmapId": "P0-12",
                "doneCount": 11
            }),
        ),
        (
            "session_complete",
            "info",
            "agent-runtime",
            "trace-session-complete",
            json!({
                "summary": "Session complete replay",
                "activeRoadmapId": null,
                "doneCount": 12,
                "sessionStatus": "complete"
            }),
        ),
    ];

    let mut returned = Vec::new();
    for (kind, severity, source, correlation_id, payload) in scenarios {
        let record = append_from_ipc_shape(
            &db,
            &emitter,
            append_body(kind, severity, source, correlation_id, payload),
        )
        .expect("append audit event through IPC-shaped payload");
        assert_eq!(record.kind, kind);
        assert_eq!(record.correlation_id, correlation_id);
        returned.push(record);
    }

    let emitted = emitter.audit_events();
    assert_eq!(emitted.len(), 4);
    for (emitted, returned) in emitted.iter().zip(returned.iter()) {
        assert_eq!(emitted.sequence, returned.sequence);
        assert_eq!(emitted.correlation_id, returned.correlation_id);
        assert_eq!(emitted.kind, returned.kind);
    }

    let persisted = db
        .with(|d| {
            d.list_audit_journal_events(&AuditJournalFilter {
                workspace_id: Some(WORKSPACE.to_string()),
                limit: Some(20),
                ..empty_filter()
            })
        })
        .expect("list audit events");
    assert_eq!(persisted.len(), 4);
    assert_eq!(
        persisted
            .iter()
            .map(|event| event.kind.as_str())
            .collect::<Vec<_>>(),
        vec![
            "agent_output",
            "watchdog_decision",
            "tool_result",
            "session_complete"
        ]
    );
    assert_bus_and_db_match(&emitted, &persisted).expect("bus and DB agree");

    let db_missing_bus = assert_bus_and_db_match(&emitted[..3], &persisted).unwrap_err();
    assert!(db_missing_bus.contains("DB event missing from event bus"));
    let mut ui_only = emitted.clone();
    let mut extra = returned[0].clone();
    extra.sequence = 99_999;
    extra.correlation_id = "trace-ui-only".to_string();
    ui_only.push(extra);
    let bus_missing_db = assert_bus_and_db_match(&ui_only, &persisted).unwrap_err();
    assert!(bus_missing_db.contains("event bus emitted event missing from DB"));

    let snapshot = db
        .with(|d| d.get_latest_audit_snapshot(WORKSPACE))
        .expect("latest snapshot");
    assert_eq!(snapshot.event_count, 4);
    assert_eq!(
        snapshot.through_sequence,
        persisted.last().unwrap().sequence
    );
    assert_eq!(
        snapshot.snapshot_json["counts"]["byKind"]["agent_output"],
        1
    );
    assert_eq!(
        snapshot.snapshot_json["counts"]["byKind"]["watchdog_decision"],
        1
    );
    assert_eq!(snapshot.snapshot_json["counts"]["byKind"]["tool_result"], 1);
    assert_eq!(
        snapshot.snapshot_json["counts"]["byKind"]["session_complete"],
        1
    );
    assert_eq!(
        snapshot.snapshot_json["replayState"]["activeRoadmapId"],
        Value::Null
    );
    assert_eq!(snapshot.snapshot_json["replayState"]["doneCount"], 12);
    assert_eq!(
        snapshot.snapshot_json["replayState"]["lastSessionStatus"],
        "complete"
    );
    assert_eq!(
        snapshot.snapshot_json["recentEvents"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
}

#[test]
fn test_audit_write_failure_emits_explicit_incident() {
    let db = ManagedDb::new(Database::open_memory().expect("memory db"));
    let emitter = RecordingEmitter::default();

    let error = append_from_ipc_shape(
        &db,
        &emitter,
        json!({
            "event": {
                "workspaceId": "",
                "correlationId": "trace-invalid-write",
                "kind": "agent_output",
                "severity": "info",
                "source": "agent-runtime",
                "payloadJson": {
                    "summary": "invalid write"
                }
            }
        }),
    )
    .expect_err("invalid write should fail");
    assert!(error.contains("Audit workspace_id is required"));

    let incidents = emitter.incidents();
    assert_eq!(incidents.len(), 1);
    assert_eq!(incidents[0]["kind"], "audit_journal_write_failed");
    assert_eq!(incidents[0]["severity"], "error");
    assert_eq!(incidents[0]["operation"], "append_audit_event");
    assert!(incidents[0]["message"]
        .as_str()
        .unwrap()
        .contains("Audit workspace_id is required"));
}

#[test]
fn test_audit_sqlite_db_lock_emits_explicit_incident() {
    let temp = tempfile::tempdir().expect("tempdir");
    let db_path = temp.path().join("aelyris-audit-lock.db");
    let db = ManagedDb::new(Database::open(&db_path).expect("file db"));
    let emitter = RecordingEmitter::default();

    let locker = rusqlite::Connection::open(&db_path).expect("locker connection");
    locker
        .busy_timeout(Duration::from_millis(1))
        .expect("locker timeout");
    locker
        .execute_batch("BEGIN IMMEDIATE;")
        .expect("hold sqlite writer lock");

    let error = append_from_ipc_shape(
        &db,
        &emitter,
        append_body(
            "agent_output",
            "info",
            "agent-runtime",
            "trace-sqlite-lock",
            json!({ "summary": "locked write" }),
        ),
    )
    .expect_err("locked sqlite db should fail the append");
    assert!(
        error.to_lowercase().contains("locked") || error.to_lowercase().contains("busy"),
        "unexpected sqlite lock error: {error}"
    );

    let incidents = emitter.incidents();
    assert_eq!(incidents.len(), 1);
    assert_eq!(incidents[0]["kind"], "audit_journal_write_failed");
    assert_eq!(incidents[0]["severity"], "error");
    assert_eq!(incidents[0]["operation"], "append_audit_event");
    assert_eq!(incidents[0]["workspaceId"], WORKSPACE);
    assert_eq!(incidents[0]["correlationId"], "trace-sqlite-lock");
    assert!(incidents[0]["message"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("locked"));

    locker.execute_batch("ROLLBACK;").ok();
}
