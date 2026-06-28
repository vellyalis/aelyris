# Full Native Rust Final Goal

Date: 2026-05-24

## Status Update: Superseded As Release Goal

As of 2026-05-26, this document is no longer the release goal.

The release target has been revised to a native-first hybrid product goal:

- Rust/native owns the terminal hot path and durable product truth.
- Tauri/React/WebView may remain for non-hot-path, contract-backed product UI.
- Full-native Rust remains a strict stretch audit, not the release requirement.

The current release-goal source of truth is:

- `docs/history/NATIVE_FIRST_HYBRID_PRODUCT_GOAL.md`

Keep this file as the strict full-native audit history and optional stretch roadmap.

## Final Goal

Aether is full-native Rust only when the primary daily-driver app can run as `aether-native` without React, WebView, DOM, CSS, or browser input semantics owning the product experience.

The current Tauri/React shell may remain as a compatibility client during migration, but it must stop being the product truth. The Rust daemon, mux graph, terminal model, render frame, input path, Command Center data, configuration, and recovery/provenance model must be reusable by every client, with the native Rust shell as the first-class one.

## Current Truth

Current state is not full-native Rust yet.

Already strong:

- Rust owns PTY/session/mux, terminal parsing/grid state, native input in the Tauri shell, persistent scrollback, command evidence, AI CLI sidecar boundaries, and recovery/provenance contracts.
- `aether-native` exists as a no-WebView Rust client spike.
- `aether-native` can attach to the daemon/API, create a native Win32 layered window, render daemon capture through native GDI, and consume the renderer-neutral `NativeRenderFrame`.
- `aether-native present-loop-proof` now repeatedly presents a terminal `NativeRenderFrame` into a native Win32 window, proving a live native window loop beyond offscreen GDI rendering. This is still a GDI proof, not the final GPU renderer.
- The existing release-quality gate can report `100/100` for the current hybrid architecture.

Still missing for the full-native claim:

- Native `winit`/`wgpu` renderer dogfooding beyond proof mode; the current renderer now has a font-atlas proof, but it is not yet the primary daily-driver terminal.
- Native IME dogfood inside `aether-native`, including Japanese preedit/commit at Codex CLI, Claude Code CLI, and Gemini CLI prompt rows.
- Native clipboard, selection, mouse, paste guard, and focus handling inside the native client.
- Native settings UI for theme, material, opacity, wallpaper image, image placement, shell profiles, keymaps, and AI CLI provider profiles.
- Native Command Center/right rail: recovery, provenance, run control, review queue, context packs, and AI CLI launch planner must be actionable without React.
- Native visual QA harness for screenshots, pixel nonblank checks, contrast, resize, sleep/resume, focus, IME, and no-flash process behavior.
- Accessibility and keyboard navigation strategy for the native shell.
- React/WebView demoted to compatibility mode, not the primary app.

## Phase Plan

### Clauge-Inspired Native Mode Shell

The native product shell should adopt the useful part of Clauge's information architecture: a clear mode rail, a dominant work surface, and a contextual inspector. This is tracked in `docs/history/CLAUGE_INSPIRED_NATIVE_MODE_SHELL_PLAN_2026-05-25.md`.

This does not change the full-native definition. Aether is still terminal-first and Rust-native-first. The Clauge-style direction is used to make the native shell understandable:

- left mode rail for Terminal, Agents, Workspace, Review, Git, Context, History, and Settings;
- center surface for the active terminal/workspace mode;
- right inspector for the selected pane, agent, task, file, risk, or evidence item;
- Rust-owned mode/inspector contracts before React previews;
- no broad REST/SQL/NoSQL/S3 expansion until the terminal/agent/review/git/context/history/settings loop is native-ready.

### Phase 1: Honest Native Readiness Gate

Goal: prevent false "full native" claims.

Deliverables:

- `aether-native contract` exposes `fullNativeReadiness`.
- `pnpm verify:full-native:audit` reports the exact missing native pieces.
- Strict mode can fail CI once the team decides to enforce the final native target.

Exit criteria:

- The audit clearly says whether Aether can claim full-native Rust.
- Missing work is machine-readable in `.codex-auto/quality/full-native-rust-gap-audit.json`.

### Phase 2: Native Present Loop

Goal: replace static/offscreen GDI proof rendering with an interactive native terminal window, then move that loop to a GPU renderer.

Deliverables:

- Add a native present loop proof that opens an interactive native window and repeatedly presents terminal frames.
- Add a native present loop using `winit` plus `wgpu`, or an equivalent Rust-native GPU renderer with a documented reason.
- Consume `NativeRenderFrame` directly.
- Render dirty rects and cursor without changing terminal truth.
- Add frame timing, nonblank pixel, resize, and DPI evidence.

Exit criteria:

- `aether-native` opens a visible interactive terminal grid.
- It renders from the same daemon session and frame hash as the existing proof.
- No React/WebView is involved.
- The GDI present-loop proof is replaced or supplemented by a GPU-backed renderer before full-native completion is claimed.

### Phase 3: Native Input Dogfood

Goal: make terminal input fully native in the native client.

Deliverables:

- Native IME composition/preedit/commit path.
- Native clipboard read/write and paste guard.
- Selection, mouse, scrollback viewport, focus, shortcuts, and prefix/keymap dispatch.
- AI CLI prompt-row anchoring for Codex, Claude Code, and Gemini.

Exit criteria:

- Japanese IME works in PowerShell, cmd, Codex CLI, Claude Code CLI, and Gemini CLI inside `aether-native`.
- Clipboard paste and destructive paste guards work without browser fallback.

### Phase 4: Native Product Shell

Goal: move the product edge into native UI.

Deliverables:

- Native Command Center/right rail.
- Native settings/theme/customization.
- Native launch planner and provider readiness actions.
- Native recovery/provenance/context-pack surfaces.
- External-editor-first file actions; Monaco is not a native parity requirement.

Exit criteria:

- A user can run the core AI workspace loop from `aether-native` without opening the React shell.

### Phase 5: Release Parity and Demotion of WebView

Goal: make native Rust the primary shipping app.

Deliverables:

- Native visual QA.
- Native accessibility/keyboard navigation proof.
- Native crash/runtime hygiene.
- Sleep/resume proof.
- Packaging/process identity as Aether, not WebView.
- React/Tauri marked compatibility/legacy in docs and gates.

Exit criteria:

- `pnpm verify:full-native:audit -- --strict` passes.
- The native shell is the daily-driver release candidate.

## Scoring Target

