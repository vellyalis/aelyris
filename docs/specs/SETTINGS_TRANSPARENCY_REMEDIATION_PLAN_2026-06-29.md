# Settings + Transparency Remediation Plan (2026-06-29)

Scope chosen by user: **全部やる（配線＋リファクタ）** — fix wallpaper, wire all dead
settings, repurpose Window-opacity into a real transparency control, modularize
`moods.ts` / `Settings.tsx`, and clear the audited debt.

Source of truth for every claim below = the parallel audit (wallpaper / settings /
debt / adversarial-verify) run on 2026-06-29. All file:line refs are from that audit.

## Guiding principles
- **HIGH correctness first**, then features, then refactor (move *working* code last).
- **Verify at every milestone**: `pnpm tsc --noEmit`, `pnpm vitest run <touched>`, `cargo build` / targeted `cargo test`, and a final release build + live pixel/visual check.
- **Incremental commits** on `feat/transparency-and-settings` branch (NOT master): one coherent commit per phase, each green.
- **No dead settings left**: every Settings control must reach a real consumer (wire it) — removal only for genuinely-redundant config (documented).
- **No new debt**: single filter helper, single glass-alpha source of truth, configs de-duplicated.

## Layering contract (the model everything must honor)
`window transparency` = backdrop **source selector** (desktop ↔ wallpaper).
`wallpaper opacity` = how opaque the in-app backdrop is.
`panel/glass alpha` = how much of the backdrop bleeds through the chrome.
→ When a wallpaper is set it becomes an **opaque** in-app backdrop (covers the desktop);
with no wallpaper the window is see-through to the desktop/acrylic. Panels stay
translucent over whichever backdrop is active.

---

## Phase 0 — HIGH correctness (blocking; land first)

### 0.1 Fix the broken test + release scorer (debt HIGH #1)
My uncommitted `lib.rs` change renamed the env var to `AETHER_DISABLE_DWM_CHROME`
and changed the log message, breaking two pins of the OLD strings.
- `src/__tests__/AppSilentBugs.test.ts:810-811` — update assertions to the new env var + message (assert the *intent*: "DWM chrome is env-gated", not the literal old string).
- `scripts/score-release-quality.mjs:2748-2749` — same two substrings.
- Verify: `pnpm vitest run src/__tests__/AppSilentBugs.test.ts`.

### 0.2 crystal & sakura render OPAQUE on the transparent window (debt HIGH #2)
brightness/contrast removal was applied ONLY to `darkMoodSurfaces()`
(`moods.ts:442-443`). Still opaque: `crystalMoodSurfaces()` (`481-482`), the
`aether-sakura` literal (`563-564`), and the `:root` fallbacks (`global.css:120,127`).
- Done correctly as part of Phase 2 (single filter helper) so it can never re-drift.
- Interim if Phase 2 slips: strip brightness/contrast/saturate from those 4 sites too.
- Verify: switch mood to crystal/sakura in dev, confirm see-through.

---

## Phase 1 — Wallpaper fix (user's #1 complaint)

Root cause (verified high-confidence): selecting an image sets only `imagePath`,
never `opacity`; default per-mood opacity = 0 → invisible; ceiling capped at 0.85;
no opaque base so even raised it leaks the desktop.

1. **Default opacity on image select** — `Settings.tsx` `chooseWallpaperImage` (376), path-input `onChange` (732), `handleBrowserWallpaperFile` (391): set `{ imagePath, ...(opacity <= 0 ? { opacity: 1 } : {}) }`.
2. **Raise opacity ceiling 0.85 → 1** at all three clamps: `useTheme.ts:101`, `appStore.ts:266` (sanitizeWallpaperSettings), `Settings.tsx:750` (slider max). Display math `Math.round(opacity*100)` already supports 1.0.
3. **Opaque backdrop layer** — `global.css` `.app-container::before` (814-818): paint an opaque mood-colored base *under* the `background-image` (so partial-scale / alpha PNGs never leak the desktop) and ensure it sits below the panels but above the root glow; reconcile with the sibling `::after` veil at the same z-index (-1) so the veil doesn't tint it.
4. **Asset-scope guard (secondary)** — `tauri.conf.json:35` `assetProtocol.scope` is `["$HOME/**"]`; images outside `$HOME` are blocked by CSP even though the URL is generated. Decide: broaden scope to common drives OR copy the picked image into an app-data dir on select. Plan: copy-into-appdata on native pick (robust, keeps scope tight) — implement in the Tauri choose handler.
- Verify: set a wallpaper from `$HOME` and from `D:/`; confirm both display and cover the desktop; panels translucent over it.

