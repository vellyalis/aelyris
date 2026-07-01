//! P0-4 single-use command-approval tokens + the durable audit-evidence builder.
//!
//! A write classified `review` is rejected until the operator confirms; confirmation
//! MINTS a token bound to five fields `(policyVersion, commandHash, sourceKind,
//! sessionId, targetScopeHash)` (hard boundary #2). The gate CONSUMES it exactly once
//! and only when all five match the write being performed, so a token can never be
//! replayed, used for a different command, or redirected to another terminal. `deny`
//! (catastrophic) never mints a token (hard boundary #3).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::{
    classify_command, CommandRiskOptions, CommandRiskReport, CommandRiskSeverity, POLICY_VERSION,
};
use crate::db::{AuditJournalAppend, ManagedDb};

/// Confirm -> resubmit window. Short: a stale confirmation must not linger.
const APPROVAL_TTL_SECS: u64 = 120;
/// Cap on live (unconsumed) approvals — bounds memory and the abuse surface.
const MAX_LIVE_APPROVALS: usize = 256;

/// SHA-256 hex of a command. A NEWTYPE produced ONLY by [`command_hash`], so the audit
/// builder and the binding can never be handed a raw (possibly secret-bearing) command
/// string by mistake — the type guarantees this value is a hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandHash(String);

impl CommandHash {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// SHA-256 hex of a command — the strong binding the token carries (a 32-bit hash would
/// be collision-findable, weakening the replay protection).
pub fn command_hash(command: &str) -> CommandHash {
    let mut h = Sha256::new();
    h.update(command.as_bytes());
    CommandHash(format!("{:x}", h.finalize()))
}

/// Hash of the write's TARGET SCOPE: a single terminal id, or the sorted set of broadcast
/// target ids — so an approval for one terminal can never be consumed for another. Each id
/// is length-prefixed so the mapping is injective even for ids containing the separator.
pub fn target_scope_hash(target_ids: &[&str]) -> String {
    let mut ids: Vec<&str> = target_ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    let mut h = Sha256::new();
    for id in ids {
        h.update((id.len() as u64).to_le_bytes());
        h.update(id.as_bytes());
    }
    format!("{:x}", h.finalize())
}

/// The five fields an approval token binds to (hard boundary #2). A consume succeeds only
/// when ALL five equal the write being performed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalBinding {
    pub policy_version: u32,
    pub command_hash: CommandHash,
    pub source_kind: String,
    pub session_id: String,
    pub target_scope_hash: String,
}

struct ApprovalEntry {
    binding: ApprovalBinding,
    expires_at: Instant,
}

/// Single-use, TTL-bounded approval tokens (modeled on `api::TicketRegistry`). The Mutex
/// is the atomic claim point — a token is removed on the first matching consume, so two
/// concurrent consumers can never both win.
pub struct CommandApprovalRegistry {
    entries: Mutex<HashMap<String, ApprovalEntry>>,
    max_live: usize,
    ttl: Duration,
}

