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
        }
    }

    /// The channel an event of this kind is published to unless overridden.
    pub const fn default_channel(self) -> EventChannel {
        match self {
            Self::TaskCreated | Self::TaskCompleted => EventChannel::Planning,
            Self::ReviewRequired => EventChannel::Review,
            // Decision changes are project-wide and agent/worktree lifecycle is
            // infra — both land on the fleet-wide system channel.
            Self::DecisionChanged | Self::AgentSpawned | Self::WorktreeCreated => {
                EventChannel::System
            }
        }
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
}
