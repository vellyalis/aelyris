# Comprehensive Audit Remediation Plan

Status: active implementation plan.  
Program id: `audit-remediation`.  
Source audit: local generated report
`.codex-auto/quality/COMPREHENSIVE_PRODUCT_ARCHITECTURE_AUDIT_2026-07-10.md`.  
Root work order: `audit-remediation-instructions.md`.

## Claim Boundary

This plan does not claim production or release readiness. It converts the 2026-07-10
multi-domain audit into an executable dependency graph. Current release truth must be
regenerated from `.codex-auto/quality/*`; do not copy an old score from this plan.

## Goal

Reach a state where:

- terminal writes and approvals have one daemon-owned authority,
- completion/readiness claims are derived from immutable evidence,
- session and database durability survive upgrades and failure,
- UI liveness and destructive actions are truthful,
- large ownership hotspots shrink under ratcheting gates,
- the first useful mission can be completed and reviewed end to end,
- Tauri remains the cockpit unless measured evidence justifies a native terminal
  surface, and
- every phase can survive session clear with exact work records and one resume pointer.

## Program Invariants

1. One active phase at a time; no shared-file parallel execution.
2. One state owner and one write authority per contract.
3. One phase equals one commit when commit is authorized.
4. Add or strengthen a failing test/verifier before risky implementation where practical.
5. Never hand-edit `.codex-auto` JSON to produce a pass.
6. Separate implementation, stale evidence, policy, and external blockers.
7. Follow `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md` at every session close.
8. Tauri/full-native decisions are measurement-gated, not preference-gated.

## Execution Sequence And Complexity Budget

Owner decision, 2026-07-29. The exact active slice remains volatile state owned by
`audit-remediation-instructions.md` and the canonical local handoff. This plan owns
the durable dependency order:

1. A4.11 closes structured handoff acceptance inside existing owners.
2. A4.12 closes the remaining startup-admission surfaces and then runs one combined
   runtime-integrity matrix. No new A4 slice is added for already-known acceptance
   gaps.
3. A6.2-A6.5 are complete; A6 resumes at A6.6 and is accepted by ownership,
   dependency direction, behavior, and concurrency evidence. Line counts are
   non-growth diagnostics, not universal architectural targets.
4. A7.0 locks one canonical Core Mission before runtime work. The release-blocking
   A7 path is request -> versioned plan preview -> visible implementation -> fresh
   tests -> independent review -> exact-OID accept/merge -> immutable completion
   packet.
5. A8.0 remains the sole product/architecture activation decision for additional
   native/full-native work. A6.6 may isolate the existing proof binary but may not
   expand its product scope.

Complexity stop rules:

- extend the existing TaskGraph, EventBus/journal, execution, handoff, Proofbook,
  review, and merge owners; do not add parallel owners,
- do not split files or move logic solely to satisfy a numeric line target,
- replace brittle source-shape checks with executed behavior proof as their owner is
  touched; do not open a standalone verifier-cleanup program,
- add a verifier only when an existing gate cannot decide a unique material failure
  mode,
- keep Proofbook productization, Fleet Briefing, recipes, broad budget/cost UX,
  Remote Continuity, universal all-face Control Kernel migration beyond the enabled
  Core Mission path, and learning layers in the full product Goal but outside A7
  Core acceptance.

## Dependency Graph

```text
R0 continuation contract
  -> A0 authority and evidence truth
  -> A1 terminal input authority
  -> A2 Windows trust and evidence DAG
  -> A3 UI trust surface
  -> A4 session and database durability
  -> A5 execution supervision and concurrency
  -> A6 modularity ratchet
  -> A7 one canonical evidence-backed Core Mission
  -> A8.0 native product-goal/architecture decision
  -> A8 measured native terminal spike
  -> A9 release lane and external proof closeout
```

A3 may read the existing WU-UQ-1 design, but it does not run concurrently with A1/A2
repo-owned implementation. By owner decision on 2026-07-11, A2's unavailable
operator-controlled signed lifecycle is deferred to A9 rather than blocking A3. This
does not complete A2's release acceptance, remove the blocker, or permit a release-ready
claim; `releaseLifecycleReady=false` remains authoritative until the real signed run.
A8 is conditional and cannot start from the historical `98% full-native` artifact.
Current proof is `.codex-auto/quality/native-coverage-gap-audit.json` with measured
coverage fields and a separate `shippingShellReady` claim.

## R0 - Continuation Contract

Objective: make this remediation program unambiguous and restartable.

Owner files:

- `AGENTS.md`
- `audit-remediation-instructions.md`
- `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`
- this plan
- `docs/AGENT_WORKFLOWS.md`
- `docs/specs/README.md`
- `tasks/README.md`
- `scripts/verify-audit-remediation-continuation.mjs`
- `package.json`

Local evidence:

- `.codex-auto/worklogs/audit-remediation/*`
- `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md`

Acceptance:

```powershell
node --check scripts/verify-audit-remediation-continuation.mjs
pnpm verify:audit-remediation:continuation
pnpm verify:ai-decision-knowledge
pnpm verify:requirements-spec-design-traceability
git diff --check
git status --short --branch
```

R0 is complete when tracked routing, ignored evidence, and the canonical handoff agree
on the same active phase and the continuation verifier passes.

## A0 - Authority and Evidence Truth

Objective: remove contradictory consent, score, signing, updater, and native-readiness
claims before relying on the quality system for prioritization.

Primary owners:

- `scripts/verify-final-goal-safe.mjs`
- `scripts/score-release-quality.mjs`
- `scripts/verify-final-goal-audit.mjs`
- `scripts/verify-full-native-rust-gap-audit.mjs`
- release signing/updater verifiers
- claim-policy docs selected by `AI_GUIDE.md`

Required work:

1. Split no-token proof from authenticated token-spending smoke with commands whose
   names and output cannot be confused.
2. Define per-execution consent packet semantics; standing repo permission does not make
   a command "no-token".
3. Bind generated evidence to commit SHA, verifier digest, input hashes, execution
   identity, and expiry.
4. Remove score/final-audit dependency cycles and deduplicate umbrella/aggregate risks.
5. Replace file-exists signing credit with Authenticode/timestamp-chain proof.
6. Rename full-native proof scoring so it cannot imply shipping-shell completeness.
7. Add enforce mode so a D/release-blocked result cannot silently satisfy release CI.

Acceptance:

- a no-token gate proves no token-spending step executed,
- token smoke cannot run without an explicit current consent packet,
- unsigned installers receive zero signed-distribution credit,
- updater readiness requires capability, reachable metadata, and lifecycle proof,
- every scored artifact has provenance/freshness metadata,
- risk counts identify unique direct defects separately from derived rows.

Forbidden:

- editing artifacts by hand,
- lowering thresholds to recover points,
- treating updater `.sig` as Authenticode,
- using the current full-native percentage as migration readiness.

## A1 - Terminal Input Authority

Objective: one daemon-owned gate for all writes and approval state.

Primary owners:

- `src-tauri/src/command_risk/*`
- `src-tauri/src/api/mod.rs`
- `src-tauri/src/api/mcp.rs`
- `src-tauri/src/ipc/send_keys_commands.rs`
- `src-tauri/src/ipc/commands.rs`
- `src-tauri/src/pty_sidecar.rs`
- `src-tauri/pty-server/*`
- terminal input hooks/components only where typed UI feedback is needed

Required work:

1. Define a typed write envelope: actor/principal, source, terminal/session, target set,
   payload mode, command hash, approval binding, and request id.
2. Gate exactly once at the daemon-owned write boundary.
3. Return ACK/NACK after daemon classification; queue acceptance is not execution success.
4. Apply waiting-approval protection to REST, WS, MCP, sidecar, broadcast, synchronized
   panes, native input, paste, and programmatic writes.
5. Separate human approval capability from bearer API possession.
6. Preserve audit fail-closed behavior without duplicating policy between faces.

Acceptance scenarios:

- sidecar `Review` command succeeds only with valid approval and returns a typed result,
- raw WS bare Enter cannot resolve an approval TUI,
- stale/replayed/cross-target approval fails,
- synchronized panes use the effective target set in one binding,
- standalone daemon and app-attached daemon behave identically,
- adversarial integration tests cover all write faces.

## A2 - Windows Trust and Evidence DAG

Objective: make release evidence reproducible and Windows trust claims real.

Primary owners:

- `.github/workflows/*`
- distribution/signing/updater scripts
- `src-tauri/capabilities/default.json`
- `src-tauri/tauri.conf.json`
- `src/features/app/UpdateBanner.tsx`
- evidence envelope utilities introduced in A0

Required work:

- Authenticode and timestamp verification for NSIS/MSI/binaries,
- updater capability wiring and explicit error states,
- reachable signed update metadata,
- install/update/relaunch/rollback test,
- immutable CI evidence, pinned actions/toolchains, SBOM and provenance,
- release score enforce mode in the release job.

Acceptance requires a real signed lifecycle on the intended release channel. Local
unsigned development artifacts remain valid for development but receive no release trust.

Scheduling note (owner decision, 2026-07-11): repo-owned A2 updater wiring, immutable
CI evidence, SBOM, provenance, and release-score enforcement are complete. Authenticode,
reachable signed metadata, and install/update/relaunch/rollback evidence are deferred to
A9 release closeout because the required operator signing identity is unavailable. A3
may proceed, while A2 remains incomplete for release acceptance and all release claims
continue to fail closed.

## A3 - UI Trust Surface

Objective: the cockpit never presents inferred or stale state as live/ready/safe.

Design input: `ui-quality-instructions.md` Q0-Q3 and
`docs/specs/UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md`.

Primary owners:

- pane lifecycle and header components
- `src-tauri/src/pty_sidecar.rs`
- `src/features/terminal/IMEInputBar.tsx`
- terminal input gateway from A1
- shortcut registry/handlers
- fleet projection and review queue modules

Required work:

- `live/reconnecting/degraded/exited` transport lifecycle,
- reconnect events visible within the specified time bound,
- multiline paste preview/confirmation through the unified input authority,
- Close Pane scope and live-process confirmation,
- one shortcut registry,
- one canonical fleet projection,
- heuristic review readiness visibly advisory until A7.

Acceptance includes rendered timing/interaction tests, not state-mapping tests alone.

Completion note (2026-07-12): A3 repo-owned work is complete. The Aelyris-owned
rendered Playwright suite blocks Windows CI. The separate roadmap dashboard fixture
is opt-in through `AELYRIS_E2E_EXTERNAL_DASHBOARD=1` and remains operator-owned;
live IME, staged sidecar kill, populated-cockpit, and final DWM/WebView2 glass checks
remain explicit external proof debt. The next implementation slice is A4.1: inventory
the durable session/DB owners, current schemas, migrations, backup/restore paths, and
startup reconciliation before changing persistence behavior.

## A4 - Session and Database Durability

Objective: acknowledged state survives restart, upgrade, disk pressure, and partial failure.

Primary owners:

- interactive session lifecycle/checkpoint modules
- sidecar startup/adoption state
- `src-tauri/src/db/*`
- settings/workflow/proofbook persistence

Required work:

- automatic checkpoint on identity/status/lineage/approval changes,
- bounded startup state machine before first terminal spawn,
- reconciliation of live PTYs and durable agent records,
- numbered transactional migrations and compatibility fixtures,
- pre-migration backup, restore, integrity/WAL checks, and global retention quota,
- atomic file replacement without deleting the last committed version first,
- explicit error or durable retry when persistence fails.

Acceptance includes restart, old-schema upgrade, disk-full/locked DB, corrupt-state,
power-loss, and multi-instance policy tests.

### A4.1 Frozen Inventory and Dependency Contract (2026-07-12)

This inventory is the required behavior-change barrier for A4. It records the current
owners and gaps; generated artifacts are not authority for these ownership decisions.

Current durable owners:

- `src-tauri/src/db/queries.rs::Database` owns SQLite open/create and exposes the
  connection to typed repositories. `src-tauri/src/db/migrations.rs` owns the complete
  schema plus WAL, foreign-key, recursive-trigger, and busy-timeout pragmas.
- `src-tauri/src/persistence/session_checkpoint_repo.rs` owns durable visible-agent
  checkpoints and handoff state. `src-tauri/src/ipc/session_lifecycle_commands.rs`
  restores live sidecar-backed checkpoints and reconciles unresolved handoffs.
- At this A4.1 inventory point, `src-tauri/src/session/manager.rs` exposed a legacy
  terminal session/window/pane restore wrapper. A6.7 later proved that wrapper had
  no production registration or runtime callsite and retired it; the existing
  Database, PTY, and mux owners remain authoritative. `src-tauri/src/mux/store.rs`
  owns versioned file snapshots for the mux graph.
- `src-tauri/src/lib.rs` is the startup composition owner. It opens the same SQLite
  file for the managed DB, Context Store, Intent Bus, Task Graph, Event Bus, merge,
  and MCP surfaces, hydrates several projections, then starts sidecar adoption.
- `src-tauri/src/config/settings.rs`, `src-tauri/src/workflow/executor.rs`, and
  `src-tauri/src/proofbook/ledger.rs` separately own settings, workflow-run, and
  proofbook-ledger files. They do not share an atomic-file/retention owner.

Current migration and recovery truth:

- schema creation is one idempotent `CREATE TABLE IF NOT EXISTS` batch; there is no
  numbered migration ledger, `user_version` compatibility contract, old-schema
  fixture chain, or downgrade/newer-schema refusal policy,
