# Aelyris Decisions

Status: active decision log. Add entries when a repeated design question should
not be re-litigated by future agents.

## Decision Rule

A decision entry records why, not just what. If the reason changes, update the
entry and the owning spec/verifier in the same work unit.

## Promotion Rule (Memory To Decisions)

Session memory, local-only handoff files, and chat context are not authority.
When a judgment from those sources is reused twice, or would change how a
future agent decides, promote it into an ADR entry here (or into the owning
spec) in the same work unit. Promotion is one-way: tracked docs never copy
from local-only files without re-verifying against current source and
verifier truth.

## ADR-001 Tauri + Rust Backend

Decision: Use Tauri v2 with a Rust backend and React frontend.

Why:

- Windows-native terminal/runtime integration matters.
- Rust can own PTY, sidecar, persistence, governance, and native process safety.
- React is used for cockpit projection and workflow UI.

Implication: Runtime truth belongs in Rust; React projects it.

## ADR-002 Visible PTY For Human-Visible Agents

Decision: Human-visible implementation agents run in visible PTY panes with
interactive TUI. Do not use `-p` / `--print` for GUI-visible panes.

Why:

- Operators need to see and steer real sessions.
- Hidden stdout drains are not debuggable enough for supervised work.
- Pane truth must match what the agent sees.

Implication: Headless `-p` remains for planner/reviewer/batch/no-webview flows
only.

## ADR-003 Worktree Isolation

Decision: Parallel agent work should use isolated git worktrees and branches.

Why:

- Prevents agents from overwriting one working tree.
- Makes review, proof, and merge intent easier to bind to exact commits.
- Keeps rollback and cleanup tractable.

Implication: A task that edits the project should declare its worktree/branch
lane or explain why it is not needed.

## ADR-004 Contracts Before UI

Decision: Backend contracts and verifiers precede product UI claims.

Why:

- UI-only flows create false confidence.
- Proofbooks, Remote Continuity, MCP, and merge readiness need durable state and
  typed errors before visual polish.

Implication: UI can render Rust runner/state projections, but cannot synthesize
executable mock flows.

## ADR-005 Proofbooks Over Generic Playbooks

Decision: Proofbooks are evidence-backed automation routines, not generic prompt
chains.

Why:

- Aelyris differentiates through proof: artifacts, hashes, verifier output,
  gates, residual blockers, and merge readiness.
- Generic automation without evidence does not solve trust.

Implication: The Proofbook runner/ledger is rigid. Unsupported future step types
fail closed.

## ADR-006 MCP Is An Adapter, Not A Second Runtime

Decision: MCP exposes the same capability layer through typed tools,
inputSchema validation, governance, and audit.

Why:

- Cockpit and AI control plane must not drift.
- A second dispatcher or catalog would create inconsistent authority.

Implication: New MCP verbs delegate to existing domain owners.

## ADR-007 Remote Continuity Uses Daemon-Owned State

Decision: Remote Continuity syncs daemon-owned state. SSH attach is a transport,
not the state owner.

Why:

- tmux-style SSH access is valuable, but Aelyris's advantage is whole-fleet
  state: panes, agents, Proofbooks, approvals, ownership, and merge readiness.
- Letting SSH own state would bypass governance and fragment truth.

Implication: Remote monitor ships read-only first; SSH/TUI observe mode uses
leases; remote input waits for scoped principal, command-risk, and audit proof.

## ADR-008 No Premature Abstraction

Decision: Duplication is acceptable until a real pattern appears. Abstract only
when it removes meaningful complexity or matches an established local pattern.

Why:

- Early abstraction hides domain boundaries.
- AI agents often over-generalize from one or two call sites.

Implication: Prefer small explicit modules. Extract after the third repeated
shape or when the owner boundary is already clear.

## ADR-009 Verifier-Backed Claims

Decision: Product and capability claims require matching verifier evidence.

Why:

- Aelyris has historical stale green snapshots.
- Current machine truth must outrank old prose.

Implication: Release/capability copy does not change unless the relevant gate is
green and current.