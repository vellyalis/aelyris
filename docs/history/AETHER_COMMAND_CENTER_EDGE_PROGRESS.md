> **Historical snapshot.** This document may contain stale scores or older release language. Current public readiness is controlled by `README.md`, `docs/README.md`, `docs/requirements.md`, and locally regenerated verifier artifacts. As of the 2026-06-28 public-doc refresh, Aether is alpha / not release-ready.
# Aether Command Center Edge Progress

Date: 2026-05-15
Scope: Sequential execution toward the command-center edge plan.

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
- `authenticated-ai-cli-prompt-smoke` is not run by default because it may spend tokens; `authenticated-ai-cli-consent-packet` must prove the required `QUORUM_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini` boundary before any future token-spending prompt run.
- Current implementation-fixable risks are limited to the `world-class-terminal-ai-os` aggregate gate and its tmux, BridgeSpace, Ghostty/WezTerm-class, and release claim blocks. `rust-native-terminal-core`, `rust-mux-daemon-boundary`, `right-rail-command-center`, and `release-operations-proof` are no longer missing final-goal requirements; they are external-blocked proof paths backed by current artifacts. The remaining host/operator gates are mux live restore, npm supply-chain audit, chunked OSC live proof, Tauri/right-rail live visual proof, live/multipane/recovered/process-reconnect command evidence, release signing/updater, and real OS sleep (`spawn EPERM`, WebView2/CDP unavailable, signing material absent, or `SetSuspendState` unsupported). `authenticated-ai-cli-prompt-smoke` remains explicit-consent blocked. Command Center scenario plus provenance/recovery/context-pack evidence are proved; theme customization, fallback/stale visibility, AI CLI launch planner, right-rail command-evidence jump coverage, and right-rail final goal visibility remain proved. The product must still not claim tmux/BridgeSpace/Ghostty/release parity until the world-class gate passes.
## Superseded Canonical State - 2026-05-22

- `pnpm verify:quality-score` reports `97/100`, grade `S`, `321/331`, `releaseCandidateReady=false`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.
- `.codex-auto/quality/final-goal-safe-summary.json` reports `ok=true`, `proofArtifactPassCount=27/27`, and no implementation-fixable blocker.
- The only remaining blocker is `authenticated-ai-cli-prompt-smoke`, because the final authenticated AI CLI prompt smoke may spend tokens.
- The opt-in artifact is `authenticated-ai-cli-consent-packet`; that final smoke requires `QUORUM_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` plus `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.

### Phase 2.48 - Native winit/wgpu Font Atlas Proof

Status: done

Implemented:

- `aether-native winit-wgpu-proof` now renders terminal glyphs through a native GPU font atlas instead of the earlier cell-quad proxy.
- Added `fontdue` rasterization from Windows terminal fonts and uploads the atlas to a `wgpu` `R8Unorm` texture.
- Split the winit/wgpu renderer into dirty/cursor rectangle and glyph sampling pipelines while keeping the same daemon-backed `NativeRenderFrame` and `frameSha256`.
- The native proof now reports `glyphMode=font-atlas`, `fontAtlas=true`, `fontAtlasGlyphs`, `fontAtlasFontPath`, and check `native-winit-wgpu-font-atlas-proof`.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo check --manifest-path src-tauri\pty-server\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-hwnd-paste`
- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- `.codex-auto/quality/native-client-spike.json` records the native font-atlas proof and no React/WebView usage for the winit/wgpu renderer.
- `.codex-auto/production-smoke/native-hwnd-paste-live.json` and `.codex-auto/production-smoke/native-terminal-input-host.json` were refreshed after the font-atlas changes; live `WM_PASTE` and native input bridge checks pass.
- `.codex-auto/quality/native-boundary-contract.json` remains `14/14` passing.
- `.codex-auto/quality/full-native-rust-gap-audit.json` reports `60/100`, `68/114`, `status=in-progress`.

Residual:

- This clears the proof-level font-atlas renderer gap, but the native shell is still not a full-native daily driver. Remaining blockers are native IME dogfood, native settings/customization, native Command Center/right rail, native accessibility, native visual QA, and React/WebView compatibility-only demotion.

### Phase 2.49 - Native IME State/Anchor Proof

Status: done

Implemented:

- Added `aether-native ime-proof`.
- The proof keeps IME preedit/commit state in the native Rust client boundary and uses `NativeRenderFrame` cursor metrics for the preedit anchor rectangle.
- The commit path writes Japanese text into the Rust terminal engine and proves the committed text is visible in the resulting render frame.
- The proof is deliberately labelled `mode=state-machine-proof` and `realOsImeDogfood=false`, so it does not overclaim live Windows/Japanese IME dogfood.
- The native-client verifier now requires `native-ime-state-machine-proof`, `native-ime-preedit-anchor-proof`, and `native-ime-commit-render-frame-proof`.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- `.codex-auto/quality/native-client-spike.json` records `nativeIme.operation=ime-proof`, `schema=aether.native.ime-proof.v1`, `nativePreeditOverlay=true`, `nativeCommitPath=true`, `webviewUsed=false`, and `reactUsed=false`.
- `.codex-auto/quality/native-boundary-contract.json` remains `14/14` passing.
- `.codex-auto/quality/full-native-rust-gap-audit.json` reports `61/100`, `70/114`, `status=in-progress`.

Residual:

- Live OS IME dogfood is still open. The next step is to process real `winit`/Win32 IME events inside `aether-native` and run Codex/Claude/Gemini prompt-row IME checks there.

### Phase 2.50 - Native Settings Config Proof

Status: done

Implemented:

- Added `aether-native settings-proof`.
- Added `QUORUM_CONFIG_HOME` support to the Rust config loader so proof runs can use an isolated config directory and avoid mutating the user's real `~/.aether/config.toml`.
- The proof writes and reloads theme, mood, window opacity, palette overrides, material overrides, wallpaper image path, wallpaper opacity, wallpaper position, and wallpaper scale through the real Rust `load_config` / `save_config` path.
- The proof saves a second generation and reloads it to verify settings changes can be observed without React/WebView, recording `hotReloadProof.changedWithoutReact=true`.
- The native-client verifier now requires `native-settings-config-roundtrip-proof`, `native-settings-hot-reload-proof`, `native-settings-wallpaper-customization-proof`, and `native-settings-material-customization-proof`.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml config::settings:: -- --nocapture`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- `.codex-auto/quality/native-client-spike.json` records `nativeSettings.operation=settings-proof`, `schema=aether.native.settings-proof.v1`, `webviewUsed=false`, `reactUsed=false`, `theme=sakura-hub`, `mood=aether-sakura`, material overrides, and wallpaper customization.
- `.codex-auto/quality/native-boundary-contract.json` remains `14/14` passing.
- `.codex-auto/quality/full-native-rust-gap-audit.json` reports `63/100`, `72/114`, `status=in-progress`.

Residual:

- The Rust config proof is complete, but a native settings window/dialog is still open. React settings UI remains compatibility until `aether-native` can edit these settings interactively.

### Phase 2.51 - Native Command Center Data Proof

Status: partial

Implemented:

- Added `aether-native command-center-proof`.
- The proof reads the full-native audit, native boundary contract, native client proof, command recovery contract, and AI CLI launch planner artifacts from the Rust native client boundary.
- It emits a native Command Center data contract with `nativeCommandCenter=true`, `mode=data-contract-proof`, `rightRailDataOwnedByRust=true`, `webviewUsed=false`, `reactUsed=false`, and `nextProof=native-command-center-window-ui`.
- It maps open full-native blockers into actionable native operations, including native IME dogfood, native settings UI, native Command Center UI, native accessibility, native visual QA, React/WebView compatibility demotion, and native proof refresh.
- The native-client, native-boundary, and full-native audit verifiers now track this proof as `native-command-center-data-proof` separately from the still-open native Command Center UI.

Validation:

- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- Manual PowerShell sidecar launch plus `src-tauri\target\debug\aether-native.exe command-center-proof`

Result:

- Manual proof output reports `schema=aether.native.command-center-proof.v1`, `actionable=true`, `rightRailDataOwnedByRust=true`, `readyEvidenceCount=5`, and native actions for all currently open full-native blockers.
- The proof remains honest: it does not claim native UI completion and points to `native-command-center-window-ui` as the next proof.

Residual:

- `pnpm verify:terminal:native-client` is currently blocked in this Codex sandbox by Node child-process `EPERM` for `cargo`, `powershell.exe`, and the sidecar exe. The manual PowerShell execution path proves the sidecar and native command, but the aggregate native-client artifact cannot be refreshed from Node until that spawn restriction is gone.
- Native Command Center/right-rail UI is still open. This phase moves the data/action contract to Rust; the next phase must render and operate it in the native shell.

### Phase 2.52 - Native Command Center Window Proof

Status: done

Implemented:

- Added `aether-native command-center-window-proof`.
- The proof reuses the Rust-owned Command Center data contract and renders it into a native Win32 layered window without React/WebView.
- The window proof draws Command Center header text, evidence rows, action rows, and records action hit-target rectangles with keyboard indices.
- The proof is deliberately honest: it reports `rightRailUiStatus=native-command-center-window-ui-proof` and `nextProof=native-command-center-input-and-scroll`, so it does not claim scroll/input parity yet.
- The native-client verifier, native-boundary contract, and full-native audit now score this as `native-command-center-window-proof`, distinct from the remaining full right-rail item.

Validation:

- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- Manual PowerShell sidecar run that executed the native-client proof sequence and refreshed `.codex-auto/quality/native-client-spike.json`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- `.codex-auto/quality/native-command-center-window-proof.json` records `operation=command-center-window-proof`, `window.schema=aether.native.command-center-window-proof.v1`, `nativeRightRailWindow=true`, `actionRowsRendered>=4`, `evidenceRowsRendered>=3`, and `nonBlank=true`.
- `.codex-auto/quality/native-boundary-contract.json` reports `14/14` passing.
- `.codex-auto/quality/full-native-rust-gap-audit.json` reports `67/100`, `76/114`, `status=in-progress`.

Residual:

- Native Command Center still needs actual input/scroll handling and React right-rail demotion before the main `native-command-center` item can close.
- Node child-process `EPERM` remains a sandbox-specific verifier limitation; PowerShell direct execution was used to refresh the aggregate proof artifact this time.

### Phase 2.53 - Native Command Center Input And Scroll Model Proof

Status: done

Implemented:

- Added `aether-native command-center-input-scroll-proof`.
- The proof builds on the Rust-owned Command Center data contract and verifies a native input/scroll model without React/WebView.
- It records bounded keyboard selection through ArrowDown, PageDown, End, Home, and Enter transitions.
- It records visible action-window state, scroll offset guardrails, selected action dispatch, and verifies dispatch does not require React or WebView.
- The proof stays honest by recording `readyForReactDemotion=false` and `nextProof=react-right-rail-compatibility-demotion`.
- The native-client verifier, native-boundary contract, and full-native audit now score this proof separately from final React right-rail demotion.

Validation:

- `node --check scripts\verify-native-client-spike.mjs`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\verify-full-native-rust-gap-audit.mjs`
- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`
- Manual PowerShell sidecar run of `src-tauri\target\debug\aether-native.exe command-center-input-scroll-proof`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:full-native:audit`

Result:

- `.codex-auto/quality/native-command-center-input-scroll-proof.json` records `nativeCommandCenterInput=true`, `nativeCommandCenterScroll=true`, `keyboardNavigation=true`, `scrollModel=true`, `actionDispatchPlan=true`, and no React/WebView dispatch dependency.
- `.codex-auto/quality/native-boundary-contract.json` reports `14/14` passing.
- `.codex-auto/quality/full-native-rust-gap-audit.json` reports `68/100`, `78/114`, `status=in-progress`.

Residual:

- The remaining Command Center/right-rail blocker is now live native input wiring plus React right-rail compatibility demotion, not the data/window/input model itself.

### Phase 2.45 - Native RenderFrame Contract

Status: done

Implemented:

- Added `src-tauri/src/term/render_frame.rs` as the renderer-neutral Rust contract between `GridSnapshot` and native drawing.
- `NativeRenderFrame` now converts Rust terminal cells into positioned native cells with:
  - schema `aether.native.render-frame.v1`;
  - cell metrics and frame pixel bounds;
  - row/column cell rectangles;
  - cursor and image overlay metadata;
  - nonblank/paintable/styled/hyperlink counters;
  - stable `frameSha256`;
  - explicit `webviewUsed=false` and `reactUsed=false`.
- `aether-native grid-render-proof` now builds this RenderFrame first, emits `renderFrame`, and proves the Win32/GDI renderer consumes the same `frameSha256`.
- `scripts/verify-native-client-spike.mjs`, `scripts/verify-native-boundary-contract.mjs`, and `scripts/score-release-quality.mjs` now require the native render-frame contract, not just ad hoc grid summary fields.
- `verify-native-client-spike` now builds `aether-native` once and invokes the compiled binary directly, avoiding repeated `cargo run` timeouts during native boundary verification.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib term::render_frame -- --nocapture`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm exec biome check scripts\verify-native-client-spike.mjs scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs --formatter-enabled=false`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`

Result:

- `.codex-auto/quality/native-client-spike.json` records `nativeGridRender.renderFrame.schema=aether.native.render-frame.v1`, `rendererBoundary=rust-native-render-frame`, `frameSha256` length 64, `nonBlankCells=216`, and matching `renderer.renderFrameSha256`.
- `.codex-auto/quality/native-boundary-contract.json` reports `14/14` native boundary checks passing.

Residual:

- The RenderFrame contract is the bridge to the real renderer, not the final renderer itself. Remaining native-shell work is still `winit`/`wgpu` drawing, native IME dogfood in the native client, native glass/theme rendering, and native visual regression.
- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.44 - Aether Native TermEngine Grid Render Proof

Status: done

Implemented:

- Added `aether-native grid-render-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--alpha n]`.
- The proof reads daemon session capture from the same sidecar/mux API, feeds it into Rust `TermEngine`, and renders the resulting terminal cell grid through a Win32/GDI memory-compatible device context.
- The proof records:
  - source session id;
  - expected marker match;
  - requested grid size;
  - nonblank terminal cell count;
  - occupied row count;
  - cursor row/column/shape;
  - renderer identity `native-gdi-grid-proof`;
  - non-background pixel samples;
  - explicit `webviewUsed=false` and `reactUsed=false`.
- The proof also keeps the layered Win32 native window proof green, so the native grid renderer is tied to the same no-WebView process/window boundary.
- `pnpm verify:terminal:native-client` now proves:
  - daemon attach/list/send/capture/detach/attach;
  - no-WebView layered Win32 native window creation;
  - daemon capture rendered as nonblank native GDI text;
  - daemon capture parsed into a Rust terminal grid and rendered as nonblank native GDI grid cells.
- `pnpm verify:terminal:native-boundary` now treats the TermEngine grid proof as part of the native client boundary.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm exec biome check scripts\verify-native-client-spike.mjs scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs --formatter-enabled=false`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:final-goal-audit`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/quality/native-client-spike.json` records `nativeGridRender.operation=grid-render-proof`, the same daemon instance, `expectedFound=true`, grid `100x24`, `nonBlankCells=216`, renderer `native-gdi-grid-proof`, `nativeCellGrid=true`, `nonBackgroundSamples=354`, `webviewUsed=false`, and `reactUsed=false`.
- `.codex-auto/quality/native-boundary-contract.json` reports `14/14` native boundary checks passing.
- `.codex-auto/quality/release-quality-score.json` reports `97/100`, grade `S`, `315/325`, `releaseCandidateReady=false`.

Residual:

- This is still not the final GPU terminal renderer. It proves Rust terminal-grid ownership and native no-WebView cell rendering first; the remaining renderer work is `winit`/`wgpu` terminal grid drawing, native IME dogfood inside the native client, native glass/theme rendering, and native visual regression.
- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.42 - Aether Native Win32 Window Proof

Status: done

Implemented:

- Added `aether-native window-proof [--duration-ms n] [--alpha n] [--show]`.
- The proof creates a native Win32 top-level window in the `aether-native` process without React or WebView.
- The proof applies `WS_EX_LAYERED` alpha transparency and records:
  - HWND;
  - class/title;
  - requested alpha;
  - no-activate behavior;
  - process identity and executable path;
  - explicit `webviewUsed=false` and `reactUsed=false`.
- The native window proof still connects to the same daemon instance so native shell work remains a client of the Rust mux boundary.
- `pnpm verify:terminal:native-client` now proves both:
  - daemon attach/list/send/capture/detach/attach;
  - no-WebView layered Win32 native window creation.
- `pnpm verify:terminal:native-boundary` now treats the native window proof as part of the native client boundary.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm exec biome check scripts\verify-native-client-spike.mjs scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs --formatter-enabled=false`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`

Residual:

- This is still not a native GPU terminal renderer. It proves the native process/window/compositor entry point and daemon boundary before `winit`/`wgpu`, terminal drawing, IME dogfood, and native visual regression are added.
- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.43 - Aether Native Text Render Proof

Status: done

Implemented:

- Added `aether-native render-proof [--session id] [--expect text] [--lines n] [--alpha n]`.
- The proof reads a daemon session capture through the same sidecar/mux API used by `capture`.
- The captured text is rendered through a Win32/GDI memory-compatible device context, not React, WebView, canvas, or xterm.
- The proof records:
  - source session id;
  - capture text bytes/chars/hash;
  - expected marker match;
  - renderer identity `native-gdi-text-proof`;
  - text draw call count;
  - sampled pixel count;
  - non-background pixel count;
  - explicit `webviewUsed=false` and `reactUsed=false`.
- The proof also keeps the layered Win32 native window proof green so native rendering is tied to the native process/window boundary.
- `pnpm verify:terminal:native-client` now proves:
  - daemon attach/list/send/capture/detach/attach;
  - no-WebView layered Win32 native window creation;
  - daemon capture rendered as nonblank native GDI text.
- `pnpm verify:terminal:native-boundary` now treats the native text render proof as part of the native client boundary.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `pnpm exec biome check scripts\verify-native-client-spike.mjs scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs --formatter-enabled=false`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`

Residual:

- This is still not the final GPU terminal renderer. It proves native text rendering and daemon capture ownership first; the remaining renderer work is `winit`/`wgpu` terminal grid drawing, native IME dogfood inside the native client, native glass/theme rendering, and native visual regression.
- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.41 - Aether Native Client Attach Spike

Status: done

Implemented:

- Added the `aether-native` Rust binary as the first no-WebView native client boundary.
- The client exposes a machine-readable `contract` that states:
  - `webviewUsed=false`;
  - `reactUsed=false`;
  - mux truth comes from the daemon API;
  - GPU terminal rendering and native window IME remain explicit next-step blockers, not hidden claims.
- Added native client operations for daemon-backed `list`, `graph`, `attach`, `detach`, `send`, and `capture`.
- Added `pnpm verify:terminal:native-client`, which starts the PTY sidecar, creates a real shell session, and proves `aether-native` can:
  - attach to the same daemon instance;
  - read mux workspaces;
  - send input and capture output;
  - detach and attach through the Rust mux graph.
- Added the native client proof to `pnpm verify:terminal:native-boundary` and the release quality score contract.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl`
- `pnpm exec biome check scripts\verify-native-client-spike.mjs scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs --formatter-enabled=false`
- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm verify:goal:docs`

Residual:

- This is not yet the full native GPU terminal window. It proves the correct daemon/client boundary first, so the upcoming `winit`/`wgpu`/IME window work does not create a parallel terminal truth.
- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.40 - Aetherctl Mux Export/Import Parity

Status: done

Implemented:

- Added versioned mux snapshot export to the daemon API through `GET /mux/workspaces/:id/export`.
- Added guarded mux snapshot import through `POST /mux/workspaces/import?replace=true|false`.
- Import always routes through Rust restore policy so imported panes become detached `restore-pending:<paneId>` bindings with no trusted external process id.
- Existing live workspaces are protected by a conflict response unless `replace=true` is explicit.
- Replace import closes stale live PTYs owned by the replaced graph before exposing the imported restore-pending graph.
- Added `aetherctl mux-export <workspace> [--out path]` and `aetherctl mux-import <snapshot-path|-> [--replace]`.
- Extended live mux restore verification with:
  - `aetherctl-mux-export-parity`;
  - `aetherctl-mux-import-parity`;
  - `mux-import-restore-pending`;
  - `mux-import-replace-closes-live-pty`.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl`
- `cargo test --manifest-path src-tauri\Cargo.toml mux_snapshot_store_persists_and_restores_api_graphs --test test_api_3d1`
- `pnpm verify:mux-live`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:quality-score`

Residual:

- The only non-cleared final blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

## Phase 1 - Rail Clarity Pass

Goal: make the right rail understandable and action-oriented before deeper topology/workflow work.

### Phase 1.1 - Action Engine Contract

Status: done

Implemented:

- Every ranked right-rail action now carries an execution contract:
  - `ready`, `guided`, or `blocked` status;
  - visible action label;
  - expected result;
  - audit event kind;
  - recovery step;
  - optional disabled reason.
- Right-rail action cards now show the execution label and expected outcome, not only a dashboard hint.
- Blocked execution contracts render as disabled actions instead of silently pretending they are clickable.
- Clicking a right-rail action appends a Tauri audit journal event when running in the native app.
- Advisor tests now require every ranked action to include why/next-step/execution/audit/recovery metadata.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\WorkstationPulse.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\RunGraphPanel.test.tsx --reporter=dot`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm build` passed after increasing the command timeout; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0` passed after starting the local Vite server.

Residual:

- The current action contracts are still mostly guided navigation, not end-to-end executable operations.
- Phase 1.2 should convert the most important actions into direct operations where safe:
  - approve/deny workflow gate;
  - focus owner pane;
  - open owner diff;
  - copy/export context pack;
  - collect final report;
  - retry/stop blocked session through existing process controls.

### Phase 1.2 - Direct Action Wiring

Status: done

Implemented:

- Added explicit action operations to the right-rail execution contract:
  - `copy-context-pack`;
  - `open-primary-diff`;
  - `focus-session`;
  - `focus-pane`;
  - `focus-widget`.
- High-context handoff now copies a generated context pack to the clipboard and opens the Context rail.
- Review actions now open the highest-priority changed file in diff mode when a target file is known.
- Approval actions now select the first pending owner session when available.
- Blocked/run tracking actions select the target session or pane while still focusing the relevant rail widget.
- Right-rail action audit entries now include operation status, expected result, mode transition, and target role.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec vitest run src\__tests__\designTokenUsage.test.ts src\__tests__\WorkstationPulse.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\ReviewQueuePanel.test.tsx src\__tests__\RunGraphPanel.test.tsx --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- `git diff --check`

Residual:

- Approve/deny workflow gates are still deliberately guided, not direct, because those actions can mutate workflow state and need explicit button-level confirmation.
- Stop/retry process actions are still guided through Health/Process Manager for the same reason.
- Phase 1.3 should add a command-center "Action Result" feedback strip so users can see exactly what the previous rail action did.

### Phase 1.3 - Action Result Feedback

Status: done

Implemented:

- Added a right-rail `Last action` result strip with `role="status"` and `aria-live="polite"`.
- Result states remain visible for 6.5 seconds and are cleared on unmount.
- Success, warning, and error tones are represented with distinct rail styling.
- Direct diff, handoff copy, blocked, pane-target-missing, and guided navigation paths now mirror their result into the rail instead of relying on toast-only feedback.
- Result text is compact and ellipsized so narrow rails do not grow or overflow.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- In-app browser QA confirmed the Command rail renders, the action button is present, clicking it shows the `Last action` result strip, and no console errors were reported.

Residual:

- The strip currently reports one last action only. Phase 1.4 should add a tiny action history drawer or audit-linked detail affordance only if it proves useful; avoid turning the rail back into a noisy dashboard.

### Phase 1.4 - Rail Action Audit Detail

Status: done

Implemented:

- Right-rail action audit writes now return the backend-issued audit journal record instead of discarding it.
- The `Last action` result carries audit event id, correlation id, kind, and timestamp when running in the native Tauri runtime.
- Audit-linked action results expose a compact `Audit` button that moves the rail to Observe, scrolls the Audit Timeline widget into view, selects the event, and applies the trace filter.
- The audit jump is read-only: it does not approve, stop, retry, or mutate workflow/process state.
- The result strip remains compact with a third grid column for the audit affordance.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- In-app browser QA confirmed the Command rail renders, action results remain visible, and no console errors were reported. The audit button is native-only because the Vite preview has no `append_audit_event` IPC.

Residual:

- The audit affordance depends on native IPC returning an audit journal record, so a Tauri/WebView smoke should verify the actual `Audit` button path before release.

### Phase 1.5 - Native Audit Jump Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-audit-jump.mjs`, a focused live Tauri/WebView2 CDP smoke for the right-rail `Last action` -> `Audit` -> Audit Timeline path.
- Added `pnpm verify:right-rail-audit` as the repeatable command.
- The smoke clears stale visual-QA dashboard storage, attaches to `http://127.0.0.1:9222`, verifies `__TAURI_INTERNALS__.invoke`, clicks the top enabled rail action, waits for the native-only `Audit` button, clicks it, and verifies Observe mode plus a selected Audit Timeline row.
- The smoke writes `.codex-auto/production-smoke/right-rail-audit-jump.json` as evidence.

Validation:

- `node --check scripts\verify-right-rail-audit-jump.mjs`
- `pnpm.cmd verify:right-rail-audit`
- Native evidence artifact: `.codex-auto/production-smoke/right-rail-audit-jump.json`

Residual:

- The `Last action` strip still expires after 6.5 seconds. A future action history drawer would make audit lookup durable after the transient result disappears.

### Phase 1.6 - Durable Rail Action History

Status: done

Implemented:

- The last several right-rail actions remain available after the transient result strip expires.
- Each history item can open its audit context when the native audit record exists.
- The history affordance stays compact and does not turn the command rail into a noisy dashboard.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Native audit jump durability still depends on the existing `append_audit_event` IPC path; keep `pnpm verify:right-rail-audit` in the release smoke set.

### Phase 1.7 - Guardrail Override and Tool Envelope

Status: done

Implemented:

- Added a compact Guardrail profile selector in the Agent workforce card: `Auto`, `Conservative`, `Release`, `Builder`, and `Research`.
- Manual selection now overrides the automatic profile used by right-rail action guardrail labels and agent start allow-tool wiring.
- The workforce card now shows the effective tool envelope so users can see why an action is guided, ready, or gated.
- Exported the stable guardrail profile list from the workforce model so UI and tests share the same profile ordering.
- Persisted the guardrail selection in local storage so a manual override survives reloads.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\shared\lib\rightRailWorkforce.ts src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailWorkforce.test.ts`
- `pnpm vitest run src\__tests__\guardrailPolicy.test.ts src\__tests__\rightRailWorkforce.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed that switching to `Builder` updates the tool envelope and action guardrail, then remains selected after reload.

Residual:

- This is persisted in browser storage only. A native config-backed preference can be added later if this needs to sync across app profiles.

### Phase 1.8 - Command Rail Recoverability State

Status: done

Implemented:

- Right-rail actions should show when a target is stale, missing, or already resolved instead of silently doing nothing.
- Recovery copy should point to the exact next place to inspect: Health, Audit Timeline, Review Queue, or Toolkit.
- Focus/session/diff action failures should produce a durable history entry and an audit event when native IPC is available.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts src\styles\global.css src\shared\lib\rightRailWorkforce.ts src\__tests__\rightRailWorkforce.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\rightRailWorkforce.test.ts src\__tests__\guardrailPolicy.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA on `http://localhost:1420/?aetherVisualQa=1...` confirmed the guardrail select renders, switching to `Builder` updates the tool envelope and action guardrail, and running an action creates a durable Recent actions entry.