- DB open runs schema setup on every independently opened connection; there is no
  single bounded startup migration barrier, pre-migration backup, integrity check,
  WAL checkpoint policy, restore path, or global retention quota,
- primary DB initialization can fall back to an in-memory DB and continue with an
  explicit log warning, so acknowledged writes can become non-durable,
- checkpoint restore only re-adopts records whose PTY is still live; unresolved
  handoffs fail closed, but startup does not expose one typed adoption/reconciliation
  result before the first new terminal spawn,
- mux snapshots use temp-plus-rename, but settings write directly and workflow and
  proofbook replacement delete the last committed file before rename,
- existing tests cover migration idempotence, busy timeout, checkpoint/handoff
  round trips, session restore, mux snapshots, workflow restore, proofbook restore,
  session checkpoint/no-loss/idempotence verifiers, and DB lock/sleep chaos. They do
  not cover old-schema upgrade, backup restore, corrupt DB, disk-full, power-loss
  replacement, retention quota, or the multi-instance startup policy as one gate.

Frozen A4 implementation contract:

1. SQLite remains the only durable owner for relational session/control state; file
   stores remain format-specific projections and must not become competing session
   authorities.
2. A numbered transactional migration runner must execute once behind a bounded
   startup barrier. It must reject unsupported newer schemas, back up the last known
   good DB before mutation, run integrity/WAL checks, and restore or fail closed with
   a typed durability state. No in-memory fallback may acknowledge durable success.
3. Startup must publish one typed reconciliation report covering DB readiness,
   surviving sidecar PTYs, checkpoints, handoffs, and mux projections before new
   terminal spawn is admitted. Reconciliation is idempotent and duplicate adoption
   is forbidden.
4. Identity, status, lineage, and approval mutations must checkpoint transactionally;
   a failed checkpoint returns an explicit error or durable retry record rather than
   log-and-drop behavior.
5. All file-backed owners must use one crash-safe replace primitive that flushes the
   temp file, preserves the last committed version until replacement succeeds, and
   leaves recoverable backup state. One quota owner accounts for DB backups, WAL and
   file-backed durable artifacts.
6. The focused A4 verifier must mutate old/new/corrupt schemas, locked and disk-full
   writes, interrupted replacement, duplicate startup, and retention pressure. It
   must not convert unavailable real-host sleep/power proof into repo-owned PASS.

Dependency order is frozen as: `A4.2 numbered DB migration/open durability foundation`
-> `A4.3 bounded startup adoption and reconciliation` -> `A4.4 automatic checkpoint
and persistence-failure semantics` -> `A4.5 crash-safe file replacement and global
retention` -> `A4.6 restart/upgrade/fault/multi-instance acceptance closeout`.
Persistence or schema behavior must change only in this order.

A4.2 completion note (2026-07-12): SQLite now records schema version 1 through a
transactional numbered runner, rejects schemas newer than the binary, and creates a
quick-check-valid `VACUUM INTO` backup before adopting an existing version-0 DB.
Focused fixtures prove legacy data survives in the backup, version adoption is
idempotent, reopening does not create another backup, and newer schemas are not
mutated. A4.3 is the next slice; A4 as a whole remains active.

A4.3 completion note (2026-07-12): one typed startup reconciliation owner now gates
all production `PtyManager` spawns plus the sidecar-backed terminal/interactive IPC
faces. It moves terminally from pending to ready or failed, requires durable DB
readiness, runs sidecar adoption -> checkpoint restore -> handoff reconciliation in
order, exposes a typed status IPC, and fails closed after 15 seconds. Focused tests
prove pending/failed spawn denial, late-success rejection, timeout behavior, and no
PTY creation before admission. `verify:a4:durability` records the current A4.2-A4.3
contract. A4.4 is next; A4 as a whole remains active.

A4.4 completion note (2026-07-12): checkpoint schema version 2 persists approval
state. The existing `SessionCheckpointRepo` remains the sole owner and now allocates
monotonic append sequences under the shared `ManagedDb` lock for both manual and
automatic writers. `InteractiveSessionManager` checkpoints registration identity,
status, lineage, and approval mutations before publishing in-memory state; a failed
write returns an explicit error and leaves the prior state intact. Startup restore
hydrates without appending a duplicate and restores approval state. Focused migration,
repository, mutation, rollback, and A4 contract tests pass. A4.5 is next; A4 remains
active.

A4.5 completion note (2026-07-12): `durable_file` is the single crash-safe file
replacement and retention owner. It writes and flushes a same-directory temp file,
uses Windows `ReplaceFileW` (atomic rename elsewhere), preserves the prior committed
version as recovery, and cleans temp files after failure. Settings, mux snapshots,
workflow runs, proofbook ledgers, and pre-migration DB backups all route through its
global quota contract. Retention removes oldest recovery/temp evidence first, never
deletes primary state, and fails explicitly if primary data alone exceeds the quota.
Fault injection proves failure before replace leaves the committed file unchanged;
focused owner round-trip tests and `verify:a4:durability` pass. A4.6 is next; A4
remains active.

A4.6 completion note (2026-07-12): `verify:a4:durability:acceptance` executes twelve
fresh scenarios covering numbered upgrade/newer-schema refusal, restart restoration,
mutation rollback, locked DB, cross-connection sequence allocation, corrupt DB,
injected pre-replace power loss, quota exhaustion, mux/workflow/proofbook/settings
round trips, checkpoint semantics, resume idempotence, and an injected sleep gap.
All repo-owned scenarios pass and `verify:a4:durability` validates current provenance.
Real OS sleep/resume and abrupt host power-loss remain explicit A9 operator proof at
the named artifact path; they are not counted as A4 repo-owned PASS. A4 repo-owned
work is complete and A5.1 inventory is next.

### **A4.7** Complete - Authoritative Mutation Fail-Closed Correction (2026-07-16)

A fresh runtime-integrity review invalidated the old aggregate A4 completion claim:
ContextStore and TaskManager published memory before SQLite commit and converted
persistence failure into logs. Their production startup path could also attach an
in-memory fallback after durable DB failure and continue acknowledging non-durable
changes. A4.7 keeps the existing managers and repositories as the only owners but
reverses the authority boundary to `stage candidate -> commit SQLite -> publish memory`.
Context IPC/MCP now return persistence errors, TaskGraph exposes a typed persistence
error, production managers reject mutation until durability is attached, and the
fallback DB is not attached to either authoritative owner. Injected missing-table and
unattached-production tests prove failed set/remove/create/autonomy mutations leave the
prior memory graph/store and autonomy lease intact. This completes only A4.7; it does
not restore A4 phase completion or release-score credit. The former injected sleep-gap
scenario launches the external Codex long-run watchdog rather than Aelyris runtime and
is now excluded from repo-owned product acceptance instead of being counted as A4 PASS.

### **A4.8** Complete - EventBus Durable Delivery And Consumer Truth

Keep the existing EventBus/EventRepo as the only coordination-event owner. Replace the
process-local loss window with transactionally committed outbox records, durable
consumer cursor/ACK and idempotency identity. A bounded cache may evict only after
durability is proven; overflow, query failure, and corrupt rows must emit typed
gap/degraded evidence and fail no-loss/replay claims instead of returning an empty or
apparently complete stream. Acceptance must include append failure across process exit,
restart replay, consumer crash before/after ACK, duplicate delivery, corrupt row, and
buffer pressure. No `exactly-once` claim is allowed; the supported contract is durable
at-least-once delivery plus idempotent effects unless a stronger proof is implemented.

Implemented in the existing EventBus/EventRepo boundary: schema v3 upgrades legacy
rows with stable identities and adds append-only outbox/cursor invariants; production
publish commits before bounded cache/Tauri emit and returns typed failure otherwise;
MCP reliable consumers use `event.poll` then cumulative `event.ack`, with duplicate
delivery carrying the same `eventId`. Query failure, corrupt rows, and sequence gaps
are typed non-success. The same-owner durable high-water detects deleted latest rows,
future/corrupt consumer cursors and cursor/event identity mismatches fail closed, and
lifecycle producers report structured partial-success when state committed but event
publication failed. MCP preserves the tagged EventBus error in text and structured
content. The historical A4 v4 acceptance matrix passed 19/19 through A4.8 while
`phaseComplete=false`.

### **A4.9** Complete - Durable Execution Attempt And Effect Fence

Implement the already-designed WorkExecutionAttempt/AgentRun generation and
ExecutionFence inside the existing TaskGraph/agent/session owners. Bind task, agent run,
process generation, PTY/session, ownership lease, event/outbox, and merge intent before
external effect. Reserve before effect, commit or reconcile after effect, reject stale
generation writes, and never create a second DAG or journal. Acceptance injects crash
at reservation, spawn, first effect, review, merge, and finalization boundaries.

Implemented by the existing TaskManager plus its SQLite adapter and production
LoopPorts integration. Canonical UUIDv7 attempt/run/session/PTY/reservation identities
are generated and validated on reload; full execution tokens fence stale completions.
The reservation outbox and execution-scoped ownership claims commit before first
effect, and the seven ordered fences cover reservation, first effect, spawn, review,
candidate freeze, exact-OID merge, and finalization. Focused repository, TaskManager,
and LoopPorts tests pass while `phaseComplete=false`; A4.10-A4.12 remain.

### **A4.10** Complete - All-Authority Startup Reconciliation

Extend the bounded startup barrier to reconcile TaskGraph, active execution attempts,
PaneFleet/PTY generations, file and symbol ownership, worktrees/merge intents, leases,
and EventBus outbox/cursors before dispatch admission. Reconciliation must be
idempotent, classify every orphan or ambiguity, and quarantine instead of guessing.

Implemented inside the existing `StartupReconciliationState`, TaskManager, execution
repository, PaneFleet/PTY registries, ownership repository, merge-intent store, and
EventRepo owners. Seven structured authority reports now gate both terminal spawn and
headless/visible orchestrator dispatch. A fully observed generation with no in-flight
effect closes as failed and releases stale leases; any started effect, missing
cross-link, stale runtime projection, or ownership/worktree ambiguity becomes
`NeedsReconcile` and blocks its TaskGraph node without deleting collision evidence.
WorkExecutionAttempt schema v5 adds immutable `repo_path`; legacy empty identities are
quarantined rather than backfilled. Full outbox rows and every registered consumer
cursor are validated at boot. Focused startup, migration, EventRepo, TaskManager,
WorkExecutionRepo, and LoopPorts tests pass while `phaseComplete=false`; A4.12 remains.

### **A4.11** Complete - Structured Handoff Acceptance And Successor Quarantine

File-exists/liveness ACK is replaced by `aelyris.handoff-acceptance.v1`.
`session_handoffs` schema v6 binds predecessor/successor logical-session, PTY, and
checkpoint generations, the canonical persisted checkpoint digest, and
`baton_version=handoff_seq` before acceptance. State advancement and acceptance use
exact replay/CAS; v5 legacy rows remain unproven and are reconciled rather than
backfilled. Every observed post-spawn failure enters a typed retryable/terminal outcome
and cleanup state, stops the exact successor or applies a sticky synchronized-write
quarantine, and never reopens the failed row. Boot revalidates accepted checkpoint and
generation truth and reconciles failed, quarantined, and ambiguous handoffs.
Focused structured-handoff tests pass 13/13, directly affected Rust modules pass, and
the full Rust library suite passes 1292/1292. RT-1d and RT-1e source-contract gates pass.
`phaseComplete=false`; only A4.12 may restore A4 completion credit.

### **A4.12** Complete - Admission Coverage And Combined Runtime-Integrity Closeout

First close the admission gaps already found by the A4 review without creating a new
manager, journal, or A4.13:

- sidecar session creation is default-closed across the process boundary until the
  shared startup decision is ready; direct sidecar REST session/command paths prove
  pending and failed denial,
- effectful Workflow and Proofbook starts pass the same startup-admission contract or
  remain explicitly disabled/unsupported,
- any runtime surface not protected by the implemented gate is removed from the A4
  guarantee instead of being covered by prose or source-string inference.

Then run one crash/fault/restart matrix across authoritative mutation, EventBus
delivery, execution fencing, startup reconciliation, handoff acceptance, and those
admission surfaces. The verifier must prove no acknowledged state/effect is silently
lost, no stale generation can commit, and every uncertainty is blocked or explicitly
degraded. Only A4.12 may set `phaseComplete=true` and restore A4 quality credit.
After it passes, resume the already frozen A6 frontier; A7 remains
forbidden until A6 closes.

Implemented without a new manager, journal, runner, or state owner. The existing
`StartupReconciliationState` now mirrors the host decision into the long-lived PTY
sidecar through the private input-authority capability and a canonical UUID epoch.
Connecting hosts first reset the daemon mirror to Pending; only the current epoch may
publish Ready/Failed. The sidecar attaches that same state to both `ApiState` and the
lowest `PtyManager` spawn boundary; an admitted guard remains held through actual
process creation while Begin waits on the same owner lock. Direct REST and mux-backed
creation therefore deny Pending/Failed without a handler-only bypass. Tauri Workflow
starts and every Tauri/MCP Proofbook continuation adapter that may drive the run use
the same effect admission contract. Local Ready is previewed but not committed until
the remote Ready mirror succeeds. Equal public/private capabilities fail closed.

