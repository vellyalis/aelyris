# Aether Cockpit Requirements

Status: Active implementation requirements
Date: 2026-06-13
Source: docs/specs/CODEX_HANDOFF.md plus the Phase 0/1, UI Token Dial,
Cockpit UX, and MCP Tool Surface specs.

## Goal

Aether Terminal must become an agent-controllable workspace terminal. The
human Cockpit UI and the Orchestrator AI must consume the same backend
capability layer instead of separate ad hoc command paths. The product target
is a native-first hybrid terminal that can run 3-4 coding agents in parallel,
each isolated in a git worktree, with human supervision by exception.

## Binding Requirements

1. Aether Control API
   - Provide one backend capability layer for worktree, agent, pane, diff,
     merge, and approval domains.
   - Tauri IPC and the future `aether.mcp.v1` server must be thin adapters over
     the same domain functions.
   - Worktree, agent, pane, and diff operations are free for the orchestrator.
   - Approval and merge-to-main operations are gated. AI may request or observe
     them, but may not grant approvals or merge into main directly.

2. Agent Runtime Unification
   - Define `AgentRunStatus` once in Rust with the canonical states:
     `spawning`, `thinking`, `coding`, `running_tests`,
     `waiting_approval`, `blocked`, `idle`, `done`, `error`.
   - Keep a TS mirror contract until generated bindings exist.
   - Converge headless and interactive runtime state into one `AgentSession`
     model and one `useAgentFleet` hook.
   - Preserve current telemetry/log/role metadata while migrating.

3. Worktree Safety
   - Use one Rust branch-name validator and one worktree-path predictor.
   - Orchestra lanes must receive deterministic branch names and default to
     isolated worktrees for multi-lane dispatch.
   - Branch naming must reject empty, too-long, Unicode, unsafe prefix, path
     traversal, and colon-containing names.

4. Cockpit UI
   - Right rail should be an orchestrator state view, not a telemetry dump.
   - Always-visible surfaces should prioritize current focus, blocked agents,
     approval needs, merge/conflict waiting, next action, and Git/VS Code/toolkit
     operations.
   - Detailed logs, cost, context, and health telemetry should stay drill-down
     surfaces unless actively needed.

5. Multi-Agent Operations
   - Provide attention-first agent rail, approval inbox, fleet grid, branch-vs-
     target diff, merge queue, and native toasts in the order required by the
     dependency DAG.
   - Merge queue is the defining missing capability and must remain gated.
   - Output monitor must map CLI-specific status signals into canonical
     `AgentRunStatus`.

6. UI Token Dial
   - Increase legibility without adding more visual noise.
   - Text must remain fully opaque while glass material layers carry
     translucency.
   - Raise role type aliases, border alpha, selected-surface contrast, and
     uppercase kicker tracking.
   - Remove heavy 800-950 font weights from glass chrome in favor of size,
     color, and semibold/medium semantic weights.
   - Preserve the single-blur rule: no nested child may add another
     `backdrop-filter`.

7. Verification
   - Each work unit must leave focused tests or machine-readable proof.
   - Required gates include branch/status contract tests, right-rail density
     gates after UI changes, orchestration readiness after dispatch changes,
     and full safe/finalize/closeout gates before production claims.
   - External/operator gates remain separate from implementation defects:
     release signing/updater material, real OS sleep/resume, and explicit paid
     AI CLI prompt consent.

## Work Unit Order

1. Batch A: UI token dial, shared branch validator, `AgentRunStatus` contract.
2. Batch B: `AgentSession` / `AgentFleet` / `useAgentFleet` adapters and control
   layer scaffold.
3. Batch C: Orchestra worktree auto-wiring and router UI connection.
4. Batch D: cockpit surfaces and FREE MCP tools.
5. Batch E: merge backend, merge queue, and gated MCP merge request.
6. Batch F: kanban agent launcher, native toasts, inline review, parser cleanup,
   and god-file decomposition.

## Acceptance Definition

Implementation-side readiness requires all relevant focused tests, right-rail
and orchestration verifiers, build, safe, finalize, and closeout gates to pass
with no implementation-fixable blocker. Production release readiness still
requires external/operator gates to be completed on the appropriate host and
with explicit user consent where paid AI tokens are consumed.