Residual:

- Native outcome audit rows are covered by code path and type checks; release smoke should add a live negative-path scenario for stale pane/diff targets.

### Phase 1.9 - Right Rail Decision Copy and Empty-State Polish

Status: done

Implemented:

- The right rail should explain what each section does without adding noisy tutorial copy.
- Empty states should offer a clear next action, not a passive placeholder.
- Labels should use product language consistently: Run, Changes, Health, Guardrail, Recent actions, Audit.

Validation:

- `pnpm exec biome check --write src\features\decision-inbox\DecisionInboxPanel.tsx src\features\toolkit\ToolkitPanel.tsx src\features\toolkit\ToolkitPanel.module.css src\features\workflow\WorkflowPanel.tsx src\features\agent-inspector\AgentInspector.tsx src\features\context\ContextPanel.tsx src\features\context\LivePanesPanel.tsx src\features\process-manager\ProcessManagerPanel.tsx src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\toolkit-placeholder.test.ts src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AgentInspectorTabRouting.test.tsx`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\toolkit-placeholder.test.ts src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AgentInspectorTabRouting.test.tsx src\__tests__\LivePanesPanel.test.tsx src\__tests__\ProcessManagerPanel.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed Run rail copy (`Decisions`, `human gates`, `No human decisions`, `saved commands`, `multi-step runs`, `handoff state`) and Health rail copy (`Processes/live shells`, `Live Panes/focus/recover`) render after lazy panels load.

Residual:

- Copy is now clearer, but the right rail still lacks a persisted per-user layout preference for which widgets are expanded or hidden.

### Phase 1.10 - Rail Layout Preference and Widget Priority

Status: done

Implemented:

- Users can keep noisy secondary widgets collapsed without losing the core Run, Changes, and Health flows.
- The rail should remember high-value widget visibility choices across reloads.
- The default layout should keep action, guardrail, decisions, sessions, and health recovery above low-frequency diagnostics.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed default priority order, collapsed secondary frames, click-to-open behavior, and reload persistence for the Workflow widget.

Residual:

- Widget preferences are local to browser storage. A future native config sync pass can make these layout choices portable across machines/profiles.

### Phase 1.11 - Native Negative-Path Rail Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-negative-path.mjs`, a focused live Tauri/WebView2 CDP smoke for recoverable right-rail failure paths.
- Added `pnpm verify:right-rail-negative` as the repeatable command.
- The smoke exercises both deterministic dev-QA negative cases:
  - missing changed-file diff target;
  - stale operational pane target.
- Each case verifies the rail warning result, durable Recent actions row, fresh native outcome audit row, and Audit Timeline jump.
- The smoke attaches to the running dev WebView over CDP and does not invoke the installer or release build.

Validation:

- `node --check scripts\verify-right-rail-negative-path.mjs`
- `pnpm exec biome check src\features\context\AuditTimelinePanel.tsx src\__tests__\AuditTimelinePanel.test.tsx src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-negative-path.mjs package.json`
- `pnpm vitest run src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-negative`

Residual:

- This smoke still requires a running native dev app with CDP enabled (`pnpm tauri:dev`). It is intentionally kept separate from heavy release packaging.

### Phase 1.12 - Native Config Sync for Rail Preferences

Status: done

Implemented:

- Right-rail widget collapse preferences now hydrate from native `config.toml` through `workspace_profile.global_defaults.pane_layout.right_rail_widgets`.
- Widget clicks still update local storage immediately for responsive UI, then persist to native config in the background.
- Native config hydration emits a rail-widget sync event so already-mounted widgets follow config changes after startup.
- Rust config now round-trips the `right_rail_widgets` map without dropping unknown widget preferences.
- Force-opened action targets persist their expanded state so Audit/Context/Run Graph jumps do not collapse immediately after focus.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml config::settings::tests --lib`
- `pnpm exec tsc --noEmit --pretty false`
- Native WebView2/CDP smoke confirmed clicking Workflow updates UI, local storage, and `config.toml`; the test restored the original config afterward.

Residual:

- Right-rail mode itself is still primarily workspace-profile driven, not exposed as a first-class Settings control. Add it only if users ask for startup rail selection.

### Phase 1.13 - Guardrail Profile Native Sync

Status: done

Implemented:

- Right-rail Guardrail profile selection now persists to native `config.toml` through `workspace_profile.global_defaults.pane_layout.right_rail_guardrail_profile`.
- `Auto` remains the default without forcing a native config write on a fresh profile.
- Existing browser storage is still used for first-paint speed and migration of non-default selections.
- Native config hydration emits a guardrail sync event so already-mounted rail controls update without a full app restart.
- Manual profile changes keep immediate UI feedback while the native save runs in the background.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml config::settings::tests --lib`
- `pnpm exec tsc --noEmit --pretty false`
- Native WebView2/CDP smoke confirmed selecting `Builder` updates UI, local storage, native config, reload restoration, and the effective tool envelope; the test restored the original config afterward.

Residual:

- Guardrail selection is now portable, but the release gate should run a single repeatable preference smoke instead of relying on ad hoc browser checks.

### Phase 1.14 - Native Preference Sync Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-preferences.mjs`, a repeatable live Tauri/WebView2 CDP smoke for native right-rail preference persistence.
- Added `pnpm verify:right-rail-preferences` as the release-friendly command.
- The smoke validates:
  - Guardrail profile UI -> local storage -> native config;
  - secondary widget open/closed UI -> local storage -> native config;
  - reload restoration for the selected Guardrail profile;
  - no runtime console/page errors.
- The smoke backs up and restores both native config and relevant browser storage so it does not leave user preferences dirty.

Validation:

- `node --check scripts\verify-right-rail-preferences.mjs`
- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-preferences.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail-preferences`

Residual:

- Native preference persistence now has release smoke coverage. The next right-rail pass should focus on action explainability and reducing rail cognitive load under live multi-agent runs.

### Phase 1.15 - Live Run Cognitive Load Pass

Status: done

Implemented:

- Added a persistent Decision focus card directly below the right-rail purpose line so human gates are always separated from telemetry, workforce status, and action history.
- The Decision focus card routes to the Command rail and opens the Decision Inbox instead of forcing users to scan the lower rail.
- Added source-contract coverage that keeps the Decision focus above Now, Workforce, and Action Stack blocks.
- Added Sakura-specific right-rail styling for the Decision card, its warning state, and its chips so the white-peach surface does not fall back to low-contrast gray glass.
- Added design-token coverage that locks the Sakura Decision surface, warning state, chips, and detail text into the Sakura rail contract.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Live WebView2 QA at `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2Fdev%2FAether_Terminal&rail=command&state=blocked&v=decision-load-pass` confirmed the Decision focus renders above telemetry/action sections and does not overflow at right-rail width.

Residual:

- Decision visibility is now protected in normal and Sakura rails. The next pass should seed a pending decision in the native visual QA path and verify the warning state plus click-to-inbox behavior end to end.

### Phase 1.16 - Live Decision Inbox Smoke

Status: done

Implemented:

- Fixed the blocked visual-QA fixture so `nextActor` is `human`, matching the Decision Inbox contract instead of silently rendering a blocked run as "No decisions waiting".
- Added `scripts/verify-right-rail-decisions.mjs`, a live Tauri/WebView2 smoke for human-decision prominence.
- Added `pnpm verify:right-rail-decisions` as the release-friendly command.
- The smoke validates:
  - blocked visual-QA state produces a warning Decision focus;
  - the card carries `data-has-decision="true"` and visible "Needs your decision" copy;
  - the Decision focus remains above Now, Workforce, and Action Stack telemetry;
  - clicking Decision routes to the Command rail and reveals the Decision Inbox;
  - no runtime console/page errors are emitted during the flow.

Validation:

- `node --check scripts\verify-right-rail-decisions.mjs`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-decisions`

Residual:

- The human-decision rail path now has live smoke coverage. The next pass should move from visibility to action quality: every Decision Inbox item should offer a clear recommended action, risk, evidence, and handoff path.

### Phase 1.17 - Decision Action Quality Pass

Status: done

Implemented:

- Promoted the recommended action into a first-class `Action` line on every non-compact Decision Inbox row.
- Promoted evidence from footer-only chips into the row body as `Evidence`, keeping the footer as a compact trail.
- Added an explicit handoff label (`Focus session`, `Workflow gate`, or `Audit trail`) so the user can tell where the decision will lead.
- Upgraded the blocked visual-QA fixture to a destructive file-system approval request so the native smoke covers a critical/high-risk decision instead of only a generic permission gate.
- Strengthened the live right-rail decision smoke so it verifies `Critical`, `Action`, `Evidence`, `Focus session`, and `Destructive Operation` are all visible after opening the Decision Inbox.
- Updated component coverage to require action, evidence, consequence, timeout, risk, and focus path on pending decisions.

Validation:

- `node --check scripts\verify-right-rail-decisions.mjs`
- `pnpm exec biome check src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-decisions`

Residual:

- Decision item readability is now covered. The next pass should reduce action ambiguity by wiring Decision Inbox rows to concrete remediation affordances where available: select session, open related workflow, open audit evidence, and jump to the affected file/pane.

### Phase 1.18 - Decision Remediation Routing

Status: done

Implemented:

- Decision rows now render the strongest available remediation button instead of only passive handoff labels.
- Session-backed decisions keep the existing `Focus` route and call `onSelectSession`.
- Workflow-backed decisions now render `Open workflow`, and the App routes to the Command rail with the Workflows widget focused.
- Audit-backed decisions now render `Open audit`, parse the source audit event id, and the App routes to the Observe rail with Audit Timeline focused and the event selected.
- Route buttons are constrained and ellipsized so long labels do not widen or break the right rail.
- Component tests now cover session, workflow, and audit remediation paths.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Decision rows now have concrete remediation routes. The next pass should make these routes more context-rich by preserving selected workflow/audit context across rail transitions and adding visual focus confirmation for the routed target.

### Phase 1.19 - Routed Target Focus Confirmation

Status: done

Implemented:

- Added route confirmation state for right-rail decision navigation, separate from the short-lived scroll focus flag.
- `Open workflow` now force-opens the Workflows widget and shows a temporary confirmation banner with the workflow id.
- `Open audit` now force-opens Audit Timeline, selects the audit event, preserves the event correlation trace when available, and shows a temporary evidence confirmation banner.
- Added a shared `right-panel-widget-focus-confirmation` surface with Sakura-specific styling so routed confirmation stays readable across presets.
- Added source-contract coverage for route confirmation state, workflow force-open, audit trace preservation, and confirmation rendering.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Routed target focus is now visible and trace-aware. The next pass should make workflow/audit decisions actionable from the destination: approve/reject workflow gates where supported, and expose recovery controls for audit evidence without making users return to the Decision Inbox.

### Phase 1.20 - Destination Action Affordances

Status: done

Implemented:

- Workflow waiting-gate phases now render a visible `Gate decision` action panel with the decision kind, reason, and text `Approve` / `Reject` actions in addition to the compact icon controls.
- Audit Timeline now renders a selected recovery action strip when a routed/selected event is recoverable.
- Selected audit recovery exposes the recovery label, event summary, recovery detail, and direct `Focus pane` / `Restart pane` actions when a live pane target is available.
- The selected audit restart path reuses the existing confirmation dialog and stale-pane revalidation before invoking restart.
- Added regression coverage so workflow gates and selected audit recoveries cannot silently become read-only destinations again.

Validation:

- `pnpm exec biome check --write src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx`
- `pnpm verify:right-rail-decisions`

Residual:

- Destination actions are now visible for workflow gates and selected audit evidence. The next pass should connect destination actions back into the right-rail outcome/audit history, so users can see whether a gate approval, gate rejection, focus, or recovery action succeeded without scanning toasts.

### Phase 1.21 - Destination Outcome Ledger

Status: done

Implemented:

- Added a destination outcome result path that feeds workflow/audit destination actions into the existing right-rail `Last action` and action-history ledger.
- Workflow gate approval, completion, rejection, and approval/rejection failures now emit visible destination outcomes with workflow context.
- Audit selected-event focus and restart recovery now emit visible destination outcomes with audit event id, correlation id, and pane target context.
- App wiring passes destination outcomes from WorkflowPanel and AuditTimelinePanel to the shared right-rail outcome ledger.
- Added source/component coverage so destination actions cannot silently fall back to toast-only feedback.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\context\AuditTimelinePanel.tsx src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Destination actions now leave visible outcome history. The next pass should make that history filterable/actionable, so users can jump back from an outcome record to the workflow, audit event, or pane target that produced it.

### Phase 1.22 - Outcome Replay Routing

Status: done

Implemented:

- Added source routing metadata to right-rail action outcomes, including workflow/audit route labels and destination details.
- Right-rail `Last action` and recent action history now expose an `Audit`/`Workflow` source button that reopens the source panel instead of leaving the record as passive log text.
- Audit-source outcomes select the matching audit event/trace and show a destination confirmation in Audit Timeline.
- Workflow-source outcomes force-open the Workflow panel with a route confirmation for the originating workflow id.
- Workflow gate and Audit Timeline destination actions now emit route metadata with their outcome ledger records.
- Added contract coverage so outcome history keeps source routing affordances and explicit source labels.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\context\AuditTimelinePanel.tsx src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Outcome routing is now actionable. The next pass should add a command-center scoring layer that grades whether the rail has enough concrete evidence, decisions, live state, and recovery affordances to be a sellable edge rather than just a grouped sidebar.

### Phase 1.23 - Command Center Edge Scoring

Status: done

Implemented:

- Added a first-class right-rail `Edge score` card that grades command-center readiness across Decision, Evidence, Recovery, and Live axes.
- The score derives from real rail inputs: pending owner gates, live runs, changed files, audit evidence, graph risks, recommended actions, and recovery-capable actions.
- The card exposes grade, total score, weakest axis, and a compact four-axis breakdown so the rail's product edge is measurable during daily use.
- Sakura styling was included so the new score card does not fall back to dark/gray material when that preset is active.
- Added source-contract coverage so the score layer remains visible and evidence-based.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score is now visible, but its weakest-axis output should become actionable. The next pass should let a user click a weak score axis and jump straight to the exact widget/action that improves it.

### Phase 1.24 - Edge Score Remediation Actions

Status: done

Implemented:

- Edge score axes are now actionable controls instead of passive metrics.
- Decision routes to Decision Inbox, Evidence routes to Review Queue/Audit Timeline/Reliability depending on available signals, Recovery routes to Reliability, and Live routes to Live Panes or Process Health.
- Axis buttons expose visible action labels and accessible labels, then set the right-rail mode and focused widget so the destination scrolls into view.
- Native right-rail widgets also receive the existing route-confirmation banner when the destination supports it.
- Added source-contract coverage to prevent Edge score axes from regressing into static text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Browser smoke: created a Score loop entry, clicked `Clear`, confirmed the section disappeared, confirmed `edgeLoop` fallback was removed from the URL, and confirmed reload did not restore stale feedback.

Residual:

- Edge score actions now route to the right area. The next pass should make each destination expose the exact missing evidence/action inline, so the score closes the loop instead of only moving the user to the right widget.

### Phase 1.25 - Destination Gap Closure Prompts

Status: done

Implemented:

- Edge score items now carry destination remediation copy: prompt title, concrete prompt detail, and the visible action label.
- Clicking Decision, Evidence, Recovery, or Live stores a destination prompt alongside the mode/widget route.
- Decision Inbox, Review Queue, Audit Timeline, Reliability, Live Panes, and Process Health render the prompt inline at the destination before the main widget content.
- The prompt card uses accessible labels and visible text, so the score-to-action loop is not hidden behind hover-only UI.
- Sakura styling is covered by the shared prompt card so destination copy does not fall back to gray/dark material.
- Added source-contract coverage so routed score axes remain connected to destination-side remediation prompts.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score prompts now close the loop at the destination. The next pass should turn repeated score/prompt interactions into lightweight telemetry so we can see which axis users use, which prompts are ignored, and whether the score improves afterward.

### Phase 1.26 - Edge Score Interaction Telemetry

Status: done

Implemented:

- Added privacy-safe audit telemetry for Edge score interactions.
- Edge score clicks now emit `right_rail.edge_score.clicked` with axis id/label/status, axis score/max, total Edge score, grade, from/to mode, target widget, and visible action label.
- Destination focus now emits `right_rail.edge_score.destination-reached` once per prompt route when the target widget is found and focused.
- Telemetry deliberately excludes command text, prompt text, file paths, and user input; this is enforced by source-contract tests.
- Destination-reached events use the same click-time score/grade snapshot, so later score recalculation cannot corrupt the interaction trail.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Edge score interactions are now observable. The next pass should summarize recent score interactions inside the rail so users can see whether repeated actions are actually improving the command-center score.

### Phase 1.27 - Edge Score Feedback Loop

Status: done

Implemented:

- Added a compact `Score loop` section under Edge score, capped at four recent interactions.
- Each score interaction records axis, target widget, score, grade, previous score, delta, and trend.
- Repeated axis clicks now show `Baseline`, positive deltas, flat `0`, or negative deltas directly in the right rail.
- Feedback entries remain compact and do not display command text, prompt text, file paths, or user input.
- Added source-contract coverage for the feedback entry shape, history cap, trend rendering, and privacy guardrails.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score loop history is visible. The next pass should make history entries actionable so users can replay a previous axis action without hunting for the original score card.

### Phase 1.28 - Edge Feedback Replay

Status: done

Implemented:

- Score loop feedback entries are now buttons, not passive rows.
- Clicking a feedback entry replays the matching current Edge score axis action and routes back to the destination widget.
- Replay entries reuse the same prompt, routing, telemetry, and feedback path as primary Edge score clicks.
- Entries are disabled only if the axis no longer exists in the current score model.
- Added source-contract coverage so the feedback loop cannot regress into static text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Feedback replay is actionable. The next pass should add a small outcome summary that groups the last few score-loop interactions by axis so repeated weak areas become obvious.

### Phase 1.29 - Edge Axis Pattern Summary

Status: done

Implemented:

- Added a compact repeated-axis summary inside the `Score loop` block.
- The summary groups recent feedback entries and surfaces the most repeated Edge score axis, interaction count, and latest trend.
- The summary stays inside the right rail and does not require opening Audit Timeline.
- Sakura styling is included through the shared score-loop selectors.
- Added source-contract coverage for the summary helper, UI selector, count, axis label, and compact privacy-safe placement.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score loop now shows repeated-axis patterns. The next pass should connect the repeated axis to a specific recommended next action, so the user gets one prioritized move instead of just a pattern.

### Phase 1.30 - Edge Loop Next Best Action

Status: done

Implemented:

- Added a `Next best action` button directly under Edge score.
- The action prioritizes the repeated score-loop axis when one exists, otherwise falls back to the weakest current Edge score axis.
- Clicking the action reuses the existing score-axis routing, destination prompt, feedback history, and audit telemetry path.
- The card stays compact and privacy-safe, showing only action label, reason, and axis.
- Added source-contract coverage for the next-action helper, UI, reason, and route reuse.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score loop now recommends one move. The next pass should make the recommendation outcome-aware by marking whether the recommended action actually led to a destination prompt or score-loop entry.

### Phase 1.31 - Edge Recommendation Outcome State

Status: done

Implemented:

- Added compact outcome state to the `Next best action` card.
- Outcome is derived from existing destination prompt and score-loop feedback, not a new passive log.
- The card now reports `Destination reached`, `Action replayed`, or `Recommendation changed` when applicable.
- Destination focus stamps the active prompt with `reachedAt`, allowing the outcome to show reached state without recording command text or user input.
- Added source-contract coverage for outcome derivation, reached/replayed/stale labels, and compact UI placement.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The Edge loop is now outcome-aware. The next pass should persist the compact score-loop state across reloads so the right rail does not forget recent product-quality guidance during local dev refreshes.

### Phase 1.32 - Edge Loop Session Persistence

Status: done

Implemented:

- Added workspace-local score-loop persistence for the right-rail Edge feedback history.
- Storage keys hash the normalized workspace path, so raw project paths are not written into the WebView storage key.
- Persisted entries are sanitized into a bounded allowlist: axis id/label, action label, target widget, score, grade, previous score, delta, trend, and timestamp only.
- Prompt text, command text, file paths, and user input are excluded from the persisted shape.
- Added `history.state` and bounded URL fallback persistence for constrained validation WebViews where Web Storage APIs are unavailable; the fallback still stores only the hashed workspace key and sanitized score-loop metadata.
- Hydration now skips the first save pass for a workspace key, preventing stale history from overwriting loaded history during project switches or reloads.
- Added source-contract coverage for persistence helpers, hashed workspace keys, sanitized bounded fields, and the no-raw-history JSON path.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Browser smoke: clicked `Next best action`, reloaded the same workspace URL, and confirmed `Score loop` rehydrated with the Evidence action history.

Residual:

- The score-loop state now survives reloads. The next pass should add an intentional reset control so users can clear stale guidance per workspace without opening developer tools.

### Phase 1.33 - Edge Loop Reset Control

Status: done

Implemented:

- Added a compact `Clear` action inside the right-rail `Score loop` header.
- Reset clears the visible feedback history immediately and removes only the current workspace's hashed Edge feedback storage entry.
- Reset also removes the bounded `history.state` and `edgeLoop` URL fallback payloads without touching audit history, pane state, workspace tabs, presets, theme customization, or pane persistence.
- Added focused styling for the reset control so it stays discoverable without dominating the right rail.
- Added source-contract coverage for the reset helper, visible clear action, hashed storage removal, state cleanup, URL fallback cleanup, and state clearing.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score-loop reset is now safe and workspace-local. The next pass should add explicit reset feedback so users can tell the clear action completed without relying on the section disappearing.

### Phase 1.34 - Edge Loop Reset Confirmation

Status: done

Implemented:

- Added a transient, non-modal `Score loop cleared` confirmation in the right rail after reset.
- Confirmation uses `role="status"` and `aria-live="polite"` so the clear action has accessible completion feedback.
- Confirmation is state-only and never writes a new persisted score-loop entry.
- Added a cleanup timer so the notice clears automatically and does not leave stale UI.
- Sakura-specific styling includes the reset confirmation in the same pale material family as the other right-rail Edge cards.
- Added source-contract coverage for the notice state, timer cleanup, status region, privacy-safe copy, and reset path.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Reset now has completion feedback. The next pass should make the Edge loop resilient to score-model label changes by replaying entries via stable axis id instead of display label.

### Phase 1.35 - Edge Feedback Stable Replay IDs

Status: done

Implemented:

- Added `axisId` to score-loop feedback entries and summaries.
- New feedback entries persist the stable Edge score axis id alongside the human-readable label.
- Legacy persisted entries without `axisId` are still sanitized through the existing `id` prefix, keeping reload compatibility.
- Replay now resolves entries by `axisId` first and uses the label only as a backward-compatible fallback.
- Repeated-axis recommendation now resolves by stable id, making it resilient to label copy changes and localization.
- Added `data-axis-id` attributes to the summary and replay rows for QA and future automated checks.
- Added source-contract coverage for axis id persistence, summary id use, and stable replay matching.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Replay is now id-stable. The next pass should add a compact stale-entry state so a removed axis or incompatible old entry explains why it is disabled instead of silently becoming unavailable.

### Phase 1.36 - Edge Feedback Stale Entry State

Status: done

Implemented:

- Added a compact stale reason for unresolved Score loop feedback rows.
- Rows that cannot resolve to a current Edge score axis remain disabled and now display `Stale axis: ... is no longer in the current score model.`
- Stale rows get `data-stale="true"` for visual QA and regression checks.
- The stale explanation is derived only from the privacy-safe axis label and does not include prompt text, command text, file paths, or user input.
- Added styling for stale rows and Sakura tone compatibility.
- Added source-contract coverage for stale reason derivation, disabled unresolved rows, `data-stale`, and the visible stale message.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale rows now explain themselves. The next pass should add a lightweight privacy-safe telemetry event when a stale row is encountered so repeated stale-loop issues can be audited without recording user content.

### Phase 1.37 - Edge Feedback Stale Telemetry

Status: done

Implemented:

- Added privacy-safe audit telemetry for stale Score loop rows.
- Stale feedback entries are derived from the current score model and emitted through `right_rail.edge_feedback.stale`.
- Telemetry is deduplicated per workspace/session view with an in-memory key, so re-renders do not spam audit history.
- Payload is limited to axis id, axis label, score, grade, stale reason, and the existing privacy marker.
- The telemetry excludes action labels, target widgets, prompt text, command text, file paths, and user input.
- Moved the project-empty return below the stale telemetry hook so React hook order remains stable.
- Added source-contract coverage for stale telemetry derivation, deduplication, payload shape, and privacy exclusions.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale rows now emit safe telemetry. The next pass should add a small stale-count summary to the Score loop header so unresolved history is obvious before scanning individual rows.

### Phase 1.38 - Edge Feedback Stale Count Summary

Status: done

Implemented:

- Added a compact `Stale n` badge to the Score loop header.
- The badge appears only when `rightRailEdgeFeedbackStaleEntries.length > 0`.
- Count is derived from the same current score-model resolution used by stale row disabling and stale telemetry.
- Added styling for the badge, including Sakura tone compatibility.
- Added source-contract coverage for the badge selector and count expression.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale count is now visible in the header. The next pass should add a small filter/toggle so users can isolate stale entries when the loop contains mixed healthy and stale rows.

### Phase 1.39 - Edge Feedback Stale Filter

Status: done

Implemented:

- Added a local `Stale only` / `All` toggle in the Score loop header.
- The toggle appears only when stale entries exist.
- Stale-only mode filters the rendered list through `rightRailEdgeFeedbackVisibleHistory` without modifying persisted feedback history.
- The filter automatically resets to `All` when no stale entries remain.
- Added styling for the filter control, active state, and Sakura tone compatibility.
- Added source-contract coverage for local state, visible-history filtering, reset behavior, toggle rendering, and non-persistence of the filter.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale-only filtering is now local and non-destructive. The next pass should add a compact per-axis stale grouping so repeated stale entries from the same removed axis collapse into one readable cluster.

### Phase 1.40 - Edge Feedback Stale Grouping

Status: done

Implemented:

- Added per-axis stale grouping for repeated stale Score loop entries.
- Groups appear only when `Stale only` mode is active and at least two stale entries share the same removed axis.
- Grouping is derived from in-memory visible state and does not mutate persisted feedback history.
- Replay behavior remains row-level; stale rows stay disabled and explanatory.
- Memoized stale-entry, stale-id, visible-history, and stale-group derivation to reduce right-rail churn during rerenders.
- Added source-contract coverage for the group type, helper, stale-only gate, group container, axis ids, counts, reasons, and memoized derivation.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale groups are now readable in stale-only mode. The next pass should tighten accessibility for Score loop controls so count, filter, grouping, and reset feedback are consistently announced.

### Phase 1.41 - Edge Feedback Control Accessibility

Status: done

Implemented:

- Added a screen-reader-only stale count label while keeping the compact visual badge.
- Added explicit filter button labels for `All` and `Stale only` states, including the stale entry count.
- Added grouped stale summary labels that announce the number of repeated stale axes.
- Changed stale groups to semantic `fieldset` / `legend` markup instead of generic `div` labeling.
- Added source-contract coverage for stale count labels, filter labels, grouped summary labels, semantic group markup, and count text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Score loop controls now have stronger accessibility semantics. The next pass should add keyboard flow coverage around filter/reset interactions so this does not regress when the right rail is refactored.

### Phase 1.42 - Edge Feedback Keyboard Flow Coverage

Status: done

Implemented:

- Added stable ids for the Score loop history list and stale-count description.
- Connected `Stale only` / `All` to the controlled list with `aria-controls`.
- Connected the stale filter to the hidden stale-count description with `aria-describedby`.
- Connected `Clear` to the same controlled history list.
- Kept stale replay rows disabled when unresolved, so keyboard focus naturally skips non-actionable stale rows.
- Added source-contract coverage for the ids, `aria-controls`, `aria-describedby`, and keyboard-addressable button semantics.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Score loop keyboard semantics are now stronger at source-contract level. The next pass should add a focused runtime smoke for the Score loop once a CDP-capable Tauri/WebView2 session is available.

### Phase 1.43 - Right Rail Scroll Restoration

Status: done

Implemented:

- Restored vertical scrolling on the full right rail content surface.
- Changed `.right-panel-content` from clipped overflow to `overflow-y: auto` with stable scrollbar gutter and contained overscroll.
- Changed `.right-panel-stack` from an internal scroll trap to a visible auto-height section so wheel input anywhere in the rail can move the rail.
- Added regression coverage that the whole right rail owns vertical scrolling and that the nested stack no longer steals it.

Validation:

- `pnpm exec biome check --write src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- Browser verification on `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2Fdev%2FAether_Terminal&rail=command&v=right-rail-scroll-fix`
- Browser metrics: `.right-panel-content` computed `overflowY=auto`, `scrollHeight > clientHeight`, wheel scroll moved `scrollTop` from `0` to `420`.

Residual:

- Right rail scroll is restored. The next pass should turn this manual browser check into a reusable smoke script so future rail layout changes fail automatically.

### Phase 1.44 - Edge Feedback Runtime Smoke Harness

Status: done

Implemented:

- Added `scripts/verify-right-rail-edge-feedback.mjs`, a repeatable localhost browser smoke for the right-rail Edge score loop.
- Added `pnpm verify:right-rail-edge` so the smoke can run without a release build or WebView2 CDP.
- The smoke seeds a privacy-safe `edgeLoop` payload with current and legacy axes, then verifies stale count, stale-only filtering, stale group rendering, disabled stale replay rows, clear/reset behavior, URL cleanup, localStorage cleanup, and rail scrolling.
- Fixed the underlying stale-history compatibility gap: unknown but safe legacy axis ids are now preserved instead of being discarded by sanitize, while labels are bounded and cleaned.
- Added source-contract coverage for the smoke script, package command, unknown-axis preservation, and legacy-axis label sanitization.

Validation:

- `node --check scripts\verify-right-rail-edge-feedback.mjs`
- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-edge-feedback.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail-edge`
- Evidence artifact: `.codex-auto/production-smoke/right-rail-edge-feedback.json`

Residual:

- Edge feedback now has repeatable runtime coverage. The next larger pass should consolidate all right-rail smokes into a single fast command so release gating does not depend on remembering separate scripts.

### Phase 1.45 - Right Rail Smoke Suite Aggregator

Status: done

Implemented:

- Added `scripts/verify-right-rail-suite.mjs`, a fast right-rail smoke-suite aggregator.
- Added `pnpm verify:right-rail` as the single command for right-rail smoke evidence.
- The suite always runs the localhost Edge feedback smoke.
- The suite probes the configured WebView2 CDP endpoint and runs the CDP-dependent decision, preference, negative-path, and audit-jump smokes only when reachable.
- When CDP is unavailable, the suite records those checks as explicit `skipped` entries with the endpoint/probe reason instead of failing with an ambiguous connection error.
- Added source-contract coverage for the suite command, localhost smoke, CDP smoke list, and explicit skip behavior.

Validation:

- `node --check scripts\verify-right-rail-suite.mjs`
- `pnpm exec biome check --write scripts\verify-right-rail-suite.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail`
- Evidence artifact: `.codex-auto/production-smoke/right-rail-suite.json`

Residual:

- Right-rail smoke evidence is now consolidated. The next larger pass should connect this suite into the release quality scorer so right-rail evidence affects the product readiness score automatically.

### Phase 1.46 - Right Rail Quality Score Integration

Status: done

Implemented:

- Included `.codex-auto/production-smoke/right-rail-suite.json` in `scripts/score-release-quality.mjs`.
- Added a dedicated `right-rail-smoke` score item.
- Awarded full right-rail smoke credit when the localhost Edge feedback smoke passes and no right-rail smoke fails.
- Reported CDP-dependent checks as skipped in the score detail when CDP is unavailable.
- Added blocker output for missing or failing right-rail smoke-suite evidence.
- Added source-contract coverage that the quality scorer consumes the right-rail suite artifact and reports the smoke item.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`
- `pnpm verify:right-rail-command-evidence`

Current Score Snapshot:

- Score: `81 / 106`
- Grade: `C`
- Right rail smoke: `6 / 6`
- Right rail action clarity: `8 / 8`
- Remaining blockers: accepted real-OS suspend/resume risk and missing real OS sleep/resume evidence.

Residual:

- Right-rail quality now contributes to readiness scoring. The next pass should attack the remaining release blockers outside the right rail, starting with real OS sleep/resume evidence or accepted risk closure.

### Phase 1.47 - Real OS Suspend Evidence Diagnostic Gate

Status: done

Implemented:

- Kept the real Windows sleep/resume release gate strict: the pass command still requires manual evidence, all post-resume checks, and Windows System power events.
- Added a diagnostic mode for the evidence file so the release blocker can be investigated without faking pass status.
- Added `pnpm verify:production:suspend:template` for safe template creation and `pnpm verify:production:suspend:diagnose` for repeatable missing-field and Windows-event diagnostics.
- The diagnostic writes `.codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json` with missing fields, matched power events when timestamps exist, and concrete next steps.
- Source-contract coverage now verifies that diagnostic mode exists and that normal verification still requires `status: "pass"`.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Residual:

- This does not claim real OS sleep/resume success. The remaining blocker requires one real Windows sleep/resume cycle, filling the evidence checks, and then running `pnpm verify:production:suspend`.

### Phase 1.48 - Real OS Suspend Score Diagnostics

Status: done

Implemented:

- Connected `.codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json` into `scripts/score-release-quality.mjs`.
- The quality score now reports the real sleep/resume diagnostic status, missing-field count, and whether Windows power events were queried/found.
- The real OS sleep/resume score still awards zero points until the strict pass evidence is present.
- Blocker output now includes the first missing fields from the diagnostic, making the release gap actionable instead of a generic `missing`.

Validation:

- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Current Score Snapshot:

- Score: `81 / 106`
- Grade: `C`
- Real OS soak detail: `incomplete; 8 missing; power events not queried`

Residual:

- The score is intentionally unchanged until a real Windows sleep/resume cycle has been captured and validated.

### Phase 1.49 - Risk Closure Suspend Diagnostics

Status: done

Implemented:

- Connected the real OS suspend diagnostic into `scripts/close-production-risks.mjs`.
- If strict suspend verification fails during production risk closure, the closure script now runs diagnostic mode and records the diagnostic artifact path, diagnostic status, and missing fields in `production-risk-acceptance.json`.
- The accepted sleep/resume risk still remains blocked unless injected chaos and real OS suspend evidence both pass.
- Added source-contract coverage so this diagnostic path cannot silently disappear from the release risk closure script.

Validation:

- `pnpm exec biome check --write scripts\close-production-risks.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Risk closure remains correctly blocked until real Windows sleep/resume evidence is captured.

### Phase 1.50 - Real OS Suspend Capture Session

Status: done

Implemented:

- Added a two-step real OS suspend capture flow:
  - `pnpm verify:production:suspend:begin`
  - put Windows to sleep and resume manually
  - `pnpm verify:production:suspend:resume`
- The begin step writes `.codex-auto/production-smoke/real-os-suspend-session.json` and creates the evidence template if it is missing.
- The resume step fills `suspendedAt`, `resumedAt`, duration, and host machine metadata into `.codex-auto/production-smoke/real-os-suspend-resume.json`, then runs diagnostic mode.
- The resume step still leaves checks and pass status under strict verification control, so timestamps are captured without falsely approving the release gate.
- Added source-contract coverage for the begin/resume package scripts and capture-session implementation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The host still needs one real Windows sleep/resume cycle to produce passing event-log evidence.

### Phase 1.51 - Suspend Evidence Version Freshness Gate

Status: done

Implemented:

- The real OS suspend evidence template now reads the app version from `package.json` instead of carrying a hard-coded version.
- Strict verification now fails if `evidence.app.version` does not match the current package version.
- Diagnostic mode reports the version mismatch as a missing field, so stale evidence cannot silently satisfy a newer release.
- Added source-contract coverage for package-version loading and the version freshness gate.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The gate now prevents stale-version evidence, but it still needs a real OS sleep/resume run for pass status.

### Phase 1.52 - Production Gate Suspend Fail-Fast

Status: done

Implemented:

- Added real OS sleep/resume diagnostic and strict evidence verification directly into `scripts/verify-production-release-gate.mjs` before production risk closure.
- Production release validation now fails early on missing real OS suspend evidence instead of waiting until the later risk-closure phase.
- Updated the operational runbook to use the new `template`, `begin`, `resume`, `diagnose`, and strict verification flow.
- Added source-contract coverage that the production gate runs suspend diagnostic and strict evidence before production risk closure.

Validation:

- `node --check scripts\verify-production-release-gate.mjs`
- `pnpm exec biome check --write scripts\verify-production-release-gate.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The production gate is now stricter and faster to fail, but pass still requires the real Windows sleep/resume event-log evidence.

### Phase 1.53 - Suspend Evidence Binary Identity Gate

Status: done

Implemented:

- The real OS suspend evidence template now resolves `src-tauri/target/release/Aether.exe` from the current repository root instead of hard-coding a user-specific absolute path.
- Evidence now records the release executable identity: path, byte size, modified timestamp, and SHA-256.
- Resume capture refreshes the executable identity so the evidence reflects the binary that was actually present for the soak run.
- Strict verification now fails when the executable is missing, too small to be a release build, or when `app.sha256` does not match the current executable.
- Diagnostic output includes `validation.appExecutable`, so quality scoring and release triage can see whether the soak was tied to a real release binary.
- The quality score detail now includes whether the suspend diagnostic saw a release executable.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Binary identity is now gated, but the remaining pass blocker is still the real Windows sleep/resume cycle and post-resume checks.

### Phase 1.54 - Suspend Evidence Binary Refresh Command

Status: done

Implemented:

- Added `pnpm verify:production:suspend:refresh-app` for updating only the release executable identity in the suspend evidence.
- The refresh command stamps the current package version, executable path, size, modified timestamp, and SHA-256, then runs diagnostic mode.
- If an already-passing evidence file is refreshed against a changed binary, the command resets status back to `pending` so stale pass evidence cannot survive a binary change.
- Updated the operational runbook to include the refresh step before the sleep/resume capture.
- Added source-contract coverage for the package script and refresh implementation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json docs\AI_WORKSTATION_98_OPERATIONAL_RUNBOOKS.md`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Refresh fixes binary identity drift; real Windows sleep/resume evidence is still required for pass.

### Phase 1.55 - Suspend Evidence Pass Invalidation

Status: done

Implemented:

- Tightened pass-state invalidation for real OS suspend evidence.
- `refresh-app` now preserves `pass` only when package version, executable hash, size, and modified timestamp are unchanged.
- `refresh-app` resets evidence to `pending` when the release binary identity changed.
- `resume` capture now always resets evidence to `pending` because new sleep/resume timestamps require fresh strict verification.
- `resume` capture clears prior Windows power-event validation so old event-log matches cannot survive a new soak window.
- Added source-contract coverage for binary identity change detection and pass invalidation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:refresh-app`

Residual:

- Pass invalidation is stricter now; final release still needs the real Windows sleep/resume run.

### Phase 1.56 - Suspend Diagnostic Freshness Scoring

Status: done

Implemented:

- The release quality scorer now tracks the suspend evidence path and diagnostic path separately.
- Real OS suspend score detail now marks the diagnostic as `fresh` or `stale`.
- The diagnostic is considered fresh only when it is newer than both the suspend evidence and the current release executable.
- A stale diagnostic now becomes an explicit `real-os-soak` blocker telling the operator to rerun `pnpm verify:production:suspend:diagnose`.
- Added source-contract coverage for diagnostic freshness scoring and stale diagnostic blocker text.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Residual:

- Score reporting is now freshness-aware; pass still requires real Windows sleep/resume evidence.

### Phase 1.57 - Suspend Post-Resume Probe Capture

Status: done

Implemented:

- Added `pnpm verify:production:suspend:postcheck` for capturing non-mutating post-resume probes into the suspend evidence.
- The postcheck records current release executable identity, matching `Aether.exe` process presence, and PTY API `/health` reachability.
- Postcheck evidence is stored under `validation.postResumeProbes` and mirrored into diagnostic output.
- The command deliberately does not set strict checks to `true`; it only reduces triage ambiguity before the operator confirms app responsiveness, terminal responsiveness, SQLite write, and pane preservation.
- Running postcheck resets a previously passing evidence file back to `pending`, preventing a new probe from accidentally preserving old release approval.
- Updated the operational runbook with the postcheck step.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json docs\AI_WORKSTATION_98_OPERATIONAL_RUNBOOKS.md`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Postcheck is supportive evidence, not final release proof. The strict pass still requires real sleep/resume timestamps, Windows power events, and confirmed post-resume checks.

### Phase 1.58 - Suspend Postcheck Score Visibility

Status: done

Implemented:

- Added post-resume probe status to the release quality score detail.
- Real OS soak detail now reports whether the matching Aether process and PTY API health probe are up or down.
- Missing or failing postcheck probes now appear as explicit `real-os-soak` blockers.
- Diagnostic next steps now tell the operator to run postcheck, launch the release app, or restore PTY API health when those probes are missing or failing.
- Added source-contract coverage for postcheck score detail, probe blockers, and diagnostic next-step copy.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- The score now exposes failing app/API probes, but final pass still requires a real Windows sleep/resume cycle with all strict checks confirmed.

### Phase 1.59 - Suspend Terminal Roundtrip Postcheck

Status: done

Implemented:

- Extended `pnpm verify:production:suspend:postcheck` with an actual PTY terminal roundtrip through the release `aetherctl.exe`.
- Postcheck now creates a temporary PowerShell session, sends a unique `AETHER_POST_RESUME_TERMINAL_OK_*` marker, captures output, checks for the marker, and closes the session.
- Postcheck now machine-verifies and writes `checks.appResponsive` when the matching Aether process and PTY API health probe are both up.
- Postcheck now machine-verifies and writes `checks.terminalResponsive` when the terminal roundtrip succeeds.
- SQLite write and pane preservation remain strict/manual because the current probe cannot prove them without mutating or inspecting app-specific state more deeply.
- Quality score detail now includes terminal probe state, and failing terminal roundtrip is reported as an explicit blocker.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:quality-score`

Residual:

- App and terminal responsiveness can now be machine-verified. Remaining strict checks are real Windows sleep/resume power events, SQLite write confirmation, and pane-state preservation.

### Phase 1.60 - Modern Standby Power Event Support

Status: done

Implemented:

- Expanded real OS suspend evidence validation beyond classic S3 event IDs.
- The verifier now queries Windows System event IDs `1`, `42`, `107`, `187`, `506`, and `507`.
- Strict suspend evidence accepts classic suspend event `42` or Modern Standby enter event `506`.
- Strict resume evidence accepts `1`, `107`, or Modern Standby exit event `507`.
- Event `187` is recorded as an attempted suspend signal but does not satisfy pass criteria by itself.
- Added source-contract coverage for the Modern Standby event query and classification.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Observed Host State:

- `powercfg /a` reports S0 Modern Standby only; S1/S2/S3 hibernate paths are unavailable.
- Programmatic suspend attempts emitted Kernel-Power event `187`, but no `42/506` enter event and no `1/107/507` resume event, so strict real sleep/resume evidence remains incomplete.

Residual:

- A real user-initiated Modern Standby cycle is still required for event-log proof.

### Phase 1.61 - Suspend SQLite Pane Layout Postcheck

Status: done

Implemented:

- Added an `aetherctl db-smoke` command that writes, reads, compares, and deletes a pane-tree layout row in the production SQLite database.
- Extended `pnpm verify:production:suspend:postcheck` to run the SQLite pane-layout smoke after resume.
- Postcheck now machine-verifies `checks.sqliteWritable` and `checks.paneStatePreserved` when the DB roundtrip preserves the layout JSON exactly.
- The postcheck falls back to `cargo run --bin aetherctl -- db-smoke` when the release `aetherctl.exe` is older than the current source, so local validation is not blocked by a heavy distribution build.
- Release quality scoring now reports DB probe state and adds a dedicated blocker when pane-layout persistence is failing.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `cargo run --manifest-path src-tauri\Cargo.toml --bin aetherctl -- db-smoke`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- App, terminal, SQLite, and pane-layout recovery can now be machine-verified after resume. The remaining release blocker is real Windows sleep/resume event-log proof on this S0 Modern Standby host.

### Phase 1.62 - Sleep Capability Diagnostic Evidence

Status: done

Implemented:

- Real OS suspend diagnostics now capture `powercfg /a` and `powercfg /requests` output.
- Diagnostic evidence now records available sleep states, whether S0 Modern Standby is available, whether S3 appears available, and whether active power requests may block sleep.
- If only Kernel-Power attempted-suspend event `187` is present on an S0 host, diagnostics now explain that a user-initiated Windows Sleep cycle is still required.
- Release quality score detail now includes the detected sleep capability state alongside the post-resume probe state.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Diagnostics now explain the host sleep mode and blockers, but strict pass still requires actual Windows sleep/resume events `42/506` and `1/107/507`.

### Phase 1.63 - Release Aetherctl Postcheck Proof

Status: done

Implemented:

- Rebuilt the release `aetherctl.exe` binary only, without running the heavy installer/distribution build.
- Re-ran post-resume evidence capture so SQLite pane-layout smoke now runs through `release-aetherctl db-smoke` instead of the source fallback.
- Release quality score detail now shows which tool executed the DB/pane probe, making source fallback versus release-binary proof visible.

Validation:

- `cargo build --manifest-path src-tauri\Cargo.toml --release --bin aetherctl`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Release postcheck proof is stronger now. The remaining release blocker is still the missing real Windows sleep/resume event-log proof.

### Phase 1.64 - Right Rail Smoke Strictness

Status: done

Implemented:

- Added strict right-rail smoke mode via `pnpm verify:right-rail:strict`.
- `verify-right-rail-suite` can now fail CDP/WebView2-dependent checks when `AETHER_RIGHT_RAIL_REQUIRE_CDP=1` instead of quietly marking them skipped.
- Release quality scoring no longer grants full right-rail smoke points when CDP/WebView2 checks are skipped.
- Skipped right-rail CDP checks are now explicit score blockers, so the right rail cannot look fully verified without live native WebView2 evidence.

Validation:

- `node --check scripts\verify-right-rail-suite.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-right-rail-suite.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`
- `AETHER_RIGHT_RAIL_SUITE_OUT=.codex-auto/production-smoke/right-rail-suite-strict-dryrun.json pnpm verify:right-rail:strict` expectedly fails without CDP

Residual:

- Full right-rail smoke score now requires running the live Tauri/WebView2 CDP harness instead of relying on skipped checks.

### Phase 1.65 - Terminal Empty Paste Guard

Status: done

Implemented:

- The canvas terminal input path now swallows empty or non-text paste events before they can reach an AI CLI.
- The guard records an IME/input diagnostic event with `reason: empty-or-non-text-paste-ignored` instead of silently falling through.
- This keeps image attachment handling scoped to the lower IME input bar while preventing no-op clipboard events from leaking into Codex/Claude/Gemini CLI input handling.
- Removed a redundant IME positioning hook dependency caught by Biome during the pass.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\__tests__\useCanvasIME.test.ts`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx src\__tests__\IMEInputBar.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The screenshot text is emitted by the AI CLI, not by Aether. This guard reduces Aether-originated leakage, but a CLI-native image-paste keybinding can still print its own error when triggered inside the CLI.

### Phase 1.66 - Terminal Core Edge Readiness Scoring

Status: done

Implemented:

- Added a dedicated `terminal-core-edge` score axis to the release quality scorer.
- The scorer now checks for native terminal-engine signals: no xterm dependency, `alacritty_terminal`, `NativeTerminalRegistry`, `TerminalCanvas`, empty/non-text paste guard, native IME positioning IPC, scrollback evidence, IME evidence, and terminal roundtrip evidence.
- The scorer now exposes remaining terminal-core boundary risks instead of hiding them inside the generic IME score.
- Current explicit blockers include the WebView hidden-textarea IME bridge, WebView clipboard image ingestion, and incomplete native WebView2/CDP evidence.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Residual:

- The score now makes the terminal-core risk honest. Reaching edge-level quality still means removing the WebView hidden-textarea and navigator clipboard bridges from the terminal input core.

### Phase 1.67 - Native Clipboard Image Intake

Status: done

Implemented:

- Added `save_clipboard_image` Tauri IPC on Windows, reading `CF_DIBV5` / `CF_DIB` directly from Win32 clipboard and writing a temp BMP attachment.
- The explicit clipboard-image button in the terminal IME bar now uses the native IPC path instead of WebView `navigator.clipboard.read`.
- Kept paste-event image handling for browser-delivered `DataTransfer` files, but removed the button path's async Web Clipboard dependency.
- Added DIB-to-BMP unit coverage for standard, palette, and bitfield offsets.
- Release quality scoring now recognizes the native clipboard command and no longer lists WebView clipboard image ingestion as a terminal-core blocker.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib clipboard_dib -- --nocapture`
- `pnpm vitest run src\__tests__\IMEInputBar.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- Terminal core score improved to 77/116 overall and 6/10 for `terminal-core-edge`.
- Remaining terminal boundary risks are the WebView hidden-textarea IME bridge and incomplete live native WebView2/CDP evidence.

### Phase 1.68 - IME Diagnostics Overlay Control

Status: done

Implemented:

- Added an in-overlay close button for the opt-in input diagnostics panel so debug UI cannot remain stuck over split panes.
- Closing the panel clears the overlay localStorage flag and immediately unmounts the overlay.
- Restored pointer-event handling only on the diagnostics panel, not on decorative terminal layers.

Validation:

- `pnpm exec biome check --write src\features\terminal\NativeTerminalArea.tsx src\features\terminal\TerminalArea.module.css src\__tests__\NativeTerminalArea.test.tsx`
- `pnpm vitest run src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`

Residual:

- This removes the visible debug-panel UX footgun. It does not replace the remaining WebView IME proxy; that still needs the full native terminal input surface milestone.

### Phase 1.69 - Terminal Bell And Cursor Calm-Down

Status: done

Implemented:

- Stopped the canvas terminal cursor from blinking. It now renders solid to avoid the bright prompt-row strobe seen in AI CLI sessions.
- Changed the native terminal cursor color from Catppuccin mauve to a neutral foreground tint, removing the obvious pink flash.
- Fixed terminal bell detection so OSC control-sequence terminators such as `ESC ] 133 ; ... BEL` do not emit user-facing `terminal:bell` events.
- The bell filter tracks OSC state across split PTY chunks, so prompt marks split over multiple reads do not create fake bell notifications.
- Native OS terminal bell notifications are now opt-in via `localStorage["aether:terminalBellNotifications"]`, with a 30s per-terminal throttle when enabled.

Validation:

- `pnpm vitest run src\__tests__\TerminalCanvas.test.tsx src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib bell_filter -- --nocapture`
- `cargo check --manifest-path src-tauri\Cargo.toml`

Residual:

- This removes the visible flicker and the most likely source of repeated PowerShell/Aether bottom-right bell popups. The remaining deeper risk is still the WebView-backed IME input bridge.

### Phase 1.70 - Native Terminal Clipboard Text

Status: done

Implemented:

- Added `read_clipboard_text` and `write_clipboard_text` Tauri IPC commands using Win32 `CF_UNICODETEXT`.
- Terminal selection copy now prefers native clipboard IPC and only falls back to browser clipboard APIs if native IPC is unavailable.
- Selection-aware `Ctrl+C` now copies selected terminal text; without a selection it still sends `^C` to the PTY.
- `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` now read native clipboard text and paste normalized terminal input instead of sending literal `^V`.
- Existing paste risk guards still run for clipboard-shortcut pastes.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- Text copy/paste no longer depends on WebView clipboard permissions for the primary path. The remaining terminal risk is still the hidden textarea IME bridge.

### Phase 1.71 - Terminal Context Clipboard

Status: done

Implemented:

- Added terminal canvas context-menu handling for the clipboard path.
- Right-click with a terminal selection copies the selected range through the same native-first clipboard writer as `Ctrl+C`.
- Right-click without a selection reads native clipboard text and pastes through the guarded terminal paste pipeline.
- The context-menu paste path reuses the existing paste risk checks and line-ending normalization.

Validation:

- `pnpm exec biome check --write src\features\terminal\TerminalCanvas.tsx src\features\terminal\hooks\useCanvasIME.ts src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This closes the obvious terminal right-click copy/paste UX gap. It still does not remove the WebView hidden-textarea IME boundary; that remains the largest terminal-core risk.

### Phase 1.72 - Right Rail Strict WebView2 Smoke Evidence

Status: done

Implemented:

- Started the Tauri app with WebView2 remote debugging on `127.0.0.1:9222` using hidden process launch so no foreground console window is shown.
- Ran the consolidated right-rail smoke suite in strict mode, where unavailable CDP/WebView2 evidence fails instead of being recorded as skipped.
- Confirmed all right-rail runtime smokes passed:
  - Edge feedback
  - Decisions
  - Preferences
  - Negative path
  - Audit jump
- Refreshed the release quality score after the strict smoke evidence.

Validation:

- `pnpm verify:right-rail:strict`
- `pnpm verify:quality-score`

Score impact:

- Overall score moved from `77/116` to `81/116`.
- `terminal-core-edge` moved from `6/10` to `8/10` because native WebView2/CDP evidence is no longer incomplete.
- `right-rail-smoke` moved from `3/6` to `6/6`; no right-rail smoke checks are skipped.

Residual:

- The score still is not release-candidate ready. Remaining blockers are the WebView hidden-textarea IME boundary and the missing real Windows sleep/resume power-event proof.

### Phase 1.73 - Real OS Sleep/Resume Evidence Hardening

Status: done

Implemented:

- Tightened real Windows sleep/resume evidence validation so `System` log event IDs are no longer trusted without their expected provider.
- Suspend proof now only accepts:
  - `Microsoft-Windows-Kernel-Power` event `42`
  - `Microsoft-Windows-Kernel-Power` Modern Standby event `506`
- Resume proof now only accepts:
  - `Microsoft-Windows-Power-Troubleshooter` event `1`
  - `Microsoft-Windows-Kernel-Power` event `107`
  - `Microsoft-Windows-Kernel-Power` Modern Standby event `507`
- Attempted suspend is still tracked as `Microsoft-Windows-Kernel-Power` event `187`, but it cannot satisfy strict pass.
- Diagnostic output now records `rawEventCount` separately from provider-matched power events, preventing unrelated driver/service `Id=1` or `Id=107` rows from creating false release confidence.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Residual:

- This improves evidence integrity but does not create the missing real sleep/resume proof. Current diagnostic still reports `pending` status and no matching `42/506` plus `1/107/507` events inside the captured evidence window.

### Phase 1.74 - IME Candidate Immediate Composition Reanchor

Status: done

Implemented:

- Reduced a likely Codex/Claude IME candidate lag source by re-anchoring the native IMM candidate position directly from the `compositionupdate` event payload.
- The previous path could wait for React composition state to rerender before `set_ime_position` received the current preedit width.
- The terminal now computes the live composition cell span immediately in the hook and pushes the updated candidate coordinates in the same event tick.
- `input` events that are still composing use the same immediate offset path.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\__tests__\useCanvasIME.test.ts`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts --reporter=dot`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This narrows the visible IME position drift window, but it still does not eliminate the WebView hidden-textarea architecture boundary. Full removal still requires the native terminal input surface milestone.

### Phase 1.75 - WebView2 Focus HWND IME Fix

Status: done

Implemented:

- Fixed the native `set_ime_position` command to query GUI focus from the Tauri/WebView window's UI thread instead of using `GetGUIThreadInfo(0)`.
- This matters because IMM coordinates are relative to the focused child HWND. WebView2 keeps text focus on a child window; resolving focus from the wrong thread can fall back to the top-level Tauri HWND and shift Japanese candidate windows under DPI/custom-chrome layouts.
- The command now calls `GetWindowThreadProcessId(hwnd, None)` and passes that thread id into `GetGUIThreadInfo`.
- The safety fallback remains: if the focused HWND is not the main window or its child, Aether still uses the top-level HWND.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib ime_ -- --nocapture`

