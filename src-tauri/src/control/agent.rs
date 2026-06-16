use crate::agent::router::{AgentRouter, RoutingDecision};
use crate::agent::{AgentManager, AgentSession};
use crate::control::ControlResult;

#[derive(Debug, Clone)]
pub struct HeadlessSpawnSpec {
    pub prompt: String,
    pub cwd: String,
    pub model: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub resume_id: Option<String>,
}

pub fn route(prompt: &str, budget_remaining: Option<f64>) -> RoutingDecision {
    AgentRouter::route(prompt, budget_remaining)
}

pub fn list_headless(manager: &AgentManager) -> Vec<AgentSession> {
    manager
        .list_sessions()
        .into_iter()
        .map(AgentSession::from)
        .collect()
}

pub fn start_headless(manager: &AgentManager, spec: HeadlessSpawnSpec) -> ControlResult<String> {
    let id = manager.start_session(
        &spec.prompt,
        &spec.cwd,
        spec.model.as_deref(),
        spec.allowed_tools,
        spec.resume_id.as_deref(),
    )?;
    drain_session_output(manager, &id);
    Ok(id)
}

/// Drain a headless agent's stdout/stderr in the background so its OS pipe
/// buffer never fills and blocks the process — without this an unmonitored
/// `claude -p` would deadlock before it could exit, and the autonomy loop's
/// completion sensor (`AgentManager::reap_finished`) would never fire. The
/// output is not parsed here; the orchestrator reviews the worktree diff, not
/// the stream.
fn drain_session_output(manager: &AgentManager, id: &str) {
    if let Ok(mut stdout) = manager.take_stdout(id) {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut stdout, &mut std::io::sink());
        });
    }
    if let Ok(mut stderr) = manager.take_stderr(id) {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        });
    }
}

pub fn stop_headless(manager: &AgentManager, id: &str) -> ControlResult<()> {
    manager.stop_session(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_matches_agent_router() {
        let via_control = route("Review this branch for risky changes", Some(1.0));
        let direct = AgentRouter::route("Review this branch for risky changes", Some(1.0));
        assert_eq!(via_control.recommended_model, direct.recommended_model);
        assert_eq!(via_control.task_type, direct.task_type);
        assert_eq!(via_control.complexity, direct.complexity);
    }
}
