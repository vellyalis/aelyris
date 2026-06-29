# Longrun Full Autonomy + Aelyris Wizard S+++ Plan

Date: 2026-05-06
Workspace: `<repo>`
Related plans:
- `docs/history/LONGRUN_FULL_AUTONOMY_SPP_PLAN_2026-05-05.md`
- `docs/history/AI_WORKSTATION_98_IMPLEMENTATION_PLAN_2026-05-02.md`
- `docs/history/AI_WORKSTATION_STRICT_AUDIT_2026-05-06.md`

## 0. Separation Of Concerns

Longrun operation mode and Aelyris are related, but not the same product.

| Layer | Location | Purpose | Required for Aelyris 10? |
| --- | --- | --- | --- |
| Longrun automation harness | `<codex-home>` plus `.codex-auto` workspace state | Let Codex run long tasks, recover, split work, validate, and report truth | No, unless Aelyris product scope includes autonomous engineering execution |
| Aelyris | `<repo>` | User-facing Tauri/React/Rust AI workspace terminal | Yes |
| Aelyris autonomous feature, optional future | Aelyris app/backend | Productized version of longrun-like autonomous task execution | Optional strategic feature |

Decision:
- Implement longrun hardening first because it improves the development/control plane and prevents repeated stalls.
- Do not treat longrun defects as Aelyris product defects unless Aelyris intentionally adopts the same autonomous runner as a product feature.
- Still include Aelyris 10-point requirements in this plan, because after longrun is reliable it should be used to finish Aelyris release-grade evidence.

## 1. Current Scores

| Area | Current | Target | Gap |
| --- | ---: | ---: | --- |
| Longrun autonomous operations | 7.6 / 10 | 9.8+ / 10 | Needs truth, leases, scheduler, merge gate, critic, chaos evidence |
| Aelyris implementation quality | 9.1 / 10 | 10 / 10 | Needs clean-machine release, real-world PTY/agent recovery, security/perf/UX proof |
| Aelyris release confidence | 8.4-8.7 / 10 | 9.8+ / 10 | Needs signed distribution evidence, updater custody, soak and OS matrix |
| Wizard S+++ overall | 8.5-9.0 / 10 | S+++ | Needs end-to-end autonomy plus product-grade evidence |

## 2. What Longrun Is Missing

Longrun is not yet "perfect" because it can still fail or mislead in these ways:

1. Ownership is not impossible to confuse.
   - A stale run, stale PID, old dashboard, old watchdog, or old auto-loop can still look alive unless every state update is protected by runId/generation lease semantics.

2. Progress can be truthful but not complete enough.
   - Dashboard truth improved, but fleet-level truth is not first-class: coordinator, workers, worktrees, merge queue, validation gates, retry budget, and critic status need separate observed states.

3. Heavy tasks are not automatically split with enough discipline.
   - The system needs complexity scoring, dependency graphing, write-scope ownership, and automatic decomposition before a large task wastes many turns.

4. Parallelism is not safe enough yet.
   - Worktree-based parallel execution needs scheduler policy, resource budgeting, dirty-main protection, worker artifact contracts, and deterministic cleanup.

5. Merging parallel outputs is not governed enough.
   - There is no complete merge arbiter that can integrate worker results one at a time, detect conflict class, rerun impacted validation, rollback, and preserve evidence.

6. Failure triage is not autonomous enough.
   - Repeated failures must switch strategy, split work, reduce scope, or escalate as irreducible. Blind restart loops are not acceptable.

7. Quality promotion is not strict enough.
   - A card should never become done with shallow evidence, missing validation, unclassified skipped tests, stale logs, or unresolved critical risk.

8. Operational durability is not proven.
   - Need fixtures and live drills for sleep/resume, dashboard death, runner death, monitor restart, huge journals, port conflicts, external dependency outage, and stuck child processes.

## 3. Definition Of Perfect Longrun

Longrun can be called perfect only when all of the following are true:

### Truth

- There is exactly one current run generation per workspace/thread.
- Every displayed state is derived from canonical state plus live process truth.
- A completed run becomes immutable except for explicit archival metadata.
- A dashboard never shows stale active work as current.
- Progress never advances without evidence.
- Time never keeps counting as active after completion.

### Autonomy

- The system notices stale work without the user.
- It can distinguish slow, idle, blocked, failed, waiting, completed, and externally dependent work.
- It automatically decomposes oversized tasks.
- It retries only according to typed policy and budget.
- It escalates only decisions that cannot be safely resolved locally.

### Parallel Efficiency

- Tasks run in parallel only when dependencies and write scopes permit it.
- Parallel workers use isolated worktrees or equivalent isolation.
- User dirty changes in the main workspace are never overwritten.
- Resource budgets prevent CPU/RAM/test storms.
- Worker output is merged through a deterministic gate.

### Quality

- No work is promoted without validation evidence.
- Skipped validation must be classified and justified.
- Independent critic can demote work from done to review.
- Final report lists completed work, remaining work, validation highlights, residual risks, and artifact paths.

### Recovery

- Runner death, dashboard death, watchdog death, stale lock, port conflict, huge journal, and sleep/resume are self-healed or clearly escalated.
- Zombie child processes are reaped without killing the active generation.
- Restart budget prevents infinite loops.
- Recovery actions are visible and auditable.

## 4. Longrun Roadmap

### LR-P0-01: Run Registry v2 And State Schema