Residual:

- This improves native IME anchoring inside the current WebView2 architecture. It still does not remove the hidden textarea dependency; that is the next large native-input milestone.

### Phase 1.76 - Live IME Evidence After HWND Fix

Status: done

Implemented:

- Re-ran the native WebView2/CDP IME smoke after the `GetWindowThreadProcessId` focus-HWND fix.
- First Tauri dev launch hit a transient Windows linker lock (`LNK1114`) on the debug import library; Aether dev processes were stopped, the stale import library was removed, and the app was relaunched successfully.
- Refreshed `.codex-auto/production-smoke/verify-ime.json` with current live evidence.

Validation:

- `pnpm verify:ime`

Live checks passed:

- IMEInputBar DOM and composition lifecycle.
- Bar submit to PTY.
- Canvas overlay composition.
- Geometry, DPI, and resize containment.
- Long Japanese preedit regression.
- Blur, delete, and paste while composing.
- Direct overlay paste with LF converted to terminal Enter.

Residual:

- Current WebView2 IME behavior is live-verified after the native HWND fix. The architectural blocker remains: IME still depends on the WebView hidden textarea bridge instead of a fully native terminal input surface.

### Phase 1.77 - AI CLI IME Anchor Lock

Status: done

Implemented:

- Reduced the Codex/Claude-specific Japanese IME drift risk where an AI CLI status repaint can move the terminal cursor while composition is still active.
- Terminal composition now captures the IME cursor at composition start and keeps using that anchor until the composition commits, cancels, or resets.
- The hidden textarea, native IMM candidate position, and visible composition overlay now share the locked composition cursor instead of following prompt/status cursor churn mid-preedit.
- Added regression coverage for an AI CLI-style status repaint that moves the terminal cursor to another row while Japanese composition is active.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\features\terminal\TerminalCanvas.tsx src\__tests__\TerminalCanvasInput.test.tsx`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This removes another WebView/AI-CLI race inside the current architecture. It is still a mitigation, not the final full-native terminal input surface.

### Phase 1.78 - Right Rail Scroll Constraint Hardening

Status: done

Implemented:

- Hardened the right rail layout so the scrollable content owns a real constrained height in Tauri/WebView flex layout.
- `.right-panel` is now a column flex container with `min-height: 0`; `.right-panel-content` is `flex: 1 1 auto` with `min-height: 0` and keeps `overflow-y: auto`.
- This removes the parent/child height ambiguity that could make the right rail appear stuck even though the child had `overflow-y: auto`.
- Expanded the static regression contract so future CSS changes must preserve the scroll parent and child constraints.

Validation:

- `pnpm exec biome check --write src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- In-app browser/Vite visual check on `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2Fdev%2FAether_Terminal&rail=observe&state=blocked&v=rail-scroll-contract`

Browser metrics:

- `.right-panel-content`: `overflow-y: auto`, `flex: 1 1 auto`, `min-height: 0px`.
- `.right-panel`: `display: flex`, `flex-direction: column`, `min-height: 0px`.
- Scroll surface measured `clientHeight=598`, `scrollHeight=2259`, and moved from `scrollTop=0` to `scrollTop=720`.

Residual:

- The right rail scroll bug is covered by static and live browser evidence. The release score still stays blocked by native terminal input architecture and real OS suspend evidence.

### Phase 1.79 - Guarded Real OS Sleep Cycle Gate

Status: done

Implemented:

- Added `pnpm verify:production:suspend:cycle` for a single guarded Windows sleep/resume evidence flow.
- Wired the production release gate so `--sleep-cycle` or `AETHER_RELEASE_SLEEP_CYCLE=1` uses that guarded cycle instead of the older split diagnose/evidence pair.
- The cycle refreshes the release app identity, records begin time, invokes Windows sleep, records resume time, runs post-resume process/API/terminal/SQLite probes, then promotes the evidence to `pass` only if strict Windows power events are present.
- The command refuses to sleep unless `QUORUM_ALLOW_OS_SLEEP=1` is set, and that guard now runs before any evidence/session file is touched.
- Programmatic attempted-suspend-only evidence still cannot pass; the strict validator still requires provider-matched suspend and resume events.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\verify-production-release-gate.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm exec biome check --write scripts\verify-production-release-gate.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:cycle` without `QUORUM_ALLOW_OS_SLEEP=1` exited `1` and left both evidence and session timestamps unchanged.

Residual:

- This removes operator-step ambiguity and prevents accidental false evidence. It does not itself create the missing real Windows sleep/resume proof; the host must actually enter and resume from a Windows sleep state with `QUORUM_ALLOW_OS_SLEEP=1` for the score blocker to clear.

### Phase 1.80 - Real OS Sleep Cycle Noise Reduction

Status: done

Implemented:

- Ran the guarded production sleep/resume cycle against the release `Aether.exe`.
- Confirmed the host still records only `Microsoft-Windows-Kernel-Power:187` attempted-suspend events for the programmatic `SetSuspendState` path.
- Increased the guarded cycle default post-wake settle from 5s to 12s so the strict `>=10s` evidence bracket does not add a noisy duration failure on fast Modern Standby returns.

Validation:

- `Start-Process <repo>\src-tauri\target\release\Aether.exe`
- `pnpm verify:production:suspend:refresh-app`
- `QUORUM_ALLOW_OS_SLEEP=1 pnpm verify:production:suspend:cycle`
- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs`

Residual:

- The real blocker is now isolated: this host's programmatic sleep path records attempted-suspend event `187` but not the required suspend `42/506` and resume `1/107/507` events. A user-initiated Windows Sleep cycle is still required to close `real-os-soak`.

### Phase 1.81 - Rust-Owned Terminal Input Commit Path

Status: done

Implemented:

- Added `NativeTerminalInputHost` as a managed Rust state object for the terminal input migration.
- Added `native_terminal_input_commit` and `native_terminal_input_status` IPC commands.
- `useCanvasIME` now routes committed terminal bytes through `native_terminal_input_commit` with source `webview-ime-bridge`, so committed input has a distinct Rust-owned control-plane path while the remaining WebView composition bridge is still honestly exposed.
- The host status explicitly reports `webview_composition_bridge_required: true` and `native_composition_surface_ready: false`, preventing a false claim that the hidden textarea architecture is gone.
- Added static and Rust regression coverage for the native input host contract.

Validation:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml default_status_is_honest_about_remaining_webview_bridge --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml record_commit_updates_active_terminal_and_count --lib`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- This is a migration step, not the final native IME surface. The release score correctly remains blocked until the WebView hidden textarea bridge is replaced by a real native composition/input surface and real Windows sleep/resume evidence passes.

### Phase 1.82 - Native Input Host Evidence Gate

Status: done

Implemented:

- Added `pnpm verify:terminal:native-input`.
- The verifier writes `.codex-auto/production-smoke/native-terminal-input-host.json` with separate checks for the Rust host, commit IPC, status IPC, frontend commit routing, and final native composition ownership.
- The check intentionally returns `blocked` while `TerminalCanvas` still owns `data-testid="terminal-ime-textarea"`, so the release score cannot be made green by renaming or hiding the remaining WebView composition bridge.
- `score-release-quality.mjs` now consumes the native input host evidence and keeps the terminal-core blocker tied to the failed composition-surface check.

Validation:

- `node --check scripts\verify-native-terminal-input-host.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-native-terminal-input-host.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:native-input` returned `blocked` as expected with only `composition-surface` failing.
- `pnpm verify:quality-score`

Residual:

- The evidence gate is now stricter and clearer, but the product blocker remains: implement the native composition/input surface and remove the WebView hidden textarea from the terminal core path.

### Phase 1.83 - Native HWND Input Surface Scaffold

Status: done

Implemented:

- Extended the Rust native input host from a commit-only control path into a Windows HWND-backed input surface scaffold.
- Added `native_terminal_input_focus` and `native_terminal_input_drain` IPC commands.
- The Windows implementation creates an `EDIT` child HWND, positions it at the terminal caret, focuses it, tracks `WM_IME_STARTCOMPOSITION` / `WM_IME_ENDCOMPOSITION`, and drains committed text only when composition is not active.
- The native surface now intercepts non-composition `WM_KEYDOWN` terminal control keys before text draining, covering Enter, Backspace, Tab, Escape, arrows, Delete, Home, and End without routing those keys through the WebView textarea.
- Made the native HWND surface the default input owner in the Tauri runtime while keeping the WebView textarea as a conditional non-Tauri / emergency opt-out fallback.
- Updated `verify:terminal:native-input` so it now proves Rust host, commit IPC, status IPC, surface focus/drain IPC, native surface key routing, frontend native-default ownership, frontend commit routing, and frontend native-surface opt-in separately.

Validation:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml default_status_is_honest_about_remaining_webview_bridge --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml record_commit_updates_active_terminal_and_count --lib`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm verify:terminal:native-input`

Residual:

- The native HWND surface is now the Tauri default. The remaining release blocker moves to live dogfood evidence: Codex/Claude/Gemini Japanese input must be proven on the native surface before the old WebView fallback can be deleted rather than merely disabled by default.

### Phase 1.84 - Rail Truth Hygiene And Action Evidence

Status: done

Implemented:

- Visual QA mode now requires an explicit development URL flag. A stale `localStorage` value can no longer silently replace normal project tabs with the visual-QA workspace.
- The generic `state` URL alias is treated as deprecated QA input. When it is used, the right rail shows a Truth source notice explaining that the visible state is fixture data and runtime truth is unchanged.
- URL/history `edgeLoop` feedback is now read only for explicit visual-QA requests. Normal runtime loads use project-scoped storage only, so stale debug URLs cannot poison the product state.
- The right rail exposes a compact Truth source notice for simulated rail state, deprecated `state` aliases, and URL replay evidence.
- Ranked right-rail actions now carry a required `target` object and required execution `evidence`, and the audit payload records both.
- Action cards now show human-readable targets such as session names, files, panes, or widgets instead of falling back to internal IDs.
- The right-rail layout smoke now measures the real scroll container, `.right-panel-content`, while keeping stack width checks.
- Fresh visual evidence was regenerated at `.codex-auto/visual/right-rail-next-action-qa.png`.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\shared\hooks\useTabManager.ts src\shared\lib\rightRailAdvisor.ts src\__tests__\AppSilentBugs.test.ts src\__tests__\useTabManager.test.ts src\__tests__\rightRailAdvisor.test.ts e2e\visual-qa-layout.spec.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\useTabManager.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\useAgentManagerTelemetry.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- `pnpm verify:right-rail-edge`
- `pnpm verify:quality-score`

Residual:

- Full `pnpm test -- --reporter=dot` ran 1514/1515 tests green and hit one `useAgentManagerTelemetry` failure during the combined run; the same file passed immediately in isolation. Treat this as an existing suite flake to harden, not as a right-rail regression.
- Next edge pass should move from action evidence to provenance: changed files should link directly to command block, pane, session, worktree, validation output, and final report.

### Phase 1.85 - Review Queue File Provenance

Status: done

Implemented:

- Added `traceFileProvenance()` to the workstation graph layer.
- File provenance now resolves owner agent, tool, validation tests, risks, blockers, and worktree/workspace scope from graph edges.
- Agent graph nodes now carry workspace/worktree metadata so review and handoff surfaces can explain where a change came from.
- Review Queue items now render a compact Trace line for graph-backed files.
- Trace owner chips select the owning session, keeping provenance actionable instead of decorative.

Validation:

- `pnpm exec biome check src\shared\lib\workstationGraph.ts src\features\review\ReviewQueuePanel.tsx src\features\review\ReviewQueuePanel.module.css src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx`
- `pnpm vitest run src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`

Residual:

- Provenance is now visible for graph-backed files, but command-block evidence is still not first-class. Next pass should add command/cwd/exit/output-range records and connect them to changed files and validation state.

### Phase 1.86 - Command Block Provenance

Status: done

Implemented:

- Added first-class `command_block` nodes to the workstation graph.
- Command blocks carry command text, cwd, shell, exit code, derived status, validation kind, pane/terminal/process links, and optional output preview metadata.
- Added `ran` edges from agents, panes, terminals, and processes to command blocks.
- Validation commands such as test, lint, typecheck, build, format, smoke, and verify now attach to file nodes as graph evidence.
- `traceFileProvenance()` now returns command evidence alongside owners, tools, tests, risks, blockers, and worktrees.
- Review Queue Trace chips now show command evidence such as `test: pnpm test -- src/App.tsx`, including pass/fail status and exit code in the tooltip.

Validation:

- `pnpm exec biome check src\shared\lib\workstationGraph.ts src\features\review\ReviewQueuePanel.tsx src\features\review\ReviewQueuePanel.module.css src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx`
- `pnpm vitest run src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`
- Browser evidence: `.codex-auto/visual/right-rail-review-command-provenance.png`

Residual:

- Command evidence is now graph-addressable, but live terminal command segmentation still needs to feed real command blocks automatically from the Rust PTY/mux layer rather than relying on supplied graph inputs.
- Output-range anchors are represented only as metadata-ready shape so far; the terminal renderer still needs native block anchors that can jump back to exact scrollback rows.

### Phase 1.87 - Real History Command Blocks

Status: done

Implemented:

- Added `CommandHistoryRecord` frontend typing for the existing `search_command_history` IPC response.
- Added `commandHistoryRecordsToCommandBlocks()` to convert recent persisted command history into workstation graph command blocks.
- Validation-like history entries now link to current changed files, while file-specific non-validation commands only link when the command mentions the file path or basename.
- Right rail graph construction now feeds recent real command history into `buildWorkstationGraph()` outside visual QA fixture mode.
- Rust now updates the newest open command history row when OSC 133 `CommandEnd` marks carry an exit code.
- Main terminal and interactive-agent terminal prompt-mark loops both persist exit-code evidence before emitting the prompt-mark event.

Validation:

- `pnpm exec biome check src\App.tsx src\shared\lib\commandHistoryGraph.ts src\shared\types\history.ts src\__tests__\commandHistoryGraph.test.ts`
- `pnpm vitest run src\__tests__\commandHistoryGraph.test.ts src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml test_update_latest_command_exit_code`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`
- Browser evidence: `.codex-auto/visual/right-rail-review-history-command-blocks.png`

Residual:

- Real history is now converted into graph command blocks, but command start/output range still depends on shell history plus OSC 133 marks being correlated indirectly.
- Next pass should add a native command block journal keyed by terminal id, command history id, prompt-mark sequence, and scrollback range so Review Queue can jump to exact terminal evidence.

### Phase 1.88 - Native Command Block Journal

Status: done

Implemented:

- Added a Rust `CommandBlockJournal` managed state.
- `save_command_history` now returns the inserted command history id and records a native command block immediately.
- Native command block records link terminal id, command history id, command text, cwd, status, exit code, prompt-mark sequences, screen lines, and history-size anchors.
- The main terminal stream and interactive-agent terminal stream both feed every OSC 133 prompt mark into the native journal.
- Added `term_command_blocks` IPC to expose recent native command blocks for a terminal.
- Frontend graph construction now fetches native command blocks from active terminal panes and merges them with persisted command history evidence.
- Workstation graph command block metadata now preserves prompt-mark and scrollback anchors for later jump-to-evidence behavior.

Validation:

- `pnpm exec biome check src\App.tsx src\shared\lib\commandHistoryGraph.ts src\shared\lib\workstationGraph.ts src\shared\types\history.ts src\__tests__\commandHistoryGraph.test.ts src\__tests__\workstationGraph.test.ts`
- `pnpm vitest run src\__tests__\commandHistoryGraph.test.ts src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml command_blocks`
- `cargo test --manifest-path src-tauri\Cargo.toml test_update_latest_command_exit_code`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`
- Browser evidence: `.codex-auto/visual/right-rail-review-native-command-journal.png`

Residual:

- Native command blocks now have scrollback anchors, but Review Queue chips still only show text/status. The next pass should add an explicit "open terminal evidence" action from a command chip to the anchored scrollback row.

### Phase 1.89 - Command Evidence Jump Action

Status: done

Implemented:

- Added a shared terminal command evidence event contract.
- Workstation graph command provenance now exposes terminal id, prompt-mark sequences, screen lines, and history-size anchors to UI surfaces.
- Review Queue command Trace chips become actionable buttons when terminal evidence is available.
- Clicking a command evidence chip selects the source terminal pane and dispatches the prompt-mark/scrollback anchor to `TerminalCanvas`.
- `TerminalCanvas` listens for command evidence events and scrolls to the matching prompt mark when available, falling back to the history-size anchor.
- The right rail shows a route confirmation so the user understands that the terminal evidence was opened.

Validation:

- `pnpm exec biome check src\App.tsx src\features\terminal\TerminalCanvas.tsx src\features\review\ReviewQueuePanel.tsx src\shared\lib\terminalEvidence.ts src\shared\lib\workstationGraph.ts src\__tests__\ReviewQueuePanel.test.tsx`
- `pnpm vitest run src\__tests__\commandHistoryGraph.test.ts src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`
- Browser evidence: `.codex-auto/visual/right-rail-review-command-evidence-jump.png`

Residual:

- Visual QA fixtures do not yet include a terminal-backed command chip, so browser evidence proves review-rail layout stability while unit tests prove the actionable chip path.
- Next pass should add fixture-level native command evidence so visual QA can exercise the click-to-terminal path without requiring a live shell session.

### Phase 1.90 - Fixture Command Evidence QA

Status: done

Implemented:

- Visual QA review fixtures now include a terminal-backed command block for `pnpm exec tsc --noEmit`.
- The fixture command block carries terminal id, agent ownership, file links, validation kind, prompt-mark sequences, history-size anchors, and screen-line anchors.
- Review rail fixture graph filtering now preserves command-to-file provenance edges for agent-focused views without expanding unrelated workspace/thread fanout.
- Added an E2E guard that scopes to `Provenance for src/App.tsx`, verifies the terminal evidence action, clicks it, and asserts the emitted terminal evidence target.
- Captured fresh browser evidence at `.codex-auto/visual/right-rail-review-fixture-command-evidence.png`.

Validation:

- `pnpm exec biome check e2e\visual-qa-layout.spec.ts src\App.tsx src\shared\lib\workstationGraph.ts src\features\review\ReviewQueuePanel.tsx src\features\terminal\TerminalCanvas.tsx src\shared\lib\commandHistoryGraph.ts src\shared\lib\terminalEvidence.ts`
- `pnpm exec tsc --noEmit`
- `pnpm vitest run src\__tests__\commandHistoryGraph.test.ts src\__tests__\workstationGraph.test.ts src\__tests__\ReviewQueuePanel.test.tsx --reporter=dot`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml command_blocks`
- `cargo test --manifest-path src-tauri\Cargo.toml test_update_latest_command_exit_code`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "command evidence" --retries=0`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "review rail" --retries=0`
- `pnpm verify:quality-score`
- Browser check: `Provenance for src/App.tsx` exposes exactly one visible `Open terminal evidence for pnpm exec tsc --noEmit` action.

Residual:

- Fixture-level click-to-evidence is now covered, but the remaining confidence gap is live dogfood evidence: real Codex/Claude/Gemini terminal sessions must prove that native command block anchors jump to the correct scrollback row after actual shell output, pane switching, and session recovery.
- The quality score currently rewards right-rail smoke and action clarity, but it does not yet fail release when command evidence jump coverage or fresh evidence screenshots are missing. Next pass should add those guardrails to the release score.

### Phase 1.91 - Command Evidence Release Gate

Status: done

Implemented:

- Added a dedicated `command-evidence` category to `pnpm verify:quality-score`.
- The release score now requires the terminal evidence event contract, runtime path, review rail action wiring, terminal scrollback jump handling, fixture E2E coverage, and a fresh browser screenshot.
- Static regression coverage now checks that the quality score script keeps the command evidence gate wired.
- The score temporarily dropped to `94/124` with blockers for incomplete runtime detection and stale screenshot checks; both were corrected against the actual implementation surface.

Validation:

- `pnpm exec biome check scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Result:

- `pnpm verify:quality-score` now reports `100/124`, grade `S`, `legacy release-ready state`.

Residual:

- The gate proves fixture/E2E/browser evidence freshness. The remaining edge gap is still live dogfood proof for real AI CLI sessions and recovered panes, especially after pane switches, session restore, and long scrollback output.

### Phase 1.92 - Repeatable Command Evidence Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-command-evidence.mjs`, a repeatable browser smoke for review-rail command evidence.
- Added `pnpm verify:right-rail-command-evidence`.
- The smoke opens the review visual-QA fixture, scopes to `Provenance for src/App.tsx`, clicks `Open terminal evidence for pnpm exec tsc --noEmit`, verifies the emitted `qa-review-shell` terminal target, records console/page errors, captures the browser screenshot, and writes `.codex-auto/production-smoke/right-rail-command-evidence.json`.
- Added the command evidence smoke to `pnpm verify:right-rail` so the right-rail suite now covers Edge feedback plus command evidence on localhost.
- Upgraded `pnpm verify:quality-score` to require the fresh command evidence JSON artifact in addition to source wiring, E2E coverage, and screenshot freshness.

Validation:

- `pnpm exec biome check scripts\verify-right-rail-command-evidence.mjs scripts\verify-right-rail-suite.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `node --check scripts\verify-right-rail-command-evidence.mjs`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/right-rail-command-evidence.json` reports the emitted terminal target as `qa-review-shell`.
- `pnpm verify:quality-score` reports `100/124`, grade `S`, `legacy release-ready state`.

Residual:

- The smoke is still fixture-backed. The next confidence gap is a live terminal dogfood recorder that proves command evidence on real shell output from Codex/Claude/Gemini panes and after restore/reconnect.

### Phase 1.93 - Native CDP And Clean IME Evidence

Status: done

Implemented:

- Started the Tauri dev app with WebView2 remote debugging on `127.0.0.1:9222` and reran the strict right-rail suite without skipped CDP checks.
- Verified the native/WebView2 right rail suite in strict mode, including decisions, preferences, negative path, audit jump, Edge feedback, and command evidence.
- Reran native input host verification and live IME verification against the native app.
- Hardened `scripts/verify-ime.mjs` so it navigates to a clean visual-QA URL before testing. The smoke now deletes stale `state`, `edgeLoop`, and dashboard-state URL parameters instead of accepting whatever URL was already open.
- Added static regression coverage so the IME smoke cannot silently return to stale visual-QA URLs.

Validation:

- `pnpm verify:right-rail:strict`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:native-input`
- `pnpm verify:ime`
- `pnpm exec biome check scripts\verify-ime.mjs src\__tests__\AppSilentBugs.test.ts`
- `node --check scripts\verify-ime.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Result:

- `pnpm verify:ime` now attaches to `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2Fdev%2FAether_Terminal&rail=command&v=verify-ime-clean`.
- `pnpm verify:quality-score` reports `100/124`, grade `S`, `legacy release-ready state`.

Residual:

- Native CDP and IME evidence are now clean for the current running app. Remaining confidence work should focus on real command-block evidence after long output, pane restore/reconnect, and multiple AI CLI panes.

### Phase 1.94 - Live Command Evidence And Stale Sidecar Guard

Status: done

Implemented:

- Added `scripts/verify-live-command-evidence.mjs`, a live WebView2/CDP smoke that spawns a fresh PowerShell terminal, submits a real command, waits for terminal output, and verifies `term_command_blocks` reports a `passed` native command block with exit code and scrollback anchor.
- Added `pnpm verify:terminal:command-evidence`.
- Added a `live-command-evidence` category to `pnpm verify:quality-score`, raising the scored surface to `132` max points and making live command-block evidence a release gate.
- Hardened `save_command_history` and the write-side IPC paths so full submitted payloads (`command + Enter`) prepare a command block before PTY write, while reusing an already-open matching block to avoid duplicate history rows.
- Added command-block dedupe support in `CommandBlockJournal` and pane cwd lookup in `PaneRegistry`.
- Bumped the daemon protocol to `2` and made the app terminate a stale matching PTY sidecar when protocol/version no longer matches. This prevents dev/release sessions from silently keeping an older sidecar that lacks current PowerShell shell-integration behavior.
- Rebuilt the dev PTY sidecar at `src-tauri\target\debug\aether-pty-server.exe` so spawned PowerShell sessions now include Aether OSC 133 shell integration.
- Fixed CDP smoke scripts to use `browser.disconnect()` instead of `browser.close()` so one smoke no longer closes the Tauri WebView before the rest of the strict suite runs.

Validation:

- `cargo build --manifest-path src-tauri\pty-server\Cargo.toml --target-dir src-tauri\target`
- `cargo test --manifest-path src-tauri\Cargo.toml command_blocks --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml submitted_input_command_history_text_requires_enter --lib`
- `cargo test --manifest-path src-tauri\Cargo.toml powershell_startup_args_skip_profile_and_keep_prediction_guard --lib`
- `pnpm verify:terminal:command-evidence`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail:strict`
- `pnpm verify:terminal:native-input`
- `pnpm verify:ime`
- `pnpm verify:quality-score`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check scripts\verify-live-command-evidence.mjs scripts\verify-right-rail-command-evidence.mjs scripts\verify-right-rail-edge-feedback.mjs scripts\verify-right-rail-decisions.mjs scripts\verify-right-rail-negative-path.mjs scripts\verify-right-rail-audit-jump.mjs scripts\verify-right-rail-preferences.mjs scripts\verify-ime.mjs src\features\terminal\NativeTerminalArea.tsx src\features\terminal\TerminalCanvas.tsx src\__tests__\NativeTerminalArea.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\NativeTerminalArea.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo check --manifest-path src-tauri\Cargo.toml --lib`

Result:

- `.codex-auto/production-smoke/live-command-evidence.json` reports a real PowerShell command block with `status=passed`, `exitCode=0`, and prompt/scrollback anchors.
- `pnpm verify:quality-score` reports `100/132`, grade `S`, `legacy release-ready state`.

Residual:

- Live command evidence now covers a fresh PowerShell pane. The next product-confidence gap is multi-pane/recovered-session evidence: verify the same command-block anchors after pane split/close/reopen, daemon restore, and long scrollback output across AI CLI panes.

### Phase 1.95 - Multi-Pane Long-Scrollback Command Evidence

Status: done

Implemented:

- Added `scripts/verify-multipane-command-evidence.mjs`, a live WebView2/CDP smoke for command evidence across a base PowerShell pane and a mux-split PowerShell pane.
- Added `pnpm verify:terminal:multipane-command-evidence`.
- The smoke creates a base terminal, splits it through `mux_split_pane`, submits long-output commands to both panes, verifies each pane produces a `passed` command block with exit code `0`, verifies the first marker survives in `term_history_rows`, closes the split pane through `mux_close_pane`, and verifies the base pane evidence remains anchored after split close.
- Hardened the smoke against early CDP attachment where the only exposed page is `about:blank`; the script now reuses that tab and navigates it to a clean visual-QA URL.
- Added a `multipane-command-evidence` category to `pnpm verify:quality-score`, raising the scored surface to `140` max points.
- Added static regression coverage so the package script, mux split/close smoke, scrollback row check, command-block check, and score category stay wired.

