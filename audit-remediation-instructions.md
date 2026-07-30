# Comprehensive Audit Remediation Work Order

STATUS: ACTIVE  
PROGRAM: `audit-remediation`  
CURRENT PHASE: `A6`.
ACTIVE SLICE: `A6.8`.
LAST COMPLETED SLICE: `A6.7`.
NEXT PHASE: `A7` after A6 owner/behavior acceptance.
NEXT IMPLEMENTATION SLICE: `A6.8`.
A4.12 closes the corrective A4.7-A4.12 runtime-integrity program. The existing
`StartupReconciliationState` is mirrored across the sidecar process boundary with an
authenticated epoch-bound decision; sidecar REST session creation, Workflow starts,
and Proofbook starts remain default-closed until the shared decision is ready. The v8
acceptance owner combines authoritative mutation, EventBus delivery, execution fencing,
startup reconciliation, handoff acceptance, and admission surfaces in one executed
matrix. A6.2e1 moved generic project-artifact utilities to a neutral owner and added
an executable dependency-direction ratchet. A6.2e2 replaced App's whole-store
subscription with a shallow selector contract and fail-closed rerender proof. A6.2e3
now routes project/tab context changes through one lifecycle owner, executes cancel and
accepted-transition behavior, detaches Close Folder from the effective project path,
and routes keyboard tab switching through the same contract. A6.2e4 closes
generation-bound evidence polling, serialized pane request ownership, consumer-
acknowledged focus, initiating-tab agent spawn routing, owner-key-bound operational
selection, and explicit frontend artifact metadata. A6.2f component/command
composition and owner-local test splitting are complete. The v18 stop audit proves
that the remaining 41 `AppSilentBugs.test.ts` blocks are authoritative App wiring,
cross-owner integration, or retained completed-owner guards; it does not create a
new editor test owner merely to shorten the central file. A6.2g combined frontend
acceptance is complete from exact-SHA hosted run `30535550369` at `548fe1e`;
A6.3 Tauri IPC adapter, typed facade, event registry, and handler classification is
complete with 40/40 handlers classified, six native-input wrappers extracted to the
existing IME adapter, one Rust/TypeScript event-name contract, and a fail-closed
deletion policy. A6.4 MCP transport/catalog/schema/governance/domain dispatch is
complete with one catalog owner, one authorized dispatcher, exact 83/83/83
catalog/schema/dispatch parity, and `mcp.rs=2539 <= 5943`. A6.5 SQLite domain
repositories are complete behind the existing Database connection/migration owner.
A6.6 native proof CLI boundary is complete with an optional proof-only Cargo feature,
one router/readiness/client ownership split, exact command/schema preservation, and
   causal downstream freshness checks. A6.7 callsite-proven duplicate/unowned
   infrastructure removal is complete: the unregistered legacy `SessionManager`
   and its auto-discovered test were removed, authoritative Database/PTY/mux owners
   remain, and retained runtime/compatibility surfaces remain classified. A6.8
   combined ratchet and regression acceptance is implemented locally with one
   fail-closed combined owner and blocking hosted-candidate job. The exact frontier
   is its committed exact-SHA GitHub run plus externally verified run closeout. Do
   not reopen A4 or completed A6.2-A6.7 owners without a fresh regression, and do
   not mix A7 or native product expansion into A6.

## Objective

Execute the comprehensive 2026-07-10 remediation program without losing scope,
creating duplicate state owners, or relying on stale evidence. The detailed plan is
`docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md`.

This work order supersedes generic renderer/release continuation while it is ACTIVE.
Completed refactor/hardening orders remain historical preflight only. WU-UQ-1 is an
input to phase A3, not a concurrent active work order. Renderer Stage 2 is deferred to
conditional phase A8.

The full-native Rust migration package is registered as a high-priority queued
proposal under `docs/plans/full-native-rust-migration/`. It does not change the
current execution order or create a concurrent phase. The exact current slice is
owned only by this root work order and the canonical local handoff; stable
requirements/spec/native-package documents point here instead of copying that
volatile value.

```text
A4.12 complete
  -> A6.2e1-A6.2e4 complete -> A6.2f/A6 component and command composition
  -> A6.3 IPC adapter complete -> A6.4 MCP catalog and dispatch complete
  -> A6.5 SQLite domain repositories complete -> A6.6 native proof CLI complete
  -> A6.7 duplicate/unowned infrastructure complete -> A6.8 combined acceptance
  -> A7.0 scope lock -> one canonical A7 Core Mission
  -> A8.0 product-goal/architecture decision
  -> measured A8 terminal decision -> A9 closeout
  -> NUI-F0..F7 as the priority-1 post-A9 program
```

A8.0 may recommend a pre-A9 takeover only through an explicit owner decision and a
versioned rebaseline that accepts the release delay. Importing the proposal or
marking it high priority does not authorize that schedule change. The measured A8
terminal decision, A9 trust owners, and current claim boundary remain unchanged.

## Execution Order And Complexity Stop Rules