Goal:
- Make every run, process, dashboard, worker, and archive record addressable and auditable.

Implementation:
- Define `runId`, `threadId`, `workspace`, `generation`, `createdAt`, `updatedAt`, `completedAt`.
- Separate desired state, observed state, archived state, dashboard state, and notification state.
- Add schema versioning and migration for existing `.codex-auto` files.

Acceptance:
- Monitor can explain why a run is active, completed, stale, or archived.
- Completed runs no longer depend on stale health snapshots.

Validation:
- State schema fixture.
- Completed-run immutability fixture.
- Old-state migration fixture.

### LR-P0-02: Lease / Generation Lock

Goal:
- Ensure only the current generation can mutate canonical run state.

Implementation:
- Add atomic lease file with ownerPid, ownerCommand, ownerStartedAt, generation, leaseExpiresAt.
- Reject stale writes by generation mismatch.
- Add lease adoption after sleep/resume grace.
- Add lock contention selftest.

Acceptance:
- Two auto-loops cannot both own the same workspace generation.
- Old generations can be displayed as history but never as current truth.

Validation:
- Lease contention fixture.
- Stale generation write rejection.
- Sleep/resume grace fixture.

### LR-P0-03: Process Truth And Zombie Reaper

Goal:
- Make process state factual, not inferred from stale files.

Implementation:
- Track coordinator, watchdog, dashboard, codex exec, worker, and child process trees separately.
- Add Windows process-tree probing with grace for transient lookup failures.
- Reap stale children only when generation and ownership prove safety.
- Record every reap action in event journal.

Acceptance:
- Zombie execs are retired.
- Active generation is not killed by stale PID cleanup.

Validation:
- Duplicate process smoke.
- Stale PID fixture.
- Child process reaping smoke.

### LR-P0-04: Event Journal Snapshot, Compaction, And Replay Budget

Goal:
- Prevent huge journals from making dashboard/monitor reads slow or misleading.

Implementation:
- Snapshot canonical state after sequence thresholds.
- Tail only events after snapshot.
- Compact old events into archive files.
- Add replay time budget and warning.

Acceptance:
- `/state` and monitor remain responsive with large journals.
- Replay never silently drops committed events.

Validation:
- 250MB journal fixture.
- Snapshot/tail consistency test.
- Corrupt tail recovery test.

### LR-P0-05: Completion And Archive Truth

Goal:
- Make completed tasks visibly complete and operationally quiet.

Implementation:
- Freeze active timers on completion.
- Mark longrunAlive/codexExecAlive false when stop reason is complete and processes are gone.
- Preserve final report and validation ledger.
- Keep dashboard available for inspection without pretending work is running.

Acceptance:
- Completed dashboard shows complete/archived, not possibly stalled.
- Monitor emits no new event for an already-acknowledged clean completion.

Validation:
- Complete-run monitor contract test.
- Final report path fixture.
- Dashboard complete visual smoke.

### LR-P0-06: Stale / Idle / Blocked Classifier

Goal:
- Stop treating every non-progress interval the same.

Implementation:
- Classify: active, slow, loop-idle, command-running, waiting-validation, blocked, external-dependency, stale, failed, complete.
- Use command activity, file changes, validation output, stdout/stderr freshness, and lease heartbeat.
- Show classification and confidence.

Acceptance:
- User can tell whether work is actually stuck or just in a long validation/decomposition step.

Validation:
- Long validation fixture.
- No-output-but-process-active fixture.
- True stale fixture.

### LR-P0-07: Failure Triage And Replan Engine

Goal:
- Convert failures into better next actions.

Implementation:
- Extend blocker taxonomy: test, build, timeout, conflict, permission, external dependency, unclear requirement, oversized task, dirty workspace, resource exhaustion.
- Generate `blocker-analysis.json` with retry policy, decomposition recommendation, and escalation target.
- Switch strategy after repeated same-kind failure.

Acceptance:
- The system stops blind retry loops.
- Oversized cards are split automatically.

Validation:
- Repeated test failure fixture.
- Oversized task split fixture.
- External dependency no-restart fixture.

### LR-P0-08: Task Complexity Scorer And Auto-Decomposition

Goal:
- Split heavy tasks before they burn too many turns.

Implementation:
- Score tasks by file count, module count, test cost, ambiguity, dependency risk, UI/backend spread, and expected validation time.
- Generate subtasks with explicit ownership, acceptance, validation, and dependency edges.
- Require decomposition when score exceeds threshold.

Acceptance:
- A large mixed frontend/backend/release task becomes smaller executable cards automatically.

Validation:
- Mixed large task decomposition fixture.
- No-overlap write scope fixture.
- Generated card acceptance completeness test.

### LR-P0-09: Dependency Graph And Write-Scope Planner

Goal:
- Know what can safely run in parallel.

Implementation:
- Add `dependencies`, `writeScope`, `readScope`, `conflictKeys`, `validationScope`, `resourceCost`, `parallelSafe`.
- Derive default scopes from paths, docs, tests, and user constraints.
- Detect overlap and serialize risky tasks.

Acceptance:
- Parallel scheduling has a concrete reason, not optimism.

Validation:
- Disjoint scope parallel fixture.
- Overlap serialization fixture.
- Dependency ordering fixture.

### LR-P0-10: Worktree Scheduler

Goal:
- Run independent tasks in isolated worktrees safely.

