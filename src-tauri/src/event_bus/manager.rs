use std::sync::{Arc, Mutex};

use super::{
    AckReceipt, AgentEvent, EventBatch, EventBusError, EventChannel, EventLog, PublishDurability,
    PublishReceipt,
};
use crate::db::ManagedDb;
use crate::persistence::EventRepo;

/// Thread-safe owner of coordination events.
///
/// Production uses `new_durable`: an outbox row must commit before the event is
/// published to the bounded hot cache or acknowledged to the producer. Tests
/// that intentionally exercise a process-local bus use `new` and receive an
/// explicit `Ephemeral` receipt. Durable delivery is at-least-once; consumers
/// apply effects by `event_id` and advance a durable cumulative ACK afterwards.
pub struct EventBus {
    log: Mutex<EventLog>,
    db: Mutex<Option<Arc<ManagedDb>>>,
    durable_required: bool,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    /// Explicit ephemeral bus for isolated tests and non-authoritative helpers.
    pub fn new() -> Self {
        Self {
            log: Mutex::new(EventLog::default()),
            db: Mutex::new(None),
            durable_required: false,
        }
    }

    /// Production owner: publishing fails closed until a durable DB is attached.
    pub fn new_durable() -> Self {
        Self {
            log: Mutex::new(EventLog::default()),
            db: Mutex::new(None),
            durable_required: true,
        }
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

    pub fn attach_db(&self, db: Arc<ManagedDb>) {
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
    }

    /// Persist-before-cache. A failed append is returned to the caller and is
    /// never represented as a live or durable success. Retrying the same
    /// `event_id` is idempotent.
    pub fn publish(&self, event: AgentEvent) -> Result<PublishReceipt, EventBusError> {
        let Some(db) = self.db() else {
            if self.durable_required {
                return Err(EventBusError::DurabilityUnavailable);
            }
            self.lock().publish(event.clone());
            return Ok(PublishReceipt {
                event_id: event.event_id,
                seq: None,
                durability: PublishDurability::Ephemeral,
            });
        };

        let (seq, inserted) = db
            .with(|database| EventRepo::append(database, &event).map_err(|error| error.to_string()))
            .map_err(
                |message| match serde_json::from_str::<EventBusError>(&message) {
                    Ok(error) => error,
                    Err(_) => EventBusError::AppendFailed {
                        event_id: event.event_id.clone(),
                        message,
                    },
                },
            )?;
        // Cache only after the transaction commits. Duplicate producer retries
        // do not duplicate the live projection.
        if inserted {
            self.lock().publish(event.clone());
        }
        Ok(PublishReceipt {
            event_id: event.event_id,
            seq: Some(seq),
            durability: if inserted {
                PublishDurability::Durable
            } else {
                PublishDurability::Duplicate
            },
        })
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

    pub fn since(&self, after_seq: i64, limit: usize) -> Result<EventBatch, EventBusError> {
        self.read_durable(|database| EventRepo::since(database, after_seq, limit))
    }

    pub fn by_channel_since(
        &self,
        channel: EventChannel,
        after_seq: i64,
        limit: usize,
    ) -> Result<EventBatch, EventBusError> {
        self.read_durable(|database| {
            EventRepo::by_channel_since(database, channel, after_seq, limit)
        })
    }

    pub fn poll_consumer(
        &self,
        consumer_id: &str,
        limit: usize,
    ) -> Result<EventBatch, EventBusError> {
        self.read_durable(|database| EventRepo::poll_consumer(database, consumer_id, limit))
    }

    pub fn ack(
        &self,
        consumer_id: &str,
        seq: i64,
        event_id: &str,
    ) -> Result<AckReceipt, EventBusError> {
        self.read_durable(|database| EventRepo::ack(database, consumer_id, seq, event_id))
    }

    fn read_durable<T>(
        &self,
        query: impl FnOnce(&crate::db::Database) -> Result<T, EventBusError>,
    ) -> Result<T, EventBusError> {
        let db = self.db().ok_or(EventBusError::DurabilityUnavailable)?;
        db.with(|database| query(database).map_err(|error| error.to_string()))
            .map_err(|message| {
                serde_json::from_str::<EventBusError>(&message).unwrap_or(
                    EventBusError::QueryFailed {
                        operation: "managed_db".to_string(),
                        message,
                    },
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::AgentEventKind;
    use serde_json::json;

    fn mem_bus() -> (EventBus, Arc<ManagedDb>) {
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let bus = EventBus::new_durable();
        bus.attach_db(db.clone());
        (bus, db)
    }

    #[test]
    fn ephemeral_mode_is_explicit_and_durable_mode_fails_without_attachment() {
        let ephemeral = EventBus::new();
        let receipt = ephemeral
            .publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null)))
            .unwrap();
        assert_eq!(receipt.durability, PublishDurability::Ephemeral);
        assert_eq!(ephemeral.recent().len(), 1);

        let durable = EventBus::new_durable();
        assert_eq!(
            durable
                .publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null)))
                .unwrap_err(),
            EventBusError::DurabilityUnavailable
        );
        assert!(durable.recent().is_empty());
    }