impl CommandApprovalRegistry {
    pub fn new() -> Self {
        Self::with_ttl(Duration::from_secs(APPROVAL_TTL_SECS))
    }

    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            max_live: MAX_LIVE_APPROVALS,
            ttl,
        }
    }

    /// Issue a fresh single-use token for `binding`. PRIVATE: all minting must go through
    /// [`mint_command_approval`], which refuses `allow`/`deny` — a caller must never be able
    /// to mint a token for an arbitrary (e.g. catastrophic) binding. Prunes expired tokens
    /// and drops the oldest if at cap.
    fn issue(&self, binding: ApprovalBinding) -> String {
        let now = Instant::now();
        let mut map = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        map.retain(|_, e| e.expires_at > now);
        if map.len() >= self.max_live {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, e)| e.expires_at)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        let id = format!("cmd-approval:{}", uuid::Uuid::new_v4());
        map.insert(
            id.clone(),
            ApprovalEntry {
                binding,
                expires_at: now + self.ttl,
            },
        );
        id
    }

    /// Consume a token: `true` ONLY on the first redemption of a live token whose binding
    /// equals `binding` exactly. Unknown / expired / already-consumed / any-field-mismatch
    /// all return `false`. One-shot: a successful consume removes the token.
    pub fn consume(&self, approval_id: &str, binding: &ApprovalBinding) -> bool {
        let now = Instant::now();
        let mut map = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        map.retain(|_, e| e.expires_at > now);
        let Some(entry) = map.get(approval_id) else {
            return false;
        };
        if &entry.binding != binding {
            return false;
        }
        map.remove(approval_id);
        true
    }

    #[doc(hidden)]
    pub fn live_count(&self) -> usize {
        self.entries.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

impl Default for CommandApprovalRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// The result of minting an approval for a command.
pub enum MintOutcome {
    /// severity `allow` — no approval is needed; the write may proceed unguarded.
    NoApprovalNeeded,
    /// severity `deny` — catastrophic; NO token is ever minted (hard boundary #3).
    Catastrophic { report: CommandRiskReport },
    /// severity `review` — a single-use token bound to the five fields.
    Minted {
        approval_id: String,
        report: CommandRiskReport,
    },
}

/// Classify `command` and, only for `review`, mint a single-use approval token. `allow`
/// needs none; `deny` is refused (catastrophic). The gate later consumes the token under
/// the SAME binding before writing.
pub fn mint_command_approval(
    registry: &CommandApprovalRegistry,
    options: &CommandRiskOptions,
    source_kind: &str,
    session_id: &str,
    command: &str,
    target_scope_hash: &str,
) -> MintOutcome {
    let report = classify_command(command, options);
    match report.severity {
        CommandRiskSeverity::Allow => MintOutcome::NoApprovalNeeded,
        CommandRiskSeverity::Deny => MintOutcome::Catastrophic { report },
        CommandRiskSeverity::Review => {
            let binding = ApprovalBinding {
                policy_version: POLICY_VERSION,
                command_hash: command_hash(command),
                source_kind: source_kind.to_string(),
                session_id: session_id.to_string(),
                target_scope_hash: target_scope_hash.to_string(),
            };
            let approval_id = registry.issue(binding);
            MintOutcome::Minted {
                approval_id,
                report,
            }
        }
    }
}

/// Build the durable `command_risk_decision` evidence for a gate decision. The payload
/// stores ONLY the redacted, capped preview + the command HASH — never the raw command
/// (no secret leak; far under the 256 KiB journal cap).
pub fn command_risk_audit_event(
    decision: &str,
    report: &CommandRiskReport,
    command_hash: &CommandHash,
    source_kind: &str,
    session_id: &str,
    target_scope_hash: &str,
    approval_id: Option<&str>,
) -> AuditJournalAppend {
    let severity = match report.severity {
        CommandRiskSeverity::Deny => "error",
        CommandRiskSeverity::Review => "warning",
        CommandRiskSeverity::Allow => "info",
    };
    AuditJournalAppend {
        workspace_id: "default".to_string(),
        thread_id: None,
        session_id: Some(session_id.to_string()),
        pane_id: None,
        terminal_id: None,
        agent_id: None,
        workflow_id: None,
        task_id: None,
        correlation_id: approval_id.map(String::from),
        kind: "command_risk_decision".to_string(),
        severity: severity.to_string(),
        source: "command-risk-gate".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "decision": decision,
            "severity": report.severity.as_str(),
            "classes": report.classes,
            "preview": report.preview,
            "commandHash": command_hash.as_str(),
            "sourceKind": source_kind,
            "sessionId": session_id,
            "targetScopeHash": target_scope_hash,
            "approvalId": approval_id,
        }),
    }
}