Implementation:
- Create disposable worktrees under a controlled directory.
- Assign branch names, owner IDs, claimed files, and validation commands.
- Cap concurrency by CPU/RAM/test budget.
- Protect dirty main workspace.

Acceptance:
- Main worktree remains safe.
- Parallel workers cannot write the same owned files.

Validation:
- Worktree create/cleanup dry run.
- Dirty main protection fixture.
- Resource budget scheduling test.

### LR-P0-11: Worker Artifact Protocol

Goal:
- Make worker outputs machine-reviewable.

Implementation:
- Each worker emits changed files, diff summary, validation evidence, skipped validation, risks, rollback notes, and merge intent.
- Artifacts are stored per worker and per run generation.

Acceptance:
- Integrator can decide merge readiness without reading raw chat logs.

Validation:
- Worker artifact schema test.
- Missing evidence rejection test.

### LR-P0-12: Merge Arbiter And Integration Queue

Goal:
- Merge parallel outputs deterministically.

Implementation:
- Queue worker branches by dependency and risk.
- Apply one merge at a time.
- Re-run impacted validation.
- Roll back failed integration without losing worker artifacts.
- Classify conflicts: auto-resolvable, strategy-switch, human decision.

Acceptance:
- Main workspace only receives validated integrated changes.

Validation:
- Two-worker merge fixture.
- Conflict rollback fixture.
- Impacted validation selection test.

### LR-P0-13: Quality Critic And Promotion Gate

Goal:
- Prevent low-evidence "done" states.

Implementation:
- Score reliability, UX, performance, safety, operability, autonomy, release risk.
- Require evidence, residual risks, validation commands, and artifact paths.
- Allow critic demotion from done to review.

Acceptance:
- Done means defensible, not merely attempted.

Validation:
- Done-without-evidence rejection.
- Critic demotion fixture.
- Scorecard update fixture.

### LR-P0-14: Fleet Telemetry Dashboard

Goal:
- Make autonomous execution visible and trustworthy.

Implementation:
- Show coordinator, workers, worktrees, active command, elapsed time, stale age, retry budget, queue depth, validation state, merge state, critic state.
- Preserve scroll and completed card visibility.
- Separate "complete", "idle", "blocked", "running", and "stale".

Acceptance:
- User does not need to ask "is it really moving?"

Validation:
- Fleet dashboard fixture.
- Scroll preservation regression.
- Dashboard-down notification contract.

### LR-P0-15: Notification And Decision Inbox

Goal:
- Notify only when useful.

Implementation:
- Notify on completion, needs attention, irreducible blocker, stale/down, or new final report.
- Suppress repeated clean completion noise.
- Create decision inbox items with recommended action and cost of waiting.

Acceptance:
- No noisy heartbeat spam; no silent critical failures.

Validation:
- Notification dedupe fixture.
- Irreducible blocker inbox fixture.

### LR-P1-01: Longrun Selftest Suite

Goal:
- Prove the control plane itself before trusting it.

Implementation:
- Add `codex-longrun-selftest.mjs` suites for lease, dashboard, monitor, snapshot, scheduler, merge, critic.
- Include fast unit fixtures and slower live smoke tests.

Acceptance:
- Longrun changes have their own CI-like gate.

Validation:
- Selftest green across all P0 modules.

### LR-P1-02: Chaos And Soak Tests

Goal:
- Prove it survives ugly reality.

Implementation:
- Kill dashboard mid-run.
- Kill coordinator.
- Simulate sleep/resume.
- Fill journal.
- Create port conflict.
- Create worker conflict.
- Create external dependency outage.
- Run multi-hour soak.

Acceptance:
- Recovery is automatic or escalation is exact.

Validation:
- Chaos report with pass/fail and residual risks.

### LR-P1-03: Security And File Safety

Goal:
- Protect the user and workspace.

Implementation:
- Restrict worktree roots.
- Validate paths and prevent traversal/UNC/system-root writes.
- Require explicit destructive-operation policy.
- Redact secrets from dashboard/report artifacts.

Acceptance:
- Automation cannot accidentally damage unrelated directories or leak secrets.

Validation:
- Path safety fixtures.
- Redaction fixture.
- Destructive command policy test.

## 5. Aelyris Requirements Integrated Into The Plan

These items are Aelyris product requirements, not longrun harness requirements. They should be executed after LR-P0 foundations are reliable, using longrun where useful.

### AETH-P0-01: Release Evidence Completion

Goal:
- Move Aelyris from "passes locally" to "safe to distribute".

Required:
- Updater key custody decision and documentation.
- Clean Windows VM install smoke for NSIS and MSI.
- Signed updater manifest verification.
- Launch, update, rollback/uninstall, and first-run smoke.

Acceptance:
- Release artifacts are reproducible and installable outside the dev machine.

### AETH-P0-02: Real PTY / AI CLI Recovery

Goal:
- Prove terminal reliability under real AI CLI and shell failures.

Required:
- Real AI CLI kill/restart test.
- stderr flood test.
- stdin paste stress.
- shell child process cleanup.
- sleep/resume with active PTY.

Acceptance:
- No orphaned shell/agent processes; UI reports recovery truth.

### AETH-P0-03: Real OS Sleep / Resume

Goal:
- Replace injected sleep tests with actual OS behavior.

Required:
- Windows sleep/resume runbook.
- Active dashboard, PTY, agent, DB, and file watcher recovery checks.
- Evidence artifact with timestamps and observed process truth.