The v8 acceptance runner executes 25 scenarios, including a separate real
`aelyris-pty-server` process driven over loopback HTTP, and records one combined matrix over
authoritative mutation, EventBus delivery, execution fencing, startup reconciliation,
handoff acceptance, and admission surfaces. All six dimensions pass; acknowledged
state/effects are not silently lost, stale generations cannot commit, and uncertainty
is blocked or explicitly degraded. `phaseComplete=true`; the implementation frontier
resumes at the active A6 slice owned by the root work order. Real OS sleep/resume and abrupt host power-loss remain A9 operator
proof and are not claimed by this deterministic matrix.

The cross-process claim is narrowed to current protocol v4 host-sidecar pairs. A
live protocol-v3 daemon must be restarted; this nonblocking compatibility residual
does not create an A4 migration-service requirement.

## A5 - Execution Supervision and Concurrency

Objective: no unbounded child, global lock, or stale write can stall/corrupt the fleet.

Primary owners:

- Proofbook runner/shell steps
- PTY manager
- TaskGraph/autonomy loop/gate runner
- LSP manager
- watchdog/auto-repair

Required work:

- supervised async children with deadlines, cancellation, output caps, and cleanup,
- revisioned/CAS Proofbook ledger settlement,
- per-PTY handles instead of a map-wide blocking mutex,
- snapshot/plan -> unlocked side effects -> version-checked apply for TaskGraph,
- LSP framing caps, lifecycle cleanup, and tests,
- watchdog actions with typed outcomes and bounded timeouts.

### A5.1 Complete - Execution/Concurrency Owner Inventory and Frozen Order

Inventory at clean baseline `7fb620f` (no execution behavior changed in this slice):

| Owner | Current boundary and failure mode | Frozen remediation slice |
| --- | --- | --- |
| `proofbook/step_shell.rs`, `control/gate_runner.rs`, `watchdog/auto_repair.rs` | synchronous `Command::output`/`status`; no common deadline, cancellation, bounded capture, or typed timeout result | A5.2: one bounded command supervisor with explicit deadline/cancel/output-limit/cleanup outcome; migrate these call sites first |
| `proofbook/runner.rs`, `proofbook/ledger.rs` | cloned ledgers are settled and rewritten without a revision/CAS token, so cancel/gate/worker settlement can overwrite newer state | A5.3: revisioned ledger snapshots and compare-and-swap apply; stale settlement must return a typed conflict |
| `pty/manager.rs` | the `instances` map mutex is held across writer I/O, resize, bulk termination, and some nested child-handle acquisition | A5.4: map contains cloneable per-PTY handles only; take a short map lock, perform I/O/kill/wait through the selected handle after unlock |
| `task/manager.rs`, `orchestrator/autonomy.rs` | graph mutex is held through autonomy closures and synchronous database persistence; side-effect planning and version-checked apply are not separated | A5.5: revisioned snapshot/plan, unlocked side effects, version-checked apply and persistence; stale plans cannot mutate the live graph |
| `lsp/manager.rs` | server map lock can cover stdin writes and kill/wait; reader accepts unbounded header/body lengths and detached reader threads have no lifecycle handle | A5.6: framing/header/body caps, per-server handle, bounded stop, reader ownership and deterministic cleanup |
| `watchdog/auto_repair.rs` | concurrency count is bounded, but worker threads and subprocess stages have no cancellation/deadline/output caps and spawn failure is silently discarded | A5.7: supervised repair job lifecycle with typed rejection/failure/timeout/cancel outcomes and ordered cleanup |

Cross-cutting inventory findings:

- `process.rs` already supplies hidden-window creation and Windows kill-on-close Job
  Object assignment, but it is not a command execution supervisor and assignment is
  best-effort. A5.2 owns the reusable deadline/cancel/capture contract; call sites keep
  their domain-specific policy and result mapping.
- `proofbook/step_wait.rs` uses a bounded synchronous sleep loop. It is not migrated
  before A5.2, but A5 acceptance must prove it cannot monopolize an async runtime lane.
- PTY process lifetime has an existing Job Object and reaper path. A5.4 changes lock
  ownership only; it must preserve spawn-token generation checks and live-process
  preservation contracts.
- No A5 slice may hold a global/map/graph mutex while waiting for process exit, pipe
  output, filesystem/database work, or external side effects.

Frozen dependency order: `A5.2 command supervisor -> A5.3 Proofbook CAS -> A5.4 PTY
handles -> A5.5 TaskGraph snapshot/apply -> A5.6 LSP bounds/lifecycle -> A5.7 watchdog
job lifecycle -> A5.8 combined timeout/cancel/flood/concurrent-pane acceptance`.

A5.2 contract is intentionally narrow: define the shared supervised-command types and
move Proofbook shell/verifier, objective gate, and watchdog subprocess execution onto
them. It must prove a hung child times out and is cleaned up, cancellation is distinct
from timeout, stdout/stderr are capped without deadlock, normal exit preserves code and
captured tails, and Windows descendants remain under the existing no-orphan boundary.
It must not change Proofbook ledger settlement, PTY map ownership, TaskGraph semantics,
or LSP framing.

### A5.2 Complete - Bounded Command Supervision

The shared supervisor in `src-tauri/src/process.rs` now owns non-interactive child
deadline, cancellation classification, concurrent stdout/stderr draining, bounded tail
capture, exit-code preservation, and timeout/cancel process-tree cleanup. Proofbook
shell/verifier, objective gate, and watchdog agent/git/test commands use this contract.

Acceptance evidence:

- `pnpm verify:a5:command-supervision`
- `.codex-auto/quality/a5-command-supervision.json`
- supervisor timeout/cancel/flood/normal-exit tests: 4/4 PASS
- Proofbook timeout mapping/output-cap tests: 2/2 PASS
- Proofbook runner regression: 14/14 PASS
- objective gate regression: 5/5 PASS
- watchdog regression: 20/20 PASS

The artifact intentionally reports `phaseComplete=false`: A5.3-A5.8 remain. The next
slice is A5.3 revisioned/CAS Proofbook settlement; cancellation tokens becoming
run-owned rather than caller-supplied remains part of that ledger/run ownership slice.

### A5.3 Complete - Revisioned Proofbook CAS Settlement

`ProofbookRunLedger.revision` is now a backward-compatible monotonic generation
(`serde(default)` adopts legacy v1 ledgers at revision zero). `ProofbookRunner` owns a
short global run-map lookup plus a per-run mutex. Every production mutation after
initialization compares both the in-memory slot and current durable revision before
atomic replacement; stale memory or externally-newer durable state returns typed
`StaleLedgerRevision` without overwriting the winner.

Deterministic run initialization is idempotent and adopts an existing ledger rather
than resetting it. Concurrent settlements from the same generation have exactly one
winner. Unrelated run IDs use distinct slots, so the run map is not held across ledger
file validation or durable replacement.

Acceptance evidence:

- `pnpm verify:a5:proofbook-cas`
- `.codex-auto/quality/a5-proofbook-cas.json`
- Proofbook runner matrix: 18/18 PASS
- stale memory snapshot cannot overwrite winner
- newer durable revision cannot be overwritten
- concurrent same-revision settlements produce exactly one CAS winner
- deterministic re-start preserves revision/events
- legacy v1 ledger without `revision` adopts revision zero

The artifact reports `phaseComplete=false`; A5.4-A5.8 remain. A5.4 owns only PTY map
lock/per-instance handle boundaries and must preserve spawn-token and live-process
identity contracts.

### A5.4 Complete - Per-PTY Handles and Short Map Locks

`PtyManager` now stores `Initializing` reservations or ready
`Arc<Mutex<PtyInstance>>` handles. Caller-provided IDs are reserved atomically, while
ConPTY creation, child spawn, reader construction, writes, flushes, resize, capture,
kill, and wait-related handle transfer happen after the session-map lock is released.
Failed/cancelled initialization removes its reservation; publication fails closed if a
concurrent close cancelled the reservation.

Close-all drains ready handles before termination. Generation-safe reaping snapshots a
handle/token, then uses `Arc::ptr_eq` under a short second map lock so an old waiter
cannot remove a replacement PTY that reused the same ID. List operations first clone
ready handles and only then inspect per-instance metadata.

Acceptance evidence:

- `pnpm verify:a5:pty-concurrency`
- `.codex-auto/quality/a5-pty-concurrency.json`
- same-ID concurrent spawn has exactly one published child
- stale reaper cannot remove a reused terminal ID
- locking one instance does not block another terminal lookup
- ConPTY child remains assigned to the kill-on-close Job Object

The artifact reports `phaseComplete=false`; A5.5-A5.8 remain. A5.5 owns TaskGraph
revisioned snapshot/plan/unlocked-side-effect/version-checked apply behavior.

### A5.5 Complete - TaskGraph Snapshot/Plan/Versioned Apply

`TaskManager` now owns a revisioned `TaskGraphState`. An autonomy pass takes a short
lease and graph clone, releases the state mutex, runs dispatcher/gate/merge side
effects against the clone, and installs it only when the lease and expected revision
still match. The old `with_graph_mut` live-graph escape hatch is removed.

Readers remain available during side effects. Concurrent writers fail immediately
with typed `MutationInProgress` instead of blocking behind an external command. The
final apply has a separate typed `StaleRevision` guard, clears its lease on stale state
or panic, and never publishes a partial clone. Public Tauri/MCP callers propagate
mutation conflicts as errors.

Full-graph SQLite persistence is also moved outside the graph mutex. A serialized
writer snapshots the current graph/revision, writes it, and repeats if memory advanced
during the write, coalescing concurrent mutations until durable state catches up.

Acceptance evidence:

- `pnpm verify:a5:taskgraph-concurrency`
- `.codex-auto/quality/a5-taskgraph-concurrency.json`
- TaskManager revision/lease/persistence matrix: 17/17 PASS
- loop adapter regression matrix: 27/27 PASS
- reads stay live and writers fail fast during a side-effect lease
- injected revision drift is rejected and the lease is cleared
- restart persistence of autonomy counters remains PASS

The artifact reports `phaseComplete=false`; A5.6-A5.8 remain. A5.6 owns LSP framing
caps, per-server lifecycle handles, bounded shutdown, and reader cleanup.

### A5.6 Complete - LSP Framing and Lifecycle Bounds

`LspManager` clones now share one `LspManagerInner`; dropping a temporary clone no
longer stops every server. The server map contains only initialization reservations or
per-server `Arc<LspProcess>` handles and is released before stdin I/O, child waits, or
reader joins.

Inbound framing enforces bounded header lines, aggregate header bytes, header count,
and body length before allocation. Missing/duplicate/invalid `Content-Length`, invalid
UTF-8, partial bodies, and oversized frames fail closed. Outbound bodies use the same
body ceiling.

Each reader has an owned join handle and completion signal. Stop drains the map first,
terminates the process tree, bounds child exit and reader completion, then joins.
Unexpected reader EOF/error retires the server from the map and reaps or terminates the
child. Initialization/publish failures also clean up the spawned process.

Acceptance evidence:

- `pnpm verify:a5:lsp-lifecycle`
- `.codex-auto/quality/a5-lsp-lifecycle.json`
- LSP framing/lifecycle matrix: 6/6 PASS
- oversized header/body rejected before unbounded allocation
- duplicate/missing length rejected
- temporary manager clone drop preserves shared state
- real child/reader stop completes within bounded timeout

The artifact reports `phaseComplete=false`; A5.7-A5.8 remain. A5.7 owns watchdog job
cancellation, typed terminal outcomes, worker handles, and cleanup ordering.

### A5.7 Complete - Watchdog Supervised Job Lifecycle

Each repair job now owns a cancellation token and worker handle. All agent, Git,
test, worktree-create, and cleanup subprocesses are supervised with deadlines and
output caps. Cancellation is exposed through typed IPC, while spawn failure,
nonzero exit, timeout, and cancellation settle as distinct terminal outcomes.
Manager shutdown requests cancellation and performs a bounded join pass; completed
jobs are not pruned while their worker remains owned.

Acceptance evidence:

- `pnpm verify:a5:watchdog-lifecycle`
- `.codex-auto/quality/a5-watchdog-lifecycle.json`
- watchdog lifecycle matrix: 24/24 PASS
- cancellation and timeout preserve typed terminal outcomes
- worker spawn failure cannot strand an active job
- failed/cancelled worktrees use bounded ordered cleanup

The artifact reports `phaseComplete=false`; A5.8 owns combined fresh acceptance for
the command, Proofbook, PTY, TaskGraph, LSP, and watchdog slices.

### A5.8 Complete - Combined Supervision and Concurrency Acceptance

`pnpm verify:a5:supervision-concurrency` reruns every A5.2-A5.7 verifier and rejects
missing, failing, or incorrectly phase-complete child evidence. The aggregate is the
only A5 artifact with `phaseComplete=true`; all six dependency slices remain narrowly
classified with `phaseComplete=false`.

Acceptance evidence:

- `pnpm verify:a5:supervision-concurrency`
- `.codex-auto/quality/a5-supervision-concurrency.json`
- command supervisor, Proofbook CAS, PTY, TaskGraph, LSP, and watchdog: 6/6 PASS
- aggregate `sliceComplete=true`, `phaseComplete=true`

A5 repo-owned supervision/concurrency work is complete. A6 starts with an ownership
hotspot and ratchet inventory; it must not move code or lower baselines before that
contract is frozen.

## A6 - Modularity Ratchet

Objective: make ownership, dependency direction, state transitions, and concurrency
boundaries explicit, then prevent unjustified regrowth.

Primary targets:

- `src/App.tsx`
- `src/features/right-rail/rightRailModel.tsx`
- `src-tauri/src/api/mcp.rs`
- `src-tauri/src/ipc/commands.rs`
- `src-tauri/src/db/queries.rs`
- `src-tauri/src/bin/aelyris_native.rs`

