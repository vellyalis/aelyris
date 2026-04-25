//! Structured logging pipeline (Tier 🟡 #7).
//!
//! Replaces the `env_logger` setup with `tracing` so every event flows
//! through three sinks at once:
//!
//! 1. **stderr**, JSON formatted, for log shippers / dev console.
//! 2. **`log::*` adapter**, so the 75 existing `log::info!` /
//!    `log::warn!` / `log::error!` call sites keep working without
//!    being touched in this commit.
//! 3. **In-memory ring buffer**, capped at 1 024 entries, used by the
//!    in-app log viewer panel (`logs_recent` IPC).
//!
//! The ring buffer is intentionally bounded — we never want a hot loop
//! of `log::warn!` to grow the buffer until the process OOMs. The cap
//! is enforced on every push and the oldest entry is dropped first.
//!
//! `init` is idempotent for tests: subsequent calls install a fresh
//! buffer and skip the global subscriber registration. Production hits
//! the slow path exactly once.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use serde::Deserialize;
use serde::Serialize;
use tracing::Event;
use tracing::Level;
use tracing::Subscriber;
use tracing::field::Field;
use tracing::field::Visit;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context;

/// Maximum number of events retained in the ring buffer. Sized so the
/// buffer's worst-case footprint (`limit × ~1 KiB per entry`) stays
/// well below 2 MiB — enough headroom for ten minutes of moderate
/// agent traffic without bloating RSS.
pub const RING_LIMIT: usize = 1024;

/// One ring buffer entry. Mirrored to TS (`shared/types/logs.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    /// Monotonic counter. Survives across calls so the frontend can
    /// fetch deltas via `logs_since(after_seq)` without dropping
    /// entries when polling slips.
    pub seq: u64,
    /// Wall clock at emit time, milliseconds since UNIX epoch.
    pub timestamp_ms: u64,
    /// Uppercase: "TRACE", "DEBUG", "INFO", "WARN", "ERROR".
    pub level: String,
    /// `tracing::Metadata::target()` — usually the originating module
    /// path (e.g. `aether_terminal_lib::pty::manager`).
    pub target: String,
    /// The formatted log message (the `%message` field).
    pub message: String,
    /// Any extra structured fields recorded alongside the event.
    /// Stringified for transport — the frontend treats them as opaque
    /// labels.
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Default)]
struct RingInner {
    entries: VecDeque<LogEntry>,
}