Acceptance:
- Aelyris and longrun both recover or report exact unrecoverable state.

### AETH-P0-04: Security Boundary Audit

Goal:
- Harden all app trust boundaries.

Required:
- Tauri command input audit.
- External API audit.
- cwd/path/file operation audit.
- command approval/watchdog safety audit.
- secret redaction audit.

Acceptance:
- Critical IPC/path/command risks have tests or documented mitigations.

### AETH-P1-01: Performance Budget And Bundle Strategy

Goal:
- Make heavy project usage predictable.

Required:
- Define budgets for startup, pane switch, terminal frame rate, scrollback memory, agent log growth, IPC latency, dashboard refresh.
- Split or lazy-load Monaco/Vim heavy chunks where practical.
- Test large repo and huge log scenarios.

Acceptance:
- Performance observatory data backs the budget.

### AETH-P1-02: UX Truth And Recovery Polish

Goal:
- Remove ambiguity from user-facing states.

Required:
- Agent status truth.
- Terminal recovery states.
- Git stale/failure states.
- Dashboard/card completion states.
- Error boundary recovery copy.

Acceptance:
- The user can understand every stuck/failed/recovered state without reading logs.

### AETH-P1-03: Accessibility And Keyboard Completion

Goal:
- Make the workstation controllable without mouse and resilient to accessibility modes.

Required:
- Full command palette and right-rail keyboard matrix.
- Dialog focus traps and restore.
- Screen-reader labels on tab/panel state.
- Forced colors and reduced motion validation.

Acceptance:
- Core workflows pass keyboard-only and accessibility smoke.

### AETH-P1-04: Data Durability And DB Recovery

Goal:
- Avoid data loss and bad state after crash.

Required:
- DB lock/write-failure tests.
- Session restore tests.
- command history/session history integrity.
- file watcher and event store recovery.

Acceptance:
- Crash/restart leaves recoverable state and truthful UI.

### AETH-P2-01: Native Window Material Strategy

Goal:
- Decide whether current Tauri Mica/Acrylic is enough or whether deeper native Rust window work is valuable.

Required:
- Document current Tauri transparency limits.
- Prototype full-native Rust/DWM window if there is a product reason.
- Compare text contrast, GPU surface behavior, WebView2 interaction, and OS support.

Acceptance:
- Clear decision: stay Tauri material, improve current implementation, or build native shell experiment.

### AETH-P2-02: Documentation And Support Readiness

Goal:
- Make failures supportable.

Required:
- Diagnostic export.
- Troubleshooting guide.
- Release playbook.
- Known risk register.
- First-run and recovery runbooks.

Acceptance:
- A user or future agent can diagnose common failures without reconstructing history from chat.

## 6. Execution Order

### Gate G0: Freeze Current Truth

Do first:
- Record current Aelyris state, dirty files, final report, and dashboard truth.
- Keep Aelyris 36-card roadmap marked complete.
- Do not re-open completed Aelyris cards unless new validation contradicts evidence.

### Gate G1: Longrun Truth Kernel

Implement:
- LR-P0-01 through LR-P0-05.

Exit criteria:
- No stale dashboard/runner truth.
- Huge journal no longer hurts responsiveness.
- Completion state is immutable and quiet.

### Gate G2: Longrun No-Stall Autonomy

Implement:
- LR-P0-06 through LR-P0-08.

Exit criteria:
- Slow vs stuck vs blocked is classified.
- Oversized tasks are decomposed automatically.
- Repeated failures switch strategy or escalate clearly.

### Gate G3: Safe Parallelism

Implement:
- LR-P0-09 through LR-P0-12.

Exit criteria:
- Worktree parallelism is available only for safe independent work.
- Merge queue validates and rolls back correctly.

### Gate G4: Promotion Quality

Implement:
- LR-P0-13 through LR-P0-15.

Exit criteria:
- Cards cannot be done without evidence.
- Dashboard shows fleet truth.
- Notifications are useful and deduped.

### Gate G5: Longrun Proven Under Stress

Implement:
- LR-P1-01 through LR-P1-03.

Exit criteria:
- Selftest and chaos suite pass.
- Security/file safety fixtures pass.
- Multi-hour soak produces final report without false stalls.

### Gate G6: Aelyris 10-Point Evidence

Implement:
- AETH-P0-01 through AETH-P0-04.

Exit criteria:
- Clean release evidence exists.
- Real PTY/AI CLI and real OS sleep/resume are proven.
- Critical trust boundaries are audited.

### Gate G7: Aelyris Wizard S+++ Polish

Implement:
- AETH-P1-01 through AETH-P2-02.

Exit criteria:
- Performance budgets are backed by measurement.
- UX states are clear.
- Accessibility and docs are supportable.
- Native material strategy is explicitly decided.

## 7. Done Definition For Wizard S+++

The combined system reaches Wizard S+++ only when:

- Longrun can run a large task for hours without silent stalls.
- Heavy work is decomposed before it wastes turns.
- Parallel work is isolated, merged, validated, and rollback-safe.
- Every completion has evidence.
- Every blocker has a typed reason and next action.
- Dashboard truth matches process truth, archive truth, and final report truth.
- Aelyris passes local test/build, release smoke, real PTY recovery, real sleep/resume, security audit, performance budget, and UX/a11y smoke.
- Remaining risks are either eliminated or explicitly accepted with severity, owner, and mitigation.