Validation:

- `node --check scripts\verify-multipane-command-evidence.mjs`
- `pnpm exec biome check scripts\verify-multipane-command-evidence.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:terminal:command-evidence`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/multipane-command-evidence.json` reports `ok=true`.
- Base pane command block: `passed`, scrollback history size `85`.
- Split pane command block: `passed`, scrollback history size `85`.
- `pnpm verify:quality-score` reports `100/140`, grade `S`, `legacy release-ready state`.

Residual:

- Multi-pane long-scrollback evidence is covered for live PowerShell and mux split/close. The remaining confidence gap is recovered-session evidence: prove command-block anchors survive daemon/app reconnect or restore, then extend the same evidence path to AI CLI panes where prompt framing can differ from plain PowerShell.

### Phase 1.96 - Recovered Command Evidence Persistence

Status: done

Implemented:

- Added durable `terminal_command_blocks` SQLite storage for native command-block evidence.
- Command blocks are now persisted when a submitted command is recorded and again as OSC 133 prompt marks attach command/output/end anchors.
- `term_command_blocks` now falls back to the durable DB copy when the in-memory `CommandBlockJournal` is empty after reconnect.
- Added `term_persisted_command_blocks` as a diagnostics/recovery validation IPC that bypasses memory and proves the persisted evidence copy exists.
- Added Tauri startup adoption for long-lived PTY sidecar sessions. Existing sidecar terminals are registered back into the pane registry, native renderer, output buffer, prompt-mark stream, and mux surface after a WebView/Tauri reconnect.
- Added `scripts/verify-recovered-command-evidence.mjs`, a live WebView2/CDP smoke that spawns PowerShell, submits a real command, verifies live and persisted anchored command blocks, reloads the WebView, and verifies the same command evidence remains visible after reconnect.
- Added `pnpm verify:terminal:recovered-command-evidence`.
- Added a `recovered-command-evidence` category to `pnpm verify:quality-score`, raising the scored surface to `148` max points.

Validation:

- `node --check scripts\verify-recovered-command-evidence.mjs`
- `pnpm exec biome check scripts\verify-recovered-command-evidence.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml test_command_block_evidence_persists_for_reconnect -- --nocapture`
- `pnpm verify:terminal:recovered-command-evidence`
- `pnpm verify:terminal:command-evidence`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:quality-score`
- `pnpm exec tsc --noEmit`

Result:

- `.codex-auto/production-smoke/recovered-command-evidence.json` reports `ok=true`.
- `pnpm verify:quality-score` reports `100/148`, grade `S`, `legacy release-ready state`.

Residual:

- Recovered WebView reconnect evidence is now covered for PowerShell and persisted command-block anchors. The next confidence gap is harder: full app-process restart with an already-running sidecar mux graph, plus Codex/Claude/Gemini CLI prompt framing under native input and clipboard paths.

### Phase 1.97 - Process Restart Sidecar Adoption Evidence

Status: done

Implemented:

- Added `scripts/verify-process-reconnect-command-evidence.mjs`, a live WebView2/CDP smoke for true Aether process restart over a long-lived PTY sidecar.
- Added `pnpm verify:terminal:process-reconnect-command-evidence`.
- The smoke attaches to a running Tauri dev app, spawns a base PowerShell pane, creates a mux split pane, submits commands in both panes, verifies live and persisted command-block evidence, stops the current `Aether.exe` process without killing the sidecar, verifies the sidecar still lists both terminal ids, starts the debug `Aether.exe` again, verifies the restarted app adopts both terminal ids, then submits fresh commands through both recovered terminals and verifies live plus persisted command evidence again.
- The smoke now reads the hardened sidecar token file instead of assuming `dev`, matching the real app/sidecar authentication boundary.
- Added a `process-reconnect-command-evidence` category to `pnpm verify:quality-score`, raising the scored surface to `156` max points.
- Added static regression coverage so the package script, sidecar retention check, restarted-app adoption check, persisted command-block check, and score category stay wired.

Validation:

- `node --check scripts\verify-process-reconnect-command-evidence.mjs`
- `pnpm exec biome check scripts\verify-process-reconnect-command-evidence.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:process-reconnect-command-evidence`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/process-reconnect-command-evidence.json` reports `ok=true`.
- The smoke verified `sidecarRetainedTerminal=true`, `sidecarRetainedSplitTerminal=true`, `terminalAdoptedAfterRestart=true`, and `splitTerminalAdoptedAfterRestart=true`.
- `pnpm verify:quality-score` reports `100/156`, grade `S`, `legacy release-ready state`.

Residual:

- Process restart evidence is now covered for base and split PowerShell panes. The remaining terminal-edge risks are AI CLI specific: Codex/Claude/Gemini prompt framing, Japanese IME composition under those CLIs, and image/text clipboard paths.

### Phase 1.98 - Interactive AI CLI Sidecar Boundary and Reconnect Race Hardening

Status: done

Implemented:

- Added authenticated sidecar command-session support via `POST /commands`, with bounded executable-name, argument, environment, cwd, and session-limit validation.
- Added `PtySidecarClient::spawn_command` so non-shell processes can run on the long-lived sidecar stream instead of the in-process PTY path.
- Moved `spawn_interactive_agent` to an async sidecar-first path. Codex/Claude/Gemini interactive sessions now spawn, stream, and close through the same sidecar/native-renderer boundary as normal panes; native in-process PTY is only a visible fallback when sidecar is unavailable.
- Added `backend` provenance to interactive spawn results, plus static regression tests that guard sidecar spawn, sidecar output subscription, and sidecar close-before-native-fallback.
- Added `backend` provenance to live interactive session metadata and the interactive session card so `sidecar`, `native fallback`, or unknown backend state is visible instead of hidden.
- Fixed command evidence false positives:
  - command history cwd is normalized so frontend `C:/...` and backend `C:\...` saves dedupe instead of producing fallback-looking duplicate blocks.
  - initial PowerShell prompt `CommandEnd(sequence=0)` no longer closes a pending command before any actual command start/output.
  - after app-process reconnect, command blocks can still close when the current prompt's `CommandStart` happened before the new Aether process attached, as long as the observed `CommandEnd` is post-output rather than the initial prompt sentinel.
- Hardened live smoke scripts against real async races:
  - multipane long-output verification now waits for scrollback growth.
  - final snapshot reads are accepted when the marker appears exactly at the timeout edge.
  - process-reconnect smoke can restart Vite when killing the initial Aether process also tears down the dev server.
  - fresh split panes wait for shell readiness before input, while restored sidecar panes rely on adoption plus command-end evidence because their previous prompt screen is not replayed.
- Added `interactive-ai-cli-sidecar-boundary` to `pnpm verify:quality-score`, raising the scored surface to `164` max points.

Validation:

- `cargo test --manifest-path src-tauri\Cargo.toml command_session_rejects_path_like_programs -- --nocapture`
- `cargo test --manifest-path src-tauri\Cargo.toml daemon_contract_exposes_versioned_capabilities -- --nocapture`
- `cargo test --manifest-path src-tauri\Cargo.toml command_end_before_command_start_does_not_close_pending_command -- --nocapture`
- `cargo test --manifest-path src-tauri\Cargo.toml command_end_without_seen_start_can_close_after_reconnect_output -- --nocapture`
- `cargo test --manifest-path src-tauri\Cargo.toml command_history_cwd_normalizes_windows_and_url_separators -- --nocapture`
- `cargo build --manifest-path src-tauri\Cargo.toml --bin Aether`
- `pnpm vitest run src\__tests__\interactiveCommandsWorktreeFailure.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check scripts\verify-process-reconnect-command-evidence.mjs scripts\verify-multipane-command-evidence.mjs scripts\score-release-quality.mjs src\__tests__\interactiveCommandsWorktreeFailure.test.ts src\shared\types\interactiveAgent.ts`
- `pnpm verify:terminal:command-evidence`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:terminal:recovered-command-evidence`
- `pnpm verify:terminal:process-reconnect-command-evidence`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/live-command-evidence.json`, `multipane-command-evidence.json`, `recovered-command-evidence.json`, and `process-reconnect-command-evidence.json` all report `ok=true`.
- `pnpm verify:quality-score` reports `164/164`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- This phase proves the AI CLI launch/control boundary is sidecar-first and closes the command evidence races found by the smoke loop. The remaining high-value terminal-edge work is direct live AI CLI behavioral evidence: Codex/Claude/Gemini-specific Japanese IME composition, text/image clipboard, prompt framing, and long-running session telemetry under the new sidecar command path.

### Phase 1.99 - AI CLI Boundary Runtime Proof and Fallback Visibility

Status: done

Implemented:

- Added `scripts/verify-interactive-ai-cli-boundary.mjs`, a deterministic sidecar smoke that creates local Codex, Claude, and Gemini CLI shims without spending real model tokens.
- The smoke starts the PTY sidecar, verifies `command-session` in the daemon contract, rejects unauthenticated `/commands`, rejects path-like unsafe programs, and then spawns all three CLI shims through `POST /commands`.
- Each shim proves the sidecar command-session boundary by receiving stream-ticket output, showing ready text in capture, accepting PTY input, emitting a done marker, and closing cleanly.
- Added `pnpm verify:terminal:ai-cli-boundary`.
- Upgraded `interactive-ai-cli-sidecar-boundary` scoring so static code signals alone no longer earn full credit; the fresh runtime artifact is now required.
- Added right-rail advisor visibility for AI CLI terminal provenance:
  - healthy interactive CLI sessions expose a `Verify CLI path` observe action;
  - native PTY fallback escalates to `Fix CLI fallback` as an unhealthy right-rail action instead of silently blending into normal running state.
- Passed the interactive backend provenance from live sessions into the right-rail advisor.
- Updated right-rail edge smoke to refresh `.codex-auto/visual/right-rail-next-action-qa.png` so the freshness gate follows advisor changes.

Validation:

- `cargo build --manifest-path src-tauri\pty-server\Cargo.toml --release`
- `pnpm verify:terminal:ai-cli-boundary`
- `pnpm vitest run src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check scripts\verify-interactive-ai-cli-boundary.mjs scripts\score-release-quality.mjs src\shared\lib\rightRailAdvisor.ts src\__tests__\rightRailAdvisor.test.ts src\App.tsx`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail-edge`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/interactive-ai-cli-boundary.json` reports `ok=true` with Codex, Claude, and Gemini shim entries all showing `streamReceivedMarker=true`, `inputRoundtrip=true`, `doneVisible=true`, and `closed=true`.
- `pnpm verify:quality-score` reports `164/164`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- Deterministic CLI shims now prove the sidecar/native command-session plumbing, but they are not a substitute for real authenticated Codex/Claude/Gemini CLI behavior. The remaining edge evidence should cover real CLI prompt framing, Japanese IME composition position, text/image clipboard, and multi-hour telemetry under actual CLI binaries.

### Phase 2.00 - Real AI CLI Binary Probe and Windows Launcher Hygiene

Status: done

Implemented:

- Added `scripts/verify-real-ai-cli-binary-probe.mjs`, a real-binary sidecar probe that runs `codex --version`, `claude --version`, and `gemini --version` inside a PTY sidecar without sending prompts or spending model tokens.
- Added `pnpm verify:terminal:real-ai-cli`.
- The probe records PATH discovery, selected launcher, PTY id, command-session capability, command-not-found classification, output sample, and per-CLI pass/fail status in `.codex-auto/production-smoke/real-ai-cli-binary-probe.json`.
- The first strict run caught a real Windows launcher issue: `claude.cmd --version` failed while `claude.exe --version` worked.
- Fixed Rust AI CLI launcher resolution in `platform_cli_program`:
  - PATH directory order is now respected first;
  - within each PATH directory, `.exe` is preferred over `.cmd`, then `.bat`;
  - this prevents a broken npm shim from masking a healthy native CLI binary earlier on PATH.
- Added a Windows regression test for PATH-order and exe-before-cmd behavior.
- Added `real-ai-cli-binary-probe` to `pnpm verify:quality-score`, raising the scored surface to `170` max points.

Validation:

- `pnpm verify:terminal:real-ai-cli`
- `cargo test --manifest-path src-tauri\Cargo.toml windows_cli_resolution_respects_path_order_and_prefers_exe_within_directory -- --nocapture`
- `pnpm exec biome check scripts\verify-real-ai-cli-binary-probe.mjs scripts\score-release-quality.mjs package.json`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/real-ai-cli-binary-probe.json` reports `ok=true`, `status=pass`, and `passCount=3`.
- Real versions observed through sidecar PTY:
  - Codex: `codex-cli 0.130.0`
  - Claude: `2.1.142 (Claude Code)`
  - Gemini: `0.42.0`
- `pnpm verify:quality-score` reports `170/170`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- Real CLI binaries are now proven launchable through the sidecar PTY, but this is still non-interactive version-output evidence. The next edge gap is authenticated interactive behavior: prompt framing, Japanese IME candidate placement, text/image clipboard, pane split/reconnect, and long-running telemetry while real Codex/Claude/Gemini sessions are active.

### Phase 2.01 - AI CLI Launch Planner and Right Rail Launch Gate

Status: done

Implemented:

- Added `src/shared/lib/aiCliLaunchPlanner.ts`, a pure launch-planning contract that turns real CLI probe evidence and live interactive-session provenance into a provider/backend/role launch decision.
- The planner now refuses false confidence:
  - fresh Codex/Claude/Gemini real-binary sidecar evidence produces `ready`;
  - stale or partial proof becomes `degraded`;
  - native fallback, missing command-session capability, or pending human gates become `blocked`;
  - missing probe evidence is never treated as release-grade launch confidence.
- Added `plan-cli-launch` as a first-class right-rail action.
  - Ready plans open Toolkit with `Plan AI launch`.
  - Blocked plans route to Health with `Fix launch gate` instead of hiding sidecar/native fallback risk.
- Wired the App shell to derive the launch plan from current interactive sessions, selected pane role, changed-file pressure, and decision gates.
- Added `ai-cli-launch-planner` to `pnpm verify:quality-score`, raising the scored surface to `176` max points.

Validation:

- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\shared\lib\rightRailAdvisor.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts src\App.tsx scripts\score-release-quality.mjs`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail-edge`
- `pnpm verify:terminal:real-ai-cli`
- `pnpm verify:quality-score`

Result:

- Launch Planner unit coverage passes, including fresh proof, broken preferred launcher, native fallback block, and missing-probe degraded paths.
- Fresh right-rail browser evidence was regenerated after the advisor changes.
- `pnpm verify:quality-score` reports `176/176`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- The launch planner now makes the launch decision explicit, but real authenticated interactive behavior is still the next hard edge: prompt framing, Japanese IME candidate placement, text/image clipboard, pane split/reconnect, and long-running telemetry while real Codex/Claude/Gemini sessions are active.

### Phase 2.02 - Launch Contract Trace and Audit Payload

Status: done

Implemented:

- Extended `AiCliLaunchPlan` with a deterministic `AiCliLaunchTrace` contract:
  - schema version and kind;
  - recommended provider, role, backend, launcher, and observed version;
  - provider matrix for Codex/Claude/Gemini;
  - checks, warnings, guardrail text, and expected artifacts.
- Added `auditPayload` support to right-rail actions.
- `plan-cli-launch` now carries `aiCliLaunchTrace` into the right-rail audit event payload, so the run trace can reconstruct why a launch was considered ready, degraded, or blocked.
- Hardened the quality score gate so `ai-cli-launch-planner` requires the trace contract, right-rail audit payload wiring, and unit coverage for selected launcher/provenance.

Validation:

- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\shared\lib\rightRailAdvisor.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts src\App.tsx scripts\score-release-quality.mjs`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail-edge`

Result:

- Launch Planner traces now include the selected launcher (`codex.cmd`, `claude.exe`, or `gemini.cmd`) and provider matrix instead of only UI copy.
- Right-rail action tests assert that `plan-cli-launch` carries `aiCliLaunchTrace` into the audit payload.

Residual:

- Launch decisions are now reconstructable from the right-rail audit payload. The remaining product edge is still actual real-session proof after launch: authenticated CLI prompt framing, Japanese IME candidate placement, text/image clipboard, split/reconnect, and long-running telemetry while the real CLIs are active.

### Phase 2.03 - Right Rail Audit Payload Contract

Status: done

Implemented:

- Added `buildRightRailActionAuditPayload` to `rightRailAdvisor.ts`.
- Moved right-rail audit payload assembly out of `App.tsx` and into a pure, testable contract.
- Added unit coverage proving `plan-cli-launch` preserves `aiCliLaunchTrace` inside the audit payload with provider, launcher, version, mode transition, operation, and execution status.
- Hardened the quality score gate so Launch Planner credit now requires:
  - `AiCliLaunchTrace`;
  - right-rail `aiCliLaunchTrace` propagation;
  - pure audit payload builder;
  - App using the builder instead of reassembling payload fields inline.

Validation:

- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit`
- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\shared\lib\rightRailAdvisor.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts src\App.tsx scripts\score-release-quality.mjs`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail-edge`

Result:

- Right-rail launch planning is now both actionable and audit-stable: the displayed action, the selected target, and the launch trace share one tested payload contract.

Residual:

- The launch/audit side is stronger, but the next proof still needs live authenticated CLI behavior under real terminal stress: IME candidate geometry, text/image clipboard, split/reconnect, and long-running session health while Codex/Claude/Gemini are actually active.

### Phase 2.04 - Real Probe Launch Planner Runtime Smoke

Status: done

Implemented:

- Added `scripts/verify-ai-cli-launch-planner.mjs`.
- Added `pnpm verify:terminal:ai-cli-launch-planner`.
- The smoke transpiles the real `src/shared/lib/aiCliLaunchPlanner.ts` source, imports `deriveAiCliLaunchPlan`, and feeds it the current `.codex-auto/production-smoke/real-ai-cli-binary-probe.json`.
- The generated artifact proves:
  - planner source loaded;
  - real CLI probe is a fresh 3-provider pass;
  - the plan is `ready` on `sidecar-command-session`;
  - `AiCliLaunchTrace` is complete;
  - provider matrix includes ready Claude, Codex, and Gemini entries with launchers and versions.
- Upgraded `ai-cli-launch-planner` in `pnpm verify:quality-score` from 6 to 8 points and made the fresh runtime smoke artifact a release gate.

Validation:

- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm exec biome check scripts\verify-ai-cli-launch-planner.mjs scripts\score-release-quality.mjs package.json`
- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/ai-cli-launch-planner.json` reports `ok=true`.
- Runtime trace selected `claude.exe` with version `2.1.142 (Claude Code)`.
- Provider matrix:
  - Claude: `claude.exe`, `2.1.142 (Claude Code)`;
  - Codex: `codex.cmd`, `codex-cli 0.130.0`;
  - Gemini: `gemini.cmd`, `0.42.0`.
- `pnpm verify:quality-score` reports `178/178`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- Launch Planner is now proven from real CLI binary evidence, but this still stops before sending an authenticated interactive prompt. The remaining hard proof is real-session behavior after launch: IME candidate placement, text/image clipboard, pane split/reconnect, prompt framing, and long-running telemetry while Codex/Claude/Gemini are active.

### Phase 2.05 - Launch Planner Terminal Preflight Gates

Status: done

Implemented:

- Extended `AiCliLaunchPlan` with terminal preflight evidence and `preflightChecks`.
- Added four release-grade preflight gates before a Launch Planner run can be treated as ready when `requirePreflight` is enabled:
  - native Japanese IME host and candidate geometry;
  - native text clipboard/paste path;
  - process restart reconnect for base and split panes;
  - Codex/Claude/Gemini interactive input roundtrip through `sidecar-command-session`.
- `deriveAiCliLaunchPlan()` now blocks a launch plan when required preflight proof is missing, even if real CLI binaries are installed and version probes pass.
- `scripts/verify-ai-cli-launch-planner.mjs` now consumes the real native-input, IME, process-reconnect, and interactive-AI-CLI-boundary artifacts in addition to the real binary probe.
- Hardened `pnpm verify:quality-score` so the AI CLI Launch Planner category requires the preflight trace, exact artifact provenance, and all four ready checks.

Validation:

- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\__tests__\aiCliLaunchPlanner.test.ts scripts\verify-ai-cli-launch-planner.mjs scripts\score-release-quality.mjs package.json`
- `node --check scripts\verify-ai-cli-launch-planner.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/ai-cli-launch-planner.json` reports `ok=true` and `preflightReady=true`.
- Runtime launch trace now includes ready preflight checks for `native-ime`, `clipboard-text`, `process-reconnect`, and `interactive-cli-boundary`.
- `pnpm verify:quality-score` reports `180/180`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- This closes the false-ready gap before launch, but it is still a preflight/provenance gate. The next edge proof should cover real authenticated prompts after launch: prompt framing, Japanese IME candidate placement during actual Codex/Claude sessions, image clipboard behavior, and longer-running telemetry while real paid CLI sessions are active.

### Phase 2.06 - Pre-Prompt Launch Contract Gate

Status: done

Implemented:

- Added `AiCliLaunchPromptContract` and `promptContractChecks` to the Launch Planner trace.
- Added a required prompt contract gate for audited launches:
  - objective;
  - context summary;
  - expected output;
  - done criteria;
  - guardrails.
- `deriveAiCliLaunchPlan()` now blocks required prompt execution when the contract is incomplete, even when all real CLI binary and terminal preflight evidence is ready.
- `scripts/verify-ai-cli-launch-planner.mjs` now feeds a deterministic pre-prompt contract into the runtime smoke and fails if the prompt contract checks are not all ready.
- Hardened `pnpm verify:quality-score` so Launch Planner credit requires source, unit coverage, runtime trace, terminal preflight, and pre-prompt contract proof.

Validation:

- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\__tests__\aiCliLaunchPlanner.test.ts scripts\verify-ai-cli-launch-planner.mjs scripts\score-release-quality.mjs package.json`
- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `node --check scripts\verify-ai-cli-launch-planner.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:quality-score`

Result:

- Launch Planner unit coverage now passes `33` tests across the planner and right-rail advisor.
- `.codex-auto/production-smoke/ai-cli-launch-planner.json` reports ready `promptContractChecks`.
- `pnpm verify:quality-score` reports `182/182`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- This prevents blind prompt sending from being called release-grade. The remaining hard edge is still real authenticated post-launch evidence: actual Codex/Claude/Gemini prompt framing, Japanese IME candidate behavior inside real sessions, image clipboard behavior, cancellation/retry, and longer-running telemetry.

### Phase 2.07 - Right Rail Audit Contract Test Drift Repair

Status: done

Implemented:

- Ran the broader `AppSilentBugs` static contract suite after the Launch Planner hardening.
- Found a stale assertion that still expected right-rail audit evidence assembly to live inline in `App.tsx`.
- Updated the contract test to match the current architecture:
  - `App.tsx` must call `buildRightRailActionAuditPayload(action, previousMode)`;
  - `rightRailAdvisor.ts` must preserve `evidence: action.execution.evidence`;
  - `rightRailAdvisor.ts` must preserve `target: action.target`.
- This keeps the test guarding the actual product boundary instead of a deleted implementation detail.

Validation:

- `pnpm exec biome check src\__tests__\AppSilentBugs.test.ts src\shared\lib\aiCliLaunchPlanner.ts src\__tests__\aiCliLaunchPlanner.test.ts scripts\verify-ai-cli-launch-planner.mjs scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:quality-score`

Result:

- The broadened focused suite reports `51` passing tests across App static contracts, Launch Planner, and right-rail advisor.
- `pnpm verify:quality-score` remains `182/182`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- This repairs a stale test boundary. It does not replace the remaining post-launch real-session soak for authenticated AI CLI behavior.

### Phase 2.08 - Live AI CLI Post-Launch Chaos Gate

Status: done

Implemented:

- Added `pnpm verify:terminal:ai-cli-post-launch-chaos` for the existing live Tauri/WebView2 PTY and AI CLI chaos smoke.
- Added a `live-ai-cli-post-launch-chaos` category to `pnpm verify:quality-score`.
- The score now requires fresh post-launch chaos evidence after the current app, sidecar, interactive command, and launch-planner sources:
  - Tauri/WebView2 runtime attached;
  - local storage clear/reload recovers the app;
  - PTY force restart remains visible and healthy;
  - AI CLI interactive session spawn/kill cleanup passes;
  - no interactive session remains after cleanup.
- The previous `.codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json` artifact is no longer accepted as current proof because it predates the latest app and launch-planner changes.

Validation:

- `pnpm exec biome check scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:quality-score`

Result:

- The focused suite now reports `52` passing tests across App static contracts, Launch Planner, and right-rail advisor.
- `pnpm verify:quality-score` now reports `182/192`, grade `A`, `releaseCandidateReady=false`.
- The remaining blocker is explicit: `live AI CLI post-launch chaos artifact is missing, stale, or not passing`.

Residual:

- A fresh native Tauri/WebView2 run with CDP must execute `pnpm verify:terminal:ai-cli-post-launch-chaos` before this score can return to release-candidate ready.
- This gate still proves spawn/kill/recovery behavior, not a paid prompt response. The next stricter layer should add an opt-in, cost-aware authenticated prompt-framing smoke that records provider, prompt contract, cancellation/retry, IME geometry, clipboard behavior, and cleanup without hiding token spend.

### Phase 2.09 - Fresh Post-Launch Chaos Pass and Dev Sidecar Hygiene

Status: done

Implemented:

- Re-ran the live Tauri/WebView2 post-launch chaos gate against a fresh dev runtime.
- The first fresh run exposed a real dev-environment regression: AI CLI session spawn failed with `PTY server command spawn failed: 404 Not Found`.
- Root cause: `tauri:dev` launched the stale sibling `src-tauri/target/debug/aether-pty-server.exe`, which did not expose the current `/commands` route.
- Added `scripts/build-pty-sidecar-dev.mjs` to build `src-tauri/pty-server/Cargo.toml` and copy the debug sidecar next to `target/debug/Aether.exe`.
- Updated `pnpm tauri:dev` to prepare the dev PTY sidecar before launching Tauri, preventing stale sidecar APIs from silently breaking interactive AI CLI launch.
- Decoupled the live chaos smoke from the old longrun dashboard URL. Dashboard state is now recorded when available, but an unavailable historical dashboard no longer invalidates the live Aether runtime chaos proof.

Validation:

- `pnpm exec biome check scripts\build-pty-sidecar-dev.mjs package.json src\__tests__\AppSilentBugs.test.ts scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `node --check scripts\build-pty-sidecar-dev.mjs`
- `node --check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node scripts\build-pty-sidecar-dev.mjs`
- `pnpm tauri:dev` with WebView2 CDP on `127.0.0.1:9222`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:quality-score`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`

Result:

- `.codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json` now reports `status=pass`.
- The chaos artifact proves:
  - Tauri/WebView2 attached through CDP;
  - localStorage clear/reload recovered the app;
  - PTY force restart stayed visible and healthy;
  - AI CLI interactive session spawned;
  - close/cleanup marked the session done and left `remainingSessionsAfterCleanup=0`.
- `pnpm verify:quality-score` reports `192/192`, grade `S`, `legacy release-ready state`, blockers `[]`.

Residual:

- The post-launch chaos gate now proves AI CLI spawn/kill/recovery, but it deliberately avoids spending model tokens. The next stricter confidence layer remains an opt-in authenticated prompt-framing smoke with explicit cost consent and evidence for IME geometry, clipboard behavior, cancellation/retry, and cleanup under a real prompt.

### Phase 2.10 - Opt-In Authenticated Prompt Smoke Gate

