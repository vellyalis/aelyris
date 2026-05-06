# Aether Terminal Quality Audit

Date: 2026-05-02  
Scope: Aether Terminal app, AI workstation surfaces, terminal/IME reliability, pane/process/session model, longrun/ops dashboard, release and verification system.

## Executive Score

Overall: **7.9 / 10**

Target for wizard-grade: **9.3+ / 10**

Aether is no longer a prototype shell. It has a serious terminal surface, right-rail workstation model, process manager, live pane truth, review/observe/command modes, IME verification, release gates, visual QA, and a longrun monitoring stack. The remaining gap is not one missing button; it is the absence of a fully authoritative operational core that makes every pane, agent, tool call, retry, file change, context budget, and recovery event replayable and trustworthy across crashes, sleep/resume, reloads, and multiple projects.

## Evidence Checked

- `AGENT_STATE.md`: roadmap reports complete, no active blocker.
- `.codex-auto/final-report.md`: release pass and IME CDP validation completed, with open residual risks.
- `.codex-auto/risk-register.json`: open risks remain around event-bus/DB E2E, IME blur, live-pane attach affordance, pane fingerprints, and process metrics truth.
- `package.json`: release, IME, dist, test, e2e, lint, and Tauri build scripts exist.
- `scripts/verify-release-gate.mjs`: checks TypeScript, Rust check, focused workstation Vitest, dist artifacts, optional native IME CDP verification.
- `scripts/verify-ime.mjs`: live WebView2 CDP IME pipeline verifier exists.
- `e2e/visual-qa-layout.spec.ts`: width stability, overflow, rail modes, logs suppression, process selector, and pane switcher visual guards exist.
- Browser check:
  - `http://127.0.0.1:47822/` dashboard rendered and had no console warnings/errors.
  - Current old `http://127.0.0.1:47820/` view appeared visually empty at first viewport despite rich DOM, which is a monitoring UX risk.
  - `http://localhost:1420/?aetherVisualQa=1` rendered the app visual QA state and had no console warnings/errors.
- Fresh all-suite Vitest attempt did not complete within 120s in this audit turn, so this document treats previous release-gate evidence as the latest passing proof and marks full-suite recency as unresolved.

## Scorecard

| Area | Score | Assessment |
| --- | ---: | --- |
| Terminal / IME correctness | 8.4 | Live WebView2 CDP verification is a major milestone. Still needs blur/paste/DPI/multi-shell/live-AI-CLI matrix hardening. |
| Pane / tmux-style workspace model | 7.6 | Split panes, pane roles, process manager, live pane merge, attach/resume groundwork exist. Missing true terminal session server semantics, layout resurrection guarantees, and first-class attach from every relevant surface. |
| AI workstation information architecture | 8.0 | Command/Review/Observe rail and pulse/process/context/run ledger model is strong. Several panels are still empty-state heavy until telemetry is authoritative. |
| Agent telemetry durability | 7.2 | Frontend/backend snapshots improved, but per-event transactional backend persistence and real Tauri event-bus plus DB-write E2E remain open. |
| Review / SCM workflow | 7.5 | Review Queue and SCM surfaces exist. Needs diff risk scoring, test impact, dependency/security weighting, reviewed state, owner/agent assignment, and merge-readiness gate. |
| Workflow / automation control | 7.8 | Longrun taxonomy, retry policies, probes, watchdog, dashboard, and final reports exist. Needs one authoritative run supervisor reusable across projects and clearer stuck/blocked semantics. |
| Operational resilience | 7.7 | Sleep/resume and completion notifications were considered, blocker handling improved. Browser notification permission can still be denied, dashboard ports can diverge, and stale/old dashboards can confuse the user. |
| UI layout / visual polish | 7.6 | Design is much cleaner and denser. Remaining issues are small but important: viewport-dependent narrow terminal, tiny rail typography, ambiguous old dashboard state, alignment/scroll anchoring, and mixed density rhythm. |
| Typography / readability | 7.4 | IBM Plex is a good base. Current UI has too many micro labels in dense rails, inconsistent case/rhythm, and some low-information labels competing with command surfaces. |
| Observability / auditability | 8.1 | Risk register, validation ledger, final report, progress dashboard, and audit timeline exist. Needs single event journal as source of truth and user/Codex notification delivery that cannot silently fail. |
| Release / distribution | 8.0 | Dist and release scripts exist, icons were updated, and release gate is mature. Still needs signed Windows build, updater/channel policy, crash logs, installer smoke, and rollback plan. |
| Security / permission safety | 7.3 | Tool/permission observability exists. Needs redaction, explicit command risk classes, approval replay, secret scanning, and safe-mode policy surfaced in UI. |