Owner decision, 2026-07-29. This is a portfolio-order clarification, not an
implementation phase and not a reduction of the product Goal.

1. **A4.12 is complete.** Cross-process sidecar session creation plus effectful
   Workflow and Proofbook starts share the existing startup admission owner, and the
   v8 combined crash/fault/restart matrix passes. Do not create A4.13 or reopen A4
   without a fresh regression.
2. **A6.7 is complete.** Execute **A6.8** to finish A6 by dependency direction,
   state ownership, executed behavior, and concurrency safety. File length remains
   a diagnostic non-growth ratchet, not a universal `<=800` completion requirement.
   Do not move logic solely to satisfy a line count.
3. Enter **A7.0** as a scope-lock gate before A7 runtime work. A7 Core proves only:
   request -> versioned plan preview -> visible implementation agent -> fresh tests
   -> independent review -> exact-OID accept/merge -> immutable completion packet.
   Proofbook product UI/recipes, Fleet Briefing, broad budget/cost UX, Remote
   Continuity, universal all-face Control Kernel migration beyond the enabled
   Mission path, and learning layers remain in the full Goal but are deferred from
   the release-blocking A7 Core.
4. **A6.6** isolated `aelyris_native` behind the optional `native-proof-cli`
   feature without expanding native functionality. A8.0 remains the only
   activation decision for further native/full-native work. **A6.7** removed only
   duplicate or unowned infrastructure whose registration, callsites,
   compatibility surfaces, and runtime ownership were disproved directly.
5. Do not start a verifier-cleanup program. When a touched owner relies on a brittle
   source-string check, replace or supplement that check with the smallest executed
   behavior proof needed for the changed risk. Add a new verifier only for a unique
   failure mode that no existing gate can decide.

The tracked plan owns the detailed scope and acceptance language for these steps.
The product spec/design/roadmap retain deferred destination requirements without
making them prerequisites of the canonical A7 Core Mission.

## Mandatory Read Order

1. `AGENTS.md` current status and work rules.
2. This work order.
3. `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md` when it exists.
4. `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`.
5. `docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md`, active phase only.
6. Current Git truth and generated artifacts named by the local handoff.
7. Active phase owner files only.

The local handoff is routing guidance. Fresh Git/verifier truth wins if they disagree.

## Continuation Contract

```yaml
continuation_contract:
  tracked_plan: docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md
  root_work_order: audit-remediation-instructions.md
  worklog_dir: .codex-auto/worklogs/audit-remediation/
  local_handoff: .claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md
  verifier: pnpm verify:audit-remediation:continuation
```

## Phase Order

| Phase | Scope | Entry condition | Completion evidence |
| --- | --- | --- | --- |
| R0 | tracked plan, records, resume routing, continuation verifier | audit complete | continuation gate PASS |
| A0 | consent, score, evidence provenance, signing/updater/native claim truth | R0 complete | authority/evidence gates PASS |
| A1 | one daemon-owned terminal write/approval authority | A0 complete | adversarial all-face input tests PASS |
| A2 | Windows trust, updater lifecycle, immutable evidence DAG | A1 complete | repo-owned trust/evidence PASS; signed lifecycle remains an A9 release gate |
| A3 | pane liveness, reconnect, paste, close/shortcut/fleet truth | A2 repo-owned work complete and release-only external proof explicitly deferred | focused + rendered trust gates PASS |
| A4 | session/DB migration, backup, restore, failure durability | A3 complete | upgrade/restart/fault tests PASS |
| A5 | supervised execution and lock/concurrency boundaries | A4 complete | timeout/cancel/concurrency gates PASS |
| A6 | owner-based splits and modularity ratchets | A5 complete | ratchet + focused tests PASS |
| A7 | one canonical Mission path from request and plan preview through visible execution, fresh tests, independent review, exact-OID settlement, and immutable completion packets | A6 complete and A7.0 scope lock accepted | successful commit-bound Core Mission scenario plus blocked-settlement negative scenario PASS |
| A8.0 | native product-goal/architecture decision; current hybrid vs mature Rust framework vs custom retained runtime | A7 complete | accepted-as-written/accepted-with-amendments/deferred/rejected ADR-014 decision; both accepted results use one activation branch; no capability credit |
| A8 | measured terminal-only native spike | A7 complete and metrics justify | parity/perf/soak decision artifact |
| A9 | CI/release/external proof closeout | A0-A8 complete/deferred by evidence | enforced release lane + operator proof |

Do not skip to a later phase because it is easier to score. Do not parallelize phases
that touch shared scripts, IPC, terminal, or claim docs.

## R0 Acceptance

```powershell
node --check scripts/verify-audit-remediation-continuation.mjs
pnpm verify:audit-remediation:continuation
pnpm verify:ai-decision-knowledge
pnpm verify:requirements-spec-design-traceability
git diff --check
git status --short --branch
```

R0 is `ready-to-commit` when these pass and the local handoff/worklog contain the exact
dirty-tree truth. Mark R0 `complete` after its one phase commit when commit is authorized.