## 8. First Implementation Batch

Recommended first batch:

1. LR-P0-01 Run Registry v2 And State Schema
2. LR-P0-02 Lease / Generation Lock
3. LR-P0-03 Process Truth And Zombie Reaper
4. LR-P0-04 Event Journal Snapshot, Compaction, And Replay Budget
5. LR-P0-05 Completion And Archive Truth

Reason:
- These remove the root cause behind "止まって見える", stale dashboards, duplicate ownership, and false process truth.
- Parallelism should wait until ownership and completion truth are impossible to confuse.

Progress on 2026-05-06:
- Started G1 implementation.
- Added run identity propagation for new longrun starts: `runId`, `generation`, `threadId`, and `current-run-state.json`.
- Strengthened auto-loop leases with `runId`, `threadId`, `leaseOwnerPid`, `leaseExpiresAt`, generation checks, and stale-generation progress write rejection.
- Added run identity to current progress, current child, watchdog health, and watchdog progress merges.
- Improved event journal replay so a usable snapshot can be combined with post-snapshot tail events instead of falling back to tail-only reconstruction.
- Improved monitor dashboard PID truth so an alive restarted dashboard is preferred over stale health-file PIDs.
- Restarted the Aelyris dashboard on `http://127.0.0.1:48371/` with the updated progress server.
- Validation passed: `node <codex-home>\codex-longrun-selftest.mjs`.

G1 second pass on 2026-05-06:
- Made run identity matching strict once `current-longrun.json` has `runId` or `generation`; legacy or stale `complete` artifacts can no longer complete a newer run by omission.
- Added stale completion protection across watchdog, dashboard `/state`, monitor, event-journal replay, and final-report archive reuse.
- Added watchdog migration for pre-G1 legacy runs so `current-longrun.json`, `current-progress.json`, `current-health.json`, `final-report.json`, `current-run-state.json`, and `longrun-run-registry.json` can be aligned under one generated legacy `runId`.
- Added run-state registry updates on watchdog restart, live-run adoption, and terminal archive.
- Exposed `/state.runIdentity` and `/state.wizardControl` so the dashboard can show control-plane truth directly.
- Added selftests for stale completion identity rejection, run-scoped event replay, stale final-report rejection, and restart registry agreement.
- Migrated the current Aelyris completed run to `runId=longrun-Aelyris-legacy-2026-05-06T01-50-47-599Z-38576-b502a01b`, `generation=1`.
- Restarted the dashboard again on `http://127.0.0.1:48371/` with server PID `37812`.
- Validation passed again: `node <codex-home>\codex-longrun-selftest.mjs`; monitor reports `complete / finished`, `36/36`, `eventCount 0`, `dashboardAlive true`, `staleCompletionArtifact false`.

G2 first pass on 2026-05-06:
- Added `codex-task-planning.mjs` as the shared planning/classification helper for task complexity scoring, write-scope planning, failure triage metadata, and run liveness classification.
- Added roadmap/queue enrichment with `complexityScore`, `complexityBand`, `requiresDecomposition`, `writeScope`, `readScope`, `validationScope`, `conflictKeys`, `resourceCost`, and `parallelSafe`.
- Added pre-turn complexity preflight. High-complexity active roadmap cards are decomposed before a full Codex turn is spent, and decision/blocker artifacts record the reason and child task IDs.
- Added write-scope constraints to the Codex turn prompt and to `current-progress.json` / `current-child.json`, so future worktree scheduling has an explicit ownership contract.
- Added failure triage metadata to `blocker-analysis.json` and decision logs, including repeated-kind detection, root cause, complexity context, strategy, and replan action.
- Added watchdog liveness classification across `current-health.json`, `current-progress.json`, dashboard `/state`, and monitor output. Classes now include `complete`, `command-running`, `waiting-validation`, `loop-idle`, `slow`, `blocked`, `external-dependency`, `stale`, and `failed`.
- Updated dashboard display quality with a visible liveness line plus complexity/write-scope cards, and updated monitor JSON/text output with liveness and planning fields.
- Restarted the dashboard on `http://127.0.0.1:48371/` with server PID `37664`.
- Validation passed: `node --check` for changed `.codex` scripts and `node <codex-home>\codex-longrun-selftest.mjs`.
- Live verification passed: dashboard `/health` ok, `/state` reports `complete`, `terminal=true`, `liveness=complete`, `36/36`, `staleCompletionArtifact=false`, dashboard PID `37664`; monitor reports `eventCount 0`.

