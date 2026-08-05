# Aelyris Product Delivery Work Order

STATUS: ACTIVE
PROGRAM: `product-delivery`
ENTRY GATE: PASSED at `f72a61b3d216ca6bc1ce87b84f4fe6567b8f90e0`, Required fast CI run `30876300708`.
CURRENT PHASE: `POST-GMV PRODUCT ACCESS`.
ACTIVE SLICE: `PB-UI-1`.
LAST COMPLETED SLICE: `PB-UI-1`.
NEXT IMPLEMENTATION SLICE: choose the next user-visible candidate after `PB-UI-1`; the
real-provider GMV-3 claim confirmation remains an external check after 2026-08-08,
not a repository implementation slice.

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

The finite **General Mission Vertical** (`GMV-0` through `GMV-3`) remains the
completed repository foundation for this post-GMV product-access phase; the pending
real-provider confirmation changes claim eligibility, not its implementation owner.

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
| Exact-OID Mission settlement | **REPOSITORY COMPLETE / CLAIM CHECK PENDING** | Deterministic end-to-end path passed; real Codex behavior remains externally blocked until 2026-08-08 |
| Native UI migration | **PARKED** | No measured blocker requiring migration before product access |
| Remote Continuity | **PARKED** | Local core journey is not yet complete |
| Fleet Briefing | **COMPLETE** | Observe mode now summarizes durable Event Bus facts since the operator's last mark |
| Low-risk approval batching | **COMPLETE** | Decision Inbox batches only visible, strictly classified low-risk live gates through the existing fingerprint-checked resolver |
| Honest Cost Meter | **COMPLETE** | Command mode shows reported fleet usage, configured caps, and telemetry confidence without treating unknown as zero |
| Proofbook catalog, validation, and run history | **COMPLETE** | Command mode exposes existing read-only Proofbook owners without adding execution authority |
| Proofbook run controls, broad budget editing UX | **PARKED** | Effects require a separately bounded authority and operator-flow decision |
| Signing, sleep, authenticated operator, external certification | **CERTIFICATION ONLY** | Blocks release claims, not repository product work |
| New top-level verifiers, reports, or historical phase replay | **REJECT BY DEFAULT** | Existing gates already decide the current slice |

## Entry And Lane Contract

- `audit-remediation-instructions.md` owns only the continuing operator/external
  certification handoff; its repo repair lane is closed.
- This work order is the sole repo-mutating product lane. `PB-UI-1` is complete; no
  second repository lane is opened merely to wait for the GMV-3 provider quota.
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
| Durable Fleet Briefing facts | existing SQLite-backed `EventBus::since` sequence |
| Fleet Briefing projection | existing Observe-mode right rail and widget persistence owner |
| Interactive approval authority | existing `resolve_interactive_approval` prompt-fingerprint check and PTY write owner |
| Approval classification | existing frontend `shellSafety.classifyCommand` plus the stricter AB-1 batch allowlist |
| Approval batch projection | existing Decision Inbox; sequential orchestration only, no second approval authority |
| Cost caps | existing Rust `CostManager` and `useCostManager` projection |
| Fleet cost/token totals | existing unified `AgentSession` telemetry and `workstationSummary` confidence vocabulary |
| Proofbook definitions and validation | existing `list_proofbooks` and `validate_proofbook` IPC owners |
| Durable Proofbook run history | existing `list_proofbook_runs` ledger owner and `proofbook-updated` event |

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

On 2026-08-05 the ChatGPT controller also ran the existing fresh-profile journey
with an isolated deterministic Codex-compatible provider double. That run exercised
the real Tauri IPC, visible PTY, worktree, project gates, independent-review adapter,
OID-bound merge, immutable WorkPacket/MissionCompletionPacket settlement, durable
Event Bus, cleanup, and same-SQLite restart. It exposed and fixed a Windows identity
bug where `C:\...` and `\\?\C:\...` named the same repository but were compared as
raw strings. The deterministic run proves the Aelyris product plumbing and recovery
path; it does **not** substitute for confirming real Codex model behavior after the
provider quota reopens.

- Invoke the existing exact-OID merge/acceptance and immutable settlement owners.
- A successful agent self-report, file existence, or UI status cannot settle Mission.
- Keep the existing public authorities while localizing their private implementation:
  `task/manager/cockpit_settlement.rs` owns the exact lineage/packet coordinator,
  `startup_reconciliation/cockpit.rs` owns post-merge resumption order, and
  `task/mission/cockpit_packets.rs` owns pure acceptance-coverage construction.
  These modules own no TaskGraph, database, merge queue, or completion truth.
- Stop when the one supported request-to-settlement path is decidable; do not expand
  into Proofbook recipes, Remote Continuity, or a broad framework program.

### FB-1 — Fleet Briefing

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Add the briefing to the existing Observe-mode right rail; do not create another
  dashboard, event store, timeline, or frontend execution owner.