---

## Phase 2 — moods.ts modular split + single generator (debt MEDIUM; folds in 0.2)

`moods.ts` (1215 lines) mixes registry, utils, material generator, and ~1000 lines of
hand-authored per-mood literals; `darkMoodSurfaces` is a generator but `crystal`/`sakura`
are hand-copied forks (the exact reason 0.2 drifted).

Split into `src/shared/themes/moods/`:
- `registry.ts` — ids, `MOOD_PRESETS`, `normalizeMoodPreset`, `DEFAULT_MOOD_PRESET`.
- `material.ts` — sanitize/clamp/luminance + `materialOverridesToCSS` + `applyReadableDarkGlassFloor`.
- `surfaces.ts` — ONE `buildMoodSurfaces(seed)` generator that accepts the extra knobs crystal/sakura need (filter string w/o brightness/contrast, light-vs-dark text, rim alphas). crystal & sakura become **data rows**, not forks.
- `tokens.ts` — replace the 8 `MOOD_CSS` literals with one `buildMoodTokens(seed)` + 8 seed-data rows (ink/glass-base rgb + accent + gold + text + per-tier alpha).
- `index.ts` — re-export the existing public surface so importers don't change.
- **Single filter helper**: one `PANEL_BLUR` / `glassFilter()` used by all moods → brightness/contrast removed everywhere → fixes 0.2 structurally.
- **Glass-tier alpha table**: hoist the floor minimums + generator clamps into one named `GLASS_TIER_ALPHA` consumed by both `materialOverridesToCSS` and `applyReadableDarkGlassFloor` (kills the magic-number duplication; this table becomes the thing the Phase-4 slider drives).
- Verify: `pnpm vitest run src/__tests__/themePalette.test.ts src/__tests__/useThemeApplier.test.tsx src/__tests__/designTokenUsage.test.ts`; `pnpm tsc --noEmit`; visually diff each of the 8 moods in dev.

---

## Phase 3 — Wire the 7 dead settings (make them actually work)

Each currently persists to `config.toml` but has no runtime consumer.

| Setting | Wire to | Files |
|---|---|---|
| **Line Height** | thread `lineHeight` into terminal cell metrics (height = round(fontSize × lineHeight)) | `terminalMetrics.ts:39-56`, `NativeTerminalArea.tsx:363`, `AgentTerminal.tsx:57`, store `appStore.ts`, `useTheme`/config |
| **Font Ligatures** | thread `ligatures` to the shaper instead of hardcoded `allow_ligatures:false` | `src-tauri/src/bin/aether_native.rs:8283` (+ `text_shaping.rs:907`), config read, store, IPC |
| **Cursor Style** | apply user pref to the rendered cursor (override/ә seed PTY) | `TerminalCanvas.tsx`, `snapshot.rs:367`, store, backend |
| **Cursor Blink** | drive the blink-enable from config | `TerminalCanvas.tsx:716` path, store, backend |
| **Default Shell** | `App.tsx:2652` `useTabManager("powershell")` → read `config.terminal.default_shell` | `App.tsx`, config load |
| **window_effect** | wire to select DWMSBT backdrop type in `lib.rs` (mica ↔ acrylic) AND add the missing Settings picker | `lib.rs:449-538`, `Settings.tsx` (new control), store, config |
| **ui_font_family** | add the missing Settings picker (value is already consumed for app font) | `Settings.tsx` (new control), store |

Each gets a store field (where missing), config persistence, AND a live consumer.
- Verify per setting: change it in dev, observe the effect (line height changes row spacing, ligatures toggle visible in a ligature font, cursor style/blink change, new tab uses the configured shell, window_effect switches backdrop, ui font changes app font). Add/extend a unit test per newly-wired field.

