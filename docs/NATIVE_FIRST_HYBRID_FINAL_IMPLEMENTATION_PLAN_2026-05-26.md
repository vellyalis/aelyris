# Native-First Hybrid Final Implementation Plan

Date: 2026-05-26

## Final Goal

Aether Terminal is implementation-complete for the current product goal when it is a native-first hybrid:

- Rust/native owns terminal truth, PTY/mux/session state, scrollback, command history, recovery/provenance, AI CLI orchestration, settings data, Command Center data, and all input-sensitive terminal hot paths.
- React/Tauri remains only as a contract-backed compatibility UI for non-hot-path surfaces.
- The visible product shell follows the Clauge-inspired information architecture: left mode rail, center work surface, and right contextual Inspector.
- The terminal/AI CLI path does not depend on xterm/WebView for IME, paste, shell launch, pane lifecycle, or durable terminal truth.
- Implementation confidence is measured by `pnpm verify:native-first:audit` returning `100/100`, grade `S`, with no blockers.

This goal does not claim that release operations are complete. Signed installer distribution, actual Windows sleep/resume dogfood, clean-shutdown runtime hygiene, and final release self-reference remain separate release-operation gates.

## Phase 1: Goal And Evidence Model

Status: complete.

Acceptance:

- `docs/NATIVE_FIRST_HYBRID_PRODUCT_GOAL.md` is the release-goal source of truth.
- Full-native Rust is recorded as an optional stretch, not the release requirement.
- `pnpm verify:native-first:audit` separates implementation confidence from distribution and host-power release gates.

## Phase 2: Terminal Hot Path

Status: complete for native-first implementation confidence.

Acceptance:

- Native HWND input is the default terminal input surface.
- IME composition is owned by the native surface, with WebView composition only as a contained compatibility bridge.
- IME/paste bytes are bound to the terminal id captured at event time, so focus changes cannot route a commit to the wrong pane.
- Native WM_PASTE is guarded before PTY write.
- Codex, Claude, and Gemini prompt-row dogfood evidence is current.

Verification:

- `pnpm verify:terminal:native-client`
- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:terminal:native-hwnd-paste`

## Phase 3: Mux And Pane Performance

Status: complete for native-first implementation confidence.

Acceptance:

- Pane create, split, close, attach, detach, and resize stay under the measured budgets.
- Mux graph, pane lifecycle, durable scrollback, and process reconnect are Rust/daemon owned.
- Pane split/close does not require command-window fallback.

Verification:

- `pnpm verify:mux-performance`
- `pnpm verify:mux-live`
- `pnpm verify:terminal:multipane-command-evidence`
- `pnpm verify:terminal:process-reconnect-command-evidence`

## Phase 4: Product Shell And Inspector

Status: complete for native-first implementation confidence.

Acceptance:

- 8-mode rail exists: Terminal, Agents, Workspace, Review, Git, Context, History, Settings.
- The right side is a contextual Inspector, not Mission Control.
- Inspector evidence, actions, context, recovery, and Command Center data are Rust/native product truth.
- React right rail is explicitly compatibility-only and does not own product truth.
- Right rail implementation subsmokes are green, excluding the old release self-reference loop.

Verification:

- `pnpm verify:clauge-ui-refresh`
- `pnpm verify:right-rail-preferences`
- `pnpm verify:right-rail-scale`
- `pnpm verify:right-rail-edge`
- `pnpm verify:right-rail-command-evidence`
- `pnpm verify:right-rail-decisions`
- `pnpm verify:right-rail-stale-url`

## Phase 5: Theme, Transparency, And Customization

Status: complete for native-first implementation confidence.

Acceptance:

- Each preset has isolated material, opacity, wallpaper, wallpaper opacity, scale, and placement state.
- Sakura does not bleed into other presets.
- Sakura surfaces use white-peach intentional material instead of muddy gray where transparency hurts readability.
- Settings exposes customization controls through contract-backed config.

Verification:

- `pnpm verify:clauge-ui-refresh`
- `pnpm verify:quality-score`
- `pnpm verify:native-first:audit`

## Phase 6: AI CLI And Prompt Safety

Status: complete for native-first implementation confidence.

Acceptance:

- Codex, Claude, and Gemini binary probes and launch planner are green.
- Authenticated prompt execution is explicit-consent gated.
- The token-spending prompt smoke can pass when consent is provided, but the product never sends it silently.
- Provider guard and preflight matrix remain current.

Verification:

- `pnpm verify:terminal:real-ai-cli`
- `pnpm verify:terminal:ai-cli-launch-planner`
- `pnpm verify:terminal:authenticated-ai-cli-provider-guard`
- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:terminal:authenticated-ai-cli-consent-packet`
- `pnpm verify:terminal:authenticated-ai-cli-prompt` with explicit consent only

## Phase 7: Final Implementation Gate

Status: complete as of the latest local audit.

Current result:

- `pnpm verify:native-first:audit`
- `100/100`
- grade `S`
- `nativeFirstHybridReady=true`
- `implementationConfidence=high`

This is the goal-complete implementation gate. It is intentionally stricter about the terminal hot path than a normal frontend QA pass, and intentionally narrower than a full release/distribution gate.

## Residual Release-Operation Gates

These are not implementation blockers, but they must remain visible before a public release claim:

- signed distribution artifacts and installer;
- actual Windows sleep/resume cycle with `AETHER_ALLOW_OS_SLEEP=1`;
- clean-shutdown Tauri runtime hygiene after closing dev/CDP processes;
- final old release self-reference loop for `verify:final-goal-audit` / `verify:right-rail-goal-track-tauri`.

Do not claim these are complete until their own artifacts are green.

## Operating Rule

When asked whether the implementation is 100%:

- Say yes only for `native-first hybrid implementation confidence` when `pnpm verify:native-first:audit` is green.
- Say no for `public release distribution confidence` until the residual release-operation gates are green.
- Keep the distinction visible in UI, docs, and final reports.
