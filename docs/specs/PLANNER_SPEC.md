# Autonomous Planner & Orchestration Loop Spec (WU-5.1 / 5.2)

> ⚠️ **v2.0 merge-model update (2026-06-15) — read first.** The authoritative
> requirements ([AELYRIS_COCKPIT_REQUIREMENTS](./AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md),
> v2.0) now specify **full autonomy with no human gate in the critical path**: the
> **Reviewer agent merges to `main` automatically** once all quality gates are green,
> and the **watchdog auto-decides** tool-approval instead of routing to a human. The
> "sequential **gated** merge / never self-grants / surfaced to the human (never
> auto-granted)" language below describes the **superseded v1 gate model** — under
> v2 the loop merges automatically via the Reviewer on all-green gates and does not
> pause for a human. The round/budget runaway guard, star comms, and reviewer ≠
> implementer rule remain.

Status: Draft (docs only). The **capstone** of the autonomous team-dev loop.
Owns: how throwing a one-line task at the orchestrator becomes requirements → WU decomposition →
fleet dispatch → parallel impl/test/review → star-comms → sequential gated merge → repeat.

> This is the **only missing layer** of the vision. Everything downstream already exists or is
> being built: pane split + launch (`mux_split_pane` / fleet), the implementer/tester/reviewer
> roles (Orchestra), star comms (`send_keys_by_target` / `.fleet/`), merge (`control/merge.rs`,
> WU-3.x). The planner is the *front half* that produces work for them.

## 0. Insight

The planner is the **automation of what a human orchestrator does by hand**. The exemplar is this
very repo's `CODEX_HANDOFF.md`: a one-line objective ("make Aelyris a cockpit") became an audit →
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
- Build last — it assembles the whole stack. Until then, the **`aelyris-plan` skill** lets an orchestrator agent perform 5.1 manually (§5).

## 5. Skill bridge (usable today, before the in-app feature exists)

The **`aelyris-plan`** project skill packages the 5.1 planning procedure so an orchestrator agent
(Opus) can do it now: one-liner → spec + `wu-manifest.json` → hand to the `aelyris-fleet` skill for
dispatch. It composes with `aelyris-fleet` (execution). Deeper planning patterns: `blueprint`
(objective → construction plan + DAG), `ralphinho-rfc-pipeline` (RFC-driven multi-agent DAG +
quality gates + merge queue), `devfleet` (plan → parallel dispatch → monitor).
