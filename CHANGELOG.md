# Changelog

All notable changes to Aether Terminal are tracked here. Dates are listed in
`YYYY-MM-DD`. Commit hashes reference `refactor/tauri-react-migration`.

## [Unreleased]

Continuing the post-0.2.3 Tier 3 polish run started with
`247e813` (search-in-scrollback, Tier 3 #9).

### UX

- **Form primitives modernisation — radix Switch + Select replace
  native `<select>` / `<input type=checkbox>` in Settings.**
  Dogfood: "are you using shadcn / Tailwind? what other old UI is
  left?" Honest answer: Tailwind + shadcn aren't on this project
  by design (Liquid Glass tokens are CSS-Modules-driven), so
  shadcn-style modernisation has to come via Radix primitives.
  Settings was the loudest tell — four native `<select>` boxes
  (Theme / Terminal Font / Default Shell / Cursor Style) and
  three `<input type="checkbox">` rows (Font Ligatures / Cursor
  Blink / Ghost Diff Live mode) all rendered with OS-default
  chrome (square blue tint on Windows, no animation, no glass).
  - New `shared/ui/Switch.tsx` — Radix `Switch.Root` with an iOS-
    style 32 × 18 pill, gold accent for the on state, optional
    `label` + `hint` props for inline rows.
  - New `shared/ui/Select.tsx` — Radix `Select.Root` with a
    glass-pill trigger (chevron rotates 180° when open) and a
    portal-attached menu themed against the dialog surface,
    with checkmark indicator on the active option.
  - `Settings.tsx` migrated: 4 `<select>` → `<Select>`, 3 `<input
    type="checkbox">` → `<Switch>`. The 2 `<input type="number">`
    fields stay as native steppers for now (font size / line
    height — radix has no public stepper, deferred).
  - +2 new dependencies: `@radix-ui/react-select 2.2.6`,
    `@radix-ui/react-switch 1.2.6`.
  - Vite preview verify: 4 `role="combobox"` triggers + 3
    `role="switch"` toggles render in Settings; toggling the
    first switch flipped `data-state` checked → unchecked
    cleanly; opening the Theme select listed all 7 themes
    (Aether Dark / Catppuccin Mocha / Frappé / Macchiato / Latte /
    Tokyo Night / Dracula). Screenshot shows the OS-default
    blue square `<select>` chrome is gone — replaced with a
    glass pill that matches the Save button rhythm.
  - **Other native form elements still pending** (declared so
    they don't get forgotten): `HelmPanel.tsx`,
    `KanbanBoard.tsx`, `AgentInspector.tsx`,
    `RepairJobsPanel.tsx`, `WatchdogDialog.tsx` all still use
    raw `<input type="checkbox">`. Same Switch primitive
    drops in cleanly when those panels get audited.
  - `pnpm test`: 803 unchanged (the suite is flaky on a cold
    CDP run; second pass hit 803/803). `tsc --noEmit`: 0
    errors.

- **Chrome cluster rework — hamburger menu + collapsible sidebar
  (Ctrl+B), Claude-Code-Desktop / VS Code parity.** Dogfood:
  "the UI still has Win32-era stuff. The horizontal File / Edit /
  View / Terminal / Help bar is old, and the left sidebar's size
  feels off." Fixes:
  - **MenuBar fan-out from a single hamburger.** The standalone
    horizontal `<MenuBar />` band (under the header) is gone.
    `MenuBar.tsx` is now a single Radix `DropdownMenu.Root` with
    a `<Menu>` icon trigger; clicking the hamburger opens a
    portal-attached pane that lists File / Edit / View /
    Terminal / Help vertically, each fanning out into its
    submenu via Radix `DropdownMenu.Sub`. Preserves the existing
    `Menu` / `MenuItem` data contract — `useAppMenus.ts` is
    unchanged.
  - **Chrome cluster moved into ProjectHeaderBar.** `<MenuBar
    />` now renders inside `<ProjectHeaderBar>`'s left edge,
    immediately followed by a `PanelLeft` / `PanelLeftClose`
    button that toggles the sidebar. Together they form the
    same anchored chrome cluster every modern app shell uses
    (Files, VS Code, Claude Code Desktop, Linear, etc.) — the
    user's eye starts in the same place every time. App.tsx
    stops rendering `<MenuBar />` separately.
  - **Sidebar collapsible (width 180 px ↔ 0 px).** `useAppStore`
    gains `sidebarCollapsed` + `setSidebarCollapsed`, persisted
    to `localStorage["aether:sidebarCollapsed"]`. CSS in
    `global.css` adds `.left-panel-collapsed` (`width: 0
    !important; min-width: 0; border-right-color: transparent;
    resize: none`) and a `width 180 ms` transition so the rail
    slides in/out cleanly. `useKeyboardShortcuts.ts` wires
    Ctrl+B (matches VS Code / Claude Code Desktop) — toggling
    via the chrome button or the shortcut both flip the same
    Zustand state and persist the choice.
  - Vite preview verify: hamburger click yields a portal with
    `role="menu"` containing 5 `role="menuitem"` rows (File /
    Edit / View / Terminal / Help). Submenus open on hover /
    arrow nav. Ctrl+B flips
    `<nav.left-panel-collapsed>` and writes "1" /
    `localStorage.removeItem` accordingly. `pnpm test`: 803
    unchanged. `cargo test --lib`: 473 unchanged. `tsc`: 0
    errors.

- **Inactive-window glass softening — panels stay readable as
  glass when the window blurs.** Dogfood: "but it's only
  transparent when the window is active, is that intended?" —
  partly. Win11's Acrylic backdrop (`DWMSBT_TRANSIENTWINDOW`) is
  suppressed by the OS when the window blurs (matches Files /
  Notepad / Settings — there's no public API to override that
  spec). What we *could* fix is what the React panels look like in
  that state: with the active alphas (0.28 / 0.35 / 0.42) plus no
  Acrylic backdrop, the panels read as a solid dark slab the
  moment the user Alt-Tabs.
  Fix: Rust `setup` now subscribes to `WindowEvent::Focused(bool)`
  and emits `aether:window-focused` over Tauri IPC; `main.tsx`
  listens and toggles `<body data-window-focused="true|false">`.
  CSS keys off the attribute and bumps each glass token by ~10–
  15 % alpha (frame 0.28 → 0.40, standard 0.35 → 0.48, dense
  0.42 → 0.55, thick 0.55 → 0.65, ground 0.55 → 0.65) when
  blurred so the panels still read as muted glass instead of
  solid plastic. Active state remains untouched at the lighter
  alphas tuned in the previous transparency commit.
  `tauri.conf.json` + `tauri.dev.conf.json` also bump
  `windowEffects.state` from `followsWindowActiveState` to
  `active` — Tauri's hint that the window should be treated as
  always-active for effect purposes (the OS spec still wins on
  the Acrylic side, but it costs nothing to ask).
  Vite preview verify: toggling `body.dataset.windowFocused`
  flipped `getComputedStyle(body)['--glass-frame']` between 0.28
  and 0.40 cleanly, and back. Real Acrylic active/inactive
  behaviour still needs `pnpm tauri:dev` on Win11 — it's an OS-
  side spec.

- **Real translucency — Acrylic, not Mica, is what makes the
  desktop show through.** Dogfood reported "still not transparent
  at all." Two diagnostic mistakes on my side that this commit
  fixes:
  - **WebView2 paints `body` opaque white before global.css lands.**
    `index.html` previously had no `<style>` block in `<head>`, so
    for a few hundred ms after window creation the body was solid
    white, completely covering whatever OS-level material the DWM
    drew. Inline `<style>` rule now declares `html, body, #root {
    background: transparent !important; }` directly in the head so
    transparency is honoured from the very first frame.
  - **Mica is a wallpaper-tint, not a transparent material.**
    Win11's `DWMSBT_MAINWINDOW` (Mica) samples wallpaper colour and
    paints a subtle tint — it does NOT make the window translucent.
    For "the desktop blurs through the window" you want
    `DWMSBT_TRANSIENTWINDOW` (Acrylic). The Tauri `setup` hook now
    calls `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE,
    DWMSBT_TRANSIENTWINDOW)` first, falls back to
    `DWMSBT_MAINWINDOW` only when Acrylic is refused, and logs the
    chosen material to the structured ring (`window chrome:
    Acrylic applied …` / `Acrylic refused; falling back to Mica
    wallpaper tint`). `tauri.conf.json` and `tauri.dev.conf.json`
    declare `effects: ["acrylic"]` to match.

- **Transparent window restored — wallpaper actually shows through Mica.**
  Three connected fixes after dogfood reported "the desktop isn't
  showing through":
  - **Removed the inner-cast drop shadow on `.app-container`.**
    The previous `box-shadow: 0 24px 48px rgba(0,0,0,0.45), 0 8px
    16px rgba(0,0,0,0.35)` was meant to give the window weight,
    but on a `transparent: true` Tauri window the shadow paints
    *inside* the window's bounding box, darkening the outer 24–
    48 px ring and visually flattening the Mica material
    underneath. Win11's DWM already draws an authentic OS drop
    shadow around `decorations: false` windows once
    `DWMWA_WINDOW_CORNER_PREFERENCE` is set, so we now leave depth
    to the OS and keep the CSS purely about the inner glass-edge
    rim (1 px white 8 % top highlight + 1 px white 4 % perimeter
    tint).
  - **Reduced glass-token alphas across the layered surface
    system.** Previous values (header 0.45, sidebar 0.55, status
    0.42, dense 0.62) plus 12–20 px backdrop-filter blur were
    stacking enough opaque paint that the Mica wallpaper was
    barely perceptible. New scale: clear 0.02 / ground 0.55 /
    frame 0.28 / standard 0.35 / dense 0.42 / thick 0.55 / solid
    0.78. Text contrast still meets the existing audit threshold
    against the OS wallpaper because Mica supplies its own dark
    tint; the React panels can be lighter than they were.
  - **Single-effect Mica + explicit Rust-side fallback.**
    `tauri.conf.json` + `tauri.dev.conf.json` now declare
    `effects: ["mica"]` (the previous `["mica", "acrylic",
    "blur"]` triple sometimes had Tauri v2 try only one entry on
    Win11 and leave the wrong material). The Tauri `setup` hook
    explicitly calls `window.set_effects(Mica)`, falls back to
    `Acrylic` (Win10 1809+) on failure, and logs the chosen
    material to the structured ring so dogfood can read the live
    decision on stderr (`window chrome: Mica applied …` vs
    `Mica refused; falling back to Acrylic`). The
    `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` call after it
    keeps the rounded outer edge.
  - StatusBar's hard-coded `rgba(15,15,15,0.42)` migrated to the
    shared `--glass-frame` token so all bars take the same alpha
    treatment.
  - Aether stays Tauri + React — fully native is still ruled out
    (`project_strategic_direction.md` 2026-04-17). The visual
    target is reachable from this stack; we just had to stop
    actively defeating Mica with overlapping CSS.

- **"Settings opens but nothing shows" — root cause + four-dialog
  fix.** The earlier "settings won't open" patch (LazyDialog +
  welcome-screen entry point) addressed reachability, but dogfood
  reported the dialog was opening with no content visible. CDP
  inspection revealed the actual layout bug: `Settings.module.css
  .panel` had no explicit `position`, so when Radix `Dialog.Portal`
  rendered Overlay and Content as **siblings** (not parent →
  child), the panel collapsed to `position: static` at `0,0` with
  whatever intrinsic size the flex column gave it — sometimes 2 px
  tall, completely invisible. The same bug was lurking in
  `WatchdogDialog`, `AboutDialog`, and `HelpDialog`; CommandPalette,
  QuickOpen, and HistorySearchDialog had already centred themselves
  correctly so were unaffected.
  Fix: each affected `.panel` / `.dialog` now declares
  `position: fixed; top: 50%; left: 50%; transform: translate(-50%,
  -50%); z-index: calc(var(--z-modal) + 1)` plus a
  `max-width: calc(100vw - var(--space-12))` guard so narrow
  windows still keep a 12 px margin. The overlays drop their
  redundant `display: flex` centring (overlay is now purely the
  scrim, content centres itself).
  Visual verify in `pnpm dev` (Vite preview): clicking the welcome-
  screen gear renders Settings centred at `468 × 638 px` over the
  scrim with all sections (Appearance / Palette swatches /
  Terminal / Updates / Shell Integration / Ghost Diff / Keyboard
  Shortcuts) cleanly visible. `pnpm test` 803 unchanged. `tsc
  --noEmit` 0 errors.

- **"Settings won't open" + window chrome polish.** Three connected
  fixes after dogfood feedback that "the gear button does nothing"
  and "the window looks like it's floating on a square transparent
  frame — far from Apple-class":
  - **`<LazyDialog>` wrapper** (new
    `src/shared/ui/LazyDialog.tsx`) replaces the
    `<Suspense fallback={null}>` pattern around every code-split
    dialog (Settings, Watchdog, About, Help, CommandPalette,
    QuickOpen, PRInspector, WebInspector). Two changes the user
    sees: a chunk that takes >100 ms to land now shows a visible
    "Loading…" scrim instead of a button-press that looks broken,
    and a chunk that fails to fetch surfaces an actionable
    `<ErrorBoundary>` retry panel instead of swallowing the error
    into `null`. Silent failure was the single worst class of
    "settings won't open" bug — there was no signal whether the
    click had registered, the app was hanging, or the feature was
    missing.
  - **Settings reachable from the welcome screen.** Previously the
    only entry point was the gear icon in `<ProjectHeaderBar>`,
    which only renders after a project is open. First-run users
    had no way to pick a theme or default shell before opening a
    folder. New left-bottom 36 px circular Settings button on the
    welcome screen + a `LazyDialog`-wrapped `<Settings>` mount on
    the welcome path so the dialog renders identically before and
    after a project is selected.
  - **Apple-class window depth.** `tauri.conf.json` +
    `tauri.dev.conf.json` now declare
    `effects: ["mica", "acrylic", "blur"]` so Win11 22H2+ picks
    Mica (matches the rest of the modern Windows surface stack),
    older builds fall through to Acrylic, and last-ditch hardware
    falls through to a soft blur. The Tauri `setup` hook then
    calls `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_ROUND)` so the OS-level window edge is actually
    rounded (the previous combination of `decorations: false` +
    `transparent: true` left the outer window square — that was
    the "floating on a square transparent frame" tell). The inner
    `.app-container` radius drops from 12 px to 8 px so it aligns
    with the OS edge, and gains a two-layer rim — `inset 0 1px 0
    rgba(255, 255, 255, 0.08)` highlight + 24/8 px stacked drop
    shadows — so the window has weight without shouting.
  - Visual confirmation in `pnpm dev` (Vite preview): from the
    welcome screen, click the new gear → Settings dialog opens
    with all sections (Appearance, Terminal, Updates, Shell
    Integration, Ghost Diff, Keyboard Shortcuts) rendered cleanly.
    Same path works from the post-project header bar gear. No
    runtime errors. `pnpm test`: 803 unchanged. `cargo test
    --lib`: 473 unchanged. `tsc --noEmit`: 0 errors. Real Mica /
    DWM corner radius requires `pnpm tauri:dev` on Win11 dogfood —
    that pass remains user-side because Tauri can't be exercised
    from Vite preview.

### Reliability

- **Sprint 3 wave 3 wiring fix — StatusBar badge gets the real PTY id**
  (post-0.2.4 Tier 🔴 #1, follow-up to `6a4a480`). The wave-3
  commit wired `<StatusBar terminalId={activeTabId} />` directly off
  the tab UUID, but `term_image_metrics(id)` needs the
  `spawn_terminal`-allocated PTY id — the two are completely
  separate identifier spaces (Tab UUID lives in
  `useTabManager`, PTY id is private state inside
  `usePaneTree.terminalIds`). The result was a badge that would
  always have been hidden in production: `term_image_metrics` would
  have returned `null` for the unknown tab id, the hook would have
  resolved to a `null` state, and the widget would have rendered
  nothing. Vitest had no way to catch this because the hook + widget
  tests inject their own invoke mock; jsdom never crosses the
  Tauri IPC boundary.
  Fix: `<PaneTreeContainer>` gains an `onActiveTerminalChange`
  callback that bubbles the focused-pane PTY id (resolved from
  `activePaneId` + `terminalIds`, with a single-pane fallback so the
  unfocused initial pane still surfaces telemetry) up to App. App
  aggregates the per-tab PTY id in a `Record<tabId, ptyId>` map and
  passes the active tab's value into `<StatusBar terminalId={…} />`.
  Stale entries are pruned when their tab closes. `cargo test --lib`
  unchanged at 473; `pnpm test` 803 (was 799) with 4 new
  `PaneTreeContainerActiveTerminal` regression specs covering: null
  on mount, single-pane fallback, ambiguous-with-two-unfocused →
  null, focus switch promotes the right PTY id. `tsc --noEmit`: 0
  errors.

### Internal

- **Chunked-OSC 100-emission stress test** (post-0.2.4 Tier 🔴 #1,
  Sprint 3 plan optional deliverable) — adds the "high-value" stress
  harness to `term::engine::tests`. Pumps 100 sequential single-chunk
  OSC 1338 transfers through a `TermEngine` whose `ImageStore` has
  been hot-swapped to a 1 KiB cap, then asserts: `bytes_used` never
  exceeds the cap on any frame, the grid stays empty (no escape
  leakage), the newest entry is always retained, and the structured
  log ring contains at least one `image_evicted` event with
  `terminal_id=stress` + `cap=1024` + `level=WARN`. Runs as part of
  `cargo test --lib`, so the wizard-grade "hostile-input-safe" axis
  has a CI-time witness rather than relying on the
  `scripts/diag-chunked-osc.mjs` round-trip alone. `cargo test --lib`:
  473 (was 472).

- **Roadmap clean-up + `.at()` warning suppression.** With Sprint 3
  wave 3 landing the inline-image observability surface,
  `docs/ROADMAP_POST_0_2_4.md` now reflects the closed state of
  Tier 🔴 #1 (all 5 sprints landed), Tier 🟡 #2 (chafa-less visual
  confirmation — solved by the Sprint 2 emitter wrappers being the
  vehicle), and Tier 🟢 #6 (memory budget telemetry — solved by the
  wave 2 IPC + wave 3 widget + structured log event). The remaining
  gates are user-side: dogfood verify of `diag-chunked-osc.mjs` and
  the preview-server visual check of the badge.
  Separately, added `ES2022.Array` to `tsconfig.json`'s `lib` so the
  7 carry-over `Array.prototype.at` warnings in
  `usePtyLag.test.tsx` resolve cleanly without per-call rewrites.
  `tsc --noEmit`: zero errors (was 7).

### Reliability

- **Chunked OSC inline image protocol — observability UI + structured
  eviction log** (post-0.2.4 Tier 🔴 #1, Sprint 3 wave 3) — closes
  the wizard-grade definition's "Observable" axis. Two surfaces
  landed together:
  - **Status-bar inline-image budget badge.** New
    `useImageMetrics(terminalId)` hook polls `term_image_metrics`
    once a second (paused while the document is hidden so a
    backgrounded tab isn't waking the engine for nothing) and a new
    `<InlineImageBudget />` widget renders `12.3 / 50 MiB · 3` next
    to the agent-status / encoding cluster on the status bar. The
    badge stays hidden when the active pane has no inline images,
    promotes to a catppuccin-yellow tint above 80 % of the FIFO cap,
    and to a catppuccin-red tint above 95 % with a tooltip telling
    the user that the next inline image will start evicting older
    ones. `App.tsx` now passes the active tab id straight into
    `<StatusBar terminalId={…} />` so the badge tracks pane focus.
  - **Structured `image_evicted` log event.** `ImageStore::insert_full`
    now returns `(ImageId, EvictionStats { count, bytes })` so the
    engine can see when the per-pane FIFO cap displaced older
    payloads. `TermEngine` carries a `terminal_id` + `LogRing` pair
    (production wires `crate::logging::ring_buffer()` from
    `NativeTerminalRegistry::create`; tests build an isolated
    `LogRing::new()` so concurrent suite runs don't race), and
    `record_eviction` forwards a non-empty `EvictionStats` into a new
    `LogRing::log_image_evicted` helper that emits a `WARN`-level
    structured entry tagged `event=image_evicted` with
    `terminal_id`, `evicted_count`, `evicted_bytes`,
    `remaining_bytes_used`, and `cap` fields. The Tier 🟡 #7 in-app
    log viewer surfaces it for free because the helper pushes
    through the same `RingLayer` pipeline.
  - **Test posture:** +10 backend unit tests (`store.rs` +2 for
    `EvictionStats` round-trip on single + multi eviction paths,
    `engine.rs` +3 for `record_eviction` happy path + empty-stats
    skip + chunked-OSC pipeline emits the event when the cap
    overflows, `logging::mod` +3 for structured field shape +
    singular-vs-plural message + empty-`terminal_id` omission).
    +17 frontend Vitest tests (7 for `useImageMetrics` covering
    null-id skip, on-mount fetch, polled re-fetch with surface of
    new values, IPC null / IPC throw fallbacks, terminalId switch,
    flip-back-to-null cleanup; 10 for `<InlineImageBudget />`
    covering null / zero-count hidden states, healthy default tier,
    >80 % warn tier, >95 % danger tier with tooltip, singular noun,
    cap-of-zero divide-by-zero guard, plus 4 `formatMiB` cases).
    `cargo test --lib`: 472 (was 462). `pnpm test`: 799 (was 781).
    `tsc --noEmit`: no new errors (the 7 carry-over `.at()` warnings
    in `usePtyLag.test.tsx` are unchanged).
  - **Out of scope (deferred):** Streaming partial paint
    (placeholder `ImageRef` + progress fraction during BEGIN→END)
    stays unimplemented per the Sprint 3 plan — the trigger is
    "dogfood says paint is visibly slow", which has not happened
    yet. Re-evaluate when the dogfood log either reports it or 0.2.4
    ships without it.

- **Chunked OSC inline image protocol — image-metrics IPC**
  (post-0.2.4 Tier 🔴 #1, Sprint 3 wave 2) — adds the observability
  surface the wizard-grade definition's "Observable" axis calls for.
  New `term_image_metrics(id) -> { bytesUsed, cap, count } | null`
  Tauri command exposes the per-terminal `ImageStore` budget so the
  status-bar widget (Sprint 3 wave 3) can show "12.3 / 50 MiB —
  3 imgs" and warn before FIFO eviction trims an image the user
  expects to stay live. Returns `null` for an unknown terminal id,
  matching `term_image_data`'s "missing → null" contract so the
  frontend's null-skip path stays consistent. New
  `ImageMetricsResponse` (`bytesUsed: u64 / cap: u64 / count: u64`,
  camelCase serde) lives in `term::native` next to
  `ImageDataResponse`. New `ImageMetrics` TypeScript interface
  exported from `shared/types/terminal.ts`. +2 Rust unit tests on
  `NativeTerminalRegistry::image_metrics` (empty registry returns
  `(0, cap, 0)`; one-image session reports `count=1`/
  `bytes_used > 0`/`cap` unchanged) bring `cargo test --lib` to 464.
  Status-bar widget + structured-log eviction event land in wave 3
  (UI-side; needs a preview-server verify pass before commit).

- **Chunked OSC inline image protocol — E2E + offline integration**
  (post-0.2.4 Tier 🔴 #1, Sprint 3 first wave) — locks in correctness
  without depending on a live Win11 dogfood session.
  - `e2e/image-flows.spec.ts` test 2 is no longer `test.fixme` — the
    Kitty APC escape it used to feed (which ConPTY silently dropped)
    has been replaced with a `powershell -ExecutionPolicy Bypass -File
    scripts/aether-imgcat.ps1 …` shell-out against the
    `e2e/fixtures/inline-image-1x1.png` fixture. The assertion shape
    is identical (`ImageRef.id`, PNG signature on the round-trip),
    only the vehicle changed.
  - New `e2e/chunked-osc-flows.spec.ts` exercises three scenarios the
    single-shot test couldn't: a 32×32 multi-chunk PNG round-trip
    (~8 DATA frames at the ConPTY cap), two sequential transfers
    surfacing as two `ImageRef` entries in the same snapshot, and a
    malformed-then-valid sequence proving the parser drops a bad
    frame off the wire without poisoning the assembler or leaking
    text into the grid.
  - New `src-tauri/tests/test_chunked_osc_emitter.rs` makes the same
    end-to-end story executable without Tauri / CDP. It spawns the
    emitter scripts as child processes (`bash` resolves through Git
    Bash directly because `Command::new("bash")` would otherwise hit
    System32's WSL bash, which can't see `/c/...`), pipes their
    stdout into a fresh `TermEngine`, and asserts the `ImageStore`
    holds a fully-decoded PNG of the expected dimensions. Five tests:
    bash + ps1 × 1×1 + 32×32, plus a pure-Rust malformed-mixed
    scenario.
  - Emitter chunk size lowered from 369 → 360 raw bytes (492 → 480
    base64 chars) after the Rust integration test caught a worst-case
    DATA frame at 514 bytes — exceeded ConPTY's 512-byte cap when
    `<image-id>` was 10 digits. 480 leaves a 5-byte safety margin and
    is still divisible by 4 so each chunk decodes as a stand-alone
    base64 block.
  - `docs/inline-image-user-guide.md` is the power-user-facing
    intro (limits, what the emitters do, common pitfalls); it points
    at `docs/inline-image-dogfood.md` for the 30-second smoke and
    `docs/chunked-osc-image-protocol.md` for the byte spec.
  - `docs/chunked-osc-troubleshooting.md` catalogues every failure
    mode we've seen so far (no image, garbage on grid, image
    disappearing, `term_image_data` null, signature mismatch, oversize
    DATA frame, ExecutionPolicy block, BSD `od --endian=big` absence,
    diag CDP miss) with diagnostic + fix steps for each.

  cargo test --lib: 462 unchanged. cargo test --test
  test_chunked_osc_emitter: 5 pass. pnpm test: 781 unchanged. The
  Sprint-3 second wave (`term_image_metrics` IPC + status-bar widget
  + optional streaming partial paint + stress harness) lands
  separately.

- **Chunked OSC inline image protocol — emitter wrappers** (post-0.2.4
  Tier 🔴 #1, Sprint 2 of 3) — ships the emitter half of the protocol
  the Sprint-1 engine assembler accepts. `scripts/aether-imgcat.ps1`
  (PowerShell 5+/7+, uses `[char]27` for ESC so it runs on stock Win11
  PowerShell where `` `e `` is not yet a recognised escape) and
  `scripts/aether-imgcat.sh` (Git Bash, GNU `od --endian=big` for
  IHDR + GNU `base64 -w0` for the body) both:
  - Verify the input is a PNG by signature (89 50 4E 47 0D 0A 1A 0A).
  - Read width / height from the IHDR chunk (big-endian u32 at offsets
    16 and 20) and reject anything outside 1..8192 to match the
    engine's per-image dimension cap.
  - Emit `BEGIN` / `DATA` / `END` OSC 1338 frames keyed on a caller-
    allocated random image-id, with each `DATA` carrying 369 raw bytes
    (492 base64 chars) so the full OSC stays under ConPTY's measured
    ~512-byte cap. A runtime check on every `DATA` frame's emitted
    length ensures a regression in chunk math fails locally instead
    of being silently dropped by ConPTY.
  - Use `[Console]::Out.Write` (PowerShell) and `printf '%s'` (bash)
    so the host UI never line-buffers the binary base64 payload.
  - Exit codes encode the failure mode: 0 success / 1 file not found
    / 2 not a PNG / 3 IHDR malformed / 4 internal cap violation.
  Bundled with `scripts/build-image-fixtures.mjs` (zero-dep PNG
  encoder using only `node:zlib`'s `deflateSync` plus a hand-rolled
  CRC32 table) which writes two reproducible fixtures to
  `e2e/fixtures/`: `inline-image-1x1.png` (68 bytes — single-chunk
  path) and `inline-image-32x32.png` (2686 bytes — multi-chunk path,
  ~8 chunks). The 32×32 fixture encodes pixel coordinates into RGB
  so a Sprint-3 pixel-sample E2E spec has a known ground truth.
  `scripts/diag-chunked-osc.mjs` is the end-to-end smoke gate: CDP
  attaches to a running `pnpm tauri:dev`, walks four cases
  (PowerShell + Git Bash) × (1×1 + 32×32), and asserts each one
  surfaces a non-empty `term_snapshot.images` plus a `term_image_data`
  blob whose first 8 bytes are `\x89PNG\r\n\x1a\n`. The script exits
  non-zero on any FAIL so it is suitable as a pre-release smoke gate.
  `docs/inline-image-dogfood.md` documents the 30-second manual
  recipe + a failure-mode crib so a power user can self-diagnose
  without reading the engine source. Offline emitter sanity check
  (bash + ps1 with the same fixture id produce byte-identical 137-B
  output for 1×1 and 10-frame 3.6-KB output for 32×32) confirms the
  wire format is identical across emitters before the Win11 dogfood
  pass. Tests unchanged (cargo --lib 462 / pnpm 781) — this Sprint
  ships only emitter scripts, fixtures, and the diag harness; the
  engine path is already covered by the 30 + 6 unit / integration
  tests landed in Sprint 1.

- **Chunked OSC inline image protocol — engine assembler** (post-0.2.4
  Tier 🔴 #1, Sprint 1 of 3) — Win11 25H2 ConPTY silently strips Kitty
  APC sequences and truncates any OSC above ~512 bytes (verified
  2026-04-30 with `scripts/diag-image-escape.mjs` and
  `scripts/diag-osc-size.mjs`), which leaves the Tier 🟡 #5 inline-
  image pipeline correct end-to-end but dark on Windows. Sprint 1
  introduces the engine half of an Aether-specific chunked OSC
  protocol whose individual frames stay under ConPTY's cap:
  `\e]1338;B;<id>;<format>;<w>;<h>\a`,
  `\e]1338;D;<id>;<chunk-idx>;<base64>\a`,
  `\e]1338;E;<id>\a`. New `term::images::chunked_osc` module ships a
  pure-byte parser (`try_parse` returns `Consumed | Incomplete | None`
  matching the existing OSC 133 / image-escape scanners) and a
  `ChunkAssembler` keyed by `image-id` that accepts out-of-order
  chunks, validates contiguity on `END`, decodes base64 once over the
  concatenation, and yields a `DecodedImage` of the declared format
  (`png` passes through; `rgba` checks `w*h*4 == len`). Per-image
  caps mirror the existing infrastructure (50 MiB raw, 16384 chunks,
  8192 max dimension); validation failures retain partial bytes for
  the diagnostic surface with `decoded=None`, mirroring the single-
  shot Kitty error path. Engine integration is gated through
  `advance()` after the Kitty/Sixel scanner — bytes are never
  forwarded to alacritty, so an in-flight transfer never leaks to the
  grid. +30 Rust tests cover parser dispatch (BEGIN/DATA/END/Malformed
  with BEL + ST terminators, partial-prefix wait, base64 fields with
  embedded `;`-free alphabet), assembler happy paths (single-shot,
  multi-chunk in/out of order, concurrent ids), and the failure modes
  (data-without-begin, end-without-begin, duplicate chunk, chunk gap,
  invalid base64, RGBA size mismatch, BEGIN replacement). Six engine
  integration tests exercise the full advance() pipeline including
  terminator-split-across-advance and OSC 133 + chunked-OSC
  coexistence. Sprint 2 lands wrapper emitters
  (`scripts/aether-imgcat.{ps1,sh}`) and Sprint 3 unblocks the
  `e2e/image-flows.spec.ts` test 2 fixme. Spec:
  `docs/chunked-osc-image-protocol.md`.

- **Inline image escape consumption** (Tier 2 #5, Sprint 1 of 3) —
  Kitty graphics protocol (`\x1b_G…\x1b\\`) and Sixel
  (`\x1bP…q…\x1b\\`) escape sequences are now recognised and
  pre-empted by the engine's `advance()` scanner so they no longer
  leak into the alacritty grid as ASCII garbage. This is the
  correctness fix that has to land before pixel decoding can be wired
  in (`docs/sixel-kitty-spike.md`). The new `term::images` module
  contains a boundary scanner mirroring the OSC 133 `ParseStep`
  shape, a Kitty header parser (`a=`, `f=`, `t=`, `m=`, `i=`, `s=`,
  `v=`, `c=`, `r=`), a Sixel header stub (decoder lands in Sprint
  2), and an `ImageStore` keyed by monotonic `ImageId` with a 50
  MiB cap and FIFO eviction. Sprint 1 stores raw escape payloads
  only; snapshot wiring, IPC, and frontend paint are explicitly
  deferred to Sprints 2–3 to keep the change narrow and reviewable.
  +34 Rust unit tests cover scanner boundaries (Kitty + Sixel,
  with/without payload, cross-boundary `Incomplete` resumption,
  DCS-without-`q` falling back to alacritty), header key tolerance,
  and store insertion / FIFO eviction / id monotonicity.

- **Inline image rendering** (Tier 2 #5, Sprint 3 of 3) — Sprint 3
  closes #5 by surfacing the decoded payloads through the snapshot,
  IPC, and frontend paint paths. `GridSnapshot` gains an
  `images: Vec<ImageRef>` field (with
  `#[serde(skip_serializing_if = "Vec::is_empty")]` so the wire shape
  is byte-identical for text-only frames). `ImageRef` carries
  `(id, cellRow, cellCol, widthPx, heightPx, cellW?, cellH?)` —
  `cellRow` is already translated forward through any scroll that
  happened since the engine consumed the escape, by subtracting
  `current_history_size - history_at_insert`. Images whose anchor
  scrolls into history (or whose decode failed) are silently dropped
  at the snapshot boundary so the frontend only ever paints what it
  can render. New `term_image_data(id, imageId)` IPC returns
  `{format: "png" | "rgba8", dataBase64, widthPx, heightPx}` — bytes
  ride as base64 to keep the JSON IPC honest about binary payloads,
  decoded once and cached as `ImageBitmap` in the new
  `useTerminalImages` hook so subsequent paint passes are O(images)
  bitmap blits, not IPC roundtrips. `TerminalCanvas` paints overlays
  after cells / cursor at `(cellCol × cellWidth, cellRow × cellHeight)`
  scaled to the source-declared cell rectangle (Kitty `c=` / `r=`)
  or computed from pixel dims. Bitmap cache GC: ids dropped from the
  snapshot have their `ImageBitmap.close()` called so long sessions
  with many transient images don't leak GPU memory. +13 tests (5 Rust
  snapshot integration covering field omission when empty, anchor
  capture from cursor, scroll-translation eviction, Kitty cell
  override pass-through, decode-failure skip; 8 Vitest covering hook
  cache + IPC fetch + bitmap eviction + format dispatch + null/throw
  graceful skip). Closes Tier 🟡 #5 entirely.

- **Inline image decode** (Tier 2 #5, Sprint 2 of 3) — the engine now
  decodes the payloads the Sprint-1 scanner caught into a uniform
  `DecodedImage { protocol, payload, width_px, height_px, cell_cols,
  cell_rows }` carrier ready for the eventual snapshot / paint pass.
  Sixel decode is a from-scratch in-tree implementation (no new crate)
  that handles the subset every observed encoder uses: 6-bit vertical
  pixel columns, `!N` repeat, `$` carriage return, `-` line feed,
  `#Pc` palette select, `#Pc;Pu;Px;Py;Pz` palette define (RGB% and HLS,
  the latter normalised to sRGB), and `"Pan;Pad;Ph;Pv` raster
  attributes. The default 16-slot palette matches VT340 / libsixel so
  bodies that omit explicit palette setup still decode. Kitty decode
  routes through a new `KittyChunkAssembler` that buffers `m=1`
  continuations under a shared `i=N` and promotes the chain on `m=0`,
  preserving the originating header's format / dimensions across the
  middle chunks (which typically only carry `i=` + `m=`). Decoded
  payloads land as `Rgba8` (Sixel + Kitty `f=24/32`) or `Png`
  passthrough (Kitty `f=100`, decoded by the frontend on paint). The
  `ImageStore` cap (50 MiB) now charges both raw and decoded buffers,
  and a new `attach_decoded` API lets a future re-decode swap the
  payload without disturbing entry order. Decode failures are non-
  fatal: the raw bytes still register so the diagnostic surface can
  inspect them, and the entry's `decoded` stays `None` (Sprint 3 will
  silently skip those at paint time). +33 Rust tests across the new
  decoder modules and engine integration (Sixel pixel assertions for
  RGB%/HLS palette, `!N` repeat, raster padding, line-feed bands;
  Kitty PNG passthrough, RGBA round-trip, RGB→RGBA inflation, RGBA
  size-mismatch rejection, transmission medium / format gating, three-
  chunk assembly, malformed-payload graceful fail). Pulls `base64
  0.22` into direct dependencies (already transitive through
  tauri/notify) so the decode path is auditable on its own.

### Testing

- **Inline image E2E coverage** (Tier 2 #5, Sprint 3 polish) — new
  `e2e/image-flows.spec.ts` covers the live PTY → ConPTY → engine →
  snapshot → `term_image_data` round-trip via the same CDP attach +
  skip-when-unreachable pattern as `pty-flows.spec.ts`. Test 1: a
  smoke test that asserts `term_image_data(unknown imageId) → null`
  (no PTY behaviour required, always runs when CDP is up). Test 2:
  pipes a Kitty PNG escape through `[Console]::Out.Write` and asserts
  the payload comes back as a `\x89PNG`-prefixed blob. The dogfood
  diagnostic (see `scripts/diag-image-escape.mjs` and
  `docs/sixel-kitty-spike.md` § "Sprint 3 — E2E coverage") confirmed
  that `portable-pty 0.8.1` does not pass
  `PSEUDOCONSOLE_PASSTHROUGH_MODE` to `CreatePseudoConsole`, so Win11
  ConPTY in default mode silently strips Kitty APC escapes before
  they reach the engine. Test 2 is therefore `test.fixme` until
  `docs/ROADMAP_POST_0_2_4.md` item #1 wires passthrough — the unit
  layer (`useTerminalImages.test.tsx` + Rust snapshot integration
  tests) keeps the engine pipeline honest meanwhile.

### UX

- **Theme palette editor** (Tier 3 #10) — Settings → Appearance now
  exposes a per-accent palette editor for the active theme. Each of the
  16 catppuccin accents is editable via a native color picker plus a
  hex text input; values commit on Enter / blur with hex validation
  (3-digit shorthand normalised to 6-digit, invalid inputs flagged with
  `aria-invalid` and silently dropped at the store layer). Overrides
  layer on top of the base palette via a new `applyAccentOverrides` in
  `src/shared/themes/catppuccin.ts`, are persisted under
  `aether:themeOverrides` per-themeId in localStorage, and feed back
  through `useThemeApplier` so the running window updates on the next
  React commit — there is no preview canvas, the live UI is the
  preview. A theme switch in the same dialog applies immediately so the
  editor below targets whichever theme is on screen. Per-accent and
  global Reset buttons drop overrides; empty-override theme entries are
  garbage-collected from the store. 16 unit tests cover hex validation,
  palette merge invariants, store mutations, and component interaction.



Closes every Tier 1 (senior-blocker) item from
`docs/ROADMAP_POST_0_2_2.md` plus four of the five Tier 2 polish items
(only Sixel/Kitty inline images, item #5, remains for a future minor).
Seven commits across reliability, UX, distribution, observability, and
a new PTY-in-the-loop E2E suite.

### Reliability

- **PTY crash recovery** (`74bbb60`, Tier 1 #1) — `ConPTY` child exit is
  now observable: `PtyManager` retains the boxed `Child`, the IPC layer
  spawns a waiter that calls `wait()` and emits `pty-exit-<id>` with a
  typed `ExitInfo { code, crashed }` payload (NTSTATUS heuristic on
  Windows). `respawn_terminal` IPC + frontend banner restart the shell
  in place; `NativeTerminalRegistry::create` is now idempotent so prompt
  marks + scrollback survive across the crash boundary.

### UX

- **Shell integration installer** (`4ebdc5c`, Tier 1 #2) — Settings
  panel surfaces per-shell install state (PowerShell / Bash / Zsh).
  Embedded scripts are written to `~/.aether/shell-integration/` and a
  single `source` line is appended to the user's profile, gated by an
  install marker for idempotency. Risk hedge from the roadmap honoured:
  install fires only on explicit click, with a "Copy line" alternative
  for users on non-standard profile paths.
- **In-cwd `file://` links open in editor** (`e2bb098`, Tier 2 #4) —
  `TerminalCanvas.handleLinkClick` now branches on URL scheme: `https?` /
  `ftp` / `mailto` route to `tauri-plugin-opener` (existing path),
  `file://` URIs whose path resolves under the active project `cwd` open
  in the built-in Monaco editor with optional `#L<line>` / `:line`
  anchors. Scheme-locked: out-of-cwd `file://` paths still go to the OS
  handler, eliminating the Notepad-flash regression on Windows.

### Distribution

- **Auto-updater wiring** (`047de0f`, Tier 1 #3) —
  `tauri-plugin-updater` is registered with a placeholder pubkey +
  `https://updates.aether.invalid/...` endpoint.
  `bundle.createUpdaterArtifacts = true` so a signed `.sig` lands next
  to each NSIS / MSI installer when Tauri sees a private signing key in
  the environment. New surfaces: `<UpdateBanner>` at the top of the app
  (auto-check, silent on errors), Settings → Updates → "Check for
  updates" (surfaces errors verbatim), `scripts/setup-updater-keys.mjs`
  (one-time keypair generation under gitignored `.aether-updater/`),
  `scripts/generate-update-manifest.mjs` (writes `latest.json` next to
  the bundles). Local-only by default — see `docs/auto_updater_setup.md`
  for the full release flow.

### Observability

- **Structured tracing + in-app log viewer** (`3eed245`, Tier 2 #7) —
  swapped `env_logger` for `tracing` + `tracing-subscriber` (env-filter,
  JSON stderr formatter, ring-buffer Layer, `tracing-log` adapter so the
  ~75 existing `log::*!` callsites flow through unchanged). New
  `LogRing` (cap = 1024, monotonic seq) is exposed via `logs_recent` /
  `logs_since` IPC. Right-panel `<LogsPanel>` (lazy + ErrorBoundary)
  hydrates and polls (1024-entry client cap), filters by level, and
  carries a presentation-only Clear that masks via `hideSeq` rather than
  mutating the Rust ring. 8 new Rust unit tests + 11 Vitest specs
  (5 hook + 6 panel).
- **PTY backpressure badge** (`4de28c2`, Tier 2 #8) — `PtyManager`
  exposes per-subscriber `lag_events` counters; `pty:lag-<id>` events
  emit when a `Lagged` is observed. `TerminalInfoBar` now shows a
  "throttled" badge that lights when at least one lag event arrives in
  the last 5 s, decays when quiet, and tooltips the running count.
  Telegraphs the previously-silent `[dropped N chunks]` sentinel.

### Testing

- **PTY-in-the-loop E2E spec** (`20140ce`, Tier 2 #6) —
  `e2e/pty-flows.spec.ts` adds three Playwright specs that attach to a
  running `pnpm tauri:dev` over CDP port 9222 and drive the real backend
  via `__TAURI_INTERNALS__.invoke`: (1) echo round-trip
  (`spawn_terminal` → `write_terminal` → `term_snapshot` sees
  sentinel), (2) scrollback growth (80 lines into 30 rows →
  `term_history_size > 0` + `term_history_rows` returns content), and
  (3) backend-emitted log capture during the spec (`logs_recent`
  watermark + `logs_since` finds `aether_terminal_lib::*` entries —
  doubles as a smoke test for #7). When port 9222 is unreachable the
  three specs `test.skip` cleanly so CI without a live Tauri build does
  not bleed red.

## [0.2.2] — 2026-04-25

Focus: **senior-engineer-grade terminal foundation**. Twelve commits closing
the five "pro terminal" gaps called out in the 2026-04-25 product audit —
OSC 133 semantic prompts, OSC 8 hyperlinks, shell integration scripts,
performance benchmarks, and a scrollback rework with jump-to-prompt
navigation.

### Terminal foundation

- **Scrollback (`2ee698d` / `4402ffa` / `7368ce2`)** — 10 000-line history
  buffer via widened `alacritty_terminal::Dimensions::total_lines`; wheel
  scroll on `TerminalCanvas`; composite rendering splits the viewport
  between history (top) and live (bottom) with reference-equal cells on
  the live path so typing never re-allocates; `Ctrl+Shift+↑/↓/End` jumps
  between `OSC 133;A` marks using the history-size delta stored on each
  mark. `useScrollback` hook + `findPrev/NextPromptMark` helpers isolate
  the navigation logic from the render loop.
- **OSC 133 semantic prompts (`b33bb95` / `030c335`)** — pre-scan parser in
  `TermEngine::advance` covers A/B/C/D with both `BEL` and `ESC \\`
  terminators, tolerates split buffers, and records prompt marks with
  screen line + history size. IPC: `term_prompt_marks` query +
  `term:prompt-mark-<id>` event stream. React `usePromptMarks` hook
  seeds + subscribes; `TerminalInfoBar` renders a coloured status dot
  driven by the last `CommandEnd`. Shell integration scripts for
  PowerShell / Bash / Zsh ship under `assets/shell-integration/`.
- **OSC 8 explicit hyperlinks (`db7a110`)** — surface alacritty's per-cell
  `hyperlink()` as `CellSnapshot.hyperlink`; `links.ts` scans contiguous
  URI runs (including row wraps) and emits them as `LinkSpan` entries
  that win over the regex fallback on the same coordinates. `color-mix`
  in `ToolBadge` replaces the old hex-concat alpha border so palettes
  can remain `var(--ctp-*)` everywhere.

### Performance & observability

- **Criterion microbenchmarks (`b21e216` / `ce76257`)** — 13 benches across
  `advance`, `snapshot`, `diff`, and the OSC 133 pre-scan. Baseline:
  engine throughput ~40 MB/s steady-state, snapshot 25 µs at 80×24 /
  176 µs at 200×50, one-row diff 120 µs. Numbers are documented in
  `docs/perf/term-engine-bench-2026-04-25.md` for regression tracking.

### UI polish

- **Two-phase attenuated pulse (`4f72248`)** — `useAttenuatedPulse` hook
  plus a new ambient 10 s breathe animation. Status dots, agent pills,
  and `ContextGauge` critical runs now collapse from active pulse to
  ambient after 30 s, cutting GPU frame cost ~80 % on long-running agents
  without turning the signal off entirely.
- **Catppuccin CSS var migration (`132fc57`)** — palettes in
  `src/shared/types/*.ts` route through `var(--ctp-*)` so theme switches
  reach status / model / tool / kanban / CLI surfaces. Session palettes
  and the Claude brand lavender stay static by design.

### Cleanup

- **Dead `SubagentList` removed (`1e370e8`)** — component was never mounted
  after its 2026-04-24 rename; deleting it plus the stale hover-token
  comment saved 117 lines.
- **Clippy production-code warnings (`<hash>`)** — cleared `format!`,
  redundant `is_err()` match, manual `split_once`, and missing `Default`
  on `InteractiveSessionManager`.

### Tests

Rust `cargo test --lib` 298 → 330 (+32). Vitest 635 → 671 (+36).
Full suite green, `tsc --noEmit` clean.

## [0.2.1] — 2026-04-25

Focus: **Apple-class UI per-feature audit closure** + **Liquid Glass
material pass**. Three rounds of audit —
an 8-axis token pass (typography / spacing / color / interaction / motion /
material / a11y / rhythm), a per-feature composition audit across ~42
surfaces, and a Liquid Glass / Apple HIG material pass — were fully landed.
Groundwork from Phase 3D-1 v2 (API hardening) and PTY refinements are also
included.

### Liquid Glass material pass (2026-04-24, branch `feat/ui-liquid-glass`)

Eight parallel auditors were run against **Apple HIG Liquid Glass**
(iOS 26 / macOS 26) and **Linear's luminance-stacking** references. The
chosen design-system orientation is: **Apple HIG Liquid Glass** for the
material layer + **Linear** for dark-first luminance discipline;
Vercel/Geist and Atlassian were evaluated and deliberately excluded as
material references.

New tokens introduced in `src/styles/global.css`:
- Specular: `--rim-top`, `--rim-top-strong` (inner top highlight for
  "lit glass edge").
- Recessed: `--inset-recessed` (Linear's sunken-panel pattern).
- Chromatic lensing: `--lens-edge` (135° warm/cool caustic gradient for
  glass rounded-corner edges).
- Three-stack shadow: `--shadow-ambient` / `--shadow-key` /
  `--shadow-contact` / `--shadow-elevated`; Linear-style 5-stop
  `--shadow-dialog`; elevation tiers `--shadow-elev-1..4`.
- Easing: `--ease-apple` (cubic-bezier(0.32, 0.72, 0, 1)),
  `--ease-apple-bounce`. `--ease-silk` is kept as alias → `--ease-apple`.
- Duration: `--duration-hover` (150ms), `--duration-state` (200ms),
  `--duration-panel` (300ms) alongside legacy fast/normal/slow/luxe.
- Tracking: `--tracking-display` / `-heading` / `-body` / `-caption` /
  `-micro` / `-label`.
- Line-height: `--leading-display` (1.1), `--leading-snug` (1.4).
- OpenType baselines: `--font-features-ui` (`ss03 cv11 cv13 kern`),
  `--font-features-mono`, `--font-features-num` (`tnum lnum`).
- Row heights: `--row-h-dense` / `-standard` / `-comfortable`.
- Icon tiers: `--icon-sm` (10), `--icon-md` (14), `--icon-lg` (20).
- Focus: `--focus-ring`, `--focus-ring-on-gold` (neutral white / dark
  fallback for gold-on-gold legibility).
- Link: `--color-link`, `--color-link-hover`.
- `--radius-pill: 9999px`.
- Status aliases: `--status-idle-ctp`, `--status-error-ctp`,
  `--status-edit-ctp`.
- `--agent-accent-rgb: 203, 166, 247` (previously undefined).

Material application:
- Specular rim + 3-stack / 5-stack shadow applied across all 12 dialogs
  and 12 popovers/floating panels. Side panels (`.left-panel`,
  `.right-panel`) carry `--rim-top` along their resize seams.
- `.center-panel` now carries `--inset-recessed` so the terminal well
  reads as sunken between the rails.
- CommandPalette and QuickOpen both layer `--lens-edge` over their
  glass-thick surface for edge chromatic caustic.
- Six dialogs (Handoff / Orchestra / Onboarding / Prompt / History /
  plus Help + WorkflowBuilder shadow-only) migrated from raw
  `rgba(24,24,24,0.92)` / hand-rolled 16-48/64px shadows to the shared
  `--dialog-surface` / `--dialog-surface-blur` / `--shadow-dialog`.

A11y P0 fixes:
- `<span onClick>` stop buttons (SessionCard / InteractiveSessionCard /
  AgentInspector parallelPane) replaced with new `shared/ui/StopButton`
  primitive: `<span role="button" tabIndex=0 onKeyDown>` + Lucide
  `<Square>` + stopPropagation.
- WorkspaceTabs close `<span>` gained `tabIndex` + `onKeyDown`; ⚡ / × /
  + literal glyphs replaced with Lucide `GitBranch` / `X` / `Plus`.
- Three remaining `window.confirm()` sites migrated to themed
  `showConfirm` (App.tsx close-file + window-close, ToolkitPanel
  dangerous-import).
- Clickable `<div>` promoted to `role="button"` + keyboard activation:
  AgentInspector `parallelPane`, KanbanBoard task item,
  WorkflowPanel phase step (with `aria-expanded`).
- ContextMenu and MenuBar items now have explicit `:hover` +
  `:focus-visible` (were relying only on Radix `data-highlighted`).
- Button.primary focus ring was gold-on-gold (invisible); now uses
  `--focus-ring-on-gold` dark outline.
- ProjectHeaderBar `.ctrlBtn` focus ring was clipped by the title-bar
  edge; now inset -3px.

New shared primitives:
- `shared/ui/StopButton` — see above.
- `shared/ui/LoadingSkeleton(.tsx/.module.css)` — row / card / line
  variants with `role="status"` + `aria-live="polite"`, shimmer
  respects `prefers-reduced-motion` via global rule.
- `shared/hooks/useArrowKeyList` — WAI-ARIA roving-tabindex helper for
  listbox/tree/grid surfaces (ArrowUp/Down, Home/End, Enter/Space).
- `shared/hooks/useEditableTargetGuard` — `isEditableTarget(target)`
  guards global keyboard shortcuts from stealing keystrokes in
  `<input>`, `<textarea>`, contentEditable, Monaco, or xterm.
  Wired into `useKeyboardShortcuts`.

Motion:
- App wrapped in `<MotionConfig reducedMotion="user">` so all
  `motion/react` springs (CommandPalette / QuickOpen / WelcomeScreen /
  SearchPanel / PRInspector / WebInspector / OnboardingOverlay) honor
  the OS preference.
- Global `@media (prefers-reduced-motion: reduce)` now also zeroes
  hover `transform` so opted-out users don't get snap-pop on hover
  lifts.
- Hardcoded `0.1s` / `0.15s var(--ease-out)` / `0.2s ease` swept from
  5 module files + 5 dialog entrance animations to the token-driven
  `--duration-* var(--ease-apple)` pattern.

Typography + color + icon discipline:
- 76 raw `font-size: 10/14px`, `font-weight: 400/500/600`, and
  `line-height: 1.4/1.5` replaced with tokens across 29 module files.
- 23 lucide `size={8/9/11/13/18}` calls collapsed to the 10/14/20
  canonical tiers across 10 files.
- `font-variant-numeric: tabular-nums` added to numeric columns
  (StatusBar repair counts, TerminalInfoBar meta/cost, Analytics
  metric/stat/tool value/count).
- WatchdogBadge / MarkdownPreview raw Catppuccin hex → token refs
  via `var(--ctp-*)` / `var(--gold)` / `var(--white-*)`.
- Gold-decorative ornaments on WelcomeScreen (projectCard hover,
  dropZoneActive, projectAvatar) + AboutDialog logo demoted to
  neutrals; gold reserved for interactive/CTA.
- Purple drift outside Helm cleaned (About + Welcome leak sites).

New `<EmptyState>` / `<LoadingSkeleton>` deployments (5 surfaces):
PRInspector, SearchPanel, GhostDiffPanel get proper empty states;
PRInspector + SearchPanel loading states now skeleton-animate
instead of plain text.

PanelHeader retrofit:
- PRInspector: inline header → `<PanelHeader title count actions>`.
- GhostDiffPanel: `<PanelHeader leadingIcon title subtitle>`.
- SCMPanel: new header above branch bar.
(SubagentList retrofit deferred — lives inside ConductorView.)

Async state contracts:
- `Button.module.css` `.btn[aria-busy="true"]` — opacity dim +
  shimmer overlay via global `shimmer` keyframe.
- SCMPanel commit/push buttons now carry `aria-busy={isCommitting}`
  / `aria-busy={isPushing}`.
- `.input[aria-invalid="true"]` red border + 1px red shadow added to
  PromptDialog / Settings / Watchdog input styles.

### Added

- **Shared UI primitives**
  - `shared/ui/GitStatusPip` — unified M/A/D/R/?/! vocabulary with `letter`
    and `dot` variants, non-color differentiation for deleted (ring) and
    untracked (hollow) addresses the a11y "color-only" concern. Consumed by
    SCMPanel and FileTree.
  - `shared/ui/PanelHeader` — single primitive for right-panel headers with
    title / subtitle / count / leadingIcon / actions / collapsible slots.
    Rolled out to KanbanBoard, HelmPanel, ToolkitPanel, InlineResultPanel,
    WorktreeManager.
  - `shared/lib/fontStack.ts` — `getMonoFontStack()` resolves `--font-mono`
    at runtime so Monaco consumers no longer hardcode the font family.
  - Dialog design tokens (`--radius-dialog`, `--radius-panel`, `--scrim-*`,
    `--dialog-width-xs|sm|md|lg`, `--dialog-surface`, `--dialog-surface-blur`).
  - `--row-hover` / `--row-hover-strong` tokens retrofitted across 9 list
    surfaces (SCM, Kanban, Helm, Toolkit, SubagentList, FileTree,
    CommandPalette, QuickOpen, HistorySearch, RepairJobs).
- **DiffViewer overhaul** — split/unified segmented toggle, "No changes to
  show" empty state, binary-content guard (NUL-byte scan on the first 8KB),
  too-large-file guard (>1MB), theme registered in `beforeMount` so the
  editor no longer flashes light on first paint, `onGlyphMarginClick` prop
  for host-driven comment affordances.
- **EditorPanel** — now routes diffs through `DiffViewer` (removed the
  duplicate inline `DiffEditor`), empty state when no file is open, comment
  badges swap 🔧/✓/💬 for Lucide Wrench/Check/MessageSquare.
- **PRInspector card** — renders `state` pill (open/draft/merged/closed),
  author, CI rollup (passing/failing/pending/none), review decision
  (approved/changes/commented/requested), and relative `updatedAt`. Backend
  `list_pull_requests` extended to fetch `isDraft`, `updatedAt`,
  `reviewDecision`, and `statusCheckRollup` from `gh`.
- **SCMPanel** — commit textarea `rows=3` with autogrow (160px cap), new
  branch bar showing the current branch, upstream target, and ahead/behind
  pills (`ArrowUp` / `ArrowDown` Lucide icons). Renamed files classify into
  a dedicated "Renamed" group. Backend `git_status` returns `upstream`,
  `ahead`, `behind` via `graph_ahead_behind`.
- **WorkflowBuilder** — "Save" and "Save & Run" CTAs. Saving via the latter
  routes through a ref so the workflow starts immediately after writing.
- **FileTree** — full WAI-ARIA treeitem semantics (`role="treeitem"`,
  `aria-level`, `aria-expanded`, `aria-selected`, `aria-setsize`,
  `aria-posinset`, roving tabindex); arrow-key navigation
  (↑/↓/←/→/Home/End/Enter/Space) with scroll-into-view; fixed-height
  virtualization past 200 rows with a 12-row overscan (no new deps).
- **Welcome screen** — resting drop zone visible before drag, greeting
  fallback for anonymous users, `has_changes` indicator dot on recent
  project cards.
- **StatusBar** — branch promoted as the eye-anchor of the left cluster;
  actionable Wrench / Layers buttons separated from passive spans with
  vertical separators.
- **AboutDialog** — version now reads from `package.json` (was hardcoded
  `0.1.0`).
- **OnboardingOverlay, SessionAnalytics, QuickOpen** — migrated to Radix
  Dialog (focus trap + Escape + proper `Dialog.Title` / `Dialog.Description`).

### Changed

- **UI tokens & spacing** — three coordinated sweeps (BLOCK / HIGH / AMBER)
  closed all 8-axis regressions: fake-bold → Geometric weights, `text-muted
  + opacity` fixes, custom-modal bypass cleaned up, magic z-indexes
  replaced by `--z-*` scale, nested blur layers flattened.
- **ProjectHeaderBar** — icon buttons stretch-aligned to the full 48px
  title bar; 1px separator between app actions and window controls;
  `.changes` muted so it no longer competes with the project name.
- **AgentInspector**
  - Tabs (Conductor / Diffs / Parallel) gained text labels alongside icons.
  - Selected tab marked by a 2px gold border-bottom + focus ring.
  - SessionCard status row capped at 5 visible chips — permission mode and
    detected port fold behind a `MoreHorizontal` overflow with a native
    tooltip. `📎` → Lucide Paperclip, `⚡` → Lucide Zap (applied to both
    `SessionCard` and `InteractiveSessionCard`).
- **Workflow gate buttons** — `✓` / `✗` text replaced with Lucide Check/X
  in 22px tap targets with focus rings and `color-mix` hover.
- **KanbanBoard** — cards now set an explicit drag image pinned to the
  card at the grab point; columns render a pulsing gold drop-placeholder
  while a drag is hovering.
- **Plus icon** sizing normalized to 12px across panel-header add buttons
  (Kanban, Helm, Toolkit, AgentInspector, WorkflowBuilder, Worktree,
  Watchdog). Inline SCM stage buttons stay at 10px (intentional row
  density).
- **QuickOpen** chrome made identical to CommandPalette (same surface, blur,
  border-radius, positioning, shadow, border token).
- **MarkdownPreview iframe** — element background painted with
  `var(--aether-bg)` so the iframe no longer flashes white between mount
  and first paint.
- **WorktreeManager** — header routed through `PanelHeader`; worktree
  delete actually deletes (was a no-op).

### Fixed

- **Safety**
  - Toolkit dangerous-command detection now catches `rm -rf /` variants
    (including 1-character typo regressions flagged by the per-feature
    audit).
  - Welcome screen no longer ships developer-machine paths in
    `SCAN_DIRS`; platform-appropriate defaults come from Rust
    (`default_project_scan_dirs`).
- **ReactFlow chrome** (ConductorView / WorkflowBuilder) — selection state
  now visible, edge arrows rendered, nested blur removed.
- **RepairJobsPanel** — previously referenced an undefined `--radius-md`
  custom property.
- **OnboardingOverlay** — magic `margin-left: 280px` / `margin-right:
  300px` removed; overlay now uses `PromptDialog` chrome (`rgba 0.92` +
  radius-lg + `blur(20px)` + `ease-out` entrance).

### Backend / API

- **Phase 3D-1 v2a** — CORS allowlist + per-IP rate-limiting for the WS
  bridge.
- **Phase 3D-1 v2b** — upgrade-ticket WebSocket authentication
  (single-use, time-bound tickets via `subtle`).
- **Phase 3D-1 v2c** — `PtyManager` broadcast fan-out so multiple
  subscribers share a single reader.
- `PtyManager::contains` — O(1) existence check for IPC hot paths.
- PTY reader shutdown flag, WS write timeout, and regression tests added
  in v2c review pass.

### Tooling

- **`biome.json`** — migrated from 1.x config schema to 2.x
  (`assist.actions.source.organizeImports`, `files.includes` negation
  globs). Biome was non-runnable in the prior state.

### Verification

- `vitest run` — 627 / 627 PASS (+23 new tests for the primitives added
  this release: `flattenVisible`, `GitStatusPip`, `PanelHeader`,
  `getMonoFontStack`).
- `tsc --noEmit` — clean
- `cargo check` — clean
- `cargo test --lib` — 298 / 298 PASS
- `pnpm build` — clean
- `cargo build --release` — clean

### Lint baseline

- `biome format --write src/` normalised line endings (CRLF → LF on 220
  files) and whitespace across every `.ts` / `.tsx` / `.css` in `src/`.
- `biome check --write src/` applied safe autofixes on 147 files (mostly
  `assist/source/organizeImports`).
- Real a11y / correctness fixes in `App.tsx`: editor-tab invalid button
  nesting split into `<div role="tab">` + inner `<button type="button">`
  with keyboard activation; landmark `role` attributes replaced with
  semantic elements (`<nav>`, `<section>`, `<aside>`, bare `<main>`).
- `biome.json` demotes `noNonNullAssertion` + `useTemplate` to warn (the
  remaining callsites are deliberate guard-rails in test code) and
  disables `noImportantStyles` entirely (remaining `!important` usages
  are legitimate focus-ring / reduced-motion / Monaco-inline overrides).
- Lint baseline: 593 errors → 227 (mostly `noNonNullAssertion` warnings
  in test helpers). Further churn deferred.

### Known follow-ups

- IME canvas integration (half-width/full-width candidate positioning,
  commit text → PTY, persistent `IMEInputBar` toggle) still needs a
  live-build smoke test on Windows before this patch can be tagged.

## [0.2.0] — 2026-04-18

Initial bundled release on `refactor/tauri-react-migration`. Phase 1
(split panes, block output, IME, agent UI), Phase 2 (native Rust
terminal engine, xterm.js removal), and Phase 3 MVP (A/B/C) complete.
Phase 3D-1 v1 API scaffolding (auth / resize / shutdown / typed errors
/ session cap) landed as `430a053`.