Required work:

- split by state/contract owner, not line count alone,
- narrow Zustand selectors and stabilize subscriptions,
- typed IPC facade and event registry,
- classify every unreferenced IPC handler before deletion,
- retain file-size baselines as diagnostic non-growth ratchets while accepting work
  on owner and behavior evidence rather than an arbitrary universal line target,
- remove dead duplicate managers and unowned infrastructure.

### A6.1 Complete - Ownership Hotspot and Ratchet Inventory

The authoritative right-rail model path is
`src/features/right-rail/rightRailModel.tsx`; the older `src/shared/lib` path is stale.
`pnpm verify:a6:modularity-inventory` freezes current line-count ceilings for all six
owners and fails on growth. These ceilings are debt baselines, not desired targets;
each implementation slice must explain its owner delta and may lower the baseline
after a supported extraction. A line delta alone cannot complete or fail a slice
whose dependency and behavior contract is correct.

Frozen owner order:

1. A6.2: `App.tsx` and right-rail projection/selectors.
2. A6.3: Tauri IPC adapter, typed facade, event registry, and handler classification.
3. A6.4: MCP catalog/schema/governance/domain dispatch.
4. A6.5: SQLite domain repositories behind the single Database/migration owner.
5. A6.6: native proof CLI router and proof-domain modules.
6. A6.7: callsite-proven duplicate/unowned infrastructure removal.
7. A6.8: combined ratchet and regression acceptance; retire advisory mode.

No unregistered IPC handler is deletion-authorized by inventory alone. A6.3 must prove
registration, frontend invoke, MCP/HTTP reuse, tests, and compatibility aliases before
classifying a handler dead.

Acceptance evidence:

- `pnpm verify:a6:modularity-inventory`
- `.codex-auto/quality/a6-modularity-inventory.json`
- six owner baselines surface unjustified growth
- dependency-first A6.2-A6.8 contract is frozen
- artifact reports `sliceComplete=true`, `phaseComplete=false`

### A6.2a Complete - Frontend Registry and Bootstrap Schema Owners

The lazy-loaded secondary UI registry now has one owner in
`src/features/app/lazyPanels.tsx`; `App.tsx` only composes those components. The app
bootstrap configuration schema now lives in `bootstrapAppConfig.ts` and is re-exported
through the existing right-rail surface for compatibility.

The enforced ceilings were lowered in the same slice:

- `src/App.tsx`: 5213 -> 5173 lines
- `src/features/right-rail/rightRailModel.tsx`: 2072 -> 2037 lines

Acceptance evidence:

- `pnpm verify:a6:frontend-ratchet`
- `.codex-auto/quality/a6-frontend-ratchet.json`
- `pnpm build` PASS
- TypeScript no-emit PASS

The artifact reports `phaseComplete=false`; A6.2b continues with right-rail
persistence/projection ownership and must lower both ceilings again.

### A6.2b Complete - Shared Types and Bootstrap Effect Owners

Shared right-rail contracts now live in `rightRailTypes.ts`; the runtime model re-exports
them without owning their declarations. Startup configuration mutation now lives in
`useBootstrapAppConfig.ts`, leaving `App.tsx` as the hook consumer. Source-contract tests
follow these authoritative owners and pass 33/33.

Ratchets lowered again: `App.tsx` 5173 -> 5111 and `rightRailModel.tsx` 2037 -> 1917.
The A6 frontend artifact remains `phaseComplete=false`; A6.2c owns persistence and
projection extraction.

### A6.2c-A6.2d Landed Progress - Acceptance Reopened by Review

The dependency-first extraction series after A6.2b landed focused owners for
right-rail feedback, validation, audit, visual-QA, and widget composition, followed
by app-shell owners for editor mode, pane registry/request/spawn/selection, release
evidence, authenticated prompt evidence, AI CLI launch evidence, and project/tab
lifecycle. The current enforced ceilings are:

- `src/App.tsx`: 4215 lines
- `src/features/right-rail/rightRailModel.tsx`: 688 lines

Fresh `pnpm verify:a6:frontend-ratchet` and
`pnpm verify:a6:modularity-inventory` evidence passes those ceilings and TypeScript,
but both artifacts correctly remain `phaseComplete=false`. This landed progress is
not A6.2 acceptance: the 2026-07-13 cross-cutting review found that the current gate
mostly proves file size and source markers, not dependency direction, subscription
stability, or stateful behavior.

### A6.2 Review Checkpoint - Corrected Frontend Contract

Confirmed findings:

1. The tracked plan and root work order stopped at A6.2b/A6.2c while implementation
   had advanced through A6.2d, so continuation truth did not identify the exact
   current sub-slice.
2. `verify-a6-frontend-ratchet.mjs` constrains only `App.tsx` and
   `rightRailModel.tsx` line counts plus source markers. Moving behavior into an
   unconstrained owner can therefore pass without reducing ownership risk.
3. `App.tsx` still calls `useAppStore()` without a selector, subscribing the shell
   to the whole Zustand store despite the A6 narrow-selector requirement.
4. App evidence hooks import generic path/JSON utilities from
   `rightRailModel.tsx`; bootstrap schema also imports its contract types through
   that runtime model. These are reversed or barrel-mediated dependencies.
5. Most newly extracted stateful hooks are covered by source-string assertions,
   not executed transition, cancellation, failure, cleanup, or timer behavior.
6. The former blanket `<=800` target encourages hook motion and replacement
   hotspots without proving a better boundary. `useAppMenus.ts` is already about
   988 physical lines; its risk must be decided by command ownership, dependency
   direction, executed behavior, and change coupling rather than line count alone.
7. Closing the active project tab is not governed by the same unsaved-editor
   transition contract as project open/close and tab switch. Cancellation and
   editor/session preservation must be proved before that transition is accepted.
8. Close Folder clears `rootProjectPath`, but the effective `projectPath` still
   falls back to the active tab cwd. The Welcome surface can therefore appear while
   project-scoped polling and derived effects remain attached to the old project.
9. Pane request state is a single replaceable slot per request kind. Concurrent
   restart/attach requests can orphan completion promises, other loss-intolerant
   operations can be coalesced, and unmount has no bounded settlement policy.
10. Evidence polling has no generation ordering; overlapping polls can let an older
    read overwrite newer state, and release evidence currently commits three files
    independently instead of as one coherent snapshot.
11. The right-rail runtime model still wildcard-re-exports several owners and App
    consumes a broad symbol set through that barrel, so physical extraction has not
    yet established a narrow public dependency boundary.
12. `AppSilentBugs.test.ts` is about 2764 lines and increasingly owns raw-source
    assertions for unrelated domains. It is a test hotspot, not a substitute for
    executed owner tests.
13. The frontend artifact still labels successful current evidence as
    `pass-a6.2a-frontend-owner-extraction`; it does not identify the completed slice
    or the reviewed contract version.
14. The A6 frontend and modularity verifiers are not directly required by a blocking
    CI job, and no aggregate can yet emit truthful A6.2 `phaseComplete=true`.
15. The continuation verifier proves that some worklog exists and that dirty paths
    appear in the handoff, but does not enforce the protocol's exact command/result,
    artifact, commit, blocker split, Git truth, and next-action fields.

The review freezes this corrected dependency-first order. Each numbered slice is a
focused commit and records the touched owner baseline without treating a forced line
decrease as the Goal:

### **A6.2v1** Complete - Verifiable Agent Work OS Architecture Review

The owner-requested 2026-07-13 product review compared the current repository and
official primary sources for Hermes Agent, BridgeSpace, Scape, OpenHands, Claude
Code, Codex, Warp, tmux, WezTerm, Ghostty, ACP, MCP, and A2A. Three independent
reviews converged on one correction: pane grids, worktrees, agent status, and shared
memory are necessary substrate, not a sufficient product category. Aelyris must
close its existing terminal, TaskGraph, Qralis, ownership, Proofbook, governance,
review, merge, and Remote Continuity spines under one backend-owned Mission,
capability, causal-event, and evidence model.

Design authorities frozen by this checkpoint:

- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md` owns the product requirements and
  anti-features;
- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md` owns schemas, states,
  bounded contexts, failure behavior, A7 Core design, and Apex gates;
- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md` owns permanent
  Now/Next/Unlocks reporting, capability unlocks, and Core-versus-Apex sequencing;
- `pnpm verify:verifiable-agent-work-os-spec` proves the documentation contract
  only and emits `.codex-auto/quality/verifiable-agent-work-os-spec.json`.

This is a design-only checkpoint. It does not implement Mission persistence,
WorkEvent migration, capability leases, completion packets, replay, learning,
remote control, or extensions; it does not change current alpha/not-release-ready
claim policy. A6.2f remains the next implementation slice. New product runtime
work must not start until A6.2g and then A6.8 satisfy their dependency gates.

#### A6.2e - Architecture and Behavioral Contract Repair

1. **A6.2e0 exact continuation and worklog contract hardening**: add an explicit
   `ACTIVE SLICE` field and require strict equality of the exact slice across the
   work order, its tracked-plan anchor, local handoff, current worklog, artifact,
   and pasteable continuation goal. Enforce the protocol's command/result, artifact,
   commit, blocker split, Git truth, and next-action fields for the current worklog;
   coarse normalized substring presence is insufficient.
2. **A6.2e1 Complete - neutral evidence utilities and dependency-boundary ratchet**:
   generic project-artifact path/JSON parsing now lives in the neutral
   `src/shared/lib/projectArtifacts.ts` owner. Bootstrap and cross-feature consumers
   import their declaration owners directly; focused utility tests and a mutation-
   proven frontend ratchet reject generic/app imports from the right-rail runtime
   barrel. Diagnostic non-growth ceilings cover every touched extracted owner,
   including `useAppMenus.ts`; `rightRailModel.tsx` is 670 lines against its
   688-line ceiling. This closes A6.2e1 only; `phaseComplete` remains false.

   Original contract: move
   generic project artifact path/JSON parsing to a neutral owner, import bootstrap
   types from their declaration owner, remove app-to-right-rail-model dependencies
   that exist only for generic contracts, add executed utility tests, and make the
   frontend ratchet fail on the forbidden dependency direction. Register diagnostic
   non-growth ceilings for touched extracted owners, including `useAppMenus.ts`;
   code motion may not create a broader or less cohesive replacement owner.
   Generic/app owners may not import the right-rail runtime barrel; right-rail
   consumers use direct declaration owners or a deliberately typed facade instead
   of wildcard re-export coupling.
3. **A6.2e2 Complete - narrow store subscription**: App now subscribes to its 50
   shell-owned fields through `useAppShellStore` and Zustand's shallow selector
   contract instead of a selector-less whole-store subscription. The focused render
   test proves that an unrelated `selectedModel` mutation does not rerender the hook
   owner while a selected mutation does. The frontend ratchet executes that exact
   assertion through structured Vitest JSON, rejects skipped/non-passing evidence,
   and rejects selector-less App calls through direct or aliased `useAppStore`
   imports. No second store owner, dependency, service, or broader facade was added;
   `phaseComplete` remains false.
4. **A6.2e3 Complete - project/tab transition behavior**: open, switch, close-folder,
   inactive-tab close, and active-tab close now route through
   `useProjectTabLifecycle` and have executed behavior proof. An unsaved cancel
   preserves the active tab, interactive session, editor files, and pane snapshots;
   a confirmed active-tab context change clears editor and interactive state only
   after the tab transition succeeds. Close Folder detaches the effective project
   path so project-scoped polling/effects cannot continue behind the Welcome surface,
   and Ctrl+Tab/Ctrl+Shift+Tab route through the same lifecycle contract rather than
   mutating the active tab directly. The frontend ratchet executes the lifecycle and
   shortcut assertions through structured Vitest JSON and keeps
   `phaseComplete=false`.
5. **A6.2e4 Complete - stateful-owner behavior**: each evidence poll now owns one
   generation; release evidence commits its three-file result atomically, and all
   evidence owners suppress overlap, ignore stale generations, and prevent later
   adoption after project change or unmount. Loss-intolerant pane requests execute
   FIFO per operation kind, while focus uses typed latest-wins settlement and resolves
   success only after the PaneTree consumer acknowledges it. A dispatched request
   that times out settles its caller but quarantines its non-cancellable backend lane
   until the real completion arrives, so later accepted requests cannot overlap the
   unresolved mutation and instead settle through typed timeout if necessary.
   Delayed agent-spawn events retain their initiating tab owner, and operational pane
   selection rejects callbacks from an obsolete project owner. Executed concurrent-
   request, timer, out-of-order completion, project-change, stale-result, partial-
   evidence, routing, completion, and cleanup tests cover the evidence, pane request,
   spawn, registry, and selection owners. The frontend artifact now records
   `completedSlice=A6.2e4`,
   `contractVersion=a6.2e4-stateful-owner-behavior/v1`, and
   `phaseComplete=false`.

#### **A6.2f Active - Component and Command Composition**

1. Split `useAppMenus.ts` only along proven typed command/menu ownership boundaries;
   keep one narrow public composition hook and verify that behavior and dependency
   direction improve. Do not split solely to cross a line-count threshold.
2. Extract the right-rail render surface into typed view-model/action contracts,
   preserving the single runtime owners and avoiding a giant undifferentiated prop
   bag or duplicate derived state. Separate pure projection contracts from component
   contracts and replace wildcard runtime-barrel exposure with direct owners or an
   explicit narrow facade.
3. Extract workspace/editor/chrome composition and the dialog/overlay host only
   along cohesive render boundaries. Every new owner receives a diagnostic
   non-growth baseline and focused rendered-behavior proof.
4. Make `App.tsx` a composition shell by responsibility: it may compose owners and
   route typed intents, but may not own cross-domain business state or rederive
   backend truth. Each extraction must reduce a named ownership or behavior risk;
   reaching a numeric target by hiding logic in unratcheted files is a failure.
5. Split `AppSilentBugs.test.ts` by authoritative owner as those owners are touched.
   Source-contract checks may remain as wiring guards, but executed behavioral tests
   live with and decide the owner contract. No blanket file-length target is an
   acceptance criterion.

Terminal command-owner checkpoint complete:

- `useAppMenus` remains the single public composition hook while
  `useTerminalMenuCommands` owns terminal command/menu definitions, pane/tab selection,
  broadcast confirmation, and IME actions through one typed input contract.
- Focused executed tests preserve command and Terminal menu order, pane-switch routing,
  failed-focus reporting, and the post-confirm broadcast target recheck. The frontend
  ratchet also fixes diagnostic ceilings at 433 and 639 lines respectively.
- The combined production surface is 1,072 lines versus the former 994-line owner.
  The 78-line increase is accepted as explicit typed-boundary/import/return-contract
  overhead; it adds no dependency, store, service, scheduler, queue, or duplicate
  runtime state owner.
- This is an A6.2f checkpoint, not slice acceptance. The artifact retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.

Right-rail shell checkpoint complete:

- `RightRailShell` now owns visibility, geometry, mode tabs, pointer/keyboard
  resizing, and roving-tab keyboard behavior through a four-field view model and
  two-action contract. App retains width, mode, visibility, and badge state; the
  shell derives no duplicate runtime truth.
- The former `rightRailModel.tsx` wildcard exports are closed. App and affected
  hooks import audit, feedback, visual-QA, widget-frame, and type contracts from
  their declaration owners.
- Focused executed tests prove content/badge projection, click and keyboard mode
  routing, pointer and keyboard resize semantics, drag-owner cleanup, and hidden
  projection. Diagnostic ceilings are 4155 lines for App, 666 for the runtime
  model, 107 for the shell, and 14 for its pure contract.
- This remains an A6.2f checkpoint, not slice acceptance. The artifact retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is to inventory the remaining
  inline right-rail body and extract only the first cohesive mode-owned
  sub-surface; moving its approximately 90 App-local dependencies behind a giant
  prop contract is forbidden.

Review-mode body checkpoint complete:

- `RightRailReviewMode` owns the review queue, inspector slot, SCM, and compact
  context composition. Its pure contract carries eight cohesive projection fields
  and five actions; two render slots preserve the existing AgentInspector and
  destination-prompt runtime owners instead of cloning their state.
- The component remains lazy through the existing `lazyPanels` registry, and the
  obsolete direct ReviewQueuePanel registry entry was removed. Executed tests prove
  view projection plus review, SCM, command-evidence, reviewer-start, file-open, and
  diff intent routing.
- Diagnostic ceilings are 4118 lines for App, 87 for the review-mode component,
  and 33 for its pure contract. No dependency, store, service, queue, scheduler, or
  runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v3`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is the inline command-mode body;
  command and observe may not be hidden behind one undifferentiated contract.

