# Longrun Automation S++ Hardening Report

Date: 2026-05-05
Scope: `<codex-home>` longrun control plane for `<repo>`

## Summary

The longrun control plane was hardened around four S++ requirements:

- Do not trust a PID just because it is alive.
- Keep each workspace on a truthful canonical dashboard.
- Never report completion without a durable final-report artifact.
- Prevent control-plane drift from silently weakening recovery behavior.

## Implemented

### Process Identity

- `codex-longrun-watchdog.mjs` now validates longrun identity through the Windows process tree.
- A hidden launcher is considered healthy only when a descendant `codex-auto-loop.mjs --workspace <workspace>` exists.
- Health snapshots now include `longrunIdentity` with root PID, worker PID, reason, and compact command evidence.

### Dashboard Truth

- Dashboard `/health` now returns typed JSON: workspace, port, PID, server PID, canonical URL, stale status, and timestamp.
- Watchdog dashboard checks now require typed health, matching workspace, matching port, and live server PID.
- `current-dashboard.json` is rewritten with the actual serving PID, not only the hidden launcher PID.
- Dashboard restart now prefers the stable workspace port (`48371` for Aelyris) and stops stale same-workspace dashboard servers on that port before drifting to another port.

### Completion Archive

- If the roadmap is complete but `final-report.json` is missing or only a placeholder exists, watchdog synthesizes a minimal durable final report.
- The synthesized report records `generatedBy: codex-watchdog`, roadmap counts, completed/remaining work, latest validation entries, and a clear archive note.
- Completion health/progress now carries final report paths and whether the archive was synthesized.

### Isolation And Safety

- Dashboard state rendering now redacts `statePath`, `stdoutPath`, and `stderrPath` when metadata points outside the workspace.
- Heavy child process kill logic now requires the process to be under the longrun root and command line to include the workspace path. It no longer treats parent-missing processes as kill candidates.
- `quality-baseline.json` blocker taxonomy drift is now caught by the roadmap quality gate.
- Aelyris baseline was updated to include the `destructive` blocker kind.

## Validation

- `node --check` passed:
  - `<codex-home>\codex-longrun-watchdog.mjs`
  - `<codex-home>\codex-progress-server.mjs`
  - `<codex-home>\codex-auto-loop.mjs`
  - `<codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-longrun-selftest.mjs` passed.
- Live dashboard health:
  - URL: `http://127.0.0.1:48371/`
  - Server PID: `5420`
  - `isStaleDashboard: false`
- Live monitor:
  - Status: `running`
  - Active: `P0-10 Authoritative event journal schema and APIs`
  - Roadmap: `9/36 done`
  - Dashboard alive: `true`
  - Event count after stabilization: `0`

## Remaining S++ Work

- Add a global dashboard registry with atomic workspace locks and retired-run pruning.
- Split retry budget by `{kind, activeRoadmapId, subtaskId}` instead of relying on a single consecutive failure counter.
- Add a fleet-level completion event contract that always includes final report JSON/Markdown paths.
- Add a sleep/resume grace selftest that distinguishes true stalls from PC sleep or network pause.

## Addendum: Turn-10 Stall Hardening

After the initial S++ pass, the active run appeared to be stuck on turn 10. The root cause was not a completed blocker: turn 10 had actually finished and P0-11 had started, but the watchdog could transiently fail to detect the auto-loop child under the hidden launcher. That made the dashboard briefly report the longrun as down even while the inner `codex exec` process was still alive.

Implemented follow-up hardening:

- `codex-auto-loop.mjs` now writes `current-child.json` and patches `current-progress.json` with the live `codex exec` PID, turn number, timeout, elapsed seconds, and alive/down status while a turn is running.
- `codex-longrun-watchdog.mjs` now records `autoLoopPid`, `codexExecPid`, `codexExecAlive`, `codexExecStartedAt`, and `codexExecElapsedSeconds` into health/progress.
- Process-tree detection no longer serializes every Windows process into one huge JSON blob; it walks descendants from the root PID, which avoids false negatives from very long Codex command lines.
- A root PID that is alive but temporarily missing auto-loop identity is rechecked before restart, so the watchdog does not create duplicate longruns during turn-boundary or PowerShell/CIM hiccups.
- If metadata is stale but a live auto-loop for the same workspace already exists, watchdog adopts it instead of launching another run.
- Watchdog startup now stops a prior same-workspace watchdog before taking ownership.
- Monitor JSON/text now surfaces turn, auto-loop PID, codex-exec PID, codex-exec health, and elapsed seconds.
- Dashboard Operational Truth now shows active turn and codex-exec child liveness.
- Selftests now wait for health output instead of assuming a 3.5s watchdog cycle and clean up temp longrun children without killing the selftest process.

Live stabilized state after cleanup:

- Dashboard: `http://127.0.0.1:48371/`
- Longrun PID: `27264`
- Auto-loop PID: `21032`
- Codex exec PID: `35248`
- Watchdog PID: `32520`
- Dashboard server PID: `31892`
- Roadmap: `10/36` done, active `P0-11 Connect event journal to longrun/dashboard state`
- Monitor event count after stabilization: `0`

Validation:

- `node --check` passed for watchdog, auto-loop, progress-server, monitor, and selftest.
- `node <codex-home>\codex-longrun-selftest.mjs` passed.
- Live `/state` and monitor both report `longrunAlive=true`, `codexExecAlive=true`, and `isStaleDashboard=false`.
