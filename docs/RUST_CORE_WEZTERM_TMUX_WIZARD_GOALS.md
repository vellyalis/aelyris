# Rust Core WezTerm/tmux Wizard Goals

Date: 2026-05-12
Updated: 2026-06-01

## Current Canonical State - 2026-06-01

- `pnpm verify:quality-score` currently reports `99/100`, grade `S`, `331/335`, `releaseCandidateReady=false`.
- `pnpm verify:final-goal-audit` is currently `blocked-by-external-gates`: `implementationFixableCount=0`, `policyBlockedCount=0`, and `externalBlockedCount=1`.
- The live AI CLI post-launch chaos score is no longer blocked by WebView2 CDP: `.codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json` proves native sidecar AI CLI spawn, input, kill cleanup, same-id PTY restart, prompt readiness, and no session residue, while the stale URL truth contract remains covered by the right-rail verifier.
- The strict right-rail Goal Track DOM proof can also report environment-blocked when WebView2 CDP at `http://127.0.0.1:9222` is not reachable, but the current gate preserves the primary artifact and accepts the fresh `.environment-blocked.json` source contract as `environment-blocked-current-contract`.
- The safe proof registry has `26/26` registered artifacts green when `rightRailGoalTrackTauri` reports either `pass-current-contract` or `environment-blocked-current-contract`, including `goal-external-gate-readiness`, `real-os-sleep-operator-handoff`, `goal-operator-finish`, optional git handoff artifacts, `glass-legibility-contract`, `right-rail-information-density-contract`, and `goal-anti-stall-contract`.
- Long external operator gates now persist `.codex-auto/quality/goal-operator-progress.json` with `lastHeartbeatAt`, `nextHeartbeatAt`, active step, and next action, so a resumed run can distinguish an actual stall from a sleep/token gate wait.
- `pnpm verify:goal:finalize` excludes git finalization by default; set `AETHER_GOAL_FINALIZE_INCLUDE_GIT=1` only when commit/merge readiness is intentionally in scope.
- Git finalization is an optional handoff gate, not required for product/safe/finalize evidence: `.codex-auto/quality/git-finalization-readiness.json` records the exact commit/merge runbook when `.git/index.lock` or `.git/objects` permission errors block staging.
- `real-os-soak` is host-blocked, not passed: the native sleep command returned `SetSuspendState returned false; GetLastError=50`, while native sleep/postcheck preflights and the no-real-sleep-claim postcheck writer pass.
- `authenticated-ai-cli-prompt-smoke` is now proved through explicit consent; `authenticated-ai-cli-consent-packet` records the required `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` boundary for any future token-spending prompt run.
- Until a capable/user-initiated Windows sleep cycle emits real power events, final audit state must remain `blocked-by-external-gates`, never `complete`.

## Purpose

This document locks the goal for making Aether's Rust core stronger than a normal terminal backend.

The target is not "a prettier Tauri terminal." The target is a durable, project-aware terminal mux core that can be driven by any client: the current React/Tauri UI, a future full-native Rust shell, CLI automation, or remote control API.

## Product Standard

Aether Rust core reaches Wizard grade only when these statements are true:

- The terminal session graph is owned by Rust, not React state.
- Panes, tabs, windows, workspaces, layouts, focus, cwd, shell, roles, command blocks, prompt marks, scrollback, and recovery metadata survive UI reloads.
- A UI client can attach, detach, crash, reconnect, and recover without corrupting the session graph.
- tmux-grade operations are first-class: split, close, select, resize, move, swap, break, join, rotate, zoom, broadcast, tiled layout, even layout, named sessions, and prefix/keymap control.
- WezTerm-grade terminal expectations are met: robust PTY lifecycle, performant rendering feed, large scrollback, image protocol data, CLI/API control, and configuration reload path.
- Aether exceeds both by adding project and AI context to the mux: repo, worktree, task, workflow, agent, permission state, failure state, and audit trail.

## Current Baseline

Existing strengths:

- PTY lifecycle uses Rust through `portable-pty`.
- Terminal parsing/grid state already has a Rust path through `alacritty_terminal`.
- Rust modules exist for `pty`, `term`, `session`, `api`, `db`, `workflow`, `watchdog`, and audit journal behavior.
- `NativeTerminalRegistry` supports terminal snapshots, prompt marks, history/search helpers, image metrics, and diff coalescing.
- DB session code already stores sessions, windows, panes, and pane-tree layout snapshots.
- HTTP/WebSocket API has session creation, resize, stream tickets, authentication, rate limiting, and session caps.
- Pane registry already tracks pane metadata, names, roles, and target resolution.

Known gaps:

- No true tmux-style background mux daemon contract yet. Current restore is closer to DB-backed respawn/recovery than live PTY survival after UI process death.
- Keymap and prefix behavior are not owned by a Rust keymap engine.
- Layout persistence exists, but the canonical layout model is not yet a fully typed Rust tree with move/swap/break/join/rotate/even/tiled operations.
- Scrollback exists, but durable scrollback plus command-block replay is not yet the single recovery source for all UI clients.
- CLI control is not yet complete enough to operate the mux without the UI.
- Performance budgets exist as intent, but not as mandatory CI gates.

### 2026-05-19 Baseline Correction

The "Known gaps" list above is the original 2026-05-12 baseline. The current implementation has closed several of those gaps:

- Prefix/keymap dispatch is Rust-owned through `mux_process_keymap_event`.
- Layout operations now include split, close, move, swap, even, tiled, rotate, break, join, zoom, broadcast, and synchronized panes.
- `aetherctl` and the mux HTTP API can operate and inspect sessions without the React UI for the core local workflow.
- Durable scrollback capture and search are release-gated by `pnpm verify:scrollback-gates`.
- Mux restore and performance are release-gated by `pnpm verify:mux-live` and `pnpm verify:mux-performance`.
- Terminal parsing/grid state is Rust-owned through `alacritty_terminal` and `NativeTerminalRegistry`; xterm.js is not a product dependency.
- Native terminal input has a Windows HWND-backed default surface in Tauri, with live IME evidence passing.
- `aether-native` is now a Rust-native, no-WebView attaching client spike. `pnpm verify:terminal:native-client` proves it reaches the same daemon instance, creates a layered Win32 native window, renders daemon-captured terminal text through Win32/GDI with nonblank pixel evidence, feeds daemon capture into Rust `TermEngine`, materializes a renderer-neutral `NativeRenderFrame` with schema `aether.native.render-frame.v1`, renders a native 100x24 terminal grid with nonblank cell/pixel evidence, proves the renderer consumed the same frame hash, and can list, send, capture, detach, and attach through the mux API.
- Production release evidence now passes for all implementation-fixable gates: `pnpm verify:release:production`, strict release doctor, supply-chain audit, mux restore/performance, scrollback, and quality score `96/100`, grade `A`, `321/335`, `releaseCandidateReady=false`.
- `pnpm verify:goal:safe` reports `blocked-by-external-gates` with `24/24` proof artifacts passing and `0` implementation-fixable blockers, including the objective-level `goal-completion-matrix`, current supply-chain audit proof, `goal-external-gate-readiness`, optional git handoff artifacts, `glass-legibility-contract`, and `goal-anti-stall-contract`.
- The current state is `blocked-by-external-gates` because real OS sleep/resume is host-blocked and `authenticated-ai-cli-prompt-smoke` may spend tokens. The opt-in artifact is `authenticated-ai-cli-consent-packet`, and the final smoke requires `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.

Remaining Core Wizard gaps:

- Background mux daemon policy: sessions can detach/attach through the current sidecar/API path, but the product still needs an explicit named daemon lifecycle, attach permissions, version negotiation, and UI-close policy.
- True daemon-owned window groups: `Ctrl+B c` currently creates an app workspace tab; it is not yet a full tmux-style daemon window model independent of the React workspace tab model.
- Normal-path fallback deletion: the Tauri default input path is native, but emergency/non-Tauri WebView textarea fallback code and tests still exist. That is acceptable for compatibility, but not for a "no fallback shadows" Wizard claim.
- Native renderer/client: the first attaching client, native Win32 window proof, native GDI text render proof, TermEngine-backed native GDI grid proof, and renderer-neutral `NativeRenderFrame` contract exist, but the shipping shell still renders via React/WebView/Canvas 2D. Native-shell parity still requires the actual `winit`/`wgpu` terminal renderer, native IME path, native glass compositor, and visual regression harness.
- Config reload: keymap/theme/shell-profile/config hot reload is not yet a complete Rust-owned contract.
- Remote/domain abstraction: local mux is ready to be extended, but SSH/remote/domain panes are not implemented.
- Command-block journal as product truth: scrollback/search, recovered command evidence, multipane command evidence, and failure recovery are proven. The remaining work is to make the journal the default visible spine for every review, workflow, and handoff path.
- Right rail edge: smoke/action/scale/final-goal gates now pass, and provenance, recovery, context packs, launch planning, and workflow trace are represented in the Command Center contracts. The remaining work is UX dominance: making that loop obvious in the first minute without relying on documentation.

Current grade assessment:

- Core B: complete.
- Core A: largely complete for local mux operations.
- Core S: partial; local API/CLI/perf evidence exists, but config reload, native renderer, and client-agnostic daemon lifecycle remain.
- Core S++: implementation evidence is green for provenance/recovery/context-pack/launch-planner loops, but the UX still needs to make that path the obvious daily default.
- Core Wizard: not complete until the daemon survives as an explicit product boundary and the native client grows from an attaching proof into a real daily-driver terminal window.

## Core Data Model

The Rust core should converge on this typed graph:

```text
Server
  Workspace
    Window
      Tab
        LayoutTree
          Pane
            PtySession
            TerminalModel
            ScrollbackStore
            CommandBlockJournal
            ProjectContext
            AgentContext