Command-mode body checkpoint complete:

- `RightRailCommandMode` owns toolkit, Decision Inbox, agents, orchestrator,
  workflow, and command-context composition. Its grouped projection separates
  project, context, toolkit, decision, agent, and focus state; seven actions carry
  existing terminal, decision, session, workflow, agent-start, and outcome
  intents. Three render slots preserve AgentInspector and destination-prompt
  runtime ownership.
- The component remains lazy through the existing `lazyPanels` registry. Obsolete
  direct command-panel registry entries were removed. Executed tests prove view
  projection plus toolkit command, decision select/open/resolve, workflow agent
  start, and workflow outcome routing.
- Diagnostic ceilings are 4048 lines for App, 159 for the command-mode component,
  and 48 for its pure contract. No dependency, store, service, queue, scheduler,
  or duplicate runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v4`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is the inline observe-mode body;
  it may not be combined with the completed command or review owners.

Observe-mode body checkpoint complete:

- `RightRailObserveMode` owns process manager, live panes, audit timeline,
  compact context, run graph, tool ledger, inspector placement, reliability,
  and conditional diagnostics composition. Its grouped projection carries
  session, pane, audit, project, graph, focus, confirmation, and diagnostics
  state; twelve actions route existing pane/process, audit, session,
  reliability, and destination intents. Five render slots preserve the existing
  inspector and destination-prompt runtime owners.
- The component remains lazy through the existing `lazyPanels` registry.
  Obsolete direct observe-panel registry entries were removed. Executed tests
  prove projection plus process focus/close/restart/attach/end, pane
  focus/attach/select, audit select/trace/outcome, session select, and
  reliability select/trace routing.
- Diagnostic ceilings are 3929 lines for App, 205 for the observe-mode
  component, and 64 for its pure contract. No dependency, store, service, queue,
  scheduler, or duplicate runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v5`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is workspace/editor/chrome
  composition; completed right-rail owners may not be reopened without a fresh
  regression.

Workspace editor-area checkpoint complete:

- `WorkspaceEditorArea` owns the file-tab strip and lazy `EditorPanel`
  composition. Its five-field projection carries the active file, open files,
  project, initial line, and diff mode; three actions route selection, close, and
  editor-started agent intents without moving tab or editor runtime state.
- The prior editor-tab and loading styles moved unchanged into the owner-local
  CSS module. `WorkspaceEditorArea` owns the single nested `EditorPanel` lazy
  boundary, preserving immediate tab chrome and deferred editor loading.
  Executed tests prove active/open-file projection, keyboard and pointer tab
  selection, close isolation, active editor close, and agent intent routing.
- Diagnostic ceilings are 3889 lines for App, 66 for the component, 14 for its
  pure contract, and 97 for its owner-local styles. No dependency, store,
  service, queue, scheduler, or duplicate runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v6`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is the remaining workspace
  chrome composition; dialog/overlay ownership remains later in A6.2f.

Product mode-rail checkpoint complete:

- `ProductModeRail` now owns visible mode-rail projection and Alt+number shortcut
  capture. Its two-field projection carries active mode and hidden state; its one
  action carries mode-selection intent back to App, which retains route and state
  mutation ownership.
- The owner remains mounted while Zen mode hides the visual rail, preserving the
  prior global shortcut behavior. Executed tests prove active-mode projection,
  pointer intent routing, visible shortcut focus, and hidden-rail shortcut routing.
- Diagnostic ceilings are 3848 lines for App, 66 for the component, and 11 for its
  pure contract. No dependency, store, service, queue, scheduler, or duplicate
  runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v7`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. `ProjectHeaderBar`, `WorkspaceTabs`, and `StatusBar`
  already own their render surfaces, so the next exact boundary is the remaining
  inline left-sidebar composition; wrapper-only extraction of those existing
  owners is not progress. Dialog/overlay ownership remains later in A6.2f.

Workspace sidebar checkpoint complete:

- `WorkspaceSidebar` now owns the project-sidebar shell, Files/Tasks/Source
  Control section hierarchy, optional Search placement, and resize gesture
  lifecycle. Its two-field projection carries the pre-existing collapsed/Zen
  visibility decision and width; its one action carries width-change intent
  back to App.
- Four named content slots preserve the existing FileTree, Kanban, SCM, Search,
  project, tab, and navigation runtime owners. Executed tests prove
  section/content projection, collapsed/Zen visibility, keyboard resizing,
  pointer resizing, and drag cleanup.
- Diagnostic ceilings are 3788 lines for App, 95 for the component, and 9 for
  its pure contract. No dependency, store, service, queue, scheduler, or
  duplicate runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v8`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is the inline dialog/overlay
  host after its visibility and intent contracts are inventoried; completed
  owners may not be reopened without a fresh regression.

App dialog-host checkpoint complete:

- `AppDialogHost` now owns visible-only `LazyDialog` placement for ten typed
  dialog entries plus the persistent Prompt, Confirm, Handoff, Orchestra,
  History, Onboarding, and Fleet surfaces.
- Its one-field projection carries the current project history scope and its
  one action carries history acceptance back to App. Individual dialog content
  retains existing close, project, pane, agent, and navigation runtime owners.
  Executed tests prove visible-only projection, close/intent preservation,
  persistent surface placement, and history routing.
- Diagnostic ceilings are 3769 lines for App, 51 for the component, and 10 for
  its pure contract. No dependency, store, service, queue, scheduler, or
  duplicate runtime state owner was added.
- This is still an A6.2f checkpoint, not slice acceptance. The artifact uses
  `a6.2f-component-command-composition/v9`, retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`. The next exact boundary is the remaining owner-local
  `AppSilentBugs.test.ts` split after its source-contract assertions are
  inventoried; completed owners may not be reopened without a fresh regression.

Release-goal-evidence test-owner checkpoint complete:

- The pre-move inventory classified all 42 remaining `AppSilentBugs.test.ts`
  test blocks by their declaration owner: 12 App/extracted-owner wiring blocks,
  15 release/operator/scenario evidence blocks, 13 right-rail/terminal
  composition blocks, and 2 visual-QA bootstrap/truth blocks.
- Exactly one cohesive owner-local slice moved in this checkpoint. All 16
  assertions that inspect `useReleaseGoalEvidence.ts` now live beside its
  generation, overlap, project-change, and unmount behavior tests.
  `AppSilentBugs.test.ts` retains the single
  `useReleaseGoalEvidence(projectPath)` composition guard because App owns that
  wiring.
- The frontend ratchet requires the exact owner-local source-contract test to
  execute and pass in addition to the existing behavior proof. Its contract is
  `a6.2f-component-command-composition/v10`; it retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, dependency, store, service, queue, scheduler, durable
  owner, or runtime state owner changed. The next exact boundary remains one
  cohesive owner-local assertion slice from the inventoried central test; this
  checkpoint does not authorize A6.2g.

Authenticated-prompt-evidence test-owner checkpoint complete:

- The plausible next owners were compared before selection.
  `useAuthenticatedPromptEvidence` and `useAiCliLaunchEvidence` each had a
  closed declaration owner, four assertions in its dedicated central block,
  additional assertions in the final-goal block, and an existing executed
  behavior suite. `usePaneRegistry` had a closed owner but only one behavior
  test; `useProjectTabLifecycle` mixed App and keyboard-shortcut wiring; and
  `useEditorOpenMode` had no dedicated owner-local test surface.
- Exactly one declaration owner moved. All 8 assertions that inspect
  `useAuthenticatedPromptEvidence.ts` now live beside its overlap,
  project-change, and unmount behavior proof. `AppSilentBugs.test.ts` retains
  only `useAuthenticatedPromptEvidence(projectPath)` because App owns that
  composition wiring.
- The frontend ratchet requires the exact owner-local source-contract test to
  execute and pass through structured Vitest assertion status handling. Its
  contract is `a6.2f-component-command-composition/v11`; it retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

AI-CLI-launch-evidence test-owner checkpoint complete:

- The remaining single-owner candidates were compared before selection.
  `useAiCliLaunchEvidence` retained the strongest next boundary because it had
  one closed declaration owner, an existing executed behavior suite, four
  assertions in its dedicated central block, and five more source assertions
  in the final-goal block. `usePaneRegistry` had a closed owner but only one
  behavior test; `useProjectTabLifecycle` mixed App and keyboard-shortcut
  wiring; and `useEditorOpenMode` had no dedicated owner-local test surface.
- Exactly one declaration owner moved. All 9 assertions that inspect
  `useAiCliLaunchEvidence.ts` now live beside its overlap, project-change,
  unmount, partial-preflight, failure, and telemetry contracts.
  `AppSilentBugs.test.ts` retains only
  `useAiCliLaunchEvidence(projectPath)` because App owns that composition
  wiring.
- The frontend ratchet requires the exact owner-local source-contract test to
  execute and pass through structured Vitest assertion status handling. Its
  contract is `a6.2f-component-command-composition/v12`; it retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

Pane-agent-spawn test-owner checkpoint complete:

- The next candidate comparison selected `usePaneAgentSpawns` over the
  one-test pane-registry boundary, the already-large pane-request concurrency
  suite, and the broader operational-selection boundary. It has one closed
  declaration owner and existing behavior proof for explicit tab/repo routing,
  delayed events, listener cleanup, deduplication, and multi-tab retention.
- Exactly one declaration owner moved. All 6 assertions that inspect
  `usePaneAgentSpawns.ts` now live in its existing owner-local suite.
  `AppSilentBugs.test.ts` retains only
  `usePaneAgentSpawns(paneAgentSpawnOwners)` because App owns that composition
  wiring.
- The frontend ratchet requires the exact owner-local source-contract test to
  execute and pass through structured Vitest assertion status handling. Its
  contract is `a6.2f-component-command-composition/v13`; it retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

Operational-pane-selection test-owner checkpoint complete:

- The remaining owner-local candidates were compared before selection.
  `useOperationalPaneSelection` was selected over the one-test pane-registry
  boundary and the 12-test pane-request concurrency suite because its five
  existing behavior tests already cover one closed hook owner without widening
  the current checkpoint.