---

## Phase 4 — Window opacity → real transparency slider

The current Window-opacity slider is misleading (only paints ≤8% black veil; doesn't
control see-through). Repurpose it into a **Transparency** control that drives the
`GLASS_TIER_ALPHA` table from Phase 2 (the see-through level the user hand-tuned to 0.12).

1. Replace the hardcoded floor with a store-backed `panelTransparency` (0 = opaque … 1 = max see-through) → maps to the glass-tier alphas via one function.
2. Re-label the slider + fix the inaccurate hint text; keep the veil/glow behavior only if it still adds value, else remove it.
3. Persist to `config.toml`; live-apply via `useTheme`.
- Verify: dragging the slider visibly changes panel see-through over a bright backdrop; the 0.12 default matches today's approved look.

---

## Phase 5 — Settings.tsx modular split

`Settings.tsx` (1059 lines, one flat form) → extract co-located sections (pattern
already exists: `ShellIntegrationSection`, `UpdateCheckSection`, `ThemePaletteEditor`):
- `AppearanceSection` (theme + mood — **collapse the duplicated Mood Select+grid into one**).
- `MaterialSection` (material override sliders + transparency slider).
- `WallpaperSection`.
- `TerminalSection` (font / size / line-height / clarity / ligatures / surface / shell / cursor).
- `Settings.tsx` keeps: dialog shell + `LoadedConfig` contract + save/merge orchestration (target < 400 lines).
- Verify: `pnpm tsc --noEmit`; every control still saves/persists; `SettingsSaveMerge.test.tsx` green.

---

## Phase 6 — Config & debt dedup

- **Double acrylic**: drop `windowEffects:["acrylic"]` from `tauri.conf.json` + `tauri.dev.conf.json` (the manual DWMSBT in `lib.rs` is the path that actually works); keep `transparent:true` + `backgroundColor`. Reconcile the stale `global.css:777` comment.
- **backgroundColor drift**: keep transparency keys in base `tauri.conf.json` only; remove from dev conf (or cross-comment).
- **window_effect contradiction**: now wired in Phase 3 (no longer dead); ensure default matches the real applied backdrop.
- **Scratch cruft**: delete the 11 untracked probe/shot scripts (`scripts/probe-*.mjs`, `shot-*.mjs`, `raise-opacity-demo.mjs`, `set-opacity-direct.mjs`, `probe-settings-bg.mjs`).
- **webview2-com version skew**: add a `cargo tree -d` CI note / pin comment tying it to the resolved tauri/wry windows-core; revisit if Tauri re-exports the bindings.
- **transparency contract doc**: short header block in `lib.rs` + a note in `docs/specs` enumerating the compose order.

---

## Phase 7 — Build, verify, commit

1. `pnpm tsc --noEmit` + full `pnpm vitest run` (or `--pool=forks` if THREADS flakes).
2. `cargo fmt` + `cargo clippy -D warnings` + targeted `cargo test` (settings/config/lib).
3. `pnpm build` + `cargo build --release --features tauri/custom-protocol`.
4. **Live verify**: launch release (no flag), pixel/visual check — wallpaper covers desktop when set; see-through when not; all 8 moods translucent; each wired setting demonstrably works.
5. Commit per-phase on `feat/transparency-and-settings`; NO push (local-only project).

## Verification matrix (must all be green before "done")
- tsc 0 errors · vitest green · cargo build/clippy/fmt green · release builds · AppSilentBugs + SettingsSaveMerge tests updated & green · score-release-quality gate green.
- Live: wallpaper visible+covering · no-wallpaper see-through · crystal/sakura translucent · 7 settings each have a visible effect · transparency slider live.

## Risks / notes
- Native renderer wiring (ligatures/cursor/line-height) crosses Rust↔TS contracts — highest-risk; do with a targeted test each.
- moods.ts split must keep the public export surface identical (many importers).
- `cargo test` and `pnpm test` must NOT run in parallel on Windows (per CLAUDE.md).
- Branch off current `master` working tree, which ALSO carries pre-existing uncommitted (non-mine) changes — separate those from this work at commit time.