impl RingInner {
    fn push(&mut self, entry: LogEntry) {
        if self.entries.len() >= RING_LIMIT {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    fn recent(&self, limit: usize) -> Vec<LogEntry> {
        let take = limit.min(self.entries.len());
        let start = self.entries.len() - take;
        self.entries.iter().skip(start).cloned().collect()
    }

    fn since(&self, after_seq: u64, limit: usize) -> Vec<LogEntry> {
        let mut out = Vec::new();
        for e in self.entries.iter() {
            if e.seq > after_seq {
                out.push(e.clone());
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }
}

/// Cheaply cloneable handle to the global ring. Cloning shares the
/// same `Mutex<RingInner>` — there is one buffer process-wide.
#[derive(Debug, Clone, Default)]
pub struct LogRing {
    inner: Arc<Mutex<RingInner>>,
    seq: Arc<AtomicU64>,
}

impl LogRing {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot the most recent `limit` entries (oldest → newest).
    pub fn recent(&self, limit: usize) -> Vec<LogEntry> {
        self.inner
            .lock()
            .map(|g| g.recent(limit))
            .unwrap_or_default()
    }

    /// Snapshot entries with `seq > after_seq`, capped at `limit`.
    /// `limit == 0` means "no cap"; we still apply a hard ceiling of
    /// `RING_LIMIT` to bound IPC payload size.
    pub fn since(&self, after_seq: u64, limit: usize) -> Vec<LogEntry> {
        let cap = if limit == 0 { RING_LIMIT } else { limit };
        self.inner
            .lock()
            .map(|g| g.since(after_seq, cap))
            .unwrap_or_default()
    }

    /// Total events ever pushed (next seq = `seq_counter + 1`).
    /// Useful for tests and as a debugging hook.
    pub fn seq_counter(&self) -> u64 {
        self.seq.load(Ordering::Relaxed)
    }

    /// Push a pre-built entry. Used by the tracing layer; tests
    /// also use it directly to populate the buffer without spinning
    /// up a subscriber.
    pub fn push_entry(
        &self,
        level: &str,
        target: &str,
        message: String,
        fields: HashMap<String, String>,
    ) {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let entry = LogEntry {
            seq,
            timestamp_ms,
            level: level.to_string(),
            target: target.to_string(),
            message,
            fields,
        };
        if let Ok(mut g) = self.inner.lock() {
            g.push(entry);
        }
    }
}

static GLOBAL_RING: OnceLock<LogRing> = OnceLock::new();

/// Process-wide handle. Created on first access; the same instance is
/// passed to the tracing layer and to the IPC commands.
pub fn ring_buffer() -> LogRing {
    GLOBAL_RING.get_or_init(LogRing::new).clone()
}

/// Tracing `Layer` that captures every event into the ring buffer. The
/// JSON stderr formatter is installed alongside it via the registry.
struct RingLayer {
    ring: LogRing,
}

struct FieldVisitor {
    message: Option<String>,
    fields: HashMap<String, String>,
}

impl FieldVisitor {
    fn new() -> Self {
        Self {
            message: None,
            fields: HashMap::new(),
        }
    }
}

impl Visit for FieldVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.message = Some(value.to_string());
        } else {
            self.fields.insert(field.name().to_string(), value.to_string());
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let formatted = format!("{value:?}");
        if field.name() == "message" {
            // Debug-formatted messages come wrapped in quotes when they
            // arrived as `&str` — strip the outer pair for readability.
            let msg = formatted
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
                .map(|s| s.to_string())
                .unwrap_or(formatted);
            self.message = Some(msg);
        } else {
            self.fields.insert(field.name().to_string(), formatted);
        }
    }
}

impl<S> Layer<S> for RingLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = match *metadata.level() {
            Level::ERROR => "ERROR",
            Level::WARN => "WARN",
            Level::INFO => "INFO",
            Level::DEBUG => "DEBUG",
            Level::TRACE => "TRACE",
        };
        let mut visitor = FieldVisitor::new();
        event.record(&mut visitor);
        let message = visitor.message.unwrap_or_default();
        self.ring
            .push_entry(level, metadata.target(), message, visitor.fields);
    }
}

