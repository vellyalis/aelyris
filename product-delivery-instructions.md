# Aelyris Product Delivery Work Order

STATUS: ACTIVE
PROGRAM: `product-delivery`
ENTRY GATE: PASSED at `f72a61b3d216ca6bc1ce87b84f4fe6567b8f90e0`, Required fast CI run `30876300708`.
CURRENT PHASE: `POST-GMV PRODUCT ACCESS`.
ACTIVE SLICE: `AIO-20`.
LAST COMPLETED SLICE: `AIO-19`.
NEXT IMPLEMENTATION SLICE: `AIO-20`.

```yaml
continuation_contract:
  tracked_plan: product-delivery-instructions.md
  root_work_order: product-delivery-instructions.md
  worklog_dir: .codex-auto/worklogs/product-delivery
  local_handoff: .claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_PRODUCT_DELIVERY_LOCAL_ONLY.md
  verifier: pnpm verify:product-delivery:continuation
```

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
| Remote Continuity local read foundation | **COMPLETE / EXTERNAL EXPOSURE PARKED** | RC-1/2/3 provide loopback snapshot, finite payload-free changes, and Governance-backed principal scope discovery; private-network exposure needs a separately approved threat boundary |
| AI self-operation discovery | **COMPLETE** | REST, MCP contract, and JSON-RPC discovery now project one Governance-filtered catalog for the authenticated principal while calls remain independently authorized |
| Runtime-owned Proofbook settlement for AI | **COMPLETE** | MCP now exposes the same current-runtime candidate and fail-closed settlement authority as Cockpit without accepting a caller-authored proof packet |
| Authenticated Proofbook decision identity | **COMPLETE** | Exact-hash gate decisions now bind durable actor evidence to the authenticated Principal and reject compatibility actor impersonation before runner mutation |
| Exact current Proofbook cancellation for AI | **COMPLETE** | MCP now exposes revision-pinned cancellation with authenticated-actor ledger/audit evidence and no external process-termination claim |
| Authenticated Proofbook run-start identity | **COMPLETE** | MCP Proofbook starts now record the authenticated initiating Principal without changing deterministic run identity or input/definition hashes |
| Authenticated mux input identity | **COMPLETE** | MCP and REST workspace input now carry the authenticated Principal through the shared terminal-write authority and payload-free audit |
| Authenticated direct session input identity | **COMPLETE** | REST direct and synchronized session input now carry the authenticated Principal through the single authority and payload-free audit |
| WebSocket ticket principal continuity | **COMPLETE** | One-shot stream claims now preserve the issuing Principal through authorization, exclusive leases, write authority, and payload-free audit |
| MCP pane-input lease and audit binding | **COMPLETE** | MCP pane input now requires the matching Principal/clientId for an exclusive lease and records payload-free accepted/rejected authority evidence |
| MCP pane metadata controller binding | **COMPLETE** | Rename and role changes now require the matching Principal/clientId under an exclusive lease and retain value-minimized actor evidence |
| MCP agent lifecycle actor evidence | **COMPLETE** | Headless/visible spawn and headless stop now retain authenticated, payload-free lifecycle evidence without changing runtime ownership |
| MCP worktree mutation actor evidence | **COMPLETE** | Create/remove now retain authenticated, target-minimized evidence and remove the branch/name through the branch-aware Git owner |
| MCP task mutation actor evidence | **COMPLETE** | Task create/transition now retain the authenticated initiating Principal separately from assignment metadata, using packet-free task digests and explicit Event Bus publication outcomes |
| MCP file-ownership assignment evidence | **COMPLETE** | File-pattern assignment now retains the authenticated initiating Principal separately from assignee/pattern values, using a target-minimized digest and persistence/memory outcome evidence |
| MCP manual symbol-ownership mutation evidence | **COMPLETE** | Manual claim/refresh/release now retain the authenticated initiating Principal separately from claim ownership fields, using target-free digests and explicit persistence/memory outcomes |
| MCP derived symbol-ownership mutation evidence | **COMPLETE** | Diff/source reconciliation now retains the authenticated initiating Principal through the existing extractors and transaction, using aggregate-only origin/input digests and no source payload evidence |
| MCP context decision mutation evidence | **COMPLETE** | Shared decision set/remove now retain the authenticated initiating Principal separately from key/value data, using one-way digests and explicit partial-coordination outcomes |
| MCP intent mutation evidence | **COMPLETE** | Intent propose/resolve now retain the authenticated initiating Principal separately from deliberation contents, with persistence-before-memory and payload-free partial-coordination evidence |
| MCP knowledge-graph mutation evidence | **COMPLETE** | Node/edge add/remove now retain the authenticated initiating Principal separately from structural values, using one-way graph digests and explicit changed/no-op outcomes |
| MCP agent coordination mutation evidence | **NOW** | AI can report activity/blockers and publish typed avoidance directives, but session/task/file/symbol/directive data are domain values and the authenticated initiating Principal is not retained separately |
| Fleet Briefing | **COMPLETE** | Observe mode now summarizes durable Event Bus facts since the operator's last mark |
| Low-risk approval batching | **COMPLETE** | Decision Inbox batches only visible, strictly classified low-risk live gates through the existing fingerprint-checked resolver |
| Honest Cost Meter | **COMPLETE** | Command mode shows reported fleet usage, configured caps, and telemetry confidence without treating unknown as zero |
| Proofbook product access through durable evidence inspection | **COMPLETE** | Command mode exposes catalog/history, bounded effects, verified runner artifacts, and an allowlisted ledger inspector while inputs, secrets, settlement, and raw files remain separate |
| Cockpit budget binding | **COMPLETE** | The supported Orchestrator path submits reported fleet usage and refuses capped-but-unknown telemetry instead of zero-filling it |
| Bounded fleet cap editing | **COMPLETE** | The existing Cost Manager now owns one explicit validated cockpit save path with conflict-safe drafts and visible outcomes |
| Non-secret Proofbook string inputs | **COMPLETE** | Cockpit validation now projects only supported string fields and the runner normalizes the exact declared object before ledger creation |
| Exact Proofbook agentSession settlement | **COMPLETE** | Cockpit settlement re-derives the exact current session/revision from runtime-owned terminal status and contained expected artifacts without a free-form proof editor |
| Durable fleet cap persistence | **COMPLETE** | The existing Cost Manager restores one validated SQLite singleton before runtime admission and persists before mutating live caps or emitting updates |
| Broader Proofbook effects and input/secret UX | **PARKED** | Further access requires separately bounded operator decisions and data handling |
| Signing, sleep, authenticated operator, external certification | **CERTIFICATION ONLY** | Blocks release claims, not repository product work |
| New top-level verifiers, reports, or historical phase replay | **REJECT BY DEFAULT** | Existing gates already decide the current slice |

## Entry And Lane Contract

- `audit-remediation-instructions.md` owns only the continuing operator/external
  certification handoff; its repo repair lane is closed.
- This work order is the sole repo-mutating product lane. `AIO-19` is complete; no
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
| Supported cockpit budget submission | existing `orchestrator_plan` / `orchestrator_step` usage contract |
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

### CM-2 — Bind Reported Fleet Usage To Cockpit Orchestration

Capability target: `Product-Accessible` budget enforcement for the supported cockpit
dispatch path.
Status: **COMPLETE**.