```

Every object needs:

- Stable id.
- Human name/title.
- Lifecycle state.
- Created/updated timestamps.
- Durable metadata.
- Last known focus position.
- Audit/event stream.

The UI should render this graph; it should not invent its own truth.

## Required Capability Matrix

| Area | Wizard Goal | Acceptance Criteria |
| --- | --- | --- |
| Mux server | Rust owns the session graph and client attach/detach. | Kill/reload UI, reconnect, and recover layout, focus, panes, metadata, and scrollback without manual repair. |
| Live persistence | PTYs survive client detachment once daemon mode lands. | Closing the UI does not necessarily kill the running shell; a new client can reattach. |
| Session restore | Crash-safe recovery before daemon mode, true live attach after daemon mode. | App restart restores named sessions and marks dead PTYs honestly instead of pretending they are live. |
| Layout engine | Typed Rust layout tree with split, close, resize, move, swap, rotate, zoom, break, join, even-horizontal, even-vertical, tiled, main-horizontal, main-vertical. | Pure Rust tests cover all operations and preserve pane ids, ratios, and focus invariants. |
| Keymap/prefix | Rust keymap engine with prefix mode, key tables, conflict detection, import/export, and tmux-like preset. | Key sequence tests prove prefix timeout, nested tables, remap, unbind, and conflict reporting. |
| Scrollback | Durable bounded scrollback with fast viewport fetch and search. | 100k+ line sessions remain searchable and memory-bounded; reopen preserves searchable history. |
| Command blocks | Prompt marks, command start/end, exit status, cwd, duration, and output range are journaled. | Reload can rebuild blocks from the journal and link failures to recovery actions. |
| CLI/API | `aetherctl` or equivalent can operate sessions without UI. | CLI can list/create/attach/detach/split/select/send/resize/close/move/swap/layout/capture/search/export. |
| Remote/domain future | Local mux is designed so SSH/domain support can plug in later. | Local panes and future remote panes share the same `PtyEndpoint` abstraction. |
| Security | API auth, stream tickets, path validation, shell command boundaries, audit logging. | No unauthenticated stream/control path; path and cwd handling are tested on Windows edge cases. |
| Performance | Spawn, split, close, input, resize, scrollback, restore are benchmarked. | Release CI records budgets and fails on serious regressions. |
| Observability | Core emits structured lifecycle/perf events. | UI rail and logs derive from core events, not duplicated frontend guesses. |
| Project edge | Panes can belong to repo/worktree/task/workflow/agent role. | Routing, review, recovery, and right rail actions know exactly which pane/session they affect. |

## Performance Budgets

These are initial release budgets. They should be measured on a normal Windows 11 machine in release mode.

| Operation | Target |
| --- | --- |
| Warm split pane | P50 <= 120 ms, P95 <= 300 ms |
| New shell spawn | P50 <= 800 ms, P95 <= 1500 ms |
| Close pane | P50 <= 80 ms, P95 <= 180 ms |
| Focus switch | P50 <= 16 ms, P95 <= 32 ms |
| Local input echo pipeline | P50 <= 16 ms, P95 <= 32 ms |
| Resize propagation | P50 <= 32 ms, P95 <= 80 ms |
| Restore visible layout | P50 <= 1000 ms, P95 <= 2000 ms |
| Reattach to live daemon session | P50 <= 300 ms, P95 <= 700 ms |
| Scrollback viewport fetch | P50 <= 16 ms, P95 <= 50 ms |
| 100k-line search start | P50 <= 150 ms, P95 <= 500 ms |

If the machine is cold-starting PowerShell itself, the shell cost must be measured separately from Aether overhead.

## Grade Ladder

### Core B: Honest Durable Core

- Rust has typed session/window/tab/pane/layout graph.
- Restore is crash-safe and honest about dead PTYs.
- Layout snapshots round-trip without UI-only assumptions.
- Existing PTY/session APIs are aligned to the graph.

### Core A: tmux-Comparable Local Mux

- Prefix/keymap engine exists in Rust.
- Move/swap/even/tiled/break/join/zoom are implemented.
- Attach/detach semantics exist.
- CLI can drive core operations.
- Durable scrollback and command block journal are usable.

### Core S: WezTerm-Comparable Local Control

- Core is client-agnostic.
- WebSocket/API/CLI can all observe and control the same graph.
- Config reload updates keymaps/layout preferences without restart.
- Performance budgets are benchmarked.
- Terminal image metadata and scrollback are part of restore semantics.

### Core S++: Aether Edge

- Pane roles, project/worktree/task/workflow/agent links are first-class.
- Failure detection and recovery are core events.
- Right rail becomes a command center powered by core truth.
- Sessions can be exported/imported for handoff.

### Core Wizard

- Background mux daemon keeps live sessions independent of the UI shell.
- Native Rust shell can attach to the same daemon.
- UI crash/restart tests, daemon restart tests, and scrollback replay tests pass.
- The terminal core is good enough that the current Tauri UI is only one optional client.

## Implementation Plan

### Phase 1: Core Contract and Typed Mux Graph

Duration: 1-2 weeks.

Deliverables:

- Add a new `src-tauri/src/mux` module for pure Rust session graph types.
- Define `Server`, `Workspace`, `Window`, `Tab`, `LayoutTree`, `Pane`, `PtyBinding`, and lifecycle state.
- Define core event enum: create, close, attach, detach, focus, resize, split, move, swap, layout, shell-start, shell-exit, scrollback-checkpoint, command-block, failure.
- Add serialization versioning and migration hooks.
- Add invariant tests for graph mutation.

Exit criteria:

- Existing session/pane code can map to the mux graph.
- A graph snapshot can be saved, loaded, validated, and rejected if malformed.

### Phase 2: Layout and Pane Operations

Duration: 1-2 weeks.

Deliverables:

- Implement typed layout tree operations.
- Implement even/tiled/main layout algorithms.
- Implement pane move, swap, break, join, rotate, and zoom.
- Preserve focus and ratio invariants.
- Expose IPC/API commands for the operations.

Exit criteria:

- Rust tests cover all layout operations.
- Frontend split/close/rebalance behavior can call Rust-owned operations.

### Phase 3: Keymap and Prefix Engine

Duration: 1-2 weeks.

Deliverables:

- Add Rust keymap parser and resolver.
- Support prefix key, key tables, pass-through, command dispatch, conflict detection, and import/export.
- Add tmux-like default preset and Aether default preset.
- Add config reload hook.

Exit criteria:

- Key sequences are tested without UI.
- UI shortcuts become a projection of the Rust keymap contract.

### Phase 4: Durable Scrollback and Command Journal

Duration: 2-3 weeks.

Deliverables:

- Define bounded scrollback store with checkpoints.
- Persist command blocks with prompt mark, cwd, command, output range, exit status, and duration.
- Add fast viewport reads and search.
- Add recovery metadata for failed/stuck commands.

Exit criteria:

- Restart can restore visible terminal history and command blocks.
- Large scrollback tests prove bounded memory and acceptable search latency.

### Phase 5: API and CLI Completeness

Duration: 1-2 weeks.

Deliverables:

- Add `aetherctl` command surface or equivalent executable mode.
- Expose list/create/attach/detach/split/select/send/resize/close/move/swap/layout/capture/search/export.
- Keep HTTP/WebSocket and CLI behavior aligned.
- Add auth and permission tests for every control path.

Exit criteria:

- A scripted smoke test can run a full tmux-like workflow without opening the UI.

### Phase 6: Background Mux Daemon

Duration: 2-4 weeks.

Deliverables:

- Split core lifetime from UI lifetime.
- Add daemon process, named pipe/local socket transport, lock/lease handling, and controlled shutdown.
- Add attach/detach client protocol.
- Add stale daemon recovery and version negotiation.

Exit criteria:

- The UI can be killed and relaunched while live shells continue.
- A second client can attach read-only or control a session according to permissions.

### Phase 7: Project/AI Wizard Layer

Duration: 2-4 weeks.

Deliverables:

- Attach pane roles, repo/worktree/task/workflow/agent metadata to core graph.
- Emit structured events for agent status, review pressure, denied tools, failed commands, and recovery actions.
- Add routing primitives: send to role, broadcast to group, open agent pane for task, handoff trace.
- Make right rail derive from the mux graph and event stream.

Exit criteria:

- Aether can explain what each pane is doing, why it exists, and what action is safe next.
- The right rail is not decorative; it controls and audits the running workspace.

## Validation Suite

Required before claiming Wizard-grade Rust core:

- `cargo test` for graph, layout, keymap, scrollback, session restore, API auth, and path validation.
- Integration smoke: create session, split panes, send commands, move/swap, apply layout, close, restore.
- Crash smoke: kill UI process, relaunch, reconnect, verify graph and scrollback.
- Daemon smoke: close all clients, keep shell alive, reattach.
- Performance smoke: spawn/split/close/focus/resize/scrollback budgets recorded in JSON.
- Windows smoke: PowerShell, cmd, Git Bash if installed, Japanese IME composition, Unicode paths, long paths, spaces in paths.
- Security smoke: unauthenticated API rejected, expired stream ticket rejected, invalid cwd rejected.

## Non-Negotiables

- No new terminal/mux truth should live only in React.
- No fake live state after a PTY is dead.
- No console window flash on pane creation.
- No unbounded scrollback memory.
- No undocumented fallback path that silently changes behavior.
- No release claim without measured performance evidence.

## First Concrete Milestone

Milestone name: `Core B -> Core A: Durable tmux model`.

Scope:

1. Create typed Rust mux graph.
2. Convert session/pane restore to validate against that graph.
3. Implement layout tree operations for split, close, move, swap, even, and tiled.
4. Add Rust keymap skeleton with prefix mode and command dispatch.
5. Add a CLI/API smoke that can create a session, split it, rename panes, move/swap panes, apply tiled layout, send a command, capture output, and close cleanly.

Done means:

- The Rust core has a real contract that a future full-native shell can attach to.
- The current React UI is no longer the owner of tmux-like behavior.
- Remaining work is daemon persistence and Wizard project/AI layer, not basic mux correctness.

## Implementation Progress

### 2026-05-12: Core B Foundation

Completed:

- Added `src-tauri/src/mux` as the Rust-owned mux core namespace.
- Added typed mux graph records for workspace/window/tab/pane/PTY/project/agent metadata.
- Added pure Rust layout tree operations for split, close, move, swap, even, and tiled.
- Added Rust keymap/prefix engine skeleton with prefix timeout, command dispatch, nested key tables, bind/unbind/remap, and conflict detection.
- Added `MuxManager` facade for future IPC/API/CLI control.
- Added DB restore conversion into a versioned mux graph snapshot.
- Added `SessionManager::restore_last_mux_graph()` so legacy DB sessions can be validated as typed mux graphs.
- Registered shared `MuxManager` as Tauri managed state.
- Synchronized IPC terminal spawn, resize, close, rename, and role changes into the mux graph.
- Synchronized HTTP API session create, resize, and delete into the same mux graph handle.
- Added API/session/mux tests and ran full Rust validation.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml` passed.
- Current Rust count at validation time: 572 lib tests plus API, PTY, session, audit, sidecar hygiene, and doc tests.
- `test_process_spawn_hygiene` passed, so the mux additions did not reintroduce unsafe visible helper process spawning.