/// Initialise tracing once for the process.
///
/// Wires three layers onto a `tracing_subscriber::Registry`:
///
/// - JSON stderr formatter for log shippers and dev consoles.
/// - `RingLayer` mirroring every event into the in-memory ring.
/// - `LogTracer` from `tracing-log` so the 75 pre-existing
///   `log::*!` call sites keep flowing into the same pipeline.
///
/// Subsequent calls (e.g. test setup) skip the global subscriber
/// registration — `try_init` returns `Err` once a subscriber is in
/// place, which is fine; the `LogRing` returned is still the global
/// one and continues to receive events.
pub fn init() -> LogRing {
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::fmt;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let ring = ring_buffer();

    // RUST_LOG semantics carry over from the env_logger setup.
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let json_stderr = fmt::layer()
        .with_writer(std::io::stderr)
        .json()
        .with_target(true)
        .with_current_span(false)
        .with_span_list(false);

    let ring_layer = RingLayer { ring: ring.clone() };

    let _ = tracing_subscriber::registry()
        .with(env_filter)
        .with(json_stderr)
        .with(ring_layer)
        .try_init();

    // Bridge `log::*!` calls into tracing. Safe to call repeatedly —
    // `LogTracer::init` returns `Err` after the first install, which we
    // ignore for tests.
    let _ = tracing_log::LogTracer::init();

    ring
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_ring() -> LogRing {
        LogRing::new()
    }

    #[test]
    fn ring_caps_at_limit() {
        let ring = fresh_ring();
        for i in 0..(RING_LIMIT + 50) {
            ring.push_entry(
                "INFO",
                "test",
                format!("msg-{i}"),
                HashMap::new(),
            );
        }
        let recent = ring.recent(RING_LIMIT * 2);
        assert_eq!(recent.len(), RING_LIMIT);
        // Oldest 50 dropped: first surviving message is `msg-50`.
        assert_eq!(recent.first().unwrap().message, "msg-50");
        assert_eq!(
            recent.last().unwrap().message,
            format!("msg-{}", RING_LIMIT + 49),
        );
    }

    #[test]
    fn recent_returns_oldest_to_newest_window() {
        let ring = fresh_ring();
        for i in 0..10 {
            ring.push_entry("INFO", "t", format!("m{i}"), HashMap::new());
        }
        let last3 = ring.recent(3);
        assert_eq!(
            last3.iter().map(|e| e.message.clone()).collect::<Vec<_>>(),
            vec!["m7", "m8", "m9"]
        );
    }

    #[test]
    fn recent_handles_zero_and_oversize_limits() {
        let ring = fresh_ring();
        for i in 0..5 {
            ring.push_entry("INFO", "t", format!("m{i}"), HashMap::new());
        }
        assert!(ring.recent(0).is_empty());
        assert_eq!(ring.recent(1000).len(), 5);
    }

    #[test]
    fn since_filters_strictly_after_seq() {
        let ring = fresh_ring();
        for i in 0..5 {
            ring.push_entry("INFO", "t", format!("m{i}"), HashMap::new());
        }
        // After seq 0 → all 5.
        assert_eq!(ring.since(0, 100).len(), 5);
        // After seq 3 → seq 4 + 5 only.
        let after3 = ring.since(3, 100);
        assert_eq!(after3.len(), 2);
        assert_eq!(after3[0].seq, 4);
        assert_eq!(after3[1].seq, 5);
        // Past the end → empty.
        assert!(ring.since(99, 100).is_empty());
    }

    #[test]
    fn since_caps_at_limit_argument() {
        let ring = fresh_ring();
        for i in 0..50 {
            ring.push_entry("INFO", "t", format!("m{i}"), HashMap::new());
        }
        let slice = ring.since(0, 7);
        assert_eq!(slice.len(), 7);
        assert_eq!(slice[0].seq, 1);
        assert_eq!(slice[6].seq, 7);
    }

    #[test]
    fn since_zero_limit_falls_back_to_ring_limit() {
        let ring = fresh_ring();
        for i in 0..5 {
            ring.push_entry("INFO", "t", format!("m{i}"), HashMap::new());
        }
        // limit==0 still bounded by ring contents.
        assert_eq!(ring.since(0, 0).len(), 5);
    }

    #[test]
    fn seq_counter_monotonic_across_clones() {
        let ring = fresh_ring();
        let clone = ring.clone();
        ring.push_entry("INFO", "t", "a".into(), HashMap::new());
        clone.push_entry("INFO", "t", "b".into(), HashMap::new());
        // Same buffer through both handles.
        let recent = ring.recent(10);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].message, "a");
        assert_eq!(recent[1].message, "b");
        assert_eq!(recent[0].seq + 1, recent[1].seq);
    }

    #[test]
    fn entry_carries_target_and_level() {
        let ring = fresh_ring();
        let mut fields = HashMap::new();
        fields.insert("k".into(), "v".into());
        ring.push_entry("WARN", "module::sub", "boom".into(), fields);
        let only = ring.recent(1).into_iter().next().unwrap();
        assert_eq!(only.level, "WARN");
        assert_eq!(only.target, "module::sub");
        assert_eq!(only.fields.get("k").map(String::as_str), Some("v"));
    }
}