- Read facts through a bounded Tauri projection of the existing SQLite-backed
  `EventBus::since` owner. The volatile hot cache is not restart truth.
- Keep only the operator's per-project `afterSeq` and local mark time in UI storage.
  That cursor is presentation state, never event truth, and resets safely if the
  durable database is replaced and the cursor moves beyond its high-water mark.
- Summarize progress, attention, durable lifecycle facts, fleet coordination, and
  observed unlocks from the fixed event taxonomy. Do not invent event timestamps,
  proof packets, or cost data that the current event contract does not contain.
- Bound hydration to 4,000 events per briefing and disclose when more remain rather
  than presenting a truncated result as complete.
- Done: an operator can open Observe mode, see a restart-safe summary of what changed
  since the last mark, refresh it, and advance the cursor without MCP/CLI calls.

### AB-1 — Visible Low-Risk Approval Batching

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Add one batch action to the existing Decision Inbox only when at least two of the
  first five visible pending rows are live, keystroke-resolvable, and independently
  classified as low risk. Hidden rows are never silently included.
- Reuse `shellSafety.classifyCommand`, then apply a stricter batch allowlist: one
  known read/build/test command, high-confidence classification, no chaining,
  redirection, substitution, secret-like value, absolute/UNC/home/parent scope,
  or sensitive target such as `.env`, `.ssh`, credentials, or private keys.
- Keep composed commands, unknown commands, mutation-capable Git forms, scope escapes,
  and all medium/high/critical decisions on the existing per-item confirmation path.
- Resolve every selected gate sequentially through the existing single-item
  `onDecide -> resolve_interactive_approval` path. Each item retains its own current
  prompt fingerprint check, audit event, stale-prompt rejection, and PTY write; the
  UI batch creates no backend batch verb or approval authority.
- Latch successful deliveries until their prompt rows disappear. Re-enable only the
  items that failed or changed so a partial batch cannot duplicate successful
  keystrokes or strand a retryable stale decision.
- Done: an operator can approve multiple visible low-risk inspection/test gates with
  one action while destructive, secret-bearing, ambiguous, hidden, or stale gates
  remain individually controlled and fail closed.

### CM-1 — Honest Fleet Cost Meter

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Add a compact Cost Meter to the existing Command-mode right rail; do not create a
  second Cost Manager, telemetry store, budget authority, or cap-editing surface.
- Reuse the unified fleet sessions for reported active-agent, token, cost, and
  longest-live-runtime usage, and reuse `useCostManager` for configured caps.
- Normalize seconds/milliseconds session start timestamps before calculating runtime.
- Treat absent token/cost telemetry as `unknown`, never as proof of zero spend. If a
  corresponding cap is configured, show incomplete coverage instead of a false green.
- Show a cap as reached only when its usage is known; active-agent and runtime facts
  remain exact projections, while token/cost confidence stays explicit.
- Keep this slice read-only. Changing caps or claiming provider-exact billing requires
  a separate authority and telemetry decision rather than a convenient UI field.
- Done: before starting more work, an operator can see reported fleet usage beside
  configured caps and distinguish blocked, within-cap, uncapped, and unknown states.

### PB-UI-1 — Proofbook Catalog, Validation, And Run History

Capability target: `Product-Accessible` read access only.
Status: **COMPLETE**.

- Add one Proofbooks widget to the existing Command-mode right rail; do not create a
  second parser, validator, runner, ledger, decision inbox, or frontend execution owner.
- List contained definitions through `list_proofbooks`, show only bounded metadata,
  and validate the explicitly selected definition through `validate_proofbook`.
- Show structured validation errors without reading or rendering definition contents,
  secret references, shell output, or artifact bodies in the frontend.
- Read durable run ledgers through `list_proofbook_runs`, surface status, passed-step
  coverage, artifact count, blocker count, and update time, and merge matching live
  `proofbook-updated` events only for the active canonicalized project identity.
- Keep this slice strictly read-only. It contains no start, cancel, gate decision,
  agent settlement, raw artifact open, or caller-shaped completion action.
- Failure remains visible in the widget; an empty or failed backend read cannot be
  presented as a successful catalog or successful validation.
- Done: an operator can discover definitions, run explicit static validation, and
  inspect durable run history from the supported cockpit without MCP or CLI calls.

## Deferred After GMV

Fleet Briefing `FB-1`, low-risk approval batching `AB-1`, and Honest Cost Meter `CM-1`
are complete, and `PB-UI-1` closes read-only Proofbook product access. Starting or
cancelling runs, deciding gates, settling agent steps, opening artifacts, budget
editing, Remote Continuity, and other adjacent value remain portfolio candidates.
Compare them against the owning Work OS/Apex roadmap and current user evidence before
opening the next bounded slice; existing backend capability alone does not justify a
new framework program.

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
