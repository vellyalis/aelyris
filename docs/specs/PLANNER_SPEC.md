# Autonomous Planner & Orchestration Loop Spec (WU-5.1 / 5.2)

> **Implementation status (2026-07-02, verified against code in this repo).**
> Implemented today:
>
> - MCP orchestrator verbs `aelyris.orchestrator.plan` and
>   `aelyris.orchestrator.step` (`src-tauri/src/api/mcp.rs`): `plan` computes a
>   scheduling plan over the task graph under cost caps; `step` drives the
>   dispatch → review → gated-merge cycle (with optional mechanical
>   `gateCommands` run in each task's worktree).
> - Plan validation: `validate_plan` (`src-tauri/src/task/planner.rs`).
> - Objective → task-plan decomposition: `decompose_to_plan`
>   (`src-tauri/src/task/decompose.rs`).
> - Plan submission into the task graph: `TaskManager::submit_plan`
>   (`src-tauri/src/task/manager.rs`).
> - Replanning of failed tasks: `replan_into` (`src-tauri/src/task/replan.rs`)
>   via `TaskManager::replan_failed_task`.
>
> Still design only (not implemented): an in-app planner UI, an in-process
> conductor that runs the full loop unattended, and the LLM one-liner →
> `scripts/fleet/wu-manifest.json` emission pass described in §1. Sections 1–2
> below describe the target design; where they say a layer is missing, check the
> modules above first.

> ⚠️ **Merge-model update (2026-06-15) — read first.** The authoritative
> requirements ([docs/requirements.md](../requirements.md)) describe a **bounded
> autonomy** model: agents can dispatch, review, and merge through **gated controls**,
> and autonomy is bounded by verifier gates (this is alpha). The loop can merge via
> the Reviewer (reviewer ≠ implementer) only on all-green gates. The "sequential
> **gated** merge / never self-grants / surfaced to the human (never auto-granted)"
> language below describes the **earlier v1 gate model** — treat it as historical on
> the *merge* and *human-grant* axes. The round/budget runaway guard, star comms, and
> reviewer ≠ implementer rule remain.

Status: partially implemented (see the implementation status banner above).
The **capstone** of the autonomous team-dev loop.
Owns: how throwing a one-line task at the orchestrator becomes requirements → WU decomposition →
fleet dispatch → parallel impl/test/review → star-comms → sequential gated merge → repeat.

> Much of this pipeline is now implemented in code: the MCP orchestrator verbs
> (`aelyris.orchestrator.plan` / `aelyris.orchestrator.step`), plan validation
> (`task/planner.rs`), decomposition (`task/decompose.rs`), plan submission
> (`TaskManager::submit_plan`), and replanning (`task/replan.rs`) — see the
> status banner. Everything downstream also exists or is being built: pane
> split + launch (`mux_split_pane` / fleet), the implementer/tester/reviewer
> roles (Orchestra), star comms (`send_keys_by_target` / `.fleet/`), merge
> (`control/merge.rs`, WU-3.x). The remaining open items are the in-app planner
> UI, the in-process conductor loop, and the LLM one-liner →
> `wu-manifest.json` emission pass.

## 0. Insight

The planner is the **automation of what a human orchestrator does by hand**. The exemplar is this
earlier spec-index workflow: a one-line objective ("make Aelyris a cockpit") became an audit ->
5 specs → 26 Work Units with a dependency DAG. WU-5.1 makes an LLM (Opus) do that planning pass
and emit the result as `scripts/fleet/wu-manifest.json` — the contract `fleet-dispatch` already reads.

## 1. WU-5.1 — Planner: one-liner → spec + `wu-manifest.json`

| Aspect | Spec |
|---|---|
| Input | A one-line dev task. |
| Output | (a) a requirements doc under `docs/specs/`, (b) new/extended entries in `scripts/fleet/wu-manifest.json` (schema: `id/title/slug/phase/spec/files/deps/suggestedAgent/notes`). |
| Steps | **understand** (read the relevant subsystems) → **requirements** (write the spec) → **decompose** (WUs) → **self-review** (adversarial: is each WU self-contained, deps correct, gates named, do-not-break traps flagged?). |
| Decomposition rules | Cut on **independence seams** (front/back, by domain). **Contract-first**: freeze shared types/IPC signatures first, serially (see TYPE_BRIDGE_SPEC). Cap parallel batch at **3–4**. Every WU independently **mergeable + testable**; no file overlap within a parallel batch. |
| Where it runs | An "orchestrator" entry point. Reuse the Orchestra path (`buildOrchestraPrompts`, `App.tsx:4779`) but prepend a **planning pass** that calls the agent runtime (headless `claude.rs` stream-json, structured output) to produce the manifest JSON before dispatching. |
| Model | **Opus** (deep reasoning for requirements/decomposition/integration — the orchestrator seat). |
| Contract | Emits the exact `wu-manifest.json` schema; the manifest is the frozen planner↔dispatcher contract. |
| Reuse vs NEW | NEW: the planning pass (LLM → manifest) + a schema validator. Reuse: Orchestra dialog, agent runtime, the manifest format. |
| Effort | L |

## 2. WU-5.2 — Autonomous loop: plan → dispatch → monitor → review → merge → repeat

| Aspect | Spec |
|---|---|
| Behavior | Drive the full loop: planner (5.1) → `fleet` dispatch into worktrees (`spawn_interactive_agent`, one per WU, routed by `suggestedAgent`) → roles run in parallel (implementer/tester/reviewer) → observe via `output_monitor` + `ghostdiff` → sequential merge via the merge queue (WU-3.2) behind the gates → next batch, until WUs are done or a round/budget cap is hit. |
| Comms | **Star topology only** — the loop controller is the bus: steer with `send_keys_by_target`, share results via `.fleet/` artifacts. No peer-to-peer. |
| Human role | Supervise **by exception**: the approval inbox (WU-2.2) and toasts (WU-4.2) surface only what needs a human. |
| Safety (binding) | `approval` and `merge-to-main` stay **GATED** (`control/approval.rs` → `PendingUser`). The loop **never self-grants** approval or merges to main without the gate. A runaway guard caps rounds/concurrency. |
| Reuse vs NEW | NEW: the loop controller (state machine over batches) + round/budget guard. Reuse: 5.1, fleet, Orchestra roles, merge queue, gate engine. |
| Effort | L |

## 3. Acceptance criteria

- **5.1:** a one-line task yields a valid `wu-manifest.json` (passes a schema check) that `fleet-dispatch.ps1 list` shows and can dispatch; the emitted WUs have correct deps and non-overlapping files within each parallel batch.
- **5.2:** the loop takes ≥2 WUs from plan to **merged** state with all gates green; every `approval`/`merge-to-main` decision is surfaced to the human (never auto-granted); the loop halts cleanly at the round/budget cap.

## 4. Dependencies & sequencing (Phase 5 — capstone)

- **5.1** depends on WU-0.1/0.2/0.3 (the fleet session model + manifest contract) and the Orchestra path.
- **5.2** depends on 5.1 + WU-3.2 (merge queue) + the cockpit surfaces (2.1/2.2) for human supervision.
- Build last — it assembles the whole stack. Until then, the implemented backend pipeline (§5) lets an orchestrator agent perform the planning half manually.

## 5. Manual bridge (before the in-app feature exists)

> Historical note: earlier revisions of this section pointed at `aelyris-plan`
> and `aelyris-fleet` project skills under `.claude/skills/`. Those skills no
> longer exist in this repository; do not look for them.

Until the in-app planner UI and in-process conductor land, an orchestrator
agent can drive the implemented backend pipeline directly:

- Decompose an objective with `decompose_to_plan`
  (`src-tauri/src/task/decompose.rs`), validate with `validate_plan`
  (`src-tauri/src/task/planner.rs`), and submit with
  `TaskManager::submit_plan` (`src-tauri/src/task/manager.rs`); these are
  exposed to the app through the Tauri IPC commands in
  `src-tauri/src/ipc/task_commands.rs` (e.g. `task_submit_plan`), while MCP
  clients create tasks via `aelyris.task.create`.
- Drive the loop with `aelyris.orchestrator.plan` /
  `aelyris.orchestrator.step` (`src-tauri/src/api/mcp.rs`), which schedule
  ready tasks, review finished agents, and perform gated merges.
- For fleet-manifest-based dispatch, `scripts/fleet/wu-manifest.json` and
  `scripts/fleet/fleet-dispatch.ps1` remain the manifest contract and
  dispatcher.