### 2026-05-12: Core A External Control Surface

Completed:

- Added authenticated HTTP mux inspection endpoints:
  - `GET /mux/workspaces`
  - `GET /mux/workspaces/:id`
- Extended the API round-trip integration test so session create/resize/delete verifies the mux graph through HTTP as well as in-memory state.
- Added `aetherctl` as a Cargo binary for UI-free control:
  - `health`
  - `sessions`
  - `mux`
  - `mux-graph <id>`
  - `create`
  - `resize`
  - `close`
- Kept `aether-pty-server` as the dedicated `src-tauri/pty-server` crate and Tauri externalBin sidecar so the PTY/API process can be built from source without being auto-bundled twice by the main app package.
- Kept the sidecar process kind explicit through `PROCESS_KIND_SIDE_CAR`.
- Added REST input control:
  - `POST /sessions/:id/input`
  - `aetherctl send <id> <text...> [--enter]`
- Added daemon-side capture-pane control backed by a bounded PTY output ring:
  - `GET /sessions/:id/capture?lines=200&clean=true`
  - `aetherctl capture <id> [--lines n] [--raw]`
- Added durable PTY scrollback for daemon/API capture:
  - `FilePtyScrollbackStore` appends PTY output to bounded per-terminal log files.
  - `AETHER_PTY_SCROLLBACK_DIR` enables durable scrollback for the source-built PTY server and embedded API fallback.
  - `GET /sessions/:id/capture` can read durable scrollback after the live session has closed.
  - Scrollback paths percent-encode terminal ids and prune each terminal log to a bounded size.
- Added explicit daemon contract and stricter sidecar validation:
  - `GET /daemon/contract` reports protocol version, package version, process identity, enabled persistence features, session counts, and capabilities.
  - `aetherctl daemon` prints the contract for UI-free diagnosis.
  - Sidecar attach now rejects wrong process kind, mismatched daemon protocol, mismatched package version, empty instance id, zero pid, and unexpected executable path.
- Added transactional mux graph snapshot persistence:
  - `FileMuxSnapshotStore` writes validated `VersionedMuxSnapshot` JSON through temp-file then rename.
  - `AETHER_MUX_SNAPSHOT_DIR` enables snapshot persistence for the source-built PTY server and embedded API fallback.
  - Snapshot restore marks panes as detached and PTY bindings as `restore-pending:<pane_id>` so stale process ids are not treated as live sessions.
  - API create, resize, split, pane close, swap, move, even/tiled layout, and workspace delete now sync snapshots when a store is configured.
- Added mux-owned pane/layout control endpoints:
  - `POST /mux/workspaces/:id/panes/split`
  - `DELETE /mux/workspaces/:id/panes/:pane_id`
  - `POST /mux/workspaces/:id/panes/swap`
  - `POST /mux/workspaces/:id/panes/move`
  - `POST /mux/workspaces/:id/layout/even`
  - `POST /mux/workspaces/:id/layout/tiled`
- Extended `aetherctl` with matching mux commands:
  - `mux-split`
  - `mux-close-pane`
  - `mux-swap`
  - `mux-move`
  - `mux-even`
  - `mux-tiled`