- Stop sending zero-filled token, cost, and runtime usage from the Orchestrator panel.
  Derive the current reported snapshot from the same unified sessions and confidence
  rules used by CM-1, while preserving TaskGraph `Running` count as the scheduler's
  active-agent value.
- Refresh runtime-sensitive planning while live or idle persistent agents remain, and
  count idle persistent sessions in the Cost Meter because they still occupy backend
  agent capacity.
- Submit that snapshot to both `orchestrator_plan` and `orchestrator_step` so known
  token, cost, and runtime caps can halt the existing Rust scheduler rather than being
  cosmetic cockpit labels.
- When a configured cap axis has unknown telemetry, disable `Run next step` and show
  the exact missing axis. Unknown is not converted to zero and cannot silently pass a
  configured budget check.
- Keep this bounded to the supported cockpit path. It does not claim that every legacy
  MCP/compatibility caller has provider-exact billing or a new universal budget owner.
- Done: cockpit dispatch passes reported usage, known over-budget state reaches the
  existing backend halt, and capped-but-unmeasured usage fails closed before spawn.

### XPC-1 — Portable Active-Program Continuation

Capability target: `Product-Accessible development continuity`.
Status: **COMPLETE**.

- Repair the fresh-clone bootstrap so it selects the sole `STATUS: ACTIVE`
  repo-mutating work order instead of remaining hardwired to the closed audit lane.
- Give product delivery one canonical ignored worklog, local handoff, and focused
  continuation verifier derived from tracked Git truth.
- Resolve pnpm through either the direct executable or Corepack using the tracked
  `packageManager` version. Do not require an unrelated global pnpm installation.
- Locate the hosted fresh-checkout proof in the tracked workflow portfolio rather
  than assuming it remains in `ci.yml` after CI lane separation.
- Require a clean worktree, matching local/tracking/remote OIDs, current bootstrap
  evidence, and exact active-work-order identity before a cross-PC-ready claim.
- Preserve the audit-remediation verifier for its certification-only record; do not
  reopen that closed repository lane or rewrite its historical evidence.
- Done: `pnpm verify:cross-pc-continuation` passes on a clean, pushed product-delivery
  HEAD and the same tracked bootstrap reconstructs the product continuation locally.

### PB-UI-2 — Narrow Proofbook Operator Effects

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Extend the existing Proofbook panel with only `manualGate` resolution. Do not add
  Start, Cancel, agent settlement, raw artifact access, arbitrary input editors, or
  a generic effect console.
- Render the exact persisted `gateId`, `gateHash`, step, risk, default, evidence, and
  fixed `cockpit-operator` actor before exposing Approve or Reject.
- Require the persisted options to contain both `approve` and `reject`; an unknown
  option vocabulary remains read-only rather than being reinterpreted by the UI.
- Invoke only the existing `resolve_proofbook_manual_gate` IPC owner with the current
  hash. Keep startup admission, durable ledger mutation, audit emission, and
  `proofbook-updated` publication in their existing Rust owners.
- Harden the Rust manual resolver so it cannot resolve `commandRisk`/`mcpTool` gates,
  and accept exactly `approve` or `reject` at the Tauri boundary.
- Use a synchronous delivery latch so rapid clicks cannot duplicate a decision.
  A stale hash or missing run refreshes durable history and requires a fresh review.
- Send no free-form comment from this cockpit surface; this slice creates no new
  secret-bearing text path into the ledger or audit journal.
- Done: an operator can inspect and resolve an existing durable manual gate from the
  cockpit, while every other Proofbook effect and gate kind remains inaccessible.

### PB-UI-3 — Start Validated Input-Free Proofbooks

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Consider Start only for a selected definition that has passed a fresh explicit
  validation and declares no runtime inputs, secret references, or unsupported
  `mcpTool`/`agentSession`/HTTP/fan-out/sub-Proofbook step kinds.
- Reuse the existing `ProofbookRunner` through a narrow
  `start_input_free_proofbook_run` adapter; do not add a second runner, frontend
  ledger owner, generic JSON input editor, or alternate execution path.
- Return an explicit `startAdmission` and exact definition hash from Rust validation.
  Show that hash and the admission facts before the operator starts the run.
- Reparse and revalidate in the runner, require the same expected definition hash,
  and reject drift with `stale_definition_hash` before ledger initialization.
- Supply exactly `{}` as inputs. Input-bearing or secret-bearing definitions remain
  ineligible even when their inputs declare defaults.
- Project the returned durable ledger and existing `proofbook-updated` events.
- Keep command-risk/manual gates governed by their existing waiting-gate paths; a
  Start click is not approval for a later gated step.
- Fail visibly on startup reconciliation, definition drift, missing input metadata,
  or any runner error. Do not present an empty/failed start as a successful run.
- Keep Cancel, agent-session settlement, artifact opening, secrets, and input-bearing
  Proofbooks outside this slice.
- Done: the cockpit can start only a freshly validated, exact-hash, local input-free
  Proofbook while every broader execution surface remains unavailable.

### PB-UI-4 — Cancel Current Non-Terminal Proofbook Runs

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Expose Cancel only for a durable non-terminal run: `pending`, `running`, or
  `waiting_gate`. Passed, failed, policy-blocked, externally blocked, and already
  cancelled runs remain immutable through this surface.
- Require the exact displayed ledger `revision` at the Rust boundary. If any worker,
  gate decision, restart recovery, or other writer advanced the ledger, fail with a
  stale-revision error and refresh before another operator action.
- Reuse the existing runner cancellation owner, append-only cancellation event,
  durable atomic ledger commit, audit record, and `proofbook-updated` publication.
- Add a synchronous UI latch and show the run id, current status, revision, and
  consequence before Cancel. Do not add bulk cancel or a hidden-row batch action.
- Keep process termination claims narrow: this slice changes durable Proofbook run
  admission/state only and must not claim it killed an external agent/process unless
  its existing owner provides that evidence.
- Keep Start with inputs/secrets, agent settlement, artifact opening, and generic
  comments outside this slice.
- Harden the shared runner cancellation owner so terminal ledgers cannot be rewritten,
  and include `waiting_gate` steps in the cancelled step set instead of leaving an
  impossible waiting step inside a cancelled run.
- Add a narrow `cancel_current_proofbook_run` cockpit adapter that consumes the exact
  displayed revision, audits expected/committed revisions, emits the existing update,
  and explicitly records that external process termination was not claimed.
- Done: an operator can cancel one exact non-terminal ledger revision, while stale,
  terminal, hidden, and already-cancelled runs fail closed or expose no action.

### PB-UI-5 — Verified Runner-Owned Artifact Preview

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Preview only artifacts already named by the current durable ledger and physically
  contained under the runner-owned `.aelyris/proofbook-runs/artifacts/<runId>` root.
- Consume `runId`, `artifactId`, and exact ledger `revision`; do not accept an
  arbitrary filesystem path from the frontend.
- Canonicalize the artifact path, reject symlink/path escape, re-read a bounded byte
  count, and verify recorded size plus SHA-256 before returning any content.
- Support bounded UTF-8 text preview only. Binary, oversized, missing, externally
  recorded, or integrity-mismatched artifacts remain metadata-only and fail visibly.
