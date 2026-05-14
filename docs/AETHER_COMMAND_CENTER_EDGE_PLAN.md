# Aether Command Center Edge Plan

Date: 2026-05-14
Owner: Aether Terminal
Status: Target plan for the next product-grade edge pass

## Position

Aether should not compete as "another terminal with AI buttons."

The winning edge is:

> A local-first command center that can run, observe, route, review, recover, and preserve AI/dev sessions across a project.

The right rail must become the product's center of gravity. It should answer, at a glance:

- What is running?
- What changed?
- What is blocked?
- What should I do next?
- Which pane/agent/worktree owns this output?
- Can I safely stop, hand off, review, retry, or ship?

The rail should not be called "Mission Control" in product copy. The current user feedback is clear: that framing feels noisy and unjustified. Use "Conductor", "Run Rail", or "Command Center" only where the UI proves the value.

## Competitive Read

### tmux

tmux wins on durable server semantics, prefix/keymaps, windows/panes, scripting, detach/attach, and muscle memory.

Aether must match this locally through the Rust mux core, then exceed it by attaching repo, worktree, task, agent, review, and recovery state to every pane.

### WezTerm

WezTerm sets the bar for a modern Rust terminal: GPU rendering, panes/tabs/windows, native scrollback, remote mux domains, Lua configuration, rich keybindings, color/font/image capabilities, and CLI control.

Aether should not try to beat WezTerm by only becoming more configurable. It should beat it by making project work explainable and recoverable.

### Warp

Warp's edge is an agentic development environment: agents, conversations, context, permissions, task lists, model choice, Active AI, MCP, rules, and team/workflow surfaces.

Aether must answer with a stronger local-first story:

- local project and worktree state is the source of truth;
- panes are real terminals, not opaque chat threads;
- agent actions are auditable and replayable;
- recovery and review happen beside the shell, not in a separate cloud workflow.

### cmux / ccmux

cmux is focused on managing multiple AI coding agents through a native terminal hierarchy: workspace, pane, surface, panel, automation, notifications, socket control, and restore metadata.

ccmux is leaner and Claude Code-oriented. The useful lesson is speed and clarity: opening many agents should feel instant, and the UI should make parallel work obvious.

Aether's opportunity is to combine cmux-style agent workspace control with tmux-grade persistence and a richer project/review layer.

### PraisonAI

PraisonAI is not a terminal competitor; it is an agent/workflow framework. Its relevant strengths are multi-agent orchestration, memory, RAG, tools, MCP, approval/guardrail patterns, dashboard/flow builder, persistence, and many provider integrations.

Aether should borrow the shape, not the category:

- workflows as visible graphs;
- role-based agents;
- memory/context packs;
- approval gates;
- traces and replay;
- human handoff;
- provider/model routing.

The difference: Aether should bind those features to real terminals, real worktrees, real files, and local mux sessions.

## Current Aether Assets

Already useful:

- Rust mux graph with split, close, move, swap, even, tiled, rotate, break, join, zoom, detach, attach, sync panes, broadcast, durable scrollback, and `aetherctl`.
- Release gates for mux live restore, mux performance, scrollback, IME, focused UI tests, and distribution artifacts.
- Right rail surfaces:
  - Run / Changes / Health modes;
  - Review Queue;
  - Decision Inbox;
  - Agent cards and interactive session cards;
  - Conductor graph;
  - Workflows;
  - Toolkit;
  - Context / pulse / ledger / audit surfaces.
- Project-first app shell with file tree, tasks, editor, terminal panes, workflows, source control, and settings.

Weaknesses:

- The right rail still reads as a dashboard, not an action surface.
- Users can see widgets without understanding why they matter.
- Session/agent/worktree ownership is present but not always visually dominant.
- Workflows, toolkit, context, review, and health are separated into sections instead of one guided run loop.
- PraisonAI-style memory/RAG/approval/trace concepts are not first-class enough.
- Warp-style agent permissions, task lists, and Active AI recommendations are only partially represented.
- cmux-style workspace/pane/surface hierarchy is not expressed clearly in the UI.
- The rail does not yet prove that Aether is better than running tmux plus AI CLIs manually.

## Product Bet

Build the rail around one loop:

1. Plan: choose task, role, model, context, worktree, budget, and approval policy.
2. Run: launch one or more agents/tools/panes with visible ownership.
3. Observe: show live state, blocked state, context pressure, cost, process health, and output signals.
4. Route: hand off, fork, broadcast, sync panes, move panes, attach watchdogs, or create follow-up agents.
5. Review: changed files, diffs, tests, failures, provenance, and PR readiness.
6. Preserve: persist session graph, scrollback, command blocks, traces, and final reports.