## Highest Priority Gaps

1. **Authoritative Event Store**
   - Add an append-only SQLite event journal for terminal, agent, tool, workflow, process, pane, review, and watchdog events.
   - Every UI panel should be derived from this journal or from typed backend snapshots produced by it.
   - This closes telemetry loss, empty panels, event ordering, and restart replay gaps.

2. **Real Tauri Event Bus + DB Snapshot E2E Harness**
   - Current tests cover many units and focused flows, but the remaining high-risk gap is one harness that proves event emission, IPC serialization, frontend subscription, and DB snapshot writes together.
   - Required scenarios: agent output, watchdog decision, tool result, session completion, crash/reload replay.

3. **Terminal Input Torture Matrix**
   - Keep the live CDP IME test, then expand it to PowerShell, cmd, WSL, Git Bash, Claude Code, Gemini CLI, Codex CLI.
   - Cover long Japanese preedit, conversion candidate popup, blur during composition, paste while composing, Backspace/Delete conversion, resize while composing, DPI 100/125/150%, and alternate screen.

4. **True tmux Layer**
   - Treat panes as durable sessions with names, roles, layout ids, process ids, terminal ids, cwd, branch, command, and attach state.
   - Add resurrect, detach, attach, broadcast, synchronized input, named layouts, pane search, and session export/import.
   - `Live Panes`, `Process Manager`, and `Pane Switcher` should all expose the same attach contract.

5. **Unified Workstation Graph**
   - One graph should connect agents, panes, workflows, tool calls, changed files, review queue items, tests, risks, blockers, and handoffs.
   - Right rail widgets should become filtered views of this graph, not separate truth islands.

6. **Review Queue v2**
   - Add file risk classes, diffstat weighting, test impact, security/config/dependency flags, conflict state, reviewed/approved/skipped state, and generated validation plan.
   - Add cluster actions: spawn reviewer, run targeted tests, open diff, stage safe cluster, request human decision.

7. **Dashboard Truth and Notification Delivery**
   - Only one canonical dashboard URL per workspace/thread.
   - Old ports should redirect or show "stale dashboard; go to current".
   - Browser notifications must have fallback: in-app toast, dashboard notification, Codex-thread heartbeat, and final report summary.
   - Scroll position must be preserved while state refreshes.

8. **Design System Hardening**
   - Define density modes: Focus, Balanced, Dense.
   - Define strict type scale for rail labels, card titles, telemetry numbers, and terminal chrome.
   - Add visual QA for all right rail modes at 584/960/1440/1920 widths, scrollbar present/absent, and 100/125/150% DPI.
   - Prevent panel width jumps with reserved scrollbars and stable grid tracks.

## Existing Features To Strengthen

### Terminal

- Preserve/commit IME composition on blur instead of clearing preedit.
- Add explicit input-state debug overlay for composition, active pane, target terminal id, and write path.
- Make file/image/clipboard attachment in the lower input bar first-class, with clear separation from direct PTY typing.
- Add paste policy: bracketed paste, multi-line preview, binary/image detection, and shell-safe confirmation for dangerous multi-line commands.
- Add terminal render perf budget: frame time, scrollback size, WebGL fallback state, dropped render count.

### Process Manager / Live Panes

- Fix live count semantics so cleanup-only orphan rows are not counted as controllable live panes.
- Add attach action in Live Panes, not only Process Manager.
- Show process tree as application-native rows with CPU/memory/cwd/command/terminal/session, not WebView-like raw process state.
- Add safe kill ladder: interrupt, terminate shell, kill process tree, cleanup orphan record.
- Add post-kill verification and undo-safe messaging.

### Right Rail

- Keep Logs out of primary flow unless an error is active.
- Observe mode should prioritize: Pulse, active runs, process health, context budget, review risk, recovery incidents.
- Review mode should prioritize: Review Queue, changed clusters, tests, SCM, PR readiness.
- Command mode should prioritize: agent launch, workflow templates, toolkit, broadcast/send controls.
- Add rail pinning and user-custom ordering per workspace.

### Agent Telemetry

- Persist each agent event backend-side with monotonic sequence id.
- Store token/context confidence separately: exact, parsed, estimated, unknown.
- Add per-model context limits and cost model metadata.
- Add "handoff needed soon" prediction and automatic context pack generation.

### Workflows

- Persist phase duration, retry count, produced artifacts, commands run, validation evidence, and final report.
- Add retry policy by failure kind directly in workflow UI.
- Add "resume from phase", "split heavy task", and "convert blocker to decision request".

