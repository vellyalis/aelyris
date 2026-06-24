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

/// How the gate processes a write path's bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateMode {
    /// A single API call carries a complete (often trimmed) command — classify the WHOLE
    /// payload at once. Used by the MCP pane/safe input verbs.
    Atomic,
    /// A programmatic byte stream — HOLD unterminated bytes and emit only complete, approved
    /// lines (nothing reaches the PTY until a submission is allowed). Used by REST/WS input
    /// and the IPC send-keys verbs. Interactive echo is NOT expected here.
    HoldUntilApproved,
    /// An INTERACTIVE TUI stream that needs char-by-char echo — pass non-terminator bytes
    /// through (so the shell echoes), mirror the assembled line, and classify on each
    /// `\r`/`\n`. A blocked submission does NOT forward Enter; a neutralization byte (Ctrl-C)
    /// is emitted instead to clear the pending line, so a destructive command never executes
    /// while normal typing keeps echoing.
    EchoPreserving,
}

/// What a write needs to be gated: who/where, the optional approval id carried by the
/// write, the path-scope options, and the gate mode + whether a `review` command requires
/// an approval id here (the external API face) or is allowed (the local IPC face — only
/// `deny`/catastrophic is hard-blocked there; the FE dialog is the review UX).
pub struct GateContext<'a> {
    pub source_kind: &'a str,
    pub session_id: &'a str,
    /// One terminal id, or the broadcast target set — bound into the approval's target scope.
    pub target_ids: &'a [String],
    pub approval_id: Option<&'a str>,
    pub options: &'a CommandRiskOptions,
    pub mode: GateMode,
    pub review_requires_approval: bool,
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

        match ctx.mode {
            // ATOMIC: the API call is the submission boundary — classify the WHOLE payload as
            // one command (no buffering; a split across calls is caught because each fragment
            // is itself classified, and the policy treats anything non-trivial as
            // review/deny). On approval the whole payload is the writable output.
            GateMode::Atomic => {
                let command = String::from_utf8_lossy(data);
                self.enforce_command(&command, ctx, &scope)?;
                Ok(data.to_vec())
            }
            GateMode::HoldUntilApproved => self.check_hold(ctx, data, scope),
            GateMode::EchoPreserving => self.check_echo_preserving(ctx, data, &scope),
        }
    }

    /// HOLD mode: accumulate per `{source, target}`; emit ONLY complete, approved lines.
    /// Unterminated bytes are held inside the gate (never written) so a destructive line can
    /// never be pre-typed and then run by a later bare Enter. A `deny`/unapproved line aborts
    /// the whole batch — nothing is written.
    fn check_hold(
        &self,
        ctx: &GateContext,
        data: &[u8],
        scope: String,
    ) -> Result<Vec<u8>, Box<GateDenial>> {
        let key = format!("{}\u{0}{}", ctx.source_kind, scope);
        let lines = {
            let mut map = self.buffers.lock().unwrap_or_else(|p| p.into_inner());
            let buf = map
                .entry(key)
                .or_insert_with(|| BufferState { bytes: Vec::new() });
            if buf.bytes.len().saturating_add(data.len()) > MAX_BUFFER_BYTES {
                buf.bytes.clear();
                return Err(self.oversized_denial(ctx, scope));
            }
            buf.bytes.extend_from_slice(data);
            let (lines, remainder) = split_complete_lines(&buf.bytes);
            buf.bytes = remainder; // hold the incomplete trailing bytes (NOT written)
            lines
        };
        let mut writable = Vec::new();
        for (content, term) in &lines {
            let command = String::from_utf8_lossy(content);
            self.enforce_command(&command, ctx, &scope)?;
            writable.extend_from_slice(content);
            writable.push(*term);
        }
        Ok(writable)
    }

    /// ECHO-PRESERVING mode (interactive TUIs): non-terminator bytes pass through immediately
    /// (so the shell echoes each keystroke) while a per-`{source, target}` mirror reassembles
    /// the pending line. On each `\r`/`\n` the mirror is classified: an `allow`/approved line
    /// forwards the terminator (Enter executes); a blocked line emits a neutralization byte
    /// (Ctrl-C) INSTEAD of Enter, clearing the shell line so the command never runs. On the
    /// local IPC face `review` is permitted (only catastrophic `deny` is neutralized) — the FE
    /// dialog is the review UX — unless `review_requires_approval` is set for this context.
    fn check_echo_preserving(
        &self,
        ctx: &GateContext,
        data: &[u8],
        scope: &str,
    ) -> Result<Vec<u8>, Box<GateDenial>> {
        // Phase 1 (under the buffer lock): split the input into echo runs and the assembled
        // lines to classify, updating the mirror. No classification/audit happens under the
        // lock. Each element is (echoed_bytes, Option<(assembled_line, terminator_bytes)>). A
        // `\r\n` pair within one payload is ONE terminator so a denied CR is not followed by a
        // spurious blank LF (which would otherwise re-forward an Enter and pollute history).
        type Segment = (Vec<u8>, Option<(Vec<u8>, Vec<u8>)>);
        let key = format!("{}\u{0}{}", ctx.source_kind, scope);
        let segments: Vec<Segment> = {
            let mut map = self.buffers.lock().unwrap_or_else(|p| p.into_inner());
            let buf = map
                .entry(key)
                .or_insert_with(|| BufferState { bytes: Vec::new() });
            let mut segments: Vec<Segment> = Vec::new();
            let mut echo: Vec<u8> = Vec::new();
            let mut i = 0;
            while i < data.len() {
                let b = data[i];
                if b == b'\r' || b == b'\n' {
                    let mut term = vec![b];
                    if b == b'\r' && data.get(i + 1) == Some(&b'\n') {
                        term.push(b'\n'); // fold a paired CRLF into one terminator
                        i += 1;
                    }
                    let line = std::mem::take(&mut buf.bytes);
                    segments.push((std::mem::take(&mut echo), Some((line, term))));
                } else {
                    // Bound the mirror: an over-long unterminated line stops mirroring further
                    // bytes but still echoes them, so when Enter arrives it classifies the
                    // truncated head — never silently allowing an unclassifiable line.
                    if buf.bytes.len() < MAX_BUFFER_BYTES {
                        buf.bytes.push(b);
                    }
                    echo.push(b);
                }
                i += 1;
            }
            if !echo.is_empty() {
                segments.push((echo, None)); // trailing keystrokes, no submission yet
            }
            segments
        };
        // Phase 2 (no lock held): echo bytes pass; each completed line is classified and the
        // terminator is forwarded only if it is allowed, else replaced with a single Ctrl-C.
        let mut out = Vec::new();
        for (echo, terminated) in segments {
            out.extend_from_slice(&echo);
            if let Some((line, term)) = terminated {
                let command = String::from_utf8_lossy(&line);
                match self.enforce_command(&command, ctx, scope) {
                    Ok(()) => out.extend_from_slice(&term), // allowed/approved/blank: executes
                    Err(_denial) => out.push(0x03),         // blocked: Ctrl-C clears the line
                }
            }
        }
        Ok(out)
    }

    fn oversized_denial(&self, ctx: &GateContext, scope: String) -> Box<GateDenial> {
        Box::new(GateDenial {
            reason: "command input exceeds the classifiable size limit".to_string(),
            severity: None,
            classes: Vec::new(),
            preview: String::new(),
            command_hash: None,
            source_kind: ctx.source_kind.to_string(),
            target_scope_hash: scope,
            catastrophic: true,
        })
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
                // The local IPC face does not require an approval id for `review` — only
                // catastrophic `deny` is hard-blocked there (the user chose the "Balanced"
                // policy; the FE shell-safety dialog is the interactive review UX). The
                // external API face sets `review_requires_approval` so a remote/agent caller
                // must mint + carry a single-use approval id.
                if !ctx.review_requires_approval {
                    return Ok(());
                }
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
            // The streaming/accumulator tests model the external API face: HOLD mode with
            // `review` gated on an approval id. Atomic + echo-preserving have their own tests.
            mode: GateMode::HoldUntilApproved,
            review_requires_approval: true,
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
            mode: GateMode::Atomic,
            review_requires_approval: true,
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

    /// The local IPC interactive face: echo-preserving mode, `review` allowed (Balanced).
    fn echo_ctx<'a>(
        source: &'a str,
        targets: &'a [String],
        opts: &'a CommandRiskOptions,
    ) -> GateContext<'a> {
        GateContext {
            source_kind: source,
            session_id: "term-1",
            target_ids: targets,
            approval_id: None,
            options: opts,
            mode: GateMode::EchoPreserving,
            review_requires_approval: false,
        }
    }

    #[test]
    fn echo_preserving_passes_keystrokes_and_forwards_enter_for_an_allowed_line() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // Char-by-char typing echoes each byte immediately (interactive TUIs need this).
        for (i, ch) in b"ls".iter().enumerate() {
            let out = g.check(&echo_ctx("ipc-write", &t, &o), &[*ch]).unwrap();
            assert_eq!(out, vec![*ch], "keystroke {i} must echo through");
        }
        // Enter completes an allowed line -> the terminator is forwarded so it executes.
        assert_eq!(
            g.check(&echo_ctx("ipc-write", &t, &o), b"\r").unwrap(),
            b"\r"
        );
    }

    #[test]
    fn echo_preserving_neutralizes_a_destructive_line_instead_of_running_it() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        // The whole "rm -rf /tmp/x\r" arrives in one payload (e.g. a fast typist / IME commit
        // of one line): the keystrokes echo, but the Enter is replaced with Ctrl-C so the
        // shell line is cleared and the destructive command NEVER executes.
        let out = g
            .check(&echo_ctx("ipc-write", &t, &o), b"rm -rf /tmp/x\r")
            .unwrap();
        assert_eq!(out, b"rm -rf /tmp/x\x03");
        assert!(!out.contains(&b'\r'), "no Enter reaches the PTY for a deny");
    }

    #[test]
    fn echo_preserving_allows_a_review_line_on_the_local_face() {
        // Balanced policy: a `review` command (git commit) typed interactively is NOT blocked
        // on the local IPC face — the Enter is forwarded. Only catastrophic `deny` neutralizes.
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let out = g
            .check(&echo_ctx("ipc-write", &t, &o), b"git commit -m x\r")
            .unwrap();
        assert_eq!(out, b"git commit -m x\r");
    }

    #[test]
    fn echo_preserving_neutralizes_a_split_typed_destructive_line() {
        // The destructive command is typed across many keystroke writes, then Enter: the
        // mirror reassembles it and the final Enter is replaced with Ctrl-C.
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        for ch in b"rm -rf /tmp/x" {
            g.check(&echo_ctx("ipc-write", &t, &o), &[*ch]).unwrap();
        }
        let out = g.check(&echo_ctx("ipc-write", &t, &o), b"\r").unwrap();
        assert_eq!(
            out, b"\x03",
            "the lone Enter becomes Ctrl-C; nothing executes"
        );
    }

    #[test]
    fn echo_preserving_folds_crlf_into_one_terminator_for_a_denied_line() {
        // A `\r\n`-terminated destructive submission must yield a SINGLE Ctrl-C, not
        // `\x03` + a spurious `\n` (which would re-forward an Enter and pollute history).
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let out = g
            .check(&echo_ctx("ipc-write", &t, &o), b"rm -rf /tmp/x\r\n")
            .unwrap();
        assert_eq!(out, b"rm -rf /tmp/x\x03");
        assert!(!out.contains(&b'\n'), "no spurious LF after the Ctrl-C");
    }

    #[test]
    fn echo_preserving_forwards_crlf_intact_for_an_allowed_line() {
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let out = g.check(&echo_ctx("ipc-write", &t, &o), b"ls\r\n").unwrap();
        assert_eq!(out, b"ls\r\n", "an allowed CRLF line keeps both bytes");
    }

    #[test]
    fn hold_mode_balanced_face_allows_review_without_an_approval_id() {
        // The local programmatic face (send-keys) uses HOLD mode but Balanced policy: a
        // `review` command is emitted without an approval id; only `deny` is refused.
        let g = gate();
        let t = vec!["term-1".to_string()];
        let o = CommandRiskOptions::default();
        let balanced = GateContext {
            source_kind: "ipc-send-keys",
            session_id: "s1",
            target_ids: &t,
            approval_id: None,
            options: &o,
            mode: GateMode::HoldUntilApproved,
            review_requires_approval: false,
        };
        assert_eq!(
            g.check(&balanced, b"git commit -m x\r").unwrap(),
            b"git commit -m x\r"
        );
        // Catastrophic is still hard-blocked even on the Balanced face.
        let deny = GateContext {
            source_kind: "ipc-send-keys",
            session_id: "s1",
            target_ids: &t,
            approval_id: None,
            options: &o,
            mode: GateMode::HoldUntilApproved,
            review_requires_approval: false,
        };
        assert!(g.check(&deny, b"rm -rf /tmp/x\r").unwrap_err().catastrophic);
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