G3 first pass on 2026-05-06:
- Added `codex-worktree-scheduler.mjs` as the shared dry-run scheduler and merge gate helper.
- Added scheduler primitives for normalized conflict keys, resource units, dependencies, runnable status, dirty-main serialization, and worker lane selection.
- Added worker artifact protocol helpers: `createWorkerArtifact`, `validateWorkerArtifact`, and required evidence checks for task id, worker id, changed files or no-change reason, validation or classified skipped validation, merge intent, and rollback guidance warnings.
- Added merge arbiter dry-run logic. Valid worker artifacts enter ordered merge review; overlapping files/conflict keys are serialized; invalid artifacts move the gate to attention.
- Wired auto-loop to write `worktree-schedule.json`, `worker-artifacts.json`, and `merge-queue.json`, and to include `parallelSchedule` / `mergeQueue` in current progress, current child, and Codex turn prompts.
- Wired dashboard and `/state` to show parallel lanes, waiting/blocked reasons, worker artifact counts, and merge gate status.
- Wired monitor JSON/text output to include parallel schedule and merge queue truth, with a warning event when rejected worker artifacts require attention.
- Hardened the single-writer lease check exposed by selftest: a fresh live lease now blocks duplicate auto-loop acquisition even when Windows process command-line introspection is unavailable.
- Restarted the dashboard on `http://127.0.0.1:48371/` with server PID `24480`.
- Validation passed: `node --check` for changed `.codex` scripts and `node <codex-home>\codex-longrun-selftest.mjs`.
- Live verification passed: dashboard `/health` ok, `/state` reports `complete`, `terminal=true`, `liveness=complete`, `36/36`, `parallel selected=0`, `waiting=0`, `merge gate=idle`, dashboard PID `24480`; monitor reports `eventCount 0`, `dashboardAlive true`, and parallel schedule visible.

G4 first pass on 2026-05-06:
- Added `codex-quality-promotion.mjs` as the shared quality critic and promotion gate helper.
- Added promotion gate checks for done-card evidence, acceptance criteria, required validation, validation ledger matches, open severe risks, worker artifact validity, worker scope violations, and merge gate attention.
- Promotion gate now produces `promotion-gate.json` with status, score, blockers, warnings, roadmap evidence detail, risk detail, worker artifact critic detail, and merge critic detail.
- Wired auto-loop so future `roadmapComplete` requires both roadmap quality and `readyForPromotion=true`; final/current progress and current child now carry promotion gate state.
- Wired dashboard and `/state` to show promotion status, score, blockers, warnings, item-level details, worker artifact critic state, and merge critic state.
- Wired monitor JSON/text output to include promotion gate status and score, with warning events for blocked active runs.
- Restarted the dashboard on `http://127.0.0.1:48371/` with server PID `14792`.
- Validation passed: `node --check` for changed `.codex` scripts and `node <codex-home>\codex-longrun-selftest.mjs`.
- Live verification passed: dashboard `/health` ok, `/state` reports `complete`, `terminal=true`, `liveness=complete`, `36/36`, `promotionStatus=blocked`, `promotionScore=42`, blocker `open-high-or-critical-risk`, dashboard PID `14792`; monitor reports `eventCount 0` because the run is already archived complete.

G5 first pass on 2026-05-06:
- Added `codex-fleet-telemetry.mjs` as the shared telemetry and decision-inbox helper.
- Added `.codex-auto/fleet-telemetry.json` and `.codex-auto/decision-inbox.json`.
- Fleet telemetry now summarizes workspace health, process truth, dashboard truth, roadmap counts, parallel scheduler status, merge gate, promotion gate, risk pressure, and a fleet grade.
- Decision inbox now deduplicates actionable items from promotion gate blockers, merge gate attention, liveness failures, blocker analysis, high/critical risks, dirty-main serialization, and warning/error notifications.
- Wired auto-loop to refresh fleet and decision artifacts at no-runnable, turn preflight, turn completed, and final-report transitions.
- Wired dashboard cards, Fleet Telemetry section, Decision Inbox section, `/state.fleetTelemetry`, `/state.decisionInbox`, and fleet/decision counts.
- Wired monitor JSON/text output to include fleet grade/level and decision-inbox status, with warning events for open inbox items on active non-terminal runs.
- Restarted the dashboard on `http://127.0.0.1:48371/` with server PID `39320`.
- Validation passed: `node --check` for changed `.codex` scripts and `node <codex-home>\codex-longrun-selftest.mjs`.
- Browser verification passed: the dashboard at `http://127.0.0.1:48371/` renders Fleet Telemetry, Decision Inbox, Promotion Gate, and Wizard S grade text.
- Live state now reports `complete`, `terminal=true`, `36/36`, fleet `yellow/Wizard S`, `decisionInboxOpen=9`, `decisionInboxHuman=0`, `promotionStatus=blocked`, `promotionScore=42`.
- Current gap: fleet is workspace-local by default; true multi-workspace global fleet artifact and Decision-vs-Attention separation remain the next step before guarded live worker execution.

## 9. Second Implementation Batch

Recommended second batch:

1. LR-P0-06 Stale / Idle / Blocked Classifier
2. LR-P0-07 Failure Triage And Replan Engine
3. LR-P0-08 Task Complexity Scorer And Auto-Decomposition
4. LR-P0-09 Dependency Graph And Write-Scope Planner

Reason:
- These make the system decide whether to continue, split, retry, or escalate.
- This directly addresses long tasks that only increase turn count without meaningful progress.

## 10. Third Implementation Batch

Recommended third batch:

1. LR-P0-10 Worktree Scheduler
2. LR-P0-11 Worker Artifact Protocol
3. LR-P0-12 Merge Arbiter And Integration Queue
4. LR-P0-13 Quality Critic And Promotion Gate

Reason:
- These provide safe parallelism and prevent low-quality automatic merges.

## 11. Fourth Implementation Batch

Recommended fourth batch:

1. LR-P0-14 Fleet Telemetry Dashboard
2. LR-P0-15 Notification And Decision Inbox
3. LR-P1-01 Longrun Selftest Suite
4. LR-P1-02 Chaos And Soak Tests
5. LR-P1-03 Security And File Safety