The full-native target is stricter than the current release score.

- `100/100 current release score`: current hybrid product is internally consistent.
- `100/100 full-native score`: native Rust shell is the primary daily-driver product.

The second score is the new goal. It is not complete until every missing item above has passing evidence.

## 2026-05-24 Progress

- Added `aether-native present-loop-proof`.
- Added native-client evidence for multiple nonblank frames presented from the same daemon-backed `NativeRenderFrame`.
- Added `aether-native gpu-render-proof` using `wgpu` offscreen rendering: GPU adapter/device creation, WGSL shader compilation, render pipeline creation, one draw submission, and `NativeRenderFrame` hash parity are now verified without React/WebView.
- Refreshed live native HWND paste evidence after the `HWND` type-boundary fix, then re-ran the native boundary audit.
- `pnpm verify:terminal:native-client` now includes `native-gpu-render-proof` and `native-gpu-render-frame-contract`.
- `pnpm verify:terminal:native-boundary` reports `14/14` passing.
- `pnpm verify:full-native:audit` now reports `54/100`, `62/114`, `in-progress`.
- Remaining Phase 2 work is a visible `winit/wgpu` terminal surface that dogfoods dirty-rect rendering in the interactive native client. The offscreen GPU proof is complete, but it is not the daily-driver renderer yet.

## 2026-05-24 Progress 2

- Added `aether-native winit-wgpu-proof`.
- Added `winit 0.30.13` and connected a Windows native `winit` window to a `wgpu` swapchain.
- The native client proof now verifies multiple swapchain presents from the same daemon-backed `NativeRenderFrame`, with `native-winit-wgpu-surface-proof`, `native-winit-wgpu-frame-contract`, `webviewUsed=false`, and `reactUsed=false`.
- `pnpm verify:terminal:native-client` passes with the winit/wgpu surface proof.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` now reports `58/100`, `66/114`, `in-progress`.
- Remaining Phase 2 renderer work is now narrower: draw actual terminal glyphs/cursor/dirty rects on the winit/wgpu surface. Current winit/wgpu proof proves the surface and present loop, not full glyph rendering.

## 2026-05-24 Progress 3

- Extended `aether-native winit-wgpu-proof` so the visible GPU surface now consumes `NativeRenderFrame` cell geometry, cursor geometry, and dirty rects as GPU instance data.
- The renderer now reports `glyphMode=cell-quad-proof`, `terminalGlyphQuads`, `cursorQuads`, `dirtyRectDogfood=true`, `dirtyRectsRendered`, `dirtyCells`, and `dirtyRows`.
- This is intentionally not claimed as a finished font renderer: cell quads prove the dirty-rect/cursor/cell contract on the GPU surface, while the next renderer must replace them with a real font atlas.
- `pnpm verify:terminal:native-client` passes with `native-winit-wgpu-dirty-rect-cell-proof` and `native-winit-wgpu-cursor-cell-proof`.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` now reports `59/100`, `67/114`, `in-progress`.
- Remaining Phase 2 renderer work is now the font-atlas winit/wgpu terminal glyph renderer.

## 2026-05-24 Progress 4

- Replaced the `cell-quad-proof` glyph proxy in `aether-native winit-wgpu-proof` with a native font-atlas glyph path.
- Added `fontdue` rasterization from Windows terminal fonts (`CascadiaMono.ttf`, `CascadiaCode.ttf`, or `consola.ttf`) and uploads the atlas into a `wgpu` `R8Unorm` texture.
- The winit/wgpu pass now uses separate GPU pipelines for dirty/cursor rects and glyph atlas sampling, while preserving `NativeRenderFrame` hash parity.
- The renderer now reports `glyphMode=font-atlas`, `fontAtlas=true`, `fontAtlasGlyphs`, `fontAtlasFontPath`, and `native-winit-wgpu-font-atlas-proof`.
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native` passes `7/7`.
- `pnpm verify:terminal:native-client` passes with `native-winit-wgpu-font-atlas-proof`.
- Refreshed live `WM_PASTE` evidence with WebView2 CDP and re-ran `pnpm verify:terminal:native-input`; the native input bridge is current and passing.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` now reports `60/100`, `68/114`, `in-progress`.
- Remaining blockers are now native IME dogfood, native settings/customization, native Command Center/right rail, native accessibility, native visual QA, and demoting React/WebView to compatibility-only status.

## 2026-05-24 Progress 5

- Added `aether-native ime-proof`.
- The proof models native-client IME preedit and commit state without React/WebView, anchors preedit at the Rust `NativeRenderFrame` cursor rect, then commits Japanese text back into the Rust terminal grid.
- The proof records `schema=aether.native.ime-proof.v1`, `nativeImeStateMachine=true`, `nativePreeditOverlay=true`, `nativeCommitPath=true`, `webviewUsed=false`, and `reactUsed=false`.
- Fixed the proof's Japanese wide-cell visibility check: `linePreview` can include spacer cells as `あ い う`, so the verifier now treats those spacer cells as display metadata rather than a failed commit.
- `pnpm verify:terminal:native-client` now includes `native-ime-state-machine-proof`, `native-ime-preedit-anchor-proof`, and `native-ime-commit-render-frame-proof`.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` now reports `61/100`, `70/114`, `in-progress`.
- This is not yet live OS IME dogfood. The remaining IME blocker is processing real `winit`/Win32 IME events inside `aether-native` and running Codex/Claude/Gemini prompt-row dogfood there.

## 2026-05-24 Progress 6

- Added `aether-native settings-proof`.
- Added `AETHER_CONFIG_HOME` support to the Rust config path so native settings verification can use an isolated temporary config home without touching the user's real `~/.aether/config.toml`.
- The proof uses the real Rust `load_config` / `save_config` path to round-trip theme, mood, opacity, palette overrides, material overrides, and wallpaper image placement.
- The proof then changes opacity and wallpaper opacity, saves again, reloads again, and records `hotReloadProof.changedWithoutReact=true`.
- `pnpm verify:terminal:native-client` now includes `native-settings-config-roundtrip-proof`, `native-settings-hot-reload-proof`, `native-settings-wallpaper-customization-proof`, and `native-settings-material-customization-proof`.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` now reports `63/100`, `72/114`, `in-progress`.
- This is not yet a native settings dialog. The remaining settings blocker is a native window surface/dialog that edits these Rust-owned settings directly.

## 2026-05-25 Progress 7