- Return the recorded redaction count and show an explicit disclosure that validation
  proves ledger integrity/containment, not that every possible secret pattern was
  semantically removed.
- Keep raw artifact download, shell-open, arbitrary file read, agent settlement,
  inputs/secrets, and bulk export outside this slice.
- Add a narrow `preview_current_proofbook_artifact` command that resolves only the
  artifact id in the exact current ledger revision and logs metadata, never content.
- Require a normal relative ledger path, canonical runner root beneath the canonical
  project, canonical candidate beneath that exact run root, regular `.txt` file,
  recorded/current size equality, recorded/current SHA-256 equality, UTF-8 decoding,
  and a 64 KiB maximum before returning content.
- Keep externally recorded expected artifacts visible as metadata-only even when they
  are project-contained; this cockpit preview is only for redacted runner-owned text.
- Done: an operator can inspect one exact, integrity-verified runner-owned text
  artifact without granting an arbitrary path read, download, or shell-open surface.

### PB-UI-6 — Durable Step Evidence Inspector

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Expand one durable run ledger at a time and project its current revision, ordered
  step statuses, attempts, durations, errors, risk metadata, artifact references,
  gate decision actor/decision, and residual blockers.
- Reuse the existing `list_proofbook_runs`/`proofbook-updated` ledger projection; do
  not add another evidence store, timeline owner, or frontend-derived execution truth.
- Keep structured output bounded to known gate/risk summary fields. Do not dump
  arbitrary JSON, command output, secret-bearing inputs, or raw artifact content into
  the evidence inspector.
- Make terminal and non-terminal state visually distinct, and retain the exact run id
  and revision so operator decisions can be reconciled with subsequent updates.
- Keep effect controls in their existing bounded surfaces; expanding evidence does
  not approve, start, cancel, settle, retry, or mutate a run.
- Done: an operator can explain why a Proofbook run is waiting, failed, blocked, or
  passed from durable ledger facts without opening files or using MCP/CLI calls.
- Derive the inspector through a pure allowlist projection. Show only status,
  attempt, duration, typed errors, selected risk fields, known gate summary fields,
  decision/actor/time, bounded artifact ids, redaction counts, and residual blockers.
- Never render gate hashes, decision comments, risk reasons/previews, unknown nested
  fields, or arbitrary structured-output JSON. Long durable text is compacted and
  bounded before it reaches the component.
- Keep one expanded run at a time and reconcile it in place when the existing
  `proofbook-updated` event advances revision or terminal state.

### CM-3 — Explicit Validated Fleet Cap Editing

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Extend the existing Cost Meter; do not create another Cost Manager, settings
  database, budget ledger, or frontend execution authority.
- Require one explicit Save action. Editing local form fields never changes runtime
  caps until the operator submits the complete candidate.
- Keep `max_agents` mandatory and bounded to a conservative positive range. Token,
  reported-cost, and runtime caps may be absent or positive; reject zero, negatives,
  non-finite values, fractions on integer axes, and malformed input at the backend.
- Put validation in the existing Cost Manager/cap owner so cockpit, MCP, tests, and
  future callers cannot disagree. A successful update remains the same atomic
  `cost-caps-updated` event source consumed by the meter and orchestrator.
- Show the exact current and proposed caps, explain that token/cost telemetry is
  reported rather than provider billing, and disclose that lowering a cap below
  current known usage halts future orchestration but does not kill existing work.
- Do not expose an unlimited agent cap, automatic save, presets, bulk policy editor,
  provider pricing estimates, or silent conversion of unknown telemetry to zero.
- On stale/external cap updates, keep the operator's dirty draft visible and show a
  conflict notice rather than overwriting it; a clean form may synchronize normally.
- Done: an operator can deliberately change bounded runaway-prevention caps from the
  supported cockpit, with one backend validation authority and visible outcomes.

### PB-UI-7 — Validated Non-Secret Proofbook String Inputs

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Extend the existing Proofbook cockpit panel and runner; do not add a generic JSON
  editor, a second input schema owner, or a secret-value store.
- Limit this slice to declared `string` inputs. Defaults and `required` remain owned
  by the parsed Proofbook definition; unsupported input types fail closed with a
  structured validation blocker rather than being coerced by the frontend.
- Validate the complete submitted input object in the existing Proofbook owner before
  creating a ledger: reject unknown keys, missing required values, non-string values,
  and a stale definition hash. Preserve the existing deterministic input hash and
  single managed runner.
- Show declared labels/keys, defaults, required state, current validation blockers,
  and the exact submitted non-secret values before the explicit Start action.
- Never render or accept secret values, arbitrary nested objects, arrays, environment
  lookups, agent-session inputs, or unsupported step kinds in this slice.
- Done: an operator can start an otherwise-supported Proofbook with declared string
  inputs from the cockpit, while the backend remains the only admission authority.

### PB-UI-8 — Exact Runtime-Owned Agent Session Settlement

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Extend the existing Proofbook cockpit and `settle_proofbook_agent_session` owner;
  do not create a second completion protocol, runner, session registry, or evidence
  store.
- Offer settlement only for the exact displayed revision of a running
  `agentSession` step whose durable output still identifies the same runtime-owned
  session/pane/worktree. A changed definition, ledger revision, step state, or
  session identity must refresh and fail closed.
- Derive the candidate completion packet only from evidence owners that currently
  exist: exact runtime session identity/status and contained expected artifacts.
  Runtime-owned final-report or reviewer-batch references do not currently exist,
  so this slice must not invent or accept them. Do not expose a generic JSON editor
  or let the operator type arbitrary status, artifact paths, done signals, reviewer
  ids, or blocker payloads.
- Show the exact evidence that will be submitted, unresolved requirements, and the
  resulting durable status before enabling one explicit Settle action.
- Keep terminal input, process termination, review acceptance, and merge authority
  in their existing owners. Settling a ledger step must not claim that an external
  process was killed, reviewed, or merged.
- Done: an operator can settle a current Proofbook `agentSession` from existing
  Aelyris-owned completion evidence without composing a proof packet by hand.

### CM-4 — Durable Fleet Cap Persistence

Capability target: `Product-Accessible`.
Status: **COMPLETE**.

- Persist the existing `CostCaps` owner through the existing Aelyris SQLite database;
  do not add another database, generic settings framework, frontend cache authority,
  or second Cost Manager.
- Store one versioned singleton cap record. Validate it through the same backend
  `CostCaps::validate_for_update` authority before both save and restore.
- A Save is successful only if durable persistence succeeds before the in-memory
  owner changes or `cost-caps-updated` emits. A database failure must preserve the
  prior runtime caps and report the failure to the editor.
- Restore persisted caps before orchestration can consume the Cost Manager. Missing
  state uses the existing bounded defaults; malformed persisted state fails closed
  to those defaults and produces explicit diagnostic evidence rather than silently
  coercing an unsafe value.
- Preserve the current truth boundary: token and cost values are reported telemetry,
  not provider billing, and unknown telemetry is never converted to zero.
- Done: deliberately saved fleet caps survive a clean application restart and remain
  the one cap set observed by Cockpit and orchestration.

### RC-1 — Authenticated Read-Only Continuity Snapshot

Capability target: `Product-Accessible` without a remote-operation claim.
Status: **COMPLETE**.

