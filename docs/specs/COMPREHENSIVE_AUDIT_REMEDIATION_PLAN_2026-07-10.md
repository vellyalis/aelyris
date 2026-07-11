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

## A6 - Modularity Ratchet

Objective: shrink ownership hotspots and prevent regrowth.

Primary targets:

- `src/App.tsx`
- `src/shared/lib/rightRailModel.tsx`
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