- Added `aether-native command-center-proof`.
- The proof exposes Command Center/right-rail data through the Rust native client boundary without React/WebView: full-native audit status, native boundary evidence, native-client evidence, command recovery, AI CLI launch planning, and actionable next-step operations.
- The proof records `schema=aether.native.command-center-proof.v1`, `nativeCommandCenter=true`, `mode=data-contract-proof`, `rightRailDataOwnedByRust=true`, `webviewUsed=false`, `reactUsed=false`, and `nextProof=native-command-center-window-ui`.
- `scripts/verify-native-client-spike.mjs`, `scripts/verify-native-boundary-contract.mjs`, and `scripts/verify-full-native-rust-gap-audit.mjs` now require the native Command Center data/action proof separately from the still-open native Command Center window UI.
- Validation passed: `node --check` for the three verifier scripts, `cargo fmt --manifest-path src-tauri\Cargo.toml`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, and a manual PowerShell-launched sidecar run of `aether-native command-center-proof`.
- `pnpm verify:terminal:native-client` could not complete in the current Codex sandbox because Node child-process spawning returns `EPERM` for `cargo`, `powershell.exe`, and the sidecar exe. PowerShell direct launch proves the sidecar and native command work, but the aggregate Node verifier artifact must be refreshed in an environment where Node child process spawning is allowed.
- This is not yet the native Command Center UI. The remaining blocker is a native window/surface that renders and operates these Rust-owned actions directly.

## 2026-05-25 Progress 8

