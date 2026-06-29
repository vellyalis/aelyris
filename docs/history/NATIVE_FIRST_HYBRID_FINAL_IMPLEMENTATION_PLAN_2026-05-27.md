# Native-First Hybrid Final Implementation Plan

Date: 2026-05-27

## Final Goal

Aelyris reaches the current final implementation goal when the native-first hybrid product is implementation-complete:

- Rust owns terminal truth: PTY, mux/session graph, pane lifecycle, scrollback, command history, recovery evidence, settings data, Command Center data, and AI CLI orchestration contracts.
- The terminal hot path is native-first: input, IME, clipboard, paste guard, shell launch, AI CLI launch planning, pane split/close/focus, and recovery must not depend on xterm/WebView truth.
- React/Tauri remains allowed only for contract-backed UI surfaces: settings, inspector, review panels, project panels, and compatibility views.
- Clauge-inspired information architecture is retained: left mode rail, central work surface, and right contextual Inspector.
- Clauge source good parts are tracked in `docs/history/CLAUGE_SOURCE_AUDIT_GOOD_PARTS_2026-05-27.md`; the target is upper compatibility for Aelyris's AI-terminal domain, not broad REST/SQL/NoSQL/S3 feature sprawl.
- Mission Control-style ambiguity is removed; the right rail explains what can be done, why it matters, what evidence backs it, and what recovery action exists.
- Theme customization is user-owned: per-preset color, material opacity, wallpaper path/file selection, image opacity, scale, position, and Sakura isolation must remain tested.

The implementation completion command is:

```powershell
pnpm verify:native-first:audit
```

The implementation goal is complete only when this returns `100/100`, grade `S`, with `nativeFirstHybridReady=true`.

## Current Audit Position

Latest broad release-quality score before this plan:

- `79/100`
- `260/331`
- grade `C`
- `releaseCandidateReady=false`

This broad score includes release-operation gates that are intentionally outside the native-first implementation claim:

- signed distribution artifacts;
- real Windows sleep/resume dogfood;
- clean-shutdown Tauri runtime hygiene after dev/CDP is closed;
- npm registry-backed supply-chain audit when network access is available;
- live Tauri/CDP post-launch chaos proof;
- token-spending authenticated AI CLI prompt execution;
- final release self-reference and Goal Track mutual proof.

Those remain required before a public release claim. They do not mean the native-first implementation target should drift back to "rewrite all React in Rust."

## Phase 1: Lock The Truth Boundary

Acceptance:

- `verify:native-first:audit` treats Rust-owned terminal/product truth as the implementation target.
- Release-operation blockers are visible but do not masquerade as terminal-core implementation failures.
- No silent fallback is allowed for terminal input, paste, pane lifecycle, or AI CLI launch contracts.

Evidence:

- `scripts/verify-native-first-hybrid-audit.mjs`
- `.codex-auto/quality/native-boundary-contract.json`
- `.codex-auto/quality/release-quality-score.json`

## Phase 2: Terminal And AI CLI Core

Acceptance:

- Japanese IME and AI CLI prompt-row positioning remain stable.
- Paste and clipboard are native-first and guarded before PTY writes.
- Codex, Claude, and Gemini have no-token preflight proof.
- Authenticated prompt execution is blocked unless explicit consent and provider are present.

Evidence:

- `pnpm verify:terminal:native-boundary`
- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:authenticated-ai-cli-provider-guard`
- `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix`
- `pnpm verify:terminal:authenticated-ai-cli-consent-packet`

## Phase 3: Right Inspector As Product Edge

Acceptance:

- Clauge source-informed patterns are accounted for: mode identity, mode state preservation, per-mode AI/context, agent purpose/worktree/provider identity, workspace inbox/notes/boards, cross-mode history, and MCP-ready local-first contracts.
- New upper-compatibility gates are tracked from the Clauge source audit:
  `aelyris.mcp.server.v1`, `aelyris.workspace.data.v1`,
  `aelyris.mode-preservation.v1`, `aelyris.history.search.v1`, and
  `aelyris.agent-identity.v1`.
- The right rail scrolls reliably.
- It exposes ranked actions, evidence, recovery, consent state, freshness, and current blocker ownership.
- It does not leak Visual QA fixture state into runtime truth.
- It remains bounded with 20 sessions and 500 changed files.

Evidence:

- `pnpm verify:right-rail`
- `pnpm verify:right-rail-scale`
- `pnpm verify:right-rail-preferences`
- `.codex-auto/production-smoke/right-rail-iab-proof.json`

## Phase 4: Customization And Visual Quality

Acceptance:

- Every preset can customize colors, opacity, and wallpaper behavior.
- Sakura does not bleed into other presets.
- Low-contrast controls and status bars stay readable.
- Browser visual QA shows no Mission Control text and no runtime-only fallback buttons in visual QA mode.

Evidence:

- `src/features/settings/Settings.tsx`
- `src/shared/hooks/useTheme.ts`
- `src/styles/global.css`
- `src/__tests__/AppSilentBugs.test.ts`

## Phase 5: Final Verification Loop

Run in order:

```powershell
pnpm verify:terminal:authenticated-ai-cli-provider-guard
pnpm verify:terminal:authenticated-ai-cli-preflight-matrix
pnpm verify:terminal:authenticated-ai-cli-consent-packet
pnpm verify:right-rail
pnpm verify:right-rail-preferences
pnpm verify:right-rail-scale
pnpm verify:quality-score
pnpm verify:native-first:audit
node node_modules\typescript\bin\tsc --noEmit --pretty false
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo check --manifest-path src-tauri\Cargo.toml --bin aelyris-native
```

## Release-Operation Gates

These are still required before saying "public release ready":

- distribution build and signing;
- real Windows sleep/resume with explicit host opt-in;
- clean shutdown with no dev/CDP ports and no workspace processes;
- npm audit with registry access;
- live Tauri/CDP chaos proof;
- optional authenticated prompt smoke with explicit token-spend consent.

Do not fold these back into the implementation goal. Report them as residual release-operation gates until their own artifacts are green.

If automated sleep entry is unsupported on the host, the release path is:

```powershell
pnpm verify:production:suspend:native-preflight
pnpm verify:production:suspend:native-user-cycle
pnpm verify:quality-score
pnpm verify:final-goal-audit
```

`native-user-cycle` waits for the operator to put Windows to sleep manually, then validates the real suspend/resume event pair and native post-resume probes. It is the preferred proof path for machines where `SetSuspendState` returns `GetLastError=50`.
