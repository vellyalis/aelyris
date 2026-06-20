//! `EventRepo` — durable, append-only coordination event log (Runtime Hardening
//! P3 / Binding Requirement 5: no-loss notifications).
//!
//! The in-memory Event Bus ring (cap 256) silently evicts old events, so a slow
//! poller or a restart loses notifications. This log keeps EVERY event with a
//! monotonic `seq` (SQLite AUTOINCREMENT), so a subscriber polls `seq > cursor`
//! and is guaranteed to see each event exactly once with no gaps. Lightweight on
//! purpose (kind/channel/payload only) — distinct from the heavier audit journal
//! (hashing/redaction/correlation), which serves compliance, not coordination.

use std::str::FromStr;

use rusqlite::params;

use crate::db::Database;
use crate::event_bus::{AgentEvent, AgentEventKind, EventChannel, SeqEvent};

pub struct EventRepo;

impl EventRepo {
    /// Append an event; returns its assigned monotonic `seq`.
    pub fn append(db: &Database, event: &AgentEvent) -> Result<i64, String> {
        let payload = serde_json::to_string(&event.payload)
            .map_err(|e| format!("Serialize event payload: {e}"))?;
        let conn = db.conn();
        conn.execute(
            "INSERT INTO agent_events (kind, channel, payload_json) VALUES (?1, ?2, ?3)",
            params![event.kind.as_str(), event.channel.as_str(), payload],
        )
        .map_err(|e| format!("Append event: {e}"))?;
        Ok(conn.last_insert_rowid())
    }

    /// Every event with `seq > after_seq`, oldest first, up to `limit`. Poll with
    /// `after_seq = 0` for the start, then advance the cursor to the last `seq`
    /// returned — no event is ever skipped (no-loss).
    pub fn since(db: &Database, after_seq: i64, limit: usize) -> Result<Vec<SeqEvent>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT seq, kind, channel, payload_json FROM agent_events
                 WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
            )
            .map_err(|e| format!("Prepare since: {e}"))?;
        let raws = stmt
            .query_map(params![after_seq, limit as i64], map_row)
            .map_err(|e| format!("Query events: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Read event rows: {e}"))?;
        Ok(rows_to_events(raws))
    }

    /// Like [`since`] but restricted to one channel.
    pub fn by_channel_since(
        db: &Database,
        channel: EventChannel,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<SeqEvent>, String> {
        let conn = db.conn();
        let mut stmt = conn
            .prepare(
                "SELECT seq, kind, channel, payload_json FROM agent_events
                 WHERE channel = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3",
            )
            .map_err(|e| format!("Prepare by_channel_since: {e}"))?;
        let raws = stmt
            .query_map(params![channel.as_str(), after_seq, limit as i64], map_row)
            .map_err(|e| format!("Query events: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Read event rows: {e}"))?;
        Ok(rows_to_events(raws))
    }
}

type RawRow = (i64, String, String, String);

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRow> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

/// Parse rows into events, SKIPPING (not failing on) any single unparseable row.
/// A partially-corrupt or legacy row — an unknown kind/channel, bad payload —
/// must not blind every subscriber by collapsing the whole `since` result to
/// empty. Bad rows are logged loudly and dropped; the rest still flow.
fn rows_to_events(raws: Vec<RawRow>) -> Vec<SeqEvent> {
    let mut out = Vec::with_capacity(raws.len());
    for (seq, kind, channel, payload_json) in raws {
        let Ok(kind) = AgentEventKind::from_str(&kind) else {
            tracing::warn!(seq, kind = %kind, "skipping event row with unknown kind");
            continue;
        };
        let Ok(channel) = EventChannel::from_str(&channel) else {
            tracing::warn!(seq, channel = %channel, "skipping event row with unknown channel");
            continue;
        };
        let payload = match serde_json::from_str(&payload_json) {
            Ok(payload) => payload,
            Err(e) => {
                tracing::warn!(seq, error = %e, "skipping event row with unparseable payload");
                continue;
            }
        };
        out.push(SeqEvent {
            seq,
            event: AgentEvent {
                kind,
                channel,
                payload,
            },
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(kind: AgentEventKind, payload: serde_json::Value) -> AgentEvent {
        AgentEvent::new(kind, payload)
    }

    #[test]
    fn append_assigns_monotonic_seq() {
        let db = Database::open_memory().unwrap();
        let s1 =
            EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!({"id": "a"}))).unwrap();
        let s2 =
            EventRepo::append(&db, &ev(AgentEventKind::TaskCompleted, json!({"id": "a"}))).unwrap();
        assert!(s2 > s1);
    }

    #[test]
    fn since_returns_only_newer_events_in_order_and_round_trips() {
        let db = Database::open_memory().unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!({"id": "a"}))).unwrap();
        let cursor =
            EventRepo::append(&db, &ev(AgentEventKind::ReviewRequired, json!(null))).unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCompleted, json!({"id": "a"}))).unwrap();

        // Everything after the second event = just the third.
        let after = EventRepo::since(&db, cursor, 100).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].event.kind, AgentEventKind::TaskCompleted);
        assert_eq!(after[0].event.payload["id"], "a");
        assert!(after[0].seq > cursor);

        // From the start: all three, oldest first.
        let all = EventRepo::since(&db, 0, 100).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].event.kind, AgentEventKind::TaskCreated);
    }

    #[test]
    fn no_loss_beyond_the_old_ring_cap() {
        // 300 events > the 256 ring cap: the durable log keeps them ALL, and a
        // cursor walk visits every one with no gap.
        let db = Database::open_memory().unwrap();
        for i in 0..300 {
            EventRepo::append(&db, &ev(AgentEventKind::AgentActivity, json!({ "i": i }))).unwrap();
        }
        let mut cursor = 0;
        let mut seen = 0;
        loop {
            let batch = EventRepo::since(&db, cursor, 64).unwrap();
            if batch.is_empty() {
                break;
            }
            // Contiguous, strictly increasing seq — no skips.
            for e in &batch {
                assert!(e.seq > cursor);
                cursor = e.seq;
                seen += 1;
            }
        }
        assert_eq!(seen, 300);
    }

    #[test]
    fn since_skips_a_corrupt_row_without_blinding_the_stream() {
        let db = Database::open_memory().unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!({"id": "a"}))).unwrap();
        // A legacy/corrupt row with an unknown kind, inserted directly.
        db.conn()
            .execute(
                "INSERT INTO agent_events (kind, channel, payload_json)
                 VALUES ('mystery_kind', 'system', 'null')",
                [],
            )
            .unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCompleted, json!({"id": "a"}))).unwrap();

        // The corrupt row is skipped; both valid events still come through.
        let all = EventRepo::since(&db, 0, 100).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].event.kind, AgentEventKind::TaskCreated);
        assert_eq!(all[1].event.kind, AgentEventKind::TaskCompleted);
    }

    #[test]
    fn by_channel_since_filters() {
        let db = Database::open_memory().unwrap();
        EventRepo::append(&db, &ev(AgentEventKind::TaskCreated, json!(null))).unwrap(); // planning
        EventRepo::append(&db, &ev(AgentEventKind::ReviewRequired, json!(null))).unwrap(); // review
        EventRepo::append(&db, &ev(AgentEventKind::TaskCompleted, json!(null))).unwrap(); // planning
        let planning = EventRepo::by_channel_since(&db, EventChannel::Planning, 0, 100).unwrap();
        assert_eq!(planning.len(), 2);
        let review = EventRepo::by_channel_since(&db, EventChannel::Review, 0, 100).unwrap();
        assert_eq!(review.len(), 1);
    }
}