### Dashboard / Longrun

- Replace polling refresh flicker with state diffing or SSE/WebSocket.
- Preserve scroll position and expanded/collapsed sections across refresh.
- Make blocked categories visible as explicit lanes: permission, external dependency, validation, oversized, timeout, product decision.
- Add "why stopped" and "what would restart it" next to every blocked card.
- Store final report summaries per workspace/thread and surface them in the current Codex thread.

## New Features To Add

1. **Mission Control Home**
   - A single first screen: active project, active agents, panes, review queue, context budget, risk, blockers, current next action.

2. **Context Pack Builder**
   - Auto-build a handoff packet from changed files, terminal output, test results, risks, decisions, current pane state, and agent transcripts.

3. **Agent Run Graph**
   - Visual DAG of parent agent, subagents, tools, files changed, tests run, blockers, and final result.

4. **Gantt + Kanban Hybrid**
   - Kanban for state, Gantt for time/budget/dependencies.
   - Show actual elapsed time versus planned estimate and blocked duration.

5. **Command Risk Firewall**
   - Classify commands before execution: read-only, build/test, file mutation, delete, network, secret-bearing, package install, destructive.
   - Tie classification to approval and audit logs.

6. **Workspace Profile System**
   - Per-project defaults for shell, model, agents, workflows, watch rules, safe paths, dashboard port, notification policy, and visual density.

7. **Chaos / Recovery Test Pack**
   - Simulate sleep/resume, network loss, killed CLI, killed dashboard, killed PTY, full reload, localStorage deletion, DB lock, and port conflict.

8. **Release Doctor**
   - One UI panel for signing state, installer artifact, version match, updater state, icon integrity, tests, known risks, and last successful release gate.

9. **Performance Observatory**
   - Track frame time, terminal render FPS, WebGL fallback, pane count, scrollback memory, event queue lag, IPC latency, and DB write latency.

10. **Human Decision Inbox**
    - Separate self-healable blockers from true human decisions.
    - Present only the minimum required decision with context, risk, recommended option, and consequence.

## Design / Typography Findings

- The visual direction is now credible: dark glass, compact right rail, icon controls, and distinct rail modes are aligned with an AI workstation.
- The main risk is over-density without hierarchy. Some rail cards expose too many micro labels before the user knows what changed.
- The terminal should remain visually dominant. At narrow widths, the right rail competes with the terminal too aggressively.
- Numeric telemetry needs stronger meaning labels: "0 Ctx / 0 Tok / 0 Files" is compact but not self-explaining under empty state.
- Old dashboard ports must not render confusing partial views.
- Use stable spacing rules: equal left/right inset in rail widgets, reserved scrollbar gutter, no width change on tab switch, and no card-in-card visual stacking.

## Operational Quality Findings

- The blocker taxonomy and probe model are a good direction, but the dashboard and monitor must distinguish:
  - completed and intentionally stopped
  - blocked and waiting for user
  - blocked but probing external dependency
  - self-healing retry in progress
  - stale and no longer supervised
- Notification permission being denied cannot be treated as a minor warning. It breaks the user's ability to plan the next task.
- A completed run still needs an always-visible final summary: what changed, where, validation, remaining risk, and next recommended task.
- The system should never silently create new tasks after the user asks about the original task. It should explain whether it is continuing the original roadmap, decomposing a blocker, or starting a new improvement slice.

## Next Implementation Order

1. Canonical dashboard URL and stale-dashboard redirect.
2. Dashboard scroll preservation and no-flicker state updates.
3. Event journal schema and minimal backend append/read IPC.
4. Tauri event-bus + DB snapshot E2E harness.
5. IME blur preservation and expanded terminal input matrix.
6. Live Panes attach action plus process live-count semantics fix.
7. Review Queue v2 scoring model.
8. Context Pack Builder.
9. Gantt/Kanban hybrid for longrun and agent work.
10. Chaos/recovery test pack.

## Definition Of Wizard-Grade

Aether reaches wizard-grade when:

- A user can always answer "what is running, why, what changed, what is blocked, what is next" within five seconds.
- Every important event can be replayed after reload, crash, sleep, or handoff.
- Terminal input is trustworthy across Japanese IME, AI CLIs, shells, resize, paste, and DPI.
- Pane/session/process truth is unified and attachable.
- Review, test, context, and risk are connected instead of separate panels.
- The system self-heals only when safe, stops clearly when not, and reports exactly what happened.
- Visual density is high but calm: no jitter, no hidden truth, no layout jumps, no decorative noise.
