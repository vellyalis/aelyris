# Aether Cockpit Requirements — AI Agent OS v1.0 superset

Status: Active implementation requirements
Version: 2.0 (AI Agent OS v1.0 superset)
Originally: 2026-06-13 · Revised: 2026-06-15
Source: docs/specs/CODEX_HANDOFF.md plus the Phase 0/1, UI Token Dial,
Cockpit UX, and MCP Tool Surface specs, expanded to absorb the
"AI Agent OS v1.0" vision (single-instruction autonomous multi-agent build).

## Changelog vs v1 (2026-06-13)

This revision turns the requirements doc into a **superset** of the earlier
cockpit spec. The earlier doc remains correct as the *first milestone*; v2 adds
the four subsystems and the agent-to-agent governance model the v1.0 vision
names, and **reverses one load-bearing invariant** (user decision, 2026-06-15):

- **CHANGED — merge authority.** v1 forbade any AI from merging to `main`
  (watchdog + human gate only). v2 grants **merge authority to the Reviewer
  agent**: after all quality gates are green, the Reviewer merges. The human
  moves from mandatory gate to monitor-and-override. See Binding Requirement 9
  and "Compensating controls" — this inverts statements still present in
  CODEX_HANDOFF §1/§3, MCP_TOOL_SURFACE §3.5/§4.4, PHASE_0_1 §5, PLANNER_SPEC §2,
  which must be updated in lockstep (see "Cross-spec reconciliation").
- **ADDED subsystems** (were absent/implicit): Task Graph, Event Bus,
  Context Store, Cost Manager (Binding Requirements 4–7).
- **ADDED governance**: explicit Planner/Worker/Reviewer hierarchy, pause/resume,
  declarative file ownership, structured failure policy, and the
  `task.*`/`event.*`/`context.*` MCP verbs.