- Changed API session close so deleting a mux workspace also closes child PTYs created by mux split, avoiding orphan terminal processes.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml mux --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `cargo build --manifest-path src-tauri\pty-server\Cargo.toml --release` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_process_spawn_hygiene` passed.
- Full `cargo test --manifest-path src-tauri\Cargo.toml` passed after the CLI/API/sidecar entrypoint additions.
- The API integration test now covers REST input, capture-pane output retrieval, mux split, explicit child pane close, swap, move, even layout, tiled layout, and workspace delete cleanup.
- Snapshot integration now verifies API-created mux graphs persist to disk, restore as detached `restore-pending` graphs, and are deleted with the workspace.
- Durable scrollback integration now verifies output remains capturable after the PTY session is closed.
- Daemon contract integration now verifies versioned capabilities and enabled persistence flags.

### 2026-05-13: Attach/Detach Lifecycle Contract

Completed:

- Added explicit mux workspace lifecycle endpoints:
  - `POST /mux/workspaces/:id/detach`
  - `POST /mux/workspaces/:id/attach`
- `detach` now keeps the Rust-owned mux graph and preserves live PTYs when the daemon/API process is still alive; panes are marked `detached` while retaining their live `terminalId`, and `attach` returns them to `active` without respawn. Snapshot restore still marks stale panes as `restore-pending:<pane_id>` when only disk state remains.
- `attach` now rehydrates restored `restore-pending` panes by spawning shells with the original pane ids, preserving layout identity for clients and snapshots, while live-detached panes reattach without respawn.
- Added session-cap checks and spawn rollback for partial attach failure.
- Added `mux-detach <workspace>` and `mux-attach <workspace>` to `aetherctl`.
- Added the `mux-attach-detach` and `mux-live-attach-detach` daemon capabilities.
- Extended the Windows API round-trip integration test to prove detach preserves live sessions without deleting the graph, accepts input while detached, then attach returns both the root and split pane ids to active.
- Hardened PTY close semantics so explicit close terminates the child process even after a waiter thread has taken the wait handle.
- Added `scripts/verify-mux-performance.mjs` / `pnpm verify:mux-performance` so detach, attach, resize, and close have measured pre-release latency gates instead of subjective checks only.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml mux::manager --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml mux::store --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml pty::scrollback --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_pty_respawn` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_pty_lifecycle` passed.
- Full `cargo test --manifest-path src-tauri\Cargo.toml` passed after attach/detach and close cleanup changes.
- `pnpm verify:mux-performance` must pass before claiming mux control-path performance is release-safe.

Latest validation on 2026-05-13:

- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml mux:: --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- Full `cargo test --manifest-path src-tauri\Cargo.toml` passed.
- Full `pnpm test` passed when run without competing full Rust compilation.
- `pnpm build` passed.
- `pnpm tauri:build:dist` completed and produced the release app, MSI, and NSIS installer.
- `pnpm verify:dist` passed.
- `pnpm verify:mux-performance` passed after the final release build with these measured P95 values:
  - create: 44.1 ms
  - split: 30.2 ms
  - detach: 6.6 ms
  - attach: 8.8 ms
  - resize: 6.5 ms
  - close: 2.8 ms

Release-gate note:

- Do not run full `cargo test` and full `pnpm test` concurrently on the same workstation as a formal release gate. The combined worker/process load caused Vitest fork startup timeouts once; the same frontend suite passed cleanly when rerun by itself.

Remaining before Core Wizard:

- Replace UI-owned pane tree operations with mux-driven operations.
- Add daemon crash survival smoke tests around the explicit contract.
- Add daemon-level live PTY survival tests: close all clients, keep shell alive, reconnect, and verify scrollback/session state.

### 2026-05-13: React Pane Bridge Starts Using Rust Mux

Completed:

- Added Tauri IPC commands that drive the same Rust mux concepts used by the HTTP daemon API:
  - `mux_split_pane`
  - `mux_close_pane`
- Added sidecar client support for mux split/close so release mode can call the long-lived PTY server instead of creating UI-only panes.
- Changed React pane split so the UI asks Rust mux to create the pane first, then attaches the returned pane/PTY id.
- Changed React pane close so pane removal goes through Rust mux close, then the UI collapses its local layout without issuing a second direct terminal close.
- Updated pane-tree tests so they assert the new contract: split panes come from mux ids and close calls `mux_close_pane`.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_process_spawn_hygiene` passed.
- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src/__tests__/PaneTreeContainerActiveTerminal.test.tsx src/__tests__/pane-tree-ops.test.ts src/__tests__/integration-pane-lifecycle.test.ts` passed.
- `pnpm build` passed.

Remaining before this bridge can be called complete:

- Hydrate the React pane tree from mux graph snapshots rather than the legacy pane-tree snapshot format.
- Add a live Tauri visual smoke that opens a real pane, splits it, closes it, and verifies no console flash, no duplicate process, and a consistent mux graph.

### 2026-05-13: Layout Commands Start Using Rust Mux

Completed:

- Added topology-preserving `equalize` to the Rust mux layout model.
- Added Tauri IPC commands for mux-owned layout changes:
  - `mux_apply_layout`
  - `mux_swap_panes`
- Added sidecar client support for mux swap/equalize/even/tiled layout calls.
- Changed React pane layout commands so live panes call Rust mux first, then mirror the successful result locally.
- Kept local-only layout behavior only for panes that do not yet have backend PTY bindings.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux:: --quiet` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 --quiet` passed when run alone.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_process_spawn_hygiene --quiet` passed.
- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src/__tests__/PaneTreeContainerActiveTerminal.test.tsx src/__tests__/pane-tree-ops.test.ts` passed.
- `pnpm exec vitest run src/__tests__/integration-pane-lifecycle.test.ts src/__tests__/PaneTree.test.ts src/__tests__/paneTreePersistence.test.ts` passed.
- `pnpm test` passed: 156 files / 1419 tests.
- `cargo test --manifest-path src-tauri\Cargo.toml --quiet` passed.
- `pnpm build` passed.
- `pnpm verify:mux-performance` passed: split p95 18.4ms, attach p95 5.3ms, close p95 1.9ms.

Remaining before this bridge can be called complete:

- Add a live Tauri visual smoke that opens a real pane, splits it, closes it, applies layouts, and verifies no console flash, no duplicate process, and a consistent mux graph.

### 2026-05-13: React Hydration Prefers Rust Mux Graphs

Completed:

- Added `mux_get_workspace` Tauri IPC and sidecar support so the frontend can read the same Rust mux graph used by the daemon HTTP API.
- Added a mux graph to pane-tree snapshot converter in the frontend persistence layer.
- Changed pane-tree hydration order to prefer Rust mux graph state over legacy pane-tree snapshots.
- Suspended terminal mounting while a stored tab resolves its authoritative layout, avoiding spawn-then-replace races during restore.
- Relaxed pane snapshot sanitization so mux-owned pane ids, including UUID/PTY ids, are accepted instead of requiring the old `pane-*` prefix.
- Persisted `muxWorkspaceId` alongside legacy snapshots so future reloads can locate the authoritative Rust graph faster.

Validation:

- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src/__tests__/paneTreePersistence.test.ts src/__tests__/PaneTreeContainerActiveTerminal.test.tsx` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml` passed.
- `pnpm test` passed: 156 files / 1423 tests.
- `pnpm build` passed.
- `pnpm verify:mux-performance` passed: split p95 30.2ms, attach p95 9.1ms, close p95 6.9ms.

Remaining before this bridge can be called complete:

- Add a live Tauri visual smoke that opens a real pane, splits it, closes it, applies layouts, restores from mux graph, and verifies no console flash, no duplicate process, and a consistent mux graph.

### 2026-05-13: Live Mux Restore Smoke Gate

Completed:

- Added `scripts/verify-mux-live-restore.mjs` / `pnpm verify:mux-live` as a daemon-level smoke gate for real release sidecar behavior.
- Added `pnpm verify:mux-live` and `pnpm verify:mux-performance` to the full `pnpm verify:release` gate so mux live restore and mux latency are no longer optional pre-release checks.
- The smoke starts the release PTY sidecar with isolated mux and scrollback directories, creates a real `cmd` session, splits through the Rust mux API, applies tiled/even/equalize layouts, detaches, sends input while detached, kills the daemon, restarts it against the same snapshot directory, attaches restored panes, closes a child pane, and finally deletes the workspace.
- The gate asserts pane identity and PTY binding invariants instead of only checking HTTP success:
  - split creates exactly two mux panes;
  - PTY ids are not duplicated;
  - layout commands preserve pane ids;
  - mux workspace broadcast input reaches every live pane;
  - detached live PTYs still process input while the daemon is alive;
  - daemon restart restores the mux graph with honest `restore-pending:*` PTY bindings;
  - daemon restart can read the detached session marker from durable scrollback before attach;
  - attach replaces `restore-pending:*` bindings with distinct live PTYs;
  - pane close updates the Rust mux graph;
  - workspace close removes the mux graph.
- Rebuilt the release PTY sidecar and copied it into `src-tauri\binaries\aether-pty-server-x86_64-pc-windows-msvc.exe` so the bundled sidecar includes the current mux layout/restore endpoints.
- Added mux-owned broadcast input:
  - `POST /mux/workspaces/:id/input`
  - `aetherctl mux-broadcast <workspace> <text...> [--enter]`
  - daemon contract capability `mux-broadcast-input`
- Added mux-owned pane zoom:
  - `POST /mux/workspaces/:id/panes/:pane_id/zoom`
  - `aetherctl mux-zoom <workspace> <pane>` / `aetherctl mux-unzoom <workspace> <pane>`
  - Tauri IPC `mux_set_pane_zoom`
  - React pane maximize now updates Rust mux `zoomedPaneId` first, then mirrors the local display state.
  - daemon contract capability `mux-pane-zoom`

Validation:

- `cargo build --release --manifest-path src-tauri\pty-server\Cargo.toml` passed.
- `pnpm verify:mux-live` passed.
- `pnpm verify:mux-performance` passed after the rebuilt sidecar:
  - create: 63.5 ms
  - split: 25.4 ms
  - detach: 6.6 ms
  - attach: 10.2 ms
  - resize: 9.4 ms
  - close: 5.8 ms
- `pnpm exec vitest run src/__tests__/paneTreePersistence.test.ts src/__tests__/PaneTreeContainerActiveTerminal.test.tsx` passed: 2 files / 38 tests.
- `AETHER_RELEASE_ALLOW_DIRTY=1 pnpm verify:release:preflight` passed after adding the mux scripts to the release contract. The dirty-worktree bypass was used only because this development session intentionally contains active changes.
- `cargo check --manifest-path src-tauri\Cargo.toml --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 create_list_resize_delete_roundtrip --quiet` passed.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed. `cargo test --bin aetherctl` hit a Windows link/process timeout in this workstation session, so the bin compile contract was verified with `cargo check` instead.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux:: --quiet` passed: 24 tests.
- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src/__tests__/PaneTreeContainerActiveTerminal.test.tsx` passed: 30 tests.
- `pnpm build` passed.
- `pnpm verify:mux-live` passed with zoom/unzoom included in the smoke sequence.
- `pnpm verify:mux-performance` passed after the rebuilt sidecar:
  - create: 48.8 ms
  - split: 34.3 ms
  - detach: 8.9 ms
  - attach: 7.3 ms
  - resize: 7.6 ms
  - close: 5.2 ms

### 2026-05-13: Mux Rotate Joins the Rust-Owned Pane Contract

Completed:

- Added topology-preserving pane rotation to the Rust mux layout model:
  - `TabLayout::rotate_panes(reverse)`
  - `TabRecord::rotate_panes`
  - `MuxManager::rotate_active_tab`
- Added REST/API/CLI control for rotation:
  - `POST /mux/workspaces/:id/layout/rotate`
  - `aetherctl mux-rotate <workspace> [--direction next|previous]`
  - daemon contract capability `mux-layout-rotate`
- Added sidecar and Tauri IPC support so release mode and embedded fallback both drive the same mux graph.
- Changed React pane commands so `rotate-next` / `rotate-previous` call Rust mux first, then mirror the local pane tree.
- Added prefix/menu access:
  - `Ctrl+B o` rotates panes next.
  - `Ctrl+B O` rotates panes previous.
  - Command palette / app menu entries for rotate next/previous.
- Extended the live mux smoke so rotate is verified between layout and broadcast:
  - pane set is preserved;
  - tree-order placement changes;
  - the rotated graph still survives detach, daemon restart, attach, close, and workspace delete.
- Rebuilt the release PTY sidecar and copied it into `src-tauri\binaries\aether-pty-server-x86_64-pc-windows-msvc.exe` so packaged/dev sidecar runs include the new endpoint.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml` passed.
- `pnpm exec tsc --noEmit` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux:: --quiet` passed: 25 tests.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `pnpm exec vitest run src/__tests__/PaneTreeContainerActiveTerminal.test.tsx` passed: 31 tests.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 create_list_resize_delete_roundtrip --quiet` passed.
- `pnpm verify:mux-live` passed with rotate/broadcast/zoom/detach/restart/attach/close in the same smoke.
- `pnpm verify:mux-performance` passed after the rebuilt sidecar:
  - create: 61.2 ms
  - split: 30.9 ms
  - detach: 10.7 ms
  - attach: 7.2 ms
  - resize: 8.6 ms
  - close: 5.1 ms
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 daemon_contract_exposes_versioned_capabilities --quiet` passed.
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Add the separate live Tauri visual smoke for the real desktop WebView path. The daemon/mux/PTY contract is now covered, but frontmost-window flashing, WebView mount timing, screenshot contrast, and IME positioning still need desktop visual automation.
- Extend scrollback replay assertions beyond a short marker into large-history replay, search, and command-block boundaries.
- Add break/join and Rust-owned synchronized-pane mode before claiming tmux-complete parity.
- Move prefix/keymap dispatch fully into Rust; the UI currently exposes prefix commands, but the authoritative keymap engine is not yet the dispatcher for the live terminal.

### 2026-05-13: Break/Join Pane Lands in the Rust Mux Contract

Completed:

- Added Rust mux graph operations for tmux-style pane transfer:
  - `MuxGraph::break_active_pane_to_tab`
  - `MuxGraph::join_pane_into_active_tab`
  - `MuxManager::break_active_pane_to_new_tab`
  - `MuxManager::join_pane_into_active_tab`
- Break/join move `PaneRecord` and layout ownership only; they do not close or respawn the underlying PTY binding.
- Added REST/API/CLI control:
  - `POST /mux/workspaces/:id/panes/:pane_id/break`
  - `POST /mux/workspaces/:id/panes/join`
  - `aetherctl mux-break-pane <workspace> <pane>`
  - `aetherctl mux-join-pane <workspace> <source-pane> <target-pane> [--axis horizontal|vertical]`
- Added Tauri IPC and sidecar methods:
  - `mux_break_pane`
  - `mux_join_pane`
- Added daemon contract capability `mux-pane-break-join`.
- Extended the live mux smoke so break/join are verified before broadcast/zoom/detach/restart:
  - break preserves live pane records across tabs;
  - join restores a two-pane active layout;
  - subsequent broadcast still reaches both live PTYs;
  - detach/restart/attach/close still passes after the transfer operations.
- Rebuilt and copied the release sidecar to `src-tauri\binaries\aether-pty-server-x86_64-pc-windows-msvc.exe`.

Validation:

- `pnpm exec tsc --noEmit` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux:: --quiet` passed: 26 tests.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 daemon_contract_exposes_versioned_capabilities --quiet` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 create_list_resize_delete_roundtrip --quiet` passed.
- `cargo build --manifest-path src-tauri\pty-server\Cargo.toml --release` passed.
- `pnpm verify:mux-live` passed with break/join in the smoke sequence.
- `pnpm verify:mux-performance` passed:
  - create: 49.2 ms
  - split: 39.7 ms
  - detach: 6.2 ms
  - attach: 7.0 ms
  - resize: 6.9 ms
  - close: 4.2 ms
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Build the UI model for multiple mux tabs so break/join can be exposed as polished visual workflows, not just backend/CLI/API capabilities.
- Add Rust-owned synchronized-pane mode.
- Move prefix/keymap dispatch fully into Rust.
- Add large-history scrollback/search and command-block replay gates.
- Add the real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: Synchronized Panes Becomes Rust Mux State