- Extend the existing authenticated embedded API and `aelys` control face; do not
  create a cloud service, second daemon, parallel workspace model, generic sync
  framework, or SSH authority.
- Add one versioned, bounded read-only snapshot assembled directly from the existing
  mux, pane/session, agent, approval, Proofbook, ownership, merge, Cost Manager, and
  Event Bus owners already present in `ApiState`. Missing owners must be represented
  explicitly rather than guessed or zero-filled.
- Keep the current loopback bind and bearer/governance boundary. This slice adds no
  public/private-network bind switch, remote input, approval resolution, leases, SSH,
  or mutation endpoint and therefore makes no Remote Continuity shipment claim.
- Expose the snapshot through one supported `aelys continuity` command so an operator
  can inspect the same bounded state from a second local process without manually
  stitching MCP verbs together.
- Include stable schema/version identity, capture time, process/instance identity,
  mux workspace/pane summaries, bounded agent summaries, pending approval metadata,
  Proofbook run/blocker summaries for an explicitly supplied project, merge/ownership
  summary, configured cost caps, and a durable event cursor suitable for the next
  incremental-monitor slice.
- Exclude raw scrollback, terminal input, prompt/command bodies, secret values,
  artifact contents, token files, environment values, signing material, and arbitrary
  structured runtime output. Apply explicit item and text bounds at the backend.
- Done: `aelys continuity` returns one authenticated, claim-safe snapshot whose data
  is projected from the same owners as the local cockpit and cannot mutate state.

### RC-2 — Authenticated Payload-Free Continuity Changes

Capability target: `Product-Accessible` without a live-watch or remote-operation claim.
Status: **COMPLETE**.

- Extend the existing authenticated embedded API, `aelys` control face, and durable
  Event Bus cursor from RC-1. Do not add a second event log, polling daemon,
  WebSocket/watch stream, cloud sync service, external bind, or SSH authority.
- Accept one explicit non-negative `afterSeq` and a bounded finite limit. Return only
  the existing durable event metadata needed to advance the cursor: sequence,
  event id, kind, and channel. Event payloads remain entirely server-side.
- Preserve Event Bus fail-closed semantics. Cursor-out-of-range, sequence gaps,
  corrupt rows, stream invariant failures, and unavailable durability are errors;
  none may be presented as an empty successful "caught up" result.
- Keep the current loopback bind, bearer authentication, and governance boundary.
  This slice adds no remote input, approval resolution, lease acquisition, mutation,
  private-network exposure, or SSH behavior.
- Expose one finite `aelys continuity-changes --after-seq <n> [--limit <n>]`
  request. The command exits after one response and does not claim live monitoring.
- Apply backend item/text bounds and preserve the RC-1 exclusion list: no payload,
  scrollback, prompt, command body, secret, artifact content, environment value,
  token, signing material, or arbitrary structured output.
- Done: an operator can retrieve one authenticated, payload-free finite batch since
  a durable cursor and receive the exact next cursor without mutating Aelyris state.

### RC-3 — Machine-Readable Observe Principal And Scope Contract

Capability target: `Product-Accessible` identity and authorization discovery without
private-network exposure or a new mutation authority.
Status: **COMPLETE**.

- Extend the existing bearer authentication, `Principal`, Governance, daemon
  contract, and `aelys` control face. Do not add a second token store, identity
  database, policy engine, role model, remote bind switch, or cloud account.
- Add one authenticated read-only identity projection that returns the current
  principal id, tenant, transport, and the finite continuity capabilities the
  existing Governance owner allows for that principal. It must not expose bearer
  tokens, token-file paths, policy internals, credentials, or unrelated mutation
  capabilities.
- Capability evaluation must call the existing Governance authority for the exact
  stable continuity capability names; the frontend or CLI must not infer access
  from route presence, daemon process kind, or a generic `authenticated=true` bit.
- The default loopback operator remains compatible with current local operation.
  A denied continuity scope must be represented explicitly and must remain denied
  when the caller invokes the underlying route.
- Expose one finite `aelys continuity-whoami` command. It exits after one response
  and does not create a session, lease, watch stream, approval, or terminal input.
- Done: an AI or operator can discover which read-only continuity operations the
  current authenticated principal may actually invoke, using the same owner that
  enforces those operations.

### AIO-1 — Principal-Scoped MCP Tool Discovery

Capability target: `Product-Accessible` self-operation discovery without granting a
new tool, permission, review verdict, merge authority, or remote transport.
Status: **COMPLETE**.

- Extend the existing MCP catalog, authenticated `Principal`, and `Governance`
  authority. Do not create a second catalog, permission cache, role engine, policy
  store, AI-specific superuser, or frontend-owned capability map.
- Project `tools/list` from the existing static catalog through
  `Governance::authorize(principal.actor, tool.name)`. The default local operator
  remains catalog-compatible; a restricted principal sees only tools it may invoke.
- Apply the same filtered projection to REST `/mcp/tools/list` and JSON-RPC
  `tools/list`. Do not let the two MCP transports disagree about discoverable tools.
- Keep defense in depth: every `tools/call` remains independently authorized at
  invocation time. Catalog visibility is never authority and cannot substitute for
  command-risk checks, approval fingerprints, exact-candidate review, or settlement.
- Do not return denial reasons, bearer values, roles, tenant policy internals, hidden
  tool names, or an unfiltered count from which hidden tools can be reconstructed.
- Preserve retired fail-closed verbs and the bounded-autonomy rule: raw
  `aelyris.request_merge` and `aelyris.review.approve` do not become usable, and the
  AI receives no caller-authored review/merge shortcut.
- Done: an authenticated MCP client can enumerate the exact tool subset its current
  principal may call, while a direct call to a now-hidden tool remains denied by the
  same Governance owner.

### AIO-2 — Runtime-Owned Proofbook Agent Settlement For AI

Capability target: `Product-Accessible` AI completion handling without a caller-authored
proof packet or a second Proofbook/runtime authority.
Status: **COMPLETE**.

- Extend the existing MCP catalog and dispatcher over the same
  `ProofbookRunner::agent_session_settlement_context`, runtime-session managers, and
  current-runtime settlement logic already used by Cockpit. Do not create a second
  evidence collector, session registry, artifact scanner, or settlement protocol.
- Add one read-only candidate tool requiring exact `projectPath`, `runId`, `stepId`,
  and `expectedRevision`. Return only current session identity, runtime status,
  expected-artifact presence, blockers, resulting status, and the backend-selected
  proof kind.
- Add one effectful settle-current tool requiring the candidate's exact revision and
  session id. Re-read all runtime evidence at invocation time and fail closed if the
  ledger, definition, session, PTY/backend/worktree identity, terminal status, or
  expected artifacts changed.
- The new tools accept no free-form status, done signal, artifact path, reviewer id,
  blocker, summary, or generic proof JSON. The existing explicit-proof compatibility
  verb is not broadened or silently selected by the new path; deprecation, if any,
  remains a separate compatibility decision.
- Apply normal Governance authorization independently to candidate discovery and
  settlement. A principal that cannot discover or call the new tools gains no
  authority through Proofbook nesting or another MCP transport.
- Preserve existing claims: settlement changes only the durable Proofbook ledger. It
  does not terminate a process, accept a review, merge work, or claim external
  artifact provenance.
