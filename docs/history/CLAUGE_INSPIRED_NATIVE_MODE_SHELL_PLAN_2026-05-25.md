# Clauge-Inspired Native Mode Shell Plan

Date: 2026-05-25

## Reference

- Clauge website: https://clauge.in
- Clauge repository: https://github.com/ansxuman/Clauge

Clauge's useful reference point is not visual skinning. The useful reference is information architecture:

- one window for the developer's work;
- clear mode switching;
- agent sessions with purpose, worktree, context, approvals, and telemetry;
- workspace boards/notes that agents can read and mutate;
- cross-mode history and MCP exposure;
- destructive actions gated by clear approvals.

Aether should not become a broad REST/SQL/NoSQL/S3 super-app before its terminal core is done. Aether's edge remains native terminal-first: Rust mux/session durability, AI CLI reliability, Command Center evidence, recovery, and project-aware automation.

## Product Direction

Adopt the Clauge-style mode architecture while keeping Aether's native Rust terminal as the center of gravity.

The primary native shell should become:

```text
Left Mode Rail -> Center Native Terminal/Workspace -> Right Inspector
```

## Left Mode Rail

Purpose: make "where am I and what can I do?" obvious in the first minute.

Initial native modes:

1. Terminal
2. Agents
3. Workspace
4. Review
5. Git
6. Context
7. History
8. Settings

These replace vague panel discovery with explicit mode identity. The mode rail must be keyboard-first and should map cleanly to `Alt+1` through `Alt+8` or the eventual Aether keymap engine.

## Center Surface

Purpose: keep the current work dominant.

- Terminal mode: native terminal panes, mux tabs/windows, command journal, scrollback.
- Agents mode: purpose-pinned AI CLI sessions, worktree assignment, provider/model, approval policy, context pack.
- Workspace mode: tasks, notes, project status, but only if backed by Rust data contracts.
- Review mode: changed files, risks, checks, recovery, PR handoff.
- Git mode: branch, worktree, status, log, commit/push actions.
- Context mode: pinned files/folders/MCP/context packs.
- History mode: searchable command/session/action history.
- Settings mode: native customization, keymaps, shell profiles, provider profiles.

## Right Inspector

Purpose: explain and operate the selected thing, not act as a noisy dashboard.

The right rail becomes a contextual inspector:

- selected pane/session;
- selected agent;
- selected task/card;
- selected changed file;
- selected workflow/action;
- selected risk/evidence item.

It should show current owner, current goal/purpose, worktree and branch, context pack, approval policy, live status, recovery state, next safe action, and evidence links.

## Native-First Hybrid Integration

This plan is now part of the native-first hybrid product goal, not a requirement to delete React/Tauri everywhere.

Every mode must have a Rust-owned data contract before it is considered native-ready:

- `aether.native.mode-shell.v1`
- `aether.native.mode-rail.v1`
- `aether.native.inspector.v1`
- `aether.native.agent-session.v1`
- `aether.native.context-pack.v1`
- `aether.native.workspace-item.v1`
- `aether.native.history-index.v1`

React/Tauri can preview these during migration, but React must not become the source of truth.

## Native Proof Sequence

### Phase C1: Mode Shell Contract

Goal: define the mode rail and inspector model in Rust.

Deliverables:

- `aether-native mode-shell-proof`
- mode list with ids, labels, shortcuts, and source contracts;
- selected mode state;
- selected entity route;
- right inspector payload for the selected mode;
- no React/WebView dependency.

Exit criteria:

- the native-first release audit keeps a mode shell contract item; the older `pnpm verify:full-native:audit` remains a strict stretch signal.
- Mode shell proof can be emitted by `aether-native`.

### Phase C2: Native Mode Rail Window Proof

Goal: render the mode rail in the native shell.

Deliverables:

- native left rail proof with 8 modes;
- keyboard selection model;
- focused/selected state;
- hit target metadata;
- nonblank pixel proof;
- no React/WebView.

Exit criteria:

- `aether-native mode-rail-window-proof` reports nonblank native rendering and keyboard selection state.

### Phase C3: Right Inspector Unification

Goal: replace the old right rail dashboard concept with a contextual inspector.

Deliverables:

- `aether-native inspector-proof`;
- selected pane/session/agent/task/risk inspector payloads;
- evidence and next-action rows;
- bounded input/scroll/action dispatch model;
- compatibility mapping from current Command Center data.

Exit criteria:

- The existing `command-center-*` native proofs become one inspector mode implementation.
- React right rail is marked compatibility.

### Phase C4: Agent Session Mode

Goal: make agent sessions readable and controllable without the React shell.

Deliverables:

- purpose-pinned sessions;
- worktree assignment;
- provider/model/profile;
- approval policy;
- context pack;
- telemetry summary;
- resume/reconnect state;
- action gates for destructive operations.

Exit criteria:

- A user can create/resume an AI CLI session from the native shell and see its purpose, context, worktree, approvals, and cost.

### Phase C5: Workspace/Review/Git Modes

Goal: make the product edge useful beyond a terminal grid without becoming a generic super-app.

Deliverables:

- task/review state from Rust contracts;
- changed-file and risk inspector;
- git worktree/status/log/commit actions;
- provenance links from pane/session/agent/action to changed files and checks.

Exit criteria:

- The native shell can run the core project loop: open project, spawn agent, assign context/worktree, review changes, recover failures, and hand off to external editor or Git.

### Phase C6: Native Settings Mode

Goal: fold the existing Rust settings proof into an actual native settings mode.

Deliverables:

- theme/material/opacity/wallpaper controls;
- image picker path bridge;
- wallpaper opacity/scale/position;
- shell profiles;
- keymap/prefix settings;
- provider profiles;
- live hot reload.

Exit criteria:

- `native-settings-customization` closes in the full-native audit.

## UI Rules

- The first screen must be usable workspace UI, not a landing page.
- The mode rail is compact, predictable, and keyboard-first.
- The center surface owns the work; the right inspector only explains and acts on the selection.
- Avoid "Mission Control" framing. Use `Modes`, `Inspector`, `Command Center`, or direct labels.
- Avoid broad app sprawl until terminal, agents, review, git, context, history, and settings are native-ready.
- Every destructive action is gated.
- Every fallback is telemetry-visible.
- Every visual surface needs native contrast and pixel QA before release claims.

## Relationship To Current Roadmap

This plan sits inside the revised native-first hybrid phases:

- Phase 3 native input dogfood remains urgent because terminal trust comes first.
- Phase 4 native product shell becomes the Clauge-inspired mode shell.
- Phase 5 release parity includes native visual QA, accessibility, performance budgets, and explicit React/WebView compatibility boundaries.

The native-first hybrid goal in `docs/history/NATIVE_FIRST_HYBRID_PRODUCT_GOAL.md` is now authoritative for release. The strict full-native audit remains useful as a stretch signal, but it no longer defines release completion.

## Immediate Next Implementation

After the current Command Center input/scroll proof, the next high-leverage slice is:

1. Add `aether-native mode-shell-proof`.
2. Add `mode-shell-contract` to `scripts/verify-full-native-rust-gap-audit.mjs`.
3. Make `mode-shell-proof` expose:
   - 8 modes;
   - selected mode;
   - selected entity route;
   - right inspector contract id;
   - next native proof;
   - no React/WebView.
4. Then add `mode-rail-window-proof` to render the left mode rail natively.

## 2026-05-25 C1 Implementation Status

Status: done.

Implemented:

- `aether-native mode-shell-proof`
- `aether.native.mode-shell.v1`
- `aether.native.mode-rail.v1`
- `aether.native.inspector.v1`
- fixed 8-mode list: Terminal, Agents, Workspace, Review, Git, Context, History, Settings
- exact `Alt+1` through `Alt+8` shortcuts
- Rust-owned selected entity routes for all modes
- Command Center-backed contextual inspector
- standalone evidence at `.codex-auto/quality/native-mode-shell-proof.json`
- full-native audit item `native-mode-shell-contract`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `70/100`, `80/114`, `in-progress`.
- C1 proves the native shell contract. It does not yet render the mode rail as the product UI.