/// Append the decision evidence and ONLY THEN run `action` (the PTY write). Append-before
/// -write, fail-closed: if the durable append errors, `action` never runs and the write is
/// refused (hard boundary #4).
pub fn record_decision_then<T>(
    db: &ManagedDb,
    event: &AuditJournalAppend,
    action: impl FnOnce() -> T,
) -> Result<T, String> {
    db.with(|d| d.append_audit_journal_event(event))?;
    Ok(action())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use std::sync::Arc;

    fn binding(cmd: &str, source: &str, session: &str, scope: &str) -> ApprovalBinding {
        ApprovalBinding {
            policy_version: POLICY_VERSION,
            command_hash: command_hash(cmd),
            source_kind: source.to_string(),
            session_id: session.to_string(),
            target_scope_hash: scope.to_string(),
        }
    }

    #[test]
    fn issue_then_consume_is_single_use() {
        let reg = CommandApprovalRegistry::new();
        let b = binding("git commit -m x", "rest", "s1", "t1");
        let id = reg.issue(b.clone());
        assert_eq!(reg.live_count(), 1);
        assert!(reg.consume(&id, &b), "first consume wins");
        assert_eq!(reg.live_count(), 0, "consumed token is removed");
        assert!(!reg.consume(&id, &b), "a token cannot be replayed");
    }

    #[test]
    fn consume_rejects_any_field_mismatch() {
        let reg = CommandApprovalRegistry::new();
        let b = binding("git commit", "rest", "s1", "t1");
        // A fresh token per attempt (consume is one-shot), each with exactly one field wrong.
        let mismatches = [
            ApprovalBinding {
                command_hash: command_hash("rm -rf /"),
                ..b.clone()
            },
            ApprovalBinding {
                source_kind: "mcp".to_string(),
                ..b.clone()
            },
            ApprovalBinding {
                session_id: "other".to_string(),
                ..b.clone()
            },
            ApprovalBinding {
                target_scope_hash: "t2".to_string(),
                ..b.clone()
            },
            ApprovalBinding {
                policy_version: POLICY_VERSION + 1,
                ..b.clone()
            },
        ];
        for wrong in mismatches {
            let id = reg.issue(b.clone());
            assert!(
                !reg.consume(&id, &wrong),
                "mismatch must not consume: {wrong:?}"
            );
            // The token is NOT consumed by a mismatch — the correct binding still works.
            assert!(reg.consume(&id, &b));
        }
        assert!(!reg.consume("cmd-approval:ghost", &b), "unknown id");
    }

    #[test]
    fn expired_token_cannot_be_consumed() {
        let reg = CommandApprovalRegistry::with_ttl(Duration::from_millis(1));
        let b = binding("git commit", "rest", "s1", "t1");
        let id = reg.issue(b.clone());
        std::thread::sleep(Duration::from_millis(8));
        assert!(!reg.consume(&id, &b), "an expired token is rejected");
    }

    #[test]
    fn parallel_double_consume_has_exactly_one_winner() {
        let reg = Arc::new(CommandApprovalRegistry::new());
        let b = binding("git commit", "rest", "s1", "t1");
        let id = reg.issue(b.clone());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let reg = reg.clone();
            let b = b.clone();
            let id = id.clone();
            handles.push(std::thread::spawn(move || reg.consume(&id, &b)));
        }
        let wins = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|&won| won)
            .count();
        assert_eq!(wins, 1, "exactly one concurrent consumer may win");
    }

    #[test]
    fn mint_refuses_allow_and_deny_mints_only_review() {
        let reg = CommandApprovalRegistry::new();
        let opts = CommandRiskOptions::default();
        // allow -> no token.
        assert!(matches!(
            mint_command_approval(&reg, &opts, "rest", "s1", "git status", "t1"),
            MintOutcome::NoApprovalNeeded
        ));
        // deny -> catastrophic, NO token ever.
        assert!(matches!(
            mint_command_approval(&reg, &opts, "rest", "s1", "rm -rf /tmp/x", "t1"),
            MintOutcome::Catastrophic { .. }
        ));
        assert_eq!(reg.live_count(), 0, "no token minted for allow/deny");
        // review -> a token bound to the 5 fields, consumable under the same binding.
        let MintOutcome::Minted { approval_id, .. } =
            mint_command_approval(&reg, &opts, "rest", "s1", "git commit -m x", "t1")
        else {
            panic!("review should mint");
        };
        let b = binding("git commit -m x", "rest", "s1", "t1");
        assert!(reg.consume(&approval_id, &b));
    }

    #[test]
    fn audit_event_redacts_the_secret_and_carries_the_hash() {
        let fake_key = format!("sk-{}", "REDACTION_TEST_OPENAI_KEY");
        let cmd = format!("export API_KEY={fake_key}");
        let report = classify_command(&cmd, &CommandRiskOptions::default());
        let event = command_risk_audit_event(
            "approved",
            &report,
            &command_hash(&cmd),
            "rest",
            "s1",
            "t1",
            Some("cmd-approval:abc"),
        );
        assert_eq!(event.kind, "command_risk_decision");
        assert_eq!(event.source, "command-risk-gate");
        let payload = event.payload_json.to_string();
        assert!(!payload.contains(&fake_key), "no raw secret: {payload}");
        assert!(payload.contains("[REDACTED]"));
        assert!(payload.contains("commandHash"));
        assert!(payload.contains("\"decision\":\"approved\""));
    }

    #[test]
    fn record_decision_then_appends_before_acting_and_fails_closed() {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        let report = classify_command("git commit -m x", &CommandRiskOptions::default());
        let ok_event = command_risk_audit_event(
            "approved",
            &report,
            &command_hash("git commit -m x"),
            "rest",
            "s1",
            "t1",
            None,
        );
        let mut wrote = false;
        record_decision_then(&db, &ok_event, || wrote = true).unwrap();
        assert!(wrote, "action runs after a successful append");

        // A failing append (oversized payload exceeds the journal cap) must FAIL CLOSED:
        // the action never runs.
        let mut huge = ok_event.clone();
        huge.payload_json = serde_json::json!({ "blob": "x".repeat(300 * 1024) });
        let mut wrote2 = false;
        let res = record_decision_then(&db, &huge, || wrote2 = true);
        assert!(res.is_err(), "oversized append must error");
        assert!(
            !wrote2,
            "fail-closed: the write never happens if audit append fails"
        );
    }
}
