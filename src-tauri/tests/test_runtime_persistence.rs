//! Runtime Hardening P1 — on-disk durability (FR-1/2/3).
//!
//! The unit tests prove restore via a shared in-memory db. This integration
//! test goes further: it uses a REAL db file and drops every connection between
//! "sessions", which is the closest deterministic proxy to an OS process
//! restart (WAL checkpoints to the file when the last writer closes). It also
//! mirrors lib.rs by giving the Context Store and Task Graph their OWN
//! connections to the same file, exercising the multi-writer + busy_timeout
//! path the audit flagged.

use std::sync::Arc;

use aether_terminal_lib::context_store::ContextStoreManager;
use aether_terminal_lib::db::{Database, ManagedDb};
use aether_terminal_lib::event_bus::{AgentEvent, AgentEventKind, EventBus};
use aether_terminal_lib::task::{Task, TaskManager, TaskStatus};
use tempfile::tempdir;

fn open(db_path: &std::path::Path) -> Arc<ManagedDb> {
    Arc::new(ManagedDb::new(Database::open(db_path).unwrap()))
}

#[test]
fn runtime_core_state_survives_a_real_file_restart() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("aether_runtime.db");

    // --- Session 1: write decisions + tasks, then drop (process "exit"). ---
    {
        let cs = ContextStoreManager::new();
        assert_eq!(cs.attach_db(open(&db_path)).unwrap(), 0);
        let tm = TaskManager::new();
        assert_eq!(tm.attach_db(open(&db_path)).unwrap(), 0);

        cs.set("auth_method", "jwt");
        cs.set("database", "postgresql");

        tm.create(Task::new("api", "Build API")).unwrap();
        tm.create(Task::new("ui", "Build UI").with_dependencies(["api".to_string()]))
            .unwrap();
        // The autonomy loop mutates the graph opaquely via with_graph_mut —
        // status + recovery counters must reach disk through that path.
        tm.with_graph_mut(|g| {
            g.transition("api", TaskStatus::Running).unwrap();
            g.record_crash("api");
        });
    } // every connection dropped here -> WAL checkpointed into the file

    assert!(db_path.exists(), "db file must persist on disk");

    // --- Session 2: brand-new managers on the SAME file restore everything. ---
    let cs2 = ContextStoreManager::new();
    let restored_decisions = cs2.attach_db(open(&db_path)).unwrap();
    let tm2 = TaskManager::new();
    let restored_tasks = tm2.attach_db(open(&db_path)).unwrap();

    assert_eq!(restored_decisions, 2);
    assert_eq!(cs2.get("auth_method").as_deref(), Some("jwt"));
    assert_eq!(cs2.get("database").as_deref(), Some("postgresql"));

    assert_eq!(restored_tasks, 2);
    let api = tm2.get("api").unwrap();
    assert_eq!(api.status, TaskStatus::Running);
    assert_eq!(api.crash_attempts, 1);
    let ui = tm2.get("ui").unwrap();
    assert_eq!(ui.status, TaskStatus::Pending);
    assert_eq!(ui.dependencies, vec!["api".to_string()]);
}

#[test]
fn mutations_after_restore_persist_through_a_second_restart() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("aether_runtime2.db");

    // Session 1: seed one task.
    {
        let tm = TaskManager::new();
        tm.attach_db(open(&db_path)).unwrap();
        tm.create(Task::new("t", "T")).unwrap();
    }

    // Session 2: restore, then drive it to completion.
    {
        let tm = TaskManager::new();
        assert_eq!(tm.attach_db(open(&db_path)).unwrap(), 1);
        tm.transition("t", TaskStatus::Running).unwrap();
        tm.transition("t", TaskStatus::Done).unwrap();
    }

    // Session 3: the terminal state from session 2 is durable.
    let tm = TaskManager::new();
    assert_eq!(tm.attach_db(open(&db_path)).unwrap(), 1);
    assert_eq!(tm.get("t").unwrap().status, TaskStatus::Done);
}

#[test]
fn event_log_survives_a_real_file_restart_with_no_loss() {
    // P3: the durable Event Bus log must keep EVERY notification across a restart
    // — even past the 256 in-memory ring cap that would have evicted ~44 of these.
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("aether_events.db");

    // Session 1: publish 300 events through a db-backed bus, then drop it.
    {
        let bus = EventBus::new();
        bus.attach_db(open(&db_path));
        for i in 0..300 {
            bus.publish(AgentEvent::new(
                AgentEventKind::AgentActivity,
                serde_json::json!({ "i": i }),
            ));
        }
    }

    // Session 2: a fresh bus on the same file replays ALL 300 by cursor, with no
    // gaps (strictly increasing seq), proving no-loss durability across restart.
    let bus2 = EventBus::new();
    bus2.attach_db(open(&db_path));
    assert!(bus2.recent().is_empty(), "ring starts cold after restart");
    let mut cursor = 0;
    let mut seen = 0;
    loop {
        let batch = bus2.since(cursor, 64);
        if batch.is_empty() {
            break;
        }
        for e in &batch {
            assert!(e.seq > cursor, "seq must strictly increase (no gaps)");
            cursor = e.seq;
            seen += 1;
        }
    }
    assert_eq!(seen, 300, "every event survived the restart");
}
