# Longrun Automation Bug Audit - 2026-05-05

Scope: `C:\Users\owner\.codex` longrun automation and this workspace's `.codex-auto` artifacts.

This is not primarily an Aether Terminal app bug. The next small bugs to crush are in the Codex longrun stack:

- `C:\Users\owner\.codex\codex-auto-loop.mjs`
- `C:\Users\owner\.codex\codex-longrun-watchdog.mjs`
- `C:\Users\owner\.codex\codex-longrun-monitor.mjs`
- `C:\Users\owner\.codex\codex-progress-server.mjs`
- `C:\Users\owner\.codex\codex-blocker-taxonomy.mjs`
- `C:\Users\owner\Aether_Terminal\.codex-auto\*`

## Current Aether Longrun Snapshot

- Workspace: `C:\Users\owner\Aether_Terminal`
- Dashboard: `http://127.0.0.1:48371/`
- Longrun status: `running`
- Active card: `P0-08 Final report and notification fallback surfacing`
- Roadmap: `7 / 36 done`, `1 doing`, `0 blocked`
- Longrun parent PID: `11540`
- Actual auto-loop PID: `20500`
- Watchdog PID: `35368`
- Dashboard metadata PID: `35744`
- Actual dashboard server PID: `32224`
- Current blocker-analysis: `not_blocked`
- Final report JSON: not present yet
- Observation: `/state` timed out during this audit, so dashboard responsiveness is still not robust enough.

## P0 / P1 Findings

### 1. Completed dashboard is not terminal

Symptom:
Tasks can finish, but the dashboard keeps refreshing and elapsed time keeps increasing.

Likely cause:
`codex-longrun-watchdog.mjs` detects completion, but still keeps looping and merging heartbeat fields into `current-progress.json`. `codex-progress-server.mjs` computes elapsed from `Date.now()` and the browser keeps polling with `setInterval`.

Required fix:

- Write a terminal completion snapshot once.
- Add `terminal: true`, `completedAt`, and `completedDurationMs`.
- Freeze elapsed at `completedDurationMs`.
- Stop or slow browser polling after terminal completion.
- Stop watchdog heartbeat churn after completion, or switch it to archive-only health.
- Do not restart dashboards for already-complete runs unless the user explicitly opens them.

### 2. Dashboard `/state` can still hang

Symptom:
`Invoke-RestMethod http://127.0.0.1:48371/state` timed out during this audit.

Likely cause:
The previous synchronous process-tree polling bug was fixed, but `/state` still reads and renders too much live state synchronously, including large logs and stale summary sources.

Required fix:

- Move expensive state collection into a cached sampler.
- Keep `/state` request path bounded by strict byte/time budgets.
- Return partial state with `stateHealth: degraded` instead of hanging.
- Add a self-test that fails if `/state` exceeds a small latency budget.

### 3. PID truth is wrong for both longrun and dashboard

Symptom:
Metadata stores hidden launcher PIDs while the real worker/server is a child process.

Current example:

- `current-longrun.json` points to PID `11540`, but the actual `codex-auto-loop.mjs` is PID `20500`.
- `current-dashboard.json` points to PID `35744`, but the actual `codex-progress-server.mjs` is PID `32224`.

Risk:
The watchdog can think a run or dashboard is alive when only the wrapper is alive, or can mis-detect health after PID reuse.

Required fix:

- Store `launcherPid`, `serverPid` / `workerPid`, `portOwnerPid`, and `commandLineHash`.
- Validate liveness by command line, workspace, and `/health`, not only `process.kill(pid, 0)`.
- Treat "launcher alive but child missing" as degraded/down.

### 4. Timeout-after-success creates false blockers and surprise subtasks

Symptom:
A turn can complete a roadmap card, then be killed by parent timeout during cleanup. The loop then treats the killed process as a timeout for the previous active card and decomposes later cards.

Observed pattern:
P0-06 advanced, then the parent timeout generated recovery/decomposition work that made the dashboard look like tasks were being invented.

Required fix:

- After a timeout, re-read `current-progress.json` and `project-roadmap.json`.
- If the pre-timeout card is already done, do not write a blocker for it.
- Do not seed decomposition for the next card unless it actually failed.
- Add a regression self-test for "success then timeout during cleanup".

