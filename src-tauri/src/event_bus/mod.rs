//! Event Bus — the typed event taxonomy the fleet coordinates over.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 5. Named channels carry a fixed event taxonomy. The transport
//! is **star-backed** (the loop controller publishes; agents subscribe via the
//! controller — no peer-to-peer), so this module is the pure taxonomy +
//! routing + a bounded recent-event log; the controller's Tauri-emit wiring
//! turns a published event into a fleet broadcast.

pub mod manager;

pub use manager::EventBus;

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::str::FromStr;

/// Named coordination channels (rendered with a leading `#` in UIs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventChannel {
    Planning,
    Backend,
    Frontend,
    Database,
    Review,
    System,
}

pub const EVENT_CHANNELS: [EventChannel; 6] = [
    EventChannel::Planning,
    EventChannel::Backend,
    EventChannel::Frontend,
    EventChannel::Database,
    EventChannel::Review,
    EventChannel::System,
];

impl EventChannel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Planning => "planning",
            Self::Backend => "backend",
            Self::Frontend => "frontend",
            Self::Database => "database",
            Self::Review => "review",
            Self::System => "system",
        }
    }
}

impl FromStr for EventChannel {
    type Err = String;

    /// Parse a persisted channel name (inverse of `as_str`, round-trip tested).
    fn from_str(value: &str) -> Result<Self, String> {
        Ok(match value {
            "planning" => Self::Planning,
            "backend" => Self::Backend,
            "frontend" => Self::Frontend,
            "database" => Self::Database,
            "review" => Self::Review,
            "system" => Self::System,
            other => return Err(format!("unknown event channel: {other}")),
        })
    }
}

/// The fixed event taxonomy. Extend deliberately (each new kind needs a
/// `default_channel` mapping).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentEventKind {
    TaskCreated,
    TaskCompleted,
    DecisionChanged,
    ReviewRequired,
    AgentSpawned,
    WorktreeCreated,
    /// An agent claimed a file/path lane (dispatch) — peers should avoid it.
    FileLocked,
    /// An agent released its file/path lane (task merged) — now free to claim.
    FileReleased,
    /// An agent reported what it is doing right now (file/symbol/action) — the
    /// real-time fleet awareness signal peers coordinate over.
    AgentActivity,
    /// An agent declared an intent (a proposal shared before acting) on the
    /// Intent Bus — the pre-fact signal peers react to.
    IntentDeclared,
    /// An agent is stuck (the "what am I blocked on" channel) — surfaced so a
    /// peer or the orchestrator can unblock it rather than it stalling silently.
    BlockerRaised,
    /// A TYPED steer told an agent to AVOID specific symbols another agent owns in
    /// its files (§6.4) — derived from the live ownership map, not raw pane text, so
    /// the directive is auditable and the agent (or operator) can act on structured data.
    SteerAvoid,
    /// The loop gave up on a task (a retry budget — crash/rework/timeout — was
    /// exhausted, leaving it `Failed`). Pushed to the supervisor/reviewer with
    /// the failure policy's recommended action so a Failed task is never left
    /// silently — the auto-escalation that keeps the loop unattended-safe.
    EscalationRaised,
}

impl AgentEventKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TaskCreated => "task_created",
            Self::TaskCompleted => "task_completed",
            Self::DecisionChanged => "decision_changed",
            Self::ReviewRequired => "review_required",
            Self::AgentSpawned => "agent_spawned",
            Self::WorktreeCreated => "worktree_created",
            Self::FileLocked => "file_locked",
            Self::FileReleased => "file_released",
            Self::AgentActivity => "agent_activity",
            Self::IntentDeclared => "intent_declared",
            Self::BlockerRaised => "blocker_raised",
            Self::SteerAvoid => "steer_avoid",
            Self::EscalationRaised => "escalation_raised",
        }
    }

    /// The channel an event of this kind is published to unless overridden.
    pub const fn default_channel(self) -> EventChannel {
        match self {
            Self::TaskCreated | Self::TaskCompleted => EventChannel::Planning,
            // Review verdicts and escalations both demand reviewer/supervisor
            // attention — they land on the review channel.
            Self::ReviewRequired | Self::EscalationRaised => EventChannel::Review,
            // Decision changes are project-wide, agent/worktree lifecycle is
            // infra, and file lane claims are fleet-wide coordination — all land
            // on the fleet-wide system channel.
            Self::DecisionChanged
            | Self::AgentSpawned
            | Self::WorktreeCreated
            | Self::FileLocked
            | Self::FileReleased
            | Self::AgentActivity
            | Self::BlockerRaised
            | Self::SteerAvoid => EventChannel::System,
            // Proposals are deliberation — they belong on the planning channel.
            Self::IntentDeclared => EventChannel::Planning,
        }
    }
}

