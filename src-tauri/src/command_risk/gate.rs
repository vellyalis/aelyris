//! The `CommandRiskGate` (P0-4) — the ONE backend seam every command-carrying write path
//! calls before reaching a PTY. `check` returns the EXACT bytes that may be forwarded to the
//! PTY (not the caller's raw input): in streaming mode it HOLDS unterminated bytes in a
//! bounded per-`{sourceKind, targetScope}` accumulator and emits a "submission" only when a
//! line terminator (`\r` or `\n`, the execution triggers) completes a line that classifies
//! `allow`/approved. So a destructive line can never be pre-typed and then run by a later
//! bare Enter, whether it arrived as one payload or split across frames. A `deny` line is
//! refused (catastrophic); a `review` line requires a matching single-use approval id; an
//! `allow` line is emitted. Every denied/approved decision is appended to the durable audit
//! journal BEFORE the write (fail-closed, boundary #4).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::approval::{
    command_hash, command_risk_audit_event, target_scope_hash, ApprovalBinding,
    CommandApprovalRegistry,
};
use super::{
    classify_command, CommandRiskOptions, CommandRiskReport, CommandRiskSeverity, POLICY_VERSION,
};
use crate::db::ManagedDb;

/// A single command line longer than this (with no terminator) is refused rather than
/// buffered unboundedly — a caller cannot grow gate memory or evade classification.
const MAX_BUFFER_BYTES: usize = 256 * 1024;

/// What a write needs to be gated: who/where, the optional approval id carried by the
/// write, and the path-scope options for unsafe-path classification.
pub struct GateContext<'a> {
    pub source_kind: &'a str,
    pub session_id: &'a str,
    /// One terminal id, or the broadcast target set — bound into the approval's target scope.
    pub target_ids: &'a [String],
    pub approval_id: Option<&'a str>,
    pub options: &'a CommandRiskOptions,
    /// `true` for an ATOMIC submission path (a single API call carries a complete, often
    /// trimmed command — e.g. MCP pane input): the WHOLE payload is classified at once.
    /// `false` for a streaming byte path (e.g. the WS terminal stream): bytes accumulate
    /// per `{source, target}` and a submission is classified on each `\r`/`\n` so split
    /// frames are reassembled and interactive keystrokes pass until Enter.
    pub atomic: bool,
}

/// Why a write was refused — carries the risk report + the command hash so the operator UI
/// can show it and mint an approval for exactly this command + scope.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDenial {
    pub reason: String,
    pub severity: Option<CommandRiskSeverity>,
    pub classes: Vec<super::CommandRiskClass>,
    pub preview: String,
    pub command_hash: Option<String>,
    pub source_kind: String,
    pub target_scope_hash: String,
    /// True for severity `deny` — NO approval can ever authorize it (catastrophic).
    pub catastrophic: bool,
}

struct BufferState {
    bytes: Vec<u8>,
}

/// Split a byte buffer into complete lines `(content, terminator_byte)` (terminated by `\r`
/// or `\n`) plus the trailing incomplete remainder. `\r`/`\n` are single ASCII bytes, so
/// splitting on them never cuts a multi-byte UTF-8 sequence; the terminator is preserved so
/// the gate can re-emit the exact bytes it approves.
fn split_complete_lines(bytes: &[u8]) -> (Vec<(Vec<u8>, u8)>, Vec<u8>) {
    let mut lines = Vec::new();
    let mut start = 0;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\r' || b == b'\n' {
            lines.push((bytes[start..i].to_vec(), b));
            start = i + 1;
        }
    }
    (lines, bytes[start..].to_vec())
}

pub struct CommandRiskGate {
    buffers: Mutex<HashMap<String, BufferState>>,
    registry: CommandApprovalRegistry,
    /// The durable audit sink. `None` (no persistence) FAILS CLOSED: a review-approved write
    /// cannot be evidenced, so it is denied (boundary #4). `allow` lines never need audit.
    db: Option<Arc<ManagedDb>>,
}

impl CommandRiskGate {
    pub fn new(db: Option<Arc<ManagedDb>>) -> Self {
        Self {
            buffers: Mutex::new(HashMap::new()),
            registry: CommandApprovalRegistry::new(),
            db,
        }
    }

    /// The approval registry — the mint verb (inc5 wiring) issues tokens here; the gate
    /// consumes them.
    pub fn registry(&self) -> &CommandApprovalRegistry {
        &self.registry
    }

