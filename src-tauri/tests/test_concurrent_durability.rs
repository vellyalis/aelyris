//! Runtime Hardening P2 — durability under concurrent multi-writer load.
//!
//! The adversarial P1 audit's HIGH finding was that three+ writer connections to
//! one WAL db file, with no `busy_timeout`, would drop write-through on
//! SQLITE_BUSY — silently losing decisions/tasks exactly when the autonomy loop
//! is busiest. The fix set `busy_timeout` on every connection. This test is the
//! enterprise-grade proof that the fix holds: it reproduces the production
//! topology (Context Store, Task Graph, and an audit/history writer each on its
//! OWN connection to one file) and hammers all three concurrently. Without the
//! busy_timeout a contended writer would fail and the assertion (no writes lost)
//! would break; with it, every write is durable.
//!
//! Runs against a real file (WAL checkpoints on connection close) so it is a
//! faithful proxy for the live loop, while staying deterministic and headless.

use std::sync::Arc;
use std::thread;

use aelyris_lib::context_store::ContextStoreManager;
use aelyris_lib::db::{AuditJournalAppend, AuditJournalFilter, Database, ManagedDb};
use aelyris_lib::task::{Task, TaskManager};
use tempfile::tempdir;

const N: usize = 100;

fn open(path: &std::path::Path) -> Arc<ManagedDb> {
    Arc::new(ManagedDb::new(Database::open(path).unwrap()))
}

fn stress_audit_event(i: usize) -> AuditJournalAppend {
    AuditJournalAppend {
        workspace_id: "default".to_string(),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: None,
        workflow_id: None,
        task_id: Some(format!("t{i}")),
        correlation_id: Some(format!("c{i}")),
        kind: "stress".to_string(),
        severity: "info".to_string(),
        source: "test".to_string(),
        confidence: None,
        payload_json: serde_json::json!({ "i": i }),
    }
}

#[test]
fn concurrent_writers_on_one_db_file_lose_no_writes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("aelyris_concurrent.db");

    // Production topology: three independent writer connections to one file.
    let cs = ContextStoreManager::new();
    cs.attach_db(open(&path)).unwrap();
    let tm = TaskManager::new();
    tm.attach_db(open(&path)).unwrap();
    let audit_db = open(&path);

    // Hammer all three at once. If a contended write hit SQLITE_BUSY (no
    // busy_timeout), the audit thread's unwrap would panic and the Context/Task
    // counts below would come up short — the test would fail.
    thread::scope(|s| {
        s.spawn(|| {
            for i in 0..N {
                cs.set(format!("key{i}"), "v");
            }
        });
        s.spawn(|| {
            for i in 0..N {
                tm.create(Task::new(format!("t{i}"), "T")).unwrap();
            }
        });
        s.spawn(|| {
            for i in 0..N {
                audit_db
                    .with(|d| d.append_audit_journal_event(&stress_audit_event(i)))
                    .unwrap();
            }
        });
    });

    // No writes lost: reopen fresh connections and count everything that landed.
    let cs2 = ContextStoreManager::new();
    assert_eq!(
        cs2.attach_db(open(&path)).unwrap(),
        N,
        "lost context decisions"
    );
    let tm2 = TaskManager::new();
    assert_eq!(tm2.attach_db(open(&path)).unwrap(), N, "lost tasks");
    let audit2 = ManagedDb::new(Database::open(&path).unwrap());
    let rows = audit2
        .with(|d| {
            d.list_audit_journal_events(&AuditJournalFilter {
                kind: Some("stress".to_string()),
                limit: Some(10_000),
                ..Default::default()
            })
        })
        .unwrap();
    assert_eq!(rows.len(), N, "lost audit rows");
}