impl FromStr for AgentEventKind {
    type Err = String;

    /// Parse a persisted kind name (inverse of `as_str`, round-trip tested).
    fn from_str(value: &str) -> Result<Self, String> {
        Ok(match value {
            "task_created" => Self::TaskCreated,
            "task_completed" => Self::TaskCompleted,
            "decision_changed" => Self::DecisionChanged,
            "review_required" => Self::ReviewRequired,
            "agent_spawned" => Self::AgentSpawned,
            "worktree_created" => Self::WorktreeCreated,
            "file_locked" => Self::FileLocked,
            "file_released" => Self::FileReleased,
            "agent_activity" => Self::AgentActivity,
            "intent_declared" => Self::IntentDeclared,
            "blocker_raised" => Self::BlockerRaised,
            "steer_avoid" => Self::SteerAvoid,
            "escalation_raised" => Self::EscalationRaised,
            other => return Err(format!("unknown event kind: {other}")),
        })
    }
}

/// A published event. `payload` is free-form JSON so each kind can carry its
/// own shape (a task id, a `DecisionChange`, a session id, ...).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentEvent {
    pub kind: AgentEventKind,
    pub channel: EventChannel,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub payload: serde_json::Value,
}

impl AgentEvent {
    /// Build an event routed to its kind's default channel.
    pub fn new(kind: AgentEventKind, payload: serde_json::Value) -> Self {
        Self {
            kind,
            channel: kind.default_channel(),
            payload,
        }
    }

    /// Build an event on an explicit channel.
    pub fn on(kind: AgentEventKind, channel: EventChannel, payload: serde_json::Value) -> Self {
        Self {
            kind,
            channel,
            payload,
        }
    }
}

/// A durably-logged event with its monotonic sequence number (P3). Subscribers
/// poll `seq > cursor` to receive every event exactly once with no loss — the
/// guarantee the bounded in-memory ring cannot make.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeqEvent {
    pub seq: i64,
    #[serde(flatten)]
    pub event: AgentEvent,
}

/// Bounded in-memory log of recent events — backs the cockpit event feed and
/// keeps publish/observe testable without a transport. `cap == 0` is unbounded.
#[derive(Debug)]
pub struct EventLog {
    events: VecDeque<AgentEvent>,
    cap: usize,
}

impl Default for EventLog {
    fn default() -> Self {
        Self::with_capacity(256)
    }
}