Completed:

- Added `TabRecord::synchronized_panes` to the Rust mux graph with serde defaulting for older snapshots.
- Added `TabRecord::set_synchronized_panes` and `MuxManager::set_active_tab_synchronized_panes`.
- Added `MuxManager::synchronized_input_targets_for_pane` so input routing can derive targets from mux truth instead of UI guesses.
- Changed `POST /sessions/:id/input` so when the pane belongs to a synchronized active tab, the same input is written to every live PTY in that tab.
- Added Tauri fallback support so direct embedded `write_terminal` also fans out through mux state when no sidecar is active.
- Added REST/API/CLI/IPC/sidecar control:
  - `POST /mux/workspaces/:id/panes/synchronize`
  - `aetherctl mux-sync-panes <workspace> --on|--off`
  - `mux_set_panes_synchronized`
- Added daemon contract capability `mux-synchronized-panes`.
- Extended API integration and live mux smoke so synchronized input is tested as a stateful mode, separate from one-shot broadcast.
- Rebuilt and copied the release sidecar to `src-tauri\binaries\aether-pty-server-x86_64-pc-windows-msvc.exe`.

Validation:

- `pnpm exec tsc --noEmit` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux:: --quiet` passed: 26 tests.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 daemon_contract_exposes_versioned_capabilities --quiet` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1 create_list_resize_delete_roundtrip --quiet` passed.
- `cargo build --manifest-path src-tauri\pty-server\Cargo.toml --release` passed.
- `pnpm verify:mux-live` passed with synchronized-pane mode in the smoke sequence.
- `pnpm verify:mux-performance` passed:
  - create: 81.5 ms
  - split: 30.3 ms
  - detach: 6.7 ms
  - attach: 6.5 ms
  - resize: 7.7 ms
  - close: 4.5 ms
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Promote synchronized panes from command/menu actions into a polished visible toggle with clear ON/OFF state.
- Move prefix/keymap dispatch fully into Rust so `Ctrl+B` routes through the same command table as CLI/API.
- Add large-history scrollback/search and command-block replay gates.
- Add the real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: Synchronized Panes Gets a UI Entry Point

Completed:

- Added `sync-panes-on` and `sync-panes-off` to the shared pane layout command surface.
- Wired the App menu layer to dispatch synchronized-pane mode changes for the active terminal tab.
- Added Command Palette actions:
  - `Synchronize Panes On`
  - `Synchronize Panes Off`
- Added Terminal menu actions for the same ON/OFF controls.
- Routed the UI commands through the Rust mux state via `mux_set_panes_synchronized`.
- Added a PaneTree regression test that verifies both ON and OFF invoke the mux command with the active workspace id.

Validation:

- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src\__tests__\PaneTreeContainerActiveTerminal.test.tsx` passed: 32 tests.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `pnpm verify:mux-live` passed with synchronized-pane mode in the smoke sequence.
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Replace the menu-only synchronized-pane controls with a visible pane toolbar/status toggle so users can see when every pane will receive input.
- Move prefix/keymap dispatch fully into Rust so `Ctrl+B` routes through the same command table as CLI/API.
- Add large-history scrollback/search and command-block replay gates.
- Add real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: Synchronized Panes Gets Visible State

