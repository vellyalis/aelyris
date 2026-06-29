# Worktree Classification And Commit Plan - 2026-05-06

## Summary

The dirty worktree is active implementation work, not disposable residue. It is being split into reviewable commits on branch `codex/aelyris-worktree-classification-2026-05-06`.

`AGENT_STATE.md` is local Codex handoff state and is ignored instead of committed.

## Commit Groups

### 1. Documentation And Audit Consolidation

Keep:

- New Aelyris 9.8 audit, progress, implementation, operations, performance, release, and longrun autonomy docs.
- The merged/obsolete cleanup audit.
- Deletion of old roadmap, phase, handoff, and historical design docs that were superseded by the new consolidated documents.

Risk:

- Documentation history remains recoverable through git, but the working tree no longer carries the old doc set.

### 2. Frontend Workstation Surfaces And Tests

Keep:

- Mission Control, context rail, decision inbox, process manager, review queue, pane switcher, reliability, run graph, tool ledger, workstation pulse, workspace profile, review/decision/context helpers, and terminal input/pane persistence changes.
- Frontend unit tests and visual QA test updates.

Reason:

- `App.tsx` imports these new feature modules directly; deleting them would reduce or break product functionality.
- `pnpm exec tsc --noEmit` passed with these files present.

### 3. Tauri Backend, Terminal, Audit, And Workflow Core

Keep:

- Rust audit/event journal, IPC command additions, terminal/PTY/session/workflow/watchdog/git/status hardening, DB query/migration changes, and focused Rust tests.

Reason:

- These are backend support for the workstation control surfaces, audit replay, release readiness, and terminal reliability work.

### 4. Release, Validation, Workflow, And Assets

Keep:

- Release doctor, dist verification, release gate, chaos recovery, performance, IME, visual QA, Tauri dist config, workflows, package script wiring, and regenerated app icons.

Reason:

- These provide repeatable release/validation gates for the newly implemented Aelyris workstation state.

## Remaining Risk

After classification, the only remaining high risk is `risk-dirty-worktree` until these groups are committed and the working tree becomes clean.