impl EventLog {
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            events: VecDeque::new(),
            cap,
        }
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Append an event, evicting the oldest if the capacity is exceeded.
    pub fn publish(&mut self, event: AgentEvent) {
        self.events.push_back(event);
        if self.cap > 0 {
            while self.events.len() > self.cap {
                self.events.pop_front();
            }
        }
    }

    /// Recent events, oldest first.
    pub fn recent(&self) -> Vec<&AgentEvent> {
        self.events.iter().collect()
    }

    pub fn by_channel(&self, channel: EventChannel) -> Vec<&AgentEvent> {
        self.events
            .iter()
            .filter(|event| event.channel == channel)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::str::FromStr;

    #[test]
    fn new_routes_to_default_channel() {
        assert_eq!(
            AgentEvent::new(AgentEventKind::TaskCreated, json!({"id": "t1"})).channel,
            EventChannel::Planning
        );
        assert_eq!(
            AgentEvent::new(AgentEventKind::ReviewRequired, json!(null)).channel,
            EventChannel::Review
        );
        assert_eq!(
            AgentEvent::new(AgentEventKind::DecisionChanged, json!(null)).channel,
            EventChannel::System
        );
    }

    #[test]
    fn on_overrides_channel() {
        let event = AgentEvent::on(
            AgentEventKind::TaskCreated,
            EventChannel::Backend,
            json!(null),
        );
        assert_eq!(event.channel, EventChannel::Backend);
    }

    #[test]
    fn serializes_kind_and_channel_snake_case() {
        let event = AgentEvent::new(AgentEventKind::WorktreeCreated, json!({"branch": "feat/x"}));
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["kind"], "worktree_created");
        assert_eq!(value["channel"], "system");
        assert_eq!(value["payload"]["branch"], "feat/x");
    }

    #[test]
    fn null_payload_is_omitted() {
        let event = AgentEvent::new(AgentEventKind::AgentSpawned, json!(null));
        let value = serde_json::to_value(&event).unwrap();
        assert!(value.get("payload").is_none());
    }

    #[test]
    fn log_keeps_publish_order() {
        let mut log = EventLog::with_capacity(8);
        log.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "a"}),
        ));
        log.publish(AgentEvent::new(
            AgentEventKind::TaskCompleted,
            json!({"id": "a"}),
        ));
        let kinds: Vec<AgentEventKind> = log.recent().iter().map(|e| e.kind).collect();
        assert_eq!(
            kinds,
            [AgentEventKind::TaskCreated, AgentEventKind::TaskCompleted]
        );
    }

    #[test]
    fn log_evicts_oldest_over_capacity() {
        let mut log = EventLog::with_capacity(2);
        for id in ["a", "b", "c"] {
            log.publish(AgentEvent::new(
                AgentEventKind::TaskCreated,
                json!({ "id": id }),
            ));
        }
        assert_eq!(log.len(), 2);
        let ids: Vec<&str> = log
            .recent()
            .iter()
            .map(|e| e.payload["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["b", "c"]); // "a" evicted
    }

    #[test]
    fn by_channel_filters() {
        let mut log = EventLog::default();
        log.publish(AgentEvent::new(AgentEventKind::TaskCreated, json!(null))); // planning
        log.publish(AgentEvent::new(AgentEventKind::ReviewRequired, json!(null))); // review
        log.publish(AgentEvent::new(AgentEventKind::TaskCompleted, json!(null))); // planning
        assert_eq!(log.by_channel(EventChannel::Planning).len(), 2);
        assert_eq!(log.by_channel(EventChannel::Review).len(), 1);
        assert_eq!(log.by_channel(EventChannel::Backend).len(), 0);
    }

    #[test]
    fn all_channels_are_covered_by_some_kind_or_explicit() {
        // Sanity: every kind maps to a known channel.
        for kind in [
            AgentEventKind::TaskCreated,
            AgentEventKind::TaskCompleted,
            AgentEventKind::DecisionChanged,
            AgentEventKind::ReviewRequired,
            AgentEventKind::AgentSpawned,
            AgentEventKind::WorktreeCreated,
        ] {
            assert!(EVENT_CHANNELS.contains(&kind.default_channel()));
        }
    }

    #[test]
    fn channel_as_str_from_str_round_trips_all_variants() {
        for ch in EVENT_CHANNELS {
            assert_eq!(EventChannel::from_str(ch.as_str()).unwrap(), ch);
        }
        assert!(EventChannel::from_str("nope").is_err());
    }

    #[test]
    fn kind_as_str_from_str_round_trips_all_variants() {
        let all = [
            AgentEventKind::TaskCreated,
            AgentEventKind::TaskCompleted,
            AgentEventKind::DecisionChanged,
            AgentEventKind::ReviewRequired,
            AgentEventKind::AgentSpawned,
            AgentEventKind::WorktreeCreated,
            AgentEventKind::FileLocked,
            AgentEventKind::FileReleased,
            AgentEventKind::AgentActivity,
            AgentEventKind::IntentDeclared,
            AgentEventKind::BlockerRaised,
            AgentEventKind::EscalationRaised,
        ];
        for kind in all {
            // as_str agrees with serde, and from_str inverts it.
            assert_eq!(
                serde_json::to_value(kind).unwrap().as_str(),
                Some(kind.as_str())
            );
            assert_eq!(AgentEventKind::from_str(kind.as_str()).unwrap(), kind);
        }
        assert!(AgentEventKind::from_str("unknown").is_err());
    }
}
