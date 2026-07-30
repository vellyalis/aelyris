use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::event_bus::{AgentEvent, AgentEventKind, EventBus, EventChannel};

/// Live fleet event stream the cockpit feed subscribes to (BR5).
const AGENT_EVENT: &str = "agent-event";

pub(crate) const AGENT_SESSIONS_UPDATED_EVENT: &str = "agent-sessions-updated";
pub(crate) const AGENT_FLEET_UPDATED_EVENT: &str = "agent-fleet-updated";

pub(crate) fn terminal_output_event(terminal_id: &str) -> String {
    format!("pty-output-{terminal_id}")
}

pub(crate) fn terminal_exit_event(terminal_id: &str) -> String {
    format!("pty-exit-{terminal_id}")
}

pub(crate) fn terminal_diff_event(terminal_id: &str) -> String {
    format!("term:diff-{terminal_id}")
}

pub(crate) fn terminal_prompt_mark_event(terminal_id: &str) -> String {
    format!("term:prompt-mark-{terminal_id}")
}

pub(crate) fn terminal_lag_event(terminal_id: &str) -> String {
    format!("term:lag-{terminal_id}")
}

pub(crate) fn snapshot_captured_event(terminal_id: &str) -> String {
    format!("snapshot:captured-{terminal_id}")
}

pub(crate) fn agent_output_event(session_id: &str) -> String {
    format!("agent-output-{session_id}")
}

pub(crate) fn watchdog_decision_event(session_id: &str) -> String {
    format!("watchdog-decision-{session_id}")
}

pub(crate) fn agent_exit_event(session_id: &str) -> String {
    format!("agent-exit-{session_id}")
}

pub(crate) fn chat_stream_event(conversation_id: &str) -> String {
    format!("chat-stream-{conversation_id}")
}

pub(crate) fn chat_session_id_event(conversation_id: &str) -> String {
    format!("chat-session-id-{conversation_id}")
}

pub(crate) fn chat_complete_event(conversation_id: &str) -> String {
    format!("chat-complete-{conversation_id}")
}

/// Append an event to the bus log and re-emit it over the `agent-event` Tauri
/// stream so the cockpit feed updates live. Shared by the explicit
/// `event_publish` command and the subsystem auto-publishers (task/context
/// commands) so the wire event name lives in exactly one place.
pub(crate) fn publish_and_emit(
    app: &AppHandle,
    bus: &EventBus,
    event: AgentEvent,
) -> Result<(), String> {
    bus.publish(event.clone())
        .map_err(|error| error.to_string())?;
    let _ = app.emit(AGENT_EVENT, &event);
    Ok(())
}

/// Publish a typed event: append it to the bus log and re-emit it over Tauri
/// so the frontend feed updates live. Routes to the kind's default channel
/// unless `channel` overrides it. Returns the published event.
#[tauri::command]
pub fn event_publish(
    app: AppHandle,
    bus: State<'_, Arc<EventBus>>,
    kind: AgentEventKind,
    channel: Option<EventChannel>,
    payload: serde_json::Value,
) -> Result<AgentEvent, String> {
    let event = match channel {
        Some(channel) => AgentEvent::on(kind, channel, payload),
        None => AgentEvent::new(kind, payload),
    };
    publish_and_emit(&app, &bus, event.clone())?;
    Ok(event)
}

/// Recent events, oldest first (cockpit feed hydration).
#[tauri::command]
pub fn event_recent(bus: State<'_, Arc<EventBus>>) -> Vec<AgentEvent> {
    bus.recent()
}

/// Recent events on a single channel.
#[tauri::command]
pub fn event_by_channel(bus: State<'_, Arc<EventBus>>, channel: EventChannel) -> Vec<AgentEvent> {
    bus.by_channel(channel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_event_names_match_the_frontend_registry_contract() {
        assert_eq!(AGENT_SESSIONS_UPDATED_EVENT, "agent-sessions-updated");
        assert_eq!(AGENT_FLEET_UPDATED_EVENT, "agent-fleet-updated");
        assert_eq!(terminal_output_event("term-1"), "pty-output-term-1");
        assert_eq!(terminal_exit_event("term-1"), "pty-exit-term-1");
        assert_eq!(terminal_diff_event("term-1"), "term:diff-term-1");
        assert_eq!(
            terminal_prompt_mark_event("term-1"),
            "term:prompt-mark-term-1"
        );
        assert_eq!(terminal_lag_event("term-1"), "term:lag-term-1");
        assert_eq!(
            snapshot_captured_event("term-1"),
            "snapshot:captured-term-1"
        );
        assert_eq!(agent_output_event("agent-1"), "agent-output-agent-1");
        assert_eq!(
            watchdog_decision_event("agent-1"),
            "watchdog-decision-agent-1"
        );
        assert_eq!(agent_exit_event("agent-1"), "agent-exit-agent-1");
        assert_eq!(chat_stream_event("chat-1"), "chat-stream-chat-1");
        assert_eq!(chat_session_id_event("chat-1"), "chat-session-id-chat-1");
        assert_eq!(chat_complete_event("chat-1"), "chat-complete-chat-1");
    }
}
