# Aether Command Center Edge Plan

Date: 2026-05-14
Owner: Aether Terminal
Status: Updated 2026-06-13 after Agent Team orchestration, glass/right-rail density, runtime hygiene, and release-gate refresh

## Current Canonical State - 2026-06-13

- `pnpm verify:quality-score` currently reports `92/100`, grade `A`, `309/335`, `releaseCandidateReady=false`; after the refreshed final-goal-evidence-map is counted the projected score is `95/100`, `317/335`.
- `pnpm verify:final-goal-audit` is expected to remain `blocked-by-external-gates`: `implementationFixableCount=0`, with the remaining gates classified as explicit token consent, real OS sleep/host support, and release signing/updater operator work.
- The right rail is now action-first rather than dashboard-first: ranked next action, focused queue/evidence drawers, owner/provenance chips, orchestra dispatch, toolkit/Git/VS Code entry points, and density guards are the current product contract.
- Agent Team orchestration now plans parallel lanes for implement, verify, review, and risk work with changed-file scope, handoff prompts, conflict policy, and evidence targets so multiple AI CLI sessions can be run like an Aether-native mux layer instead of loose chat tabs.
- The required safe proof registry has `27/27` artifacts green when `rightRailGoalTrackTauri` reports either `pass-current-contract` or `environment-blocked-current-contract`, including `goal-external-gate-readiness`, `real-os-sleep-operator-handoff`, `goal-operator-finish`, optional git handoff artifacts, `release-signing-operator-handoff`, `glass-legibility-contract`, `right-rail-information-density-contract`, `agent-team-orchestration-readiness`, and `goal-anti-stall-contract`.
- Long external operator gates persist `.codex-auto/quality/goal-operator-progress.json` with `lastHeartbeatAt`, `nextHeartbeatAt`, active step, and next action, so a resumed run can distinguish an actual stall from a sleep/token/signing gate wait.
- `pnpm verify:goal:finalize` excludes git finalization by default; set `AETHER_GOAL_FINALIZE_INCLUDE_GIT=1` only when commit/merge readiness is intentionally in scope.
- Git finalization is an optional handoff gate, not required for product/safe/finalize evidence: `.codex-auto/quality/git-finalization-readiness.json` records the exact commit/merge runbook when `.git/index.lock` or `.git/objects` permission errors block staging.
- `real-os-soak` is host-blocked, not passed: the native sleep command returned `SetSuspendState returned false; GetLastError=50`, while native sleep/postcheck preflights and the no-real-sleep-claim postcheck writer pass.
- `authenticated-ai-cli-prompt-smoke` is not run by default because it may spend tokens; `authenticated-ai-cli-consent-packet` records the required `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` boundary for a future token-spending prompt run.
- Release doctor is current but remains `pass_with_warnings` until updater signatures and `latest.json` are regenerated from release signing material.

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

### 2026-05-22 State Audit

Implementation-fixable release blockers are currently closed, but the final release claim remains consent-gated:

- `pnpm verify:release:production` passes.
- `pnpm verify:quality-score` reports `96/100`, grade `A`, `321/335`, `releaseCandidateReady=false`.
- `pnpm verify:goal:safe` reports `blocked-by-external-gates` with `27/27` proof artifacts passing, including the objective-level `goal-completion-matrix`, current supply-chain audit proof, `goal-external-gate-readiness`, optional git handoff artifacts, `glass-legibility-contract`, `right-rail-information-density-contract`, `agent-team-orchestration-readiness`, `release-signing-operator-handoff`, and `goal-anti-stall-contract`.
- The remaining blockers are host real sleep/resume evidence and `authenticated-ai-cli-prompt-smoke`, because the final authenticated AI CLI prompt smoke may spend tokens.
- The opt-in packet is `authenticated-ai-cli-consent-packet`; running that final smoke requires both `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.
- Strict release doctor, signed updater artifacts, `latest.json`, supply-chain audit, Native IME, live WebView2 smoke, mux restore/performance, and scrollback pass; real OS sleep/resume remains host-blocked until a capable/user-initiated sleep cycle emits power events.
- Risk register scoring reports `0 open, 0 accepted release`.

Terminal-core blockers have also moved:

- xterm.js is no longer the terminal product dependency.
- Rust owns PTY lifecycle, terminal parsing/grid state, mux graph, keymap dispatch, scrollback capture/search, and native Tauri input ownership.
- Remaining terminal work is no longer "make panes work"; it is daemon policy, native renderer/client, config reload, fallback deletion, and provenance/recovery product loops.

The right rail has moved from a passive product-edge gap to a guarded Command Center baseline, but it should still be treated as the highest-leverage product surface. It is no longer a release blocker: the current Goal Track proof shows the score, final audit, safe gate, consent packet, requirement proofs, and the one remaining explicit-consent blocker in the live Tauri UI.

### 2026-05-25 Clauge-Inspired Adjustment

Clauge is useful as an information-architecture reference: explicit modes, purpose-pinned agents, context/worktree/approval visibility, and one-keystroke switching. Aether should adopt that clarity without becoming a generic super-app.

The Command Center/right rail should evolve into a contextual Inspector inside a native mode shell:

- left mode rail: Terminal, Agents, Workspace, Review, Git, Context, History, Settings;
- center: native terminal/workspace surface;
- right: Inspector for the selected pane/session/agent/task/file/risk/evidence item;
- Command Center data remains Rust-owned and feeds the Inspector;
- React right rail becomes compatibility once native mode shell and inspector proofs pass.

The detailed plan is `docs/CLAUGE_INSPIRED_NATIVE_MODE_SHELL_PLAN_2026-05-25.md`.

The next edge pass should not spend its first energy on more passive telemetry. It should make Aether answer:

- Which run owns this project state?
- What changed, and why?
- What action is safest next?
- Which pane/agent/worktree should I focus, stop, retry, review, or preserve?
- What context would a follow-up agent receive?

Closed edge weaknesses:

- The right rail now exposes ranked actions with reasons, next steps, target widgets, scale coverage, and a final-goal track.
- Stale URL/debug replay state is labeled under Visual QA and cannot make normal runtime truth look blocked.
- Provenance, recovery, context-pack, launch-planner, consent-packet, and command-evidence contracts are now linked to score and final-goal evidence.
- Runtime fallback and stale-state paths are routed into visible reliability/recovery evidence instead of staying silent.

Remaining stretch risks:

- First-minute product explanation still needs to make the Command Center loop obvious without relying on documentation.
- Session/agent/worktree ownership should become more visually dominant in every repeated rail card.
- Workflows, toolkit, context, review, and health should continue converging into one guided run loop rather than adjacent sections.
- PraisonAI-style memory/RAG/approval/trace concepts are proven as contracts, but still need deeper everyday UX polish.
- Warp-style permissions, task lists, and Active AI recommendations are present as signals but should become more action-oriented.
- cmux-style workspace/pane/surface hierarchy is functional, but the hierarchy should be clearer at a glance.

Resolved or reduced weaknesses from the 2026-05-21 audit:

- The old URL/state problem is covered by the stale URL truth contract and live Tauri evidence.
- Ranked actions and Goal Track proof reduced the "dashboard only" risk.
- Provenance, recovery, final report, context-pack, and launch-planner artifacts now form an auditable trace in the final-goal evidence map.
- Context/memory is now represented in launch planning and command-center scenario proof, though the user-facing launch UX still needs refinement.
- Sakura/glass/background-image customization moved from ad hoc CSS tuning into guarded theme customization contracts.

## Product Bet

Build the rail around one loop:

1. Plan: choose task, role, model, context, worktree, budget, and approval policy.
2. Run: launch one or more agents/tools/panes with visible ownership.
3. Observe: show live state, blocked state, context pressure, cost, process health, and output signals.
4. Route: hand off, fork, broadcast, sync panes, move panes, attach watchdogs, or create follow-up agents.
5. Review: changed files, diffs, tests, failures, provenance, and PR readiness.
6. Preserve: persist session graph, scrollback, command blocks, traces, and final reports.

This loop is the edge. Everything in the rail should either advance this loop or disappear.

## 200-Point Quality Bar

The target is not "better than the current build." The target is a product that feels unfairly useful compared with a normal terminal plus separate AI CLIs.

Use a 200-point internal score, not a 100-point score. Aether should not be considered ready for a flagship release until it can score at least 180/200 in evidence-backed review, and the product goal is 200+ by exceeding the baseline with differentiating features.

### Scorecard

| Area | Points | 200-Point Expectation |
| --- | ---: | --- |
| Core terminal/mux reliability | 25 | tmux-style pane/session/layout actions are durable, scriptable, tested, and honest after crashes. |
| Terminal performance and latency | 20 | split, close, attach, resize, scrollback, and input echo stay inside measured budgets on Windows. |
| Visual quality and contrast | 20 | every preset, dialog, rail state, menu, terminal surface, and status bar passes contrast and polish checks. |
| IME and international input | 15 | Japanese IME works across PowerShell, Codex CLI, Claude Code CLI, Gemini CLI, split panes, resize, DPI, and restart paths. |
| Right rail usefulness | 25 | the rail always explains current state and gives ranked, actionable next steps. No decorative dashboard clutter. |
| Agent orchestration edge | 20 | role-based agents, handoffs, worktrees, approvals, final reports, and parallel run topology are visible and controllable. |
| Workflow/context/memory | 20 | reusable context packs, approval gates, traces, workflow templates, and local memory/RAG hooks are usable without prompt pasting. |
| Review/release loop | 15 | changes, provenance, tests, PR readiness, rollback, installers, and release evidence are linked and reproducible. |
| Security/guardrails | 10 | dangerous commands, path scope, secret exposure, API auth, stream tickets, and automation rules are explicit and tested. |
| Product explanation and onboarding | 10 | a new user understands why Aether exists within one minute without reading docs. |
| Distribution and operations | 10 | app identity, task-manager identity, installer, updater, logs, crash handling, and diagnostics are production-grade. |
| Extensibility and future native path | 10 | CLI/API/config boundaries allow a future full-native Rust shell and third-party automation. |

Total: 200.

### Bonus Edge Points

The product can exceed 200 only through capabilities that competitors do not combine cleanly:

- local-first agent run trace tied to terminal panes, files, worktrees, tests, and approvals;
- one-click recovery from failed command, stuck agent, high context, denied tool, or broken worktree;
- replayable run history that can explain why each file changed;
- workflow templates that launch real terminal agents and produce review-ready artifacts;
- a native/client-agnostic mux core where Tauri, CLI, and future Rust UI can attach to the same session graph.

### Non-Negotiable Fail Conditions

Any one of these caps the score below 140, no matter how many features exist:

- pane split/close/new shell visibly flashes a console window;
- Japanese IME candidate placement is wrong in common agent CLIs;
- Sakura or any preset has low-contrast text in normal operation;
- the right rail shows metrics but no clear next action;
- a restored/dead session is presented as live;
- changed files cannot be traced to an owning session/agent/worktree;
- release artifacts cannot be verified from a clean worktree;
- a distribution build appears as generic WebView/process identity in user-facing places;
- fallback behavior silently changes terminal/mux semantics;
- visual QA and performance evidence are missing for the release claim.

### Evidence Required For 180+

- Clean worktree release gate passes.
- Full frontend and Rust test suites pass.
- Mux live restore and performance smoke pass.
- IME CDP verification passes.
- Visual smoke includes screenshots for idle, running, blocked, review-ready, unhealthy, conductor, workflow gate, settings, and every color preset.
- Contrast audit has zero critical issues.
- Installer and app identity checks pass.
- At least one scripted "agent run -> change -> review -> test -> final report" scenario passes.

### Evidence Required For 200+

- All 180+ evidence.
- Right rail action ranking tests cover at least 12 real states.
- Workflow/context-pack scenario passes with approval gate and final trace.
- Provenance test proves a changed file can be navigated back to pane, agent, worktree, and run trace.
- 20-session stress rail render stays responsive.
- 500-changed-file review queue stays usable.
- Recovery scenario proves failed command detection, suggested action, retry/handoff, and audit record.
- Full-native Rust migration boundary remains intact: no new mux truth exists only in React.

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
- Stale URL/debug state cannot visually overrule current release/run truth.
- The top action always includes a target and a reason.

### Milestone 1.5: Stale-State And Truth Hygiene

Goal: prevent old URL parameters, stale edge-loop history, or cached rail state from making a green product look blocked.

Tasks:

- Add a rail truth banner/state reducer that separates URL-requested scenario state from authoritative runtime state.
- Mark visual QA/debug scenario state as simulated when `aetherVisualQa=1` or stale `edgeLoop` history is present.
- Add "current evidence" links to quality score, release doctor, live smoke, and risk closure artifacts when in diagnostic mode.
- Add tests for stale `state=blocked` URL, stale edge history, fresh `releaseCandidateReady=false` consent-gated truth, and real blocked runtime state.

Exit criteria:

- A stale URL cannot make the normal product appear blocked.
- Diagnostic/simulated states are clearly labeled and do not poison stored app state.
- Release-ready state has a visible proof path.

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
- Every review item can answer: command/session/agent/worktree/test evidence/final report.

### Milestone 3.5: Command Block To Review Trace

Goal: connect terminal output to changed files and review state.

Tasks:

- Promote command blocks from terminal history into trace records with cwd, shell, command, exit code, output range, owner pane, and changed-file impact.
- Link failed command blocks to Recovery actions.
- Link successful test/lint/build command blocks to Review Queue readiness.
- Add "Show why" on changed files that opens the owning command/agent/worktree trace.

Exit criteria:

- A user can inspect why a changed file exists without reading raw logs.
- Review Queue can distinguish untested, failed-tested, and passed-tested changes using trace evidence.

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

### Milestone 5.5: Launch Planner

Goal: make starting an agent safer and more useful than typing into an AI CLI manually.

Tasks:

- Add a launch planner that chooses role, model/provider, worktree, shell, context pack, approval policy, budget, and expected artifacts.
- Show what will be sent, what is excluded, what files are in scope, and which terminal pane will own the run.
- Offer templates: implement, test, review, research, hotfix, release-check, docs.
- Persist launch decisions into the run trace.

Exit criteria:

- A user can launch a high-quality agent run without prompt-pasting.
- The run trace can reconstruct context, policy, and expected output.

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

### Milestone 8: Native Customization And Shell Boundary

Goal: make the native Rust path improve the product instead of becoming a rewrite detour.

Tasks:

- Define shared theme/customization schema for Tauri shell and future native shell:
  - colors;
  - per-surface opacity;
  - background image path/picker;
  - scale/position/repeat;
  - dim/blur;
  - contrast constraints.
- Add native-shell compatibility constraints to every new rail/terminal feature: no new mux truth only in React.
- Add a small `aether-native` terminal client milestone to prove transparent window, native terminal rendering, native input, and daemon attach.
- Keep Monaco/editor outside the critical native path; default to VSCode/external editor for full editing.

Exit criteria:

- New customization features can be implemented once and consumed by both shells.
- The native spike attaches to the same session graph instead of creating a parallel terminal.
- Full-native work advances Aether's edge: lower latency, cleaner identity, better IME/clipboard, and stronger customization.

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

Start with Milestone 1, Milestone 1.5, and the first part of Milestone 3:

1. Remove remaining "Mission Control" framing and clarify visible rail concepts.
2. Add stale-state hygiene so old `state=blocked` / `edgeLoop` visual QA URLs cannot look like current product truth.
3. Extend the ranked action engine so each action has target, reason, disabled reason, and evidence link.
4. Replace passive zero-metric panels with state-aware empty/action states.
5. Start the provenance model by linking changed files to pane/session/agent/worktree where evidence exists.
6. Promote Conductor when parallel sessions exist.
7. Add tests for rail action ranking, stale-state truth, and changed-file provenance.
8. Add visual QA scenarios for idle, running, blocked, review-ready, unhealthy, and stale-debug-state.

This is the highest leverage slice because it changes the product from "feature collection" to "work command center" without requiring a full native rewrite.

## Source Notes

- PraisonAI: https://github.com/MervinPraison/PraisonAI
- Warp Agents: https://docs.warp.dev/agents/agents-overview
- cmux Concepts: https://cmux.com/docs/concepts
- cmux Getting Started: https://cmux.com/docs/getting-started
- WezTerm: https://wezterm.org/
## 2026-05-22 Final Evidence Refresh

- Current release score evidence: `96/100`, `321/335`.
- `releaseCandidateReady=false`; final-goal audit status is `blocked-by-external-gates` until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` are both proven.
- Authenticated prompt execution remains gated by `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` and explicit consent; the safe proof registry is `27/27`.

## 2026-05-24 Release Evidence Refresh

- Current hybrid release score evidence: `96/100`, `321/335`, `releaseCandidateReady=false`.
- Final-goal audit status is `blocked-by-external-gates` for the current Tauri/React plus Rust-core product boundary until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` both pass.
- The release goal is now native-first hybrid; see `docs/NATIVE_FIRST_HYBRID_PRODUCT_GOAL.md`.
- The older full-native Rust plan remains as a strict stretch audit in `docs/FULL_NATIVE_RUST_FINAL_GOAL.md`.

## 2026-05-28 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `90/100`, `303/335`, `releaseCandidateReady=false`.
- Current score after the fresh final-goal evidence map is `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for authenticated AI CLI prompt smoke.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `27/27`.

## 2026-05-31 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `93/100`, `313/335`, `releaseCandidateReady=false`.
- Projected score after the fresh final-goal evidence map remains `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- The terminal render-fidelity gate is green, including the Sharp text path that avoids terminal-shell backdrop blur for canvas glyph clarity.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for `authenticated-ai-cli-prompt-smoke`.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `27/27`.
