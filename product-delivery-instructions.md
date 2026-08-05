# Aelyris Product Delivery Work Order

STATUS: ACTIVE
PROGRAM: `product-delivery`
ENTRY GATE: PASSED at `f72a61b3d216ca6bc1ce87b84f4fe6567b8f90e0`, Required fast CI run `30876300708`.
CURRENT PHASE: `GMV` (General Mission Vertical).
ACTIVE SLICE: `GMV-3`.
LAST COMPLETED SLICE: `GMV-2`.
NEXT IMPLEMENTATION SLICE: `GMV-3`.

## Goal

Ship the first usable operator journey before doing more contract generalization.
The immediate product path is:

```text
plain-language goal in the cockpit
  -> generated TaskGraph plan visible in the cockpit
  -> explicit Run next step
  -> visible PTY implementation in isolated worktrees
  -> real project gates and independent review
  -> merge of only declared task outputs
```

The later Mission durability and exact-OID settlement layers extend this working
path. They do not precede it. This is not a new orchestration engine: `plan_build`,
`orchestrator_step`, TaskGraph, PaneFleet, worktree, PTY, review, and settlement
remain the existing owners.

## Portfolio Reset — 2026-08-04

The prior order was layer-first rather than value-first. `GMV-0` generalized a
backend contract with no UI, then queued product access behind three more layers.
That is rejected. In the 40 commits preceding this reset, 29 contained no product
source change and 27 were documentation, CI, test, or verifier centered. The global
bottleneck is now the missing supported cockpit path over capabilities that already
exist, not another proof surface.

Current portfolio classification:

| Workstream | Decision | Reason |
| --- | --- | --- |
| Cockpit goal -> plan -> visible run -> review -> merge | **COMPLETE** | Live exercised through the supported cockpit path on 2026-08-04 |
| Durable Mission binding and restart | **COMPLETE** | Goal, immutable planner identity, TaskGraph, branches/models/symbol intents, and mutable status restore from one SQLite authority |
| Exact-OID Mission settlement | **NOW** | Extend the proven path into immutable Mission completion without another generic merge engine |
| Native UI migration | **PARKED** | No measured blocker requiring migration before product access |
| Remote Continuity | **PARKED** | Local core journey is not yet complete |
| Proofbook product UI, Fleet Briefing, broad budget UX | **PARKED** | Adjacent value with lower current contribution |
| Signing, sleep, authenticated operator, external certification | **CERTIFICATION ONLY** | Blocks release claims, not repository product work |
| New top-level verifiers, reports, or historical phase replay | **REJECT BY DEFAULT** | Existing gates already decide the current slice |

## Entry And Lane Contract

- `audit-remediation-instructions.md` owns only the continuing operator/external
  certification handoff; its repo repair lane is closed.
- This work order is the sole repo-mutating product lane. `GMV-3` is active.
- The hosted-fast required CI entry gate passed at `f72a61b3`, run `30876300708`.
- Nightly/manual full-confidence verification and certification remain authoritative
  for release/public claims, but they do not make every bounded GMV slice wait idle.
  A fresh direct failure reopens its responsible owner before the next mutation checkpoint.
- Signing, real sleep, authenticated operator prompts, and external-service evidence
  may remain pending and continue to block release readiness without blocking this
  product lane. That certification-only lane changes no repository file.
- A later required-CI regression pauses this work order and reopens the responsible
  repo repair owner before further product mutation.

## Capability Maturity Contract

Every slice classifies its result as exactly one of:

- `Internal Capability`: implemented behind backend/adapter/test surfaces but not yet
  usable through one supported product path.
- `Product-Accessible`: a user can reach the behavior from the supported cockpit or
  public control face without manually stitching internal calls together.
- `Claim-Eligible`: Product-Accessible and supported by current proof and honest public
  claim text.

Internal Capability does not count as shipped product progress. A bounded internal
slice is acceptable only when the next named slice consumes it directly.

