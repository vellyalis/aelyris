# Terminal Native Core and Editor Descope Plan

Date: 2026-05-17
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

## Product Direction

Aether should stay a React + Tauri workspace shell for fast iteration, visual polish, settings, panels, and orchestration. The terminal core should move toward Rust-owned correctness: PTY lifecycle, pane/session model, scrollback, keymap, IME placement, persistence, recovery, and performance-sensitive rendering state.

The built-in Monaco editor is no longer a strategic center. Opening files in VSCode is enough for most workflows, and removing the editor surface reduces memory, bundle size, LSP process churn, and focus/IME contention.

## P0: Terminal Correctness

- Keep React/Tauri as the UI shell.
- Treat IME positioning as a release blocker for AI CLIs; as of 2026-05-19 this release gate is passing, but the rule remains non-negotiable for future changes.
- Prefer Rust-owned terminal/session state over DOM heuristics where possible.
- Keep AI CLI input anchoring enabled in every terminal surface, including embedded agent terminals.
- Verify Codex CLI, Claude Code CLI, and Gemini CLI separately because their TUI cursor semantics differ.

## 2026-05-22 Current State Audit

Resolved for the current release gate:

- Native IME live verification passes with 12 checks.
- `pnpm verify:release:production` and release doctor evidence remain part of the release proof chain.
- `pnpm verify:quality-score` reports `96/100`, grade `A`, `321/335`, `releaseCandidateReady=false`.
- `pnpm verify:goal:safe` reports `blocked-by-external-gates` with `24/24` proof artifacts passing and `0` implementation-fixable blockers, including the objective-level `goal-completion-matrix`, current supply-chain audit proof, `goal-external-gate-readiness`, optional git handoff artifacts, `glass-legibility-contract`, and `goal-anti-stall-contract`.
- Current state is `blocked-by-external-gates`; the remaining blockers are host real sleep/resume evidence and `authenticated-ai-cli-prompt-smoke`, because the final authenticated AI CLI prompt smoke may spend tokens and must not run without explicit consent.
- `authenticated-ai-cli-consent-packet` is green and fixes the exact opt-in path: set `AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` before running the authenticated prompt smoke.
- xterm.js is no longer a product dependency; terminal parsing/grid state is Rust-owned through `alacritty_terminal`.
- Tauri's normal terminal input path uses the native input surface; legacy WebView textarea code remains only for non-Tauri/emergency fallback and tests.
- Pane split/close/restart, mux live restore, scrollback search, and mux performance are release-gated.
- `aether-native` has started as a no-WebView Rust client proof. It attaches to the same mux daemon/API, proves list/send/capture/detach/attach, creates a layered Win32 native window with recorded process identity, renders daemon-captured terminal text through Win32/GDI, feeds daemon capture into Rust `TermEngine`, materializes renderer-neutral `NativeRenderFrame` evidence, and renders a native terminal cell grid with matching frame-hash and nonblank cell/pixel evidence. It is not yet a daily-driver native terminal window.

Still not complete:

- The shipping shell is still React/Tauri/WebView/Canvas 2D, not a full-native Rust UI.
- Emergency WebView input fallback code still exists and must be visible in telemetry/gates until removed.
- The default editor path is not fully descoped; Monaco dependencies are still present.
- The native renderer/window spike has reached native GDI text, TermEngine grid-render, and renderer-neutral RenderFrame proofs, but has not reached `winit`/`wgpu` terminal grid rendering, native IME dogfood inside the native client, or native glass customization yet.

Revised priority:

1. Keep the current Tauri shell as the shipping product while it is green and fast enough.
2. Remove silent fallback shadows from the terminal path.
3. Descope Monaco by making VSCode/external open the default path.
4. Grow the `aether-native` attaching client into a real terminal window only after each step keeps using the same Rust mux daemon/API.
5. Move full-native UI work toward the right rail, provenance, recovery, and customization edge rather than editor parity.

## P1: Native Core Boundary

Rust should own:

- PTY spawn/resize/write/kill/restart.
- Pane split tree, move/swap/even layout, session identity, and recovery.
- Persistent scrollback and terminal snapshots.
- Prefix/keymap processing.
- AI CLI session classification and input-region hints where possible.
- IME candidate positioning API and diagnostics.

React should own:

- Visual layout, settings, command palette, right rail, file tree, and workflow UI.
- Rendering the current terminal grid until a full native renderer is justified.
- User-facing diagnostics and QA overlays, gated off by default.

## P1: Editor Descope

Phase 1:
- Add an editor open mode: `builtin` vs `vscode`.
- Default new installs to `vscode`.
- Route FileTree, Search, Quick Open, terminal file links, and SCM open actions to VSCode.

Phase 2:
- Split diff behavior: `monaco`, `external`, or `text`.
- Route file diffs to VSCode diff or a lightweight internal read-only text diff.
- Keep SCM metadata and review queue in Aether.

Phase 3:
- Stop starting LSP when builtin editor is disabled.
- Remove Monaco chunks, Monaco Vim, and editor-only LSP wiring after external open mode is stable.

## Acceptance Gates

- Codex CLI, Claude Code CLI, and Gemini CLI Japanese IME candidate windows stay at the visible input/preedit position.
- Pane split/close/reopen does not flash a console window or lose focus.
- New agent terminals inherit AI CLI IME anchoring.
- Opening a file from any Aether surface opens VSCode at the file/line.
- No editor/LSP bundle is loaded when editor mode is `vscode`.
- `pnpm test`, `pnpm exec tsc --noEmit`, and release build pass.
- `pnpm verify:terminal:native-input` must prove native input ownership or explicitly block release if the normal path falls back to WebView input.
- Any compatibility fallback must emit evidence and never silently change terminal semantics.
## 2026-05-22 Final Evidence Refresh

- Current release score evidence: `96/100`, `321/335`.
- `releaseCandidateReady=false`; final-goal audit status is `blocked-by-external-gates` until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` are both proven.
- Authenticated prompt execution remains gated by `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini` and explicit consent; the safe proof registry is `24/24`.

## 2026-05-24 Release Evidence Refresh

- Current hybrid release score evidence: `96/100`, `321/335`, `releaseCandidateReady=false`.
- Final-goal audit status is `blocked-by-external-gates` for the current Tauri shell plus Rust terminal-core boundary until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` both pass.
- Full-native Rust is now a separate migration goal; the native client still needs a real present loop, native IME dogfood, native settings, and native Command Center.

## 2026-05-31 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `93/100`, `313/335`, `releaseCandidateReady=false`.
- Projected score after the fresh final-goal evidence map remains `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- The native-first hybrid boundary remains the release definition: Rust owns terminal truth, mux/session, IME/clipboard, AI CLI sidecar, recovery, and runtime gates while React/Tauri owns the non-hot-path UI.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for `authenticated-ai-cli-prompt-smoke`.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `24/24`.
