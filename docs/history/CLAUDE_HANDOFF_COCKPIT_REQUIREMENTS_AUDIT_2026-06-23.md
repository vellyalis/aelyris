# Claude Handoff - Aether Cockpit Requirements Audit

Date: 2026-06-23 12:30 JST

Status: REVIEW, not GO.

This repo has moved well past the old `CODEX_HANDOFF.md` line that says
"docs only / no source code written yet". The core autonomous cockpit substrate
exists, but the full requirement is not completely proven or fully implemented.

## Concept Boundary

Yes: the target is an upper concept over tmux / BridgeSpace / loop engineering.
It is not just "split terminals". The intended system is:

- tmux/WezTerm-class persistent multi-pane terminal mechanics.
- BridgeSpace-style visible shared workspace where agents are real, inspectable
  panes, not hidden batch jobs.
- Loop-engineering autonomy: one instruction -> Task Graph -> parallel workers ->
  review -> merge -> repeat.
- Shared brain: Context Store, Event Bus, Intent Bus, Knowledge Graph, and
  activity/blocker streams so agents coordinate through a common world model.
- Governance: worktree isolation, file/symbol ownership, all-green review gates,
  Reviewer merge authority, Cost Manager caps, and post-hoc human override.

## Current Verdict

The product is partially satisfying the Aether Cockpit / AI Agent OS v1.0
requirements:

- PASS: capability layer scaffold, Task Graph, Event Bus, Context Store, Cost
  Manager, MCP surface, Reviewer merge model, and core loop tests exist.
- PASS: Rust lib tests passed: `933 passed; 0 failed`.
- PASS: focused frontend tests passed: `8 files / 46 tests`.
- PASS: `verify-mcp-orchestrator-surface`, `verify-control-layer-scaffold`,
  `verify-cockpit-batch-a-readiness`, and `verify-cockpit-batch-b-readiness`.
- REVIEW: visible-pane evidence exists from 2026-06-20/21 screenshots, and the
  code path now dispatches loop workers into visible PTY panes, but today's live
  re-run was blocked by local `spawn EPERM` and missing API bearer token.
- REVIEW: function/symbol awareness exists, but function-level collision
  avoidance is not yet the full spec.
- BLOCK for release claim: current `score-release-quality` generated
  `.codex-auto/quality/release-quality-score.json` with `score=33`,
  `total=112`, `max=335`, grade `D`, `releaseCandidateReady=false`. Read this
  as 33% / 112 of 335 points, not "33 of 335 points". The low score is heavily
  affected by stale evidence, host gates, and explicit-consent gates, but the
  current artifact still means no production GO claim until refreshed proof is
  present.

## Reconciliation After Claude Review

Claude's follow-up review correctly narrows several findings. Treat this section
as the current correction layer over the initial audit above.

- Cost cap mismatch was real in the earlier tree and was not a typo-only bug:
  the runtime default of 8 was an intentional product choice for a
  larger/livelier fleet, while the requirements and MCP instruction said
  default 4. The current working tree now changes the default to
  `max_agents=4`, keeps it configurable upward, and the focused cost tests pass.
  Treat this as a Claude/user-side fix to review and keep, not as an open
  mismatch.
- Symbol/function ownership is not currently a write-race safety hole because
  the existing file/output lane gate is conservative. Reclassify it as:
  P0 for the advertised product claim "parallel work inside one file by
  disjoint functions", but not P0 as an immediate data-corruption safety bug.
  Without symbol ownership, the product should claim safe file-level isolation,
  not function-level parallel editing.
- `verify-agent-team-orchestration-readiness` router diagnosis was too broad.
  The current verifier's `router-ui-dispatch-contract` passes after the
  whitespace/CRLF-tolerant fallback check. Current remaining failures are
  `mux-daemon-performance-and-restore-current` and `source-artifact-freshness`.
