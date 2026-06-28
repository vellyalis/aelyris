# Longrun Mode Completion Status - 2026-05-06

## Current Verdict

Longrun control-plane implementation is complete enough to resume Aether work.

- Workspace: `<repo>`
- Git branch: `master`
- Worktree state: clean
- Extra worktrees: none
- Extra local branches: none
- Dashboard: `http://127.0.0.1:48371/`
- Longrun status: complete / finished
- Aether 9.8 roadmap: 36 / 36 complete
- Decision Inbox: 0
- Attention Inbox: 0 after stale-notification reconciliation
- Fleet level: green
- Fleet grade: Wizard S++
- Promotion gate: review, score 96, blockers 0, warnings 1

## Completed Longrun Control-Plane Capabilities

- Run identity, generation tracking, single-writer lease, stale-generation rejection.
- Zombie process reaping and process liveness classification.
- Watchdog restart/recovery logic with blocker taxonomy and retry caps.
- Oversized/heavy task decomposition before wasting turns.
- Write-scope planning and task complexity metadata.
- Dry-run worktree scheduler with dirty-main serialization and conflict-key checks.
- Guarded live parallel worker executor with isolated worktree creation support.
- Worker artifact protocol, merge queue, and promotion gate.
- Fleet telemetry, Decision Inbox, and self-healable Attention Inbox split.
- Dashboard truth surface for liveness, roadmap, fleet, promotion, merge, decision, and attention.
- Longrun selftest coverage for the above control-plane behavior.

## Fixed In This Cleanup Pass

- Merged the previously classified Aether changes into `master`.
- Deleted the now-merged cleanup branch.
- Confirmed only one git worktree remains.
- Hardened PTY integration tests against Windows/ConPTY load timing.
- Hardened longrun selftest cleanup against transient Windows temp-file locks.
- Hardened longrun selftest recovery checks to wait for run identity convergence after watchdog restart.
- Filtered stale Attention Inbox notifications when later recovery/complete truth proves the condition is no longer active.
- Hardened terminal completion truth so a done roadmap cannot mask a stale `current-progress` or `current-health` artifact from a different run identity.
- Added a regression selftest proving a stale completed run cannot terminate or archive a newer generation, even when the roadmap file is already all done.

## Validation Passed

- `git diff --check HEAD`
- `pnpm exec tsc --noEmit`
- `cargo test`
- `pnpm test`
- `pnpm verify:release`
- `node <codex-home>\codex-longrun-selftest.mjs`
- Browser dashboard verification for `Wizard S++`, `Decision Inbox`, `Attention Inbox`, `Promotion Gate`, `36/36`, and `complete`.

## 2026-05-06 Strict Identity Follow-Up

Additional hardening was applied after the initial cleanup:

- `codex-longrun-watchdog.mjs`: terminal archive now requires either identity-matched completion or roadmap completion without a stale terminal artifact.
- `codex-progress-server.mjs`: dashboard `/state` no longer reports terminal completion when the visible terminal artifact belongs to another run identity.
- `codex-longrun-monitor.mjs`: monitor completion events no longer let all-done roadmap counts override stale terminal identity.
- `codex-longrun-selftest.mjs`: added the all-done-roadmap stale-completion regression and made lease-check diagnostics clearer under Windows load.

Follow-up validation passed:

- `node --check <codex-home>\codex-longrun-watchdog.mjs`
- `node --check <codex-home>\codex-progress-server.mjs`
- `node --check <codex-home>\codex-longrun-monitor.mjs`
- `node --check <codex-home>\codex-longrun-selftest.mjs`
- `node <codex-home>\codex-longrun-selftest.mjs`
- `pnpm verify:release`

## What Still Prevents Wizard S+++

Wizard S+++ is not blocked by longrun infrastructure anymore. It is blocked by Aether product/release risks that are intentionally still open in `.codex-auto\risk-register.json`.

Main remaining risk groups:

- Live Tauri/WebView2 smoke gaps for IME, right rail, Mission Control, review queue, workflow, decision inbox, profile UI, context pack, and agent graph.
- Product-provider gaps such as pane intent metadata, workflow restart durability, agent run metadata, exact git hunk summaries, and command-risk parser precision.
- Release/operations gaps such as updater key custody, clean-VM MSI install proof, and real authenticated AI CLI kill/recovery proof.
- Low-level security/assurance gaps such as audit hash-chain strength and AI CLI alternate-screen heuristic limits.

These are Aether quality items, not reasons to block returning to Aether implementation. The clean baseline and live worker scheduler are ready to support that next phase.

## Recommended Next Phase

Use the completed longrun mode to attack the 32 open Aether risks in parallel batches:

1. Live Tauri/WebView2 smoke matrix batch.
2. Provider/data-contract implementation batch.
3. Workflow durability and command-risk precision batch.
4. Release custody and clean-VM installer proof batch.
5. Final promotion pass after the risk register reaches zero unaccepted open risks.

The scheduler should only arm live parallel workers when new Aether work cards exist, the main worktree is clean, and merge/promotion gates remain enabled.
