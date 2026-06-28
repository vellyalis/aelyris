# AI Workstation Strict Audit - 2026-05-06

## Executive Score

| Area | Score | Grade | Judgment |
| --- | ---: | --- | --- |
| Product implementation | 9.05 / 10 | A- | Full frontend/Rust/build validation passed after fixes. Not yet 9.8 because release-environment and autonomous-ops evidence is still incomplete. |
| 36-card 9.8 roadmap | 9.35 / 10 | A | Roadmap is complete: 36 / 36. Validation is strong, with remaining risk in real-world release and autonomous operations. |
| Runtime reliability | 8.95 / 10 | A- | Corruption, stale state, telemetry growth, cwd trust, and headless-agent lifecycle defects were fixed. |
| Frontend UX / state safety | 8.90 / 10 | A- | Crash-on-corrupt-localStorage and stale Git status were fixed. Some workflow edge cases remain for deeper manual UX audit. |
| Backend safety / lifecycle | 8.80 / 10 | B+ | API cwd validation and headless-agent stderr/reap behavior were hardened. PTY process-tree kill evidence still needs real-shell stress validation. |
| Longrun autonomous operations | 7.60 / 10 | B | Dashboard truth and complete-run behavior were improved. P0-16 through P0-21 autonomy extension is not fully implemented. |
| Release readiness | 8.40 / 10 | B+ | All local gates pass. Clean-machine install/update, signed release, and long soak tests remain. |

## Current Truth

- Active workspace: `<repo>`
- Dashboard: `http://127.0.0.1:48371/`
- 9.8 roadmap: complete, 36 / 36 cards done
- Longrun runner: complete / finished
- Active card: none
- Blocker: none in the completed 36-card roadmap
- Dashboard process: alive
- Longrun process: not alive because the run is complete
- Latest monitor result: eventCount 0, staleSeconds 0, restartCount 0
- Final report: `<repo>\.codex-auto\final-report.md`

## Fixes Applied In This Audit Pass

### P1: frontend crash on corrupted persisted state

Files:
- `src/shared/store/appStore.ts`

Result:
- Added safe JSON loading and shape validation for persisted `agentBudget`, `kanbanTasks`, and `openFiles`.
- Corrupted `localStorage` no longer crashes app initialization.
- Invalid persisted values now fall back to sane defaults.

### P1: agent telemetry unbounded growth

Files:
- `src/shared/hooks/useAgentManager.ts`

Result:
- Added per-session caps for live logs and file details.
- Added debounced telemetry persistence to reduce backend/localStorage write pressure.
- Prevents long-running agents from growing memory and write volume without bound.

### P2: stale Git status after workspace loss or command failure

Files:
- `src/shared/hooks/useGitStatus.ts`

Result:
- Added reset behavior when repo path disappears, Tauri is unavailable, or Git status command fails.
- Normalized watcher path comparisons across Windows slash/case differences.
- Prevents old branch/dirty state from remaining visible as false truth.

### P2: safe PowerShell read-only paste classification

Files:
- `src/shared/lib/shellSafety.ts`
- `src/features/terminal/IMEInputBar.tsx`

Result:
- Classified `Get-Location` as read-only.
- Improved paste handler timing for the IME input bar.
- Fixed the regression where a harmless location query could be routed through confirmation/blocking behavior in tests.

### P1: external API cwd trust boundary

Files:
- `src-tauri/src/api/mod.rs`

Result:
- Added cwd normalization and validation for the external API session-creation path.
- Blocks traversal, NUL bytes, UNC paths, non-existing paths, non-directories, inaccessible paths, and dangerous system roots.
- Added Rust unit coverage for allowed and blocked cwd inputs.

### P1: headless agent stderr and process lifecycle

Files:
- `src-tauri/src/ipc/commands.rs`
- `src-tauri/src/agent/claude.rs`

Result:
- Drains headless-agent stderr so child processes cannot block on stderr backpressure.
- Emits bounded stderr snippets into agent output/log flow.
- Reaps naturally exited sessions to remove stale child handles while keeping session metadata visible.

### P0/P1: longrun dashboard truth and huge-journal responsiveness

Files:
- `<codex-home>\codex-event-journal.mjs`
- `<codex-home>\codex-longrun-monitor.mjs`
- `<codex-home>\codex-progress-server.mjs`

