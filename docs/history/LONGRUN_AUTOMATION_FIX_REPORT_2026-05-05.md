# Longrun Automation Fix Report - 2026-05-05

Scope: `<codex-home>` longrun automation.

## Implemented Fixes

### Completion lifecycle

- Completed runs now carry terminal fields:
  - `terminal`
  - `completedAt`
  - `completedDurationMs`
- Watchdog no longer restarts dashboards after implementation completion.
- Watchdog exits into terminal archive mode after writing the final complete health/progress snapshot.
- Dashboard freezes elapsed time after terminal completion and stops interval refresh once a run is complete.

### Dashboard health and PID truth

- Dashboard metadata now distinguishes:
  - `launcherPid`
  - `serverPid`
  - `servedDashboardPid`
- `codex-progress-server.mjs` writes its actual serving PID back into `current-dashboard.json`.
- Watchdog validates dashboard health by `/health` plus workspace identity, not only `process.kill(pid, 0)`.
- Live canonical dashboard was restored to `http://127.0.0.1:48371/`.

### Final report surfacing

- `/state` now exposes top-level `finalReport`.
- `/state` now exposes top-level `terminal`.
- Placeholder `final-report.md` is treated as provisional, not as a real final report.
- Real final reports require durable `final-report.json` with `finalStatus`.

### Monitor correctness

- Monitor now uses `isBlockingAnalysis(blockerAnalysis)` instead of object truthiness.
- `not_blocked` blocker-analysis no longer suppresses `longrun-down` or produces fake `blocked-stopped` events.
- Completed runs suppress noisy dashboard-down events.

### Auto-loop resilience

- Timeout-after-success reconciliation was added.
- If a child process exits non-zero after already marking the active roadmap card done, the loop does not create a false blocker or surprise decomposition.
- Final report writing no longer mutates the decomposition queue by promoting a pending item to `doing`.

## Validation

- `node --check` passed for:
  - `<codex-home>\codex-progress-server.mjs`
  - `<codex-home>\codex-longrun-watchdog.mjs`
  - `<codex-home>\codex-longrun-monitor.mjs`
  - `<codex-home>\codex-auto-loop.mjs`
  - `<codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-longrun-selftest.mjs` passed.
- Live `/health` passed at `http://127.0.0.1:48371/health`.
- Live `/state` passed at `http://127.0.0.1:48371/state`.
- Live `/state` response time observed: about `89ms`.
- Live dashboard canonical state:
  - `isStaleDashboard=false`
  - `canonicalDashboardPid=34276`
  - `canonicalDashboardServerPid=34276`
  - `dashboardAlive=true`
  - `active=P0-09`
  - `done=8/36`

## Review Findings After Fix

- No syntax issues found.
- Regression selftest passed after adding coverage for:
  - complete no-dead-active
  - complete dashboard no-restart
  - final report dashboard/state surfacing
  - notification fallback persistence
  - `not_blocked` monitor behavior
  - timeout-after-success reconciliation guard
- Live dashboard no longer points to the accidental `48372` canonical URL.

## Remaining Risks

- The active 9.8 longrun is still running on `P0-09 No surprise task lineage`; this fix does not complete the full 36-card roadmap.
- The longrun parent PID is still a hidden-runner wrapper. Dashboard health now records server PID correctly, but worker-process identity for the auto-loop can still be improved further with child PID discovery.
- Duplicate dashboards for unrelated/global workspaces may still exist outside this Aether workspace. This pass fixed this workspace's canonical dashboard and added stronger primitives, but a global cleanup command/registry lock should still be added.
- `/state` is fast in the live smoke, but a future hard latency-budget selftest with very large logs would make the performance guarantee stronger.