    /// Gate a write. Returns the EXACT bytes the caller may forward to the PTY — NOT the
    /// caller's original `data`. This is the crux of the split-frame defense: in streaming
    /// mode unterminated bytes are HELD inside the gate (returned: empty) and never reach the
    /// shell, so a destructive line cannot be pre-typed and then executed by a later bare
    /// Enter. Only a COMPLETE line that classifies `allow`/approved is emitted (content +
    /// its terminator). `Err(GateDenial)` means a submitted command is denied/unapproved and
    /// NOTHING from this batch is written. (Atomic paths emit the whole approved payload.)
    pub fn check(&self, ctx: &GateContext, data: &[u8]) -> Result<Vec<u8>, Box<GateDenial>> {
        let scope = target_scope_hash(
            &ctx.target_ids
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
        );

        // ATOMIC: the API call is the submission boundary — classify the WHOLE payload as
        // one command (no buffering; a split across calls is caught because each fragment is
        // itself classified, and the policy treats anything non-trivial as review/deny). On
        // approval the whole payload is the writable output.
        if ctx.atomic {
            let command = String::from_utf8_lossy(data);
            self.enforce_command(&command, ctx, &scope)?;
            return Ok(data.to_vec());
        }

        // STREAMING: accumulate per {source, target}; emit ONLY complete, approved lines.
        let key = format!("{}\u{0}{}", ctx.source_kind, scope);
        let lines = {
            let mut map = self.buffers.lock().unwrap_or_else(|p| p.into_inner());
            let buf = map
                .entry(key)
                .or_insert_with(|| BufferState { bytes: Vec::new() });
            if buf.bytes.len().saturating_add(data.len()) > MAX_BUFFER_BYTES {
                buf.bytes.clear();
                return Err(Box::new(GateDenial {
                    reason: "command input exceeds the classifiable size limit".to_string(),
                    severity: None,
                    classes: Vec::new(),
                    preview: String::new(),
                    command_hash: None,
                    source_kind: ctx.source_kind.to_string(),
                    target_scope_hash: scope,
                    catastrophic: true,
                }));
            }
            buf.bytes.extend_from_slice(data);
            let (lines, remainder) = split_complete_lines(&buf.bytes);
            buf.bytes = remainder; // hold the incomplete trailing bytes (NOT written)
            lines
        };
        // Each complete line is enforced; an approved/allowed line contributes its exact
        // bytes (content + terminator). A deny aborts the whole batch — nothing is written.
        let mut writable = Vec::new();
        for (content, term) in &lines {
            let command = String::from_utf8_lossy(content);
            self.enforce_command(&command, ctx, &scope)?;
            writable.extend_from_slice(content);
            writable.push(*term);
        }
        Ok(writable)
    }

    /// Classify ONE assembled command and enforce the policy: `allow` passes; `deny` is
    /// refused (catastrophic); `review` requires a matching single-use approval id and is
    /// audited before the write succeeds (boundary #4). A blank submission is a no-op.
    fn enforce_command(
        &self,
        command: &str,
        ctx: &GateContext,
        scope: &str,
    ) -> Result<(), Box<GateDenial>> {
        if command.trim().is_empty() {
            return Ok(()); // a bare Enter / blank input is not a command
        }
        let report = classify_command(command, ctx.options);
        match report.severity {
            CommandRiskSeverity::Allow => Ok(()), // benign — no approval, no audit row
            CommandRiskSeverity::Deny => {
                self.audit("denied", &report, command, ctx, scope, None);
                Err(self.denial(
                    "destructive command refused",
                    &report,
                    command,
                    ctx,
                    scope,
                    true,
                ))
            }
            CommandRiskSeverity::Review => {
                let binding = ApprovalBinding {
                    policy_version: POLICY_VERSION,
                    command_hash: command_hash(command),
                    source_kind: ctx.source_kind.to_string(),
                    session_id: ctx.session_id.to_string(),
                    target_scope_hash: scope.to_string(),
                };
                let approved = ctx
                    .approval_id
                    .is_some_and(|id| self.registry.consume(id, &binding));
                if !approved {
                    self.audit("denied", &report, command, ctx, scope, None);
                    return Err(self.denial(
                        "command requires an approval id",
                        &report,
                        command,
                        ctx,
                        scope,
                        false,
                    ));
                }
                // Approved: the audit append MUST succeed before the write (boundary #4).
                if !self.audit("approved", &report, command, ctx, scope, ctx.approval_id) {
                    return Err(self.denial(
                        "approved command could not be audited (fail-closed)",
                        &report,
                        command,
                        ctx,
                        scope,
                        false,
                    ));
                }
                Ok(())
            }
        }
    }

