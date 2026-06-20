use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use super::{AgentEvent, EventChannel, EventLog, SeqEvent};
use crate::db::ManagedDb;
use crate::persistence::EventRepo;

/// Upper bound on events buffered for durable retry while the db is unavailable.
/// Past this the OLDEST buffered event is dropped (with a loud log) — a bounded
/// memory cost so a prolonged db outage cannot OOM the process.
const MAX_PENDING: usize = 4096;

/// Thread-safe owner of the Event Bus, managed in Tauri state. The
/// controller/subsystems `publish`; the cockpit observes the live feed via the
/// IPC layer's Tauri re-emit (star-backed transport).
///
/// Two reads, two guarantees (Runtime Hardening P3):
/// - `recent`/`by_channel` read the bounded in-memory ring — a fast hot cache of
///   the latest events for the live cockpit feed.
/// - `since`/`by_channel_since` read the DURABLE append-only log (the source of
///   truth): a subscriber polls `seq > cursor` and is guaranteed to see every
///   event exactly once, with no eviction loss and across restarts.
///
/// `publish` is write-through: it appends to the durable log (truth) then the
/// ring (cache). Without an attached `db` the bus is purely in-memory, exactly
/// as before (tests / non-persistent mode).
#[derive(Default)]
pub struct EventBus {
    log: Mutex<EventLog>,
    db: Mutex<Option<Arc<ManagedDb>>>,
    /// Events that failed to append durably (db transiently unavailable). Drained
    /// FIFO on the next publish so a transient failure self-heals and durable
    /// order matches publish order — the no-loss guarantee survives a hiccup.
    pending: Mutex<VecDeque<AgentEvent>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, EventLog> {
        self.log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Attach the durable backing. No restore needed: the log is append-only and
    /// read by cursor, so a fresh ring + `since(0)` already replays full history.
    pub fn attach_db(&self, db: Arc<ManagedDb>) {
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
    }

    pub fn publish(&self, event: AgentEvent) {
        // Live ring always (cockpit visibility), regardless of the durability
        // outcome below — the live feed never depends on a db write succeeding.
        self.lock().publish(event.clone());
        if let Some(db) = self.db() {
            self.append_durable(&db, event);
        }
    }

    /// Append `event` to the durable log, draining any backlog FIFO first so
    /// durable order matches publish order. On a write failure the event joins
    /// the bounded pending buffer and is retried on the next publish — a
    /// transient db outage (busy / disk full / I/O error) self-heals instead of
    /// silently dropping the event from the no-loss stream (P3 audit H-1).
    fn append_durable(&self, db: &ManagedDb, event: AgentEvent) {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while let Some(front) = pending.pop_front() {
            if let Err(e) = db.with(|d| EventRepo::append(d, &front)) {
                tracing::error!(error = %e, pending = pending.len() + 1, "event durable retry failed");
                pending.push_front(front); // restore the one that just failed
                push_bounded(&mut pending, event); // and queue the new one behind it
                return;
            }
        }
        if let Err(e) = db.with(|d| EventRepo::append(d, &event)) {
            tracing::error!(kind = %event.kind.as_str(), error = %e, "event persist failed; buffered for retry");
            push_bounded(&mut pending, event);
        }
    }

    pub fn recent(&self) -> Vec<AgentEvent> {
        self.lock().recent().into_iter().cloned().collect()
    }

    pub fn by_channel(&self, channel: EventChannel) -> Vec<AgentEvent> {
        self.lock()
            .by_channel(channel)
            .into_iter()
            .cloned()
            .collect()
    }

    /// No-loss read: every event with `seq > after_seq`, oldest first, up to
    /// `limit`. Empty without an attached db (the durable log is the only
    /// no-loss source). Advance the cursor to the last returned `seq`.
    pub fn since(&self, after_seq: i64, limit: usize) -> Vec<SeqEvent> {
        self.read_durable(|d| EventRepo::since(d, after_seq, limit))
    }

    /// No-loss read restricted to one channel.
    pub fn by_channel_since(
        &self,
        channel: EventChannel,
        after_seq: i64,
        limit: usize,
    ) -> Vec<SeqEvent> {
        self.read_durable(|d| EventRepo::by_channel_since(d, channel, after_seq, limit))
    }

    fn read_durable(
        &self,
        query: impl FnOnce(&crate::db::Database) -> Result<Vec<SeqEvent>, String>,
    ) -> Vec<SeqEvent> {
        let Some(db) = self.db() else {
            return Vec::new();
        };
        match db.with(query) {
            Ok(events) => events,
            Err(e) => {
                tracing::error!(error = %e, "event since-query failed");
                Vec::new()
            }
        }
    }
}

/// Push onto the bounded pending buffer, shedding the OLDEST unpersisted event
/// (with a loud log) if at capacity — so a prolonged db outage costs bounded
/// memory rather than OOMing the process.
fn push_bounded(pending: &mut VecDeque<AgentEvent>, event: AgentEvent) {
    if pending.len() >= MAX_PENDING {
        if let Some(dropped) = pending.pop_front() {
            tracing::error!(
                kind = %dropped.kind.as_str(),
                "pending event buffer full; dropped oldest unpersisted event"
            );
        }
    }
    pending.push_back(event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::AgentEventKind;
    use serde_json::json;

    #[test]
    fn publish_then_recent_round_trips() {
        let bus = EventBus::new();
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "t1"}),
        ));
        bus.publish(AgentEvent::new(AgentEventKind::ReviewRequired, json!(null)));
        let recent = bus.recent();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].kind, AgentEventKind::TaskCreated);
    }

    #[test]
    fn by_channel_filters_through_the_manager() {
        let bus = EventBus::new();
        bus.publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null))); // planning
        bus.publish(AgentEvent::new(AgentEventKind::ReviewRequired, json!(null))); // review
        assert_eq!(bus.by_channel(EventChannel::Planning).len(), 1);
        assert_eq!(bus.by_channel(EventChannel::Review).len(), 1);
        assert_eq!(bus.by_channel(EventChannel::System).len(), 0);
    }

    #[test]
    fn since_is_empty_without_a_db() {
        let bus = EventBus::new();
        bus.publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null)));
        assert!(bus.since(0, 100).is_empty());
    }

    fn mem_bus() -> (EventBus, Arc<ManagedDb>) {
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let bus = EventBus::new();
        bus.attach_db(db.clone());
        (bus, db)
    }

    #[test]
    fn publish_is_durable_and_since_reads_it() {
        let (bus, _db) = mem_bus();
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "a"}),
        ));
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCompleted,
            json!({"id": "a"}),
        ));
        let all = bus.since(0, 100);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].event.kind, AgentEventKind::TaskCreated);
        // Cursor: only events after the first.
        let after = bus.since(all[0].seq, 100);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].event.kind, AgentEventKind::TaskCompleted);
    }

    #[test]
    fn durable_log_survives_a_simulated_restart() {
        let (bus, db) = mem_bus();
        bus.publish(AgentEvent::new(
            AgentEventKind::DecisionChanged,
            json!({"k": "v"}),
        ));
        drop(bus);
        // A fresh bus on the SAME db replays full history via since(0) even though
        // its ring cache starts empty.
        let bus2 = EventBus::new();
        bus2.attach_db(db);
        assert!(bus2.recent().is_empty()); // ring is cold
        let all = bus2.since(0, 100);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].event.kind, AgentEventKind::DecisionChanged);
    }

    #[test]
    fn no_loss_beyond_the_ring_cap_through_the_manager() {
        let (bus, _db) = mem_bus();
        for i in 0..300 {
            bus.publish(AgentEvent::new(
                AgentEventKind::AgentActivity,
                json!({ "i": i }),
            ));
        }
        // The ring evicted down to its cap, but the durable cursor walk sees all.
        assert!(bus.recent().len() <= 256);
        let mut cursor = 0;
        let mut seen = 0;
        loop {
            let batch = bus.since(cursor, 64);
            if batch.is_empty() {
                break;
            }
            for e in &batch {
                cursor = e.seq;
                seen += 1;
            }
        }
        assert_eq!(seen, 300);
    }

    #[test]
    fn append_failure_buffers_and_self_heals_in_order() {
        let (bus, db) = mem_bus();
        // Break the durable log so appends fail (a stand-in for disk full / I/O
        // error — the failures busy_timeout cannot rescue).
        db.with(|d| {
            d.conn()
                .execute("DROP TABLE agent_events", [])
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .unwrap();

        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"n": 1}),
        ));
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCompleted,
            json!({"n": 2}),
        ));
        // Live ring still saw both; the durable read fails gracefully (empty).
        assert_eq!(bus.recent().len(), 2);
        assert!(bus.since(0, 100).is_empty());

        // Recover the durable log. The next publish drains the buffered backlog
        // (1, 2) IN ORDER, then appends 3 — no event lost, order preserved.
        db.with(|d| crate::db::migrations::run_migrations(d.conn()).map_err(|e| e.to_string()))
            .unwrap();
        bus.publish(AgentEvent::new(
            AgentEventKind::DecisionChanged,
            json!({"n": 3}),
        ));

        let all = bus.since(0, 100);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].event.payload["n"], 1);
        assert_eq!(all[1].event.payload["n"], 2);
        assert_eq!(all[2].event.payload["n"], 3);
    }
}
