use std::sync::Mutex;

use super::{AgentEvent, EventChannel, EventLog};

/// Thread-safe owner of the Event Bus log, managed in Tauri state. The
/// controller/subsystems `publish`; the cockpit observes via `recent`. The
/// IPC layer also re-emits each published event over Tauri so the frontend
/// feed updates live (star-backed transport).
pub struct EventBus {
    log: Mutex<EventLog>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self {
            log: Mutex::new(EventLog::default()),
        }
    }
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

    pub fn publish(&self, event: AgentEvent) {
        self.lock().publish(event);
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
}