- Done: an authenticated AI can inspect and settle a current Proofbook
  `agentSession` from Aelyris-owned evidence using the same fail-closed authority as
  Cockpit, without composing a completion proof.

### AIO-3 — Authenticated Actor-Bound Proofbook Gate Decisions

Capability target: `Product-Accessible` exact-hash Proofbook decisions whose durable
actor identity comes from the authenticated Principal rather than caller-authored
metadata.
Status: **COMPLETE**.

- Extend the existing `aelyris.proofbook.approve_gate` and `reject_gate` adapters over
  the current authenticated `Principal`, `Governance`, exact gate id/hash, and
  `ProofbookRunner`. Do not add a decision service, role engine, AI superuser, or
  second approval queue.
- Bind the durable decision actor to the authenticated caller. The optional legacy
  `actor` field may be omitted or match the authenticated actor exactly; a mismatch
  must fail before runner mutation and must not be normalized into a forged identity.
- Preserve the current stale-safe gate contract: the backend rechecks gate id/hash,
  definition, ledger revision, and current waiting state. This slice does not create
  auto-approval, weaken `GATED` classification, or let catalog visibility substitute
  for Governance authorization.
- Preserve nested `mcpTool` actor propagation and ensure a gate continuation cannot
  revert to the default operator after a restricted Principal initiated the run.
- Keep comments as optional decision metadata only. They cannot carry authority,
  change the selected gate, or bypass the expected hash.
- Done: an authenticated AI can approve or reject an exact current Proofbook gate,
  and the durable decision identity is guaranteed to be that authenticated Principal.

### AIO-4 — Exact Current Proofbook Cancellation For AI

Capability target: `Product-Accessible` bounded cancellation of the exact currently
observed Proofbook revision without claiming external process termination.
Status: **COMPLETE**.

- Extend the existing MCP catalog and dispatcher over
  `ProofbookRunner::cancel_run_if_current`, the authenticated Principal, Governance,
  and the existing Proofbook update/audit owners. Do not add a cancellation service,
  process supervisor, second runner, or frontend-owned revision cache.
- Add one `aelyris.proofbook.cancel_current` tool requiring exact `projectPath`,
  `runId`, and `expectedRevision`. A stale revision, terminal run, missing run, or
  startup-admission failure must fail closed before ledger mutation.
- Keep the legacy `aelyris.proofbook.cancel` compatibility verb unchanged. The new
  exact path must not silently fall back to an unpinned cancellation.
- Bind the operation to the authenticated Principal for authorization and durable
  audit evidence. Caller-authored actor metadata is not accepted.
- Preserve the existing claim boundary: cancellation marks pending/running/waiting
  Proofbook steps cancelled and emits the updated ledger; it does not claim that a
  separately running agent process, PTY, worktree, review, or merge was terminated.
- Done: an authenticated AI can cancel only the exact nonterminal Proofbook revision
  it inspected, with stale requests rejected and actor-bound audit evidence retained.

### AIO-5 — Authenticated Principal-Bound Proofbook Run Start

Capability target: `Product-Accessible` Proofbook starts whose durable initiating
identity comes from the authenticated Principal without changing run determinism.
Status: **COMPLETE**.

- Extend the existing `aelyris.proofbook.run` adapter, `ProofbookRunner`, and
  append-only run ledger. Do not add a second start command, runner, identity store,
  actor parameter, or AI-specific run-id scheme.
- Bind the authenticated Principal to the durable `run_created` evidence before step
  execution. Caller-authored `actor` metadata is not accepted, and the actor must not
  influence definition hash, input hash, or deterministic run id.
- Preserve existing Governance, startup admission, schema validation, contained
  definition path, input handling, and nested `mcpTool` actor propagation.
- Keep the current input/secret boundary unchanged. This slice does not broaden
  supported inputs, resolve secrets, or make secret-bearing starts product-accessible.
- Emit the same Proofbook update projection and retain actor-bound audit evidence for
  the start result without exposing bearer values, token paths, or policy internals.
- Done: an authenticated AI can start the existing supported Proofbook path and the
  durable run-created evidence identifies that same Principal while run identity and
  execution behavior remain otherwise unchanged.

### AIO-6 — Authenticated Principal Propagation For Mux Workspace Input

Capability target: `Product-Accessible` workspace input whose command-risk envelope
identifies the authenticated caller across MCP and REST instead of a fixed operator.
Status: **COMPLETE**.

- Extend the existing `api::mux::send_workspace_input`, MCP
  `mux.workspace.safeInput`, REST mux broadcast route, `TerminalInputAuthority`, and
  their focused tests. Do not add a write service, bypass route, separate risk gate,
  actor parameter, or AI-only terminal channel.
- Resolve the caller only at the existing authentication boundary and pass that exact
  Principal into the shared terminal-write envelope. The workspace-input schema exposes
  no caller-selected identity field.
- Preserve command-risk classification, exact target-set binding, approval IDs,
  quarantine, held-write behavior, all-or-nothing workspace targeting, and existing
  byte/frame bounds.
- Keep local single-operator behavior compatible: the default Principal remains
  `operator`, while custom resolvers receive their own exact actor in authority and
  audit evidence.
- A denial, held write, or failed target must not be re-attributed to `operator`, and
  catalog visibility must not substitute for per-call Governance authorization.
- Done: authenticated MCP and REST callers that send workspace input are represented by
  their exact Principal at the one terminal-write authority, with default-operator
  compatibility and no change to risk or approval semantics.

### AIO-7 — Authenticated Principal Propagation For Direct REST Session Input

Capability target: `Product-Accessible` direct session input whose terminal-write
envelope and payload-free audit identify the authenticated REST caller.
Status: **COMPLETE**.

- Extend the existing `/sessions/{id}/input` handler, synchronized-pane target
  projection, controller-lease checks, `TerminalInputAuthority`, and existing audit
  owner. Do not add an input service, second endpoint, caller actor field, or alternate
  PTY writer.
- Resolve identity only from the existing auth middleware and pass that exact Principal
  to `execute_terminal_write`. Default local behavior remains `operator` through the
  default resolver.
- Preserve terminal short-id resolution, synchronized-pane target expansion, client
  controller leases, frame bounds, command-risk classification, approval binding,
  waiting-approval fences, quarantine, and all-or-nothing target semantics.
- Record only actor, source, target-scope hash, command hash, result metadata, and
  whether approval was supplied. Raw input, prompt text, environment values, and secret
  material must not enter the audit.
- Keep WebSocket ticket/controller identity as a separately bounded slice; this work
  unit must not silently treat a stream ticket as a reusable Principal credential.
- Done: an authenticated REST caller sends direct or synchronized session input as its
  exact Principal at the single authority, with payload-free evidence and unchanged
  risk/lease behavior.

### AIO-8 — WebSocket Stream Ticket Principal Continuity

Capability target: `Product-Accessible` WebSocket attach/write where a single-use
stream ticket preserves the authenticated issuing Principal through redemption,
controller lease, terminal-write authority, and payload-free audit.
Status: **COMPLETE**.

- Extend the existing stream-ticket issuer, `TicketRegistry`, `StreamTicketClaim`, auth
  middleware, `ws_session`, controller lease, and terminal-write authority. Do not add
  a token store, alternate WebSocket auth, second lease owner, actor query parameter,
  or reusable remote credential.