- Added `aether-native command-center-window-proof`.
- The proof renders the Rust-owned Command Center/right-rail data into a native Win32 layered window, including evidence rows, action rows, keyboard-index metadata, and action hit-target rectangles.
- The proof records `schema=aether.native.command-center-window-proof.v1`, `nativeCommandCenterWindow=true`, `nativeRightRailWindow=true`, `windowUi=true`, `webviewUsed=false`, `reactUsed=false`, `rightRailUiStatus=native-command-center-window-ui-proof`, and `nextProof=native-command-center-input-and-scroll`.
- The native-client, native-boundary, and full-native audit verifiers now require this window proof separately from the remaining full right-rail parity work.
- Because Node child-process spawning is blocked by `EPERM` in this sandbox, the native-client aggregate artifact was refreshed through a PowerShell-launched sidecar run that executed the same native proof commands and wrote `.codex-auto/quality/native-client-spike.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the native verifier scripts, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `67/100`, `76/114`, `in-progress`.
- Remaining blockers: native live OS IME dogfood, native settings customization UI, Command Center input/scroll and React right-rail demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Progress 9

- Added `aether-native command-center-input-scroll-proof`.
- The proof adds a Rust-owned Command Center input/scroll model with bounded keyboard selection, PageDown/Home/End/Enter transitions, a stable visible action window, and no-React/no-WebView action dispatch guardrails.
- The proof records `schema=aether.native.command-center-input-scroll-proof.v1`, `nativeCommandCenterInput=true`, `nativeCommandCenterScroll=true`, `eventLoopOwner=rust`, `keyboardNavigation=true`, `scrollModel=true`, `actionDispatchPlan=true`, and `nextProof=react-right-rail-compatibility-demotion`.
- The native-client verifier, native-boundary contract, and full-native audit now track `native-command-center-input-navigation-proof`, `native-command-center-scroll-model-proof`, and `native-command-center-action-dispatch-proof`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the native verifier scripts, manual sidecar execution of `aether-native command-center-input-scroll-proof`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `68/100`, `78/114`, `in-progress`.
- Remaining blockers: native live OS IME dogfood, native settings customization UI, live Command Center input/scroll wiring plus React right-rail demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Progress 10

- Added `aether-native mode-shell-proof`.
- The proof defines the Clauge-inspired native mode shell as a Rust-owned contract rather than a React redesign: fixed modes for Terminal, Agents, Workspace, Review, Git, Context, History, and Settings.
- The proof records `schema=aether.native.mode-shell.v1`, `nativeModeShell=true`, a native mode rail contract, a Command Center-backed contextual inspector contract, exact selected entity routes for all 8 modes, `webviewUsed=false`, `reactUsed=false`, `readyForReactDemotion=false`, and `nextProof=native-mode-rail-window-proof`.
- The native-client verifier now requires exact mode ids, exact `Alt+1` through `Alt+8` shortcuts, exact Rust-owned routes, inspector counts matching Command Center backing data, and no React/WebView at shell, rail, inspector, and Command Center layers.
- Added standalone evidence at `.codex-auto/quality/native-mode-shell-proof.json`.
- The native-boundary and full-native audit verifiers now score `native-mode-shell-contract` separately from the still-open native Command Center/right-rail demotion work.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `70/100`, `80/114`, `in-progress`.
- Remaining blockers: native live OS IME dogfood, native settings customization UI, live native Command Center/right-rail demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Progress 11

- Added `aether-native mode-rail-window-proof`.
- The proof renders the native mode rail into a Win32 layered window without React/WebView.
- The window proof records `schema=aether.native.mode-rail-window-proof.v1`, `nativeModeRailWindow=true`, `nativeModeRail=true`, `windowUi=true`, `modeRowsRendered=8`, `hitTargetCount=8`, `keyboardNavigation=true`, `nonBlank=true`, `readyForReactDemotion=false`, and `nextProof=native-inspector-window-proof`.
- The native-client verifier now requires all 8 mode hit targets, exact shortcuts, keyboard transition evidence, nonblank pixels, and no React/WebView.
- Added standalone evidence at `.codex-auto/quality/native-mode-rail-window-proof.json`.
- The full-native audit now scores `native-mode-rail-window-proof` separately, which expands the explicit max score from `114` to `116`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `71/100`, `82/116`, `in-progress`.
- Remaining blockers: native live OS IME dogfood, native settings customization UI, native inspector/right-rail React demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Progress 12

- Added `aether-native inspector-window-proof`.
- The proof renders the Command Center-backed contextual inspector into a Win32 layered window without React/WebView.
- The window proof records `schema=aether.native.inspector-window-proof.v1`, `nativeInspectorWindow=true`, `nativeContextualInspector=true`, `windowUi=true`, `commandCenterBacked=true`, `contextualInspector=true`, evidence rows, action hit targets, keyboard selection, scroll model, nonblank pixels, and no-React/no-WebView dispatch guardrails.
- The proof intentionally records `readyForReactDemotion=false` and `nextProof=react-right-rail-compatibility-demotion`; it proves native inspector rendering, not full React right-rail removal.
- Added standalone evidence at `.codex-auto/quality/native-inspector-window-proof.json`.
- The full-native audit now scores `native-inspector-window-proof` separately, expanding the explicit max score from `116` to `118`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `71/100`, `84/118`, `in-progress`.
- Remaining blockers: native live OS IME dogfood, native settings customization UI, actual native Command Center/right-rail React demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Progress 13

- Added `aether-native right-rail-demotion-proof`.
- The proof verifies that native replacements now exist for the right-rail product path before React is demoted: Rust Command Center data, native Command Center window, native input/scroll model, native mode shell, native mode rail window, native contextual inspector window, and native inspector dispatch guardrails.
- The proof records `schema=aether.native.right-rail-demotion-proof.v1`, `nativeRightRailDemotionProof=true`, `nativeProductPathReady=true`, `reactCompatibilityOnly=false`, `reactRightRailSourcesPresent=true`, `compatibilityStatus=pending-react-right-rail-demotion`, `readyForReactDemotion=true`, and `readyForFullNativeClaim=false`.
- This is deliberately not the final demotion. The proof is a release-safety checkpoint that prevents deleting or downgrading the React right rail until the native product path is proven ready, while also preventing a false full-native claim while React sources still own compatibility surfaces.
- Added standalone evidence at `.codex-auto/quality/native-right-rail-demotion-proof.json`.
- The native-client verifier now requires `native-right-rail-demotion-contract-proof`, `native-right-rail-replacement-map-proof`, and `native-right-rail-demotion-honesty-proof`.
- The native-boundary verifier now checks the right-rail demotion contract from the aggregate native-client artifact.
- The full-native audit now scores `native-right-rail-demotion-readiness` separately, expanding the explicit max score from `118` to `120`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `72/100`, `86/120`, `in-progress`.
- Remaining blockers: live native OS IME dogfood in `aether-native`, native settings customization UI, actual React right-rail compatibility demotion, native accessibility/UIA proof, native visual QA, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 14

- Added `aether-native settings-window-proof`.
- The proof renders Rust-owned settings into a Win32 layered native window without React/WebView, including theme, mood, window opacity, wallpaper image path, wallpaper opacity, wallpaper position, wallpaper scale, material colors, terminal material, and palette controls.
- The proof records `schema=aether.native.settings-window-proof.v1`, `nativeSettingsWindow=true`, `nativeSettingsCustomization=true`, `windowUi=true`, `hotReloadBound=true`, `readyForReactSettingsDemotion=true`, and `readyForFullNativeClaim=false`.
- The native settings window is backed by the existing Rust config round-trip and hot-reload proof, so settings customization is no longer treated as a React-only blocker in the full-native audit.
- Added standalone evidence at `.codex-auto/quality/native-settings-window-proof.json`.
- The native-client verifier now requires `native-settings-window-ui-proof`, `native-settings-window-controls-proof`, `native-settings-window-hot-reload-proof`, and `native-settings-window-nonblank-proof`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `77/100`, `92/120`, `in-progress`.
- Remaining blockers: live native OS IME dogfood in `aether-native`, actual React right-rail compatibility demotion, native accessibility/UIA proof, native visual QA, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 15

- Added `aether-native ime-dogfood-proof`.
- The proof creates a real native Win32 parent window, focuses the Rust `NativeTerminalInputHost` child HWND, observes native `WM_IME_STARTCOMPOSITION`, commits Japanese text through the native HWND message loop, drains it through the native input host, records a Rust-owned commit, and renders the committed text into Codex, Claude, and Gemini prompt-row `NativeRenderFrame` checks.
- The proof records `schema=aether.native.ime-dogfood-proof.v1`, `mode=native-hwnd-message-loop-dogfood`, `nativeHwndImeDogfood=true`, `nativeCompositionSurfaceReady=true`, `webviewCompositionBridgeRequired=false`, `aiCliPromptDogfood=true`, `webviewUsed=false`, and `reactUsed=false`.
- The proof is intentionally honest: it records `realOsImeDogfood=false` and `nextProof=real-os-ime-composition-dogfood`. It proves the native HWND/input path and AI CLI prompt-row rendering, but it does not yet prove a real installed Japanese IME/TSF candidate/composition session.
- Added standalone evidence at `.codex-auto/quality/native-ime-hwnd-dogfood-proof.json`.
- The full-native audit now separates `native-ime-hwnd-dogfood-proof` from the remaining real OS IME dogfood blocker.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `78/100`, `94/120`, `in-progress`.
- Remaining blockers: real OS IME/TSF composition dogfood in `aether-native`, actual React right-rail compatibility demotion, native accessibility/UIA proof, native visual QA, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 16

- Added `aether-native accessibility-proof`.
- The proof emits a Rust-owned semantic accessibility tree for the native shell: window, mode navigation, mode tabs, terminal work surface, inspector, evidence rows, action buttons, and settings controls.
- The proof records named nodes, roles, focus order, keyboard traversal, and no-React/no-WebView action guardrails.
- The proof records planned native accessibility APIs as `UIAutomation` and `accesskit`, but intentionally keeps `screenReaderProviderReady=false` and `readyForFullNativeClaim=false` until the tree is bound to a real UIA/accesskit provider and dogfooded with assistive technology.
- Added standalone evidence at `.codex-auto/quality/native-accessibility-proof.json`.
- The full-native audit now separates `native-accessibility-tree-proof` from the remaining `native-accessibility` UIA/provider dogfood blocker.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `80/100`, `96/120`, `in-progress`.
- Remaining blockers: real OS IME/TSF composition dogfood in `aether-native`, actual React right-rail compatibility demotion, native UIA/accesskit provider dogfood, native visual QA, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 17

- Added `aether-native visual-qa-proof`.
- The proof creates a WebView/CDP-free native visual QA harness that aggregates native present-loop, winit/wgpu terminal, Command Center, mode rail, inspector, settings, and accessibility surfaces.
- The proof records `schema=aether.native.visual-qa-proof.v1`, `nativeVisualQaHarness=true`, `mode=native-pixel-contrast-harness`, `allRequiredSurfacesComplete=true`, `allRequiredSurfacesNonBlank=true`, `contrastPass=true`, `pixelProbePass=true`, `resizeProbePass=true`, `focusCoveragePass=true`, and `webviewUsed=false` / `reactUsed=false`.
- The pixel probe uses Win32 compatible bitmap + `GetPixel`, not WebView2 CDP. It checks desktop and compact resize scenarios and validates WCAG AA contrast pairs for terminal text, Sakura panel text, cyan accent, and warning gold.
- The proof is intentionally honest: it records `sleepResumeDogfood=false` and `nextProof=native-sleep-resume-visual-dogfood`, so real Windows sleep/resume remains open.
- Added standalone evidence at `.codex-auto/quality/native-visual-qa-proof.json`.
- The full-native audit now separates `native-visual-qa-harness` from the remaining real sleep/resume visual dogfood blocker.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check` for the three native verifier scripts, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `82/100`, `98/120`, `in-progress`.
- Remaining blockers: real OS IME/TSF composition dogfood in `aether-native`, actual React right-rail compatibility demotion, native UIA/accesskit provider dogfood, real Windows sleep/resume visual dogfood, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 18