- **RECONCILED (kept v1 defaults, made configurable)**: parallel agent cap stays
  **3–4 by default** (not "variable/10") with a configurable ceiling; comms stays
  **star-topology** as the v1 transport but now carries a **typed event taxonomy**
  (the Event Bus is the controller's typed broadcast, not peer-to-peer).
- **UNCHANGED (but non-blocking)**: the watchdog still governs dangerous shell/FS
  ops, but **auto-decides** (auto-approve / auto-deny) so it never pauses the
  loop; it is a separate axis from merge and keeps only an auto-deny floor for
  catastrophic/irreversible ops.

## Goal

Aether Terminal is an **agent-controllable workspace that runs a full
single-instruction autonomous build loop**. The user gives one instruction
(e.g. "build an authenticated e-commerce site"); the system autonomously
decomposes it into a Task Graph, spawns a Planner + Worker + Reviewer fleet,
isolates each worker in a git worktree, delegates tasks, reviews, and integrates
— producing the final artifact with the human supervising by exception.

The human Cockpit UI and the Orchestrator AI consume the **same backend
capability layer** (Aether Control API); they are two faces over one set of
domain functions, never separate ad hoc command paths. The product target is a
native-first hybrid terminal running 3–4 coding agents in parallel by default.

**Autonomy model (full auto).** The loop runs end-to-end with **no human gate in
its critical path** — including merge-to-`main`. The human is a **monitor with
optional, non-blocking post-hoc override/rollback**, never a required step.
Every safety control is **automated and non-blocking**: all-green quality gates
before merge, reviewer ≠ implementer (separation of duties), Cost Manager caps
(runaway/cost ceiling), and a watchdog **auto-deny floor** for
catastrophic/irreversible operations. The loop never pauses to ask a human.

## Design Principles

1. **Agents may write code freely; agents may not merge freely.** Writing is
   unrestricted inside an agent's own worktree. Merging is an authority held by
   the Reviewer agent (v2) and is permitted only on all-green gates — never by
   the implementer of the code being merged (separation of duties).
2. **Agents may spawn agents, under a hard cap.** Only the Planner tier spawns;
   the Cost Manager's caps (count/tokens/cost/runtime) block spawn when exceeded.
3. **All decisions are shared.** Architectural decisions live in the Context
   Store and a change broadcasts to every agent (DECISION_CHANGED).
4. **Prefer duplication over conflict.** Worktree isolation + declarative file
   ownership keep parallel lanes from colliding; never trade a clean parallel
   plan for a merge conflict.

## Binding Requirements

1. **Aether Control API (capability layer, two faces).**
   - One backend capability layer for worktree, agent, pane, diff, task, event,
     context, merge, and review domains.
   - Tauri IPC (Face 1, human Cockpit) and `aether.mcp.v1` (Face 2, orchestrator
     AI) are thin adapters over the same domain functions.
   - Worktree, agent, pane, diff, task, event, and context operations are free
     for the orchestrator. Dangerous shell/FS operations are governed by the
     **watchdog policy engine, which auto-decides (auto-approve / auto-deny)** so
     the loop never waits on a human; it keeps an **auto-deny floor** for
     catastrophic/irreversible ops (e.g. force-push to `main`, `rm -rf` outside a
     worktree, secret exfiltration). This is an automated guardrail, not a human
     gate.

2. **Agent Runtime Unification.**
   - Define `AgentRunStatus` once in Rust: `spawning`, `thinking`, `coding`,
     `running_tests`, `waiting_approval`, `blocked`, `idle`, `done`, `error`.
   - Keep a TS mirror contract until generated bindings exist.
   - Converge headless + interactive runtime state into one `AgentSession` model
     and one `useAgentFleet` hook. Preserve telemetry/log/role metadata.

3. **Agent Hierarchy (Planner / Worker / Reviewer).**
   - **Planner = 1** (Opus orchestrator seat): requirement analysis, task
     decomposition, spawn decisions, worktree strategy. May spawn; may not merge.
   - **Worker = variable, default batch 3–4** (configurable ceiling): implement,
     test, document inside an owned worktree. May edit code + report task done.
   - **Reviewer = 1**: review, quality control, **merge authority** (v2).
   - Comms is **star topology**: the Planner/loop-controller is the bus; no
     peer-to-peer. Shared results flow via `.fleet/` artifacts and typed events.

4. **Task Graph (new first-class subsystem).**
   - All work is a `Task`: `id, title, description, status, owner, priority,
     estimate, dependency[], outputs[]`.
   - Lifecycle: `PENDING → READY → RUNNING → BLOCKED → REVIEW → DONE | FAILED`.
   - A dependency graph gates `READY` (a task becomes READY when its deps are
     DONE). The `wu-manifest.json` plan is the static seed; the Task Graph is its
     runtime, stateful projection.

5. **Event Bus (new subsystem; star-backed transport).**
   - Named channels: `#planning`, `#backend`, `#frontend`, `#database`,
     `#review`, `#system`.
   - Event taxonomy: `TASK_CREATED`, `TASK_COMPLETED`, `DECISION_CHANGED`,
     `REVIEW_REQUIRED`, `AGENT_SPAWNED`, `WORKTREE_CREATED` (extensible).
   - v1 implementation: the loop controller publishes typed events on these
     channels; agents subscribe via the controller. This is the controller's
     typed broadcast, not peer-to-peer messaging.

6. **Context Store (new subsystem).**
   - One shared decision record (ADR-style): e.g. `auth_method`, `database`,
     `framework`. All agents read it for design alignment.
   - On change, broadcast `DECISION_CHANGED` to every agent. Distinct from the
     watchdog Decision Inbox (which handles tool-approval tickets).

7. **Cost Manager (new subsystem; runaway prevention).**
   - Hard caps: `max_agents` (default 4, configurable), `max_tokens`,
     `max_cost`, `max_runtime`, plus round/concurrency caps.
   - On exceed: **block new agent spawn** and halt the loop cleanly at the cap.
   - Fed by the existing `cost`/`tokens_used` telemetry on `AgentSession`.

8. **Worktree Safety + File Ownership.**
   - One Rust branch-name validator and one worktree-path predictor.
   - **1 agent = 1 worktree**; every fleet agent gets its own worktree by
     default so parallel lanes never collide. Shared editing is forbidden.
   - Branch naming rejects empty, too-long, Unicode, unsafe-prefix,
     path-traversal, and colon-containing names.
   - **Declarative file ownership** (new): the Planner assigns path patterns to
     agents (e.g. `src/auth/* → Agent #3`); `detectFileConflicts` enforces it
     across the fleet rather than only detecting overlap after the fact.

9. **Review Manager + Merge model (v2 — Reviewer merges).**
   - Every change is reviewed before merge. Review items: tests pass, lint, type
     check, design consistency, and **Context Store alignment**.
   - On all-green, the task moves to `READY_TO_MERGE` and the **Reviewer agent
     performs the merge** — *not* the implementer (separation of duties).
   - Merge queue remains the defining integration capability and is serialized
     per target branch to avoid conflicts.
   - **Compensating controls** (automated, non-blocking — they replace the human
     merge gate without pausing the loop): merge only on all-green gates;
     reviewer ≠ implementer; Cost Manager caps bound the loop; the watchdog
     auto-decides dangerous ops (auto-approve / auto-deny) without waiting on a
     human; and the human may **observe and override/rollback** any merge from
     the Cockpit **post-hoc** (never a required step).

10. **Cockpit UI.**
    - Right rail is an orchestrator state view, not a telemetry dump.
    - Always-visible surfaces prioritize current focus, blocked agents, approval
      needs, merge/conflict waiting, next action, and Git/VS Code/toolkit ops.
    - Detailed logs, cost, context, health stay drill-down unless actively needed.
    - Six surfaces: attention-first agent rail, approval inbox, fleet grid,
      branch-vs-target diff, merge queue, native toasts.
    - Terminal Manager exposes create/read/write/attach so Planner, Worker, and
      Reviewer panes are monitorable in real time.

11. **UI Token Dial.**
    - Raise legibility without more visual noise. Text stays fully opaque; glass
      layers carry translucency.
    - Raise role type aliases, border alpha, selected-surface contrast, uppercase
      kicker tracking. Remove heavy 800–950 weights in favor of size/color and
      semibold/medium. Preserve the single-blur rule (no nested `backdrop-filter`).

12. **Failure Policy (new).**
    - Agent crash → restart (bounded retries; surfaces to the Reviewer/human on
      repeated failure).
    - Task failure → notify the Reviewer and mark the Task `FAILED`.
    - Timeout → escalate to the Planner for re-plan or re-delegation.

13. **MCP surface (`aether.mcp.v1`).**
    - Existing FREE: `spawn_agent`, `stop_agent`, `fleet_status`, `send_steer`,
      `create_worktree`, `list_worktrees`, `remove_worktree`, `split_pane`,
      `agent_diff`, `list_pending_approvals`.
    - Existing GATED: `request_approval` (watchdog tool gate). `request_merge`
      becomes a Reviewer-executed merge in v2 (still serialized via the queue).
    - **New verbs** for the added subsystems: `task.create`, `task.assign`,
      `task.complete`, `task.fail`, `task.list`; `event.publish`,
      `event.subscribe`; `context.get`, `context.set`, `context.watch`;
      `agent.pause`, `agent.resume`; `review.request`, `review.approve`,
      `review.reject`.

14. **Verification.**
    - Each work unit leaves focused tests or machine-readable proof.
    - Required gates: branch/status contract tests, right-rail density gates
      after UI changes, orchestration readiness after dispatch changes, Task
      Graph lifecycle tests, Cost Manager cap tests, and full
      safe/finalize/closeout gates before production claims.
    - External/operator gates stay separate from implementation defects: release
      signing/updater material, real OS sleep/resume, explicit paid AI CLI
      prompt consent.

## Work Unit Order

1. **Batch A**: UI token dial, shared branch validator, `AgentRunStatus` contract.
2. **Batch B**: `AgentSession` / `AgentFleet` / `useAgentFleet` adapters and
   control-layer scaffold.
3. **Batch C**: Orchestra worktree auto-wiring, declarative file ownership, and
   router UI connection.
4. **Batch D**: cockpit surfaces and FREE MCP tools.
5. **Batch E**: merge backend + serialized merge queue + Reviewer-executed merge.
6. **Batch F**: kanban agent launcher, native toasts, inline review, parser
   cleanup, god-file decomposition.
7. **Batch G (new — Agent OS subsystems)**: Task Graph runtime + lifecycle,
   Event Bus channels/taxonomy, Context Store + DECISION_CHANGED, Cost Manager
   hard caps + spawn-blocking, pause/resume, failure policy, and the
   `task.*`/`event.*`/`context.*` MCP verbs.
8. **Batch H (new — autonomy)**: Planner end-to-end loop (one instruction →
   Task Graph → fleet → review → Reviewer merge → repeat until DONE or cap).

## Acceptance Definition

Implementation-side readiness requires all relevant focused tests, right-rail and
orchestration verifiers, Task Graph + Cost Manager tests, build, safe, finalize,
and closeout gates to pass with no implementation-fixable blocker.

**End-to-end autonomy** (v2 north star): the user inputs one instruction; the
Planner produces a Task Graph, worktrees, and Workers and delegates; Workers
implement in parallel; the Reviewer verifies and merges all-green work; the final
artifact is produced with the human supervising by exception. Production release
readiness still requires external/operator gates on the appropriate host and
explicit user consent where paid AI tokens are consumed.

## Cross-spec reconciliation

The v2 full-autonomy merge decision contradicts the human-gate language still
present in the sibling specs. As of 2026-06-15 each sibling spec carries a
**v2.0 merge-model banner** at its top that defers to this doc on the *merge*
and *human-grant* axes, so the package is internally consistent today. The
**detailed mechanics** (gate-flow diagrams, GATED tables, worked examples) are
rewritten to the auto model during **Batch E/G implementation** — the lines
below pinpoint what each rewrite must change:

- **CODEX_HANDOFF.md §1 (North star) + §3 (Shared contract)** — "`merge-to-main`
  is GATED … never expose a merge tool" → reframe: merge is performed by the
  Reviewer agent on all-green gates; the human role becomes monitor + override.
- **MCP_TOOL_SURFACE_SPEC §3.5 + §4.4** — `aether.request_merge` "Returns
  `queued`, never `done`; only a human grant merges" → the Reviewer executes the
  merge via the serialized queue; `request_merge` may resolve to `done` after the
  Reviewer's all-green verdict.
- **PHASE_0_1_ARCHITECTURE_SPEC §5** — "MUST NOT expose a free `merge_to_main`;
  the safety invariant of the whole design" → split the invariant: keep
  tool-approval gated; grant merge to the Reviewer with the compensating controls
  in Binding Requirement 9.
- **PLANNER_SPEC §2 (Safety)** — "the loop never self-grants … merges to main
  without the gate" → the loop merges via the Reviewer on green gates; retain the
  reviewer ≠ implementer rule and the round/budget caps.
- **README.md** — north-star paragraph + spec table updated to the v1.0 superset
  (Task Graph / Event Bus / Context Store / Cost Manager + Reviewer-merge).
