use tauri::{AppHandle, Emitter, State};

use crate::event_bus::{AgentEvent, AgentEventKind, EventBus, EventChannel};

/// Live fleet event stream the cockpit feed subscribes to (BR5).
const AGENT_EVENT: &str = "agent-event";

/// Append an event to the bus log and re-emit it over the `agent-event` Tauri
/// stream so the cockpit feed updates live. Shared by the explicit
/// `event_publish` command and the subsystem auto-publishers (task/context
/// commands) so the wire event name lives in exactly one place.
pub(crate) fn publish_and_emit(app: &AppHandle, bus: &EventBus, event: AgentEvent) {
    bus.publish(event.clone());
    let _ = app.emit(AGENT_EVENT, &event);
}

/// Publish a typed event: append it to the bus log and re-emit it over Tauri
/// so the frontend feed updates live. Routes to the kind's default channel
/// unless `channel` overrides it. Returns the published event.
#[tauri::command]
pub fn event_publish(
    app: AppHandle,
    bus: State<'_, EventBus>,
    kind: AgentEventKind,
    channel: Option<EventChannel>,
    payload: serde_json::Value,
) -> AgentEvent {
    let event = match channel {
        Some(channel) => AgentEvent::on(kind, channel, payload),
        None => AgentEvent::new(kind, payload),
    };
    publish_and_emit(&app, &bus, event.clone());
    event
}

/// Recent events, oldest first (cockpit feed hydration).
#[tauri::command]
pub fn event_recent(bus: State<'_, EventBus>) -> Vec<AgentEvent> {
    bus.recent()
}

/// Recent events on a single channel.
#[tauri::command]
pub fn event_by_channel(bus: State<'_, EventBus>, channel: EventChannel) -> Vec<AgentEvent> {
    bus.by_channel(channel)
}