## Existing Owners To Reuse

| Responsibility | Existing owner |
| --- | --- |
| Mission definition, plan, activation, evidence, settlement | `src-tauri/src/task/mission.rs`, `src-tauri/src/task/manager.rs` |
| Durable Mission state | `src-tauri/src/persistence/task_repo.rs`, existing SQLite migrations |
| Visible implementation runtime | existing Orchestra dispatch and `spawn_interactive_agent` path |
| Work isolation | existing git worktree owner |
| Terminal projection | existing pane tree / visible PTY owners |
| File and symbol ownership | existing ownership managers |
| Tests and exact candidate evidence | existing Mission gate-evidence owner |
| Independent review | existing review owner |
| Exact-OID integration | existing merge-intent owner |
| Completion | existing work/Mission settlement packets |

Forbidden second owners: Mission engine, TaskGraph, journal, Proofbook runner, merge
authority, completion table, frontend execution truth, or provider-specific Mission.

## Work Units

### GMV-0 — Cockpit Goal To Visible Work

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Add a plain-language goal composer to the existing Orchestrator widget.
- Build the plan through the existing `plan_build` IPC command. Do not add another
  planner, schema family, or frontend plan owner.
- Show the generated TaskGraph in the existing panel before execution.
- Require an explicit `Run next step` action, then call the existing
  `orchestrator_step` cockpit path.
- Reuse `run_step_visible`, PaneFleet, worktree, ownership, and visible PTY owners.
- Failure must remain visible in the same panel or a user-visible toast; do not turn
  backend errors into an empty successful state.
- Do not generalize the frozen A7 Mission contract in this slice.
- Done: from one supported cockpit surface, an operator can enter a goal, inspect
  generated tasks, and start visible implementation without MCP calls, CLI commands,
  hand-authored JSON, or a second execution engine.

### GMV-1 — Cockpit Review And Merge

Capability target: `Product-Accessible` completion of the generic TaskGraph path.
Status: **COMPLETE**.

- When implementation reaches `Review`, run the existing project gate detector and
  independent semantic reviewer from the same Orchestrator surface.
- Freeze the candidate before review, prove the full merge-base-to-source history
  touches only `Task.outputs`, and run gates/review in a clean detached checkout at
  that exact candidate OID.
- Require the generic candidate to be fast-forwardable from the current target.
  A source branch behind the target must be rebased and freshly reviewed; Aelyris
  does not synthesize an unreviewed three-way merge tree.
- Treat semantic-review diff truncation as merge-ineligible. Read-only previews may
  be capped, but an authority-bearing review must cover the complete candidate diff.
- Consume the reviewed source/target OIDs, reviewer identity, and gate digest inside
  one backend review-and-merge command. Raw frontend/MCP gate booleans are evidence,
  never merge authority; `orchestrator_step` is implementation-only.
- Commit and merge only backend-declared `Task.outputs`; runtime markers, build
  caches, undeclared dirty files, and undeclared prior branch commits never become
  candidate content.
- Derive the semantic-review provider from the authoritative `Task.model` instead of
  hardcoding Codex in the frontend.
- Keep a red review actionable in the cockpit instead of silently re-dispatching on
  an empty verdict map.
- Done: the live cockpit path reaches `Done`, the declared output is on the target
  branch, and the isolated worktree is reclaimed.

### GMV-2 — Durable Mission Binding And Resume

Capability target: `Product-Accessible` persistence over the GMV-0 journey.
Status: **COMPLETE**.

- Bind the accepted Goal and exact generated task-plan identity to the existing
  Mission preview owner while the existing TaskGraph remains mutable execution truth.
- Generalize only the fields required by the live GMV-0 input; keep the frozen A7
  fixture as conformance evidence rather than a production admission rule.
- Accept Mission and publish the generated TaskGraph in one SQLite transaction; a
  crash may expose neither fact or both facts, never a half-accepted plan.
