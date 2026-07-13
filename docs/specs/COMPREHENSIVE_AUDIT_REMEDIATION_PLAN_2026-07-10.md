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
  -> A7 evidence-backed product completion
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
- `src-tauri/src/session/manager.rs` owns legacy terminal session/window/pane restore;
  `src-tauri/src/mux/store.rs` owns versioned file snapshots for the mux graph.
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

Objective: shrink ownership hotspots and prevent regrowth.

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
- convert advisory file-size boundaries to ratchets that reject growth and lower the
  baseline after each phase,
- remove dead duplicate managers and unowned infrastructure.

### A6.1 Complete - Ownership Hotspot and Ratchet Inventory

The authoritative right-rail model path is
`src/features/right-rail/rightRailModel.tsx`; the older `src/shared/lib` path is stale.
`pnpm verify:a6:modularity-inventory` freezes current line-count ceilings for all six
owners and fails on growth. These ceilings are debt baselines, not desired targets;
every implementation slice must lower its owned ceiling in the same commit.

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
- six owner baselines reject growth
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
6. `App.tsx=4215` cannot credibly reach the <=800 target through hook motion alone.
   `useAppMenus.ts` is already about 988 physical lines and demonstrates the need
   to ratchet extracted owners and split render/command composition by owner.
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
focused commit and lowers every touched owner ceiling in the same commit:

#### A6.2e - Architecture and Behavioral Contract Repair

1. **A6.2e0 exact continuation and worklog contract hardening**: add an explicit
   `ACTIVE SLICE` field and require strict equality of the exact slice across the
   work order, its tracked-plan anchor, local handoff, current worklog, artifact,
   and pasteable continuation goal. Enforce the protocol's command/result, artifact,
   commit, blocker split, Git truth, and next-action fields for the current worklog;
   coarse normalized substring presence is insufficient.
2. **A6.2e1 neutral evidence utilities and dependency-boundary ratchet**: move
   generic project artifact path/JSON parsing to a neutral owner, import bootstrap
   types from their declaration owner, remove app-to-right-rail-model dependencies
   that exist only for generic contracts, add executed utility tests, and make the
   frontend ratchet fail on the forbidden dependency direction. Register ceilings
   for extracted owners, including `useAppMenus.ts`; code motion may not create a
   new >800-line hotspot. Generic/app owners may not import the right-rail runtime
   barrel; right-rail consumers use direct declaration owners or a deliberately
   typed facade instead of wildcard re-export coupling.
3. **A6.2e2 narrow store subscription**: replace the whole-store `useAppStore()`
   subscription with stable narrow selectors or a shallow selector contract, prove
   that unrelated store mutation does not rerender the shell owner, and add a
   fail-closed verifier check that rejects selector-less App subscriptions.
4. **A6.2e3 project/tab transition behavior**: execute open, switch, close-folder,
   inactive-tab close, and active-tab close behavior in tests. An unsaved cancel
   preserves the active tab, interactive session, editor files, and pane snapshots;
   a confirmed active-tab context change clears editor state only after the tab
   transition succeeds. Close Folder must also detach the effective project path so
   project-scoped polling/effects cannot continue behind the Welcome surface.
5. **A6.2e4 stateful-owner behavior**: make each evidence poll one generation;
   release evidence commits its three-file result atomically, all evidence owners
   suppress or cancel overlap, ignore stale generations, and prevent later adoption
   after project change or unmount. Define pane
   requests as per-kind serialized work: loss-intolerant close/restart/attach/rename/
   role/layout operations execute FIFO, focus alone may use documented latest-wins,
   and every accepted request settles exactly once within a bounded lifecycle on
   success, failure, typed cancellation, tab removal, or unmount. Add concurrent-
   request, timer, out-of-order completion, project-change, stale-result, partial-
   evidence, routing, completion, and cleanup tests for the evidence, pane request,
   spawn, registry, and selection owners. Delayed agent-spawn events must retain the
   initiating tab owner across a tab switch rather than adopting the tab active at
   event receipt. Source-string tests may remain as ownership guards but are not
   behavior acceptance. Give the frontend artifact explicit `completedSlice` and
   `contractVersion` fields; remove the stale A6.2a status label.

#### A6.2f - Component and Command Composition

1. Split `useAppMenus.ts` into typed command/menu owner groups before it is allowed
   to become a replacement hotspot; keep the public composition hook below 800 lines.
2. Extract the right-rail render surface into typed view-model/action contracts,
   preserving the single runtime owners and avoiding a giant undifferentiated prop
   bag or duplicate derived state. Separate pure projection contracts from component
   contracts and replace wildcard runtime-barrel exposure with direct owners or an
   explicit narrow facade.
3. Extract workspace/editor/chrome composition and the dialog/overlay host along
   cohesive render boundaries. Every new owner is registered with an <=800-line
   ceiling and focused rendered-behavior proof.
4. Reduce `App.tsx` to a composition shell at or below 800 lines. Every intermediate
   commit must lower the exact App ceiling; reaching the target by hiding logic in
   unratcheted files is a failure.
5. Split `AppSilentBugs.test.ts` by authoritative owner and ratchet the remaining
   cross-surface source-contract suite below 800 lines; behavioral tests live with
   the owner contract they execute.

#### A6.2g - Combined Frontend Acceptance

A6.2 is complete only when fresh evidence proves all of the following together:

- `App.tsx <= 800`, `rightRailModel.tsx <= 800`, `useAppMenus.ts <= 800`, and every
  extracted A6 frontend owner is registered and rejects growth above its current
  lowered ceiling;
- no selector-less App `useAppStore()` subscription and no forbidden app-to-right-
  rail dependency for neutral contracts;
- executed behavioral suites cover the stateful owner transitions listed in A6.2e;
- TypeScript no-emit, production build, focused frontend tests, A3 rendered-trust
  regressions, `verify:a6:frontend-ratchet`, and `verify:a6:modularity-inventory`
  pass with fresh provenance;
- a blocking CI job runs both A6 verifiers and the combined frontend acceptance on
  the required branch/PR lane, and current hosted evidence is green;
- the frontend artifact reports `sliceComplete=true` and `frontendComplete=true`
  only after these checks pass, while `phaseComplete=false` remains truthful.

A6.3 remains next and must not start until A6.2g is complete. Only the A6.8 combined
aggregate may emit A6 `phaseComplete=true` after A6.2-A6.7 and blocking CI all pass.

## A7 - Evidence-Backed Product Completion

Objective: complete one useful mission without inferred completion truth.

Required product primitive: immutable backend-owned `CompletedWorkPacket` binding:

- goal/work unit and actor identities,
- base/head commit,
- owned files/symbols,
- executed gates and evidence digests,
- reviewer verdict and residual risks,
- approval capability and approver,
- merge result or durable blocked handoff.

Build order:

1. packet schema/persistence/verifier,
2. verified Review Queue and merge projection,
3. First Mission preflight and plan preview,
4. Proofbook product UI,
5. daily Fleet Briefing, recipes, and budget/cost controls,
6. remote read-only continuity,
7. principal/capability and connector contracts.

Do not start marketplace, autonomous main merge, hosted cloud IDE, or broad team RBAC
before the completion packet and local single-operator trust path are proven.

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

## Required Session Record

Every session in this program must use:

- tracked status: `audit-remediation-instructions.md`,
- worklog: `.codex-auto/worklogs/audit-remediation/<timestamp>-<phase>.md`,
- handoff: `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md`,
- close gate: `pnpm verify:audit-remediation:continuation`.

The handoff names one next action only. The plan remains the detailed backlog; do not
copy the whole plan into the handoff.