Reason:
- These prove the longrun control plane is operationally reliable.

## 12. Aelyris Final Batch

Recommended after longrun is stable:

1. AETH-P0-01 Release Evidence Completion
2. AETH-P0-02 Real PTY / AI CLI Recovery
3. AETH-P0-03 Real OS Sleep / Resume
4. AETH-P0-04 Security Boundary Audit
5. AETH-P1-01 Performance Budget And Bundle Strategy
6. AETH-P1-02 UX Truth And Recovery Polish
7. AETH-P1-03 Accessibility And Keyboard Completion
8. AETH-P1-04 Data Durability And DB Recovery
9. AETH-P2-01 Native Window Material Strategy
10. AETH-P2-02 Documentation And Support Readiness

## 13. Recommended Product Decision

Implement longrun full autonomy as an external control-plane first.

After it is proven, decide whether to productize a subset inside Aelyris:

- If Aelyris is a terminal/editor/workstation only, keep longrun external.
- If Aelyris is meant to be an autonomous AI engineering cockpit, productize the scheduler, worker graph, merge queue, critic gate, and truth dashboard inside Aelyris.

Do not productize it until the external harness has passed G1-G5. Otherwise Aelyris inherits the same reliability problems inside the product.

## 14. G6 Completion Update

Status on 2026-05-06:

- G6 has been implemented for the external longrun control plane.
- Global fleet artifacts now exist under `<codex-home>`: `longrun-fleet-telemetry.json`, `longrun-decision-inbox.json`, and `longrun-attention-inbox.json`.
- Workspace-local artifacts now include `.codex-auto/fleet-telemetry.json`, `.codex-auto/decision-inbox.json`, and `.codex-auto/attention-inbox.json`.
- `Decision Inbox` now means true human-required decisions only.
- `Attention Inbox` now holds self-healable operational work such as promotion blockers, dirty-main serialization, open risk pressure, and follow-up warnings.
- Guarded live parallel worker execution is available through `<codex-home>\codex-parallel-workers.mjs`.
- The worker executor can create isolated git worktrees, run bounded Codex worker turns, emit worker artifacts, and rebuild the merge queue. It does not auto-merge by default.
- Dashboard, workspace monitor, global monitor, auto-loop, and selftest have been updated to use the new fleet/decision/attention split.

Validated commands:

- `node --check <codex-home>\codex-fleet-telemetry.mjs`
- `node --check <codex-home>\codex-auto-loop.mjs`
- `node --check <codex-home>\codex-progress-server.mjs`
- `node --check <codex-home>\codex-longrun-monitor.mjs`
- `node --check <codex-home>\codex-longrun-global-monitor.mjs`
- `node --check <codex-home>\codex-parallel-workers.mjs`
- `node --check <codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-parallel-workers.mjs --workspace <repo> --max-workers 2`
- `node <codex-home>\codex-longrun-global-monitor.mjs --once --interval-seconds 10`

Current Aelyris result:

- Dashboard: `http://127.0.0.1:48371/`
- Roadmap: `36/36` complete.
- Longrun status: `complete / finished`.
- Monitor events: `0`.
- Dashboard health: alive.
- Fleet grade: `Wizard S`.
- Fleet level: `yellow`.
- Human decisions: `0`.
- Self-healable attention items: `9`, max severity `warning`.
- Promotion gate: blocked, score `42`.

Why this is not yet Wizard S+++:

- Aelyris still has open high/critical risks in the existing risk register.
- The Aelyris main worktree is dirty, so live worker fan-out is intentionally guarded off.
- The current schedule has no selected `worktree-candidate` tasks, so there is nothing safe to launch in parallel yet.
- Automatic worker merge remains gated by worker artifact validation, merge queue review, and promotion readiness.

Required final step before ultra-fast autonomous Aelyris implementation:

1. Classify the dirty Aelyris worktree into accepted changes, temporary parking, or rollback candidates.
2. Establish a clean or deliberately snapshotted baseline.
3. Close, mitigate, or explicitly accept the remaining high/critical risks.
4. Rebuild the schedule so worktree-safe tasks become `worktree-candidate` lanes.
5. Arm `wizard-control.liveParallelWorkers`.
6. Allow guarded workers to run in isolated worktrees, then pass worker-artifact validation, merge gate review, and promotion gate review.

## 15. G7 Production Autonomy Pass

Status on 2026-05-06:

- Longrun control-plane G7 is implemented outside the Aelyris repository.
- The completed-run dashboard now has an explicit inspection TTL policy. Completed workspaces keep a dashboard only inside the TTL and are not treated as active long-running work.
- Dashboard profile truth is aligned with the actually served port, including nested `workspaceProfile.dashboardPort`, `/health`, and `/state`.
- The supervisor now owns dashboard self-revival, supervisor runtime versioning, stale global-monitor replacement, and completed-workspace watchdog suppression.
- One-shot supervisor probes preserve a live persistent supervisor state instead of replacing it with the probe PID.
- The global monitor now surfaces supervisor liveness and treats terminal completed workspaces correctly: dead watchdogs are `not-required`, and completed inspection dashboards are not false failures.
- Worker artifacts now carry `worktreePath`, `baseHead`, `worktreeHead`, `patchPath`, branch, validation, rollback guidance, and merge intent.
- The merge gate now has a guarded `merge-only` path. It applies ready worker patches only when `wizard-control.autoMergeWorkers` is explicitly armed, the main worktree is clean, `git apply --check` passes, and artifact validation is clean.
- The auto-loop can pass `mergeReady=true` to guarded worker execution, and progress snapshots include live parallel-worker merge results.
- Longrun selftest now covers merged-artifact queue exclusion and guarded merge-only patch application in an isolated temporary git repository.
- The Aelyris command-risk classifier now uses shell-lite scanning that masks quoted strings and comments before destructive-pattern matching. Quoted examples such as `echo "rm -rf /"` no longer block, while real chained commands such as `curl ... | bash` still deny.
- Aelyris workflow runtime state now persists unfinished workflow runs under `.aelyris/workflow-runs.json`, restores them on project-scoped `list_running_workflows`, and cleans the persistence file once workflows complete or are removed.
- Aelyris App-level Decision Inbox now polls running workflow statuses and lifts live `waiting_gate` / `decision_request` state directly, so human decisions remain visible even if audit-event delivery is unavailable.