    /// Append a `command_risk_decision` row. Returns whether it was durably persisted.
    /// `allow` lines never call this; an approved write that cannot be persisted is denied.
    fn audit(
        &self,
        decision: &str,
        report: &CommandRiskReport,
        command: &str,
        ctx: &GateContext,
        scope: &str,
        approval_id: Option<&str>,
    ) -> bool {
        let Some(db) = self.db.as_ref() else {
            // No durable sink: an `allow` never reaches here; a denied/approved decision
            // cannot be evidenced, so report "not persisted" (the caller fails closed).
            return false;
        };
        let event = command_risk_audit_event(
            decision,
            report,
            &command_hash(command),
            ctx.source_kind,
            ctx.session_id,
            scope,
            approval_id,
        );
        match db.with(|d| d.append_audit_journal_event(&event)) {
            Ok(_) => true,
            Err(e) => {
                // The write is still refused, but a missing evidence row is operationally
                // significant — surface it rather than swallowing it.
                log::warn!(
                    "command-risk: failed to persist {decision} decision for {}: {e}",
                    ctx.source_kind
                );
                false
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn denial(
        &self,
        reason: &str,
        report: &CommandRiskReport,
        command: &str,
        ctx: &GateContext,
        scope: &str,
        catastrophic: bool,
    ) -> Box<GateDenial> {
        Box::new(GateDenial {
            reason: reason.to_string(),
            severity: Some(report.severity),
            classes: report.classes.clone(),
            preview: report.preview.clone(),
            command_hash: Some(command_hash(command).as_str().to_string()),
            source_kind: ctx.source_kind.to_string(),
            target_scope_hash: scope.to_string(),
            catastrophic,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_risk::approval::mint_command_approval;
    use crate::db::Database;

    fn gate() -> CommandRiskGate {
        CommandRiskGate::new(Some(Arc::new(ManagedDb::new(
            Database::open_memory().unwrap(),
        ))))
    }

    fn ctx<'a>(
        source: &'a str,
        session: &'a str,
        targets: &'a [String],
        approval: Option<&'a str>,
        opts: &'a CommandRiskOptions,
    ) -> GateContext<'a> {
        GateContext {
            source_kind: source,
            session_id: session,
            target_ids: targets,
            approval_id: approval,
            options: opts,
            atomic: false, // the streaming/accumulator tests; atomic mode has its own test
        }
    }

    #[test]
    fn allow_command_passes_without_approval() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        assert!(g
            .check(&ctx("rest", "s1", &t, None, &o), b"git status\r")
            .is_ok());
    }

    #[test]
    fn destructive_command_is_denied_with_no_approval_possible() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let err = g
            .check(&ctx("rest", "s1", &t, None, &o), b"rm -rf /tmp/x\r")
            .unwrap_err();
        assert!(err.catastrophic, "deny is catastrophic");
        assert_eq!(err.severity, Some(CommandRiskSeverity::Deny));
    }

    #[test]
    fn review_command_is_denied_without_approval_then_allowed_once_with_it() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // No approval -> denied.
        let err = g
            .check(&ctx("rest", "s1", &t, None, &o), b"git commit -m x\r")
            .unwrap_err();
        assert!(!err.catastrophic);
        assert_eq!(
            err.command_hash.as_deref(),
            Some(command_hash("git commit -m x").as_str())
        );

        // Mint an approval for this exact command + scope, then the write is allowed ONCE.
        let scope = target_scope_hash(&["term-1"]);
        let crate::command_risk::approval::MintOutcome::Minted { approval_id, .. } =
            mint_command_approval(g.registry(), &o, "rest", "s1", "git commit -m x", &scope)
        else {
            panic!("review should mint");
        };
        assert!(g
            .check(
                &ctx("rest", "s1", &t, Some(&approval_id), &o),
                b"git commit -m x\r"
            )
            .is_ok());
        // Replay with the same (now consumed) id -> denied again.
        assert!(g
            .check(
                &ctx("rest", "s1", &t, Some(&approval_id), &o),
                b"git commit -m x\r"
            )
            .is_err());
    }

    #[test]
    fn split_frame_destructive_command_is_caught_and_never_reaches_the_pty() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // Partial (unterminated) frames are HELD: the gate returns NOTHING to write, so the
        // destructive text never reaches the shell line.
        assert!(g
            .check(&ctx("rest", "s1", &t, None, &o), b"rm ")
            .unwrap()
            .is_empty());
        assert!(g
            .check(&ctx("rest", "s1", &t, None, &o), b"-rf ")
            .unwrap()
            .is_empty());
        // The terminator completes the assembled command -> denied; nothing is written.
        let err = g
            .check(&ctx("rest", "s1", &t, None, &o), b"/tmp/x\r")
            .unwrap_err();
        assert!(err.catastrophic, "the reassembled command is denied");
        // The attack's final move: a SEPARATE bare Enter. Because the destructive text was
        // never written, the bare Enter writes only itself and can execute nothing queued.
        let writable = g.check(&ctx("rest", "s1", &t, None, &o), b"\r").unwrap();
        assert_eq!(
            writable, b"\r",
            "only the Enter is written; no queued destructive text"
        );
    }