## A0.1 Complete - No-Token / Token-Spending Authority Split

Objective: ensure a command named or documented as no-token cannot execute an
authenticated prompt, while retaining a separately consented operator smoke.

Read/owner files:

- `package.json`
- `scripts/verify-final-goal-safe.mjs`
- authenticated prompt/preflight/consent verifiers
- `AGENTS.md`
- `docs/requirements.md`
- `docs/AGENT_WORKFLOWS.md`
- release/final-goal score-path docs selected by the claim router

Required output:

1. Explicit `verify:goal:safe:no-token` command and artifact.
2. Explicit token-spending operator command and current consent packet.
3. Runtime assertion that the no-token chain contains and executes no token step.
4. Documentation with one authority and no contradictory wording.
5. Focused mutation test proving accidental token-step inclusion fails.

Forbidden in A0.1:

- terminal/product implementation,
- score threshold changes,
- manual artifact edits,
- running a token prompt merely to make the no-token gate green,
- renderer/full-native work.

Completion evidence:

- `pnpm verify:goal:authority-contract` passes the descriptor, environment-scrub,
  one-use packet, replay, expiry, digest, provider, and path-indirection checks.
- `pnpm verify:goal:safe:no-token` records
  `tokenSpendingPromptExecutedByThisRun=false` and a separate historical evidence
  field even when product, stale-evidence, policy, or external blockers keep the
  aggregate safe chain blocked.
- the token-bearing smoke has one operator entry point,
  `pnpm verify:goal:operator:token-smoke -- --provider <provider>`, and is not part
  of the no-token graph or operator-finish path.

## A0.2 Exact Next Slice

Objective: make every scored artifact prove where it came from and when it is valid,
then remove score/final-audit dependency cycles so one direct defect is not multiplied
through derived rows.

Read/owner files:

- `scripts/score-release-quality.mjs`
- `scripts/verify-final-goal-audit.mjs`
- score/final-audit artifact readers selected from those two owners
- provenance/freshness helpers and focused mutation verifiers
- score-path and claim-policy docs selected by `AI_GUIDE.md`

Required output:

1. One provenance schema binding generated evidence to Git HEAD, verifier digest,
   input hashes, execution identity, generation time, and expiry/freshness policy.
2. Fail-closed score ingestion for missing, stale, mismatched, or cyclic evidence.
3. An explicit dependency graph that separates direct defects from aggregate and
   derived rows.
4. Focused mutations for stale evidence, wrong HEAD/digest/input hash, graph cycles,
   and duplicate root-cause counting.
5. Current score/final-audit/docs regenerated through commands only; generated JSON
   is never edited by hand.

Forbidden in A0.2:

- lowering score thresholds or reclassifying failures to recover points,
- signing/updater implementation, terminal/product implementation, or UI work,
- treating aggregate failures as additional unique direct defects,
- running the operator token smoke merely to refresh score evidence.

## A0.2 Complete - Evidence Provenance And Acyclic Score Truth

Completion contract:

- `aelyris.evidence-provenance/v1` binds evidence to Git HEAD, verifier digest,
  input hashes, execution identity, generation time, and expiry.
- score and final-audit readers fail closed on missing, stale, mismatched, or
  expired provenance; non-JSON artifact credit requires a validated sidecar.
- release score contains only direct rows in its numerator/denominator;
  aggregate and derived rows remain visible but cannot duplicate score credit or
  unique direct defect counts.
- final-goal audit is downstream of release score and cannot feed points back
  into its own input.
- `pnpm verify:evidence-provenance-contract` rejects stale, wrong-HEAD,
  wrong-verifier, wrong-input, cycle, duplicate-node, and duplicate-root-cause
  mutations.

Legacy artifacts without the envelope intentionally receive zero artifact-backed
credit. Their migration is explicit evidence debt, not permission to restore mtime
fallbacks.

## A0.3 Exact Next Slice

Objective: remove the remaining false-positive release credit and ambiguous native
readiness wording, then make blocked release health enforceable in CI.

Read/owner files:

- release signing/updater verifiers and distribution score rows
- `scripts/verify-full-native-rust-gap-audit.mjs`
- `scripts/score-release-quality.mjs` enforce-mode entry point
- release/claim docs selected by `AI_GUIDE.md`

Required output:

1. Authenticode identity and timestamp-chain proof; detached updater signatures
   cannot substitute for Windows executable signing.
2. Updater credit requires capability wiring, reachable metadata, signature
   verification, install/relaunch, rollback/failure, and current provenance.
3. Full-native artifact and score labels describe measured coverage/gap only and
   cannot imply shipping-shell readiness.
4. `--enforce` exits non-zero for a D or release-blocked result while the default
   diagnostic command continues to emit the report.
5. Focused mutations cover unsigned binaries, stale/unreachable metadata,
   lifecycle failure, misleading native-ready labels, and enforce-mode blocking.

Forbidden in A0.3:

- creating signing material or committing signatures/secrets,
- awarding partial signing credit from file existence,
- lowering score thresholds,
- terminal/product/UI implementation,
- running token-spending prompt smoke.