- `verify-upper-compat-gates` no longer crashes on missing `stderr`; it now
  writes a `status=blocked` artifact when cargo spawn is denied. In this Codex
  shell the command still returns `spawnSync cargo EPERM`, so the correct local
  classification is environment-blocked, not verifier crash.
- Release score wording is corrected: current artifact says 33% with 112/335
  points. A projected high score after refreshing stale/host/consent evidence is
  not a current GO until `scripts/score-release-quality.mjs` itself writes the
  refreshed S/A-grade artifact.

## Production Engineering Direction

Build this as a durable local distributed system, not as a demo UI around
terminal panes. The correct route may be longer, but it should make failures
observable, recoverable, and testable.

Principles:

- Backend is the source of truth. React renders state; it must not own agent
  lifecycle, task lifecycle, locks, merge authority, or safety decisions.
- Every long-running operation needs a durable state transition, timeout,
  cancellation path, and recovery path.
- Every external process or CLI is unreliable by default: spawn can fail, PTY
  attach can fail, auth can expire, output parsing can be partial, and the app
  must degrade into a clear blocked state rather than crash or claim success.
- Coordination must be explicit and data-driven. No hidden "the UI knows" or
  "the prompt says so" contracts for ownership, review, or merge.
- Fast paths are acceptable only after the slow, correct path exists and is
  covered by gates.

Preferred implementation technologies and boundaries:

- Rust/Tauri backend:
  - Keep orchestration, ownership, task state, merge state, cost state, and
    audit evidence in Rust modules behind typed service APIs.
  - Use Tokio tasks only behind supervisors. Each supervisor should emit typed
    state transitions and own process kill/cleanup.
  - Use `portable-pty`/ConPTY only through a pane runtime abstraction that can
    report `spawn_failed`, `attached`, `ready`, `running`, `exited`, `lost`,
    and `recovered`.
- SQLite persistence:
  - Persist Task Graph, agent sessions, pane bindings, file/symbol claims,
    review decisions, merge intents, cost ledger, and validation artifacts.
  - Prefer transactions and idempotent writes. A retry must not double-merge,
    double-charge, or leave stale locks.
  - Store enough event history to reconstruct the cockpit after app restart.
- Event Bus / Context Store:
  - Treat the Event Bus as the live notification layer, not the only record.
    Durable state belongs in SQLite-backed stores.
  - Use typed event schemas with version fields so future UI and MCP changes do
    not silently break older artifacts.
- Symbol ownership:
  - Use LSP `documentSymbol` as the first source of function/class/component
    ranges.
  - Add parser-backed extraction for major repo languages before relying on
    regex. Regex is only a low-confidence fallback that should default to
    file-level exclusivity.
  - Claims must have leases, heartbeats, confidence, and release-on-merge /
    release-on-fail cleanup.
- MCP/API surface:
  - Keep MCP tools small, typed, and idempotent. Tools should return machine
    readable blocker reasons, not just text.
  - Auth failures must produce explicit `unauthorized` artifacts in verifiers.
- Frontend:
  - Use the current React/Tauri UI only as an operator cockpit. It should show
    task state, pane state, lock state, blocker state, and cost state from the
    backend.
  - UI should never infer merge readiness locally.

Reliability and error-tolerance requirements:

- Define a single lifecycle state machine for task, agent, pane, review, and
  merge. Illegal transitions should be rejected and tested.
- Add heartbeats for visible panes and agent sessions. Missing heartbeat moves
  the lane to `lost` or `blocked`, not `running`.
- Add leases for file and symbol claims. Expired leases must be visible and
  releasable by recovery logic.
- Add retry with bounded exponential backoff for recoverable process/API
  failures. Non-recoverable failures must create typed blockers.
- Add crash recovery: after restart, the app should reload tasks, panes,
  claims, costs, and pending review/merge intents, then mark uncertain external
  processes as `needs_reconcile`.
