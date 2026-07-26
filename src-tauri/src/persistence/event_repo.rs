//! Durable EventBus outbox and consumer-cursor repository.
//!
//! `agent_events` remains the sole coordination-event owner. An event is
//! transactionally committed here before it can enter the bounded hot cache.
//! Consumers poll from a durable cumulative ACK and apply effects idempotently
//! with `event_id`; delivery is deliberately at-least-once, never exactly-once.

use std::str::FromStr;

use rusqlite::{params, OptionalExtension};

use crate::db::Database;
use crate::event_bus::{
    AckReceipt, AgentEvent, AgentEventKind, EventBatch, EventBatchStatus, EventBusError,
    EventChannel, SeqEvent,
};

pub struct EventRepo;

#[derive(Debug, Clone)]
struct StreamState {
    high_water_seq: i64,
    high_water_event_id: Option<String>,
}

impl EventRepo {
    /// Commit one outbox row. Replaying the same identity and content is
    /// idempotent; identity reuse with different content fails closed.
    pub fn append(db: &Database, event: &AgentEvent) -> Result<(i64, bool), EventBusError> {
        if event.event_id.trim().is_empty() {
            return Err(EventBusError::InvalidEventIdentity);
        }
        let payload =
            serde_json::to_string(&event.payload).map_err(|error| EventBusError::AppendFailed {
                event_id: event.event_id.clone(),
                message: format!("serialize payload: {error}"),
            })?;
        let conn = db.conn();
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|error| EventBusError::AppendFailed {
                event_id: event.event_id.clone(),
                message: format!("begin outbox transaction: {error}"),
            })?;

        let result = (|| {
            let existing = conn
                .query_row(
                    "SELECT seq, kind, channel, payload_json
                     FROM agent_events WHERE event_id = ?1",
                    [&event.event_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("query idempotency identity: {error}"))?;

            if let Some((seq, kind, channel, existing_payload)) = existing {
                if kind != event.kind.as_str()
                    || channel != event.channel.as_str()
                    || existing_payload != payload
                {
                    return Err("event identity already exists with different content".to_string());
                }
                return Ok((seq, false));
            }

            conn.execute(
                "INSERT INTO agent_events (event_id, kind, channel, payload_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    event.event_id,
                    event.kind.as_str(),
                    event.channel.as_str(),
                    payload
                ],
            )
            .map_err(|error| format!("insert outbox row: {error}"))?;
            Ok((conn.last_insert_rowid(), true))
        })();