## A0.3 Complete - Windows Trust Claim And Enforcement Truth

Completion contract:

- signing readiness requires valid Authenticode signer and timestamp chains for
  app exe, NSIS, and MSI plus separate current updater signatures.
- updater readiness requires wired capability, valid current manifest, reachable
  production metadata, and a provenance-valid install/relaunch plus rollback/failure
  lifecycle proof.
- unsigned local dist remains useful smoke evidence but receives zero signed
  distribution credit.
- native audit emits `aelyris.native-coverage-gap/v2` with
  `measuredCoveragePercent` and `shippingShellReady=false`; it cannot emit the
  old `fullNativeReady`/bare `percent` claim shape.
- `pnpm verify:quality-score:enforce` exits non-zero while the score is D or
  release-blocked.
- `pnpm verify:release-evidence-truth` rejects unsigned, missing timestamp,
  unreachable metadata, lifecycle failure, misleading native-ready label, and
  blocked enforce-mode mutations.

Current missing signing identity, endpoint reachability, and live updater lifecycle
proof remain external/operator evidence blockers. They do not reopen A0.3 repo-owned
truth logic.

## A1 Complete - Daemon-Owned Terminal Input Authority

Completion contract:

- every terminal write face constructs a typed envelope and delegates classification
  and delivery to `TerminalInputAuthority`, including REST, WS, MCP, mux, IPC,
  broadcast, native input/paste, sidecar, and runtime lifecycle prompts,
- ACK is emitted only after every effective target accepts the raw write; failures
  return a typed NACK and queue acceptance is never represented as execution success,
- waiting interactive approvals are session, prompt-fingerprint, and effective-target
  bound; raw programmatic Enter, stale claims, replay, and cross-target mutation fail
  closed,
- the sidecar input-authority capability and human-approval capability are separate
  from public bearer possession,
- `verify-runtime-core-preconditions` covers the authority contract and the full Rust
  library suite passes 1207/1207.

The two changed API integration executables compile but cannot start on the current
host (`STATUS_ENTRYPOINT_NOT_FOUND`, `0xc0000139`); this is recorded as host execution
evidence debt, not a passing integration run. `cargo check --all-targets` also exposes
an older out-of-scope `tests/test_agent.rs` reference to the removed `agent::parser`.

## A3 Complete - Repo-Owned UI Trust Surface

- Q0-Q10 and the rendered repair are committed through `8fb3d4e`.
- `verify:ui:trust` is enforced and registered in goal-safe and quality-score truth.
- the Aelyris-owned rendered Playwright suite is a blocking Windows CI job.
- the unrelated roadmap dashboard on port 48371 is excluded from that product gate and
  remains an explicit operator visual check via `AELYRIS_E2E_EXTERNAL_DASHBOARD=1`.
- live IME, staged sidecar kill, populated-cockpit review, and final DWM/WebView2 glass
  parity remain external/operator proof debt and do not become repo-owned PASS claims.

## A4 Complete - Runtime Integrity Correction

- A4.1-A4.6 remain historical implementation/evidence, but their former aggregate
  `phaseComplete=true` was a semantic false positive exposed by fresh review.
- A4.7 is complete: ContextStore and TaskManager use persist-before-publish mutation
  order, production instances reject mutation without durable attachment, IPC/MCP
  propagate the error, and focused injected-failure tests pass.
- A4.8 is complete: EventBus/EventRepo remain the sole owner, commit outbox rows
  before cache/emit, expose stable idempotency identity and durable consumer ACK,
  validate the same-owner high-water plus cursor/event binding before empty success,
  propagate lifecycle producer partial-success, and fail closed on
  append/query/corrupt/gap truth through a structured MCP envelope. Delivery is
  at-least-once, never claimed exactly-once.
- A4.9 is complete: the existing TaskManager owns durable WorkExecutionAttempt/
  AgentRun generations and all seven effect fences; generated UUIDv7 identities are
  validated on reload, reservations bind durable EventBus/ownership identities before
  the first external effect, and stale full-token writes are rejected or quarantined.
- A4.10 is complete: the single bounded startup barrier reconciles all seven runtime
  authorities before terminal spawn or either orchestrator dispatch face is admitted.
  Ambiguous effects remain visible and quarantined, old execution rows without immutable
  repo identity are not guessed, and EventBus startup inspection validates every outbox
  row and registered cursor.
- A4.11 is complete: schema v6 extends the existing `session_handoffs` owner with
  immutable generation/checkpoint/baton acceptance and typed cleanup outcomes.
  Successor authority is stopped or sticky-quarantined behind the shared terminal
  write gate, failed/ambiguous rows reconcile at boot, and legacy rows are not
  promoted to accepted by migration.
