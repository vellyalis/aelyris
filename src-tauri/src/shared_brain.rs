use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainAgent {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_action: Option<String>,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    pub status: String,
    pub run_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainRange {
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainOwnership {
    pub claim_id: String,
    pub kind: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<SharedBrainRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_session_id: Option<String>,
    pub confidence: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainMergeIntent {
    pub intent_id: String,
    pub source_branch: String,
    pub target_branch: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainBlocker {
    pub kind: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBrainSnapshot {
    pub workspace_id: String,
    pub generated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_graph_revision: Option<String>,
    pub agents: Vec<SharedBrainAgent>,
    pub ownership: Vec<SharedBrainOwnership>,
    pub merge_intents: Vec<SharedBrainMergeIntent>,
    pub blockers: Vec<SharedBrainBlocker>,
    pub decisions: BTreeMap<String, String>,
}

#[derive(Clone)]
pub struct SharedBrainInputs<'a> {
    pub workspace_id: &'a str,
    pub agents: Vec<crate::agent::AgentSession>,
    pub file_ownership: Option<&'a Arc<Mutex<crate::file_ownership::FileOwnership>>>,
    pub symbol_ownership: Option<&'a Arc<Mutex<crate::symbol_ownership::SymbolOwnership>>>,
    pub event_bus: Option<&'a Arc<crate::event_bus::EventBus>>,
    pub context_store: Option<&'a Arc<crate::context_store::ContextStoreManager>>,
    pub merge_store: Option<&'a Arc<crate::merge_intent::store::MergeIntentStore>>,
    pub now: u64,
}

pub fn snapshot(inputs: SharedBrainInputs<'_>) -> Result<SharedBrainSnapshot, String> {
    let events = inputs.event_bus.map(|bus| bus.recent()).unwrap_or_default();
    let mut agent_overrides = agent_overrides_from_events(&events);
    let mut agents: Vec<SharedBrainAgent> = inputs
        .agents
        .into_iter()
        .map(|agent| {
            let mut override_info = agent_overrides.remove(&agent.id).unwrap_or_default();
            SharedBrainAgent {
                session_id: agent.id,
                task_id: override_info.task_id.take(),
                role: override_info.role.take(),
                current_action: override_info.current_action.take(),
                cwd: agent.cwd,
                branch_name: agent.worktree_branch,
                pane_id: agent.pty_id,
                status: agent.status.as_str().to_string(),
                run_mode: format!("{:?}", agent.run_mode).to_ascii_lowercase(),
            }
        })
        .collect();

    for (_, event_agent) in agent_overrides {
        agents.push(SharedBrainAgent {
            session_id: event_agent.session_id,
            task_id: event_agent.task_id,
            role: event_agent.role,
            current_action: event_agent.current_action,
            cwd: String::new(),
            branch_name: None,
            pane_id: event_agent.pane_id,
            status: "unknown".to_string(),
            run_mode: "event".to_string(),
        });
    }
    agents.sort_by(|a, b| a.session_id.cmp(&b.session_id));

    let mut ownership = Vec::new();
    if let Some(file_ownership) = inputs.file_ownership {
        let owner = file_ownership
            .lock()
            .map_err(|_| "file ownership lock poisoned".to_string())?;
        ownership.extend(owner.claims().iter().map(file_claim));
    }
    if let Some(symbol_ownership) = inputs.symbol_ownership {
        let mut owner = symbol_ownership
            .lock()
            .map_err(|_| "symbol ownership lock poisoned".to_string())?;
        owner.expire(inputs.now);
        ownership.extend(owner.live_claims(inputs.now).into_iter().map(symbol_claim));
    }
    ownership.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));

    let merge_intents = match inputs.merge_store {
        Some(store) => store
            .list_unresolved()?
            .into_iter()
            .map(|intent| SharedBrainMergeIntent {
                intent_id: intent.intent_id,
                source_branch: intent.source_branch,
                target_branch: intent.target_branch,
                state: intent.state.as_str().to_string(),
            })
            .collect(),
        None => Vec::new(),
    };

    Ok(SharedBrainSnapshot {
        workspace_id: inputs.workspace_id.to_string(),
        generated_at: inputs.now,
        task_graph_revision: None,
        agents,
        ownership,
        merge_intents,
        blockers: blockers_from_events(&events),
        decisions: inputs
            .context_store
            .map(|store| store.all())
            .unwrap_or_default(),
    })
}

#[derive(Default)]
struct EventAgent {
    session_id: String,
    task_id: Option<String>,
    role: Option<String>,
    current_action: Option<String>,
    pane_id: Option<String>,
}

fn agent_overrides_from_events(
    events: &[crate::event_bus::AgentEvent],
) -> BTreeMap<String, EventAgent> {
    let mut out = BTreeMap::new();
    for event in events {
        match event.kind {
            crate::event_bus::AgentEventKind::AgentActivity => {
                let Some(session_id) = event.payload.get("sessionId").and_then(|v| v.as_str())
                else {
                    continue;
                };
                let entry = out
                    .entry(session_id.to_string())
                    .or_insert_with(|| EventAgent {
                        session_id: session_id.to_string(),
                        ..Default::default()
                    });
                entry.current_action = event
                    .payload
                    .get("action")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            crate::event_bus::AgentEventKind::AgentSpawned => {
                let Some(terminal_id) = event.payload.get("terminalId").and_then(|v| v.as_str())
                else {
                    continue;
                };
                let entry = out
                    .entry(terminal_id.to_string())
                    .or_insert_with(|| EventAgent {
                        session_id: terminal_id.to_string(),
                        pane_id: Some(terminal_id.to_string()),
                        ..Default::default()
                    });
                entry.pane_id = Some(terminal_id.to_string());
                entry.task_id = event
                    .payload
                    .get("taskId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            }
            _ => {}
        }
    }
    out
}

fn file_claim(claim: &crate::file_ownership::OwnershipClaim) -> SharedBrainOwnership {
    SharedBrainOwnership {
        claim_id: format!("file:{}:{}", claim.agent_id, claim.pattern),
        kind: "file".to_string(),
        path: claim.pattern.clone(),
        symbol: None,
        range: None,
        owner_session_id: Some(claim.agent_id.clone()),
        confidence: "file-fallback".to_string(),
        status: "active".to_string(),
    }
}

fn symbol_claim(claim: &crate::symbol_ownership::SymbolClaim) -> SharedBrainOwnership {
    SharedBrainOwnership {
        claim_id: claim.claim_id.clone(),
        kind: "symbol".to_string(),
        path: claim.path.clone(),
        symbol: Some(claim.symbol.clone()),
        range: Some(SharedBrainRange {
            start_line: claim.range.start_line,
            end_line: claim.range.end_line,
        }),
        owner_session_id: Some(claim.agent_id.clone()),
        confidence: match claim.confidence {
            crate::symbol_ownership::Confidence::Lsp => "lsp",
            crate::symbol_ownership::Confidence::Parser => "parser",
            crate::symbol_ownership::Confidence::DiffHunk => "diff-hunk",
        }
        .to_string(),
        status: "active".to_string(),
    }
}

fn blockers_from_events(events: &[crate::event_bus::AgentEvent]) -> Vec<SharedBrainBlocker> {
    events
        .iter()
        .filter_map(|event| match event.kind {
            crate::event_bus::AgentEventKind::BlockerRaised => Some(SharedBrainBlocker {
                kind: "agent_blocker".to_string(),
                detail: event
                    .payload
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("agent blocker")
                    .to_string(),
                session_id: event
                    .payload
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            }),
            crate::event_bus::AgentEventKind::EscalationRaised => Some(SharedBrainBlocker {
                kind: "escalation".to_string(),
                detail: event
                    .payload
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("escalation")
                    .to_string(),
                session_id: event
                    .payload
                    .get("taskId")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentRunMode, AgentRunStatus, AgentSession};
    use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
    use crate::file_ownership::FileOwnership;
    use crate::symbol_ownership::{
        ClaimMode, Confidence, SymbolClaim, SymbolOwnership, SymbolRange,
    };
    use serde_json::json;

    #[test]
    fn snapshot_combines_agents_events_ownership_and_decisions() {
        let file = Arc::new(Mutex::new(FileOwnership::new()));
        file.lock().unwrap().assign("agent-a", "src/auth/**");
        let symbol = Arc::new(Mutex::new(SymbolOwnership::new()));
        symbol.lock().unwrap().claim(
            SymbolClaim {
                claim_id: "c1".to_string(),
                agent_id: "agent-a".to_string(),
                task_id: Some("t1".to_string()),
                path: "src/auth/login.rs".to_string(),
                symbol: "login".to_string(),
                range: SymbolRange::new(10, 20),
                mode: ClaimMode::Write,
                lease_expires_at: 50,
                confidence: Confidence::Parser,
            },
            10,
        );
        let bus = Arc::new(EventBus::new());
        bus.publish(AgentEvent::new(
            AgentEventKind::AgentActivity,
            json!({"sessionId": "agent-a", "action": "editing", "file": "src/auth/login.rs"}),
        ));
        bus.publish(AgentEvent::new(
            AgentEventKind::BlockerRaised,
            json!({"sessionId": "agent-a", "summary": "needs review"}),
        ));
        let context = Arc::new(crate::context_store::ContextStoreManager::new());
        context.set("architecture", "durable shared brain");

        let snapshot = snapshot(SharedBrainInputs {
            workspace_id: "repo",
            agents: vec![AgentSession {
                id: "agent-a".to_string(),
                run_mode: AgentRunMode::Interactive,
                status: AgentRunStatus::Coding,
                model: "claude".to_string(),
                prompt: None,
                cwd: "C:/repo".to_string(),
                workspace_scope: None,
                cost: 0.0,
                tokens_used: 0,
                started_at: Some(1),
                logical_session_id: Some("agent-a".to_string()),
                last_activity: Some(2),
                turn_count: Some(1),
                context_remaining: None,
                cli: Some("claude".to_string()),
                backend: Some("pty".to_string()),
                pty_id: Some("pty-1".to_string()),
                predecessor_session_id: None,
                lineage: Vec::new(),
                recycle_status: None,
                worktree_branch: Some("agent/t1".to_string()),
                worktree_path: None,
                repo_path: Some("C:/repo".to_string()),
            }],
            file_ownership: Some(&file),
            symbol_ownership: Some(&symbol),
            event_bus: Some(&bus),
            context_store: Some(&context),
            merge_store: None,
            now: 20,
        })
        .unwrap();

        assert_eq!(snapshot.workspace_id, "repo");
        assert_eq!(
            snapshot.agents[0].current_action.as_deref(),
            Some("editing")
        );
        assert_eq!(snapshot.ownership.len(), 2);
        assert_eq!(
            snapshot.decisions.get("architecture").map(String::as_str),
            Some("durable shared brain")
        );
        assert_eq!(snapshot.blockers[0].detail, "needs review");
    }
}