This loop is the edge. Everything in the rail should either advance this loop or disappear.

## Target UX

### Top Rail Summary

Replace scattered status boxes with one compact "Now" strip:

- running sessions;
- changed files;
- blocked approvals;
- context/cost pressure;
- highest-risk pane/session;
- next recommended action.

Acceptance:

- In under 3 seconds, a new user can tell whether the project is idle, running, blocked, ready for review, or unhealthy.
- No metric appears without an action next to it.

### Primary Action Stack

The rail should always show 3-5 ranked actions:

- Start focused agent
- Start test/review agent
- Open review queue
- Fix blocked approval
- Attach watchdog
- Re-run failed test
- Handoff high-context session
- Commit ready changes
- Restore detached session

Acceptance:

- Every action names the affected pane/session/worktree.
- Actions are disabled with a reason, never silently inert.
- Action ranking is deterministic and unit-tested through `rightRailAdvisor`.

### Conductor Graph

Promote the existing Conductor view from "nice graph" to "run topology":

- columns by role: Implementer, Tester, Reviewer, Researcher, Operator;
- edges for handoff/fork/dependency;
- node badges for changed files, context, failures, approvals, final report state;
- click node -> focuses pane/session and shows actions;
- drag/drop or menu -> handoff/fork/split review.

Acceptance:

- A parallel run can be understood without opening individual logs.
- The graph is useful with two sessions, not only with a large orchestra.

### Worktree/Pane Ownership

Make ownership visually unavoidable:

- every pane has role, cwd, worktree branch, session id, and linked task;
- every agent card links back to pane and changed files;
- every changed file can answer "which agent/session touched me?"

Acceptance:

- No changed file appears without provenance when it came from an agent.
- No live agent appears without a pane/worktree/session route.

### Workflow Builder As Product Edge

Workflows should become a PraisonAI-style local flow builder, but project-native:

- role nodes;
- terminal/tool nodes;
- model/provider nodes;
- approval gate nodes;
- test/review gate nodes;
- context pack nodes;
- memory/RAG nodes;
- final report nodes.

Acceptance:

- A workflow can launch agents, attach context, wait for approvals, run tests, and produce a review artifact.
- The same workflow can be driven from UI and CLI.

### Memory And Context Packs

Add local "Context Packs":

- selected files;
- docs URLs;
- command history;
- terminal blocks;
- prior final reports;
- project rules;
- RAG index pointers;
- ignored secret paths.

Acceptance:

- Before starting an agent, the user can see what context it will receive.
- Context can be reused across runs without pasting prompts.
- Sensitive paths are excluded by policy.

### Approval And Guardrail Layer

Decision Inbox should become a hard product feature:

- pending tool approvals;
- dangerous command warnings;
- file-system scope warnings;
- budget/context thresholds;
- blocked workflow gates;
- denied actions with retry/fork options.

Acceptance:

- A blocked run always has a visible next step.
- Approval history is auditable.
- Auto-approve rules are visible and reversible.

### Trace And Replay

Create a trace surface for each run:

- prompt;
- model/provider;
- context pack;
- tools/commands;
- terminal output markers;
- file changes;
- tests;
- approvals;
- final report;
- cost/tokens;
- handoffs.

Acceptance:

- The user can inspect why a file changed.
- The user can export/share a run trace.
- The system can replay enough metadata to recover after restart.

## Implementation Milestones

### Milestone 1: Rail Clarity Pass

Goal: make the right rail immediately understandable.

Tasks:

- Remove or hide any "Mission Control" wording.
- Rename the visible rail concept to "Run", "Review", and "Health" only, with tooltips and empty states.
- Add a compact "Now" strip with state: Idle, Running, Blocked, Review Ready, Unhealthy.
- Extend `rightRailAdvisor` into a ranked action engine.
- Add tests for action ranking across idle, changed files, blocked agent, high context, failed command, and parallel run states.
- Make side panel sections collapse by default when not actionable.

Exit criteria:

- A new user can explain the rail without docs.
- Empty states say what to do next, not what the feature is in abstract.
- No rail section is visible only to show zeroes.

### Milestone 2: Conductor Becomes The Run Topology

Goal: make parallel agent work visually obvious and controllable.

Tasks:

- Promote Conductor graph into a first-class rail tab/state when 2+ sessions exist.
- Add role columns and dependency edges.
- Add node actions: focus pane, view diff, handoff, fork reviewer, stop, collect final report.
- Add conflict badges from changed-file overlap.
- Link graph selection to terminal pane focus.

Exit criteria:

- Two-agent and three-agent flows are readable without opening menus.
- Handoff/fork/review actions are one click from the graph.

### Milestone 3: Worktree/Pane/Agent Provenance

Goal: make Aether impossible to confuse with a generic terminal.

Tasks:

- Introduce a shared provenance model: pane id, terminal id, agent id, worktree path, task id, branch, changed files.
- Show provenance in pane header, agent card, review queue, file tree, and diff panel.
- Add "Open owner pane" and "Open owner worktree" actions.
- Add tests that changed-file provenance survives session updates and restore.

Exit criteria:

- Every agent-created change has an owner.
- Every owner can be navigated to from review surfaces.

### Milestone 4: Workflow/Agent Graph Upgrade

Goal: absorb PraisonAI-style workflow value locally.

Tasks:

- Add role/model/context/approval/test/final-report nodes to Workflow Builder.
- Add workflow run trace records.
- Add UI for workflow gates and human approvals.
- Add CLI/API parity for launching and inspecting workflows.
- Add saved templates: Implement-Test-Review, Research-Plan-Code, Hotfix-Verify-PR.

Exit criteria:

- A workflow can start agents, gate on tests, request approval, and produce a final report.
- The run is inspectable after completion.

### Milestone 5: Context Packs And Memory

Goal: make context deliberate and reusable.

Tasks:

- Add context pack model and storage.
- Add file/doc/terminal-block/final-report/rules sources.
- Add path exclusion and secret-safe defaults.
- Add optional local RAG index hook.
- Show context cost/size before launch.

Exit criteria:

- Agents can start with named context packs.
- The user can audit included and excluded context.

### Milestone 6: Active Recovery

Goal: make the system feel alive when things break.

Tasks:

- Detect failed command blocks, stuck agents, denied tools, missing CLI binaries, high context, slow spawn, and dead panes.
- Convert detections into ranked actions in the rail.
- Add "recover" actions: retry, open logs, spawn reviewer, create worktree, handoff, attach watchdog, terminate safely.
- Persist recovery attempts in the audit trail.

Exit criteria:

- Failures appear as actions, not just logs.
- User can recover from common terminal/agent failures without understanding internals.

### Milestone 7: Product-Grade Polish Gate

Goal: prove the edge under release conditions.

Tasks:

- Add visual smoke scenarios for rail states: idle, running, blocked, review ready, unhealthy, conductor graph, workflow gate.
- Add contrast checks for every preset and rail menu/dialog.
- Add performance budgets for rail updates and graph rendering.
- Add tutorial-free usability checklist.
- Add release doctor checks for rail evidence artifacts.

Exit criteria:

- Rail state screenshots are generated in CI/local release gate.
- No critical contrast failure.
- Rail updates stay responsive under 20+ sessions and 500+ changed files.

## Scoring Target

| Area | Current Target | Required For "Edge" |
| --- | --- | --- |
| Terminal mux parity | A- | A+ |
| WezTerm-style customization | B | A |
| Warp-style agent management | B- | A |
| cmux-style multi-agent workspace clarity | B | A+ |
| PraisonAI-style workflow/orchestration | C+ | A |
| Right rail usefulness | B- | S |
| Product explanation in first minute | C+ | A |
| Release confidence | A- | A+ |

The first true S-grade claim should wait until Milestones 1-3 are implemented and validated. Milestones 4-6 are what turn Aether from a strong local terminal into a product people can justify choosing.

## Immediate Next Implementation Slice

Start with Milestone 1 and part of Milestone 2:

1. Rename/clarify right rail copy and remove "Mission Control" framing.
2. Add a `rightRailActionEngine` that returns ranked next actions.
3. Replace passive zero-metric panels with state-aware empty/action states.
4. Promote Conductor when parallel sessions exist.
5. Add tests for rail action ranking.
6. Add a visual QA scenario for each rail state.

This is the highest leverage slice because it changes the product from "feature collection" to "work command center" without requiring a full native rewrite.

## Source Notes

- PraisonAI: https://github.com/MervinPraison/PraisonAI
- Warp Agents: https://docs.warp.dev/agents/agents-overview
- cmux Concepts: https://cmux.com/docs/concepts
- cmux Getting Started: https://cmux.com/docs/getting-started
- WezTerm: https://wezterm.org/