- A4.12 is complete: the existing startup state is mirrored into the long-lived
  sidecar through a private epoch-bound admission sync; stale Ready cannot overwrite a
  newer Pending epoch, local Ready is not exposed before the remote mirror succeeds,
  the sidecar's lowest PTY spawn boundary serializes actual process creation against a
  new Begin transition, and direct REST plus mux-backed creation cannot bypass the
  same Pending/Failed state. Effectful Workflow starts and every Proofbook adapter
  that can resume execution use the same contract. A4 acceptance v8 now requires
  25/25, including a separate real-process HTTP scenario, before its six-domain
  combined runtime-integrity matrix may report `phaseComplete=true`.
- The admission sync claim is current protocol v4 host-sidecar pairs only. A live
  protocol-v3 sidecar must be restarted; that compatibility residual is nonblocking
  and does not authorize a migration service inside A4.
- A6.2e1 is complete: generic artifact path/JSON parsing lives in
  `src/shared/lib/projectArtifacts.ts`; bootstrap and cross-feature consumers import
  their declaration owners directly; utility tests and the frontend ratchet prove
  the forbidden dependency direction and diagnostic non-growth ceilings. The
  right-rail model is 670 lines versus its 688-line ceiling.
- A6.2e2 is complete: App subscribes through the shallow `useAppShellStore`
  selector contract; focused behavior proof shows unrelated store mutation does not
  rerender the shell owner, and the frontend ratchet rejects selector-less aliases
  and skipped required behavior assertions.
- A6.2e3 is complete: open, switch, close-folder, inactive close, and active close
  route through `useProjectTabLifecycle`; cancel preserves active editor, interactive
  session, and pane snapshots, accepted active-context changes clear editor and
  interactive state after transition success, Close Folder detaches the effective
  project path, and keyboard tab switching uses the same lifecycle contract.
- A6.2e4 is complete: project evidence commits one generation atomically and rejects
  overlap and stale adoption; pane mutation requests serialize per kind while focus
  uses typed latest-wins settlement acknowledged by its consumer; agent spawn and
  operational selection callbacks remain bound to their initiating tab/project owner.
  The frontend ratchet records explicit A6.2e4 contract metadata and executes the
  required concurrency, cancellation, routing, and cleanup behavior.
- A6.2f terminal command composition checkpoint is complete: `useAppMenus.ts` is 433
  lines, `useTerminalMenuCommands.ts` is 639 lines, and the focused ratchet proves the
  preserved command/menu order, pane-switch routing, failed-focus reporting, and
  post-confirm broadcast target recheck.
