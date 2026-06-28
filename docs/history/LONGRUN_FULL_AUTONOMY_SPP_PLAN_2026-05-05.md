# Longrun Full Autonomy S++ Plan

Created: 2026-05-05T06:49:28.803Z
Workspace: <repo>
Canonical dashboard: http://127.0.0.1:48371/

## Target

Longrun should behave like a fully autonomous engineering control plane, not a simple restart loop. The target is:

- recover automatically from process death, dashboard death, sleep/resume, stale metadata, transient process-tree failures, port conflicts, and external dependency outages when self-healable;
- split heavy tasks, retry only with typed policy, and escalate only irreducible decisions;
- use parallel execution only when cards are independent, file ownership is explicit, and worktree isolation prevents dirty-worktree damage;
- integrate parallel outputs through a merge queue with validation, rollback, evidence consolidation, and risk scoring;
- keep the dashboard truthful: every active process, active card, generated task, completed card, blocked kind, retry budget, validation state, and final report must be visible.

## Current Gap

The current system already has typed blockers, monitor/watchdog, event journal replay, final report surfacing, and scoped workspace dashboard. It is not yet fully autonomous because it lacks a lease/generation lock, dependency-aware parallel scheduler, automatic worktree isolation, merge arbiter, critic promotion gate, and fleet-level truth dashboard.

## Operating Model

1. Coordinator owns the workspace lease and roadmap truth.
2. Planner turns roadmap cards into dependency graph nodes with write scopes and validation shards.
3. Scheduler decides serial vs parallel execution using risk, write-scope overlap, dependency edges, and resource budget.
4. Workers run in isolated git worktrees when parallel-safe.
5. Integrator merges one worker result at a time, runs impacted validation, and rolls back failed merges.
6. Critic promotes work only when evidence, tests, risks, docs, and score deltas are sufficient.
7. Monitor reports only meaningful user/Codex notifications: completion, attention, stale/down, or irreducible blocker.

## Non-Negotiable Rules

- No worker may edit the main worktree directly unless it is the coordinator or an explicitly serial task.
- No parallel task may overlap writeScope/conflictKeys with another active task.
- No task may become done without validation evidence and residual risk notes.
- No retry loop may restart blindly after repeated same-kind failure.
- No stale generation may be displayed as current truth.
- No user dirty changes may be overwritten or hidden by worker integration.

## Roadmap Extension

This plan adds six P0 cards, intended to be inserted after P0-15 once the current active P0-12 turn is no longer writing roadmap artifacts:

- P0-16: Autonomous scheduler leases and generation locks — Make longrun ownership unambiguous with runId/generation leases, atomic lock files, stale owner retirement, zombie reaping, and no duplicate auto-loop/dashboard/watchdog ownership after sleep, restart, or monitor races.
- P0-17: Parallel worktree scheduler and lane planner — Schedule independent roadmap cards in parallel using isolated git worktrees, explicit file ownership, dependency graph constraints, and resource budgets; keep coupled or risky tasks serial.
- P0-18: Autonomous failure triage and replan engine — Handle failed tasks by kind: split oversized work, retry flaky validation with caps, probe external dependencies, switch strategy for repeated implementation failure, and escalate only irreducible decisions.
- P0-19: Parallel integration gate and merge arbiter — Merge parallel worker outputs through a deterministic integration queue with diff risk scoring, conflict arbitration, validation shards, rollback, and final evidence consolidation.
- P0-20: Fleet telemetry utilization and truth dashboard — Show the real autonomous fleet: coordinator, workers, worktrees, active cards, current command, elapsed time, stale age, retry budget, blocked kind, utilization, queue depth, and expected finish confidence.
- P0-21: Autonomous quality critic and promotion gates — Require each completed card to pass an independent critic gate before promotion: tests, visual QA where applicable, perf budget, error tolerance, docs/runbook, rollback notes, and score delta.

The machine-readable extension is stored at `.codex-auto/roadmap-extension-longrun-autonomy-2026-05-05.json`.

## Validation Philosophy

The feature is not considered done until there are fixtures for lease contention, sleep/resume grace, automatic worktree dry-run, dirty-main protection, failure replan, merge rollback, fleet dashboard truth, and critic demotion. Browser/dashboard smoke should verify that progress does not flicker, reset scroll, or show stale generations.