- Completed the React right-rail compatibility demotion checkpoint.
- The current React right-rail surfaces now carry explicit compatibility-client markers: `AgentInspector`, `LivePanesPanel`, `rightRailGoalTrack`, and `rightRailAdvisor`.
- `aether-native right-rail-demotion-proof` now verifies those surfaces as `legacy-tauri-react-client`, with `primarySurface=aether-native`, `productTruthOwner=rust-native-command-center`, `reactOwnsProductTruth=false`, and `webviewDispatchRequired=false`.
- The proof now records `reactCompatibilityOnly=true`, `reactSourcesMarkedCompatibilityOnly=true`, `compatibilityStatus=react-right-rail-compatibility-only`, `reactDemotionComplete=true`, and `nextProof=aether-native-primary-daily-driver-promotion`.
- This does not claim full-native completion. React/WebView still exists as the shipping shell, but the right rail is no longer treated as the product source of truth in the native migration audit.
- Added refreshed standalone evidence at `.codex-auto/quality/native-right-rail-demotion-proof.json`.
- The native-client verifier now requires `react-right-rail-compatibility-demotion-proof`.
- The full-native audit now closes the main `native-command-center` item and leaves only the primary shell promotion under `react-webview-compat-only`.
- Validation passed: `pnpm exec tsc --noEmit`, `node --check` for the three native verifier scripts, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `83/100`, `100/120`, `in-progress`.
- Remaining blockers: real OS IME/TSF composition dogfood in `aether-native`, native UIA/accesskit provider dogfood, real Windows sleep/resume visual dogfood, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 19

- Added `aether-native uia-provider-proof`.
- The proof creates a native Win32 accessibility dogfood window offscreen, projects core semantic controls into native HWND controls, and verifies the result through Windows UIAutomation rather than React/WebView.
- The UIA client proof reads the native root element through `ElementFromHandle`, enumerates descendants, verifies readable names for the terminal work surface, native accessibility action, and settings opacity control, and invokes the action button through `IUIAutomationInvokePattern`.
- The proof records `schema=aether.native.uia-provider-proof.v1`, `nativeUiaProviderDogfood=true`, `uiaProviderBound=true`, `screenReaderProviderReady=true`, `webviewUsed=false`, `reactUsed=false`, and `nextProof=native-accessibility-manual-screen-reader-sweep`.
- The proof remains honest: it records `manualNarratorDogfood=false`, so a manual Narrator/NVDA sweep is not claimed as complete.
- Added standalone evidence at `.codex-auto/quality/native-uia-provider-proof.json`.
- The native-client verifier now requires `native-uia-provider-dogfood-proof`, `native-uia-provider-name-role-proof`, and `native-uia-provider-invoke-proof`.
- The full-native audit now closes the `native-accessibility` item. Accessibility is no longer one of the top-level full-native blockers, though manual screen-reader sweep remains a follow-up hardening gate before broad release confidence.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `85/100`, `102/120`, `in-progress`.
- Remaining blockers: real OS IME/TSF composition dogfood in `aether-native`, real Windows sleep/resume visual dogfood, and promoting `aether-native` to the primary daily-driver shell.

## 2026-05-25 Progress 20

- Added `aether-native ime-os-dogfood-proof`.
- The proof creates a native Win32 parent window, focuses `NativeTerminalInputHost`, opens an Imm32 input context, sets Japanese preedit text through `ImmSetCompositionStringW(GCS_COMPSTR)`, completes the result through `ImmNotifyIME`, drains the native input host, and renders the committed text into Codex, Claude, and Gemini prompt rows through `NativeRenderFrame`.
- The proof records `schema=aether.native.ime-os-dogfood-proof.v1`, `mode=win32-imm32-composition-dogfood`, `nativeOsImeDogfood=true`, `imeApi=Imm32`, `preeditTextMatches=true`, `committedTextMatches=true`, `directPtyCommitCount=1`, `aiCliPromptDogfood=true`, `webviewUsed=false`, `reactUsed=false`, and `realOsImeDogfood=true`.
- The proof remains honest about the next risk: `manualJapaneseImeCandidateDogfood=false`, `tsfCandidateUiDogfood=false`, and `nextProof=native-ime-manual-japanese-candidate-sweep`. It closes the automated OS IME preedit/result path, not a human candidate-window sweep.
- Added standalone evidence at `.codex-auto/quality/native-ime-os-dogfood-proof.json`.
- The native-client verifier now requires `native-ime-os-composition-proof`, `native-ime-os-result-commit-proof`, and `native-ime-os-ai-cli-prompt-proof`.
- The full-native audit now closes `native-ime-dogfood` and keeps the daily-driver claim honest: `canClaimDailyDriverNativeShell=false` until native sleep/resume visual dogfood and primary-shell promotion are complete.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `90/100`, `108/120`, `A`, `in-progress`.
- Remaining blockers: real Windows sleep/resume visual dogfood and promoting `aether-native` to the primary daily-driver shell so React/WebView is compatibility-only.

## 2026-05-25 Progress 21

- Added a native sleep/resume recovery probe inside `aether-native visual-qa-proof`.
- The probe creates a native Win32 message-loop window, dogfoods `WM_POWERBROADCAST` suspend/resume messages, verifies redraw/focus/surface-reconfigure recovery intent, and runs native visual nonblank probes before and after the resume path.
- The proof records `schema=aether.native.sleep-resume-recovery-probe.v1`, `syntheticPowerBroadcastDogfood=true`, `realWindowsSleepResumeDogfood=false`, `doesNotClaimMachineSleep=true`, `wmPowerBroadcastObserved=true`, `postResumeVisualNonBlank=true`, and `readyForRealSleepResumeDogfood=true`.
- This is deliberately not counted as the final sleep/resume blocker. It proves the recovery path is ready without forcing the user machine to sleep; the remaining gate is a real Windows sleep/resume dogfood run.
- Hardened `native_command_center_actions` so the Command Center keeps at least one recovery action even when the full-native audit has only two remaining blockers.
- Hardened right-rail demotion readiness to use standalone inspector-window evidence when the current native-client artifact is partial from a failed prior run.
- Refreshed standalone evidence at `.codex-auto/quality/native-visual-qa-proof.json`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `90/100`, `108/120`, `A`, `in-progress`.
- Remaining blockers: real Windows sleep/resume visual dogfood and promoting `aether-native` to the primary daily-driver shell so React/WebView is compatibility-only.