- Capture the authenticated Principal when the ticket is minted and carry that exact
  identity in the in-memory one-shot claim. Ticket redemption must not re-resolve an
  empty bearer header into a different/default actor.
- Preserve ticket TTL, single use, session binding, mode, control class, client id,
  read-only rejection, exclusive lease acquisition/release, frame bounds, command-risk
  classification, approval fences, quarantine, and stream replay behavior.
- A direct authenticated upgrade without a ticket, where still supported, must use the
  Principal already inserted by auth middleware. A ticket is scoped only to its stream
  claim and must not become a general API credential.
- Writable frames must reach `TerminalInputAuthority` and payload-free audit as the
  claim Principal. Raw frames, scrollback, prompts, bearer values, ticket values, and
  token paths must not enter the audit.
- Done: the actor that mints a writable stream ticket is exactly the actor represented
  in subsequent WebSocket write authority/audit evidence, while existing attach and
  controller semantics remain unchanged.

### AIO-9 — Principal-Bound MCP Pane Input Lease And Audit

Capability target: `Product-Accessible` AI pane input that cannot bypass an exclusive
stream controller and leaves the same payload-free authority evidence as REST/WS input.
Status: **COMPLETE**.

- Extend the existing `aelyris.pane_send_input` adapter, `StreamControllerLeases`,
  `TerminalInputAuthority`, and shared programmatic terminal-write audit. Do not add a
  PTY writer, command-risk gate, controller registry, actor parameter, or AI-only input
  channel.
- Preserve the authenticated MCP Principal already supplied by `tools_call`. Add only
  an optional controller `clientId` needed to match an existing exclusive lease; it is
  not identity and never substitutes for the authenticated Principal.
- Before command classification or PTY mutation, call the existing lease owner with
  terminal id, optional client id, and authenticated Principal. If another controller,
  another Principal, or an omitted client id owns the exclusive lease, fail closed.
- Preserve terminal short-id resolution, frame bounds, command-risk classification,
  exact approval binding, waiting-approval fences, quarantine, typed NACK behavior, and
  the existing Atomic MCP payload mode.
- Reuse the shared payload-free audit owner. Record actor, terminal/target scope,
  command hash, approval presence, result, and rejection code; never record raw input,
  prompts, bearer values, controller credentials, or environment values.
- Done: an authenticated AI can use MCP pane input only within the current controller
  boundary, and both accepted and rejected writes are durably attributable without
  exposing the submitted command.

### AIO-10 — Principal-Bound MCP Pane Metadata Control

Capability target: `Product-Accessible` pane rename and role changes that obey the
same authenticated controller boundary as pane input without exposing metadata values
as authority.
Status: **COMPLETE**.

- Extend the existing `aelyris.pane.rename` and `aelyris.pane.set_role` adapters,
  short-id resolver, `StreamControllerLeases`, Cockpit-owned pane mutation cores, and
  durable audit journal. Do not add a pane registry, metadata service, controller
  owner, actor parameter, or alternate mutation path.
- Use the caller identity already carried by the authorized MCP dispatch. Accept only
  an optional controller `clientId`; it scopes an existing exclusive lease and never
  substitutes for that authenticated identity.
- Resolve the exact terminal id, then check terminal id, optional client id, and
  authenticated Principal against the existing controller lease before invoking the
  rename or role core. Omitted, stale, foreign, or cross-Principal controller claims
  fail closed before pane mutation.
- Preserve current name/role validation, short-id behavior, typed tool-error shape,
  missing-pane behavior, and Cockpit ownership of the underlying pane state.
- Retain actor-bound, value-minimized audit evidence for accepted and rejected
  mutations. Do not record pane names, roles, bearer values, controller credentials,
  prompts, or environment values.
- Done: an authenticated AI can rename or classify a pane only inside the current
  controller boundary, and the mutation is durably attributable without treating a
  caller-supplied metadata value as authority.

### AIO-11 — Principal-Bound MCP Agent Lifecycle Evidence

Capability target: `Product-Accessible` headless and visible agent lifecycle effects
whose durable evidence identifies the authenticated MCP Principal without exposing the
agent prompt or environment.
Status: **COMPLETE**.

- Extend the existing `aelyris.spawn_agent`, `aelyris.agent.spawn_visible`, and
  `aelyris.stop_agent` adapters, current Agent Managers, cost/startup admission, and
  durable audit journal. Do not add an agent manager, lifecycle service, actor field,
  identity store, or AI-specific spawn/stop path.
- Use only the authenticated Principal already carried by authorized MCP dispatch.
  Caller arguments remain prompt/cwd/model/tool/resume/session controls; none of them
  may substitute for actor identity.
- Preserve current headless/visible runtime owners, fleet caps, model routing,
  worktree/session identity, process cleanup, typed tool-error shape, Governance, and
  startup fail-closed behavior.
- Record value-minimized accepted/rejected lifecycle evidence with actor, operation,
  runtime kind, and resulting session id when one exists. Do not persist prompt text,
  cwd, allowed-tools lists, resume ids, branch names, bearer values, environment
  values, or raw provider output.
- A failed spawn or stop must not be recorded as successful, and an audit-write failure
  must not fabricate a lifecycle result or change the existing runtime owner.
- Done: an authenticated AI can start or stop the existing agent runtimes and every
  resulting lifecycle effect is durably attributable without leaking its task payload.

### AIO-12 — Principal-Bound MCP Worktree Mutation Evidence

Capability target: `Product-Accessible` isolated-worktree creation and removal whose
durable evidence identifies the authenticated MCP Principal without exposing local
repository paths or branch names.
Status: **COMPLETE**.

- Extend the existing `aelyris.worktree.create` and `aelyris.worktree.remove`
  adapters, current `control::worktree` owner, Git validation, Governance, and durable
  audit journal. Do not add a Git service, worktree registry, actor parameter, path
  cache, or AI-specific mutation route.
- Bind only the authenticated Principal already carried by authorized MCP dispatch.
  Repository path, branch name, worktree name, and `deleteBranch` remain operation
  inputs and cannot substitute for identity or authorization.
- Preserve current path prediction, branch validation, containment, duplicate/stale
  handling, exact remove behavior, optional branch deletion, typed errors, and Git as
  the source of truth.
- Retain accepted/rejected audit with actor, operation, result, delete-branch intent,
  and a stable one-way target digest sufficient for correlation. Do not persist raw
  repository paths, branch/worktree names, bearer values, environment values, command
  output, or Git credentials.
- Audit-write failure must not fabricate Git success or create a second mutation
  result. Existing worktree effects remain authoritative and are never replayed merely
  to obtain audit evidence.
- Done: an authenticated AI can create or remove the existing isolated worktree path,
  and the mutation is durably attributable without disclosing its local target names.

### AIO-13 — Principal-Bound MCP Task Mutation Evidence

Capability target: `Product-Accessible` durable task creation and transition whose
initiating identity comes from the authenticated MCP Principal rather than task
assignment metadata.
Status: **COMPLETE**.

- Extend the existing `aelyris.task.create` and `aelyris.task.transition` adapters,
  current Task Manager, Event Bus publication, Governance, and durable audit journal.
  Do not add a task graph, actor field, mutation service, identity store, or AI-only
  task path.
