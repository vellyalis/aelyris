> **Historical snapshot.** This document may contain stale scores or older release language. Current public readiness is controlled by `README.md`, `docs/README.md`, `docs/requirements.md`, and locally regenerated verifier artifacts. As of the 2026-06-28 public-doc refresh, Aether is alpha / not release-ready.
# Native Rust / WezTerm-Plus Migration Plan

Date: 2026-05-12
Updated: 2026-06-28

## Current Canonical State - 2026-06-28

- `pnpm verify:quality-score` currently reports `73/100`, grade `D`, `255/351`, `releaseCandidateReady=false`; this is the controlling machine truth for the current branch.
- `pnpm verify:final-goal-audit` currently reports `blocked`: `goalComplete=false`, `evidenceComplete=false`, `implementationFixableCount=5`, `policyBlockedCount=1`, `externalBlockedCount=14`, `missingRequirements=[]`, `externallyBlockedRequirements=[rust-native-terminal-core, rust-mux-daemon-boundary, right-rail-command-center, release-operations-proof]`.
- `pnpm verify:bundle-budget` is green after moving motion-driven HUD/onboarding work out of the initial bundle; current initial gzip is `327062/368640`, and editor assets remain lazy.
- The world-class claims remain blocked: tmux, BridgeSpace, Ghostty/WezTerm-class daily-driver quality, and release readiness must not be claimed until the current release-quality and world-class gates pass.
- The required safe proof registry target is `27/27`, but current final-goal evidence is not complete; stale historical `27/27` phase notes below are retained only as history unless refreshed by the current gate chain.
- Long external/operator gates persist `.codex-auto/quality/goal-operator-progress.json` with `lastHeartbeatAt`, `nextHeartbeatAt`, active step, and next action, so resumed work can distinguish a real stall from a sleep/token/signing handoff.
- `pnpm verify:goal:finalize` excludes git finalization by default; set `AETHER_GOAL_FINALIZE_INCLUDE_GIT=1` only when commit/merge readiness is intentionally in scope.
- Git finalization is an optional handoff gate, not required for product/safe/finalize evidence: `.codex-auto/quality/git-finalization-readiness.json` records the exact commit/merge runbook when `.git/index.lock` or `.git/objects` permission errors block staging.
- `real-os-soak` is host-blocked, not passed: the native sleep command returned `SetSuspendState returned false; GetLastError=50`, while native sleep/postcheck preflights and the no-real-sleep-claim postcheck writer pass.
- `authenticated-ai-cli-prompt-smoke` is not run by default because it may spend tokens; `authenticated-ai-cli-consent-packet` must prove the required `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` boundary before any future token-spending prompt run.
- Current implementation-fixable risks are limited to the `world-class-terminal-ai-os` aggregate gate and its tmux, BridgeSpace, Ghostty/WezTerm-class, and release claim blocks. `rust-native-terminal-core`, `rust-mux-daemon-boundary`, `right-rail-command-center`, and `release-operations-proof` are no longer missing final-goal requirements; they are external-blocked proof paths backed by current artifacts. The remaining host/operator gates are mux live restore, npm supply-chain audit, chunked OSC live proof, Tauri/right-rail live visual proof, live/multipane/recovered/process-reconnect command evidence, release signing/updater, and real OS sleep (`spawn EPERM`, WebView2/CDP unavailable, signing material absent, or `SetSuspendState` unsupported). `authenticated-ai-cli-prompt-smoke` remains explicit-consent blocked. Command Center scenario plus provenance/recovery/context-pack evidence are proved; theme customization, fallback/stale visibility, AI CLI launch planner, right-rail command-evidence jump coverage, and right-rail final goal visibility remain proved. The product must still not claim tmux/BridgeSpace/Ghostty/release parity until the world-class gate passes.
## Position

Aether should target a native Rust product, but not by rewriting the whole app in one jump.
The current backend already contains the important terminal foundations:

- `portable-pty` for PTY management
- `alacritty_terminal` for terminal parsing/grid state
- Rust session, pane, snapshot, scrollback, API, workflow, git, and audit modules
- Tauri/WebView only as the application shell and React UI host