- All five assertions that inspect
  `src/features/terminal/useOperationalPaneSelection.ts` now live in
  `src/__tests__/useOperationalPaneSelection.test.tsx` beside pane
  reconciliation, owner-key cleanup, stale-callback rejection, and
  audit/reliability selection behavior. `AppSilentBugs.test.ts` retains only
  the App-owned composition guard for visual pane targets plus `projectPath`.
- The frontend ratchet contract is v14 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest assertion
  status handling. It truthfully retains `completedSlice=A6.2e4`,
  `activeSlice=A6.2f`, `sliceComplete=false`, and `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

Pane-registry test-owner checkpoint complete:

- The remaining owner-local candidates were compared before selection.
  `usePaneRegistry` was selected over the 12-test pane-request concurrency
  suite and the mixed App/keyboard project-lifecycle boundary because its
  existing behavior test covers one closed hook owner without widening the
  current checkpoint.
- All four assertions that inspect
  `src/features/terminal/usePaneRegistry.ts` now live in
  `src/__tests__/usePaneRegistry.test.tsx` beside active-PTY/registry cleanup
  and late-callback rejection behavior. `AppSilentBugs.test.ts` retains only
  the App-owned `usePaneRegistry(` composition guard.
- The frontend ratchet contract is v15 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest
  assertion status handling. It truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

Pane-request-controller test-owner checkpoint complete:

- All six assertions that inspect
  `src/features/terminal/usePaneRequestController.ts` now live in
  `src/__tests__/usePaneRequestController.test.tsx` beside its twelve
  concurrency, cancellation, settlement, routing, and cleanup behavior
  tests. `AppSilentBugs.test.ts` retains only the App-owned
  `usePaneRequestController({` composition guard.
- The frontend ratchet contract is v16 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest
  assertion status handling. It truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

Project-tab-lifecycle test-owner checkpoint complete:

- All twelve assertions that inspect
  `src/features/app/useProjectTabLifecycle.ts` now live in
  `src/__tests__/useProjectTabLifecycle.test.tsx` beside its five open,
  switch, close-folder, inactive-tab close, and active-tab close behavior
  tests. `AppSilentBugs.test.ts` retains the six App composition assertions
  and two keyboard-routing assertions because App and `useKeyboardShortcuts`
  own those wiring boundaries.
- The frontend ratchet contract is v17 and requires the exact owner-local
  source-contract test to execute and pass through structured Vitest
  assertion status handling. It truthfully retains
  `completedSlice=A6.2e4`, `activeSlice=A6.2f`, `sliceComplete=false`, and
  `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, or runtime state owner changed. A6.2f remains
  active at the next cohesive owner-local assertion slice; this checkpoint
  does not authorize A6.2g.

A6.2f owner-split stop audit complete:

- The recorded 42-block `AppSilentBugs.test.ts` inventory reconciles to 41
  current blocks because the separate unsaved guard was merged into the
  project-tab lifecycle owner. The remaining comparison classes are 11
  App/extracted-owner wiring blocks, 15 release/operator scenario blocks, 13
  right-rail/terminal integration blocks, and 2 visual-QA truth blocks.
- None of the eight completed declaration-owner source paths remains
  centralized. `useEditorOpenMode` is the only remaining direct declaration-
  owner source read, but it has no existing owner-local behavior suite and no
  fresh regression. Creating a new suite only to reduce the central file would
  violate the completed-owner and unjustified-complexity stop rules.
- The frontend ratchet contract is v18 and fail-closes on the remaining
  41-test/14-describe topology plus absence of those completed owner paths. It
  records `completedSlice=A6.2f`, `activeSlice=A6.2g`,
  `sliceComplete=false`, and `phaseComplete=false`.
- No production source, import layout, dependency, store, service, queue,
  scheduler, durable owner, runtime state owner, or new test owner changed.
  A6.2f is complete and A6.2g is now the exact frontend acceptance frontier.

#### **A6.2g Complete - Combined Frontend Acceptance**

A6.2 is complete only when fresh evidence proves all of the following together:

- `App.tsx` is a composition owner rather than a cross-domain behavior owner;
  `rightRailModel.tsx`, `useAppMenus.ts`, and every touched extracted owner have
  explicit responsibility and diagnostic non-growth baselines, with any growth
  justified by a cohesive owner contract rather than hidden code motion;
- no selector-less App `useAppStore()` subscription and no forbidden app-to-right-
  rail dependency for neutral contracts;
- executed behavioral suites cover the stateful owner transitions listed in A6.2e;
- TypeScript no-emit, production build, focused frontend tests, A3 rendered-trust
  regressions, `verify:a6:frontend-ratchet`, and the explicit
  `verify:a6:modularity-inventory:frontend` slice invocation pass with fresh
  provenance; the default aggregate inventory retains its independent global
  result for later A6 owners;
- a blocking CI job runs both A6 verifiers and the combined frontend acceptance on
  the required branch/PR lane, and current hosted evidence is green;
- the frontend artifact reports `sliceComplete=true` and `frontendComplete=true`
  only after these checks pass, while `phaseComplete=false` remains truthful.

A6.2g local gate-contract checkpoint:

- `verify:a6:modularity-inventory` retains its global exit/status contract and
  all frozen Rust ceilings. The same verifier exposes `frontendSlice` and the
  explicit `verify:a6:modularity-inventory:frontend` invocation exits only on
  the A6.2 owner result while the artifact continues to report the global
  BLOCK.
- `verify:a6:frontend-acceptance` is the single local combined owner for
  production build, enforced A3 UI trust source contract, v18 frontend ratchet,
  A6.2 inventory slice, fresh child provenance, and global-block preservation.
- the A3 keyboard-shell source contract follows split menu IDs through
  `useAppMenus.ts` into `useTerminalMenuCommands.ts` while retaining App's
  `TERMINAL_PREFIX_COMMAND_EVENT` dispatch boundary. The v18 ratchet retains
  executed terminal-menu command behavior proof.
- the blocking Windows `a6-frontend-acceptance` CI job depends on both
  `frontend` and `rendered-ui-trust`, executes the combined owner, and uploads
  all four evidence artifacts with `if-no-files-found: error`.
- a local green run reports `localComplete=true` but keeps
  `sliceComplete=false`, `frontendComplete=false`, `completedSlice=A6.2f`, and
  `activeSlice=A6.2g`. Only the same committed SHA executing in the blocking CI
  context may emit the A6.2g completion fields, and that claim is usable only
  after the hosted job itself is green.

A6.2g hosted closeout:

- exact-SHA GitHub Actions run `30535550369` at
  `548fe1e1aac389c9d06791f4f79075a6987dbbff` passed rendered UI trust,
  frontend, Rust, dependency audits, and the blocking A6.2 combined frontend
  acceptance job;
- rendered Playwright completed with `70 passed`, `1 flaky`, and `4 skipped`;
  the 1440px dialog-dismissal retry remains residual reliability evidence, not
  a stable A6.2 blocker;
- the hosted artifact reports
  `status=pass-a6.2g-combined-frontend-acceptance`,
  `localComplete=true`, `frontendComplete=true`, `sliceComplete=true`,
  `completedSlice=A6.2g`, `activeSlice=A6.3`, and `phaseComplete=false`;
- the overall workflow conclusion remains failure only because release hardening
  separately retains its stack-risk blocker. That release result does not
  reopen A6.2 or promote A6/Aelyris release readiness.

#### **A6.3 Complete - Tauri IPC Adapter And Handler Classification**

Start A6.3 with inventory and classification before persistence, deletion, or
adapter movement. Reconcile the authoritative Tauri command registration and
event registry against the typed frontend invoke facade, MCP/HTTP reuse, focused
tests, and compatibility aliases. Every handler must be classified from direct
evidence; inventory absence alone never authorizes deletion.

Primary target:

- `src-tauri/src/ipc/commands.rs`

First acceptance boundary:

- the current handler/registration/callsite/compatibility inventory is explicit;
- one authoritative adapter/facade/event owner is identified without adding a
  second registry;
- dead candidates are fail-closed until registration, frontend invoke,
  MCP/HTTP reuse, tests, and compatibility aliases are all disproved;
- the frozen modularity ceiling remains unchanged until a supported ownership
  extraction lowers it;
- A6 `phaseComplete=false` remains truthful.

Only the A6.8 combined aggregate may emit A6 `phaseComplete=true` after
A6.2-A6.7 and blocking CI all pass.

Completion evidence:

- the frozen inventory classifies all 40 handlers from the sole
  `tauri::generate_handler!` registration block through frontend invoke,
  MCP/HTTP reuse, test, and compatibility-alias surfaces;
- all 40 handlers remain `deletionAuthorized=false`; an absent signal is recorded
  as none observed and never promotes deletion authority;
- six `native_terminal_input_*` wrappers moved to the existing IME adapter while
  the shared commit/write authority remains in `commands.rs`;
- fourteen terminal/agent/chat wire names have one Rust owner in
  `event_commands.rs` and one typed TypeScript projection in `ipc.ts`; the
  verifier rejects raw production Rust wire literals outside that owner;
- `commands.rs` is `4429 <= 4574`, the A6.3 required-slice gate passes, a
  negative owner-duplication probe fails closed, Rust tests pass 1306/1306, and
  independent review round 2 reports zero findings;
- the global inventory remains failed for A6.4 `mcp.rs` (`6578 > 5943`) and A6.5
  `queries.rs` (`3334 > 3330`), so `phaseComplete=false` remains truthful.

#### **A6.4 Complete - MCP Catalog, Governance, And Domain Dispatch**

Start with an explicit inventory of the current tool catalog, JSON schemas,
governance-before-effect checks, and domain dispatch paths in
`src-tauri/src/api/mcp.rs`. Preserve exact verb/schema behavior and existing
runtime owners before extracting any module.

First acceptance boundary:

- catalog and schema expose exactly the same verb set without a second registry;
- governance remains ahead of every effectful dispatch path;
- extracted domain adapters depend toward their existing runtime owners and do
  not create parallel state or dispatch owners;
- exact verb/schema drift and focused domain behavior remain executable;
- the frozen `mcp.rs` ceiling is lowered from the current `6578 > 5943` failure;
- A6 `phaseComplete=false` remains truthful.

Closeout evidence:

- `mcp.rs` retains transport/composition and the sole ordered
  governance -> schema -> authorized-dispatch pipeline;
- `mcp/catalog.rs` owns the runtime catalog, schema index, and schema validation,
  while contract tool names are derived from that catalog;
- `mcp/dispatch.rs` owns one marked 83-arm authorized dispatcher and delegates
  to existing PTY, mux, Proofbook, task, event, merge, ownership, context,
  intent, and knowledge owners without new state, service, storage, or router;
- the focused A6.4 verifier reports frozen/catalog/schema/dispatch
  `83/83/83/83`, exact set parity, no duplicates, missing, or extras, negative
  missing/extra/duplicate rejection, governance-before-schema,
  schema-before-dispatch, and guarded Proofbook re-entry;
- the canonical ordered `(name,inputSchema)` digest matches the frozen contract,
  an in-memory schema mutation is rejected, and a denied malformed nested
  Proofbook call is audited before schema validation;
- `mcp.rs` is `2539 <= 5943`, focused MCP tests pass 42/42, Rust library tests
  pass 1307/1307, and `cargo check` passes;
- the global inventory remains failed only at A6.5 `queries.rs`
  (`3334 > 3330`), so `phaseComplete=false` remains truthful.

#### **A6.5 Complete - SQLite Domain Repositories**

Start with an explicit inventory of the query domains, transaction boundaries,
connection acquisition, and migration dependencies in
`src-tauri/src/db/queries.rs`. Preserve the existing Database as the single
connection and migration owner before extracting any domain repository.

First acceptance boundary:

- query-domain modules depend toward the existing Database owner and do not open
  an independent connection or create a second migration/schema owner;
- transaction boundaries, row mapping, error behavior, and concurrency-sensitive
  behavior remain executable against the existing database test surface;
- callsites continue through the same Database contract rather than acquiring
  split repository state;
- the frozen `queries.rs` ceiling is lowered from the current `3334 > 3330`
  failure without rebaselining;
- A6.6-A6.8 remain queued and A6 `phaseComplete=false` remains truthful.

Completion evidence:

- code-graph snapshot and pane-layout behavior are split into owner-local child
  modules behind the unchanged `Database` facade, without a new repository object,
  connection, migration, schema, service, or runtime-state owner;
- existing callsites and method signatures remain unchanged, the code-graph
  replacement transaction has an executable whole-snapshot rollback proof, and
  pane-layout JSON validation remains executable;
- the focused database surface passes 27/27 and the Rust library passes 1308/1308;
- four negative topology mutations reject commented-only module registration,
  independent connections, second schema ownership, and duplicate facade methods;
- `queries.rs` is `3174 <= 3330`; A6.6-A6.8 remain and A6
  `phaseComplete=false` remains truthful.

#### **A6.6 Complete - Native Proof CLI Boundary**

Inventory the command router, proof-domain modules, side effects, artifact schemas,
and host behavior in `src-tauri/src/bin/aelyris_native.rs` before extraction.
Isolate the existing proof binary behind an optional Cargo feature or equivalent
proof-only package boundary. This slice may reorganize existing proof behavior but
must not expand native product functionality; A8.0 remains the sole activation
decision for further native or full-native work.

First acceptance boundary:

- router and proof-domain modules depend toward the existing proof owners without
  creating a second runtime, product-state, storage, or command authority;
- existing command names, artifact schemas, side effects, exit behavior, and
  supported-host behavior remain executable;
- the proof binary is isolated behind an optional Cargo feature or equivalent
  proof-only package boundary without activating new native product scope;
- the frozen `aelyris_native.rs` ceiling is lowered from `8827` without
  rebaselining or moving logic solely for line count;
- A6.7-A6.8 remain queued and A6 `phaseComplete=false` remains truthful.

Completion evidence:

- the default Cargo application build excludes `aelyris-native`; the existing
  proof binary is available only through the optional `native-proof-cli` feature;
- command routing, readiness contracts, and daemon client behavior live in three
  owner-local modules behind the existing binary entrypoint, without a second
  runtime, product-state, storage, service, or command authority;
- the focused A6.6 gate freezes and preserves 40 command names, 62 artifact
  schemas and their canonical digest, host cfg behavior, exact error prefix/exit
  behavior, and the feature boundary; missing, extra, duplicate, schema,
  default-feature, and freshness-source mutations all fail closed;
- ten downstream native proof consumers include all four proof-source owners in
  their freshness graph; the directly executed A6.6 native-client,
  text-shaping, sleep-guard, and upper-compat proof paths build the current
  feature-gated binary, while the sleep guard rejects a stale explicit override;
- `aelyris_native.rs` is `8436 <= 8827`; focused native tests pass 7/7,
  live native-client checks pass 88/88, upper compatibility passes 6/6,
  text-shaping emits a fresh current fixture, the no-sleep guard refusal passes,
  default `cargo check` passes, and Rust library tests pass 1308/1308;
- independent review found and then closed the causal freshness/build gaps;
  focused round 2 reports zero findings. A6.7-A6.8 remain and A6
  `phaseComplete=false` remains truthful.

#### **A6.7 Complete - Callsite-Proven Duplicate/Unowned Infrastructure Removal**

Start with an explicit candidate inventory across the frozen A6 owner surfaces.
Do not infer dead or unowned status from name, file size, missing frontend
references, or an advisory scan. For each candidate, identify the authoritative
owner and directly check registrations, callsites, compatibility aliases,
runtime reachability, tests, and generated/reflective entry points before any
removal.

First acceptance boundary:

- every removed candidate has callsite and runtime evidence that it is duplicate
  or unowned, and absence alone never authorizes deletion;
- retained compatibility adapters and generated/reflective registrations remain
  classified rather than silently discarded;
- removal does not create a replacement manager, registry, service, storage
  layer, state owner, or dependency;
- focused behavior and negative reachability proof cover each accepted removal;
- A6.8 remains active and A6 `phaseComplete=false` remains truthful.

Completion evidence:

- the explicit candidate inventory accepted removal only for the legacy
  `session::SessionManager`; it had top-level module exposure and an
  auto-discovered integration test, but no production registration or runtime
  callsite. Database session persistence, PTY lifecycle, and mux restore remain
  with their existing authoritative owners;
- the runtime-reachable Tauri `PaneRegistry` and typed frontend IPC facade remain
  classified and retained. No replacement manager, registry, service, storage
  layer, state owner, dependency, shim, or compatibility alias was added;
- `src-tauri/Cargo.toml` explicitly disables publication, the tracked native UI
  policy makes no semantic compatibility promise or crates.io publication, and
  current public product documents claim no supported Rust SDK. Unknown external
  path-dependency use remains an unverified residual, not a supported contract;
- the A6.7 gate hashes all three absent legacy paths, rejects file/module/runtime/
  Cargo-target reintroduction through the source scanner, and separates carried
  A6.5/A6.6 source contracts from current-run behavior. Its required mode reports
  `globalStatus=not-evaluated`;
- the default aggregate executes A6.5-A6.7 behavior and includes the A6.3 IPC
  contract in its fail-closed result. Its same-line-count event-registry mutation
  is rejected. Database tests pass 3/3, mux restore tests pass 7/7, the full Rust
  library passes 1308/1308, and independent review closes both blocking findings
  after two bounded rework rounds. A6.8 remains active and A6
  `phaseComplete=false` remains truthful.

#### **A6.8 Complete - Combined Ratchet And Regression Acceptance**

Only after A6.2-A6.7 owner, behavior, and blocking CI evidence is current may the
combined aggregate retire advisory mode and emit A6 `phaseComplete=true`. A6.8
does not reopen completed slices without a fresh regression.

Local implementation checkpoint:

- `verify:a6:combined-acceptance` is the single A6.8 owner. It executes and
  validates the current default A6.2-A6.7 aggregate, exact provenance, all six
  frozen owner ceilings, slice completion and negative proofs, and the A6.3
  same-line-count IPC event-registry mutation;
- the blocking Windows hosted-candidate job depends directly on frontend,
  rendered UI trust, A6.2 frontend acceptance, and Rust library jobs. It runs
  after every dependency outcome, passes the exact four-result `needs` payload,
  uses the pinned Rust toolchain, and uploads exact-SHA evidence without advisory
  failure handling;
- ordinary local execution and the in-progress hosted candidate cannot emit
  completion. Only explicit post-run `--github-run-id` closeout may use the
  existing authenticated GitHub CLI, and it requires a clean tracked/untracked
  worktree plus exact repository, CI workflow/path, completed run, HEAD SHA, run
  attempt, run URL, and one completed-success match for all four dependency jobs
  and the A6.8 candidate job. As with the completed A6.2g precedent, the aggregate
  workflow conclusion is recorded but does not override those five authoritative
  A6 bindings when the separate release-hardening job retains its own blocker;
- full synthetic CI environment, missing/failed/extra dependency, SHA mismatch,
  and dirty-worktree mutations cannot authorize completion. No workflow token,
  permission, OIDC grant, dependency, second completion owner, or secret-bearing
  transcript is added;
- A6.8 exposed two fresh A6.2 execution regressions without reopening product
  behavior: the frontend acceptance now requires inventory schema v3 and allows
  360 seconds for the measured modularity child. The one A6.3-required
  `ipcEvents` import is recorded by raising only the `PaneTreeContainer`
  diagnostic ceiling from 1691 to 1692; the A6.3 aggregate separately requires
  that typed facade callsite, so no source was moved or shortened for the metric;
- fresh local frontend and combined acceptance pass as
  `pass-local-awaiting-hosted-ci`, with `localComplete=true`,
  `hostedComplete=false`, `sliceComplete=false`, and `phaseComplete=false`.
  Independent review found and closed the environment-spoof and mixed-OID
  completion paths in two bounded rework rounds. A6.8 remains active until the
  committed exact-SHA GitHub run is green and external closeout verifies it.
- Hosted run `30570956763` then found two stale source-contract cases for the
  A6.7-removed `SessionManager`; removing only that dead glob entry and those
  two obsolete cases leaves the current guard suite at 9/9 and the full
  frontend at 2044/2044. Replacement run `30571656787` passed normal frontend,
  rendered UI, and Rust, then exposed a distinct execution-owner defect:
  required A6.2 inventory still ran the later A6.5 database, A6.6 native, and
  A6.7 removal behavior and timed out at 360 seconds on a cold runner. The
  inventory now executes later behavior only in its matching required slice or
  default global mode. Skipped slices are explicit `not-run` with carried
  source contracts, required runs report global truth `not-evaluated`, frontend
  acceptance requires that exact isolation, and default A6.8 still executes
  and requires every behavior owner. The local A6.2-A6.7 required-slice matrix,
  frontend acceptance, and default combined acceptance pass; a new exact-SHA
  hosted replacement remains required before A6 completion.
- Hosted run `30574240201` then proved frontend, rendered UI trust, Rust, and the
  isolated A6.2 acceptance green. Its A6.8 candidate accepted the exact four-job
  dependency context but the cold global inventory reached the verifier's
  360-second child-process limit before it could write its artifact. This is an
  execution allowance defect, not authority to skip the global behavior owners:
  A6.8 continues to execute all A6.2-A6.7 behavior in default mode, while its
  child-process allowance is raised to 720 seconds inside the existing 45-minute
  blocking job. A fresh exact-SHA hosted run and authenticated closeout remain
  mandatory.
- Exact-SHA hosted run `30575942362` at
  `baeb8f5936359b9dccc38b66738a66450b5c037c` completed with success for
  frontend, rendered UI trust, isolated A6.2 frontend acceptance, Rust, and the
  A6.8 all-owner candidate. Authenticated post-run closeout from the clean matching
  HEAD verified repository identity, workflow name/path, run ID/attempt/URL, the
  complete job list, and exactly one completed-success match for all five A6 jobs.
  The artifact reports `localComplete=true`, `hostedComplete=true`,
  `sliceComplete=true`, `phaseComplete=true`, `completedSlice=A6.8`, and
  `activeSlice=A7.0`. The overall workflow conclusion remains failure because the
  separately owned release-hardening stack-risk gate remains unresolved; A6 neither
  consumes nor conceals that release blocker.

## A7 - Evidence-Backed Core Mission Loop

Objective: prove one useful end-to-end Verifiable Agent Work OS mission without
inferred completion truth or bundling every destination feature into the first
release-blocking vertical.

Product authorities:

- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md`,
- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md`,
- `AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md`.

Canonical acceptance journey:

```text
request
  -> versioned plan preview
  -> visible implementation agent
  -> fresh tests
  -> independent review
  -> exact-OID accept/merge
  -> immutable completion packet
```

Required product primitives are only those exercised by that journey:

- one accepted backend-owned Mission/work-unit definition and projection using the
  existing TaskGraph owner,
- the minimum causal event/evidence references needed to explain and settle that
  Mission without a new journal,
- scoped authority for the enabled Mission actions; unused faces are explicitly
  disabled or typed unsupported rather than migrated pre-emptively,
- visible real-PTY execution with Mission/runtime/ownership correlation,
- fresh executed tests and independent reviewer lineage,
- exact-OID acceptance/merge through the existing review and merge owners,
- immutable `CompletedWorkPacket`, `BlockedWorkPacket`, and
  `MissionCompletionPacket` settlement with zero hidden acceptance blockers.

The full product Goal is preserved. Proofbook product UI and recipes, Fleet
Briefing, broad budget/cost UX, Remote Continuity, universal all-face Control
Kernel migration beyond the enabled Mission path, provider-fabric expansion, and
learning layers are deferred from A7 Core and remain explicitly tracked destination
work. Existing Proofbook evidence may be referenced when already available, but A7
does not create a second runner or require Proofbook productization.

### **A7.0 - Core Mission Scope Lock And Owner Inventory**

Status: complete at local commit `cef976f`; no A7 runtime claim was implemented by
this design-only slice. A7.1 later made a corrective, verifier-backed amendment to
the same machine authority: the inert `mission_plan_*` route replaces the
immediately materializing compatibility faces, and pre-acceptance HEAD drift may
advance only through the recorded reject/cancel plus aligned revision chain.

Machine authority: the marked `aelyris.a7_core_scope_lock/v1` record in
`AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md`. It freezes the fixture,
existing-owner map, minimum contracts, enabled-face dispositions, blocked negative
scenario, deferred set, and forbidden second owners. All A7 runtime claims remain
false in this design-only slice.

Acceptance evidence is the current
`pnpm verify:verifiable-agent-work-os-spec` artifact. Before commit it must report
`readyToCommit=true`, `completedSlice=null`, and `runtimeDirty=[]`; this is candidate
acceptance, not completed-slice provenance. Only an unchanged post-commit rerun may
report `completedSlice=A7.0`. A7.0 scope lock is accepted as the commit candidate.
A7.1 is the next implementation slice; the work-order change is staged until that
commit-bound closeout exists.

- freeze one fixed request fixture and the seven-step canonical acceptance journey;
- inventory only the TaskGraph, runtime/PTY, ownership, event/evidence, test,
  review, merge, and settlement owners exercised by that fixture;
- identify the enabled IPC/MCP/PTY actions used by the journey and either route
  those actions through existing authoritative seams or mark them unsupported;
  do not inventory-and-migrate every possible product face as an A7 prerequisite;
- freeze the minimum Mission/work-unit, evidence, review, exact-OID, completion,
  blocked-settlement, and versioning contracts needed by the fixture;
- prove that no second DAG, journal, runner, dispatcher, completion table, or
  frontend state owner is introduced;
- record the deferred destination set explicitly and keep every target runtime claim
  false until its own future gate passes.

### **A7.1 - Request Contract And Versioned Plan Preview**

Status: complete; A7 as a whole remains incomplete.

- accept one request into the existing TaskGraph-backed Mission owner;
- produce a versioned, non-effectful plan preview with work unit, owned targets,
  expected tests, review requirement, merge policy, and explicit risks;
- rejection or cancellation before acceptance creates no worktree, PTY, capability,
  or external effect;
- persist only the minimum causal facts required to resume and explain this journey.

Implemented checkpoint:

- `TaskManager` remains the sole Mission/work owner and persists through the existing
  `TaskRepo`/SQLite connection and migration owner; no second DAG, runner, journal,
  dispatcher, or frontend state owner was added;
- the fixed A7 Core request is admitted only with canonical UUIDv7 identities, the
  authoritative repository HEAD, exact owned path/test, visible-PTY/Prompt policy,
  independent review, isolated exact-OID merge policy, and the A7.2 unlock contract;
- preview and `accepted` remain inert: no TaskGraph revision, task materialization,
  execution reservation, worktree, PTY, lease, process, test, review, merge, or
  settlement effect is created;
- SQLite schema v7 keeps immutable content, no-delete history, terminal CAS decisions,
  one accepted plan per Mission definition revision, restart restoration, and an
  exact `rejected|cancelled -> next aligned revision` recovery chain;
- `pnpm verify:a7:mission-plan` is the focused proof. It may complete A7.1 only;
  `phaseComplete` remains false and A7.2 is the next implementation slice.

### **A7.2 - Visible Implementation And Fresh Tests**

Status: complete; A7 as a whole remains incomplete.

- launch one real implementation agent in a visible PTY and isolated worktree using
  existing runtime, ownership, startup-admission, and execution-fence owners;
- bind the enabled actions to the Mission/work unit, actor, generation, owned
  targets, and accepted plan; agents cannot widen their authority;
- run the declared tests after implementation and record exact command, result,
  artifact/evidence digest, and tested OID;
- unavailable unused adapters or product faces return typed `unsupported` or remain
  disabled; their migration is not A7 Core work.

Implemented checkpoint:

- `mission_plan_run` accepts only the fixed accepted plan revision and derives one
  exclusive TaskGraph projection; concurrent duplicate activation returns the same
  durable identity and graph contamination is rejected under the autonomy lease;
- the visible implementation route uses `codex-no-hooks`, preserves the multiline
  prompt through the PowerShell shim, requires an exact four-byte `done` marker, and
  stops at the durable `Review/Reserved` pre-review fence;
- the existing Git/worktree owner creates and reuses only an exact-base isolated
  worktree, stages backend-derived owned targets only, commits before testing, and
  requires `testedOid == candidateOid == clean worktree HEAD`;
- SQLite schema v8 stores immutable activation and gate evidence without a second
  DAG, journal, runner, dispatcher, or completion owner;
- `pnpm verify:a7:visible-implementation` is the focused proof. It combines 14/14
  runtime contract tests with one genuinely fresh visible-PTY execution, records
  hooks disabled and five-minute evidence freshness, completes only A7.2, advances
  the implementation frontier to A7.3, and keeps `phaseComplete=false`.

### **A7.3 - Independent Review And Exact-OID Acceptance**

Status: complete.

- the reviewer is independent from the implementation agent and evaluates the exact
  tested OID plus declared acceptance coverage;
- review rejection returns the work unit to a non-complete state with exact findings
  and next action;
- acceptance or merge uses the existing exact-OID merge-intent owner; a moved OID,
  dirty/unowned worktree, stale test result, or stale review invalidates settlement;
- no automatic main merge is introduced.

### **A7.4 - Immutable Completion And Blocked Settlement**

Status: complete after regression repair and final separated independent review.

- create an immutable `CompletedWorkPacket` only from the accepted Mission revision,
  tested and reviewed exact OID, owned diff, fresh test evidence, independent
  reviewer lineage, merge/accept receipt, and zero acceptance blockers;
- emit a separate `BlockedWorkPacket` for any repo, policy, operator, or external
  acceptance blocker and keep the work unit, Mission, and A7 incomplete;
- aggregate exact required work-unit packets and Mission-level coverage into a
  distinct `MissionCompletionPacket`; one child packet never completes the Mission;
- enforce packet settlement inside existing owners, not through a new completion
  table or service;
- negative tests reject tamper, stale or changed OID, missing/stale evidence,
  same-agent reviewer, hidden blocker, dirty/unowned worktree, and digest mismatch;
- test PASS, review approval, merge intent, agent self-report, or durable blocked
  handoff alone cannot render trusted Done.

Initial A7.4 implementation (2026-08-02): immutable `CompletedWorkPacket`,
`BlockedWorkPacket`, and `MissionCompletionPacket` schemas now settle through the
existing `TaskManager`/`TaskRepo` owner. SQLite schema v10 stores append-only packet
facts, while one transaction validates the frozen authority CAS, inserts the exact
packet set, and persists the existing TaskGraph `Done`/`Blocked` projection.
Completed packets require zero blockers and exact tested/reviewed/integrated OID;
blocked packets require typed repo/policy/operator/external blockers and grant zero
completion credit. Focused proof is `pnpm verify:a7:completion-settlement` (5 tests).
Independent review then found four blocking contract regressions: incomplete frozen
freshness evaluation, caller-shaped blocker authority, terminal blocked settlement,
and missing observed Git facts from the commit CAS. A7.4 is reopened until those
regressions are repaired and independently accepted. A7 remains incomplete and A7.5
is frozen.

Regression-repair candidate (2026-08-02): the accepted five-minute freshness policy,
closed typed blocker classifier, SQLite v11 settlement generations/current selector,
and final in-transaction Git witness revalidation are implemented through the existing
Mission, TaskRepo, TaskGraph, review, merge, and repository owners. Serialization and
idempotent reads precede the final witness; its equality check is immediately followed
by the settlement-expected-version CAS. Pre-witness mutation rolls back with no Done,
while mutation after witness return is post-linearization drift requiring a later
generation/re-proof. Focused proof is eight Rust tests and includes a true two-connection
same-predecessor successor race, receipt-only recovery through `TaskManager`, and
populated v10-to-v11 compatibility for completed, blocked, and Mission packet kinds.
A later separated review found one remaining decode-order gap: legacy-shaped raw JSON
could carry the digest of its defaults-expanded current struct. Raw packet shape now
selects complete v11 validation, strict v10 raw-digest compatibility, or fail-closed
partial rejection before current validation. Negative completed, Mission, and blocked
fixtures prove the forged current digest fails after the real v11 migration. Final
separated independent review passed with zero major findings. A7.4 is complete and moves
the frontier to A7.5 without starting its combined-acceptance implementation.

### **A7.5 - Canonical Core Mission Combined Acceptance**

Status: complete from exact-SHA hosted evidence and authenticated clean-worktree
closeout. A7.5 is the last completed slice and A8.0 is active.

The fixed request must pass, in order: accepted versioned plan preview, visible
implementation, fresh tests, independent exact-OID review, successful exact-OID
accept/merge, immutable `CompletedWorkPacket`, and exact
`MissionCompletionPacket`.

A separate mandatory negative scenario emits `BlockedWorkPacket`, preserves exact
continuation, and proves the Mission/A7 aggregate stays incomplete. It is not an
alternative success path. The combined gate runs in blocking CI and rejects any
missing/stale evidence, acceptance blocker, unclassified failure, inferred
completion, or false phase/release claim. A7 completion alone does not imply A8,
A9, external/operator, deferred product features, or release completion.

Local candidate implementation (2026-08-02): `pnpm verify:a7:combined-acceptance`
executes the current `a7_` source-proof family, validates the preserved A7.2 visible
implementation and A7.3 exact-OID acceptance chain, exercises changed-candidate
zero-credit blocked continuation, and validates a blocking hosted CI job contract.
The local run passes 48 Rust tests and reports `pass-local-awaiting-hosted-ci` with
`completedSlice=A7.4`, `activeSlice=A7.5`, and `phaseComplete=false`. A7.5 cannot close
until a completed exact-HEAD GitHub run proves the blocking jobs and the clean local
closeout binds that run to the preserved live evidence.

External closeout (2026-08-02): GitHub Actions run `30735313688` at exact candidate
`82c69c371bed6a90c9ba01ba8d2614d533b3ff75` completed. The uniquely matched Frontend
job `91462944863`, Rust job `91462944807`, and A7.5 combined job `91463289810` all
succeeded on run attempt 1. Authenticated clean-worktree closeout re-executed 48/48 A7
Rust tests, revalidated the preserved exact-OID evidence, and emitted
`pass-a7.5-externally-verified`, `completedSlice=A7.5`, `activeSlice=A8.0`, and
`phaseComplete=true`. The workflow-level conclusion remained failure because the
separate Rendered UI trust and release-hardening lanes were red, and the historical
A6.8 hosted candidate consequently failed its Rendered UI dependency check. Those
remain outside the A7 completion class and keep their own quality/release blocker
semantics. A7 completion does not imply release readiness.

Do not start marketplace, autonomous main merge, hosted cloud IDE, broad team RBAC,
or effectful Shadow Missions before the Core Mission Loop and local single-operator
trust path are proven.

### **A8.0 - Native Product Goal And Architecture Decision Gate**

Status: active decision gate; no product/architecture outcome has been selected.

The full-native Rust migration package under
`docs/plans/full-native-rust-migration/` is the high-priority queued proposal.
Before A8 implementation, A8.0 compares:

- the current Tauri/React face plus measured native terminal path,
- a mature Rust UI framework that satisfies the same requirements,
- the proposed Aelyris-specific retained runtime and specialized surfaces.

The decision must use current native coverage v2, same-condition performance,
IME/accessibility/recovery evidence, Windows 10/11 product support, dependency and
license cost, framework maintenance cost, rollback, and release timing. Historical
v1 `98%` evidence is inadmissible; `shippingShellReady=false` remains blocking until
fresh evidence changes it.

Default outcome is to preserve the current A8/A9 route and schedule NUI-F0-F7 as the
priority-1 post-A9 program. Moving the migration before A9 requires an explicit owner
decision accepting release delay and a versioned rebaseline of this program. Proposal
import alone cannot supersede ADR-001, `TERMINAL_CORE_DESIGN.md §3`, or current claims.

## A8 - Measured Native Terminal Spike

Objective: decide terminal presentation from measured cost, not the existing proof score.

Preconditions:

- A1 input authority complete,
- A3 liveness/input trust complete,
- actual IPC bytes/events, key-to-paint p99, event queue lag, WebView memory, full-grid,
  scroll-flood, and long-soak metrics recorded.

Conditional work:

- reduce polling and duplicate raw-output traffic,
- implement one continuous DComp/wgpu pane behind the Tauri cockpit,
- run dual-render parity for focus, IME, cursor, selection, search, links, images,
  transparency, accessibility, resize, restart, and fallback.

Promotion requires better representative-hardware evidence than Canvas. Failure closes
the spike without forcing a rewrite. Full-native reconsideration requires a documented
falsification condition from `TERMINAL_CORE_DESIGN.md`.

## A9 - Release Lane and External Proof Closeout

Objective: make green CI equivalent to the intended release claim.

Required work:

- production and distribution build,
- all Rust tests plus selected stress/property/fuzz suites,
- rendered Playwright/WebView2 tests,
- updater lifecycle,
- crash capture and redacted persistent diagnostics,
- real sleep/resume and long-running recovery,
- signed artifact and provenance validation,
- exact external/operator handoff for gates that cannot run in CI.

Release remains BLOCK until repo-owned phases A0-A8 are complete and external proof is
current. External limitations must not be counted as implementation completion.

## Post-A9 Apex Product Program - Tracked Destination, Not R0-A9 Scope

Post-A9 portfolio entry follows the canonical A8.0 decision. If A8.0 accepts
ADR-014 as written or with amendments, NUI-F0-F7 is the priority-1 program and
runs before these Apex waves; NUI-0.1 only ratifies that accepted decision for
activation. If A8.0 defers or rejects ADR-014, the Apex sequence starts
directly. Closing or retiring the NUI program then resumes the Apex waves in the
dependency order below:

1. Universal Agent Fabric expansion: keep V1-R0 as the OpenCode comparison, then
   separately gate V1-R1 structured state authority/explainability and V1-R2
   quarantined external-run adoption. A V1-R3 Runtime TUI is conditional on
   `promote_one` plus daemon-owned projection proof and cannot replace the Tauri
   cockpit by default.
2. Mission Time Machine: journal convergence, deterministic replay, recovery
   branches/checkpoints, compensation, uncertain-effect reconciliation.
3. Qralis Coordination Fabric: V3a adds addressed typed messages, Task Claims, Role
   Leases, Result Capsule projection, Decision Ledger references, and Attention;
   V3b adds an Obligation Ledger, event-driven dispatch, adaptive governance,
   Verified Action Surface, and team operations through existing owners. Result
   Capsules reference completion/blocked packets and never own completion.
4. Verified Skill Foundry: Proofbook product UI/recipes/Fleet Briefing/budget
   integration, fan-out/subProofbook/Evidence Store, scheduling,
   evidence-governed memory/skills, and proof-preserving PB-6
   distillation with source trace/environment snapshot, side-effect contract,
   proof-equivalence comparators, repeated/held-out differential replay, canary,
   rollback, stale invalidation, capability reduction/non-broadening, and visual
   proof. This remains an Aelyris hypothesis until its own gates pass.
5. Decision Lab and Adversarial Council: bounded independent proposals, fixed
   rubric, preserved dissent, human gate policy.
6. Counterfactual Arena: static plan comparison, then isolated same-base Shadow
   Missions compared by fixed proof and independent review.
7. Temporal Project Twin: ownership/dependency/proof history, stale-proof and
   revalidation projection.
8. Governed Remote Control: establish scoped read-only continuity, then add
   steer/approve/stop, writable attach, emergency steal, and runtime domains.
9. Signed Extension Ecosystem and A2A federation only after supply-chain proof.

Each Apex wave needs its own owner inventory, acceptance, CI, external boundary,
focused commits, and claim gate. Its absence cannot be hidden as an R0-A9 blocker,
and its design presence cannot be counted as implemented capability.

No Apex wave may add a parallel Mission operation journal, completion-barrier
table, scheduler, Proofbook, Decision store, generic chat/arbitrary-JavaScript
authority, fixed 11-agent topology, or a new assurance score.

## Required Session Record

Every session in this program must use:

- tracked status: `audit-remediation-instructions.md`,
- worklog: `.codex-auto/worklogs/audit-remediation/<timestamp>-<phase>.md`,
- handoff: `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md`,
- close gate: `pnpm verify:audit-remediation:continuation`.

The handoff names one next action only. The plan remains the detailed backlog; do not
copy the whole plan into the handoff.
