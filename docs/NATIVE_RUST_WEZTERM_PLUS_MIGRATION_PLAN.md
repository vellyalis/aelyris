# Native Rust / WezTerm-Plus Migration Plan

Date: 2026-05-12
Updated: 2026-05-13

## Position

Aether should target a native Rust product, but not by rewriting the whole app in one jump.
The current backend already contains the important terminal foundations:

- `portable-pty` for PTY management
- `alacritty_terminal` for terminal parsing/grid state
- Rust session, pane, snapshot, scrollback, API, workflow, git, and audit modules
- Tauri/WebView only as the application shell and React UI host

The safest path is to make the Rust core the product boundary first, then replace the React/WebView shell.

Detailed Rust-core goals, grade ladder, acceptance criteria, and performance budgets are locked in
`docs/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md`.

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

### 2026-05-13 Plan Correction

The full-native plan still stands, but the ordering should be stricter:

- Phase 1 is no longer just "build Rust core." A first slice is already in place: typed mux graph, mux HTTP API, `aetherctl`, live detach/attach, durable scrollback capture, and a mux performance gate.
- The immediate blocker before a native shell spike is now UI ownership: React must stop inventing pane topology that Rust cannot see. Split/close operations should flow through Rust mux first, and the UI should attach to returned pane ids.
- Native-shell work should start as an attaching client, not as a parallel terminal implementation. If it cannot drive the same mux daemon/API, it is premature.
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

1. Stop adding UI-only terminal behavior in React unless it is temporary.
2. Move mux/session/keymap/layout/scrollback contracts fully into Rust.
3. Add a native-shell spike crate that attaches to the same Rust core.
4. Convert the right rail into an action-oriented command center, not a passive dashboard.
5. Maintain Tauri as the shipping UI until native shell wins on measurable latency and feature parity.