Status: done

Implemented:

- Added `scripts/verify-authenticated-ai-cli-prompt-smoke.mjs`.
- Added `pnpm verify:terminal:authenticated-ai-cli-prompt`.
- The verifier refuses to launch a real AI CLI prompt unless `QUORUM_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS` is set.
- Without consent it writes `.codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json` with `status=requires_opt_in`, `wouldSpendTokens=true`, and the required env var.
- With consent it is prepared to:
  - attach to the live Tauri/WebView2 runtime through CDP;
  - call `spawn_interactive_agent` with an explicit prompt contract marker;
  - require sidecar backend;
  - wait for the expected prompt marker in the terminal grid;
  - stop the interactive session and verify cleanup.
- Added `authenticated-ai-cli-prompt-smoke` to `pnpm verify:quality-score`, raising the scored surface to `202` max points.
- Added static coverage so the script cannot regress into silent token spend or disappear from package scripts.

Validation:

- `pnpm exec biome check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:quality-score`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Result:

- The no-consent run did not send a prompt and wrote `status=requires_opt_in`.
- `pnpm verify:quality-score` now reports `192/202`, grade `A`, `releaseCandidateReady=false`.
- The explicit blocker is `authenticated AI CLI prompt smoke requires explicit token-spend consent`.

Residual:

- Clearing this blocker requires an explicit token-spend opt-in run. Until then, Aether should not claim full post-launch authenticated prompt confidence, even though non-token-spending launch, sidecar, recovery, IME, reconnect, and command evidence gates are green.

### Phase 2.11 - Auth Prompt Consent Readiness and Blocker Precision

Status: done

Implemented:

- Tightened the opt-in authenticated prompt smoke artifact for the no-consent path.
- The no-consent artifact now records `tokenSpendingExecutionBlocked=true`, `safeNoPromptSent=true`, `consentPacketReady=true`, and `runtimeReadiness=not_checked_without_token_spend_consent`.
- Added a structured `nextCommand` payload to the artifact so the eventual token-spending run has an explicit command and env contract.
- Refined `pnpm verify:quality-score` so `status=requires_opt_in` is not treated like a failed sidecar, marker, or cleanup run.
- The release score now reports exactly one blocker for this gate before consent: `authenticated AI CLI prompt smoke requires explicit token-spend consent`.

Validation:

- `pnpm exec biome check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json` proves no prompt was sent without explicit token-spend consent.
- `.codex-auto/quality/release-quality-score.json` reports `192/202`, grade `A`, `releaseCandidateReady=false`.
- The only quality blocker is the intentionally unrun authenticated prompt smoke that requires explicit token-spend consent.

Residual:

- The remaining confidence gap is not a known implementation failure; it is an intentionally blocked token-spending production smoke. Once explicitly authorized, run the authenticated prompt smoke and refresh the score.

### Phase 2.12 - No-Token Auth Prompt Preflight

Status: done

Implemented:

- Extended the no-consent authenticated prompt smoke to read existing non-token artifacts before declaring the opt-in packet ready.
- The no-consent artifact now checks the selected provider against:
  - real AI CLI binary probe;
  - sidecar command-session boundary;
  - native input host;
  - live IME smoke;
  - live post-launch AI CLI chaos and cleanup.
- Added `nonTokenPreflightReady` and a `nonTokenPreflight` evidence block with artifact paths, freshness, ages, and parse errors.
- The artifact no longer implies live prompt readiness without proof. It reports `preflight_artifacts_green_without_prompt` only when the prerequisite non-token evidence is fresh and passing.
- Updated the release score so an opt-in blocker can still surface a second blocker if the no-token preflight artifacts become stale or incomplete.

Validation:

- `pnpm exec biome check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:quality-score`

Result:

- The current no-consent artifact reports `nonTokenPreflightReady=true` and `runtimeReadiness=preflight_artifacts_green_without_prompt`.
- `pnpm verify:quality-score` remains `192/202`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- The next confidence layer still requires deliberate token-spend authorization, because only a real authenticated prompt can prove end-to-end marker output under a live provider response.

### Phase 2.13 - Launch-Time Context Pack Contract

Status: done

Implemented:

- Upgraded the AI CLI Launch Planner context requirement from a plain text summary into a machine-readable context pack contract.
- Added `AiCliLaunchContextPackContract` and `AiCliLaunchContextPackTrace`.
- Prompt contract validation now blocks launch when a context summary exists but the machine-readable pack is missing.
- The launch trace now records context pack identity, source, summary, generation time, include count, exclusion count, changed-file count, and redaction count.
- The planner expected artifacts now require `machine-readable context pack trace with inclusion, exclusion, redaction, and changed-file counts`.
- `scripts/verify-ai-cli-launch-planner.mjs` now supplies and verifies a non-token context pack contract.
- `pnpm verify:quality-score` now fails the launch planner gate if the runtime smoke does not prove `contextPackReady=true`.

Validation:

- `pnpm exec biome check src\shared\lib\aiCliLaunchPlanner.ts src\__tests__\aiCliLaunchPlanner.test.ts scripts\verify-ai-cli-launch-planner.mjs scripts\score-release-quality.mjs`
- `node --check scripts\verify-ai-cli-launch-planner.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\aiCliLaunchPlanner.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`

Result:

- `.codex-auto/production-smoke/ai-cli-launch-planner.json` now reports `contextPackReady=true`.
- The launch trace includes `launch-planner-smoke-context` with include/exclude/redaction/changed-file counts.

Residual:

- Context packs are now launch-plan truth, but the actual token-spending authenticated prompt smoke remains intentionally blocked until explicit consent.

### Phase 2.14 - Live Chaos Prompt-Ready Guard and Clean QA URL

Status: done

Implemented:

- Reran `pnpm verify:quality-score` after the Launch Planner context-pack change and correctly caught the post-launch chaos artifact as stale.
- The first rerun exposed a real flake: `spawn_terminal` could accept a write before PowerShell was ready, causing the sentinel to disappear.
- Added `waitForPowerShellReady()` to the live chaos smoke before both the initial write and the post-restart write.
- The rerun then exposed a dev runtime crash with `STATUS_HEAP_CORRUPTION`; the smoke was still carrying a stale `edgeLoop` URL parameter from the browser state.
- Hardened `withChaosQaParams()` to delete `state`, `edgeLoop`, and `dashboardState`, and to set `v=live-pty-ai-cli-chaos`.
- Restarted the dev runtime cleanly with `QUORUM_API_TOKEN=dev`, reran the smoke, and confirmed fresh pass.

Validation:

- `pnpm exec biome check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `node --check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:quality-score`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`

Result:

- `.codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json` reports `status=pass`.
- The artifact now proves PowerShell readiness before write, readiness again after force restart, AI CLI spawn/kill cleanup, and `remainingSessionsAfterCleanup=0`.
- `.codex-auto/quality/release-quality-score.json` reports `192/202`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker is explicit token-spend consent for the authenticated prompt smoke.

Residual:

- The heap-corruption crash did not reproduce after removing stale QA URL state and starting the dev runtime cleanly with the intended token. Keep this smoke as the regression guard; any future `STATUS_HEAP_CORRUPTION` during pane/terminal chaos should be treated as P0.

### Phase 2.15 - Chaos Artifact Contract For Stale URL And Prompt Readiness

Status: done

Implemented:

- Promoted the live chaos smoke's stale-state cleanup from an implementation detail to a scored artifact contract.
- `scripts/verify-live-tauri-pty-ai-cli-chaos.mjs` now builds the chaos URL from the page origin/path instead of preserving existing query parameters.
- The smoke explicitly treats `state`, `edgeLoop`, and `dashboardState` as stale QA parameters.
- The smoke now records and checks `cleanChaosQaUrl=true`.
- The smoke now records and checks `ptyPromptReadyBeforeWrite=true` and `ptyPromptReadyAfterRestart=true`.
- `scripts/score-release-quality.mjs` now fails `live-ai-cli-post-launch-chaos` when:
  - the artifact URL still contains stale QA state;
  - the smoke does not prove shell readiness before terminal writes;
  - the smoke does not prove shell readiness again after force restart.
- Added static regression coverage in `AppSilentBugs.test.ts` for the clean URL and prompt-readiness contract.

Validation:

- `pnpm exec biome check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `node --check scripts\verify-live-tauri-pty-ai-cli-chaos.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm verify:quality-score` before rerun, confirming stale/old artifact correctly failed the new contract
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:quality-score`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\aiCliLaunchPlanner.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Result:

- `.codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json` now reports:
  - `cleanChaosQaUrl=true`;
  - `ptyPromptReadyBeforeWrite=true`;
  - `ptyPromptReadyAfterRestart=true`;
  - `status=pass`;
  - AI CLI cleanup pass with `remainingSessionsAfterCleanup=0`.
- `.codex-auto/quality/release-quality-score.json` reports `192/202`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- This closes the non-token stale URL / terminal readiness regression path. The authenticated prompt smoke remains intentionally blocked until the user explicitly authorizes token spend.

### Phase 2.16 - Theme Customization Release Gate

Status: done

Implemented:

- Promoted per-preset material and wallpaper customization from UI/test coverage into the release quality score.
- Added a scored `theme-customization-guard` contract covering:
  - centralized material defaults for every mood preset;
  - Sakura material sanitization and mood light/dark classification;
  - explicit clearing of stale mood CSS tokens during preset switches;
  - per-mood material and wallpaper store persistence;
  - Settings controls for image picker, opacity, scale, and placement;
  - save/load wiring for window opacity, palette overrides, material overrides, and wallpaper settings;
  - Rust config round-trip coverage for `mood_material_overrides` and `wallpaper_settings_by_mood`;
  - regression tests for Sakura bleed, white-peach rails, low-opacity material, wallpaper placement, and preset contrast.
- Added static regression coverage so the quality score cannot silently drop the customization gate.

Validation:

- `pnpm exec biome check scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `node --check scripts\score-release-quality.mjs`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\themePalette.test.ts src\__tests__\useThemeApplier.test.tsx src\__tests__\SettingsSaveMerge.test.tsx src\__tests__\designTokenUsage.test.ts src\__tests__\appStore.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- `theme-customization-guard` reports `12/12 customization contracts pass`.
- `.codex-auto/quality/release-quality-score.json` reports `204/214`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- This phase guards preset isolation and customization regressions without requiring a slow distribution rebuild.
- The next non-token hardening target is to keep expanding runtime evidence around native terminal interactions and right-rail decision usefulness; the authenticated prompt smoke remains blocked by explicit consent.

### Phase 2.17 - Right Rail Run-Loop Phase Labels

Status: done

Implemented:

- Added a visible command-center run-loop phase chip to every ranked right-rail action.
- The action stack now labels next actions as `Plan`, `Run`, `Observe`, `Route`, `Review`, `Preserve`, or `Recover`.
- This makes the rail's purpose clearer: the user can see whether a recommendation is about launch planning, running work, observing health, routing decisions, reviewing changes, preserving context, or recovering a blocked session.
- Added static regression coverage for the phase map and Sakura-aware phase chip styling.

Validation:

- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:terminal:command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:quality-score`

Result:

- The first quality-score run after the App change correctly failed stale App-dependent evidence. This was expected and proved the gate is strict.
- Refreshed command evidence, right-rail command evidence, and live AI CLI chaos artifacts.
- `.codex-auto/quality/release-quality-score.json` is back to `204/214`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- Right-rail phase labeling improves comprehension, but the bigger product edge still needs more real end-to-end scenarios: agent run -> changed file -> provenance -> review -> final report -> handoff/recovery.

### Phase 2.18 - Non-Token Command Center Scenario Gate

Status: done

Implemented:

- Added `src/__tests__/commandCenterScenario.test.ts`.
- Added `scripts/verify-command-center-scenario.mjs`.
- Added `pnpm verify:command-center-scenario`.
- Added a scored `command-center-scenario` release-quality category.
- The scenario proves, without spending AI tokens:
  - sidecar-backed AI CLI launch planning with preflight and prompt-contract proof;
  - Command Center loop coverage across `Plan`, `Run`, `Observe`, `Route`, `Review`, `Preserve`, and `Recover`;
  - right-rail actions for launch planning, ready command, live tracking, CLI boundary, parallel run, topology, review queue, provenance trace, final report collection, handoff context, blocked recovery, approvals, and risk inspection;
  - workstation graph provenance from changed file to owner, worktree, terminal command block, prompt/scrollback anchors, and validation;
  - final report plus context-pack handoff readiness;
  - recovery actions with audit events and recovery steps;
  - complete right-rail audit payloads for every action.

Validation:

- `pnpm exec biome check scripts\score-release-quality.mjs scripts\verify-command-center-scenario.mjs src\__tests__\commandCenterScenario.test.ts src\__tests__\AppSilentBugs.test.ts package.json`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-command-center-scenario.mjs`
- `pnpm verify:command-center-scenario`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\commandCenterScenario.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\workstationGraph.test.ts src\__tests__\contextPack.test.ts src\__tests__\aiCliLaunchPlanner.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/command-center-scenario.json` reports `ok=true`.
- `command-center-scenario` reports `12/12`.
- `.codex-auto/quality/release-quality-score.json` reports `216/226`, grade `A`, `releaseCandidateReady=false`.
- The only current blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- This proves the Command Center loop deterministically without spending tokens. The next stricter layer is live dogfood proof that a real authenticated Codex/Claude/Gemini prompt can complete, emit a final report, preserve context, and clean up through the same evidence path after explicit token-spend consent.

### Phase 2.19 - Right Rail Final Goal Track

Status: done

Implemented:

- Added `src/shared/lib/rightRailGoalTrack.ts`.
- Added a right-rail `Final goal` card that surfaces:
  - total goal progress percentage;
  - milestone state for Terminal core, Command Center, Customization, and Release proof;
  - remaining blockers, including the explicit authenticated AI CLI prompt-smoke consent gate;
  - terminal fallback, human decision gates, and graph risk nodes as visible release blockers.
- Added Sakura-aware and state-aware styling for the goal track so the current goal and remaining work stay readable inside the right rail.
- Added `right-rail-goal-track` to the release quality score so this cannot regress into an invisible roadmap again.

Validation:

- `pnpm vitest run src\__tests__\rightRailGoalTrack.test.ts --reporter=dot`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailGoalTrack.test.ts --reporter=dot`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\shared\lib\rightRailGoalTrack.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- The right rail now answers "what is the goal, what is done, and what remains" directly in the product surface.
- `right-rail-goal-track` reports `10/10 goal-track contracts pass`.
- `.codex-auto/production-smoke/right-rail-command-evidence.json` proves the `Final goal` card is visible with the `Release proof` milestone and authenticated prompt-smoke blocker.
- `.codex-auto/quality/release-quality-score.json` reports `226/236`, grade `A`, `releaseCandidateReady=false`.
- The only expected blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- This improves roadmap visibility and release accountability. It does not replace the remaining live authenticated AI prompt proof, which still needs explicit consent before token-spending validation can run.

### Phase 2.20 - Release Quality Backed Goal Track

Status: done

Implemented:

- Added `src/shared/lib/releaseQuality.ts`.
- The right rail `Final goal` track no longer relies on a hardcoded authenticated prompt blocker.
- In Tauri runtime, `App.tsx` reads `.codex-auto/quality/release-quality-score.json` through the existing `read_file` command and derives:
  - terminal-core readiness;
  - Command Center scenario readiness;
  - customization readiness;
  - release blockers;
  - authenticated prompt-smoke consent state.
- Added parser tests proving:
  - the prompt-smoke blocker stays visible while consent is missing;
  - the blocker clears when the authenticated prompt-smoke score is actually proven;
  - missing score evidence becomes an explicit unavailable-proof blocker instead of silent success.
- Upgraded the `right-rail-goal-track` quality gate so App wiring, parser coverage, and browser-visible goal evidence are all required.

Validation:

- `pnpm vitest run src\__tests__\releaseQuality.test.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:quality-score`

Result:

- `right-rail-goal-track` reports `13/13 goal-track contracts pass`.
- `.codex-auto/quality/release-quality-score.json` reports `229/239`, grade `A`, `releaseCandidateReady=false`.
- The only blocker remains explicit token-spend consent for the authenticated prompt smoke.

Residual:

- The goal track now follows release-quality evidence in Tauri runtime. Browser-only visual QA still uses the conservative prompt-smoke blocker because it cannot read local release artifacts directly.

### Phase 2.21 - Release Quality Freshness and Source Proof

Status: done

Implemented:

- Extended `src/shared/lib/releaseQuality.ts` so release-quality evidence now carries a freshness status: `fresh`, `stale`, or `unavailable`.
- Stale or missing `.codex-auto/quality/release-quality-score.json` evidence now becomes an explicit release blocker instead of letting the right rail appear green from old data.
- Extended `src/shared/lib/rightRailGoalTrack.ts` and the right-rail `Final goal` card so the product shows the score source, grade, score age state, and evidence detail directly in the UI.
- Added Sakura-aware styling for the quality evidence source row so the proof remains readable in the right rail.
- Hardened `scripts/verify-right-rail-command-evidence.mjs` and `scripts/score-release-quality.mjs` so the browser smoke and release-quality score both require the visible source/freshness contract.
- Added tests proving stale evidence and unavailable evidence cannot silently pass.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\shared\lib\releaseQuality.ts src\shared\lib\rightRailGoalTrack.ts src\__tests__\releaseQuality.test.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs scripts\verify-right-rail-command-evidence.mjs`
- `pnpm vitest run src\__tests__\releaseQuality.test.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-right-rail-command-evidence.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:quality-score`

Result:

- The first score pass correctly detected stale browser and chaos evidence, dropping to `211/240`, grade `B`, before artifacts were refreshed.
- Refreshed non-token runtime evidence restored the score to `230/240`, grade `A`, `releaseCandidateReady=false`.
- `right-rail-goal-track` now reports `14/14 goal-track contracts pass`.
- The dev runtime used for validation was stopped and ports `1420` and `9222` had no remaining listeners afterward.
- The only current blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

Residual:

- This closes the stale-score blind spot for the goal track. The remaining release blocker is still the authenticated prompt smoke, which requires explicit consent because it spends real AI CLI tokens.

### Phase 2.22 - Authenticated Prompt Consent Packet Proof

Status: done

Implemented:

- Added `src/shared/lib/authenticatedPromptConsent.ts`.
- The right rail `Final goal` track now renders an authenticated prompt consent packet with:
  - provider;
  - command;
  - required consent environment variable;
  - non-token preflight readiness;
  - safe-no-prompt-sent proof.
- Missing or incomplete consent packet evidence is now an explicit release blocker instead of a hidden assumption.
- Added `scripts/verify-right-rail-goal-track-tauri.mjs` and `pnpm verify:right-rail-goal-track-tauri`.
- The Tauri smoke verifies the actual WebView can read local release-quality evidence and authenticated-prompt consent evidence, proving:
  - `Quality proof fresh`;
  - `Consent packet ready`;
  - the remaining blocker still names the authenticated AI CLI prompt smoke.
- Extended the release-quality score so the right-rail final goal track requires the consent packet parser, UI, browser fallback smoke, and Tauri local-proof smoke.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\shared\lib\authenticatedPromptConsent.ts src\shared\lib\rightRailGoalTrack.ts src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs scripts\verify-right-rail-command-evidence.mjs`
- `pnpm exec biome check --write package.json src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm vitest run src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-right-rail-command-evidence.mjs`
- `node --check scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting the verifier to stop before sending a prompt and write `requires_opt_in`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json` reports `status=requires_opt_in`, `safeNoPromptSent=true`, `consentPacketReady=true`, and `nonTokenPreflightReady=true`.
- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true`.
- `right-rail-goal-track` reports `18/18 goal-track contracts pass`.
- `.codex-auto/quality/release-quality-score.json` reports `234/244`, grade `A`, `releaseCandidateReady=false`.
- The dev runtime used for validation was stopped and ports `1420` and `9222` had no remaining listeners afterward.
- The only current blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

Residual:

- The product now proves the final token-spending gate is ready and safely blocked before consent. The remaining unproven release item is the actual authenticated prompt marker/cleanup proof, which still requires explicit token-spend consent.

### Phase 2.23 - Goal Track Risk Evidence Labels

Status: done

Implemented:

- Extended `src/shared/lib/rightRailGoalTrack.ts` with `RightRailGoalRiskSummary`.
- The right rail `Final goal` track no longer shows only a generic risk count. When graph risks or blockers are open, it now includes the first visible risk/blocker labels and a hidden-count suffix.
- `App.tsx` now derives risk summaries from the workstation graph and renders a compact `Goal risk evidence` list inside the goal track.
- Added Sakura-aware styling for the goal risk evidence list.
- Hardened browser and Tauri goal-track smokes so they fail if risk blockers are listed without visible risk evidence labels.
- Hardened the Tauri smoke wait loop so it waits for local quality evidence and consent packet evidence to hydrate instead of racing against `read_file`.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\shared\lib\rightRailGoalTrack.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs scripts\verify-right-rail-command-evidence.mjs scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm vitest run src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-right-rail-command-evidence.mjs`
- `node --check scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting `requires_opt_in`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true`.
- Tauri goal-track evidence now shows `Quality proof fresh`, `Consent packet ready`, and visible risk labels such as `right rail.qa missing diff.opened.blocked from right-rail`.
- `right-rail-goal-track` remains `18/18 goal-track contracts pass`.
- `.codex-auto/quality/release-quality-score.json` reports `234/244`, grade `A`, `releaseCandidateReady=false`.
- The dev runtime used for validation was stopped and ports `1420` and `9222` had no remaining listeners afterward.
- The only release-quality blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke.

Residual:

- Risk labels are now visible, but the underlying graph still contains QA audit risk nodes during visual QA runs. That is acceptable as a visible state; the next refinement would separate release-blocking risks from QA fixture risks in the graph model if the product should avoid treating fixture warnings as operational risk.

### Phase 2.24 - QA Fixture Risk Separation

Status: done

Implemented:

- Split Goal Track risks into release-blocking evidence and QA fixture evidence.
- `src/shared/lib/rightRailGoalTrack.ts` now keeps `riskEvidence` and `qaRiskEvidence` separate, so visual QA fixture warnings remain visible without lowering release confidence.
- `App.tsx` now identifies right-rail QA fixture risk labels/ids/status and excludes them from release-blocking graph risk summaries.
- The right rail renders release risks with `data-source="release"` and QA fixture risks with `data-source="qa-fixture"`.
- Browser and Tauri smoke scripts now fail if QA fixture risks leak back into release blockers.
- Release-quality scoring now checks source-level and artifact-level contracts for QA fixture separation.
- Release-quality blocker input is normalized so the authenticated AI CLI prompt consent blocker appears as one Goal Track action instead of duplicate score/UI rows.
- Browser, Tauri, and release-quality score contracts now fail if duplicate authenticated prompt blockers return.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\shared\lib\rightRailGoalTrack.ts src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts scripts\score-release-quality.mjs scripts\verify-right-rail-command-evidence.mjs scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm vitest run src\__tests__\rightRailGoalTrack.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm vitest run src\__tests__\rightRailGoalTrack.test.ts --reporter=dot`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-right-rail-command-evidence.mjs`
- `node --check scripts\verify-right-rail-goal-track-tauri.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting `requires_opt_in`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true`, `Quality proof fresh`, and `Consent packet ready`.
- Tauri Goal Track evidence reports no release risk labels and keeps QA fixture entries under `qaRiskEvidence`.
- The Goal Track remaining list no longer contains stale right-rail QA fixture blockers or duplicate authenticated prompt consent blockers.
- `right-rail-goal-track` reports `18/18 goal-track contracts pass`.
- `.codex-auto/quality/release-quality-score.json` reports `234/244`, grade `A`, `releaseCandidateReady=false`.
- The dev runtime used for validation was stopped and ports `1420` and `9222` had no remaining listeners afterward.

Residual:

- The only release-quality blocker remains explicit token-spend consent for the authenticated AI CLI prompt smoke. This is intentionally not auto-run without user approval because it would send a real authenticated prompt to an AI CLI provider.

### Phase 2.25 - Right Rail Scale And Action Coverage Contract

Status: done

Implemented:

- Added `src/__tests__/rightRailScaleContract.test.tsx`.
- Added `scripts/verify-right-rail-scale-contract.mjs` and `pnpm verify:right-rail-scale`.
- Extended `scripts/score-release-quality.mjs` with a `right-rail-scale-contract` category.
- The new contract proves the right rail is not just a decorative dashboard:
  - at least 12 real product states are covered by ranked top actions;
  - 15 distinct top actions are currently proven;
  - 20 live sessions collapse into a bounded action stack of 5 or fewer actions;
  - a 500-file review queue renders only the actionable first 6 rows and keeps the rest summarized.

Validation:

- `pnpm exec biome check --write package.json scripts\score-release-quality.mjs scripts\verify-right-rail-scale-contract.mjs src\__tests__\rightRailScaleContract.test.tsx`
- `node --check scripts\verify-right-rail-scale-contract.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm verify:right-rail-scale`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/performance/right-rail-scale-contract.json` reports `ok=true`.
- Action-state coverage reports `15` covered states and `15` distinct top actions.
- 20-session action derivation produced `3` ranked actions in less than the `120ms` contract.
- 500-file review queue render kept `6` visible rows, `494` summarized rows, and stayed under the `2500ms` contract.
- `.codex-auto/quality/release-quality-score.json` now reports `246/256`, grade `A`, `releaseCandidateReady=false`.

Residual:

- The scale contract strengthens the 200-point edge evidence, but it does not replace the remaining authenticated AI CLI prompt smoke. That blocker still requires explicit token-spend consent.

### Phase 2.26 - Command Recovery And No-Silent-Fallback Contract

Status: done

Implemented:

- Added `src/shared/lib/commandRecovery.ts`.
- Added `src/__tests__/commandRecoveryContract.test.ts`.
- Added `scripts/verify-command-recovery-contract.mjs` and `pnpm verify:command-recovery`.
- Extended `scripts/score-release-quality.mjs` with `command-recovery-contract`.
- The recovery contract turns a failed terminal command block into:
  - failed-command detection;
  - a same-pane/same-cwd retry plan;
  - a handoff prompt that preserves command, cwd, exit code, files, owner, and recovery hint;
  - right-rail recovery actions such as approvals, blocked-run recovery, risk inspection, provenance trace, and review queue;
  - audit payloads enriched with failed command id, exit code, correlation id, retry command, affected files, and recovery kind;
  - explicit `fallback-visible`, `stale-state-visible`, `manual-confirmation-required`, and `no-silent-retry` guards.
- Denied tool recovery is routed through `review-denial` instead of being silently retried.

Validation:

- `pnpm exec biome check --write package.json src\shared\lib\commandRecovery.ts src\__tests__\commandRecoveryContract.test.ts scripts\verify-command-recovery-contract.mjs scripts\score-release-quality.mjs`
- `node --check scripts\verify-command-recovery-contract.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec vitest run src\__tests__\commandRecoveryContract.test.ts --reporter=dot`
- `pnpm verify:command-recovery`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/command-recovery-contract.json` reports `ok=true`.
- Failed command recovery reports all checks green: failed command detected, recovery hint ready, retry ready, handoff ready, audit payloads ready, and no silent fallback.
- Recovery actions include `resolve-approvals`, `recover-attention`, `inspect-risk`, `trace-provenance`, and `review-queue`.
- Guard proof includes `fallback-visible` and `stale-state-visible`.
- Denied tool recovery reports `review-denial` with no silent retry.
- `.codex-auto/quality/release-quality-score.json` now reports `256/266`, grade `A`, `releaseCandidateReady=false`.

Residual:

- The recovery loop now proves failed-command recovery and no-silent-fallback behavior at the contract level. The remaining release-quality blocker is still explicit token-spend consent for the authenticated AI CLI prompt smoke.

### Phase 2.27 - Native Terminal Boundary Contract

Status: done

Implemented:

- Added `scripts/verify-native-boundary-contract.mjs` and `pnpm verify:terminal:native-boundary`.
- Extended `scripts/score-release-quality.mjs` with `native-boundary-contract`.
- Upgraded `src/features/terminal/pane-tree/PaneTreeContainer.tsx` so mux split/close/layout/swap/sync/zoom fallback paths emit fallback telemetry instead of staying console-only.
- The contract now proves:
  - no xterm dependency is shipped as the terminal core;
  - Rust owns terminal input commits through `native_terminal_input_commit`;
  - the WebView IME bridge is conditional while Tauri defaults to the native input surface;
  - terminal clipboard and paste are native-first and paste-guarded;
  - AI CLI sessions enter through the authenticated sidecar command-session boundary;
  - pane topology restores from Rust mux snapshots and all core pane operations route through mux IPC;
  - mux local recovery, fallback, and stale state are visible to telemetry and release gates;
  - the AI CLI launch planner refuses blind prompt-pasting until native input, clipboard, reconnect, and command-session preflight is ready.

Validation:

- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:ai-cli-boundary`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:terminal:native-boundary`
- `pnpm exec biome check --write package.json scripts\verify-native-boundary-contract.mjs scripts\score-release-quality.mjs src\features\terminal\pane-tree\PaneTreeContainer.tsx`
- `node --check scripts\verify-native-boundary-contract.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/quality/native-boundary-contract.json` reports `ok=true`, `status=pass`, and `11/11` checks passing.
- `.codex-auto/quality/release-quality-score.json` now reports `266/276`, grade `A`, `releaseCandidateReady=false`.

Residual:

- The Rust/native/sidecar/fallback boundary is now guarded by a release-score category. The remaining release-quality blocker is still explicit token-spend consent for the authenticated AI CLI prompt smoke; it is intentionally not auto-run without approval because it sends a real authenticated prompt to an AI CLI provider.

### Phase 2.28 - Final Goal Evidence Audit

Status: done

Implemented:

- Added `scripts/verify-final-goal-audit.mjs` and `pnpm verify:final-goal-audit`.
- Extended `scripts/score-release-quality.mjs` with `final-goal-evidence-map`.
- The final-goal audit maps the active objective to concrete evidence buckets:
  - Rust native terminal core;
  - Rust mux and daemon boundary;
  - right rail Command Center edge;
  - fallback and stale state visibility;
  - provenance, recovery, context packs, and final reports;
  - AI CLI launch planner and prompt contract;
  - customization and visual preset isolation;
  - release and operations proof.
- The audit intentionally does not mark the goal complete while the authenticated AI CLI prompt smoke still requires explicit token-spend consent.

Validation:

- `pnpm exec biome check --write package.json scripts\verify-final-goal-audit.mjs scripts\score-release-quality.mjs`
- `node --check scripts\verify-final-goal-audit.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec tsc --noEmit --pretty false`
- `git diff --check`

Result:

- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, `goalComplete=false`, and `status=blocked-by-explicit-consent`.
- The audit proves all eight non-token final-goal requirements.
- `.codex-auto/quality/release-quality-score.json` now reports `274/284`, grade `A`, `releaseCandidateReady=false`.

Residual:

- The only unresolved blocker remains `authenticated AI CLI prompt smoke requires explicit token-spend consent`. This is a real product/release blocker, not a missing implementation gate, and remains intentionally opt-in.

### Phase 2.29 - Goal Track Freshness And Self-Audit Guard

Status: done

Implemented:

- Tightened `scripts/verify-right-rail-goal-track-tauri.mjs` so the live Tauri/WebView2 Goal Track must render the exact current release-quality score detail, not merely any fresh-looking label.
- Updated `scripts/score-release-quality.mjs` so the right-rail Goal Track score refuses stale Tauri artifacts after verifier or scorer changes.
- Updated `src/shared/lib/rightRailGoalTrack.ts` so self-referential audit blockers such as `right-rail-goal-track` and `final-goal-evidence-map` do not hide the user-actionable authenticated prompt consent blocker.
- Added regression coverage in `src/__tests__/rightRailGoalTrack.test.ts` for stale-audit refresh states.
- Changed the Tauri Goal Track verifier to avoid closing the WebView2 browser after CDP attach. The script now writes the artifact and exits its own process, preventing the verifier from crashing the app while still avoiding a hung CDP event loop.

Validation:

- `pnpm exec biome check --write scripts\verify-right-rail-goal-track-tauri.mjs scripts\score-release-quality.mjs src\shared\lib\rightRailGoalTrack.ts src\__tests__\rightRailGoalTrack.test.ts`
- `node --check scripts\verify-right-rail-goal-track-tauri.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec vitest run src\__tests__\rightRailGoalTrack.test.ts --reporter=dot`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec tsc --noEmit --pretty false`

Result:

- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` and proves the live Goal Track renders `96% A · 274/284`.
- The live Goal Track remaining list shows only `Authenticated AI CLI prompt smoke still requires explicit token consent`.
- `.codex-auto/quality/release-quality-score.json` reports `274/284`, grade `A`, with `right-rail-goal-track` at `18/18`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only unresolved blocker remains `authenticated AI CLI prompt smoke requires explicit token-spend consent`.

### Phase 2.30 - Authenticated Prompt Preflight Hard Gate

Status: done

Implemented:

- Tightened `scripts/verify-authenticated-ai-cli-prompt-smoke.mjs` so the non-token preflight is evaluated before both non-consent and consented runs.
- A consented run now refuses to send a real AI CLI prompt when the real CLI binary, command-session boundary, native input host, IME proof, or post-launch chaos artifacts are stale or incomplete.
- A blocked consented run writes `status=preflight_blocked`, keeps `safeNoPromptSent=true`, and exits before token-spending execution.
- A passing consented run must now prove `nonTokenPreflightReady=true` and `preflightReadyBeforePrompt=true`.
- Tightened `scripts/score-release-quality.mjs` so an authenticated prompt pass is not accepted unless the green preflight was proven immediately before prompt execution.
- Added regression coverage in `src/__tests__/authenticatedPromptConsent.test.ts` for the consented-but-preflight-blocked state.

Validation:

- `pnpm exec biome check --write scripts\verify-authenticated-ai-cli-prompt-smoke.mjs scripts\score-release-quality.mjs src\__tests__\authenticatedPromptConsent.test.ts`
- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec vitest run src\__tests__\authenticatedPromptConsent.test.ts --reporter=dot`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expected exit code `2`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:final-goal-audit`
- `pnpm verify:quality-score`

Result:

- `.codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json` reports `status=requires_opt_in`, `safeNoPromptSent=true`, `tokenSpendingExecutionBlocked=true`, and `nonTokenPreflight.ready=true`.
- `.codex-auto/quality/release-quality-score.json` reports `274/284`, grade `A`, with the only blocker still isolated to explicit token-spend consent.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The final 10 points still require explicitly approved real authenticated AI CLI prompt execution.

### Phase 2.31 - Authenticated Prompt Guard Release Score

Status: done

Implemented:

- Added `authenticated-ai-cli-preflight-gate` to `scripts/score-release-quality.mjs`.
- The score now independently verifies that:
  - the authenticated prompt verifier exposes `preflight_blocked`;
  - consented execution cannot reach prompt send without `noTokenPreflight.ready`;
  - blocked consented execution exits before token-spending work;
  - both `preflightReadyBeforePrompt=false` and `preflightReadyBeforePrompt=true` paths are represented;
  - the consent parser tests cover the consented-but-preflight-blocked state;
  - the latest opt-in artifact proves `tokenSpendingExecutionBlocked=true`, `safeNoPromptSent=true`, and green non-token preflight.
- This turns the previous code-level hardening into a release-score gate rather than a best-effort implementation detail.

Validation:

- `pnpm exec biome check --write scripts\score-release-quality.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm verify:quality-score`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:final-goal-audit`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `git diff --check`

Result:

- `.codex-auto/quality/release-quality-score.json` reports `282/292`, grade `S`.
- `authenticated-ai-cli-preflight-gate` reports `8/8`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, `status=blocked-by-explicit-consent`.

Residual:

- The only remaining release blocker is still the real authenticated AI CLI prompt smoke, which requires explicit token-spend consent.

### Phase 2.32 - Final Goal Audit Requires Auth Preflight Gate

Status: done

Implemented:

- Tightened `scripts/verify-final-goal-audit.mjs` so the final-goal audit now requires `authenticated-ai-cli-preflight-gate` as part of:
  - `ai-cli-launch-planner`;
  - `release-operations-proof`.
- The final audit evidence for AI CLI launch planning now includes the authenticated prompt artifact alongside the launch planner and release score.
- The release operations proof now explicitly requires authenticated prompt preflight safety, not only release artifacts, risk register, and real OS soak.
- Tightened `scripts/score-release-quality.mjs` so `final-goal-evidence-map` requires the final-goal verifier source to mention `authenticated-ai-cli-preflight-gate`.

Validation:

- `pnpm exec biome check --write scripts\verify-final-goal-audit.mjs scripts\score-release-quality.mjs`
- `node --check scripts\verify-final-goal-audit.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `git diff --check`

Result:

- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` and proves the live Goal Track renders `97% S · 282/292`.
- `.codex-auto/quality/release-quality-score.json` reports `282/292`, grade `S`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.39 - Aetherctl Daemon And Scrollback Parity

Status: done

Implemented:

- Added `aetherctl search` with the alias `aetherctl scrollback-search` so daemon-owned scrollback can be queried from the CLI without depending on the React/WebView surface.
- Added URL-safe query construction and parser coverage for `--lines`, `--limit`, and `--case-sensitive`.
- Extended the live mux restore verifier so it now proves both `aetherctl daemon` contract parity and `aetherctl search` scrollback parity against the running daemon.
- Tightened the native boundary and release quality source contracts so daemon parity, scrollback search parity, and restart/restore policy coverage stay required evidence.
- Refreshed the right-rail Goal Track mutual proof with a strict non-bootstrap `pnpm verify:goal:safe` pass after live Tauri DOM verification.

Validation:

- `cargo fmt --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aetherctl`
- `pnpm verify:mux-live`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:terminal:real-ai-cli`
- `pnpm verify:terminal:ai-cli-boundary`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:terminal:authenticated-ai-cli-provider-guard`
- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:terminal:authenticated-ai-cli-consent-packet`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:tauri-runtime-hygiene`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm verify:goal:safe`

Result:

- `.codex-auto/quality/final-goal-safe-summary.json` reports `ok=true`, `bootstrapRightRailSemanticProof=false`, `proofArtifactPassCount=27/27`, and `provedRequirementCount=8/8`.
- `.codex-auto/quality/release-quality-score.json` reports `96% A · 321/335`, `releaseCandidateReady=false`.
- `.codex-auto/quality/final-goal-audit.json` reports `implementationFixableCount=0`, `policyBlockedCount=1`, `externalBlockedCount=1`, and `status=blocked-by-external-gates`.
- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` with the current score, final audit, safe gate, consent packet, and remaining blocker visible in the live Tauri Goal Track.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.38 - Startup Chrome Stability And Helper Log Hygiene

Status: done

Implemented:

- Moved Windows AppUserModelID setup to the start of `run()` before Tauri creates the window.
- Made direct HWND/DWM chrome mutation opt-in through `AETHER_EXPERIMENTAL_DWM_CHROME=1`; default startup now relies on Tauri `windowEffects` for stability.
- Silenced `taskkill`, `icacls`, and `attrib` helper stdout/stderr in the PTY sidecar path so token-file ACL hardening cannot leak localized/garbled helper output into dev/runtime logs.
- Extended `scripts/verify-tauri-runtime-hygiene.mjs` with `noHelperOutputLeaks` and active-log-run tracking, while still preserving previous crash evidence.
- Tightened release scoring and static regression coverage so direct DWM chrome cannot become an unconditional startup path again.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `pnpm exec biome check scripts\verify-tauri-runtime-hygiene.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts --formatter-enabled=false`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:ai-cli-boundary`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:terminal:recovered-command-evidence`
- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:terminal:process-reconnect-command-evidence`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:tauri-runtime-hygiene`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:terminal:authenticated-ai-cli-provider-guard`
- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `git diff --check`

Result:

- `.codex-auto/quality/tauri-runtime-hygiene.json` reports `noCrashMarkers=true`, `noHelperOutputLeaks=true`, closed dev/CDP ports, no workspace processes, and no stale pid files.
- `.codex-auto/quality/release-quality-score.json` reports `97% S · 298/308`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.37 - Authenticated Prompt Output Privacy

Status: done

Implemented:

- Hardened `scripts/verify-authenticated-ai-cli-prompt-smoke.mjs` so consented real AI CLI prompt verification no longer persists raw terminal output.
- Replaced `outputTail` with `outputEvidence`: privacy marker, character count, SHA-256 hash, and marker-presence boolean.
- Tightened `scripts/score-release-quality.mjs` so authenticated prompt scoring requires redacted output evidence and source-level proof that raw terminal output is not persisted.
- Added regression coverage in `src/__tests__/AppSilentBugs.test.ts`.

Validation:

- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.35 - Authenticated AI CLI Provider Preflight Matrix

Status: done

Implemented:

- Added `scripts/verify-authenticated-ai-cli-preflight-matrix.mjs`.
- Added `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`.
- The matrix proves no-token readiness for `codex`, `claude`, and `gemini` before any token-spending prompt is allowed:
  - real CLI binary launch evidence;
  - sidecar command-session boundary;
  - launch planner provider readiness;
  - native input host;
  - IME long Japanese preedit and LF paste checks;
  - post-launch chaos cleanup;
  - authenticated prompt consent artifact with `tokenSpendingExecutionBlocked=true` and `safeNoPromptSent=true`.
- Added `authenticated-ai-cli-preflight-matrix` to release quality scoring.
- Added the matrix artifact to final-goal `ai-cli-launch-planner` proof.

Validation:

- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:tauri-runtime-hygiene`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec biome check ... --formatter-enabled=false`

Result:

- `.codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json` reports `ok=true`, `allProvidersReady=true`, `tokenSpendingExecutionBlocked=true`, and `noPromptSent=true`.
- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` and live Goal Track detail `97% S · 298/308`.
- `.codex-auto/quality/release-quality-score.json` reports `298/308`, grade `S`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.34 - Tauri Runtime Hygiene Gate

Status: done

Implemented:

- Added `scripts/verify-tauri-runtime-hygiene.mjs` and `pnpm verify:tauri-runtime-hygiene`.
- The verifier now fails if the latest Tauri verification logs contain crash markers such as `STATUS_ACCESS_VIOLATION`, `STATUS_HEAP_CORRUPTION`, `0xc0000005`, or `0xc0000374`.
- The verifier also requires dev ports `1420` / `9222` to be closed, no workspace `Aether` / `aether-pty-server` processes to remain, and no stale dev pid file.
- Changed high-risk CDP verifiers to detach from WebView2 with `browser.disconnect()` rather than closing the attached host browser:
  - `verify-right-rail-goal-track-tauri.mjs`
  - `verify-live-tauri-pty-ai-cli-chaos.mjs`
  - `verify-live-tauri-workstation-surfaces.mjs`
  - `verify-performance-observatory.mjs`
  - `verify-tauri-dpi-settings.mjs`
- Added `tauri-runtime-hygiene` to release quality scoring and final-goal release operations proof.

Validation:

- `pnpm verify:terminal:ai-cli-post-launch-chaos`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:tauri-runtime-hygiene`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec biome check ... --formatter-enabled=false`
- `git diff --check`

Result:

- `.codex-auto/quality/tauri-runtime-hygiene.json` reports `ok=true`, `noCrashMarkers=true`, `portsClosed=true`, `workspaceProcessesClear=true`, and `noStalePidFiles=true`.
- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` and live Goal Track detail `97% S · 290/300`.
- `.codex-auto/quality/release-quality-score.json` reports `290/300`, grade `S`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.36 - Authenticated Prompt Explicit Provider Guard

Status: done

Implemented:

- Hardened `scripts/verify-authenticated-ai-cli-prompt-smoke.mjs` so token-spending execution now requires an explicit supported provider.
- A consented run with no `QUORUM_AUTH_PROMPT_PROVIDER` now writes `status=provider_required`, keeps `safeNoPromptSent=true`, and exits before CDP attach, session spawn, or prompt send.
- A consented run with an unsupported provider now writes `status=unsupported_provider` and also exits before token-spending work.
- Added `scripts/verify-authenticated-ai-cli-provider-guard.mjs` and `pnpm verify:terminal:authenticated-ai-cli-provider-guard` to prove the missing-provider path is blocked.
- Tightened `authenticated-ai-cli-preflight-gate` scoring so the provider-required guard artifact must be fresh and prove `tokenBlocked`, `noPromptSent`, and `noSessionSpawned`.

Validation:

- `pnpm verify:terminal:authenticated-ai-cli-provider-guard`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expecting exit code `2`
- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:tauri-runtime-hygiene`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec vitest run src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `git diff --check`

Result:

- `.codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json` reports `status=provider_required`, `guardVerifier.ok=true`, `tokenBlocked=true`, `noPromptSent=true`, and `noSessionSpawned=true`.
- `.codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json` reports all providers ready.
- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports live Goal Track detail `97% S · 298/308` with `codex`, `claude`, and `gemini` all ready.
- `.codex-auto/quality/release-quality-score.json` reports `97% S · 298/308`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.

### Phase 2.33 - Authenticated Prompt Cleanup And CDP Detach Proof

Status: done

Implemented:

- Hardened `scripts/verify-authenticated-ai-cli-prompt-smoke.mjs` so consented prompt execution captures a session baseline before spawn.
- Success cleanup now requires structured proof: stop attempted, list checked, spawned session absent, no new unexpected sessions, and no stop/list errors.
- Failure cleanup now attempts `stop_interactive_agent` and records `cleanupAfterFailure` instead of only setting `cleanupAttempted`.
- CDP shutdown now detaches from the attached WebView2 browser by default and only closes the host when `QUORUM_AUTH_PROMPT_CLOSE_BROWSER=1`.
- Tightened `scripts/score-release-quality.mjs` so authenticated prompt scoring requires fresh embedded non-token preflight artifacts and structured cleanup proof.
- Updated final-goal audit logic so it can reach `complete` after the authenticated prompt blocker is cleared, while still preserving the current `blocked-by-explicit-consent` release state.

Validation:

- `pnpm verify:terminal:authenticated-ai-cli-prompt` without consent, expected exit `2`
- `pnpm verify:right-rail-goal-track-tauri`
- `pnpm verify:quality-score`
- `pnpm verify:final-goal-audit`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\authenticatedPromptConsent.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `node --check scripts\verify-authenticated-ai-cli-prompt-smoke.mjs`
- `node --check scripts\score-release-quality.mjs`
- `node --check scripts\verify-final-goal-audit.mjs`
- `git diff --check`

Result:

- `.codex-auto/production-smoke/right-rail-goal-track-tauri.json` reports `ok=true` and live Goal Track detail `97% S · 282/292`.
- `.codex-auto/quality/release-quality-score.json` reports `282/292`, grade `S`.
- `.codex-auto/quality/final-goal-audit.json` reports `ok=true`, `evidenceComplete=true`, and `status=blocked-by-explicit-consent`.
- Verification Tauri/Vite/CDP ports were closed after the run.

Residual:

- The only remaining blocker is still explicit token-spend consent for the real authenticated AI CLI prompt smoke.
## 2026-05-22 Final Evidence Refresh

- Current release score evidence: `96/100`, `321/335`.
- `releaseCandidateReady=false`; final-goal audit status is `blocked-by-external-gates` until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` are both proven.
- Authenticated prompt execution remains gated by `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini` and explicit consent; the safe proof registry is `27/27`.

## 2026-05-24 Release Evidence Refresh

- Current hybrid release score evidence: `96/100`, `321/335`, `releaseCandidateReady=false`.
- Final-goal audit status is `blocked-by-external-gates` for the current Tauri/React plus Rust-core product boundary until real sleep/resume evidence and consented `authenticated-ai-cli-prompt-smoke` both pass.
- Full-native Rust is now tracked separately by `pnpm verify:full-native:audit` and `docs/history/FULL_NATIVE_RUST_FINAL_GOAL.md`.

## 2026-05-24 Full-Native Phase 2 Progress

- Added `aether-native present-loop-proof`.
- The native client proof now verifies a native Win32 window present loop that consumes the same daemon-backed `NativeRenderFrame`, presents multiple nonblank frames, and records `webviewUsed=false` / `reactUsed=false`.
- Added `aether-native gpu-render-proof`.
- The native client proof now verifies `wgpu` adapter/device creation, WGSL shader compilation, offscreen render pipeline execution, one draw submission, and `NativeRenderFrame` hash parity with `webviewUsed=false` / `reactUsed=false`.
- Refreshed live `native-hwnd-paste-live` evidence through WebView2 CDP and re-ran native input and native boundary gates.
- `pnpm verify:terminal:native-client` passes with `native-gpu-render-proof` and `native-gpu-render-frame-contract`.
- `pnpm verify:terminal:native-boundary` reports `14/14` passing.
- `pnpm verify:full-native:audit` reports `54/100`, `62/114`, `in-progress`.
- Remaining full-native blockers are visible `winit/wgpu` terminal surface, native IME dogfood, native settings/customization, native Command Center/right rail, accessibility, native visual QA, and React/WebView compatibility-only demotion.

## 2026-05-24 Full-Native Phase 2 Progress 2

- Added `aether-native winit-wgpu-proof`.
- Added a Windows native `winit` window connected to a `wgpu` swapchain.
- The native client proof now verifies `native-winit-wgpu-surface-proof` and `native-winit-wgpu-frame-contract`: same daemon session, same `NativeRenderFrame` hash, GPU-backed surface configuration, multiple presented frames, and no React/WebView.
- `pnpm verify:terminal:native-client` passes with the winit/wgpu surface proof.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` reports `58/100`, `66/114`, `in-progress`.
- Remaining full-native blockers are dirty-rect winit/wgpu terminal glyph rendering, native IME dogfood, native settings/customization, native Command Center/right rail, accessibility, native visual QA, and React/WebView compatibility-only demotion.

## 2026-05-24 Full-Native Phase 2 Progress 3

- Extended `aether-native winit-wgpu-proof` from surface-only proof to a dirty-rect terminal cell proof.
- The winit/wgpu renderer now consumes `NativeRenderFrame` cell rects, cursor position, and `NativeRenderFrameDiff` dirty rects as GPU instance data.
- The proof reports `glyphMode=cell-quad-proof`, `terminalGlyphQuads`, `cursorQuads`, `dirtyRectDogfood=true`, `dirtyRectsRendered`, `dirtyCells`, and `dirtyRows`.
- `pnpm verify:terminal:native-client` passes with `native-winit-wgpu-dirty-rect-cell-proof` and `native-winit-wgpu-cursor-cell-proof`.
- `pnpm verify:terminal:native-boundary` remains `14/14` passing.
- `pnpm verify:full-native:audit` reports `59/100`, `67/114`, `in-progress`.
- Remaining full-native blockers are font-atlas winit/wgpu terminal glyph rendering, native IME dogfood, native settings/customization, native Command Center/right rail, accessibility, native visual QA, and React/WebView compatibility-only demotion.

## 2026-05-25 Full-Native Mode Shell Progress

- Added `aether-native mode-shell-proof`.
- The new native shell contract makes the Clauge-style information architecture explicit in Rust: left mode rail, central work surface, and right contextual inspector.
- The contract exposes 8 fixed modes: Terminal, Agents, Workspace, Review, Git, Context, History, and Settings.
- Each mode now has a stable shortcut, Rust contract id, center surface id, inspector kind, primary action, and selected entity route.
- The contextual inspector is backed by the Rust Command Center contract and its counts are verified against the backing evidence/actions/blockers.
- The verifier now rejects loose mode-shell claims: mode ids and `Alt+1` through `Alt+8` shortcuts must match exactly, all mode routes must be Rust-owned, and shell/rail/inspector/Command Center layers must report no React/WebView usage.
- Added standalone evidence at `.codex-auto/quality/native-mode-shell-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `70/100`, `80/114`, `in-progress`.
- Remaining product-edge blockers: live native OS IME dogfood, native settings UI, rendered native mode rail/right inspector demotion from React, accessibility, native visual QA, and making React/WebView compatibility-only.

## 2026-05-25 Full-Native Mode Rail Window Progress

- Added `aether-native mode-rail-window-proof`.
- The native client now renders the 8-mode rail into a Win32 layered window using Rust-owned mode shell data.
- The proof exposes rendered rows, exact hit targets, selected/focused mode, keyboard transitions, nonblank pixel evidence, and `readyForReactDemotion=false`.
- The verifier now rejects rail proofs that skip any mode, lose `Alt+1` through `Alt+8`, omit hit targets, miss keyboard evidence, render blank pixels, or require React/WebView.
- Added standalone evidence at `.codex-auto/quality/native-mode-rail-window-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `71/100`, `82/116`, `in-progress`.
- Remaining product-edge blockers: live native OS IME dogfood, native settings UI, native inspector/right-rail React demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Full-Native Inspector Window Progress

- Added `aether-native inspector-window-proof`.
- The native client now renders the Command Center-backed contextual inspector into a Win32 layered window using Rust-owned mode shell and Command Center data.
- The proof exposes evidence rows, action rows, action hit targets, keyboard selection, scroll state, enter dispatch metadata, nonblank pixel evidence, and explicit no React/WebView dispatch guardrails.
- The verifier now rejects inspector proofs that do not match Command Center evidence/action counts, miss action targets, omit keyboard/scroll evidence, render blank pixels, or require React/WebView to dispatch the selected action.
- Added standalone evidence at `.codex-auto/quality/native-inspector-window-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `71/100`, `84/118`, `in-progress`.
- Remaining product-edge blockers: live native OS IME dogfood, native settings UI, actual native Command Center/right-rail React demotion, native accessibility, native visual QA, and React/WebView compatibility-only promotion.

## 2026-05-25 Full-Native Right-Rail Demotion Readiness

- Added `aether-native right-rail-demotion-proof`.
- The proof connects the already-proven native Command Center, mode shell, mode rail, and contextual inspector into a single readiness contract for demoting the React right rail.
- The proof records the native replacement map, verifies every prerequisite is complete, and still reports the current React right-rail sources as present.
- This keeps the claim honest: the native product path is ready for the demotion work, but React/WebView has not been reduced to compatibility-only yet.
- Added standalone evidence at `.codex-auto/quality/native-right-rail-demotion-proof.json`.
- The verifiers now require `native-right-rail-demotion-contract-proof`, `native-right-rail-replacement-map-proof`, and `native-right-rail-demotion-honesty-proof`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `72/100`, `86/120`, `in-progress`.
- Remaining product-edge blockers: live native OS IME dogfood, native settings UI, actual React right-rail compatibility demotion, native accessibility/UIA, native visual QA, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Full-Native Native Settings Window Progress

- Added `aether-native settings-window-proof`.
- The native client now renders settings customization into a Win32 layered native window using Rust-owned config data.
- The proof covers theme, mood, window opacity, wallpaper image path, wallpaper opacity, wallpaper position, wallpaper scale, panel/terminal material controls, palette controls, hit targets, keyboard navigation, hot-reload binding, and nonblank pixel evidence.
- The verifier now rejects settings UI claims that omit controls, hot reload, wallpaper controls, keyboard navigation, nonblank rendering, or no-React/no-WebView ownership.
- Added standalone evidence at `.codex-auto/quality/native-settings-window-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `77/100`, `92/120`, `in-progress`.
- Remaining product-edge blockers: live native OS IME dogfood, actual React right-rail compatibility demotion, native accessibility/UIA, native visual QA, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native HWND IME Dogfood Progress