- Add verifier hardening: no verifier should throw on missing `stderr`,
  missing token, blocked spawn, closed port, or stale artifact. It should write
  PASS/FAIL/BLOCKED with exact blocker details.

Release-quality bar:

- Do not call this complete until unit, integration, verifier, UI, and long-run
  stability evidence all agree.
- Required before a world-facing release:
  - Full `cargo test`, `pnpm test`, `pnpm build`, and release-quality score.
  - Current-date live pane proof with at least 3 concurrent agents.
  - Current-date shared-brain proof showing Task Graph + Context Store + Event
    Bus + ownership state synchronized.
  - Symbol conflict proof: same file / disjoint functions can run together;
    overlapping functions serialize or block.
  - Reviewer merge proof: reviewer is not implementer; all gates green before
    merge; merge is idempotent.
  - Soak test: repeated planner -> workers -> review -> merge loops over many
    cycles without stale locks, orphan panes, runaway cost, or state drift.
  - Fault-injection tests for CLI spawn failure, PTY detach, token expiry,
    blocked port, killed child process, stale branch, failing tests, and app
    restart during review.

## Evidence Map

Primary passing checks run this turn:

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - Result: `933 passed; 0 failed`.
- `pnpm test -- src/__tests__/agentStatusContract.test.ts src/__tests__/taskStatusContract.test.ts src/__tests__/orchestrator.test.ts src/__tests__/orchestraRoles.test.ts src/__tests__/orchestraDispatch.test.ts src/__tests__/useTaskGraph.test.ts src/__tests__/useCostManager.test.ts src/__tests__/OrchestratorPanel.test.tsx`
  - Result: `8 passed (8)`, `46 passed (46)`.
- `node scripts/verify-mcp-orchestrator-surface.mjs`
  - Result: PASS.
  - Artifact: `.codex-auto/quality/mcp-orchestrator-surface.json`.
- `node scripts/verify-control-layer-scaffold.mjs`
  - Result: PASS.
  - Artifact: `.codex-auto/quality/control-layer-scaffold.json`.
- `node scripts/verify-cockpit-batch-a-readiness.mjs`
  - Result: PASS.
  - Artifact: `.codex-auto/quality/cockpit-batch-a-readiness.json`.
- `node scripts/verify-cockpit-batch-b-readiness.mjs`
  - Result: PASS.
  - Artifact: `.codex-auto/quality/cockpit-batch-b-readiness.json`.
- `node scripts/verify-right-rail-information-density.mjs`
  - Result: PASS.
  - Artifact: `.codex-auto/quality/right-rail-information-density-contract.json`.

Current failed/blocked checks:

- `node scripts/verify-agent-team-orchestration-readiness.mjs`
  - Result: FAIL.
  - Current failed checks: `mux-daemon-performance-and-restore-current`,
    `source-artifact-freshness`.
  - Current passed check: `router-ui-dispatch-contract`.
- `node scripts/verify-mux-performance.mjs`
  - Result: BLOCKED by `spawn EPERM`.
- `node scripts/verify-mux-live-restore.mjs`
  - Result: FAIL, error `spawn EPERM`.
- `node scripts/verify-upper-compat-gates.mjs`
  - Result: BLOCKED artifact, `cargo-spawn-failed`, `spawnSync cargo EPERM`.
  - Previous verifier crash on missing `stderr` has been fixed.
- `node scripts/verify-orchestrator-step-live.mjs`
  - Result: BLOCKED by `spawnSync git EPERM` before the CDP/IPC part.
- `Test-NetConnection 127.0.0.1 -Port 9222`
  - Result: true.
- `Test-NetConnection 127.0.0.1 -Port 9333`
  - Result: true.
- `QUORUM_API_TOKEN=dev node scripts/verify-mcp-task-surface-live.mjs`
  - Result: HTTP 401. Current bearer token is not available in this shell.

Visual artifacts inspected:

- `C:\tmp\aether-demo-shots\fleet-working.png`
- `C:\tmp\aether-demo-shots\fleet-split.png`
- `.codex-auto/production-smoke/fleet-hud.png`
- `.codex-auto/production-smoke/shell-dispatch.png`

They show real split panes and fleet HUD state, but they are not today's live
green evidence.

## Implemented Capabilities

These are real in code now:

- Visible loop dispatch:
  - `src-tauri/src/ipc/orchestrator_commands.rs:39-46` defines
    `orchestrator_step` as the live Task Graph step that dispatches ready tasks
    into visible PTY panes.
  - `src-tauri/src/ipc/orchestrator_commands.rs:85-115` connects each dispatched
    terminal to frontend rendering and emits `AgentSpawned`.
  - `src-tauri/src/control/loop_ports.rs:393-419` documents and implements the
    `PaneDispatcher` path: interactive TUI in a visible PTY pane, not headless
    `-p`.
- Reviewer merge:
  - `src-tauri/src/api/mcp.rs:417-419` exposes `aether.review.approve` as
    Reviewer authority.
  - `src-tauri/src/api/mcp.rs:1113-1160` performs the real merge after claiming
    the queued intent.
  - `src-tauri/src/control/loop_ports.rs:806-819` has a unit test proving green
    review moves `main` to the feature tip.
- Task Graph:
  - `src-tauri/src/task/status.rs:10-31` defines the lifecycle:
    `pending, ready, running, blocked, review, done, failed`.
  - `src-tauri/src/task/graph.rs:48-82` includes owner, deps, outputs,
    source/target branches.
  - `src-tauri/src/task/graph.rs:276-306` recomputes READY from dependencies.
- Shared brain:
  - `src-tauri/src/context_store/mod.rs:1-9` implements shared ADR decisions.
  - `src-tauri/src/api/mcp.rs:1455-1470` broadcasts `decision_changed`.
  - `src-tauri/src/event_bus/mod.rs:1-8` defines the star-backed typed Event Bus.
  - `src-tauri/src/event_bus/mod.rs:100-126` maps event kinds to channels.
- Ownership and coordination:
  - `src-tauri/src/file_ownership/mod.rs:1-7` implements declarative path claims.
  - `src-tauri/src/file_ownership/mod.rs:140-150` enforces conservative
    pattern-overlap lane collision detection.
  - `src-tauri/src/control/loop_ports.rs:618-655` claims file lanes on dispatch
    and releases them on merge.
  - `src-tauri/src/api/mcp.rs:586-617` exposes ownership tools over MCP.
- Symbol/knowledge awareness:
  - `src-tauri/src/api/mcp.rs:659-693` exposes agent activity with
    `file/symbol/action`.
  - `src-tauri/src/knowledge_graph/mod.rs:1-9` defines symbol-level blast-radius
    intent.
  - `src-tauri/src/knowledge_graph/mod.rs:188-192` implements transitive impact.
- Cost Manager:
  - `src-tauri/src/cost/mod.rs:1-7` documents spawn and budget caps.
  - `src-tauri/src/cost/mod.rs:98-132` blocks spawns at cap and detects budget
    exhaustion.

## Required Fixes For Claude

### Resolved candidate - Review the Cost Manager cap fix

Requirement says default worker batch is 3-4 and `max_agents` default is 4
(`docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md:96-132`).

Earlier code defaulted to 8:

- `src-tauri/src/cost/mod.rs:15-36`
- `src-tauri/src/cost/manager.rs:66-90`

Current working tree now defaults to 4:

- `src-tauri/src/cost/mod.rs` uses `max_agents: Some(4)`.
- `src-tauri/src/cost/manager.rs` tests now assert the 4-agent cap.
- `src-tauri/src/api/mcp.rs` already says `concurrency cap 4`.

Acceptance:

- `cargo test --manifest-path src-tauri/Cargo.toml cost:: --lib` passed:
  `10 passed; 0 failed`.