- Keep task `owner`, model, priority, dependencies, outputs, branches, title, and
  description as domain inputs. None of those fields may substitute for the
  authenticated initiating Principal or be copied into actor evidence.
- Preserve verified-symbol minting, caller-symbol rejection, transition validation,
  task durability, TaskCreated/ReviewRequired/TaskCompleted publication, typed errors,
  and the current Task Manager as the sole mutation authority.
- Retain accepted/rejected audit with actor, operation, resulting status when known,
  and a stable one-way task digest sufficient for correlation. Do not persist task id,
  title, description, owner, model, priorities, dependencies, outputs, branch names,
  bearer values, environment values, or Event Bus payloads in the audit record.
- Event publication failure must remain an explicit failure and must not be audited as
  a fully successful coordinated mutation. Do not replay a Task Manager mutation merely
  to obtain audit evidence.
- Done: an authenticated AI can create or transition the existing durable task graph,
  and each effect is attributable without confusing task assignment with caller identity
  or leaking the task packet.

### AIO-14 — Principal-Bound MCP File-Ownership Assignment Evidence

Capability target: `Product-Accessible` file-pattern ownership assignment whose
initiating identity comes from the authenticated MCP Principal while the assigned
agent remains domain metadata.
Status: **COMPLETE**.

- Extend the existing `aelyris.ownership.assign` adapter, `FileOwnership`,
  `OwnershipRepo`, Governance, and durable audit journal. Do not add an ownership map,
  actor field, assignment service, identity store, or AI-only coordination path.
- Keep caller-supplied `agentId` and `pattern` as assignment inputs. Neither may
  substitute for the authenticated initiating Principal or be copied into actor
  evidence.
- Preserve persistence-before-memory ordering, current conflict calculation, expiry
  behavior, typed errors, and the existing file-ownership owner as the sole mutation
  authority.
- Retain accepted/rejected audit with actor, operation, conflict count when known, and
  a stable one-way assignment digest sufficient for correlation. Do not persist raw
  agent ids, patterns, file paths, conflict payloads, bearer values, environment values,
  or repository contents in the audit record.
- Persistence or lock failure must remain an explicit failure and must not be audited
  as an accepted assignment. Do not replay an ownership mutation merely to obtain audit
  evidence.
- Done: an authenticated AI can assign the existing file-ownership map, and the effect
  is attributable without confusing the assigned agent with the caller or leaking the
  file pattern.

### AIO-15 — Principal-Bound MCP Manual Symbol-Ownership Mutation Evidence

Capability target: `Product-Accessible` manual symbol claim, refresh, and release whose
initiating identity comes from the authenticated MCP Principal while claim ownership
fields remain domain metadata.
Status: **COMPLETE**.

- Extend the existing `aelyris.symbol.claim`, `aelyris.symbol.refresh`,
  `aelyris.symbol.release`, and `aelyris.symbol.release_task` adapters,
  `SymbolOwnership`, `OwnershipRepo`, Governance, and durable audit journal. Do not add
  a symbol map, actor field, claim service, identity store, or AI-only ownership path.
- Keep caller-supplied claim id, agent id, task id, path, symbol, range, mode,
  confidence, and lease as claim-domain inputs. None may substitute for the
  authenticated initiating Principal or be copied into actor evidence.
- Preserve reserved derived-claim prefixes, path normalization, range/mode/confidence
  validation, staged persistence-before-memory behavior, blocked-conflict outcomes,
  lease refresh, release semantics, typed errors, and the existing symbol owner as the
  sole mutation authority.
- Retain accepted/rejected audit with actor, operation, outcome class/count when known,
  mutation state, and stable one-way claim/target digests sufficient for correlation.
  Do not persist raw claim/agent/task ids, paths, symbols, ranges, source text, conflict
  payloads, bearer values, environment values, or repository contents.
- Persistence or lock failure must remain explicit and must not be audited as accepted.
  Do not replay a symbol mutation merely to obtain audit evidence.
- Done: an authenticated AI can perform the existing manual symbol-ownership lifecycle,
  and each effect is attributable without confusing claim ownership with caller
  identity or leaking symbol targets.

### AIO-16 — Principal-Bound MCP Derived Symbol-Ownership Mutation Evidence

Capability target: `Product-Accessible` diff/source-derived symbol reconciliation whose
initiating identity comes from the authenticated MCP Principal without persisting the
large source payload or derived target values.
Status: **COMPLETE**.

- Extend the existing `aelyris.symbol.claim_from_diff` and
  `aelyris.symbol.claim_from_source` adapters, extractor/reconciliation logic,
  `SymbolOwnership`, `OwnershipRepo`, Governance, and durable audit journal. Do not add
  a parser, diff engine, symbol map, actor field, reconciliation service, or AI-only
  ownership path.
- Keep caller-supplied agent/task ids, path, diff/source body, mode, language, and lease
  as derivation inputs. Those values remain derivation metadata and never define the
  caller identity or enter actor evidence.
- Preserve the 1 MiB payload bound, raw-diff semantics, tree-sitter supported-language
  fallback, reserved extractor prefixes, per-origin reconciliation, conflict outcome
  semantics, staged persistence-before-memory transaction, typed errors, and the
  existing extractor/ownership owners.
- Retain accepted/rejected audit with actor, operation, fallback/recorded counts,
  outcome-class counts, mutation state, and stable one-way origin/input digests.
  Do not persist raw diff/source, agent/task ids, paths, symbols, ranges, language,
  conflict payloads, bearer values, environment values, or repository contents.
- Persistence, parse, reconciliation, or lock failure must remain explicit and must not
  be audited as accepted. Do not replay derivation merely to obtain audit evidence.
- Done: an authenticated AI can derive and reconcile symbol claims through the existing
  diff/source paths, and each effect is attributable without leaking the derivation
  payload or confusing claim ownership with caller identity.

### AIO-17 — Principal-Bound MCP Context Decision Mutation Evidence

Capability target: `Product-Accessible` shared-context set/remove whose initiating
identity comes from the authenticated MCP Principal while decision key/value remain
domain data.
Status: **COMPLETE**.

- Extend the existing `aelyris.context.set` and `aelyris.context.remove` adapters,
  `ContextStoreManager`, durable store, Event Bus, Governance, and audit journal. Do not
  add a context store, decision service, actor field, identity store, or AI-only world
  model path.
- Keep caller-supplied key and value as decision-domain inputs. They remain context
  data and never define the caller identity or enter actor evidence.
- Preserve current create/update/remove/no-change semantics, durable context ownership,
  DecisionChanged publication only for a real change, typed errors, and existing
  frontend/MCP read projections.
- Retain accepted/rejected audit with actor, operation, change kind when known,
  mutation/event-publication state, and stable one-way decision/input digests. Do not
  persist raw keys, values, previous values, Event Bus payloads, bearer values,
  environment values, or repository contents in the audit record.
- Event publication failure after a durable context mutation must remain explicit and
  must not be audited as fully coordinated success. Do not replay or roll back the
  Context Store mutation merely to obtain audit evidence.
- Done: an authenticated AI can set or remove the existing shared project context, and
  each effect is attributable without leaking decision contents or confusing data with
  caller identity.