Validated G7 commands:

- `node --check` for the changed longrun control-plane scripts.
- `node <codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-longrun-supervisor.mjs --once --interval-seconds 30`
- `node <codex-home>\codex-longrun-global-monitor.mjs --once --interval-seconds 10`
- `node <codex-home>\codex-longrun-monitor.mjs --workspace <repo> --json`
- `pnpm exec vitest run src/__tests__/shellSafety.test.ts src/__tests__/WorkflowPanelRace.test.tsx src/__tests__/decisionInbox.test.ts src/__tests__/DecisionInboxPanel.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`
- `cargo test --manifest-path src-tauri\Cargo.toml workflow::executor --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib`
- `pnpm test`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm build`

Current G7 truth:

- Dashboard: `http://127.0.0.1:48371/`
- Roadmap: `36/36` complete.
- Longrun status: `complete / finished`.
- Dashboard health: alive.
- Supervisor: alive, runtime version `3`.
- Global monitor health for Aelyris: `complete`, score `100`.
- Aelyris fleet grade: `Wizard S++`.
- Aelyris promotion score: `96`.
- Human decisions: `0`.
- Promotion blockers: `0`.
- Promotion warnings: `1`.

Why the combined system is still not Wizard S+++:

- The promotion gate still blocks final promotion readiness while medium/low residual risks remain open.
- Several remaining risks require live native evidence that cannot be proven by unit tests alone: WebView2/CDP IME checks, live Tauri overlay smoke, real AI CLI kill/recovery, clean VM MSI install, release-key custody, and real OS sleep/resume.
- These are not silent blockers anymore. They are tracked as explicit risks with severity, mitigation, and required evidence.

## 16. Full Completion Plan From Here

Priority order:

1. LR-P0-A Production Supervisor Soak
   - Keep supervisor runtime versioned.
   - Verify dashboard TTL expiry on a completed workspace.
   - Verify completed workspaces do not restart watchdogs.
   - Verify global monitor restarts itself and surfaces supervisor liveness.
   - Exit condition: no false `dashboard-down`, `possibly-stalled`, or `loop-idle` alarms for terminal completed runs.

2. LR-P0-B Guarded Parallel Merge Promotion
   - Keep worker auto-merge disabled unless `wizard-control.autoMergeWorkers` is armed.
   - Require clean main worktree, valid worker artifacts, patch check, merge queue review, rollback guidance, and promotion-gate re-evaluation after merge.
   - Exit condition: isolated worker patch can merge in selftest and rejected/conflicting patches never mutate main.

3. LR-P0-C Longrun Quality Evidence Lock
   - Require final report, validation ledger, risk register, promotion gate, fleet telemetry, decision inbox, attention inbox, supervisor state, and monitor state to agree before a run can call itself complete.
   - Exit condition: no completion artifact is accepted without matching run identity and generation.

4. AETH-P0-A Live Native Evidence Pack
   - Run live Tauri/WebView2 CDP IME verification.
   - Run live overlay/window-material smoke.
   - Run real AI CLI process kill/recovery.
   - Run real OS sleep/resume.
   - Run clean VM MSI install/uninstall and updater manifest verification.
   - Exit condition: all medium-high/medium live-environment risks become mitigated or explicitly accepted.

5. AETH-P0-B Runtime Safety And Recovery
   - Keep shell command risk scanning shell-aware enough to avoid quoted/comment false positives while preserving chained destructive detection.
   - Persist resumable workflow state and restore it after app restart.
   - Keep workflow decisions visible in App-level Decision Inbox without relying only on audit events.
   - Exit condition: focused Rust and frontend tests pass, then full `pnpm test`, `pnpm build`, and `cargo test` pass.

6. AETH-P1-A Performance And UX Promotion
   - Re-run dashboard visual matrix.
   - Re-run TypeScript noEmit.
   - Re-run performance/terminal flood smoke.
   - Confirm no layout overlap, duplicate dashboard keys, stale progress timers, or false active-run displays.
   - Exit condition: promotion gate score reaches 100 or every remaining item has explicit accepted-risk documentation.

7. Final Wizard S+++ Gate
   - Open severe risks: `0`.
   - Open unaccepted medium risks: `0`.
   - Promotion blockers: `0`.
   - Promotion warnings: `0` or formally accepted by release owner.
   - Fleet grade: `Wizard S+++`.
   - Dashboard/process/archive/final-report truth all agree.