- Added `aether-native ime-dogfood-proof`.
- The proof dogfoods the Rust native input HWND rather than the WebView IME bridge: a native parent HWND is created, the native input child HWND is focused, `WM_IME_STARTCOMPOSITION` is observed, Japanese committed text is drained through `NativeTerminalInputHost`, and Codex/Claude/Gemini prompt rows are rendered through `NativeRenderFrame`.
- The verifier now requires `native-ime-hwnd-dogfood-proof`, `native-ime-ai-cli-prompt-row-proof`, and `native-ime-dogfood-honesty-proof`.
- Added standalone evidence at `.codex-auto/quality/native-ime-hwnd-dogfood-proof.json`.
- This intentionally does not close real OS IME dogfood yet. The remaining IME work is an installed Japanese IME/TSF composition/candidate session, not synthetic `WM_CHAR` commit through the native HWND.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `78/100`, `94/120`, `in-progress`.
- Remaining product-edge blockers: real OS IME/TSF dogfood, actual React right-rail compatibility demotion, native accessibility/UIA, native visual QA, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native Accessibility Tree Progress

- Added `aether-native accessibility-proof`.
- The proof builds a native semantic tree from Rust-owned mode shell, Command Center, inspector, and settings contracts.
- It verifies accessible names, roles, focus order, keyboard traversal, action guardrails, and no React/WebView dependency.
- The proof deliberately does not claim screen-reader completion: `screenReaderProviderReady=false` and `nextProof=native-uia-provider-dogfood`.
- Added standalone evidence at `.codex-auto/quality/native-accessibility-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `80/100`, `96/120`, `in-progress`.
- Remaining product-edge blockers: real OS IME/TSF dogfood, actual React right-rail compatibility demotion, UIA/accesskit provider dogfood, native visual QA, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native Visual QA Harness Progress

- Added `aether-native visual-qa-proof`.
- The native client now has a WebView/CDP-free visual QA harness that aggregates native renderer/window proofs and adds direct Win32 pixel sampling.
- The proof verifies required native surfaces, nonblank rendering, contrast, resize probe coverage, and focus coverage through the native accessibility proof.
- The pixel probe uses a Win32 compatible bitmap and `GetPixel` for desktop and compact scenarios.
- The proof deliberately leaves real Windows sleep/resume open: `sleepResumeDogfood=false` and `nextProof=native-sleep-resume-visual-dogfood`.
- Added standalone evidence at `.codex-auto/quality/native-visual-qa-proof.json`.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `82/100`, `98/120`, `in-progress`.
- Remaining product-edge blockers: real OS IME/TSF dogfood, actual React right-rail compatibility demotion, UIA/accesskit provider dogfood, real Windows sleep/resume visual dogfood, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 React Right-Rail Compatibility Demotion

- Marked the existing React right-rail modules as explicit compatibility clients instead of product truth: `AgentInspector`, `LivePanesPanel`, `rightRailGoalTrack`, and `rightRailAdvisor`.
- Updated `aether-native right-rail-demotion-proof` so Rust verifies every compatibility client has the expected contract marker and reports `reactCompatibilityOnly=true`.
- The proof now reports `compatibilityStatus=react-right-rail-compatibility-only`, `reactDemotionComplete=true`, `reactOwnsProductTruth=false`, and `webviewDispatchRequired=false`.
- The native-client, native-boundary, and full-native audit verifiers now reject unmarked React right-rail sources.
- Refreshed `.codex-auto/quality/native-client-spike.json`, `.codex-auto/quality/native-boundary-contract.json`, `.codex-auto/quality/native-right-rail-demotion-proof.json`, and `.codex-auto/quality/full-native-rust-gap-audit.json`.
- Validation passed: `pnpm exec tsc --noEmit`, `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `83/100`, `100/120`, `in-progress`.
- Remaining product-edge blockers: real OS IME/TSF dogfood, UIA/accesskit provider dogfood, real Windows sleep/resume visual dogfood, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native UIA Provider Dogfood

- Added `aether-native uia-provider-proof`.
- The proof creates native Win32 controls for the accessibility dogfood path and validates them through Windows UIAutomation, with no React/WebView involvement.
- The proof verifies `ElementFromHandle`, readable UIA names, descendant enumeration, ControlType reporting, and `InvokePattern` execution for a native action button.
- Added standalone evidence at `.codex-auto/quality/native-uia-provider-proof.json`.
- The proof records `manualNarratorDogfood=false`; it proves UIA provider readiness and programmatic invocation, not a human/manual screen-reader pass.
- The native-client, native-boundary, and full-native audit verifiers now require the UIA provider proof.
- Validation passed: `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `85/100`, `102/120`, `in-progress`.
- Remaining product-edge blockers: real OS IME/TSF dogfood, real Windows sleep/resume visual dogfood, and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native OS IME Dogfood

- Added `aether-native ime-os-dogfood-proof`.
- The native path now proves Japanese preedit/result handling through Win32 Imm32 APIs and the Rust `NativeTerminalInputHost`, not WebView/xterm fallback.
- The proof covers `ImmSetCompositionStringW(GCS_COMPSTR)`, `ImmNotifyIME` completion, native input-host drain, one committed PTY write, and Codex/Claude/Gemini prompt-row visibility through `NativeRenderFrame`.
- Added standalone evidence at `.codex-auto/quality/native-ime-os-dogfood-proof.json`.
- The verifier now requires `native-ime-os-composition-proof`, `native-ime-os-result-commit-proof`, and `native-ime-os-ai-cli-prompt-proof`.
- Honesty boundary: manual Japanese candidate-window dogfood and TSF candidate UI sweep are still follow-up hardening gates; the current proof closes automated OS IME preedit/result routing.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `90/100`, `108/120`, `A`, `in-progress`.
- Remaining product-edge blockers: real Windows sleep/resume visual dogfood and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Native Sleep/Resume Recovery Probe

- Added a native sleep/resume recovery probe to `aether-native visual-qa-proof`.
- The probe uses a native Win32 message loop and `WM_POWERBROADCAST` suspend/resume messages to verify that the native shell has a redraw/focus/surface-reconfigure recovery path ready.
- The visual QA proof now records `aether.native.sleep-resume-recovery-probe.v1`, pre/post resume nonblank visual probes, and `native-sleep-resume-recovery-probe-proof`.
- The proof intentionally records `realWindowsSleepResumeDogfood=false`; it does not claim the final Windows sleep/resume gate because it does not put the machine to sleep.
- Command Center action generation was hardened so the right rail still exposes recovery/refresh actions when the remaining blocker list becomes short.
- Right-rail demotion readiness was hardened to use standalone native inspector evidence if a previous partial native-client run overwrote the aggregate artifact.
- Refreshed `.codex-auto/quality/native-client-spike.json`, `.codex-auto/quality/native-boundary-contract.json`, `.codex-auto/quality/native-visual-qa-proof.json`, and `.codex-auto/quality/full-native-rust-gap-audit.json`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `90/100`, `108/120`, `A`, `in-progress`.
- Remaining product-edge blockers: real Windows sleep/resume visual dogfood and making `aether-native` the primary daily-driver shell.

## 2026-05-25 Primary Native Shell Promotion

- Added `aether-native primary-shell-proof`.
- The proof makes `aether-native` the primary product-truth surface for the native migration and demotes the existing React/WebView shell to compatibility-only.
- It aggregates native prerequisites across renderer, input/IME, settings, Command Center/right rail, UIA/accessibility, visual QA harness, native-client, and native-boundary artifacts.
- It renders a single native Win32 primary shell proof window with mode rail, terminal surface, Command Center actions, promotion gates, action hit targets, and nonblank pixel evidence.
- The proof records `nativePrimaryShellPromotion=true`, `primarySurface=aether-native`, `productTruthOwner=rust-native-shell`, `reactWebViewCompatibilityOnly=true`, `reactOwnsProductTruth=false`, `webviewOwnsTerminal=false`, and `promotionReady=true`.
- The proof does not claim final full-native readiness: `readyForFullNativeClaim=false` remains until real Windows sleep/resume visual dogfood is complete.
- Added standalone evidence at `.codex-auto/quality/native-primary-shell-proof.json`.
- Refreshed `.codex-auto/quality/native-client-spike.json`, `.codex-auto/quality/native-boundary-contract.json`, and `.codex-auto/quality/full-native-rust-gap-audit.json`.
- Validation passed: `node --check scripts\verify-native-client-spike.mjs`, `node --check scripts\verify-native-boundary-contract.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `cargo fmt --manifest-path src-tauri\Cargo.toml --check`, `cargo check --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo test --manifest-path src-tauri\Cargo.toml --bin aether-native`, `cargo build --manifest-path src-tauri\Cargo.toml --bin aether-native`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `A`, `in-progress`.
- Remaining product-edge blocker: real Windows sleep/resume visual dogfood.

## 2026-05-25 Native Sleep/Resume Final Gate Hardening

- Hardened `scripts/verify-real-os-suspend-evidence.mjs` for the full-native target.
- The suspend/resume verifier now accepts `AETHER_APP_EXE` and `AETHER_APP_PROCESS_NAME`, allowing the final run to target `aether-native.exe` rather than only `Aether.exe`.
- The full-native audit now refuses to close the final sleep/resume blocker with stale or legacy Tauri evidence.
- Required final evidence now includes `aether-native` executable/process identity, real Windows suspend/resume power events, post-resume app/API/terminal/SQLite/pane-state checks, and a resume timestamp newer than `.codex-auto/quality/native-primary-shell-proof.json`.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `node --check scripts\verify-full-native-rust-gap-audit.mjs`, `pnpm verify:production:suspend:diagnose`, `pnpm verify:production:suspend`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `A`, `in-progress`.
- Remaining product-edge blocker: real Windows sleep/resume visual dogfood against the current native primary shell.

## 2026-05-26 Native Primary Sleep/Resume Harness

- Extended the real OS suspend/resume harness with native primary-shell targeting.
- `--native-primary` now makes the evidence target `aether-native.exe` and the `aether-native` process identity instead of the legacy Tauri release shell.
- `--launch-native-primary` starts a visible long-held `aether-native primary-shell-proof` process before arming the suspend window, then records the exact launch/probe result in the evidence session.
- The evidence flow now writes `suspendTarget`, `nativePrimaryLaunch`, native `processName`, and `targetKind` metadata so the final audit can tell whether the proof was collected against the actual Rust primary shell.
- Added dedicated package scripts for the native run: `verify:production:suspend:native-begin`, `native-resume`, `native-postcheck`, `native-diagnose`, and guarded `native-cycle`.
- Validation passed: `node --check scripts\verify-real-os-suspend-evidence.mjs`, `pnpm verify:production:suspend:native-diagnose`, `pnpm verify:production:suspend:diagnose`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `A`, `in-progress`.
- Current full-native audit remains gated until a real Windows sleep/resume cycle is captured against the current native primary shell.

## 2026-05-26 Native Verifier Hardening And Preflight

- Repaired the native-client verifier so it no longer depends on PowerShell sidecar launch, mandatory cargo rebuilds, or spawnSync native execution in the Windows sandbox.
- The verifier now prefers the bundled PTY sidecar, can start it directly with hidden windows, skips rebuild when the debug `aether-native.exe` already exists, and captures `aether-native` JSON output through temporary files instead of pipe-backed spawnSync.
- Fixed the primary-shell proof self-reference: component proofs can satisfy the native-client prerequisite while the aggregate verifier is still assembling its final artifact.
- Added the `open-native-sleep-resume-preflight` Command Center action so the native right rail remains actionable even when the full-native blocker list is down to one item.
- Added native sleep/resume preflight evidence at `.codex-auto/production-smoke/real-os-suspend-native-preflight.json`.
- Current preflight result: `ready-except-host-event-log-access`; native primary target, native binary, short-lived native primary-shell launch, isolated sidecar, and API reachability are green. The remaining preflight miss is Windows System event log access from this sandbox (`spawnSync powershell.exe EPERM`).
- Validation passed: `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-diagnose`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `A`, `in-progress`.
- Remaining product-edge blocker: real Windows sleep/resume visual dogfood against the current native primary shell, run from a session with System event-log access.

## 2026-05-26 Native Power Event Proof

- Added a Rust-native Windows event-log proof for the final sleep/resume gate.
- `aether-native power-events-proof --start-epoch n --end-epoch n` now reads the System log through Windows Event Log APIs without PowerShell and emits `aether.native.power-events-proof.v1`.
- The proof filters by provider as well as event id, preventing unrelated `id=1` or `id=107` records from being counted as resume evidence.
- `verify-real-os-suspend-evidence.mjs` now uses the native event proof in `--native-primary` mode for diagnostics, preflight, and final validation.
- Native preflight now reports `ready-for-real-sleep`; event-log access is green with `nativeWindowsEventLog=true` and `powershellUsed=false`.
- Native process liveness for the launched proof window now uses Node PID liveness instead of PowerShell process enumeration, removing another sandbox-specific false negative.
- Validation passed: direct `aether-native power-events-proof`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-diagnose`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `A`, `in-progress`.
- Remaining product-edge blocker: real Windows sleep/resume visual dogfood against freshly armed native evidence.

## 2026-05-26 Guarded Native Sleep And Primary Shell Gate Repair

- Added `aether-native sleep-now` as the Rust-native guarded sleep command for the final real Windows sleep/resume path.
- The command is intentionally fail-closed: it refuses to call the Windows power API unless `QUORUM_ALLOW_OS_SLEEP=1` or `--i-understand-this-sleeps-windows` is present.
- Updated `verify-real-os-suspend-evidence.mjs` so native-primary guarded cycles use the Rust command instead of PowerShell.
- Fixed stale-artifact pressure in `aether-native primary-shell-proof`: the proof now merges persisted native-client checks with the current verifier run's checks, so primary-shell promotion is evaluated from the proof run that is actually in progress.
- Revalidated the native IME OS dogfood path after the regression report. Full native-client verification again passes IME OS composition/result/prompt-row checks.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: run the explicitly opted-in real Windows sleep/resume cycle and post-resume native visual QA.

## 2026-05-26 Strict Native Sleep Evidence Contract

- Hardened the final native sleep/resume gate so it cannot be satisfied by stale `Aether.exe` evidence, PowerShell event-log evidence, or a native binary hash refresh alone.
- Native-primary evidence must now prove the target kind, native-primary launch request, successful native launch with PID, post-resume `aether-native` process identity, API health, terminal roundtrip, SQLite/pane-layout preservation, and native Windows event-log source.
- `verify-full-native-rust-gap-audit.mjs` now requires `validation.windowsPowerEvents.source=aether-native-power-events-proof`, `nativeWindowsEventLog=true`, and `powershellUsed=false` before awarding the final `native-visual-qa` sleep/resume points.
- Refreshed the sleep/resume evidence file to the current native executable identity without claiming completion. Diagnostic remains incomplete until the real opted-in sleep/resume cycle runs.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real Windows sleep/resume visual dogfood against the launched `aether-native` primary shell.

## 2026-05-26 Post-Resume Native Visual Proof Gate

- Extended native sleep/resume postcheck to run native visual proof after resume.
- Postcheck now records `validation.postResumeProbes.nativeVisual` from `aether-native visual-qa-proof` and `aether-native primary-shell-proof`.
- The final audit now requires post-resume pixel/contrast/resize/focus coverage and primary-shell nonblank/interactive evidence before it can award the final native visual QA sleep/resume points.
- This closes a blind spot where process/API/terminal/DB recovery could pass while native rendering quality after resume remained unproven.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: opted-in real Windows sleep/resume plus native postcheck on the resumed system.

## 2026-05-26 Native Command Center Sleep/Resume Runbook

- Added a final-gate runbook to the Rust-native Command Center action model.
- The native actions now cover preflight, begin/arm, guarded host sleep cycle, resume timestamp capture, post-resume checks, and the final full-native audit.
- The host sleep action is explicitly marked with `requiresExplicitOptIn=true` and `explicitOptInEnv=QUORUM_ALLOW_OS_SLEEP=1`.
- The native-client verifier now requires `native-command-center-sleep-resume-runbook-proof`.
- The full-native audit now requires this runbook before accepting the Command Center data/action proof, keeping the final gate discoverable from the Rust native product surface.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: opted-in real Windows sleep/resume and resumed native visual proof.

## 2026-05-26 Native Postcheck Preflight And IME Worker Hardening

- Added `verify:production:suspend:native-postcheck-preflight` as a dry run for the final post-resume checks.
- The dry run starts an isolated sidecar, launches the native primary shell proof, and verifies post-resume process identity, API health, terminal roundtrip, DB/pane-layout persistence, and native visual proof readiness without claiming a real Windows sleep event.
- Native-primary terminal roundtrip now uses direct sidecar HTTP in the preflight path, so `aetherctl` spawn restrictions do not mask product readiness.
- Added `aether-native db-smoke-proof` for isolated SQLite/pane-layout proof. This keeps preflight and final postcheck evidence out of the user's real config/database.
- Repaired the IME OS dogfood verifier crash by running the Imm32 worker with file-backed stdio and `CREATE_BREAKAWAY_FROM_JOB`. The proof still verifies Win32 Imm32 preedit/result handling, native input-host drain, and Codex/Claude/Gemini prompt-row visibility without WebView or React.
- Validation passed: `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-postcheck-preflight`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real opted-in Windows sleep/resume, then native postcheck on the resumed system.

## 2026-05-26 Native Postcheck Writer Smoke

- Fixed the final native postcheck writer so it uses the collected probe object for app/API/terminal/DB readiness checks.
- Added isolated suspend evidence path overrides so postcheck writer behavior can be tested without touching the real sleep/resume artifact.
- Added `verify:production:suspend:native-postcheck-write-smoke` to exercise the real native postcheck write path into `.codex-auto/production-smoke/postcheck-write-smoke`.
- Validation passed: `pnpm verify:production:suspend:native-postcheck-write-smoke`, `pnpm verify:production:suspend:native-preflight`, `pnpm verify:production:suspend:native-postcheck-preflight`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real opted-in Windows sleep/resume, then native postcheck on the resumed system.

## 2026-05-26 Native Postcheck Smoke Artifact And Parallel Isolation

- Promoted the native postcheck writer smoke from a command-only check to a first-class artifact at `.codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json`.
- The artifact records isolated evidence/diagnostic writes, native-primary launch, isolated sidecar readiness, API health, terminal roundtrip, DB/pane layout, native visual proof, and `noRealSleepClaim=true`.
- Isolated sidecar runs now use per-run mux and scrollback directories, so native preflight and postcheck preflight can run in parallel without interfering with terminal roundtrip capture.
- The full-native audit now exposes `nativePostcheckWriteSmoke` in `currentTruth` so this final writer path stays visible in the release audit.
- Validation passed: parallel `pnpm verify:production:suspend:native-preflight` plus `pnpm verify:production:suspend:native-postcheck-preflight`, `pnpm verify:production:suspend:native-postcheck-write-smoke`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real opted-in Windows sleep/resume, then native postcheck on the resumed system.

## 2026-05-26 Native Sleep Guard Proof

- Added a Command Center-visible proof that the native sleep action is fail-closed before a real host-power test is attempted.
- The new `verify-native-sleep-guard` runbook action is owned by the Rust-native Command Center model, requires no React/WebView surface, and points to `pnpm verify:production:suspend:native-sleep-guard`.
- The verifier runs `aether-native sleep-now` without `QUORUM_ALLOW_OS_SLEEP=1` and proves that it refuses quickly, does not emit success JSON, does not claim a real sleep attempt, and does not fall back to PowerShell.
- Evidence is stored at `.codex-auto/production-smoke/native-sleep-guard-refusal.json`, and the full-native audit now reports it under `currentTruth.nativeSleepGuard`.
- Validation passed: `pnpm verify:production:suspend:native-sleep-guard`, `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-boundary`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real opted-in Windows sleep/resume, then native postcheck on the resumed system.

## 2026-05-26 Native Paste Guard Proof And Visual QA Artifact Split

- Added `aether-native paste-guard-proof` as a Rust-native no-WebView/no-CDP proof for terminal paste safety.
- The proof dogfoods a real native input HWND with Windows clipboard `CF_UNICODETEXT` and `WM_PASTE`, proving allowed single-line paste normalization plus destructive and multiline paste blocking before PTY write.
- The native input verifier now accepts this fresh Rust artifact as behavioral HWND paste evidence, eliminating the old requirement that a CDP browser smoke be current.
- Split native present-loop and winit/wgpu proof outputs into standalone quality artifacts so the native visual QA harness reads completed surface evidence instead of the in-progress native-client report.
- Validation passed: `pnpm verify:terminal:native-client`, `pnpm verify:terminal:native-input`, `pnpm verify:terminal:native-boundary`, `pnpm verify:production:suspend:native-sleep-guard`, and `pnpm verify:full-native:audit`.
- Current full-native audit: `98/100`, `118/120`, `S`, `in-progress`.
- Remaining product-edge blocker: real opted-in Windows sleep/resume, then native postcheck on the resumed system.

## 2026-05-26 Native-First Hybrid Goal Baseline

- Retargeted the release goal from strict full-native Rust to native-first hybrid.
- Added `docs/history/NATIVE_FIRST_HYBRID_PRODUCT_GOAL.md` as the release-goal source of truth.
- Strict full-native remains as a stretch audit in `docs/history/FULL_NATIVE_RUST_FINAL_GOAL.md`, not the release definition.
- Added `pnpm verify:native-first:audit`.
- The native-first audit passes at `100/100`, grade `S`, with `nativeFirstHybridReady=true`.
- The audit explicitly allows React/Tauri for non-hot-path, contract-backed UI while requiring Rust/native ownership of terminal truth, IME, clipboard, paste guard, PTY/mux/session, pane lifecycle, AI CLI launch, recovery, performance, and visual/accessibility gates.
- Real Windows sleep/resume remains opt-in host dogfood and strict full-native stretch evidence, not a reason to keep the revised native-first release goal blocked.

## 2026-05-28 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `90/100`, `303/335`, `releaseCandidateReady=false`.
- Current score after the fresh final-goal evidence map is `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- The terminal render-fidelity gate is green, and browser/Codex preview now uses the production `TerminalCanvas` path instead of a clean DOM-text surrogate.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for authenticated AI CLI prompt smoke.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `27/27`.

## 2026-05-31 Final Goal Evidence Refresh

- Current release score evidence before the self-referential final-goal map is `93/100`, `313/335`, `releaseCandidateReady=false`.
- Projected score after the fresh final-goal evidence map remains `96/100`, `321/335`; auditStatus=`blocked-by-external-gates`.
- Terminal text clarity is now guarded by the production canvas path plus a Sharp-mode no-backdrop-blur terminal shell path.
- Remaining external gate is real Windows sleep/resume support; remaining policy gate is explicit token-spend consent for `authenticated-ai-cli-prompt-smoke`.
- Authenticated prompt execution remains gated by `authenticated-ai-cli-prompt-smoke`, `authenticated-ai-cli-consent-packet`, and `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini`; safe proof registry is `27/27`.

## 2026-05-31 Chunked OSC Safe Refresh Guard

- Added `pnpm verify:terminal:chunked-osc-live:safe` so the strict chunked OSC inline-image verifier no longer strands goal refresh when WebView2/CDP or child-process launch is unavailable.
- The safe wrapper preserves `.codex-auto/production-smoke/chunked-osc-live.json`, writes `.codex-auto/production-smoke/chunked-osc-live.environment-blocked.json`, and requires the last live primary artifact to remain source-fresh before refresh accepts an environment-blocked replay.
- `pnpm verify:goal:refresh-safe` now includes `chunked-osc-live`, records visible progress, keeps `tokenSpendingPromptExecuted=false` and `realOsSleepInvoked=false`, and accepts only the controlled environment-blocked proof.
- Anti-stall proof now requires the chunked OSC safe wrapper, so this specific CDP/spawn failure cannot silently regress back into an unhandled stack.
- Validation passed: `node --check scripts\verify-chunked-osc-live-safe.mjs`, `pnpm verify:terminal:chunked-osc-live:safe` produced the expected environment-blocked artifact, `pnpm verify:goal:refresh-safe`, `pnpm verify:release:hygiene`, and `pnpm verify:goal:safe` remains `27/27`.

## 2026-05-31 Operator Finish Heartbeat Guard

- `pnpm verify:goal:operator-finish` now streams long external-gate steps instead of hiding them behind a silent `spawnSync` wait.
- Token prompt smoke, real user sleep/wake, post-operator refresh, and final safe reruns emit `[goal-operator] start`, `[goal-operator] waiting`, and pass/fail markers with a default `AETHER_GOAL_OPERATOR_HEARTBEAT_MS=30000`.
- Readiness-only mode still sends no prompt, invokes no OS sleep, and can replay the same-day external gate readiness artifact when sandbox child-process launch is blocked.
- Anti-stall proof now requires `operatorFinishStreamsLongExternalSteps`, so the external-gate handoff cannot regress to a long silent wait without failing `pnpm verify:goal:anti-stall`.

## 2026-05-31 Finalize Evidence Gate

- Added `pnpm verify:goal:finalize` as the ordered, no-token/no-sleep evidence finalizer for the self-referential final audit/score/docs/matrix/safe chain.
- The sequence is fixed as release hygiene -> anti-stall -> quality score -> final audit -> quality score -> docs -> final audit -> quality score -> completion matrix -> operator finish readiness -> final safe, with `AETHER_GOAL_FINALIZE_SKIP_OPERATOR=1` for the nested post-operator path.
- `pnpm verify:goal:operator-finish` now calls the finalize gate after a real external gate run instead of relying on a loose refresh/safe pair.
- Anti-stall proof now requires `goalFinalizeClosesSelfReferenceLoop`, so the known `93` transient score caused by running score/docs out of order cannot become the documented finish path.

## 2026-05-31 External Gate Handshake Closure

- Tightened `pnpm verify:goal:external-gates` so the external-gate handoff has a fixed before/after sequence instead of the older loose refresh runbook.
- The after-gate sequence is now `pnpm verify:goal:operator-finish` -> `pnpm verify:goal:finalize` -> `pnpm verify:goal:safe` -> `pnpm verify:goal:closeout`, keeping token/sleep operations explicit while closing score/audit/docs/matrix ordering automatically.
- `pnpm verify:goal:safe` now rejects an external-gate readiness artifact unless it contains the finalize closure, and `pnpm verify:goal:anti-stall` requires the same runbook terms.
- `pnpm verify:goal:finalize` now treats the goal docs and external-gate readiness source as freshness inputs, preventing stale docs/runbook artifacts from satisfying the finalizer after a handoff edit.
- This prevents a resumed operator run from getting stranded between an external gate and the final self-referential evidence refresh.

## 2026-05-31 Final Score/Audit Race Lock

- Added a shared `.codex-auto/quality/final-goal-evidence.lock` guard for `pnpm verify:quality-score` and `pnpm verify:final-goal-audit`.
- The lock prevents `score-release-quality` from reading `final-goal-audit.json` while `verify-final-goal-audit` has removed and is rewriting it, which previously could create a transient `93/100` score and strand the goal chain.
- Lock ownership records pid, argv, cwd, and start time; stale locks are cleared only after `AETHER_FINAL_GOAL_LOCK_STALE_MS` so interrupted verifier runs can recover without manual cleanup.
- Anti-stall proof now requires both score and audit scripts to use the shared lock before the self-referential final-goal evidence map can count as safe.
- The finalizer now refreshes `quality-score` immediately after anti-stall before the first final audit, so a source change to the anti-stall/score/audit verifier set cannot make audit consume stale score evidence.
