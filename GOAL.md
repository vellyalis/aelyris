# Aelyris Goal

Status: active product goal. Not a release-readiness claim.

## Purpose

Aelyris is a local-first, Windows-first AI development workspace for running and
supervising parallel AI coding agents on a real project.

It exists to make multi-agent development visible, coordinated, evidence-backed,
and merge-safe.

## Target Users

- Engineers who want several AI agents working safely in parallel without
  hand-wiring worktrees, terminals, locks, gates, and audit trails.
- Non-engineers using AI-assisted development who need guardrails, visibility,
  proof, and review paths instead of hidden background automation.
- Operators who need to check fleet state, approvals, Proofbooks, blockers, and
  merge readiness from the cockpit and, later, through Remote Continuity.

## North Star

Aelyris should become a proof-first AI-team OS:

- one visible PTY pane per implementation agent,
- isolated worktrees per lane,
- live ownership down to symbol/function level,
- Proofbooks for rerunnable evidence-backed automation,
- governed approval and merge readiness,
- Remote Continuity for external inspection and SSH/TUI attach through daemon
  state, not SSH-owned state.

## Current Claim Boundary

Aelyris is alpha / active development / not release-ready.

Current safe substrate claim:

> Aelyris has a Rust/Tauri terminal, mux, sidecar, visible-agent, MCP, worktree,
> ownership, review, merge, and scoped Proofbook runtime substrate.

Do not claim production readiness, full BridgeSpace-plus workspace completion,
Scape-plus automation completion, Remote Continuity completion, or tmux-level
persistence until the relevant verifiers are green.

Current machine truth still records `releaseCandidateReady=false`. Regenerate
it with `pnpm verify:quality-score` instead of quoting scores from prose.

## Product Priorities

1. Preserve contract and safety correctness.
2. Make agent work visible and inspectable.
3. Prevent parallel agents from colliding.
4. Convert successful work into proof, not trust.
5. Keep local-first operator control.
6. Make remote state inspection safe before remote control.
7. Promote claims only after machine proof.

## Non-Goals

- Aelyris is not a hosted cloud IDE.
- Aelyris is not a replacement for every coding agent CLI.
- Aelyris is not a generic SSH terminal product.
- Aelyris is not release-ready because a design document says so.
- Aelyris should not hide agent work behind invisible subprocesses for human-
  visible implementation tasks.