Result:
- Added snapshot fast path for event-journal replay to avoid replaying the huge journal on every read.
- Fixed complete-run truth: completed runs no longer appear as a live/stalled process just because archived health had stale PIDs.
- Dashboard now presents completed runs as `Complete` / `Archived` instead of implying the runner is still active.
- Monitor now returns zero events for the completed healthy run.

## Validation Evidence

| Gate | Result |
| --- | --- |
| Frontend tests | PASS: 157 files, 1387 tests |
| Targeted terminal paste test | PASS: 15 / 15 |
| Rust API tests | PASS: 14 / 14 |
| Rust full test suite | PASS: lib 541 tests plus integration suites |
| Production frontend build | PASS |
| Longrun monitor | PASS: complete, finished, 36 / 36, eventCount 0 |
| Dashboard HTTP check | PASS: `/state`, `/fragment`, and `/health` respond successfully |

Known build warnings:
- Vite chunk-size warnings remain, especially Monaco/Vim related bundles.
- Some dynamic/static import warning noise remains for Tauri API imports.

## Remaining Bugs / Risks To Eliminate Next

### P0-16: lease / generation lock and zombie reaping

Status: partial.

Risk:
- Existing lock/lease evidence is not yet strong enough for fully autonomous operation.
- Lease identity still needs stronger run/thread/generation ownership semantics.

Required:
- Add runId, threadId, ownerPid, generation, and leaseExpiresAt to every longrun lease.
- Reject stale writes by generation.
- Reap zombie workers by lease expiry and process truth, not by dashboard text.

### P0-17: parallel worktree scheduler

Status: missing.

Risk:
- Heavy tasks are not yet automatically split into isolated worktrees with safe ownership boundaries.
- This is why the system can spend too many turns on a single large card.

Required:
- Add a scheduler that decomposes large tasks into independent file/module ownership scopes.
- Create disposable worktrees automatically when needed.
- Track worker state, claimed paths, and merge readiness per shard.

### P0-18: failure triage / automatic redesign

Status: partial.

Risk:
- Failures can be detected, but automatic redesign is still shallow.

Required:
- Classify failures into test, build, timeout, conflict, stale, blocked-by-permission, and unclear-requirement.
- Generate a revised plan automatically after repeated failed attempts.
- Escalate only when local redesign cannot produce a safe next action.

### P0-19: parallel merge gate / conflict arbiter

Status: missing.

Risk:
- Parallel implementation without an arbiter can create merge conflicts or false conflicts.

Required:
- Require per-worker ownership manifests.
- Run test/build gates before promotion.
- Merge in priority order with automatic conflict summaries and retry routing.

### P0-20: fleet telemetry / truth dashboard

Status: partial, improved in this audit pass.

Risk:
- Dashboard truth is now better for complete runs, but fleet-level worker truth is incomplete.

Required:
- Separate desired state, observed process state, archive state, and dashboard state.
- Add latency, stale, restart, worker, and validation counters as first-class metrics.
- Keep completed dashboards static except for manual refresh/inspection.

### P0-21: quality critic / promotion gate

Status: partial.

Risk:
- Validation is strong locally, but promotion policy is not yet strict enough for fully autonomous high-quality merges.

Required:
- Add independent critic pass per shard.
- Block promotion on missing tests, unexplained skipped validation, changed public contracts, or unresolved audit findings.
- Produce machine-readable final evidence for every promoted card.

## Full-Native Rust Transparency Feasibility

Full-native Rust can support translucent windows on Windows.

Practical approaches:
- Win32/DWM via the `windows` crate.
- `winit` / `tao` window handles plus DWM attributes.
- `window-vibrancy` style wrappers for Mica, Acrylic, blur, and transparent backdrops.
- Native Rust UI layers such as egui/wgpu, Slint, or Iced can render over transparent or blurred windows when the window/compositor setup supports it.

Caveats:
- Mica is a system backdrop material, not arbitrary per-pixel opacity.
- Win11 Mica and Win10 Acrylic/blur behave differently.
- GPU surfaces, terminal text, and editor surfaces need explicit contrast handling.
- A full-native rewrite can do translucency, but it does not automatically make terminal/editor rendering easier than the current Tauri/WebView route.

## Current Grade Judgment

The system is currently in the low 9 range as an application implementation, not yet 9.8 as a fully autonomous workstation.

The completed 36-card implementation is credible and validated, but the longrun automation layer is still the main gap. To honestly call it fully autonomous, P0-16 through P0-21 need to move from partial/missing to implemented, tested, and proven under multi-worker failure and recovery scenarios.