- Keep the runtime-configurable path for explicit 8+ agent stress/demo fleets.
- If UI/frontend tests assert the old cap, update them to the 4-agent default.

### P0 product-claim gap - Implement real function/symbol ownership enforcement

The current system prevents file/output-lane collisions and reports
`file/symbol/action`, but it does not yet implement the full
`VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` symbol-claim model:

- Required by spec: `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md:445-506` and
  `:599-604`.
- Current implementation: file patterns plus live symbol strings and Knowledge
  Graph impact, but no range-based `SymbolClaim`, lease, confidence, LSP/parser
  extraction, overlap gate, or UI conflict badge scoped to symbol ranges.

This is not currently an immediate write-race safety bug because file/output
lane ownership is conservative. It is P0 for the product claim "agents avoid
function-level conflicts while parallelizing inside the same file". Until this
exists, the accurate claim is file-level safe isolation, not function-level
parallel editing.

Claude should add a narrow `symbol_ownership` slice:

- Rust module: `src-tauri/src/symbol_ownership/`.
- Data: `SymbolClaim { claim_id, agent_id, task_id, path, symbol, range,
  mode, lease_expires_at, confidence }`.
- Conflict rule: same path and overlapping line ranges conflict for writes;
  disjoint symbols in same file are parallel-safe.
- Extractors: LSP `documentSymbol` first, parser/diff-hunk fallback second,
  file-level fallback last.
- MCP/IPC tools: `symbol.claim`, `symbol.release`, `symbol.conflicts`,
  `symbol.claims`.
- Scheduler: `run_step_visible` and MCP `orchestrator.step` must consult symbol
  claims before co-dispatch. File ownership remains the conservative fallback.
- UI: pane header/agent rail should show file + symbol; conflict badge should
  distinguish file-level fallback from LSP/parser confidence.

Acceptance:

- Unit tests for overlap/non-overlap ranges and lease expiry.
- Orchestrator tests proving two tasks in same file but disjoint functions can
  dispatch together, while overlapping ranges serialize or block.
- MCP surface verifier extended for symbol tools.
- Visual/DOM proof for conflict badge and parallel-safe indicator.

### P1 - Keep `verify-agent-team-orchestration-readiness` current

The earlier `router-ui-dispatch-contract` failure has been corrected in the
current verifier. The check is now whitespace/CRLF tolerant and passed in the
2026-06-23 re-run.

- Implementation exists:
  - `src/App.tsx` calls `routeOrchestraPrompts`.
  - `src/shared/lib/orchestraDispatch.ts` routes via `route_agent`, normalizes
    routed model names, passes `initialPrompt`, and passes `branchName`.
  - Focused tests passed in `src/__tests__/orchestraDispatch.test.ts`.

Acceptance:

- `node scripts/verify-agent-team-orchestration-readiness.mjs` should keep
  `router-ui-dispatch-contract` green.
- Remaining failures should be limited to real stale/blocked evidence such as
  mux performance/live-restore freshness, not router/source layout false
  negatives.

### P1 - Refresh mux / upper-compat evidence on an unsandboxed host

This Codex shell hit Windows spawn restrictions:

- `verify-mux-performance`: `spawn EPERM`
- `verify-mux-live-restore`: `spawn EPERM`
- `verify-orchestrator-step-live`: `spawnSync git EPERM`
- `verify-upper-compat-gates`: now reports `status=blocked`,
  `reason=cargo-spawn-failed`, `code=EPERM`

Claude should not paper this over as product success. Run from a normal
PowerShell where Node can spawn child processes:

```powershell
node scripts/verify-mux-performance.mjs
node scripts/verify-mux-live-restore.mjs
node scripts/verify-upper-compat-gates.mjs
node scripts/verify-agent-team-orchestration-readiness.mjs
```

If spawn works and gates still fail, fix product code. If spawn is blocked, keep
the explicit environment-blocked artifact. Do not mark the gate green without
fresh mux and upper-compat proof.