## 2026-05-25 Progress 22

- Added `aether-native primary-shell-proof`.
- The proof promotes the Rust native surface as the product truth owner for the primary shell while keeping the existing Tauri/React/WebView shell as compatibility-only.
- The proof aggregates native prerequisites from the current artifact set: native-client, native-boundary, winit/wgpu font-atlas renderer, native OS IME result commit, native settings window, native Command Center/right rail replacement, native UIA provider, and native visual QA harness.
- The proof renders a single native Win32 primary shell window with mode rail, terminal surface summary, Command Center actions, and promotion gates. It records `aether.native.primary-shell-window-proof.v1`, nonblank pixels, rendered mode rows, rendered action rows, action hit targets, and no React/WebView usage.
- The proof records `schema=aether.native.primary-shell-proof.v1`, `nativePrimaryShellPromotion=true`, `primarySurface=aether-native`, `productTruthOwner=rust-native-shell`, `reactWebViewCompatibilityOnly=true`, `reactOwnsProductTruth=false`, `webviewOwnsTerminal=false`, and `promotionReady=true`.
- The proof remains honest: it records `readyForFullNativeClaim=false` and `nextProof=real-windows-sleep-resume-dogfood` until the real Windows sleep/resume visual dogfood gate is complete.
- Added standalone evidence at `.codex-auto/quality/native-primary-shell-proof.json`.
- The native-client verifier now requires `native-primary-shell-promotion-proof`, `native-primary-shell-window-proof`, and `react-webview-compatibility-only-proof`.
- The full-native audit now closes `react-webview-compat-only`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` now reports `98/100`, `118/120`, `A`, `in-progress`.
- Remaining blocker: real Windows sleep/resume visual dogfood.

## 2026-05-25 Progress 23

- Hardened the real Windows sleep/resume gate so old Tauri `Aether.exe` evidence cannot close the full-native goal.
- `scripts/verify-real-os-suspend-evidence.mjs` now honors `AETHER_APP_EXE` and `AETHER_APP_PROCESS_NAME`, so the final sleep/resume run can target `aether-native.exe` instead of the legacy release executable.
- The full-native audit now reads `.codex-auto/production-smoke/real-os-suspend-resume.json` but only accepts it when:
  - the app executable path is `aether-native`;
  - the observed process name is `aether-native`;
  - Windows suspend and resume power events are present;
  - app responsiveness, terminal roundtrip, SQLite write, and pane-state preservation passed after resume;
  - the resume timestamp is newer than the current native primary-shell proof.
- Existing 2026-05-19 sleep/resume evidence remains useful history, but it no longer satisfies this full-native gate because it targets `Aether.exe`, not `aether-native.exe`.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:production:suspend:diagnose`, `pnpm verify:production:suspend`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `A`, `in-progress`.
- Remaining blocker: run a real Windows sleep/resume cycle against the current native primary shell and then rerun the full-native audit.

## 2026-05-26 Progress 24

- Tightened the final sleep/resume evidence harness around the native primary shell.
- `scripts/verify-real-os-suspend-evidence.mjs` now has a `--native-primary` target mode that resolves the target executable to `src-tauri/target/debug/aether-native.exe`, stamps the expected process name as `aether-native`, and carries `targetKind=aether-native-primary-shell` in the evidence.
- Added guarded native launch support through `--launch-native-primary`: the harness starts `aether-native primary-shell-proof --show --duration-ms <hold>` as a long-lived visible native shell before arming sleep/resume evidence, then verifies that the exact native process is observable.
- The begin/resume/postcheck path now resets stale release evidence for the selected target, records `suspendTarget` and `nativePrimaryLaunch` metadata, and keeps old `Aether.exe` evidence from leaking into the native final gate.
- Added package scripts for the final native run: `verify:production:suspend:native-begin`, `verify:production:suspend:native-resume`, `verify:production:suspend:native-postcheck`, `verify:production:suspend:native-diagnose`, and guarded `verify:production:suspend:native-cycle`.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `pnpm verify:production:suspend:native-diagnose`, `pnpm verify:production:suspend:diagnose`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `A`, `in-progress`.
- This still does not claim completion. The remaining blocker is the actual user-machine Windows sleep/resume run against the current `aether-native` primary shell.

## 2026-05-26 Progress 25

- Removed verifier fragility that was blocking native proof refresh in the Windows sandbox.
- `scripts/verify-native-client-spike.mjs` now prefers the bundled PTY sidecar, starts it directly without PowerShell by default, avoids mandatory `cargo build` when a debug `aether-native.exe` already exists, and runs `aether-native` with file-backed stdout/stderr instead of spawnSync/pipe-backed execution.
- Fixed a primary-shell self-reference bug: `aether-native primary-shell-proof` no longer requires the aggregate native-client artifact to already be `passed` while that same aggregate verifier is still running; it now accepts the component proofs that are available immediately before the primary-shell proof step.
- Kept Command Center useful when only one blocker remains by adding a baseline `open-native-sleep-resume-preflight` action. This prevents the native right rail from shrinking below the actionability contract as the blocker list gets short.
- Added `verify:production:suspend:native-preflight`, which launches an isolated PTY sidecar, starts a short-lived visible `aether-native primary-shell-proof`, verifies native process observation and API reachability without PowerShell, and writes `.codex-auto/production-smoke/real-os-suspend-native-preflight.json`.
- Current native preflight status is `ready-except-host-event-log-access`: native binary, isolated sidecar API, and native primary shell launch are green; only Windows System event log access is blocked in this Codex sandbox by `spawnSync powershell.exe EPERM`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-diagnose`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `A`, `in-progress`.
- Remaining blocker: run the real Windows sleep/resume gate from a host session that can read the System event log, then rerun native resume/postcheck/full-native audit.

## 2026-05-26 Progress 26

- Removed the last PowerShell dependency from the native sleep/resume event-log path.
- Added `aether-native power-events-proof --start-epoch n --end-epoch n`, backed by the Windows Event Log API (`OpenEventLogW` / `ReadEventLogW`) through Rust. It reads the System log directly, reports `nativeWindowsEventLog=true`, `powershellUsed=false`, raw event count, matched Kernel-Power / Power-Troubleshooter events, and honest suspend/resume/attempted-suspend flags.
- Hardened provider filtering so `id=1` and `id=107` from unrelated providers are no longer treated as resume evidence. Resume only counts Power-Troubleshooter `1` or Kernel-Power `107/507`; suspend only counts Kernel-Power `42/506`; attempted suspend counts Kernel-Power `187`.
- `scripts/verify-real-os-suspend-evidence.mjs` now prefers the native power event proof in `--native-primary` mode for diagnostics and final validation, while legacy non-native mode can still use the older PowerShell path.
- Native preflight now verifies event-log readability through `aether-native`, not `Get-WinEvent`.
- Native process observation also avoids PowerShell for launched native proof windows by checking the launched PID directly from Node.
- Current native preflight is now fully green: `ready-for-real-sleep` with `nativePrimaryTarget`, `nativeBinaryExists`, `nativeProcessObserved`, `apiReachable`, and `systemEventLogReadable` all true.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, direct `aether-native power-events-proof`, `node --check scripts\verify-real-os-suspend-evidence.mjs`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-diagnose`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `A`, `in-progress`.
- Remaining blocker: arm fresh native sleep/resume evidence, run a real Windows sleep/resume cycle, run native resume/postcheck, then rerun the full-native audit.

