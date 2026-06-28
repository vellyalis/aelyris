# PraisonAI Reference Feature Plan

Date: 2026-05-17

## Verdict

PraisonAI is a strong reference for Aether's agent orchestration layer, especially the right rail. It should not replace Aether's terminal-first direction. The useful move is to turn Aether into a local project command center where terminal panes, AI CLI sessions, workflows, guardrails, memory, and telemetry are visible and controllable from one native workspace.

## High-Value Ideas To Borrow

### P0: Agent Workforce Panel

Add a clear "workforce" model to the right rail:

- Agent roster with role, goal, current task, session, model/provider, tool access, cost, status, and next action.
- One-click actions: pause, resume, hand off, attach to pane, open diff, copy context pack, rerun with guardrails.
- Session health: stuck loop, idle, blocked, waiting for approval, failed tool, missing credentials.

Why it matters: Aether's right rail becomes an operational surface instead of a collection of panels.

### P0: Guardrail Profiles

Add reusable guardrail presets:

- Conservative: no destructive commands, no network install, require approval for git write.
- Builder: allow local edits/tests, block destructive filesystem actions.
- Research: allow web/search/fetch, no repo writes.
- Release: strict validation ledger and rollback requirement.

Tie these to shell safety, workflow gates, watchdog, and right-rail recommendations.

### P1: Agent Handoff Graph

Represent agent handoffs explicitly:

- Source agent, target agent, reason, payload summary, files changed, validation evidence.
- Visual graph in right rail.
- Handoff replay: open context pack, diff, terminal pane, audit trail.

This is stronger than a flat session list because it explains "why this agent exists" and "what happened before it."

### P1: Workflow Patterns

Add first-class workflow templates:

- Route: choose reviewer/fixer/tester based on state.
- Parallel: run independent checks/workers.
- Loop: repeat until validation passes or risk remains.
- Review gate: ask human only when policy requires it.

Expose these as user-friendly recipes rather than raw YAML.

### P1: Memory / Knowledge Layer

Add project-scoped memory:

- Decisions made.
- Known bugs and accepted risks.
- Preferred commands.
- Project conventions.
- Failed attempts and why.

The right rail should surface memory only when it changes a recommendation.

### P2: Model Router

Add local policy-based routing:

- Fast cheap model for summarization.
- Strong model for code changes and risk analysis.
- Local model for private summarization.
- Budget and latency estimates in the action preview.

### P2: Shadow Checkpoints

Before risky actions:

- Create checkpoint.
- Run action.
- Verify diff/tests.
- Offer rollback or auto-rollback on failure.

This matches Aether's product promise better than generic "agent automation."

## What Not To Copy Directly

- Do not make Aether a Python SDK clone.
- Do not hide the terminal behind chat.
- Do not add broad multi-provider features before the local terminal/session core is rock solid.
- Do not add a visual workflow builder unless right-rail actions and templates are already useful.

## Recommended Next Build Order

1. Right rail "Agent Workforce" summary card.
2. Guardrail profile selector and enforcement status.
3. Handoff graph with context-pack replay.
4. Workflow templates for review, test, repair, release.
5. Project memory signals in recommendations.
6. Model router and shadow checkpoints.

## Success Criteria

- A new user can understand what every agent is doing within 10 seconds.
- Every right-rail recommendation has a reason, target, expected outcome, and safety status.
- Agent handoff and recovery are visible without reading logs.
- Workflows can be launched from templates without editing YAML.
- Risky actions produce checkpoint, evidence, and rollback path.
