# Merged / Obsolete Cleanup Audit - 2026-05-06

## Verdict

Do not delete the dirty Aether source changes as "already merged residue".

The repository has only one git branch and one git worktree, so there are no leftover merged feature branches or longrun worker worktrees to remove. The remaining dirty state is the current `master` working tree itself and includes runtime code, Rust backend changes, frontend feature panels, tests, release scripts, icons, and documentation changes.

Deleting those changes would reduce or break functionality.

## Git And Worktree Check

- Current branch: `master`
- Extra merged branches: none
- Extra git worktrees: none
- Longrun worker worktrees under `C:\Users\owner\.codex\longrun-worktrees`: none
- Dirty status entries after the audit: 399
- Deleted tracked files: 51
- Untracked files: 117

The untracked files are not harmless leftovers. TypeScript imports currently depend on new feature files such as:

- `src/features/dashboard/MissionControlHome.tsx`
- `src/features/decision-inbox/DecisionInboxPanel.tsx`
- `src/features/process-manager/ProcessManagerPanel.tsx`
- `src/features/review/ReviewQueuePanel.tsx`
- `src/features/context/*`
- `src/features/terminal/pane-switcher/*`
- `src/shared/lib/workspaceProfile.ts`
- `src/shared/lib/decisionInbox.ts`
- `src/shared/lib/reviewQueue.ts`
- `src/shared/lib/workstationSummary.ts`

`pnpm exec tsc --noEmit` passed with these files present, which confirms they are part of the active application graph.

## Risk Register Cleanup

Closed as mitigated during this audit:

- `risk-longrun-scope`
- `risk-validation-cost`
- `1777955132902-validation-blocker`
- `1777957750216-timeout`
- `risk-p0-13-live-cdp-unavailable`
- `risk-p0-13-live-cdp-verifier-unavailable`
- `risk-p1-03-live-tauri-role-broadcast-smoke-gap`
- `risk-p1-03-live-tauri-broadcast-smoke-gap`
- `risk-current-progress-heartbeat-embedded-active-drift`
- `risk-p1-04-concurrent-control-plane-writers`
- `risk-p2-06-full-tsc-timeout`
- `risk-p2-06-webgl-renderer-proof-gap`
- `risk-p2-05-welcome-heading-transient-flake`

Remaining risk state after cleanup:

- Open risks: 33
- Remaining high risks: 1
- Remaining high risk: `risk-dirty-worktree`

`risk-dirty-worktree` remains open because the repository is still heavily dirty and not yet committed, parked, or otherwise made into a clean baseline.

## Process Cleanup

Stopped stale Aether Vite validation servers on ports `1420` and `1421`.

Kept the longrun dashboard alive:

- `http://127.0.0.1:48371/`
- PID: `20720`

After cleanup, Aether-related Node processes are limited to:

- the Codex worker/kernel for this session
- the longrun progress dashboard

## Validation

- `pnpm exec tsc --noEmit`: passed
- `node C:\Users\owner\.codex\codex-longrun-selftest.mjs`: passed after removing a leftover temp selftest directory from a failed cleanup attempt
- dashboard `/state`: `complete`, `36/36`
- monitor: `eventCount=0`, dashboard alive
- promotion gate score improved from `42` to `78`
- human decisions remain `0`
- self-healable attention items reduced from `9` to `7`

## Next Safe Cleanup Step

The next cleanup should not delete source files. It should classify the dirty worktree into:

1. product code to keep
2. tests and verification scripts to keep
3. docs to keep or consolidate
4. generated/release artifacts to ignore or regenerate
5. truly obsolete tracked doc deletions to accept intentionally

Only after that classification should the repo be committed or split into reviewable commits.