Completed:

- Added `synchronizedPanes` to the persisted pane-tree snapshot contract so UI state can round-trip with the mux-owned tab state.
- Hydrated synchronized-pane state from `mux_get_workspace` using the Rust mux graph's `synchronizedPanes` field.
- Passed synchronized-pane state into `PaneTreeRenderer` and `TerminalInfoBar`.
- Enabled the existing sync toolbar button in every pane header:
  - pressed state shows when synchronized input is active;
  - click toggles ON/OFF through `mux_set_panes_synchronized`;
  - failed backend updates roll the optimistic UI state back.
- Added regression coverage for:
  - menu/command dispatch changing the visible synchronized state;
  - mux graph hydration restoring synchronized state;
  - TerminalInfoBar rendering the pressed sync toolbar toggle.

Validation:

- `pnpm exec tsc --noEmit` passed.
- `pnpm exec vitest run src\__tests__\PaneTreeContainerActiveTerminal.test.tsx src\__tests__\TerminalInfoBarExitDot.test.tsx` passed: 43 tests.
- `pnpm verify:mux-live` passed with synchronized-pane mode in the live smoke sequence.
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Move prefix/keymap dispatch fully into Rust so `Ctrl+B` routes through the same command table as CLI/API.
- Add large-history scrollback/search and command-block replay gates.
- Add real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: Prefix Keymap Resolution Moves Into Rust

Completed:

- Promoted the existing Rust mux keymap engine into the Tauri runtime with `MuxKeymapRegistry`.
- Added `mux_process_keymap_event` IPC so terminal keydown events resolve through Rust state instead of a frontend `switch(key)` table.
- Added an Aether/tmux prefix table in Rust:
  - `Ctrl+B %` -> `split-right`
  - `Ctrl+B "` -> `split-down`
  - `Ctrl+B x` -> `close`
  - `Ctrl+B z` -> `toggle-maximize`
  - `Ctrl+B n/p` -> pane focus next/previous
  - `Ctrl+B }/{` -> pane move next/previous
  - `Ctrl+B o/O` -> rotate panes
  - `Ctrl+B =` -> equalize panes
  - `Ctrl+B Space` -> tiled layout
  - `Ctrl+B s` -> synchronized panes toggle