Next:

1. Add `aether-native mode-rail-window-proof`.
2. Render the 8-mode rail in a native window with focus/selected state.
3. Add hit-target and keyboard-selection evidence.
4. Keep `readyForReactDemotion=false` until the native rail and inspector are actually rendered and actionable.

## 2026-05-25 C2 Implementation Status

Status: done.

Implemented:

- `aether-native mode-rail-window-proof`
- native Win32 layered mode rail window
- all 8 mode rows rendered from the Rust mode shell contract
- exact hit targets for Terminal, Agents, Workspace, Review, Git, Context, History, and Settings
- selected/focused mode evidence
- keyboard transition evidence
- nonblank pixel evidence
- standalone evidence at `.codex-auto/quality/native-mode-rail-window-proof.json`
- full-native audit item `native-mode-rail-window-proof`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `71/100`, `82/116`, `in-progress`.
- C2 proves the native rail can be rendered and operated as a Rust-native surface. It does not yet prove the right inspector is rendered and actionable without React.

Next:

1. Add `aether-native inspector-window-proof`.
2. Render Command Center-backed contextual inspector data in a native window.
3. Prove action row hit targets, keyboard selection, scroll, and dispatch metadata.
4. Keep React right rail as compatibility until the native inspector can replace it.

## 2026-05-25 C3 Implementation Status

Status: done for the native inspector window proof; React right-rail demotion remains open.

Implemented:

- `aether-native inspector-window-proof`
- native Win32 layered contextual inspector window
- Command Center-backed inspector data
- evidence row rendering
- action row rendering
- action hit targets
- keyboard selection proof
- scroll model proof
- enter dispatch metadata
- no React/WebView dispatch guardrails
- standalone evidence at `.codex-auto/quality/native-inspector-window-proof.json`
- full-native audit item `native-inspector-window-proof`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `71/100`, `84/118`, `in-progress`.
- C3 proves the native contextual inspector can be rendered and operated as a Rust-native surface. The React right rail is not demoted yet.

Next:

1. Add a compatibility-demotion proof for the React right rail.
2. Route the product-edge right rail to native Command Center/mode shell/inspector contracts.
3. Keep React panels as compatibility only once the native shell can replace the daily product edge.

## 2026-05-25 C3.5 Implementation Status

Status: done for demotion readiness; actual React demotion remains open.

Implemented:

- `aether-native right-rail-demotion-proof`
- `aether.native.right-rail-demotion-proof.v1`
- native replacement map for Command Center data, Command Center window, Command Center input/scroll, mode shell, mode rail window, contextual inspector window, and inspector dispatch guardrails
- readiness state `nativeProductPathReady=true`
- honest compatibility state `reactRightRailSourcesPresent=true`
- guardrails that keep `readyForFullNativeClaim=false`
- standalone evidence at `.codex-auto/quality/native-right-rail-demotion-proof.json`
- full-native audit item `native-right-rail-demotion-readiness`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `72/100`, `86/120`, `in-progress`.
- C3.5 proves the native right-rail replacement path is ready to start React demotion. It does not remove React right-rail ownership yet.

Next:

1. Demote the React right rail to compatibility by routing product-edge state through the Rust-native Command Center/mode shell/inspector contracts.
2. Build native Settings mode so customization no longer depends on the React settings dialog.
3. Add live native OS IME dogfood for Codex CLI, Claude Code CLI, and Gemini CLI.
4. Add native accessibility/UIA and visual QA proofs before claiming release-grade full-native parity.

## 2026-05-25 C6 Implementation Status

Status: done for native settings window proof; React compatibility cleanup remains part of the broader WebView demotion.

Implemented:

- `aether-native settings-window-proof`
- `aether.native.settings-window-proof.v1`
- native settings window backed by the Rust settings config proof
- controls for theme, mood, window opacity, wallpaper path, wallpaper opacity, wallpaper position, wallpaper scale, material colors, and palette accents
- hit-target metadata
- keyboard navigation proof
- hot-reload binding proof
- nonblank native window pixel proof
- standalone evidence at `.codex-auto/quality/native-settings-window-proof.json`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `77/100`, `92/120`, `in-progress`.
- C6 closes the `native-settings-customization` audit blocker. It does not by itself make the native shell the primary daily-driver app.

Next:

1. Process live native OS IME events inside `aether-native`.
2. Run Codex CLI, Claude Code CLI, and Gemini CLI prompt-row dogfood against that native input path.
3. Demote the React right rail/settings surfaces to compatibility-only once native daily-driver routing is ready.
4. Add native accessibility/UIA and visual QA proofs.

## 2026-05-25 Native HWND IME Dogfood Status

Status: done for native HWND commit and AI CLI prompt-row dogfood; real OS IME/TSF composition remains open.

Implemented:

- `aether-native ime-dogfood-proof`
- `aether.native.ime-dogfood-proof.v1`
- native Win32 parent HWND creation
- Rust `NativeTerminalInputHost` child HWND focus
- `WM_IME_STARTCOMPOSITION` observation
- Japanese native HWND commit/drain path
- Codex, Claude, and Gemini prompt-row render checks
- no React/WebView ownership
- standalone evidence at `.codex-auto/quality/native-ime-hwnd-dogfood-proof.json`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `78/100`, `94/120`, `in-progress`.
- This proves the native HWND route can carry Japanese committed text into AI CLI prompt rows. It does not prove an actual installed Japanese IME/TSF candidate/composition session yet.

Next:

1. Drive a real installed Japanese IME through the native HWND and capture composition/preedit/result evidence.
2. Keep the prompt-row matrix for Codex, Claude, and Gemini, but replace synthetic `WM_CHAR` commit with real OS IME result text.
3. Continue React right-rail demotion, native accessibility/UIA, and native visual QA.

## 2026-05-25 Native Accessibility Tree Status

Status: done for semantic tree proof; real UIA/accesskit provider dogfood remains open.

Implemented:

- `aether-native accessibility-proof`
- `aether.native.accessibility-proof.v1`
- named semantic nodes for window, mode rail, tabs, terminal, inspector, evidence, actions, and settings controls
- focus order and keyboard traversal proof
- no unnamed focusable nodes
- no React/WebView action dependency
- standalone evidence at `.codex-auto/quality/native-accessibility-proof.json`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `80/100`, `96/120`, `in-progress`.
- This proves accessibility semantics and focus order. It does not prove that a Windows screen reader can consume and invoke the native tree yet.

Next:

1. Bind the semantic tree to UIAutomation or accesskit.
2. Dogfood screen-reader traversal and action invocation.
3. Continue real OS IME/TSF dogfood, React compatibility demotion, and native visual QA.

## 2026-05-25 Native Visual QA Harness Status

Status: done for native pixel/contrast/resize/focus harness; real Windows sleep/resume visual dogfood remains open.

Implemented:

- `aether-native visual-qa-proof`
- `aether.native.visual-qa-proof.v1`
- WebView/CDP-free native visual QA harness
- Win32 compatible bitmap pixel probe
- required native surface aggregation
- nonblank surface checks
- WCAG AA contrast checks
- desktop and compact resize probes
- focus coverage sourced from the native accessibility proof
- standalone evidence at `.codex-auto/quality/native-visual-qa-proof.json`

Verification:

- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- Full-native audit is now `82/100`, `98/120`, `in-progress`.
- This proves the native visual QA harness. It does not prove real Windows sleep/resume rendering recovery yet.

Next:

1. Add real Windows sleep/resume visual dogfood.
2. Prove native rendering stays nonblank and focusable after resume.
3. Continue real OS IME/TSF dogfood, React compatibility demotion, and UIA/accesskit provider dogfood.