### AIO-18 — Principal-Bound MCP Intent Mutation Evidence

Capability target: `Product-Accessible` intent propose/resolve whose initiating
identity comes from the authenticated MCP Principal while proposer, target, scope, and
payload remain coordination-domain data.
Status: **COMPLETE**.

- Extend the existing `aelyris.intent.propose` and `aelyris.intent.resolve` adapters,
  `IntentBus`, durable store if attached, Governance, Event Bus integration, and audit
  journal. Do not add an intent bus, proposal service, actor field, identity store, or
  AI-only coordination path.
- Keep caller-supplied intent id, proposer, target, kind, scope, payload, and resolution
  values as intent-domain inputs. They remain coordination data and never define the
  caller identity or enter actor evidence.
- Preserve validation, duplicate/stale resolution behavior, current state transitions,
  durable ordering, Event Bus publication semantics, typed errors, and the existing
  IntentBus as the sole mutation authority.
- Retain accepted/rejected audit with actor, operation, resulting state/outcome when
  known, mutation/event-publication state, and stable one-way intent/input digests. Do
  not persist raw ids, proposer/target, kind, scope, payload, resolution contents,
  Event Bus payloads, bearer values, environment values, or repository contents.
- Event publication failure after an intent mutation must remain explicit and must not
  be audited as fully coordinated success. Do not replay or roll back the IntentBus
  mutation merely to obtain audit evidence.
- Done: an authenticated AI can propose or resolve through the existing intent owner,
  and each effect is attributable without leaking coordination contents or confusing
  proposer/target metadata with caller identity.

### AIO-19 — Principal-Bound MCP Knowledge-Graph Mutation Evidence

Capability target: `Product-Accessible` knowledge-node and dependency-edge mutation
whose initiating identity comes from the authenticated MCP Principal while graph ids,
kinds, and file associations remain domain data.
Status: **COMPLETE**.

- Extend the existing `aelyris.knowledge.add_node`, `add_edge`, `remove_node`, and
  `remove_edge` adapters, `KnowledgeGraphManager`, Governance, and durable audit
  journal. Do not add a graph, mutation service, actor field, identity store, or
  AI-only structural-index path.
- Keep caller-supplied node ids, kinds, file associations, dependent/dependency ids as
  graph-domain inputs. They never define the caller identity or enter actor evidence.
- Preserve default node kind, endpoint auto-creation, node-removal edge cascading,
  exact edge removal, current no-op/idempotent behavior, typed errors, and the existing
  Knowledge Graph owner as the sole mutation authority.
- Retain accepted/rejected audit with actor, operation, changed/removed outcome when
  known, and stable one-way graph-target/input digests. Do not persist raw node ids,
  files, dependent/dependency ids, graph snapshots, bearer values, environment values,
  or repository contents in the audit record.
- Lock or owner failure must remain explicit and must not be audited as accepted. Do
  not replay a graph mutation merely to obtain audit evidence.
- Done: an authenticated AI can mutate the existing Knowledge Graph, and each effect is
  attributable without leaking graph targets or confusing structural data with caller
  identity.

### AIO-20 — Principal-Bound MCP Agent Coordination Mutation Evidence

Capability target: `Product-Accessible` activity/blocker reporting and typed avoidance
steering whose initiating identity comes from the authenticated MCP Principal while
session, task, file, symbol, blocker, and directive fields remain coordination data.
Status: **ACTIVE**.

- Extend the existing `aelyris.agent.report_activity`, `report_blocker`, and
  `steer_avoid` adapters, `AgentManager`, live symbol-ownership projection, Event Bus,
  Governance, and audit journal. Do not add an activity store, blocker service, steer
  channel, actor field, identity store, or raw terminal-write path.
- Keep caller-supplied session/task/file/symbol/action/blocker/files as coordination
  inputs. They remain fleet-domain values and never define the caller identity or enter
  actor evidence.
- Preserve live-session existence checks, existing AgentManager status/activity/blocker
  mutations, typed ownership-derived avoidance, Event Bus publication semantics,
  missing-session errors, and the prohibition on free-form pane injection.
- Retain accepted/rejected audit with actor, operation, mutation/publication outcome,
  count metadata when known, and stable one-way session/input digests. Do not persist
  raw session/task/file/symbol/action/blocker/directive/avoidance values, Event Bus
  payloads, bearer values, environment values, or repository contents.
- Event publication failure after a state mutation must remain explicit and must not be
  audited as fully coordinated success. Do not replay or roll back AgentManager state
  merely to obtain audit evidence.
- Done: an authenticated AI can report and steer through the existing typed fleet
  owners, and each effect is attributable without leaking activity or directive
  contents or confusing session metadata with caller identity.

## Deferred After GMV

Fleet Briefing `FB-1`, low-risk approval batching `AB-1`, Honest Cost Meter `CM-1`,
Proofbook catalog/history `PB-UI-1`, manual gates `PB-UI-2`, input-free start
`PB-UI-3`, exact current-run cancellation `PB-UI-4`, and cockpit budget binding
`CM-2` are complete, together with verified runner-owned artifact preview `PB-UI-5`.
Durable step evidence inspection `PB-UI-6`, bounded cap editing `CM-3`, validated
non-secret string inputs `PB-UI-7`, exact runtime-owned `agentSession` settlement
`PB-UI-8`, durable fleet cap persistence `CM-4`, and authenticated read-only
continuity snapshot `RC-1`, payload-free finite continuity changes `RC-2`, and
machine-readable observe-principal scope discovery `RC-3` are also complete.
Principal-scoped MCP tool discovery `AIO-1`, runtime-owned Proofbook agent settlement
for AI `AIO-2`, and authenticated actor-bound Proofbook gate decisions `AIO-3` are
also complete. Exact current Proofbook cancellation for AI `AIO-4` and authenticated
Principal-bound Proofbook run start `AIO-5` are complete. Authenticated mux input
identity `AIO-6`, authenticated direct REST session input identity `AIO-7`, and
WebSocket stream-ticket Principal continuity `AIO-8` and Principal-bound MCP pane-input
lease/audit `AIO-9` and Principal-bound MCP pane metadata control `AIO-10` are
complete. Principal-bound MCP agent lifecycle evidence `AIO-11`, Principal-bound MCP
worktree mutation evidence `AIO-12`, and Principal-bound MCP task mutation evidence
`AIO-13` and Principal-bound MCP file-ownership assignment evidence `AIO-14` are also
complete. Principal-bound MCP manual symbol-ownership mutation evidence `AIO-15` is
also complete. Principal-bound MCP derived symbol-ownership mutation evidence `AIO-16`
and Principal-bound MCP context decision mutation evidence `AIO-17` are also complete.
Principal-bound MCP intent mutation evidence `AIO-18` is also complete.
Principal-bound MCP knowledge-graph mutation evidence `AIO-19` is also complete.
Principal-bound MCP agent coordination mutation evidence `AIO-20` is active;
private-network exposure, live monitoring, remote approvals/input, SSH attach,
AI-authored review/merge shortcuts, secret-bearing Proofbook starts, broader input
types, raw artifact opening/export, and other adjacent value remain separately bounded
portfolio candidates.
Proofbook product access remains explicitly bounded to the completed cockpit slices;
it is not a claim that every Proofbook effect or future step kind is product-accessible.
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