        match result {
            Ok(outcome) => {
                if let Err(error) = conn.execute_batch("COMMIT") {
                    let _ = conn.execute_batch("ROLLBACK");
                    return Err(EventBusError::AppendFailed {
                        event_id: event.event_id.clone(),
                        message: format!("commit outbox transaction: {error}"),
                    });
                }
                Ok(outcome)
            }
            Err(message) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(EventBusError::AppendFailed {
                    event_id: event.event_id.clone(),
                    message,
                })
            }
        }
    }

    pub fn since(db: &Database, after_seq: i64, limit: usize) -> Result<EventBatch, EventBusError> {
        Self::query(db, None, after_seq, limit, "since")
    }

    pub fn by_channel_since(
        db: &Database,
        channel: EventChannel,
        after_seq: i64,
        limit: usize,
    ) -> Result<EventBatch, EventBusError> {
        Self::query(db, Some(channel), after_seq, limit, "by_channel_since")
    }

    /// Poll without advancing the cursor. A crash before ACK therefore causes a
    /// duplicate delivery with the same `event_id`, allowing an idempotent
    /// consumer to detect an already-applied effect.
    pub fn poll_consumer(
        db: &Database,
        consumer_id: &str,
        limit: usize,
    ) -> Result<EventBatch, EventBusError> {
        validate_consumer_id(consumer_id)?;
        let stream = Self::inspect_stream(db, "poll_consumer")?;
        let conn = db.conn();
        conn.execute(
            "INSERT INTO event_consumer_cursors (consumer_id, ack_seq)
             VALUES (?1, 0) ON CONFLICT(consumer_id) DO NOTHING",
            [consumer_id],
        )
        .map_err(|error| EventBusError::QueryFailed {
            operation: "register_consumer".to_string(),
            message: error.to_string(),
        })?;
        let (ack_seq, ack_event_id) = conn
            .query_row(
                "SELECT ack_seq, ack_event_id
                 FROM event_consumer_cursors WHERE consumer_id = ?1",
                [consumer_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .map_err(|error| EventBusError::QueryFailed {
                operation: "read_consumer_cursor".to_string(),
                message: error.to_string(),
            })?;
        Self::validate_consumer_cursor(db, consumer_id, ack_seq, ack_event_id.as_deref(), &stream)?;
        Self::since(db, ack_seq, limit)
    }

    /// Cumulative durable ACK. `event_id` binds the ACK to the exact delivered
    /// row and prevents a stale/malformed client from skipping a different row.
    pub fn ack(
        db: &Database,
        consumer_id: &str,
        seq: i64,
        event_id: &str,
    ) -> Result<AckReceipt, EventBusError> {
        validate_consumer_id(consumer_id)?;
        if event_id.trim().is_empty() {
            return Err(EventBusError::InvalidEventIdentity);
        }
        let conn = db.conn();
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|error| EventBusError::QueryFailed {
                operation: "begin_consumer_ack".to_string(),
                message: error.to_string(),
            })?;
        let result = (|| {
            let stream = Self::inspect_stream(db, "ack")?;
            let current = conn
                .query_row(
                    "SELECT ack_seq, ack_event_id
                     FROM event_consumer_cursors WHERE consumer_id = ?1",
                    [consumer_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(|error| EventBusError::QueryFailed {
                    operation: "read_consumer_ack".to_string(),
                    message: error.to_string(),
                })?
                .unwrap_or((0, None));
            Self::validate_consumer_cursor(
                db,
                consumer_id,
                current.0,
                current.1.as_deref(),
                &stream,
            )?;
            let current = current.0;
            if seq < current {
                return Err(EventBusError::AckRegression {
                    current_seq: current,
                    attempted_seq: seq,
                });
            }
            if seq > stream.high_water_seq {
                return Err(EventBusError::CursorOutOfRange {
                    after_seq: seq,
                    high_water_seq: stream.high_water_seq,
                });
            }
            let already_acked = seq == current;
            let observed_event_id = if already_acked {
                conn.query_row(
                    "SELECT event_id FROM agent_events WHERE seq = ?1",
                    [seq],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| EventBusError::QueryFailed {
                    operation: "bind_consumer_ack".to_string(),
                    message: error.to_string(),
                })?
                .ok_or(EventBusError::Gap {
                    expected_seq: seq,
                    observed_seq: seq.saturating_add(1),
                })?
            } else {
                let span = usize::try_from(seq.saturating_sub(current)).map_err(|_| {
                    EventBusError::QueryFailed {
                        operation: "validate_consumer_ack_range".to_string(),
                        message: "ack range is too large".to_string(),
                    }
                })?;
                if span > 1000 {
                    return Err(EventBusError::QueryFailed {
                        operation: "validate_consumer_ack_range".to_string(),
                        message: "ack cannot advance more than one maximum poll page".to_string(),
                    });
                }
                let batch = Self::since(db, current, span)?;
                let last = batch.events.last().ok_or(EventBusError::Gap {
                    expected_seq: current.saturating_add(1),
                    observed_seq: seq,
                })?;
                if last.seq != seq {
                    return Err(EventBusError::Gap {
                        expected_seq: last.seq.saturating_add(1),
                        observed_seq: seq,
                    });
                }
                last.event.event_id.clone()
            };
            if observed_event_id != event_id {
                return Err(EventBusError::AckIdentityMismatch {
                    seq,
                    expected_event_id: observed_event_id,
                    observed_event_id: event_id.to_string(),
                });
            }
            if !already_acked {
                conn.execute(
                    "INSERT INTO event_consumer_cursors
                         (consumer_id, ack_seq, ack_event_id, updated_at)
                     VALUES (?1, ?2, ?3, datetime('now'))
                     ON CONFLICT(consumer_id) DO UPDATE SET
                         ack_seq = excluded.ack_seq,
                         ack_event_id = excluded.ack_event_id,
                         updated_at = excluded.updated_at",
                    params![consumer_id, seq, event_id],
                )
                .map_err(|error| EventBusError::QueryFailed {
                    operation: "commit_consumer_ack".to_string(),
                    message: error.to_string(),
                })?;
            }
            Ok(AckReceipt {
                consumer_id: consumer_id.to_string(),
                ack_seq: seq,
                event_id: event_id.to_string(),
                already_acked,
            })
        })();

        match result {
            Ok(receipt) => {
                if let Err(error) = conn.execute_batch("COMMIT") {
                    let _ = conn.execute_batch("ROLLBACK");
                    return Err(EventBusError::QueryFailed {
                        operation: "commit_consumer_ack_transaction".to_string(),
                        message: error.to_string(),
                    });
                }
                Ok(receipt)
            }
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    fn query(
        db: &Database,
        channel: Option<EventChannel>,
        after_seq: i64,
        limit: usize,
        operation: &str,
    ) -> Result<EventBatch, EventBusError> {
        if limit == 0 {
            return Err(EventBusError::QueryFailed {
                operation: operation.to_string(),
                message: "limit must be at least 1".to_string(),
            });
        }
        let stream = Self::inspect_stream(db, operation)?;
        if after_seq < 0 || after_seq > stream.high_water_seq {
            return Err(EventBusError::CursorOutOfRange {
                after_seq,
                high_water_seq: stream.high_water_seq,
            });
        }
        let conn = db.conn();
        let sql = if channel.is_some() {
            "SELECT seq, event_id, kind, channel, payload_json FROM agent_events
             WHERE channel = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3"
        } else {
            "SELECT seq, event_id, kind, channel, payload_json FROM agent_events
             WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2"
        };
        let mut stmt = conn
            .prepare(sql)
            .map_err(|error| EventBusError::QueryFailed {
                operation: operation.to_string(),
                message: format!("prepare: {error}"),
            })?;
        let raws = match channel {
            Some(channel) => {
                stmt.query_map(params![channel.as_str(), after_seq, limit as i64], map_row)
            }
            None => stmt.query_map(params![after_seq, limit as i64], map_row),
        }
        .map_err(|error| EventBusError::QueryFailed {
            operation: operation.to_string(),
            message: format!("query: {error}"),
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| EventBusError::QueryFailed {
            operation: operation.to_string(),
            message: format!("read rows: {error}"),
        })?;
        let events = rows_to_events(raws)?;
        if channel.is_none() {
            let mut expected = after_seq.saturating_add(1);
            for event in &events {
                if event.seq != expected {
                    return Err(EventBusError::Gap {
                        expected_seq: expected,
                        observed_seq: event.seq,
                    });
                }
                expected = event.seq.saturating_add(1);
            }
            if events.is_empty() && after_seq < stream.high_water_seq {
                return Err(EventBusError::Gap {
                    expected_seq: after_seq.saturating_add(1),
                    observed_seq: stream.high_water_seq.saturating_add(1),
                });
            }
        }
        Ok(EventBatch {
            after_seq,
            events,
            status: EventBatchStatus::Complete,
        })
    }

    /// Validate the durable stream frontier before returning any page,
    /// including an empty page. `COUNT == MAX == high_water` is intentional:
    /// AUTOINCREMENT starts at one and rows are append-only, so any deleted
    /// interior or latest row makes the invariant fail closed.
    fn inspect_stream(db: &Database, operation: &str) -> Result<StreamState, EventBusError> {
        let conn = db.conn();
        let (row_count, max_seq) = conn
            .query_row("SELECT COUNT(*), MAX(seq) FROM agent_events", [], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?))
            })
            .map_err(|error| EventBusError::QueryFailed {
                operation: format!("{operation}:inspect_stream_rows"),
                message: error.to_string(),
            })?;
        let state = conn
            .query_row(
                "SELECT high_water_seq, high_water_event_id
                 FROM event_stream_state WHERE id = 1",
                [],
                |row| {
                    Ok(StreamState {
                        high_water_seq: row.get(0)?,
                        high_water_event_id: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| EventBusError::QueryFailed {
                operation: format!("{operation}:inspect_stream_state"),
                message: error.to_string(),
            })?
            .ok_or_else(|| EventBusError::StreamInvariant {
                high_water_seq: -1,
                max_seq,
                row_count,
                message: "event_stream_state row is missing".to_string(),
            })?;

        if state.high_water_seq < 0 {
            return Err(EventBusError::StreamInvariant {
                high_water_seq: state.high_water_seq,
                max_seq,
                row_count,
                message: "event stream high-water sequence is negative".to_string(),
            });
        }
        if row_count < state.high_water_seq || max_seq.unwrap_or(0) < state.high_water_seq {
            let expected_seq = first_missing_seq(conn, state.high_water_seq)?;
            return Err(EventBusError::Gap {
                expected_seq,
                observed_seq: conn
                    .query_row(
                        "SELECT MIN(seq) FROM agent_events WHERE seq > ?1",
                        [expected_seq],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .map_err(|error| EventBusError::QueryFailed {
                        operation: format!("{operation}:find_gap_successor"),
                        message: error.to_string(),
                    })?
                    .unwrap_or_else(|| state.high_water_seq.saturating_add(1)),
            });
        }
        let expected_max = (state.high_water_seq > 0).then_some(state.high_water_seq);
        if max_seq != expected_max || row_count != state.high_water_seq {
            return Err(EventBusError::StreamInvariant {
                high_water_seq: state.high_water_seq,
                max_seq,
                row_count,
                message:
                    "event rows exceed or otherwise disagree with the committed high-water sequence"
                        .to_string(),
            });
        }

        if state.high_water_seq == 0 {
            if state.high_water_event_id.is_some() {
                return Err(EventBusError::StreamInvariant {
                    high_water_seq: 0,
                    max_seq,
                    row_count,
                    message: "empty stream has a non-empty high-water identity".to_string(),
                });
            }
            return Ok(state);
        }

        let trailing = conn
            .query_row(
                "SELECT seq, event_id, kind, channel, payload_json
                 FROM agent_events WHERE seq = ?1",
                [state.high_water_seq],
                map_row,
            )
            .optional()
            .map_err(|error| EventBusError::QueryFailed {
                operation: format!("{operation}:inspect_trailing_row"),
                message: error.to_string(),
            })?
            .ok_or_else(|| EventBusError::StreamInvariant {
                high_water_seq: state.high_water_seq,
                max_seq,
                row_count,
                message: "committed high-water row is missing".to_string(),
            })?;
        let trailing = rows_to_events(vec![trailing])?
            .pop()
            .expect("one trailing row was supplied");
        if state.high_water_event_id.as_deref() != Some(trailing.event.event_id.as_str()) {
            return Err(EventBusError::StreamInvariant {
                high_water_seq: state.high_water_seq,
                max_seq,
                row_count,
                message: "high-water identity does not match the trailing event".to_string(),
            });
        }
        Ok(state)
    }

    fn validate_consumer_cursor(
        db: &Database,
        consumer_id: &str,
        ack_seq: i64,
        ack_event_id: Option<&str>,
        stream: &StreamState,
    ) -> Result<(), EventBusError> {
        let corrupt = |message: &str| EventBusError::ConsumerCursorCorrupt {
            consumer_id: consumer_id.to_string(),
            ack_seq,
            ack_event_id: ack_event_id.map(str::to_string),
            message: message.to_string(),
        };
        if ack_seq < 0 || ack_seq > stream.high_water_seq {
            return Err(corrupt(
                "ACK cursor is outside the committed stream frontier",
            ));
        }
        if ack_seq == 0 {
            return if ack_event_id.is_none() {
                Ok(())
            } else {
                Err(corrupt("zero ACK cursor must not carry an event identity"))
            };
        }
        let expected = db
            .conn()
            .query_row(
                "SELECT seq, event_id, kind, channel, payload_json
                 FROM agent_events WHERE seq = ?1",
                [ack_seq],
                map_row,
            )
            .optional()
            .map_err(|error| EventBusError::QueryFailed {
                operation: "validate_consumer_cursor".to_string(),
                message: error.to_string(),
            })?
            .ok_or_else(|| corrupt("ACK cursor event row is missing"))?;
        let expected = rows_to_events(vec![expected])?
            .pop()
            .expect("one cursor row was supplied");
        if ack_event_id != Some(expected.event.event_id.as_str()) {
            return Err(corrupt(
                "ACK cursor identity does not match its committed event row",
            ));
        }
        Ok(())
    }
}

type RawRow = (i64, String, String, String, String);

fn first_missing_seq(
    conn: &rusqlite::Connection,
    high_water_seq: i64,
) -> Result<i64, EventBusError> {
    if high_water_seq <= 0 {
        return Ok(1);
    }
    let has_first = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_events WHERE seq = 1)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| EventBusError::QueryFailed {
            operation: "find_first_stream_gap".to_string(),
            message: error.to_string(),
        })?;
    if !has_first {
        return Ok(1);
    }
    conn.query_row(
        "SELECT MIN(current.seq + 1)
         FROM agent_events current
         WHERE current.seq < ?1
           AND NOT EXISTS (
               SELECT 1 FROM agent_events next WHERE next.seq = current.seq + 1
           )",
        [high_water_seq],
        |row| row.get::<_, Option<i64>>(0),
    )
    .map_err(|error| EventBusError::QueryFailed {
        operation: "find_first_stream_gap".to_string(),
        message: error.to_string(),
    })?
    .or_else(|| {
        let max_seq = conn
            .query_row("SELECT MAX(seq) FROM agent_events", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .ok()
            .flatten()
            .unwrap_or(0);
        (max_seq < high_water_seq).then_some(max_seq.saturating_add(1))
    })
    .ok_or_else(|| EventBusError::StreamInvariant {
        high_water_seq,
        max_seq: None,
        row_count: -1,
        message: "row count indicates a gap but no missing sequence was located".to_string(),
    })
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

fn rows_to_events(raws: Vec<RawRow>) -> Result<Vec<SeqEvent>, EventBusError> {
    raws.into_iter()
        .map(|(seq, event_id, kind, channel, payload_json)| {
            if event_id.trim().is_empty() {
                return Err(EventBusError::CorruptRow {
                    seq,
                    field: "event_id".to_string(),
                    message: "empty identity".to_string(),
                });
            }
            let kind =
                AgentEventKind::from_str(&kind).map_err(|message| EventBusError::CorruptRow {
                    seq,
                    field: "kind".to_string(),
                    message,
                })?;
            let channel =
                EventChannel::from_str(&channel).map_err(|message| EventBusError::CorruptRow {
                    seq,
                    field: "channel".to_string(),
                    message,
                })?;
            let payload =
                serde_json::from_str(&payload_json).map_err(|error| EventBusError::CorruptRow {
                    seq,
                    field: "payload_json".to_string(),
                    message: error.to_string(),
                })?;
            Ok(SeqEvent {
                seq,
                event: AgentEvent {
                    event_id,
                    kind,
                    channel,
                    payload,
                },
            })
        })
        .collect()
}

fn validate_consumer_id(consumer_id: &str) -> Result<(), EventBusError> {
    let trimmed = consumer_id.trim();
    if trimmed.is_empty() || trimmed.len() > 256 {
        Err(EventBusError::InvalidConsumerIdentity)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(kind: AgentEventKind, payload: serde_json::Value) -> AgentEvent {
        AgentEvent::new(kind, payload)
    }

    #[test]
    fn append_is_idempotent_by_identity_and_rejects_identity_reuse() {
        let db = Database::open_memory().unwrap();
        let event =
            ev(AgentEventKind::TaskCreated, json!({"id": "a"})).with_idempotency_key("event-a");
        let (first, inserted) = EventRepo::append(&db, &event).unwrap();
        assert!(inserted);
        let (duplicate, inserted) = EventRepo::append(&db, &event).unwrap();
        assert_eq!(duplicate, first);
        assert!(!inserted);
        let conflict =
            ev(AgentEventKind::TaskCompleted, json!({"id": "a"})).with_idempotency_key("event-a");
        assert!(matches!(
            EventRepo::append(&db, &conflict),
            Err(EventBusError::AppendFailed { .. })
        ));
    }

    #[test]
    fn corrupt_row_fails_closed_instead_of_skipping() {
        let db = Database::open_memory().unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!({"id": "a"}))).unwrap();
        db.conn()
            .execute(
                "INSERT INTO agent_events (event_id, kind, channel, payload_json)
                 VALUES ('corrupt', 'mystery_kind', 'system', 'null')",
                [],
            )
            .unwrap();
        let valid_after_corruption =
            ev(AgentEventKind::TaskCompleted, json!({"id": "a"})).with_idempotency_key("valid-3");
        EventRepo::append(&db, &valid_after_corruption).unwrap();
        assert!(matches!(
            EventRepo::since(&db, 0, 100),
            Err(EventBusError::CorruptRow { seq: 2, .. })
        ));
        assert!(matches!(
            EventRepo::ack(&db, "worker-a", 3, "valid-3"),
            Err(EventBusError::CorruptRow { seq: 2, .. })
        ));
    }

    #[test]
    fn corrupt_or_deleted_trailing_row_never_returns_empty_complete() {
        let db = Database::open_memory().unwrap();
        let first =
            ev(AgentEventKind::TaskCreated, json!({"id": "a"})).with_idempotency_key("first");
        let second =
            ev(AgentEventKind::TaskCompleted, json!({"id": "a"})).with_idempotency_key("second");
        EventRepo::append(&db, &first).unwrap();
        EventRepo::append(&db, &second).unwrap();

        db.conn()
            .execute("DROP TRIGGER trg_agent_events_immutable", [])
            .unwrap();
        db.conn()
            .execute(
                "UPDATE agent_events SET payload_json = '{' WHERE seq = 2",
                [],
            )
            .unwrap();
        assert!(matches!(
            EventRepo::since(&db, 2, 10),
            Err(EventBusError::CorruptRow { seq: 2, .. })
        ));

        db.conn()
            .execute("DROP TRIGGER trg_agent_events_no_delete", [])
            .unwrap();
        db.conn()
            .execute("DELETE FROM agent_events WHERE seq = 2", [])
            .unwrap();
        assert_eq!(
            EventRepo::since(&db, 1, 10).unwrap_err(),
            EventBusError::Gap {
                expected_seq: 2,
                observed_seq: 3,
            }
        );
    }

    #[test]
    fn future_and_identity_corrupt_consumer_cursors_fail_closed() {
        let db = Database::open_memory().unwrap();
        let event =
            ev(AgentEventKind::TaskCreated, json!({"id": "a"})).with_idempotency_key("event-1");
        EventRepo::append(&db, &event).unwrap();
        db.conn()
            .execute("DROP TRIGGER trg_event_consumer_cursor_insert_valid", [])
            .unwrap();
        db.conn()
            .execute(
                "INSERT INTO event_consumer_cursors
                    (consumer_id, ack_seq, ack_event_id)
                 VALUES ('future', 2, 'event-1')",
                [],
            )
            .unwrap();
        assert!(matches!(
            EventRepo::poll_consumer(&db, "future", 10),
            Err(EventBusError::ConsumerCursorCorrupt { ack_seq: 2, .. })
        ));

        db.conn()
            .execute(
                "INSERT INTO event_consumer_cursors
                    (consumer_id, ack_seq, ack_event_id)
                 VALUES ('identity-mismatch', 1, 'wrong-event')",
                [],
            )
            .unwrap();
        assert!(matches!(
            EventRepo::poll_consumer(&db, "identity-mismatch", 10),
            Err(EventBusError::ConsumerCursorCorrupt { ack_seq: 1, .. })
        ));
    }

    #[test]
    fn cursor_bound_event_identity_corruption_fails_closed() {
        let db = Database::open_memory().unwrap();
        let event =
            ev(AgentEventKind::TaskCreated, json!({"id": "a"})).with_idempotency_key("event-1");
        EventRepo::append(&db, &event).unwrap();
        EventRepo::poll_consumer(&db, "worker-a", 10).unwrap();
        EventRepo::ack(&db, "worker-a", 1, "event-1").unwrap();

        db.conn()
            .execute("DROP TRIGGER trg_agent_events_immutable", [])
            .unwrap();
        db.conn()
            .execute(
                "UPDATE agent_events SET event_id = 'corrupted-event' WHERE seq = 1",
                [],
            )
            .unwrap();
        assert!(matches!(
            EventRepo::poll_consumer(&db, "worker-a", 10),
            Err(EventBusError::StreamInvariant {
                high_water_seq: 1,
                ..
            })
        ));
    }

    #[test]
    fn consumer_crash_before_and_after_ack_has_at_least_once_truth() {
        let db = Database::open_memory().unwrap();
        let event = ev(AgentEventKind::TaskCreated, json!({"id": "a"}));
        EventRepo::append(&db, &event).unwrap();

        let first = EventRepo::poll_consumer(&db, "worker-a", 100).unwrap();
        let duplicate_after_crash = EventRepo::poll_consumer(&db, "worker-a", 100).unwrap();
        assert_eq!(duplicate_after_crash.events, first.events);

        let delivered = &first.events[0];
        let ack =
            EventRepo::ack(&db, "worker-a", delivered.seq, &delivered.event.event_id).unwrap();
        assert!(!ack.already_acked);
        let duplicate_ack =
            EventRepo::ack(&db, "worker-a", delivered.seq, &delivered.event.event_id).unwrap();
        assert!(duplicate_ack.already_acked);
        assert!(EventRepo::poll_consumer(&db, "worker-a", 100)
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn gap_is_typed_and_never_an_apparently_complete_batch() {
        let db = Database::open_memory().unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!(null))).unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCompleted, json!(null))).unwrap();
        db.conn()
            .execute("DROP TRIGGER trg_agent_events_no_delete", [])
            .unwrap();
        db.conn()
            .execute("DELETE FROM agent_events WHERE seq = 1", [])
            .unwrap();
        assert_eq!(
            EventRepo::since(&db, 0, 100).unwrap_err(),
            EventBusError::Gap {
                expected_seq: 1,
                observed_seq: 2
            }
        );
    }
}