### 5. Monitor treats `not_blocked` analysis as blocked

Symptom:
`blocker-analysis.json` with `status: not_blocked` can still be truthy and influence monitor status.

Required fix:

- Use `isBlockingAnalysis()` everywhere instead of `Boolean(blockerAnalysis)`.
- Add monitor-level self-test: dead longrun plus `not_blocked` must report `longrun-down`, not `blocked-stopped`.

### 6. Final report is not first-class

Symptom:
The dashboard does not clearly distinguish "not final yet" from "final report exists"; final reports can be stale or missing while the UI still looks complete.

Required fix:

- Add `readFinalReport()` to progress server.
- Expose `finalReport` in `/state`.
- Render a final report panel with completed work, remaining work, validations, risks, and path.
- Include active run ID/start time, so stale reports from older runs are ignored.

## P2 Findings

### 7. Duplicate/orphan dashboards

Observed:
There are duplicate dashboard processes for `C:\Users\owner` on ports `48653` and `48654`, separate from this Aether dashboard.

Required fix:

- Make dashboards singleton per resolved workspace.
- Use a workspace lock/registry entry.
- Reuse or kill orphaned same-workspace dashboards.
- Never let a global `C:\Users\owner` dashboard pollute a project-specific workspace.

### 8. State sources contradict each other

Symptom:
`current-progress.json` may say active card is P0-08 while `/state.workSummary` can still show older AGENT_STATE/stdout-derived data.

Required fix:

- Make `current-progress.json` plus `project-roadmap.json` authoritative.
- Treat AGENT_STATE/stdout summaries as diagnostic text only.
- Display "last agent note" separately from canonical roadmap state.

### 9. Completion status fields can contradict each other

Symptom:
`currentProgress.status` can be `complete` while `heartbeatStatus` remains `running` or `blocked`.

Required fix:

- Derive all status-ish fields from one terminal state object.
- Add invariant: `terminal=true` implies every live status field is `complete` or `archived`.

### 10. Final reporting mutates decomposition queue

Symptom:
Final progress writing calls `activeQueueItem()`, which can promote a pending queue item to `doing` and increment attempts just by reporting.

Required fix:

- Split read-only queue inspection from mutating queue activation.
- Final report generation must never change queue state.

### 11. Stale blocker-analysis can outlive the active card

Symptom:
Old blocker-analysis can remain after card advancement, producing confusing blocked/clear states.

Required fix:

- Clear or rewrite blocker-analysis on every card transition.
- Store `activeRoadmapId` and ignore analyses for other cards unless marked terminal.

### 12. Stale thresholds are too opaque

Symptom:
The dashboard can look stopped or stuck for a long time before the watchdog restarts.

Required fix:

- Separate `softStale` for user visibility from `hardStaleRestart`.
- Show current command/process, last output age, and next watchdog action.
- Add "why not restarted yet" text.

## Recommended Fix Order

1. Complete-state terminal model: freeze elapsed, stop live churn, no restart after complete.
2. `/state` responsiveness budget and cached sampler.
3. Real PID identity: launcher/server/worker/port-owner validation.
4. Timeout-after-success reconciliation.
5. `not_blocked` monitor classification fix.
6. Final report first-class dashboard and heartbeat surfacing.
7. Singleton workspace dashboard registry and orphan cleanup.
8. Canonical state source cleanup.
9. Queue read/write separation for final reporting.
10. Stale threshold UX and self-heal explanations.

## Test Coverage To Add

- `complete -> no live elapsed, no heartbeat churn, no watchdog restart`
- `complete -> finalReport visible, dashboard archive mode`
- `/state responds under latency budget with large logs`
- `launcher alive but child process dead -> unhealthy`
- `success then timeout during cleanup -> no false blocker, no surprise decomposition`
- `not_blocked blocker-analysis -> monitor does not report blocked`
- `stale blocker-analysis for old card -> ignored`
- `final report generation -> no decomposition queue mutation`
- `duplicate dashboard same workspace -> reuse or cleanup`

