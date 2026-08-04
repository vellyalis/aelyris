# Aelyris Product Delivery Work Order

STATUS: QUEUED
PROGRAM: `product-delivery`
ENTRY GATE: current `HEAD` hosted-fast required CI and the directly touched repo-owned gates are green.
CURRENT PHASE: `GMV` (General Mission Vertical).
NEXT IMPLEMENTATION SLICE: `GMV-0` after the entry gate.

## Goal

Turn the existing terminal, worktree, Mission, test, review, merge, and settlement
substrate into one general product-accessible journey:

```text
plain-language request
  -> inspectable plan preview
  -> explicit approval
  -> visible PTY implementation in an isolated worktree
  -> declared tests bound to the candidate OID
  -> independent review
  -> exact-OID acceptance and immutable settlement
```

This is not a new orchestration engine. It connects existing owners into the user
path that the product Goal already requires.

## Entry And Lane Contract

- `audit-remediation-instructions.md` owns the current exact-HEAD CI repair and the
  continuing operator/external certification handoff.
- This work order becomes the sole repo-mutating product lane only after the current
  hosted-fast required CI is green at the current `HEAD`.
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

### GMV-0 — General Mission Contract

Purpose: separate the general Mission contract from the frozen A7 fixture without
weakening the A7 conformance proof.

- General validation accepts one repository, one approved request, one Work Unit,
  declared owned targets, one or more exact test commands, one independent reviewer,
  and exact-OID settlement.
- A7 fixture constants and exact narrative checks remain as a conformance fixture,
  not production admission rules.
- No UI, new runtime, new persistence owner, or broad multi-Work-Unit framework in
  this slice.
- Done: a non-A7 request can preview, reject/cancel, accept, restore, and activate
  through the existing owners; the historical A7 fixture still passes unchanged.

### GMV-1 — Product Plan Preview

- Add one cockpit entry from the existing Orchestra/request surface.
- Show goal, Work Unit, roles/models, owned targets, exact tests, risk, budget, and
  approval requirements before any worktree or PTY effect.
- Actions: edit request, reject, approve and run.
- Mission truth remains backend-owned; React stores no duplicate execution state.

### GMV-2 — Existing Visible Execution Path

- Approval invokes the existing Orchestra/worktree/visible-PTY path.
- Bind the live attempt to Mission, Work Unit, ownership, generation, and accepted OID.
- Do not create another dispatcher, pane registry, session manager, or worktree path.

### GMV-3 — Proof, Review, And Settlement Projection

- Run declared tests and bind evidence to the candidate OID.
- Invoke the existing independent review and exact-OID merge/acceptance owners.
- Project `NOW`, `NEXT`, and `BLOCKED` from backend truth.
- A successful agent self-report, file existence, or UI status cannot settle Mission.

## Deferred After GMV

Proofbook product access, Fleet Briefing, approval batching, and other adjacent value
remain portfolio candidates rather than slices in this work order. After GMV-3 closes,
compare them against the owning Work OS/Apex roadmap and current user evidence before
opening another program. Their existing backend capability does not justify extending
GMV or bypassing an owning product decision.

## Complexity And Progress Stops

- No new top-level verifier unless an existing gate cannot detect a named new failure
  mode; extend or replace an existing gate first.
- Two consecutive docs/verifier/review/state-only slices force Portfolio Selection;
  the next slice must change product-accessible behavior unless repairing required CI
  or a Critical risk.
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