    #[test]
    fn an_allowed_command_is_emitted_only_at_its_terminator() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // Typing "ls" without Enter writes nothing yet (held until classified).
        assert!(g
            .check(&ctx("rest", "s1", &t, None, &o), b"ls")
            .unwrap()
            .is_empty());
        // The Enter completes + approves the line: the WHOLE "ls\r" is emitted at once.
        assert_eq!(
            g.check(&ctx("rest", "s1", &t, None, &o), b"\r").unwrap(),
            b"ls\r"
        );
    }

    #[test]
    fn newline_terminator_also_flushes_a_submission() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // A \n-terminated injection (no \r) must NOT bypass the gate.
        let err = g
            .check(&ctx("rest", "s1", &t, None, &o), b"rm -rf /tmp/x\n")
            .unwrap_err();
        assert!(err.catastrophic);
    }

    #[test]
    fn approval_is_scoped_to_its_target_terminal() {
        let g = gate();
        let o = CommandRiskOptions::default();
        let scope_a = target_scope_hash(&["term-A"]);
        let crate::command_risk::approval::MintOutcome::Minted { approval_id, .. } =
            mint_command_approval(g.registry(), &o, "rest", "s1", "git commit -m x", &scope_a)
        else {
            panic!("mint");
        };
        // Same command + approval, but a DIFFERENT terminal -> the scoped binding mismatches.
        let other = vec!["term-B".to_string()];
        assert!(g
            .check(
                &ctx("rest", "s1", &other, Some(&approval_id), &o),
                b"git commit -m x\r"
            )
            .is_err());
    }

    fn atomic_ctx<'a>(targets: &'a [String], opts: &'a CommandRiskOptions) -> GateContext<'a> {
        GateContext {
            source_kind: "mcp-pane-input",
            session_id: "term-1",
            target_ids: targets,
            approval_id: None,
            options: opts,
            atomic: true,
        }
    }

    #[test]
    fn atomic_mode_classifies_a_trimmed_bare_command_without_a_terminator() {
        // The MCP pane-input path delivers a TRIMMED command (no \r). In atomic mode the
        // whole payload is classified, so a destructive bare command is still refused while
        // a benign one passes.
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        assert!(
            g.check(&atomic_ctx(&t, &o), b"rm -rf /tmp/x")
                .unwrap_err()
                .catastrophic
        );
        assert!(g.check(&atomic_ctx(&t, &o), b"git status").is_ok());
    }

    #[test]
    fn oversized_unterminated_input_is_refused() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let big = vec![b'a'; MAX_BUFFER_BYTES + 1];
        assert!(g.check(&ctx("rest", "s1", &t, None, &o), &big).is_err());
    }

    #[test]
    fn no_db_fails_closed_for_approved_review_but_allows_benign() {
        // Without a durable audit sink, a benign command still passes, but a review command
        // can never be evidenced -> denied even with a freshly minted approval.
        let g = CommandRiskGate::new(None);
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        assert!(g.check(&ctx("rest", "s1", &t, None, &o), b"ls\r").is_ok());
        let scope = target_scope_hash(&["term-1"]);
        let crate::command_risk::approval::MintOutcome::Minted { approval_id, .. } =
            mint_command_approval(g.registry(), &o, "rest", "s1", "git commit -m x", &scope)
        else {
            panic!("mint");
        };
        let err = g
            .check(
                &ctx("rest", "s1", &t, Some(&approval_id), &o),
                b"git commit -m x\r",
            )
            .unwrap_err();
        assert!(err.reason.contains("fail-closed"));
    }
}
