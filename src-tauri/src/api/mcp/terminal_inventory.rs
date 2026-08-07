use serde::Serialize;

use crate::pty::TerminalInfo;

use super::super::ApiState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInventorySession {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    short_id: Option<u32>,
    shell_type: crate::pty::ShellType,
    uptime_secs: u64,
}

pub(super) fn project(mut sessions: Vec<TerminalInfo>) -> serde_json::Value {
    sessions.sort_by(|left, right| left.id.cmp(&right.id));
    let sessions = sessions
        .into_iter()
        .map(|session| TerminalInventorySession {
            id: session.id,
            short_id: session.short_id,
            shell_type: session.shell_type,
            uptime_secs: session.uptime_secs,
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "source": "rust-pty-manager",
        "sessionCount": sessions.len(),
        "sessions": sessions,
        "exactTerminalIdentityReturned": true,
        "filesystemPathsExposed": false,
        "processIdentityExposed": false,
        "runtimeGenerationExposed": false,
        "readOnly": true,
    })
}

pub(super) fn get(state: &ApiState) -> serde_json::Value {
    project(state.pty.list_info())
}