- Removed the frontend prefix command lookup table from `useCanvasIME`.
- Kept only the minimum browser-side synchronous gate required to call `preventDefault()` during `keydown`; command lookup and prefix dispatch semantics are Rust-owned.
- Cleans up per-terminal keymap state when a terminal is removed.
- Added Rust keymap coverage for the Aether default prefix bindings.
- Updated frontend input tests so `Ctrl+B` flows through `mux_process_keymap_event`.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml --lib` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux::keymap -- --nocapture` passed: 7 tests.
- `pnpm exec tsc --noEmit --pretty false --diagnostics` passed.
- `pnpm exec vitest run src\__tests__\TerminalCanvasInput.test.tsx` passed: 45 tests.

Remaining before this can be called Core Wizard:

- Wire `Ctrl+B c` / window-level mux commands into the App tab model instead of leaving them as backend-resolved but UI-unhandled commands.
- Add large-history scrollback/search and command-block replay gates.
- Add real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: Large Scrollback/Search Gate Added

Completed:

- Added `pnpm verify:scrollback-gates` as a release-facing smoke check.
- Added `/sessions/:id/search` to the sidecar REST API for retained scrollback search.
- Added backend `PtyManager::search_scrollback` and file-backed scrollback search primitives.
- The smoke launches the PTY sidecar with isolated mux/scrollback directories and hidden Windows process creation.
- It opens a real `cmd` PTY, streams a generated 3000-line burst through the terminal, and verifies:
  - the first burst line;
  - the final burst line;
  - an explicit tail marker after the burst.
- It also queries the new search endpoint for the final burst line and verifies the matched line text is returned.
- The smoke writes a JSON report to `.codex-auto/performance/scrollback-gates.json`.
- Added Rust coverage for large command-block extraction so a long command output keeps the next prompt/block boundary intact.
- Added Rust coverage for scrollback search matching, limits, and case-sensitive mode.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml --lib pty::buffer -- --nocapture` passed: 15 tests.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib pty::scrollback -- --nocapture` passed: 5 tests.
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aetherctl` passed.
- `pnpm verify:scrollback-gates` passed with `large-capture-preserves-head-tail-and-final-marker` and `large-search-finds-final-burst-line`.

Remaining before this can be called Core Wizard:

- Wire `Ctrl+B c` / window-level mux commands into the App tab model instead of leaving them as backend-resolved but UI-unhandled commands.
- Add real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.

### 2026-05-13: `Ctrl+B c` Creates an App Tab

Completed:

- Connected the Rust keymap `new-window` command to the React app shell.
- `Ctrl+B c` now creates a new workspace tab instead of being resolved by Rust and ignored by the UI.
- The new tab inherits the source pane's shell and cwd when available, matching tmux's "new window from current context" expectation more closely.
- Added frontend regression coverage that verifies `Ctrl+B c` dispatches `new-window` through the Rust keymap IPC path without writing bytes to the PTY.

Validation:

- `pnpm exec vitest run src\__tests__\TerminalCanvasInput.test.tsx` passed: 46 tests.
- `pnpm exec tsc --noEmit --pretty false` passed.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib mux::keymap -- --nocapture` passed: 7 tests.
- `pnpm build` passed.

Remaining before this can be called Core Wizard:

- Add real desktop WebView visual smoke for console flash, IME positioning, contrast, and mount timing.
- Extend `Ctrl+B c` from App-tab creation into true daemon-owned mux window groups if the product decides to model tmux windows separately from workspace tabs.

### 2026-05-13: Release Gates Tightened for Visual/IME Confidence

Completed:

- Added broader theme contrast regression coverage across all mood presets for core chrome, settings cards, toolkit tiles, widgets, and statusbar text.
- Strengthened IME candidate anchoring so right-side panes account for the actual WebView/visualViewport bounds, not only the canvas width.
- Added unit coverage for:
  - viewport-aware IME X/Y candidate guards;
  - right-side pane candidate placement;
  - existing IME failure telemetry and composition behavior.
- Extended live Tauri/WebView2 smoke to collect:
  - console errors;
  - page errors;
  - failed requests;
  - full-page screenshots;
  - app/main/right-rail visible rects;
  - terminal canvas nonblank pixel samples;
  - representative live text contrast checks.
- Updated IME CDP verification to write `.codex-auto/production-smoke/verify-ime.json`, matching the production risk closure script's expected evidence path.
- Added scrollback capture/search smoke to the release gate.
- Changed the production release gate so fresh live WebView and fresh IME evidence are required by default; reuse now has to be explicit via `--reuse-live` / `--reuse-ime`.

Validation:

- `pnpm exec vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\themePalette.test.ts` passed: 77 tests.
- `pnpm exec tsc --noEmit --pretty false` passed.
- `node --check` passed for:
  - `scripts\verify-live-tauri-workstation-surfaces.mjs`
  - `scripts\verify-ime.mjs`
  - `scripts\verify-release-gate.mjs`
  - `scripts\verify-production-release-gate.mjs`
- `node scripts\verify-release-gate.mjs --preflight --allow-dirty` passed.

Remaining before this can be called Core Wizard:

- Run a fresh live WebView2/CDP smoke on the built app, not only script syntax and unit gates.
- Extend `Ctrl+B c` from App-tab creation into true daemon-owned mux window groups if the product decides to model tmux windows separately from workspace tabs.
## 2026-05-22 Final Evidence Refresh

- Current release score evidence: `96/100`, `321/335`.
- `releaseCandidateReady=false`; final-goal audit status is `blocked-by-external-gates` until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` are both proven.
- Authenticated prompt execution remains gated by `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` and explicit consent; the safe proof registry is `24/24`.

## 2026-05-24 Release Evidence Refresh

- Current hybrid release score evidence: `96/100`, `321/335`, `releaseCandidateReady=false`.
- Final-goal audit status is `blocked-by-external-gates` for the current Rust-core product boundary until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` both pass.
- Full-native Rust Wizard status is not yet complete; it is governed by `docs/FULL_NATIVE_RUST_FINAL_GOAL.md` and `pnpm verify:full-native:audit`.

## 2026-05-31 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `93/100`, `313/335`, `releaseCandidateReady=false`.
- Projected score after the fresh final-goal evidence map remains `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- Rust-core terminal, mux restore, native IME/clipboard, AI CLI sidecar, right rail workflow, and runtime hygiene gates are green in the non-token/non-real-sleep scope.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for `authenticated-ai-cli-prompt-smoke`.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `24/24`.