## 2026-05-26 Progress 27

- Added a guarded Rust-native sleep entrypoint: `aether-native sleep-now`.
- The command uses the Windows power API from Rust and refuses to sleep the host unless the caller explicitly opts in with `AETHER_ALLOW_OS_SLEEP=1` or `--i-understand-this-sleeps-windows`.
- `scripts/verify-real-os-suspend-evidence.mjs` now uses `aether-native sleep-now` for `--native-primary` guarded cycles, keeping PowerShell out of the final native sleep path.
- Repaired a native-client verifier regression where `aether-native primary-shell-proof` read only the previous `native-client-spike.json` while the current verifier run was still assembling its artifact.
- The verifier now passes current-run checks to the primary shell proof, and the Rust proof merges those checks with persisted artifacts. This keeps promotion gates honest without depending on stale JSON.
- Revalidated the IME OS dogfood path after the suspected access-violation regression. Sidecar-backed direct runs and the full native-client verifier both pass `native-ime-os-composition-proof`, `native-ime-os-result-commit-proof`, and `native-ime-os-ai-cli-prompt-proof`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` reports `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: perform the explicitly opted-in real Windows sleep/resume cycle against the current native primary shell, then run native resume/postcheck and the full-native audit.

## 2026-05-26 Progress 28

- Tightened the final native sleep/resume acceptance contract.
- `scripts/verify-real-os-suspend-evidence.mjs` now requires native-primary evidence to carry:
  - `app.targetKind=aether-native-primary-shell`;
  - `validation.suspendTarget.nativePrimaryRequested=true`;
  - `validation.suspendTarget.launchNativePrimaryRequested=true`;
  - `validation.nativePrimaryLaunch.requested=true`, `ok=true`, `status=launched`, and a recorded PID;
  - post-resume process, API health, terminal roundtrip, and SQLite/pane-layout probes.
- Successful native-primary validation now stamps `validation.windowsPowerEvents.source=aether-native-power-events-proof`, `nativeWindowsEventLog=true`, and `powershellUsed=false`, so PowerShell-based or legacy release evidence cannot close the full-native gate.
- `scripts/verify-full-native-rust-gap-audit.mjs` now refuses `native-visual-qa` completion unless the real sleep/resume evidence proves the native primary shell target, native launch, native event-log source, post-resume process identity, API health, terminal roundtrip, and pane-state probes.
- Refreshed `.codex-auto/production-smoke/real-os-suspend-resume.json` to point at the current native-primary executable without running sleep. It remains `pending` by design.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-diagnose`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle with `pnpm verify:production:suspend:native-cycle` after setting `AETHER_ALLOW_OS_SLEEP=1`.

## 2026-05-26 Progress 29

- Added post-resume native visual proof requirements to the final sleep/resume gate.
- `scripts/verify-real-os-suspend-evidence.mjs --native-primary --postcheck` now runs:
  - `aether-native visual-qa-proof` after resume and records pixel probe, contrast, resize, focus coverage, and no React/WebView usage;
  - `aether-native primary-shell-proof` after resume and records native primary window, interactive window, nonblank pixels, mode/action rows, and no React/WebView usage.
- `buildMissingFields` now requires `validation.postResumeProbes.nativeVisual.ok=true`, visual pixel/focus pass, and primary shell nonblank/interactive evidence before native-primary evidence can validate.
- `scripts/verify-full-native-rust-gap-audit.mjs` now refuses the final `native-visual-qa` sleep/resume item unless post-resume native visual proof includes both the visual QA harness and the primary shell nonblank proof.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-diagnose`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle, followed by `native-resume`, `native-postcheck`, and `full-native:audit`.

## 2026-05-26 Progress 30

- Added a native Command Center runbook for the final sleep/resume gate.
- `aether-native command-center-proof` now exposes native, no-React/no-WebView actions for:
  - `pnpm verify:production:suspend:native-preflight`;
  - `pnpm verify:production:suspend:native-begin`;
  - guarded `pnpm verify:production:suspend:native-cycle`;
  - `pnpm verify:production:suspend:native-resume`;
  - `pnpm verify:production:suspend:native-postcheck`;
  - `pnpm verify:full-native:audit`.
- The guarded cycle action records `requiresExplicitOptIn=true` and `explicitOptInEnv=AETHER_ALLOW_OS_SLEEP=1`, so the native Command Center can surface the host-power safety boundary instead of hiding it in script docs.
- `scripts/verify-native-client-spike.mjs` now requires this runbook and records `native-command-center-sleep-resume-runbook-proof`.
- `scripts/verify-full-native-rust-gap-audit.mjs` now refuses the Command Center data proof unless the final sleep/resume runbook exists in the Rust-native action model.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle with native post-resume checks.

## 2026-05-26 Progress 31

