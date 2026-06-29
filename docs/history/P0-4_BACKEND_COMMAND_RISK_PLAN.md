# P0-4 — Backend command-risk enforcement (locked goal)

Security WU from `AELYRIS_WORLD_RELEASE_HARDENING_AUDIT_2026-06-23.md` §P0-4. Goal
locked with Codex (independent reviewer, different model) on 2026-06-24 via the
`codex-guided-implementation` skill. This file is the drift fence for every increment.

## The vulnerability being closed
Destructive-command risk is classified only in the FRONTEND (`src/shared/lib/shellSafety.ts`);
"Run anyway" is not a hard boundary. Backend write paths (REST, MCP, Tauri IPC, native
input, sidecar) write raw bytes to a PTY with NO backend policy. The FE approval is also
replayable (command-hash match, no one-time token).

## Design (Codex-ruled)
- **One Rust `CommandRiskGate`** is the canonical, backend-authoritative policy seam. Every
  command-carrying write path (REST/MCP adapters; IPC adapters before `terminal_write_async`)
  calls it BEFORE the lower write. NOT inside `PtyManager::write`/`PtySidecarClient::write`
  (they lack source/approval context and the sidecar is a different process).
- **Line-accumulator (split-frame defense):** the gate keeps a BOUNDED per-`{sourceKind,
  terminalId}` accumulator and classifies each assembled line on `\r`/`\n`. A full paste/
  submit payload classifies atomically before any byte is written. This defeats a caller
  splitting `rm -rf /\r` across frames, and also catches interactively-typed destructive
  lines. No shell-echo reconstruction; the buffer is bounded to prevent abuse.
- **Policy port:** port `shellSafety.ts` faithfully to Rust `command_risk` (15 DANGEROUS_PATTERNS,
  8 class detectors, `maskQuotedShellText`, severity tree: destructive|unsafe-path → deny;
  review-classes|multiline → review; else allow; redaction). A **shared golden corpus** drives
  BOTH the Rust unit tests and the existing Vitest so the two policies cannot drift. Rust is
  authoritative; the FE copy is advisory UX only.
- **Approval id:** a `CommandApprovalRegistry` (modeled on `TicketRegistry`) issues a SINGLE-USE
  token bound to `(policyVersion, commandHash, sourceKind, sessionId, targetScopeHash)`
  (`targetScopeHash` = one terminal id, or sorted broadcast target ids). Mint classifies and
  REFUSES `allow` (no token needed) and `deny` (catastrophic — no token ever); rate/caps live
  approvals; consume is one-shot under one mutex. The gate consumes the id exactly once and only
  when ALL five fields match the assembled command being written.
- **Catastrophic (`deny`):** HARD-DENY in P0-4. No owned-worktree carve-out (no command-time
  authority yet to prove all affected paths are under a registered non-main worktree). A weak
  exception is worse than none — deferred follow-up.
- **Audit:** every decision (allowed/denied/approved) appends an `AuditJournalAppend`
  (`kind: "command_risk_decision"`, `source: "command-risk-gate"`) BEFORE the write, FAIL-CLOSED
  (no PTY write if the append fails). Payload stores a TRUNCATED REDACTED preview + command hash
  (not the full command; journal cap 256 KiB, frames up to 1 MiB).