- A6.2f right-rail shell checkpoint is complete: `RightRailShell.tsx` is 107
  lines and its pure contract is 14 lines. App supplies visibility, width, mode,
  badges, and two typed actions without transferring state ownership; executed
  tests prove content/badge projection, click and roving-tab behavior, keyboard
  and pointer resize semantics, pointer-owner cleanup, and hidden-state projection.
  `rightRailModel.tsx` no longer wildcard-re-exports adjacent owners, and affected
  App/hooks import their declaration owners directly. The frontend ratchet v2
  lowers App/model ceilings to 4155/666 and fixes non-growth ceilings for both new
  shell files. The artifact truthfully retains `completedSlice=A6.2e4`,
  `activeSlice=A6.2f`, `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f review-mode body checkpoint is complete: `RightRailReviewMode.tsx` is 87
  lines and its pure contract is 33 lines. Review queue, inspector slot, SCM, and
  compact context composition use the existing lazy registry plus an eight-field
  projection, five actions, and two render slots without copying runtime state.
  Executed tests prove projection and review/SCM/agent intent routing. App is 4118
  lines, the frontend ratchet contract is v3, and the artifact still truthfully
  retains `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f command-mode body checkpoint is complete: `RightRailCommandMode.tsx` is
  159 lines and its pure contract is 48 lines. Toolkit, Decision Inbox, agents,
  orchestrator, workflow, and context composition use one grouped projection,
  seven actions, and three render slots. The existing panels retain their runtime
  owners; no dependency, store, service, queue, scheduler, or duplicate runtime
  owner was added. Executed tests prove projection plus toolkit, decision, and
  workflow intent routing. App is 4048 lines, the frontend ratchet contract is v4,
  and the artifact still truthfully retains `completedSlice=A6.2e4`,
  `activeSlice=A6.2f`, `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f observe-mode body checkpoint is complete: `RightRailObserveMode.tsx` is
  205 lines and its pure contract is 64 lines. Process, live-pane, audit,
  context, run graph, tool ledger, inspector, reliability, and diagnostic-log
  composition use one grouped projection, twelve actions, and five render slots.
  Existing panel and App runtime owners remain single. Executed tests prove
  projection plus process, pane, audit, session, reliability, and destination
  intent routing. App is 3929 lines, the frontend ratchet contract is v5, and
  the artifact still truthfully retains `completedSlice=A6.2e4`,
  `activeSlice=A6.2f`, `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f workspace editor-area checkpoint is complete:
  `WorkspaceEditorArea.tsx` is 66 lines, its pure contract is 14 lines, and its
  owner-local styles are 97 lines. File tabs, keyboard activation, close routing,
  active editor projection, and editor-started agent intent route through one typed
  boundary. `EditorPanel` remains lazy under that boundary, and the existing
  editor/tab/runtime state owners remain single. Executed tests prove projection
  plus tab, close, and agent intent routing. App is 3889 lines, the frontend ratchet
  contract is v6, and the artifact still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- A6.2f product mode-rail checkpoint is complete: `ProductModeRail.tsx` is 66
  lines and its pure contract is 11 lines. Active mode and hidden state project
  through one typed boundary, while click and Alt+number intents route through one
  action. The owner stays mounted when Zen mode hides the rail, preserving the
  pre-existing shortcut behavior. Executed tests prove projection, pointer routing,
  visible shortcut focus, and hidden-rail shortcut routing. App is 3848 lines, the
  frontend ratchet contract is v7, and the artifact still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- A6.2f workspace-sidebar checkpoint is complete: `WorkspaceSidebar.tsx` is 95
  lines and its pure contract is 9 lines. Hidden state and width project through
  one typed boundary; pointer and keyboard resize intents return through one
  action. Named Files, Tasks, Source Control, and Search slots preserve the
  existing FileTree, Kanban, SCM, Search, project, tab, and navigation runtime
  owners. Executed tests prove section/content projection, collapsed/Zen
  visibility, keyboard resizing, pointer resizing, and drag cleanup. App is 3788
  lines, the frontend ratchet contract is v8, and the artifact still truthfully
  retains `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f app-dialog-host checkpoint is complete: `AppDialogHost.tsx` is 51
  lines and its pure contract is 10 lines. Ten typed lazy-dialog entries project
  visibility through the shared `LazyDialog` boundary; Prompt, Confirm,
  Handoff, Orchestra, History, Onboarding, and Fleet surfaces now have one
  placement owner. History acceptance routes through one typed action while
  individual close, project, pane, agent, and navigation runtime owners remain
  unchanged. Executed tests prove visible-only projection, close/intent
  preservation, persistent surface placement, and history routing. The first two
  owner-local test splits are also complete: all 16 `useReleaseGoalEvidence` and
  all 8 `useAuthenticatedPromptEvidence` source-contract assertions moved from
  `AppSilentBugs.test.ts` into their existing executed owner suites, while the
  central test retains only App's effective-project composition wiring for those
  hooks. App is 3769 lines, the frontend ratchet contract is v11, and the artifact
  still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- A6.2f AI-CLI-launch-evidence test-owner checkpoint is complete: the remaining
  candidates were compared and `useAiCliLaunchEvidence` was selected as the
  only next owner tied with the preceding authenticated-prompt candidate on
  closed declaration ownership and existing behavior proof. All 9 assertions
  that inspect `useAiCliLaunchEvidence.ts` now live beside its overlap,
  project-change, unmount, partial-preflight, failure, and telemetry contracts.
  `AppSilentBugs.test.ts` retains only
  `useAiCliLaunchEvidence(projectPath)` because App owns that composition
  wiring. The frontend ratchet contract is v12 and requires the exact
  owner-local source-contract test to execute and pass through structured
  Vitest assertion status handling. The artifact still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f pane-agent-spawn test-owner checkpoint is complete: all 6 assertions
  that inspect `usePaneAgentSpawns.ts` now live beside its explicit tab/repo
  ownership, delayed-event, listener-cleanup, deduplication, and multi-tab
  retention behavior proof. `AppSilentBugs.test.ts` retains only
  `usePaneAgentSpawns(paneAgentSpawnOwners)` because App owns that composition
  wiring. The frontend ratchet contract is v13 and requires the exact
  owner-local source-contract test to execute and pass through structured
  Vitest assertion status handling. The artifact still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f operational-pane-selection test-owner checkpoint is complete: the
  remaining candidates were compared and `useOperationalPaneSelection` was
  selected over the one-test pane-registry boundary and the 12-test pane-request
  concurrency suite. All 5 assertions that inspect
  `useOperationalPaneSelection.ts` now live beside its pane reconciliation,
  owner-key transition, stale-callback rejection, and audit/reliability
  selection behavior proof. `AppSilentBugs.test.ts` retains only
  `useOperationalPaneSelection(visualTerminalPaneTargets, projectPath)` because
  App owns that composition wiring. The frontend ratchet contract is v14 and
  requires the exact owner-local source-contract test to execute and pass
  through structured Vitest assertion status handling. The artifact still
  truthfully retains `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f pane-registry test-owner checkpoint is complete: the remaining
  candidates were compared and `usePaneRegistry` was selected over the
  12-test pane-request concurrency suite and the mixed App/keyboard
  project-lifecycle boundary. All 4 assertions that inspect
  `usePaneRegistry.ts` now live beside its active-PTY/registry cleanup and
  late-callback rejection behavior proof. `AppSilentBugs.test.ts` retains
  only `usePaneRegistry(` because App owns that composition wiring. The
  frontend ratchet contract is v15 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest
  assertion status handling. The artifact still truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- A6.2f pane-request-controller test-owner checkpoint is complete: all 6
  assertions that inspect `usePaneRequestController.ts` now live beside
  its twelve concurrency, cancellation, settlement, routing, and cleanup
  behavior tests. `AppSilentBugs.test.ts` retains only
  `usePaneRequestController({` because App owns that composition wiring.
  The frontend ratchet contract is v16 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest
  assertion status handling. No production source or runtime owner changed.
  The artifact still truthfully retains `completedSlice=A6.2e4`,
  `activeSlice=A6.2f`, `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f project-tab-lifecycle test-owner checkpoint is complete: all 12
  assertions that inspect `useProjectTabLifecycle.ts` now live beside its
  five open, switch, close-folder, inactive-tab close, and active-tab close
  behavior tests. `AppSilentBugs.test.ts` retains the six App composition
  assertions and two keyboard-routing assertions because App and
  `useKeyboardShortcuts` own those wiring boundaries. The frontend ratchet
  contract is v17 and requires the exact owner-local source-contract test to
  execute and pass through structured Vitest assertion status handling. No
  production source or runtime owner changed. The artifact still truthfully
  retains `completedSlice=A6.2e4`, `activeSlice=A6.2f`,
  `sliceComplete=false`, and `phaseComplete=false`.
- A6.2f owner-split stop audit is complete: the original 42-block inventory
  reconciles to 41 current blocks because the separate unsaved guard moved into
  the project-tab lifecycle owner. The remaining breakdown is 11 App/extracted-
  owner wiring blocks, 15 release/operator scenarios, 13 right-rail/terminal
  integration blocks, and 2 visual-QA truth blocks. No completed owner source
  path remains centralized. `useEditorOpenMode` remains the only direct
  declaration-owner source read, but it has no existing owner-local behavior
  suite and no fresh regression; creating a new suite solely to reduce central
  file size would violate the complexity and completed-owner stop rules. The
  frontend ratchet contract is v18, requires this topology and absence proof,
  records `completedSlice=A6.2f`, `activeSlice=A6.2g`,
  `sliceComplete=false`, and `phaseComplete=false`, and adds no production or
  runtime owner.
- A6.2g combined frontend acceptance is complete. Exact-SHA hosted run
  `30535550369` at `548fe1e` passed rendered UI trust, frontend, Rust, dependency
  audits, and the blocking A6.2 combined job. The hosted artifact reports
  `status=pass-a6.2g-combined-frontend-acceptance`,
  `frontendComplete=true`, `sliceComplete=true`, `completedSlice=A6.2g`,
  `activeSlice=A6.3`, and `phaseComplete=false`. The overall workflow remains
  red only because release hardening separately retains its stack-risk blocker.
  Do not reopen completed right-rail, editor, mode-rail, sidebar, dialog-host,
  or A6.2 test owners without a fresh regression.
- A6.2g local gate-contract checkpoint is implemented: the modularity inventory
  now emits an explicit fail-closed A6.2 frontend slice result while retaining
  its global BLOCK and every later Rust ceiling. `pnpm
  verify:a6:frontend-acceptance` combines the production build, enforced A3 UI
  trust contract, v18 frontend ratchet, frontend-slice inventory, fresh
  provenance, and blocking CI source contract. The blocking Windows CI job
  depends on both the normal frontend job and rendered Playwright trust job.
  Local PASS remains non-completing; only the exact committed SHA in the blocking
  hosted context may emit A6.2 completion. That hosted proof is now green at
  `548fe1e`. The enforced A3 source contract follows split
  menu IDs through `useAppMenus.ts` into their extracted
  `useTerminalMenuCommands.ts` owner while retaining App's
  `TERMINAL_PREFIX_COMMAND_EVENT` dispatch boundary; executed terminal-menu
  behavior remains covered by the v18 ratchet.
- A6.3 Tauri IPC adapter closeout is complete. The machine inventory classifies
  all 40 frozen handlers against the sole `generate_handler!` registration owner,
  frontend invokes, MCP/HTTP reuse, tests, and observed compatibility aliases;
  absence alone never authorizes deletion. Six native-input wrappers now live in
  the existing IME adapter, while shared commit/write authority remains in
  `commands.rs`. Fourteen terminal/agent/chat event names have one Rust owner and
  one typed TypeScript projection, and the verifier rejects owner-external
  production Rust literals. The A6.3 slice gate passes at
  `commands.rs=4429 <= 4574`; independent review round 2 reports zero findings,
  while the global A6 artifact truthfully remains failed and
  `phaseComplete=false`.
- A6.4 MCP catalog and dispatch closeout is complete. `mcp.rs` owns transport and
  the ordered governance -> schema -> dispatch boundary; `mcp/catalog.rs` is the
  sole runtime catalog/schema owner; `mcp/dispatch.rs` is the sole authorized
  global dispatcher and delegates to existing runtime owners. The focused gate
  passes with frozen/catalog/schema/dispatch counts `83/83/83/83`, exact set
  parity, negative missing/extra/duplicate probes, guarded Proofbook re-entry, and
  schema digest and mutation rejection, governance/audit-before-schema for
  nested Proofbook calls, and `mcp.rs=2539 <= 5943`. Rust library tests pass
  1307/1307. This completes only
  A6.4; the global artifact remains failed and `phaseComplete=false`.
- A6.5 SQLite domain repository closeout is complete. Code-graph snapshot and
  pane-layout behavior now live in owner-local child modules behind the unchanged
  `Database` facade; there is still one connection, migration, and schema owner.
  The focused database surface passes 27/27, the Rust library passes 1308/1308,
  transaction rollback and pane-layout validation remain executable, and four
  negative topology mutations reject commented registration, independent
  connections, duplicate schema ownership, and duplicate facade methods.
  `queries.rs=3174 <= 3330`; A6 remains `phaseComplete=false`.
- A6.6 native proof CLI closeout is complete. `aelyris-native` is excluded from
  default application builds behind the optional `native-proof-cli` feature;
  router, readiness contract, and daemon client responsibilities live in
  owner-local modules without a second runtime, storage, state, or command owner.
  The frozen 40-command and 62-schema contracts, exit behavior, supported-host
  boundary, and live native-client behavior remain executable. All downstream
  freshness consumers now include all four proof source owners; the A6.6
  native-client, text-shaping, sleep-guard, and upper-compat proof paths build the
  current feature-gated binary, and a negative child-source mutation is rejected.
  `aelyris_native.rs=8436 <= 8827`, focused native tests pass 7/7, live
  native-client checks pass, upper compatibility passes 6/6, text shaping
  produces a fresh current fixture, Rust library tests pass 1308/1308, and A6
  remains `phaseComplete=false`.
- A6.7 duplicate/unowned infrastructure closeout is complete. A callsite-first
  inventory accepted removal only for the unregistered legacy `SessionManager`
  and retained the runtime-reachable `PaneRegistry` and typed IPC facade. The
  package is explicitly unpublished, no supported Rust SDK contract is claimed,
  missing-path provenance rejects reintroduction, scanner-bound negative mutations
  pass 4/4, focused Database tests pass 3/3, mux restore tests pass 7/7, and Rust
  library tests pass 1308/1308. Independent review found two blocking evidence
  gaps; both bounded rework rounds are closed with zero remaining blockers. A6
  remains `phaseComplete=false`.
- Continue A6.8 as the only combined A6 acceptance. It must aggregate current
  A6.2-A6.7 owner/behavior evidence and blocking exact-SHA CI before it can retire
  advisory mode or emit A6 `phaseComplete=true`. A8.0 remains the sole native
  activation decision.
- A6.8 local implementation is ready for hosted proof. The combined verifier
  executes the default A6.2-A6.7 aggregate, requires exact current provenance,
  all six frozen owner ceilings, each slice and its negative proof, and the A6.3
  same-line-count event-registry mutation. Local and in-progress hosted-candidate
  execution remain `phaseComplete=false`; only explicit post-run closeout may
  query the authenticated GitHub CLI, and it requires a clean worktree plus exact
  repository/workflow/run/SHA/attempt and five completed-success job bindings.
  The workflow must be completed, but its aggregate conclusion does not override
  those five bindings because the separate release-hardening job retains its own
  blocker and did not block the A6.2g exact-SHA precedent.
  The frontend acceptance now consumes inventory schema v3, uses a measured
  360-second modularity timeout, and records the A6.3-required one-line
  `PaneTreeContainer` owner growth at a 1692-line diagnostic ceiling. Hosted
  run `30570956763` exposed and closed a stale frontend test reference to the
  removed A6.7 `SessionManager`. Replacement run `30571656787` then proved the
  normal frontend, rendered UI, and Rust jobs but exposed that required A6.2
  mode still executed later A6.5-A6.7 Rust behavior and exhausted the child
  timeout. Required-slice mode now executes only the requested slice behavior,
  reports every skipped later behavior as `not-run`, and leaves global truth
  `not-evaluated`; default A6.8 mode still executes all A6.2-A6.7 behavior.
  Local required-slice matrix, frontend acceptance, and combined acceptance
  pass, but replacement hosted completion remains unobserved.
- real OS sleep/resume and abrupt host power-loss evidence is not claimed by the
  deterministic matrix. It remains an A9 operator gate at
  `.codex-auto/operator-evidence/real-sleep-power-loss-durability.json`.

## Work and Session Rules

- Follow `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md` before every session clear.
- Record exact commands and artifact paths; do not summarize a failure as PASS.
- Keep implementation, stale evidence, policy, and external blockers separate.
- Keep local handoff/worklogs ignored and secret-free.
- Verified phase commits are standing-authorized by the owner: explicitly stage the
  phase paths and commit after its focused gates pass without asking again. Push,
  PR, merge, rebase, reset, amend, history rewrite, and force push remain separately
  authorized. If dirty work crosses session clear, list every intended path and the
  exact next action in the local handoff.
- At most one phase can be ACTIVE. Completed phases reopen only for a fresh regression.