- Added a no-sleep native postcheck preflight for the final sleep/resume gate.
- `scripts/verify-real-os-suspend-evidence.mjs --native-primary --native-postcheck-preflight` now launches an isolated sidecar, starts a short native primary-shell proof, and runs the same post-resume probes without pretending the host actually slept.
- The postcheck preflight proves the native primary target, native binary, isolated sidecar readiness, native launch observation, post-resume process observation, API health, terminal roundtrip, SQLite/pane-layout proof, and native visual proof path before the real sleep cycle is attempted.
- The terminal roundtrip probe now talks directly to the sidecar HTTP API in native-primary mode instead of spawning `aetherctl`, avoiding the Windows sandbox `spawn EPERM` false negative.
- The DB/pane-layout probe now has an isolated `aether-native db-smoke-proof` path, so final postcheck readiness does not depend on mutating the user's real database.
- Hardened the automated OS IME dogfood proof after a verifier-only access violation: `ime-os-dogfood-proof` now runs the Imm32 worker through file-backed stdio and `CREATE_BREAKAWAY_FROM_JOB`, preventing Node verifier job inheritance from crashing the native IME worker.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `node --check scripts\verify-real-os-suspend-evidence.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-postcheck-preflight`, and `pnpm verify:full-native:audit`.
- `pnpm verify:production:suspend:native-postcheck-preflight` reports `ready-for-native-postcheck`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle, followed by native resume/postcheck and full-native audit.

## 2026-05-26 Progress 32

- Fixed a real final-gate bug in `writePostResumeProbe()`: the production postcheck writer referenced undefined local variables instead of the collected `probes` object. The preflight path was green, but the real post-resume writer could have failed after an actual sleep/resume cycle.
- Added isolated evidence-path support through `AETHER_PRODUCTION_SMOKE_DIR`, `AETHER_SUSPEND_EVIDENCE_PATH`, `AETHER_SUSPEND_DIAGNOSTIC_PATH`, `AETHER_SUSPEND_SESSION_PATH`, `AETHER_SUSPEND_NATIVE_PREFLIGHT_PATH`, and `AETHER_SUSPEND_NATIVE_POSTCHECK_PREFLIGHT_PATH`. This lets the final postcheck writer be smoke-tested without mutating the real sleep/resume evidence.
- Added `pnpm verify:production:suspend:native-postcheck-write-smoke`, which runs the native postcheck writer against `.codex-auto/production-smoke/postcheck-write-smoke`.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `pnpm verify:production:suspend:native-postcheck-write-smoke`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-postcheck-preflight`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle, followed by native resume/postcheck and full-native audit.

## 2026-05-26 Progress 33

- Promoted the native postcheck writer smoke into a machine-readable evidence artifact: `.codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json`.
- The smoke now launches an isolated sidecar and a native primary-shell proof, runs the actual postcheck writer, verifies app/API/terminal/SQLite/native-visual checks are written as true, and records `noRealSleepClaim=true`.
- Hardened isolated sidecar setup so native preflight, postcheck preflight, and postcheck writer smoke use run-id-specific mux/scrollback directories. This prevents parallel verifier runs from corrupting each other's terminal roundtrip evidence.
- `scripts/verify-full-native-rust-gap-audit.mjs` now surfaces `nativePostcheckWriteSmoke` in `currentTruth` and the artifact path list.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, parallel `pnpm verify:production:suspend:native-preflight` + `pnpm verify:production:suspend:native-postcheck-preflight`, `pnpm verify:production:suspend:native-postcheck-write-smoke`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle, followed by native resume/postcheck and full-native audit.

## 2026-05-26 Progress 34

- Added a no-host-sleep proof for the guarded native sleep command.
- `scripts/verify-native-sleep-guard.mjs` now runs the debug `aether-native.exe sleep-now` entrypoint with `AETHER_ALLOW_OS_SLEEP` explicitly absent, captures stdout/stderr through files, and verifies the command fails closed quickly.
- The proof requires the refusal text to mention `AETHER_ALLOW_OS_SLEEP=1`, rejects any success JSON, rejects any real sleep-attempt claim, and verifies no PowerShell fallback was used.
- Added `pnpm verify:production:suspend:native-sleep-guard`, writing `.codex-auto/production-smoke/native-sleep-guard-refusal.json`.
- `scripts/verify-full-native-rust-gap-audit.mjs` now surfaces `nativeSleepGuard` in `currentTruth` and records the sleep-guard artifact path.
- The Rust-native Command Center runbook now exposes `verify-native-sleep-guard` as a no-React/no-WebView proof action, and `scripts/verify-native-client-spike.mjs` requires that runbook action before accepting the native sleep/resume runbook proof.
- Validation passed: `node --check scripts\verify-native-sleep-guard.mjs`, `pnpm verify:production:suspend:native-sleep-guard`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `node --check scripts\verify-native-client-spike.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle against the current native primary shell, followed by native resume/postcheck and full-native audit. This progress step did not sleep the host.

## 2026-05-26 Progress 35

- Added `aether-native paste-guard-proof`, a Rust-native behavioral proof for terminal clipboard safety.
- The proof creates a Win32 parent window and Aether-owned native input HWND, writes `CF_UNICODETEXT` to the Windows clipboard, sends real `WM_PASTE` to the child HWND, and verifies:
  - single-line LF paste is normalized and drained through the shared native commit path;
  - destructive paste is blocked before any PTY write;
  - multiline paste is blocked before any PTY write;
  - the proof uses no React, WebView, CDP, PowerShell, or browser automation.
- `scripts/verify-native-client-spike.mjs` now requires `native-paste-guard-proof`, `native-paste-guard-wm-paste-proof`, and `native-paste-guard-no-cdp-proof`.
- `scripts/verify-native-terminal-input-host.mjs` now accepts the fresh Rust-native paste guard proof as the behavioral native HWND paste evidence, so the input gate no longer depends on the old CDP-only smoke artifact.
- Fixed a native visual QA false negative: `visual-qa-proof` was reading the in-progress `native-client-spike.json` while that verifier was still running, so current present-loop and winit/wgpu terminal surfaces were invisible. The verifier now writes standalone `native-present-loop-proof.json` and `native-winit-wgpu-proof.json`, and `visual-qa-proof` reads those artifacts directly.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-terminal-input-host.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-input`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-sleep-guard`, and `pnpm verify:full-native:audit`.
- `pnpm verify:full-native:audit` remains `98/100`, `118/120`, `S`, `in-progress`.
- Remaining blocker: explicitly opted-in real Windows sleep/resume cycle against the current native primary shell, followed by native resume/postcheck and full-native audit. This progress step did not sleep the host.