- Persist and restore planner-derived task IDs, dependency order, outputs, verified
  symbol intents, branches, models, retry counters, and runtime status without a
  frontend or second-plan owner.
- Restore the latest accepted cockpit Mission by backend-canonical repository
  identity and acceptance transaction order; preview creation time cannot outrank
  a later accepted plan, and the frontend does not select or normalize Mission rows.
- No new Mission engine, TaskGraph, journal, persistence table, or frontend state owner.
- Done: a live Goal-to-Done journey was restarted against the same isolated SQLite
  database on 2026-08-04; Mission ID, plan ID, Goal, task `Done`, target OID, clean
  repository, and reclaimed worktree all remained exact.

### GMV-3 — Exact-OID Settlement And Completion

Capability target: `Claim-Eligible` for the bounded Mission journey only.

Repository implementation status: **COMPLETE** at `5461b86f`. The remaining
Claim-Eligible transition is a live-provider confirmation, not another repository
architecture phase. The local Codex account refused that confirmation on 2026-08-05
because its usage window is limited until 2026-08-08; this external quota does not
reopen settlement, CI, verifier, or framework work.

- Invoke the existing exact-OID merge/acceptance and immutable settlement owners.
- A successful agent self-report, file existence, or UI status cannot settle Mission.
- Keep the existing public authorities while localizing their private implementation:
  `task/manager/cockpit_settlement.rs` owns the exact lineage/packet coordinator,
  `startup_reconciliation/cockpit.rs` owns post-merge resumption order, and
  `task/mission/cockpit_packets.rs` owns pure acceptance-coverage construction.
  These modules own no TaskGraph, database, merge queue, or completion truth.
- Stop when the one supported request-to-settlement path is decidable; do not expand
  into Proofbook recipes, Remote Continuity, or a broad framework program.

## Deferred After GMV

Proofbook product access, Fleet Briefing, approval batching, and other adjacent value
remain portfolio candidates rather than slices in this work order. After GMV-3 closes,
compare them against the owning Work OS/Apex roadmap and current user evidence before
opening another program. Their existing backend capability does not justify extending
GMV or bypassing an owning product decision.

## Complexity And Progress Stops

- No new top-level verifier unless an existing gate cannot detect a named new failure
  mode; extend or replace an existing gate first.
- Until GMV-3 is Claim-Eligible, no standalone docs-, verifier-, review-, state-,
  or architecture-only commit is allowed. Such edits may accompany the product diff
  that consumes them in the same slice.
- The next two completed slices must change product/runtime behavior. A Critical
  regression may interrupt, but cleanup, policy polish, historical evidence refresh,
  and speculative architecture may not.
- Use an existing focused test file for the changed behavior. Add a new test family,
  runner, fixture, report, or independent review only for a concrete failure mode that
  the current surface cannot detect.
- Do not start full-native surface migration from preference or design completeness.
  Activation requires the measured gate in `AGENTS.md` and ADR-015.
- Stop each slice when its user-visible claim or named internal handoff is decidable;
  do not keep expanding the framework because adjacent capabilities are imaginable.

## Verification

Use the narrowest existing proof that covers the changed contract and failure boundary.
The default local lane is `pnpm verify:fast` plus the focused Mission/owner test. Use
`pnpm test:related -- <files...>` when the relation is clearer than the Git diff.
Run `pnpm test:full`, full rendered UI, full Rust, or historical A6/A7 aggregates only
when the touched owner, shared contract, or named regression risk requires them.
Historical A6/A7 evidence is reopened only on its accepted exact-SHA checkout/worktree,
not injected back into current-main CI. Do not add a parallel product-delivery verifier merely to restate this work order;
`pnpm verify:ai-decision-knowledge` owns routing and governance consistency.

## Commit And Publication

- One completed slice equals one focused local commit after its gates pass.
- Stage exact paths; do not mix certification artifacts or unrelated cleanup.
- Push, PR, merge, release, signing, and external publication remain separately
  authorized.
