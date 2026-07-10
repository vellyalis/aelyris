//! Daemon-owned terminal input authority.
//!
//! Every command-carrying face describes the requested write with a typed envelope and
//! delegates classification + delivery here.  The authority owns approval state and returns
//! an ACK only after the raw PTY writer has accepted every effective target; accepting a
//! request into a caller-side queue is deliberately not represented as success.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::approval::command_hash;
use super::gate::{CommandRiskGate, GateContext, GateMode};
use super::CommandRiskOptions;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteActorKind {
    Human,
    Programmatic,
    Runtime,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteActor {
    pub principal: String,
    pub kind: WriteActorKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WritePayloadMode {
    Atomic,
    HoldUntilApproved,
    EchoPreserving,
    /// Runtime-owned natural-language prompt sent to an already-running agent TUI. This is
    /// not a shell command, but it still passes waiting-approval/target/hash authority checks.
    AgentInstruction,
}

impl From<WritePayloadMode> for GateMode {
    fn from(value: WritePayloadMode) -> Self {
        match value {
            WritePayloadMode::Atomic => Self::Atomic,
            WritePayloadMode::HoldUntilApproved => Self::HoldUntilApproved,
            WritePayloadMode::EchoPreserving => Self::EchoPreserving,
            WritePayloadMode::AgentInstruction => Self::Atomic,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteApprovalBinding {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactive_prompt_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteEnvelope {
    pub request_id: String,
    pub actor: WriteActor,
    pub source: String,
    pub terminal_id: String,
    pub session_id: String,
    pub target_ids: Vec<String>,
    pub payload_mode: WritePayloadMode,
    /// SHA-256 of the exact payload supplied with this envelope.
    pub command_hash: String,
    #[serde(default)]
    pub approval: WriteApprovalBinding,
}

impl TerminalWriteEnvelope {
    #[allow(clippy::too_many_arguments)]
    pub fn for_payload(
        request_id: impl Into<String>,
        actor: WriteActor,
        source: impl Into<String>,
        terminal_id: impl Into<String>,
        session_id: impl Into<String>,
        target_ids: Vec<String>,
        payload_mode: WritePayloadMode,
        payload: &[u8],
        approval: WriteApprovalBinding,
    ) -> Self {
        Self {
            request_id: request_id.into(),
            actor,
            source: source.into(),
            terminal_id: terminal_id.into(),
            session_id: session_id.into(),
            target_ids,
            payload_mode,
            command_hash: command_hash(&String::from_utf8_lossy(payload))
                .as_str()
                .to_string(),
            approval,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalWriteAckStatus {
    Executed,
    Held,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteAck {
    pub request_id: String,
    pub status: TerminalWriteAckStatus,
    pub accepted_targets: Vec<String>,
    pub bytes_written_per_target: usize,
    pub contains_enter: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteNack {
    pub request_id: String,
    pub code: String,
    pub message: String,
    pub failed_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InteractiveApprovalState {
    session_id: String,
    prompt_key: String,
}

pub struct TerminalInputAuthority {
    gate: Arc<CommandRiskGate>,
    interactive_approvals: Mutex<HashMap<String, InteractiveApprovalState>>,
}

impl TerminalInputAuthority {
    pub fn new(gate: Arc<CommandRiskGate>) -> Self {
        Self {
            gate,
            interactive_approvals: Mutex::new(HashMap::new()),
        }
    }

    pub fn gate(&self) -> &Arc<CommandRiskGate> {
        &self.gate
    }

    pub fn set_interactive_approval(
        &self,
        terminal_id: impl Into<String>,
        session_id: impl Into<String>,
        prompt_key: impl Into<String>,
    ) {
        let terminal_id = terminal_id.into();
        let state = InteractiveApprovalState {
            session_id: session_id.into(),
            prompt_key: prompt_key.into(),
        };
        self.interactive_approvals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(terminal_id, state);
    }

    pub fn clear_interactive_approval(&self, terminal_id: &str) {
        self.interactive_approvals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(terminal_id);
    }

    pub fn execute(
        &self,
        envelope: &TerminalWriteEnvelope,
        payload: &[u8],
        mut write_raw: impl FnMut(&str, &[u8]) -> Result<(), String>,
    ) -> Result<TerminalWriteAck, TerminalWriteNack> {
        let targets = normalize_and_validate_envelope(envelope, payload)?;
        let claimed_interactive = self.claim_interactive_approval(envelope, &targets)?;

        let result = (|| {
            let writable = if envelope.payload_mode == WritePayloadMode::AgentInstruction {
                if envelope.actor.kind != WriteActorKind::Runtime {
                    return Err(nack(
                        envelope,
                        "invalid_actor_capability",
                        "agent-instruction payloads require runtime authority",
                        targets,
                    ));
                }
                payload.to_vec()
            } else {
                let options = CommandRiskOptions::default();
                let ctx = GateContext {
                    source_kind: &envelope.source,
                    session_id: &envelope.session_id,
                    target_ids: &targets,
                    approval_id: envelope.approval.command_approval_id.as_deref(),
                    options: &options,
                    mode: envelope.payload_mode.into(),
                    // Human cockpit input is the reviewed local face. Programmatic/runtime writes
                    // must carry a command approval for `review` classifications.
                    review_requires_approval: envelope.actor.kind != WriteActorKind::Human,
                };
                self.gate
                    .check(&ctx, payload)
                    .map_err(|denial| TerminalWriteNack {
                        request_id: envelope.request_id.clone(),
                        code: if denial.catastrophic {
                            "command_denied".to_string()
                        } else {
                            "command_approval_required".to_string()
                        },
                        message: denial.reason,
                        failed_targets: targets.clone(),
                    })?
            };
            if writable.is_empty() {
                return Ok(TerminalWriteAck {
                    request_id: envelope.request_id.clone(),
                    status: TerminalWriteAckStatus::Held,
                    accepted_targets: Vec::new(),
                    bytes_written_per_target: 0,
                    contains_enter: false,
                });
            }

            let mut accepted: Vec<String> = Vec::with_capacity(targets.len());
            for target in &targets {
                if let Err(message) = write_raw(target, &writable) {
                    return Err(TerminalWriteNack {
                        request_id: envelope.request_id.clone(),
                        code: "pty_write_failed".to_string(),
                        message,
                        failed_targets: targets
                            .iter()
                            .filter(|candidate| !accepted.contains(candidate))
                            .cloned()
                            .collect(),
                    });
                }
                accepted.push(target.clone());
            }
            Ok(TerminalWriteAck {
                request_id: envelope.request_id.clone(),
                status: TerminalWriteAckStatus::Executed,
                accepted_targets: accepted,
                bytes_written_per_target: writable.len(),
                contains_enter: writable.contains(&b'\r'),
            })
        })();
        if result.is_err() {
            self.restore_interactive_claim(claimed_interactive);
        }
        result
    }

    fn claim_interactive_approval(
        &self,
        envelope: &TerminalWriteEnvelope,
        targets: &[String],
    ) -> Result<Vec<(String, InteractiveApprovalState)>, TerminalWriteNack> {
        let mut states = self
            .interactive_approvals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let waiting = targets
            .iter()
            .filter_map(|target| states.get(target).map(|state| (target, state)))
            .collect::<Vec<_>>();

        if waiting.is_empty() {
            if envelope.approval.interactive_prompt_key.is_some() {
                return Err(nack(
                    envelope,
                    "stale_approval",
                    "no target is waiting at an interactive approval",
                    targets.to_vec(),
                ));
            }
            return Ok(Vec::new());
        }
        if envelope.actor.kind != WriteActorKind::Human {
            return Err(nack(
                envelope,
                "blocked_waiting_approval",
                "programmatic input cannot resolve an interactive approval",
                waiting
                    .into_iter()
                    .map(|(target, _)| target.clone())
                    .collect(),
            ));
        }
        let Some(prompt_key) = envelope.approval.interactive_prompt_key.as_deref() else {
            return Err(nack(
                envelope,
                "blocked_waiting_approval",
                "interactive approval requires the current prompt fingerprint",
                waiting
                    .into_iter()
                    .map(|(target, _)| target.clone())
                    .collect(),
            ));
        };
        if waiting.len() != targets.len()
            || waiting.iter().any(|(_, state)| {
                state.prompt_key != prompt_key || state.session_id != envelope.session_id
            })
        {
            return Err(nack(
                envelope,
                "stale_approval",
                "interactive approval fingerprint, session, or target set changed",
                waiting
                    .into_iter()
                    .map(|(target, _)| target.clone())
                    .collect(),
            ));
        }
        let claimed = targets
            .iter()
            .filter_map(|target| states.remove(target).map(|state| (target.clone(), state)))
            .collect();
        Ok(claimed)
    }

    fn restore_interactive_claim(&self, claimed: Vec<(String, InteractiveApprovalState)>) {
        if claimed.is_empty() {
            return;
        }
        let mut states = self
            .interactive_approvals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (terminal_id, state) in claimed {
            states.entry(terminal_id).or_insert(state);
        }
    }
}

fn normalize_and_validate_envelope(
    envelope: &TerminalWriteEnvelope,
    payload: &[u8],
) -> Result<Vec<String>, TerminalWriteNack> {
    let mut targets = envelope.target_ids.clone();
    targets.sort();
    targets.dedup();
    if envelope.request_id.trim().is_empty()
        || envelope.actor.principal.trim().is_empty()
        || envelope.source.trim().is_empty()
        || envelope.terminal_id.trim().is_empty()
        || envelope.session_id.trim().is_empty()
        || targets.is_empty()
        || !targets.iter().any(|target| target == &envelope.terminal_id)
    {
        return Err(nack(
            envelope,
            "invalid_write_envelope",
            "write envelope is missing identity or target scope",
            targets,
        ));
    }
    let actual_hash = command_hash(&String::from_utf8_lossy(payload));
    if actual_hash.as_str() != envelope.command_hash {
        return Err(nack(
            envelope,
            "payload_hash_mismatch",
            "write payload does not match the envelope command hash",
            targets,
        ));
    }
    Ok(targets)
}

fn nack(
    envelope: &TerminalWriteEnvelope,
    code: &str,
    message: &str,
    failed_targets: Vec<String>,
) -> TerminalWriteNack {
    TerminalWriteNack {
        request_id: envelope.request_id.clone(),
        code: code.to_string(),
        message: message.to_string(),
        failed_targets,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, ManagedDb};

    fn authority() -> TerminalInputAuthority {
        TerminalInputAuthority::new(Arc::new(CommandRiskGate::new(Some(Arc::new(
            ManagedDb::new(Database::open_memory().unwrap()),
        )))))
    }

    fn envelope(
        actor: WriteActorKind,
        source: &str,
        targets: &[&str],
        payload: &[u8],
    ) -> TerminalWriteEnvelope {
        TerminalWriteEnvelope::for_payload(
            "request-1",
            WriteActor {
                principal: "operator".to_string(),
                kind: actor,
            },
            source,
            "term-1",
            "session-1",
            targets.iter().map(|target| (*target).to_string()).collect(),
            WritePayloadMode::Atomic,
            payload,
            WriteApprovalBinding::default(),
        )
    }

    #[test]
    fn ack_is_emitted_only_after_every_effective_target_writes() {
        let authority = authority();
        let payload = b"git status";
        let env = envelope(
            WriteActorKind::Programmatic,
            "rest-session-input",
            &["term-2", "term-1", "term-2"],
            payload,
        );
        let mut writes = Vec::new();
        let ack = authority
            .execute(&env, payload, |target, bytes| {
                writes.push((target.to_string(), bytes.to_vec()));
                Ok(())
            })
            .unwrap();
        assert_eq!(ack.status, TerminalWriteAckStatus::Executed);
        assert_eq!(ack.accepted_targets, vec!["term-1", "term-2"]);
        assert_eq!(writes.len(), 2);
    }

    #[test]
    fn queue_acceptance_is_not_reported_when_raw_write_fails() {
        let authority = authority();
        let payload = b"git status";
        let env = envelope(
            WriteActorKind::Programmatic,
            "rest-session-input",
            &["term-1"],
            payload,
        );
        let nack = authority
            .execute(&env, payload, |_target, _bytes| {
                Err("writer closed".to_string())
            })
            .unwrap_err();
        assert_eq!(nack.code, "pty_write_failed");
        assert_eq!(nack.failed_targets, vec!["term-1"]);
    }

    #[test]
    fn raw_programmatic_enter_cannot_resolve_waiting_approval() {
        let authority = authority();
        authority.set_interactive_approval("term-1", "session-1", "prompt-a");
        let payload = b"\r";
        let env = envelope(
            WriteActorKind::Programmatic,
            "ws-session-input",
            &["term-1"],
            payload,
        );
        let mut wrote = false;
        let nack = authority
            .execute(&env, payload, |_target, _bytes| {
                wrote = true;
                Ok(())
            })
            .unwrap_err();
        assert_eq!(nack.code, "blocked_waiting_approval");
        assert!(!wrote);
    }

    #[test]
    fn interactive_approval_is_human_fingerprint_and_session_bound() {
        let authority = authority();
        authority.set_interactive_approval("term-1", "session-1", "prompt-a");
        let payload = b"1";
        let mut env = envelope(
            WriteActorKind::Human,
            "interactive-approval-resolution",
            &["term-1"],
            payload,
        );
        env.approval.interactive_prompt_key = Some("prompt-a".to_string());
        let ack = authority
            .execute(&env, payload, |_target, _bytes| Ok(()))
            .unwrap();
        assert_eq!(ack.status, TerminalWriteAckStatus::Executed);

        assert_eq!(
            authority
                .execute(&env, payload, |_target, _bytes| Ok(()))
                .unwrap_err()
                .code,
            "stale_approval",
            "interactive approval claims are single-use"
        );

        authority.set_interactive_approval("term-1", "session-1", "prompt-a");
        env.approval.interactive_prompt_key = Some("stale".to_string());
        assert_eq!(
            authority
                .execute(&env, payload, |_target, _bytes| Ok(()))
                .unwrap_err()
                .code,
            "stale_approval"
        );
    }

    #[test]
    fn payload_hash_and_cross_target_mutations_fail_closed() {
        let authority = authority();
        let payload = b"git status";
        let mut env = envelope(
            WriteActorKind::Programmatic,
            "mcp-pane-input",
            &["term-1"],
            payload,
        );
        env.command_hash = "wrong".to_string();
        assert_eq!(
            authority
                .execute(&env, payload, |_target, _bytes| Ok(()))
                .unwrap_err()
                .code,
            "payload_hash_mismatch"
        );

        let mut env = envelope(
            WriteActorKind::Programmatic,
            "mcp-pane-input",
            &["term-2"],
            payload,
        );
        env.terminal_id = "term-1".to_string();
        assert_eq!(
            authority
                .execute(&env, payload, |_target, _bytes| Ok(()))
                .unwrap_err()
                .code,
            "invalid_write_envelope"
        );
    }
}