The safest path is to make the Rust core the product boundary first, then replace the React/WebView shell.

Detailed Rust-core goals, grade ladder, acceptance criteria, and performance budgets are locked in
`docs/history/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md`.

The product edge for the right rail, agent orchestration, review loop, and PraisonAI/Warp/cmux-style
command-center experience is locked in `docs/history/AETHER_COMMAND_CENTER_EDGE_PLAN.md`.

## What WezTerm Sets As The Bar

WezTerm is not just a renderer. The competitive bar is:

- GPU terminal rendering
- tabs, panes, windows, workspaces
- local and remote multiplexing domains
- native mouse and scrollback
- rich keybindings and leader/prefix style workflows
- hot-reloadable configuration
- image protocol support
- font fallback, ligatures, emoji, true color, rich text attributes
- CLI control over running windows/tabs/panes

Aether must match the terminal baseline and exceed it through project/AI-native workflows.

## Where Aether Can Actually Beat WezTerm

We should not try to beat WezTerm by being "another configurable terminal." The edge should be:

- Project-aware mux: panes belong to a repo, worktree, task, workflow, or agent run.
- AI-aware sessions: Claude/Codex/Gemini panes are first-class and resumable.
- Failure-aware terminal: detect failed commands, slow spawns, stuck agents, denied tools, and propose recovery.
- Review-aware workspace: changed files, generated diffs, tests, PR state, and agent provenance are linked to panes.
- Operational replay: session restore includes layout, cwd, shell, scrollback, prompt marks, command blocks, failures, and agent context.
- Right rail as command center: not a passive dashboard, but a task launcher, reviewer, recovery panel, and routing surface.

This is the reason Aether should exist.

## Native Rust Options

### Option A: Keep Tauri, Native Terminal Core

Keep React for now, move all terminal/mux behavior into Rust.

Pros:
- Lowest short-term risk.
- Existing UI keeps working.
- Lets us ship mux, persistence, keymaps, scrollback, and performance fixes first.

Cons:
- Still WebView UI.
- Cannot claim full native.
- UI smoothness remains bounded by JS/DOM.

Recommended as Phase 1.

### Option B: Full Native Rust Shell

Replace React/Tauri UI with a Rust GUI shell using a custom renderer.

Likely stack:
- Windowing: `winit`
- Rendering: `wgpu`
- Terminal model: existing `alacritty_terminal`
- PTY: existing `portable-pty`/ConPTY integration
- Text shaping: `cosmic-text` or equivalent
- UI widgets: custom retained UI, `egui`, `iced`, or GPUI-style architecture
- Config: TOML/Lua-compatible layer

Pros:
- Real native performance ceiling.
- No WebView process identity.
- Better control over IME, compositor, latency, and GPU rendering.

Cons:
- Large rewrite.
- Monaco replacement is non-trivial.
- Accessibility, text input, IME, menus, drag/drop, file dialogs, and rich panels all need native equivalents.
- Pixel parity with current UI is not realistic without rebuilding a custom design system.

Recommended as Phase 2/3 after Rust core contracts are stable.

### Option C: Fork/Embed WezTerm

Use WezTerm as terminal/mux foundation and layer Aether project/AI surfaces around it.

Pros:
- Fastest route to terminal parity.
- Mature renderer/mux/config/keymap baseline.

Cons:
- Deep integration cost.
- Product identity and architecture become coupled to upstream internals.
- Aether-specific project/AI state may fight WezTerm abstractions.

Only worth a spike if pure Aether mux/render work slips.

## Can We Reimplement The Same App 1:1 In Full Native Rust?

Behaviorally: yes, with enough time.

Literally the same implementation: no.

React, Radix, Monaco, CSS, browser file inputs, DOM layout, and WebView rendering do not transfer 1:1 to native Rust. They need equivalents:

- Monaco editor -> native editor component or embedded editor engine
- Radix dialogs/menus/selects -> native/custom widget system
- CSS variables/themes -> Rust theme token engine
- DOM layout -> custom layout engine or UI framework
- Web image/file APIs -> native filesystem/dialog APIs
- Browser preview QA -> native visual regression harness

The correct goal is feature parity plus better latency, not source-level parity.

## Migration Phases

### 2026-05-22 Current-State Audit

The 2026-05-13 ordering is still correct, but the baseline has moved.

Current verified state:

- The terminal/core implementation is no longer blocked by an implementation-fixable release issue. `pnpm verify:quality-score` reports `95/100`, grade `A`, `317/335`, `releaseCandidateReady=false`; `pnpm verify:goal:safe` reports `blocked-by-external-gates` with `27/27` proof artifacts passing and `0` implementation-fixable blockers, including the objective-level `goal-completion-matrix`, current supply-chain audit proof, `goal-external-gate-readiness`, optional git handoff artifacts, `glass-legibility-contract`, `right-rail-information-density-contract`, `agent-team-orchestration-readiness`, `release-signing-operator-handoff`, and `goal-anti-stall-contract`. The current state is `blocked-by-external-gates` because release signing/updater material, real OS sleep/resume, and `authenticated-ai-cli-prompt-smoke` require operator action. `authenticated-ai-cli-consent-packet` is green and requires both `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` before that prompt smoke is run.
- `pnpm verify:release:production`, strict release doctor, signed updater artifacts, and `latest.json` remain release-chain evidence, but they do not override the current authenticated prompt consent gate.
- xterm.js is no longer the terminal dependency. `package.json` has no `@xterm` dependency, terminal parsing/grid state is Rust-owned through `alacritty_terminal`, and the UI renders Rust terminal snapshots through the current Canvas/WebView shell.
- PTY lifecycle, sidecar control, mux inspection, `aetherctl`, durable scrollback capture/search, mux performance, and real OS sleep/resume evidence are release-gated.
- The native Windows input path has advanced from "IME placement helpers" to a Tauri-default native HWND input surface scaffold. The WebView textarea remains only as a non-Tauri/emergency fallback and test compatibility path; it is not the desired long-term product boundary.
- The Rust mux now covers split, close, resize, move, swap, even, tiled, rotate, break, join, zoom, broadcast, synchronized panes, detach, attach, scrollback search, and prefix/keymap dispatch.
- `aether-native` now exists as a no-WebView Rust client spike that attaches to the same daemon instance and proves list, send, capture, detach, and attach through the mux API.
- `aether-native window-proof` now creates a layered Win32 native window in the `aether-native` process and records HWND, alpha, no-activate behavior, executable identity, and `webviewUsed=false` / `reactUsed=false`.
- `aether-native render-proof` now reads a daemon session capture and renders the captured terminal text through Win32/GDI into a native memory DC, recording draw calls and non-background pixel samples. This still does not claim native GPU terminal rendering yet; it locks the native process/window/text-render/daemon boundary before the compositor work.
- `aether-native grid-render-proof` now reads daemon capture, feeds it into Rust `TermEngine`, and renders a 100x24 terminal cell grid through native Win32/GDI with nonblank cell and pixel evidence. This proves terminal-grid ownership beyond raw text drawing while still keeping `winit`/`wgpu` and native IME dogfood as explicit next steps.
- `NativeRenderFrame` now exists as a renderer-neutral Rust contract (`aether.native.render-frame.v1`) between `GridSnapshot` and native drawing. The live native proof emits a stable frame hash and proves the Win32/GDI renderer consumed the same frame, so the next `winit`/`wgpu` renderer can replace GDI without inventing a new terminal truth.
- Right-rail smoke and action-clarity gates pass, but the product opportunity is still underdeveloped: the rail is not yet the unmistakable reason to choose Aether over tmux plus AI CLIs.

Corrections to the old plan:

- Phase 1 is no longer "build the Rust core from scratch." The new Phase 1 is "make the current Rust core the only terminal truth and remove remaining compatibility shadows."
- Phase 2 should not begin by recreating the entire app UI. It should start with a native attaching terminal client that proves the daemon/API boundary, renderer-neutral native frame contract, native text/grid rendering, native text input, GPU terminal rendering, transparency, and process identity.
- Phase 3 should not carry Monaco forward as a parity requirement. The default product direction is VSCode/external editor for full editing, while Aether keeps review, diff, provenance, command center, and terminal-native context.
- The full-native shell is now primarily a UI/compositor/accessibility problem, not a PTY/mux correctness problem.

### Revised 2026-05-19 Native Path

#### Phase 1A: Delete Remaining Terminal Compatibility Shadows

Duration: 1-2 weeks.

Goal: make the current Tauri shell honest: terminal truth is Rust-owned, with no silent WebView fallback changing semantics.

Deliverables:

- Gate that fails if the normal Tauri terminal path mounts the legacy WebView IME textarea as input owner.
- Native input dogfood matrix for PowerShell, cmd, Codex CLI, Claude Code CLI, Gemini CLI, split panes, DPI changes, and resize.
- Clipboard and paste guard verification on the native input surface, including empty image paste, multiline paste, destructive command paste, and Japanese text.
- A fallback registry that records every use of emergency fallback paths in telemetry and release evidence.
- Console-flash regression gate for pane split/new shell/open folder/close pane.

Exit criteria:

- Native input is the measured default for Tauri.
- Any fallback use is visible, counted, and treated as a release-risk signal.
- The user cannot trigger a normal terminal action that briefly foregrounds `cmd.exe` or PowerShell.

#### Phase 1B: Daemon-First Product Boundary

Duration: 2-4 weeks.

Goal: make Aether behave like a real mux product where the UI is only a client.

Deliverables:

- Background mux daemon lifecycle that outlives the UI shell by policy, not just by sidecar accident.
- Named sessions, window groups, and attach permissions.
- `aetherctl` parity for list/create/attach/detach/split/join/swap/move/layout/send/capture/search/export/import.
- Daemon restart and UI crash tests that prove live/detached/dead state is never lied about.
- Config reload for keymaps, startup layout, shell profiles, and theme terminal tokens.

Exit criteria:

- Closing the UI can leave selected sessions running.
- A fresh UI or CLI can attach to the same session graph.
- React/Tauri owns presentation only; it does not invent terminal topology.

#### Phase 2A: Native Terminal Client Spike

Duration: 3-6 weeks.

Goal: prove the full-native path without rebuilding the entire workspace shell.

Likely stack:

- `winit` for windowing.
- `wgpu` for terminal and glass/compositor rendering.
- `cosmic-text` or equivalent for shaping, fallback fonts, emoji, and IME-aware text metrics.
- Existing `alacritty_terminal` model and mux daemon/API as the data source.
- Windows DWM integration for Mica/Acrylic/transparent window treatment.

Deliverables:

- `aether-native` crate that attaches to the current mux daemon.
- One native transparent window with tab/pane terminal rendering.
- Japanese IME and clipboard path entirely outside WebView.
- Image-background, opacity, cover/contain/position, and Sakura/glass token prototype.
- Task Manager/process identity proof: visible as Aether-native/Aether, not generic WebView.

Exit criteria:

- Native client can operate one real project session for an hour without WebView.
- Split/attach/input/resize latency beats the current Tauri shell.
- The client can be thrown away without changing mux/core APIs.

#### Phase 2B: Native Glass Design System

Duration: 4-8 weeks.

Goal: make "React-like transparency and UI" a native design system instead of a visual approximation.

Deliverables:

- Native design tokens for color, alpha, blur, radius, typography, density, and semantic states.
- Theme editor model that covers preset colors, opacity, image background path/picker, scale, position, repeat, and per-surface material.
- Native controls for buttons, segmented tabs, menus, dialogs, tooltips, scrollbars, list rows, graph nodes, and cards.
- Contrast engine that checks text against composited material/background state.
- Visual regression harness that can compare native screenshots across themes and DPI.

Exit criteria:

- Sakura and every preset can be tuned without gray, muddy, or low-contrast surfaces.
- Native UI supports the same customization classes that users expect from WezTerm-style configuration plus Aether's visual presets.

#### Phase 3: Command Center Native Workspace

Duration: 8-16 weeks.

Goal: move only the pieces that make Aether differentiated, not generic editor bulk.

Deliverables:

- Native right rail command center.
- Native file tree, review queue, run graph, decision inbox, context packs, and workflow run trace.
- External editor first: VSCode open/diff is the default; built-in editor is optional or removed from the native shell.
- Workflow/agent/provenance surfaces bound to the mux graph.
- Accessibility and keyboard navigation equivalent to or better than the Tauri shell.

Exit criteria:

- A developer can run parallel AI/dev sessions, review changes, recover failures, and ship without the WebView shell.
- The native shell is chosen because it is faster, clearer, and more controllable, not merely because it is native.

#### Phase 4: WezTerm-Plus / Aether Edge

Duration: 4-8 weeks.

Goal: exceed terminal parity through local-first project/AI control.

Deliverables:

- Remote/domain architecture spike using the same `PtyEndpoint` abstraction.
- Hot-reload config for mux, keymap, theme, shell profile, background image, rail policy, and guardrails.
- Run trace export/import.
- Project memory/context-pack hooks.
- Recovery playbooks for stuck agent, failed command, denied tool, high context, broken worktree, and release gate failure.

Exit criteria:

- Aether can honestly be pitched as "future tmux/WezTerm-grade terminal-control target (not a current public claim) plus project-aware AI command center."

### Edge Upgrades Added By This Audit

These are the highest-leverage ways to turn the product from "good terminal workspace" into a differentiated product:

1. Native terminal cockpit:
   - show shell/profile, cwd, branch, role, sync mode, risk state, and owner directly in the pane header;
   - make split/move/swap/join/broadcast/sync discoverable without reading shortcut docs;
   - keep every action backed by Rust mux state.

2. Provenance-first review:
   - every changed file links to pane, agent, worktree, command block, workflow, and final report;
   - review queue becomes the "why did this change?" surface, not just a file list.

3. Recovery command center:
   - failed commands, stuck agents, denied tools, high context, missing binaries, and slow spawns become ranked actions;
   - recovery attempts are stored in the audit trail.

4. Context packs and local memory:
   - reusable packs of files, terminal blocks, docs, prior reports, rules, and exclusions;
   - visible token/context budget before launching an agent.

5. Native visual customization:
   - per-surface opacity and material;
   - background image picker, scale, position, repeat, dim/blur;
   - contrast-aware theme editor so Sakura/glass presets cannot regress into muddy gray.

6. Native attach client:
   - prove the full-native direction with a small terminal-first client before rewriting settings, file tree, workflows, or review UI.

### 2026-05-13 Plan Correction

The full-native plan still stands, but the ordering should be stricter:

- Phase 1 is no longer just "build Rust core." A first slice is already in place: typed mux graph, mux HTTP API, `aetherctl`, live detach/attach, durable scrollback capture, and a mux performance gate.
- The immediate blocker before a native shell spike is now UI ownership: React must stop inventing pane topology that Rust cannot see. Split/close operations should flow through Rust mux first, and the UI should attach to returned pane ids.
- Native-shell work should start as an attaching client, not as a parallel terminal implementation. If it cannot drive the same mux daemon/API, it is premature.
- The first attaching client, Win32 window proof, and daemon-capture native text render proof are now in place through `aether-native` and `pnpm verify:terminal:native-client`; the next native step is the actual `winit`/`wgpu` terminal renderer plus native IME dogfood, not another parallel API client.
- The daemon boundary is now more valuable than a direct rewrite. Full-native Rust should replace the WebView shell only after the sidecar/daemon contract proves session survival, layout replay, keymaps, scrollback, and IME behavior.
- Time estimate is unchanged for full product parity, but risk has shifted: terminal core parity is moving down, native UI/editor/accessibility parity remains the expensive part.

### Phase 0: Product Bar Lock

Duration: 1 week