    #[test]
    fn publish_is_durable_before_cache_and_replays_after_restart() {
        let (bus, db) = mem_bus();
        let receipt = bus
            .publish(AgentEvent::new(
                AgentEventKind::DecisionChanged,
                json!({"k": "v"}),
            ))
            .unwrap();
        assert_eq!(receipt.durability, PublishDurability::Durable);
        assert_eq!(bus.recent().len(), 1);
        drop(bus);

        let restarted = EventBus::new_durable();
        restarted.attach_db(db);
        assert!(restarted.recent().is_empty());
        let replay = restarted.since(0, 100).unwrap();
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].event.event_id, receipt.event_id);
    }

    #[test]
    fn append_failure_is_not_cached_or_acknowledged_across_process_exit() {
        let (bus, db) = mem_bus();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE agent_events", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let event = AgentEvent::new(AgentEventKind::TaskCreated, json!({"n": 1}));
        assert!(matches!(
            bus.publish(event),
            Err(EventBusError::AppendFailed { .. })
        ));
        assert!(bus.recent().is_empty());
        drop(bus);

        let restarted = EventBus::new_durable();
        restarted.attach_db(db);
        assert!(matches!(
            restarted.since(0, 100),
            Err(EventBusError::QueryFailed { .. })
        ));
    }

    #[test]
    fn consumer_crash_before_ack_redelivers_same_identity_after_restart() {
        let (bus, db) = mem_bus();
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "a"}),
        ))
        .unwrap();
        let first = bus.poll_consumer("worker-a", 10).unwrap();
        drop(bus);

        let restarted = EventBus::new_durable();
        restarted.attach_db(db);
        let duplicate = restarted.poll_consumer("worker-a", 10).unwrap();
        assert_eq!(duplicate.events, first.events);
        let delivery = &duplicate.events[0];
        restarted
            .ack("worker-a", delivery.seq, &delivery.event.event_id)
            .unwrap();
        assert!(restarted
            .poll_consumer("worker-a", 10)
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn cache_pressure_evicts_only_durable_events() {
        let (bus, _) = mem_bus();
        for i in 0..300 {
            bus.publish(AgentEvent::new(
                AgentEventKind::AgentActivity,
                json!({"i": i}),
            ))
            .unwrap();
        }
        assert_eq!(bus.recent().len(), 256);
        let mut cursor = 0;
        let mut seen = 0;
        loop {
            let batch = bus.since(cursor, 64).unwrap();
            if batch.events.is_empty() {
                break;
            }
            cursor = batch.events.last().unwrap().seq;
            seen += batch.events.len();
        }
        assert_eq!(seen, 300);
    }

    #[test]
    fn query_failure_and_corrupt_rows_are_typed_non_success() {
        let (bus, db) = mem_bus();
        bus.publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null)))
            .unwrap();
        db.with(|database| {
            database
                .conn()
                .execute(
                    "INSERT INTO agent_events (event_id, kind, channel, payload_json)
                     VALUES ('corrupt', 'unknown', 'system', 'null')",
                    [],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            bus.since(0, 100),
            Err(EventBusError::CorruptRow { .. })
        ));
        let (query_bus, query_db) = mem_bus();
        query_db
            .with(|database| {
                database
                    .conn()
                    .execute("DROP TABLE event_consumer_cursors", [])
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert!(matches!(
            query_bus.poll_consumer("worker-a", 100),
            Err(EventBusError::QueryFailed { .. })
        ));
    }
}