### P1 - Re-run live MCP and visible-pane proofs with the current bearer token

Ports were open:

- CDP: `127.0.0.1:9222` true.
- API: `127.0.0.1:9333` true.

But the shell did not have the current `QUORUM_API_TOKEN`; old `dev` token
returned HTTP 401. Claude should get the current token from the dev log or start
Tauri with an explicit token, then run:

```powershell
$env:QUORUM_API_TOKEN='<current-token>'
node scripts/verify-mcp-task-surface-live.mjs
node scripts/verify-shared-brain-live.mjs
node scripts/verify-autonomy-loop-live.mjs
```

For real pane proof, after explicit AI-token consent and with Claude CLI
authenticated:

```powershell
node scripts/verify-dispatch-pane.mjs
node scripts/verify-fleet-split.mjs
node scripts/verify-fleet-working.mjs
node scripts/verify-interactive-tui.mjs
```

Acceptance:

- Current-date artifacts or screenshots, not 2026-06-20/21 screenshots.
- Evidence proves 1 agent = 1 visible PTY pane, interactive TUI/no `-p`, live
  task state, and review/merge loop.

### P2 - Update stale specs/handoff text

`docs/specs/CODEX_HANDOFF.md` still says "Design complete; no source code
written yet" while implementation clearly exists. This causes bad task routing.

Claude should update `CODEX_HANDOFF.md` or add a current status appendix:

- Mark completed/partially completed WUs.
- Point to current artifacts.
- Keep v2 Reviewer-merge model authoritative.
- Preserve the do-not-break test gates.

## Suggested Claude Prompt

Use this prompt directly:

```text
You are Claude working in <repo>.

Read docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md,
docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md, and
docs/specs/CLAUDE_HANDOFF_COCKPIT_REQUIREMENTS_AUDIT_2026-06-23.md.

Do not restart from CODEX_HANDOFF's stale "no source code written yet" status.
The current repo already has Task Graph, Event Bus, Context Store, Cost Manager,
MCP orchestration, Reviewer merge, file ownership, visible pane dispatch, and
knowledge graph primitives.

Your job:
1. Review and keep the current Cost Manager fix: default max_agents is now 4,
   configurable upward, and focused cost tests pass.
2. Implement real symbol/function ownership enforcement as a product-claim gap,
   using file ownership as the conservative safety fallback.
3. Refresh mux performance/live-restore and upper-compat evidence from a host
   where child process spawn is allowed.
4. Re-run focused tests and the orchestration gates. If live host gates are
   blocked by spawn EPERM or missing bearer token, preserve an explicit
   environment-blocked artifact instead of claiming green.

Engineering bar:
- Prefer the slower robust design over a quick green artifact.
- Backend Rust state is authoritative; React only renders it.
- Persist task, pane, claim, review, merge, and cost state in durable stores.
- Add leases, heartbeats, recovery paths, idempotency, and typed blockers.
- Harden verifiers so blocked host conditions are reported as BLOCKED, not
  crashes and not PASS.
- Do not claim production readiness until symbol-level conflict proof,
  current-date live pane proof, shared-brain proof, reviewer-merge proof, and
  soak/fault-injection evidence are all present.

Do not push or open PRs. This project is local-only.
```

## Final Classification

The architecture direction is understood and mostly materialized. This is an
upper-layer autonomous engineering workspace, not a terminal skin.

It is not yet safe to claim the full condition:

> AI agents run in real panes in parallel, synchronize through a shared brain,
> avoid function-level conflicts, review, and merge all-green work end-to-end.

Current accurate statement:

> The repo has the main backend and UI substrate for that model, with passing
> core tests and MCP/static gates. It still needs function-level ownership
> enforcement, cap/spec reconciliation, refreshed live pane/MCP evidence, and
> verifier cleanup before it can be called complete.