Deliverables:
- WezTerm/tmux/ccmux parity matrix
- Aether edge feature list
- latency budgets: launch, split pane, close pane, input echo, IME, resize, scroll
- native architecture decision record

Exit criteria:
- No vague "native rewrite" scope.
- Every terminal feature has an owner module and test strategy.

### Phase 1: Rust Core Becomes The Contract

Duration: 3-6 weeks

Deliverables:
- persistent mux server model and UI-to-mux bridge
- stable pane/tab/window/workspace API
- prefix/keymap engine in Rust
- pane move/swap/tiled/even layouts
- durable scrollback and command-block journal
- CLI/API for session control
- performance telemetry around spawn/split/close/render

Exit criteria:
- React UI can be killed/restarted without losing sessions.
- A separate client can attach to the same running session graph.
- React split/close/layout commands are clients of Rust mux, not independent sources of truth.

### Phase 2: Native Shell Prototype

Duration: 4-8 weeks

Deliverables:
- `aether-native` prototype crate
- one window, tabs, panes, native GPU terminal surface
- IME path validated on Windows Japanese input
- settings and theme token rendering
- image rendering and scrollback

Exit criteria:
- native shell can attach to Phase 1 mux server
- split/open/close latency beats Tauri shell
- no CMD/PowerShell console flash

### Phase 3: Native Workspace UI

Duration: 8-16 weeks

Deliverables:
- file tree
- native editor or embedded editor substitute
- command palette
- right rail command center
- settings UI
- agent/session inspector
- diff/review UI

Exit criteria:
- daily driver parity with current app
- accessibility and keyboard navigation pass
- release packaging works without WebView branding/process confusion

### Phase 4: Product-Grade WezTerm-Plus

Duration: 4-8 weeks

Deliverables:
- config hot reload
- keymap compatibility layer
- remote domain/SSH story
- plugin/automation surface
- visual QA and perf regression suite
- migration path from current Tauri config/state

Exit criteria:
- Aether has terminal parity plus project/AI-native edge
- current Tauri shell can be deprecated

## Rough Time Estimate

Minimum credible path:
- Rust core parity: 1-1.5 months
- native shell prototype: 1-2 months
- full app parity: 2-4 months
- hardening/release: 1-2 months

Total: 5-9 months for a serious full-native product, assuming focused engineering.

Trying to rewrite everything directly is likely slower than the phased path.

## Immediate Next Work

1. Delete or hard-gate remaining terminal compatibility shadows, especially normal-path WebView textarea ownership.
2. Make daemon-first session survival and `aetherctl` parity the next Rust-core product boundary.
3. Add the `aether-native` terminal client spike only as an attaching client to the current mux daemon/API.
4. Convert the right rail into an action-oriented command center with provenance, recovery, context packs, and ranked next actions.
5. Keep Tauri/React as the shipping UI until the native client beats it on latency, IME, customization, accessibility, and daily workflow parity.
## 2026-05-22 Final Evidence Refresh

- Current release score evidence: `96/100`, `321/335`.
- `releaseCandidateReady=false`; final-goal audit status is `blocked-by-external-gates` until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` are both proven.
- Authenticated prompt execution remains gated by `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` and explicit consent; the safe proof registry is `27/27`.

## 2026-05-24 Release Evidence Refresh

- Current hybrid release score evidence: `96/100`, `321/335`, `releaseCandidateReady=false`.
- Final-goal audit status is `blocked-by-external-gates` for the current Rust-core/Tauri product boundary until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` both pass.
- The full-native Rust target is intentionally stricter and is now tracked by `docs/history/FULL_NATIVE_RUST_FINAL_GOAL.md` plus `pnpm verify:full-native:audit`.

## 2026-05-31 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `93/100`, `313/335`, `releaseCandidateReady=false`.
- Projected score after the fresh final-goal evidence map remains `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- Native-first hybrid is the release target; full-native Rust remains a stricter migration track after the current Rust-core/Tauri shell is externally unblocked.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for `authenticated-ai-cli-prompt-smoke`.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `27/27`.