## HARD BOUNDARIES (verbatim — non-negotiable, mechanically checkable)
1. No Rust path in api/*, ipc/*, or mcp.rs may call PtyManager::write, state.pty.write, PtySidecarClient::write, or terminal_write_async for command-carrying input unless CommandRiskGate has allowed the same assembled command for the same source and target scope.
2. A command approval id is valid for exactly one consume and only when policyVersion, commandHash, sourceKind, sessionId, and targetScopeHash all match the consuming write.
3. Severity deny never executes in P0-4; any future owned-worktree exception must prove canonical affected paths under a registered non-main worktree before minting or consuming approval.
4. Risk audit is append-before-write and fail-closed: denied or approved command input must not reach PTY unless command_risk_decision was durably appended with redacted payload evidence.
5. Frontend command-risk classification is advisory only; backend Rust policy is authoritative for REST, MCP, Tauri terminal input, native terminal input, and sidecar-backed writes.

## Ordered increments (each gates green + Codex-reviewed before commit)
1. **Rust classifier port** — `command_risk` module (patterns/classes/severity/redaction/mask),
   shared golden corpus driving Rust + Vitest. Acceptance: Rust matches the FE corpus for
   classes/severity/redaction; cargo tests cover deny/review/allow/unsafe-paths/secrets.
2. **Approval registry + audit builder** — `CommandApprovalRegistry` (TTL, one-shot, 5-field
   binding, parallel double-consume) + `command_risk_decision` audit append (append-before-write,
   fail-closed, truncated redacted preview + hash).
3. **REST/MCP guards** — `/sessions/{id}/input`, WS stream, `/mux/.../input`,
   `mux.workspace.safeInput`, `aelyris.pane_send_input`: deny without approval, allow once with it,
   reject replay AND the split-frame bypass (line accumulator).
4. **Tauri/native/send-keys guards** — `write_terminal`, `native_terminal_input_commit`/`paste`,
   `send_keys` + broadcasts + by-{name,role,target}; guard BEFORE `terminal_write_async` (covers
   the sidecar). Replace/relegate the divergent native paste substring guard.
5. **Frontend approval flow** — classifier becomes preview-only; handle the backend structured
   denial; mint an approval id; resubmit with it; surface catastrophic hard-deny.
6. **Verifier** — `scripts/verify-security-backend-command-risk.mjs`: deny without id, one-shot
   replay failure, redacted `command_risk_decision` evidence, and NO unguarded command-carrying
   backend write remains.

## Inc4 — operator decision + gate modes (implemented 2026-06-24)
The IPC face needs char-by-char echo for live TUIs, which a pure hold-gate breaks. Codex ruled
REVISE-SCOPE: hard-gate the programmatic/paste/command-center paths AND add an echo-preserving
submit gate for interactive typing. The human operator then chose the **"Balanced"** local policy:
- **External API face (REST/WS/MCP, incl. the sidecar daemon):** unchanged — `deny` blocked,
  `review` requires a minted single-use approval id (`review_requires_approval = true`).
- **Local Tauri IPC face:** `deny` (catastrophic — the DANGEROUS_PATTERNS set: `rm -rf`,
  `git reset --hard`, `git clean -fd`, `dd if=`, `mkfs`, `curl|sh`, `>/dev/sd*`, …) is ALWAYS
  hard-blocked; `review` (e.g. `git commit`, `npm install`, `mkdir`) is ALLOWED
  (`review_requires_approval = false`) — the FE shell-safety dialog is the interactive review UX.
  Rationale: neutralizing every review command in interactive typing makes the terminal unusable,
  and the human typing on their own keyboard is not the injection threat; programmatic injection
  (REST/MCP/send-keys) is still fully gated.

Three `GateMode`s: `Atomic` (whole-payload classify — MCP, native paste, command-center submit),
`HoldUntilApproved` (accumulate, emit only complete approved lines — REST/WS, send-keys family),
`EchoPreserving` (interactive typing — echo keystrokes, classify on `\r`/`\n`, replace a denied
terminator with a single Ctrl-C so the catastrophic line never executes). A per-terminal
write-order lock (`TERMINAL_WRITE_ORDER`) holds the gate-check + PTY write atomic per terminal so
echoed chars and the neutralizing Ctrl-C cannot reorder (closes the Codex split-write race).

### Documented residual (acceptable under Balanced, NOT silently absorbed)
Echo-preserving necessarily writes echoed characters to the PTY's pending shell line before the
user submits. In the window between the human's last keystroke and their own Enter, a *different*
source's bare Enter to the same terminal (e.g. a concurrent agent `send_keys "\r"`) could submit
the pending line. This is NOT a remote/programmatic injection bypass: a catastrophic command sent
*as a command* through ANY gated path (REST/MCP/send-keys/paste/command-center) is hard-blocked;
only char-by-char interactive typing — where the human themselves typed the catastrophic chars —
has this window. Full submits (paste/command-center) use `Atomic` and are fully gated. Accepted as
an inherent property of a shared interactive terminal under the Balanced local policy.

### Inc4 Codex review status
First Inc4 review (whole increment) → FIX-FIRST: 2 CRITICAL (sidecar API ungated; echo-preserving
write-reordering race) + 1 LOW (CRLF double-terminator). All three fixed forward (sidecar gate
wired in `pty-server/src/main.rs`; per-terminal write-order lock; CRLF folding). The re-review of
the fix-forward was self-reviewed (grep call-graph + trace) because Codex hit its usage limit
(resets 2026-06-25); a Codex pass over the fix-forward is folded into the Inc6 whole-WU review.

## Follow-ups (explicitly deferred, NOT silently absorbed)
- Owned-worktree carve-out for catastrophic commands (needs a command-time canonical-path authority).
- Single-source policy (codegen / FE-calls-Rust) to retire the FE/Rust duplication; for P0-4 the
  shared golden corpus is the anti-drift guard.
- Re-run the Codex review over the Inc4 fix-forward (sidecar gate + write-order lock + CRLF) once
  the usage limit resets, at the latest as part of the Inc6 whole-WU review.
