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
    manager.start_session(
        &spec.prompt,
        &spec.cwd,
        spec.model.as_deref(),
        spec.allowed_tools,
        spec.resume_id.as_deref(),
    )
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
