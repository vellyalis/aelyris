# Changelog

All notable changes to Aether Terminal are tracked here. Dates are listed in
`YYYY-MM-DD`. Commit hashes reference `refactor/tauri-react-migration`.

## [Unreleased]

Continuing the post-0.2.3 Tier 3 polish run started with
`247e813` (search-in-scrollback, Tier 3 #9).

### UX

- **Codex round 5 — close lifecycle two-bug pair.** Review of the
  pre-terminal-sweep polish range (`2cb99e7`..`c1a0a44`) caught
  two bugs in the window-close hardening that earlier rounds had
  missed:
  - **`core:window:allow-destroy` was missing.** When
    `App.tsx`'s `onCloseRequested` doesn't `event.preventDefault`,
    Tauri internally calls `Window.destroy()` to actually tear
    the window down. We had granted `core:window:allow-close`
    (the close-request) but `core:default` does not include
    `allow-destroy`, so the destruction step was being denied —
    the close request was acknowledged but the window would stay
    open in the no-unsaved-files happy path. Granted explicitly.
  - **Hard-stop disarmed too early.** The `Promise.race(close,
    timeout)` set `closed = true` when `win.close()` resolved,
    but `close()` resolves on the close-*request* ACK, not when
    the window is actually destroyed. So in the very stalled-
    listener scenario the timeout was meant to cover, the IPC
    resolved fast, the timeout was skipped, and the user was
    still stuck. Restructured: kick `close()` (fire-and-forget),
    `await` the unconditional 800 ms timer, then `process.
    exit(0)`. exit() is a no-op if the renderer is already
    gone, so the happy path is unchanged; the stall path now
    actually escalates.

- **Codex round 4 — Windows resource double-compile + IME re-anchor
  on focus return.** Codex review of the dogfood S-tier fix range
  (`7e4aea8`..`8f03c74`) flagged two real regressions the
  in-session work introduced:
  - **`build.rs` was compiling Windows resources twice.**
    `tauri_build::build()` already invokes `tauri-winres`
    internally on Windows and writes the same
    `OUT_DIR/resource.lib`. The custom `tauri_winres::
    WindowsResource` step we added in `8f03c74` ran first, then
    Tauri's path overwrote the file — the linker received
    duplicate resource inputs and our metadata could be lost
    depending on link order. Removed the custom step; metadata
    now flows exclusively through `tauri.conf.json bundle`
    (`productName` / `publisher` / `copyright` / `category`),
    which Tauri's built-in path already reads. Dropped the
    `tauri-winres` build-dependency to keep the surface
    minimal.
  - **`useImePosition` left stale IMM coordinates after a
    focus return from IMEInputBar.** The previous "fire on
    cursor move only" path didn't re-emit `set_ime_position`
    when the user focused the canvas textarea without moving
    the PTY cursor — the IMM context kept the IMEInputBar's
    coordinates and the next canvas IME composition popped its
    candidate window at the bottom-right again. Centralised
    the push into a `pushImePosition` callback and registered
    `focus` / `compositionstart` listeners on the textarea so
    every transition into canvas-typing re-anchors IMM.

- **`SplitPane` clamp now handles `total < 2 * minSize`.** Codex
  re-review (round 2) flagged that the keyboard-resize fix still
  blew up on a SplitPane narrower than `2 * minSize` (e.g. a
  150-px nested terminal split with default `minSize = 100`):
  `min = 100/150 = 0.667` while `max = 1 - 100/150 = 0.333`, so
  `min > max` and the naive `Math.max(min, Math.min(max, x))`
  collapsed every input to a single value (`min = 0.667`),
  ignoring direction. The pointer drag had the same hidden bug
  going back to the original implementation. Extracted a single
  `clampRatio(raw, total)` helper used by both input paths that
  detects the unsatisfiable case and returns `0.5` (centred
  split, both panes get `total / 2` even if neither hits
  `minSize`); otherwise applies the standard min/max clamp.

- **Two regressions caught by Codex review and fixed.** External
  review of the recent terminal sweep flagged two real
  accessibility bugs introduced earlier in the session:
  - **`SplitPane` keyboard nudge ignored `minSize`.** Pointer
    drag clamped to `minSize / total` (default 100 px) but the
    new Arrow-key path used a hard-coded 5 % / 95 % floor —
    keyboard could shrink panes well below the 100 px the mouse
    couldn't. Now reads the live container size and applies the
    same `minSize / total` clamp.
  - **Scrollback "Live" pill was unreachable by keyboard.** The
    canvas wrapper's `onFocus={focusTextarea}` is a bubbling
    React event, so when Tab landed on the pill the wrapper's
    handler instantly redirected focus to the hidden textarea.
    Guarded with `e.target === e.currentTarget` so only direct
    focus on the wrapper forwards; child focus stays put.

- **WorkspaceTabs — distinguishable active state + reduced-motion
  opt-out.**
  - Hover and active had identical `--white-6` background. The
    only difference was text colour, which read as the same tab
    level on glance and made it impossible to tell which tab was
    actually selected. Active now uses a stronger `--white-10`
    fill plus a 1-px gold underline (Chrome / VS Code tab
    convention). Hover stays at the lighter `--white-4`.
  - `.activityDot` ran `statusBreathe` infinitely without
    respecting `prefers-reduced-motion: reduce`. Added the
    media-query opt-out so vestibular-sensitive users get a
    flat dot.

- **`usePaneTree.close` now refocuses a sibling instead of
  blanking the active state.** Closing the active pane with 3+
  panes left `activePaneId = null` until the user clicked
  somewhere else — meanwhile the gold-rule indicator went dark
  and the StatusBar inline-image badge lost its target. Now
  picks the first remaining leaf as the new active pane.

- **Exit banner Esc honours the on-screen hint regardless of
  focus.** Hint reads "Press Enter to restart, Esc to dismiss"
  but the previous wiring only listened on the button's
  onKeyDown. If the user clicked the canvas to scroll back
  through the crash output, focus left the button and Esc no
  longer dismissed the banner. Added an area-scoped Escape
  listener active only while `exitInfo` is non-null.

- **TerminalInfoBar polish — vertical-centred icons, token-only
  colours.**
  - `.toggleBtn` was a baseline-aligned inline button with text-
    base font sizing; the 12-px Lucide icons inside ended up a
    pixel offset from the bar's vertical centre depending on
    the font's ascender. Switched to `inline-flex` +
    `justify-content: center` with explicit `18×18` square hit
    target, so every icon sits dead-centre in the 22-px bar.
  - `.lagBadge` background was `rgba(250, 179, 135, 0.12)` —
    a hardcoded peach RGBA. Routed through `color-mix(in srgb,
    --ctp-peach 12%, transparent)` so a future palette swap
    propagates cleanly.
  - `var(--ctp-peach, #fab387)` and `var(--ctp-red, #f38ba8)`
    fallback hex literals dropped — both tokens exist in
    global.css so the fallbacks were dead duplicates.

- **Jump-to-live pill on scrollback.** When the user scrolled up
  via mouse wheel, there was no visible way back to the live
  tail — only the (undiscoverable) Ctrl+Shift+End keybinding.
  Added a gold-tinted glass pill anchored bottom-right of the
  canvas: appears only while `scrollOffset > 0`, click =
  `scrollback.scrollToLive()`. Same action as the existing
  shortcut, just with a discoverable surface.

- **Timeline empty-state message corrected.** The "No snapshots
  yet — press Enter to capture" copy was a leftover from an
  earlier design — Enter just sends `\r` to the PTY, snapshots
  capture on prompt marks or via the Mark button. Replaced with
  "click Mark to bookmark, or run a command".

- **Cursor blink — slower, asymmetric duty cycle, respects
  reduced-motion.** The previous 500/500 ms hard toggle felt
  jarring (50/50 strobe). Switched to an Apple-style 600 ms ON
  / 250 ms OFF asymmetric cycle so the cursor reads as "always
  there, just briefly winking" instead of a strobe.
  Additionally, `prefers-reduced-motion: reduce` users get a
  solid cursor — matches macOS Terminal / iTerm2 / Windows
  Terminal accessibility behaviour.

- **Single-pane active indicator now shows on first paint.**
  `usePaneTree` initialises `activePaneId = null` and only sets
  it on the first explicit click. With one pane that meant
  `null === leaf.id` was always false, so the gold-rule active
  indicator added in the previous sweep never appeared even
  though that pane *was* the only place keystrokes landed.
  Treat the lone leaf as implicitly active — same fallback
  `PaneTreeContainer.activeTerminalId` already used for the
  inline-image budget badge.

- **SplitPane drag handle — gold accent, PointerEvent, a11y.**
  Three problems found in `src/shared/ui/SplitPane`:
  - **Hover lit up `--accent` (turquoise blue)** while every
    other resize handle in the app (left-panel, right-panel,
    workflow, settings) lights up gold. Aligned to `--gold-dim`
    so every drag handle in the app feels identical.
  - **Mouse-only.** The handler chain was
    `mousedown / mousemove / mouseup`, so touch and pen input
    couldn't resize the split. Migrated to `pointerdown` +
    `setPointerCapture`, matching the left-panel and right-
    panel handles.
  - **Keyboard users locked out.** No `tabIndex`, no role, no
    keyboard nudge. Added `role="separator"`,
    `aria-orientation`, `aria-valuemin/max/now`, `tabIndex={0}`,
    and Arrow-key nudge (2 % step / 8 % with Shift). Now
    matches the WAI-ARIA pattern the sidebar handles already
    follow. `:focus-visible` lights the same gold-dim
    background.

- **Terminal pane sweep round 3 — search bar, exit banner, PTY
  cell-width, and dead CSS.** Continued line-by-line review:
  - **`CELL_W = Math.round(FONT_SIZE * 0.6) = 8` was used to
    compute `cols` for the PTY (`Math.floor(paneWidth / 8)`),
    but the actual IBM Plex Mono advance is **8.4 px**. The PTY
    received an inflated `cols` count (≈ 5 % over) and emitted
    wraps that bled past the pane edge. Same sub-pixel drift
    family as the rendering fix in `7e4aea8` — switched to a
    one-shot `ctx.measureText("M")` at module load so the
    layout / spawn / resize calls all agree on the same advance
    that `TerminalCanvas` is painting at.
  - **Search bar arrows / close were literal Unicode chars
    (`↑`, `↓`, `×`)** sized at `var(--text-xl)` (≈ 18-20 px).
    The rest of the app uses Lucide icons at 12-14 px.
    Replaced with `<ChevronUp>` / `<ChevronDown>` / `<X>` at
    `size={14}`, gave the buttons a fixed 24×24 hit target.
  - **Search bar ARIA labels were Japanese (`前のマッチ` etc)
    while the rest of the app uses English aria attributes**
    — converged on English so screen-reader output is
    consistent. Visible UI still localises where it should.
  - **No "no match" feedback on search.** A typo and "still
    typing" looked identical. Match counter now flips to
    `--ctp-red` via `data-empty="true"` when the query is
    non-empty but `0` matches found, the VS Code / Sublime
    convention.
  - **`.exitBannerCrashed` only flipped text + bottom-border
    colour** — a SEGV looked almost identical to a clean
    `exit 0`. The whole strip now tints red via
    `color-mix(in srgb, --ctp-red 14%, --aether-bg-elevated)`.
    Replaced the non-existent `--danger` token (with hex
    fallback) with the actual `--ctp-red`.
  - **`.exitBannerBtn:disabled` had no visual treatment** —
    the button looked clickable while frozen during respawn.
    Added `opacity: 0.55` + `cursor: progress`.
  - **Dead `.historyBar` CSS class** (declared in
    `TerminalArea.module.css`, never used in any TSX)
    removed.
  - **Search input `outline: none` on `:focus-visible`** was
    dead code (lost the specificity battle to the global gold-
    ring rule with `!important`); rewrote to lean on the global
    ring AND tint the border for a stronger affordance.

- **Terminal canvas decoration alignment + named-constant audit.**
  Continuation of the pane sweep — three smaller bugs the first
  pass missed:
  - **Underline baseline drift across SGR-underline / link-hover
    underline / cursor's underline shape.** `drawDecorations`
    painted the SGR underline at `y + cellH - 2`,
    `paintLinkUnderline` at `y + cellH - 1` (1 px lower),
    `paintCursor`'s underline shape at `y + cellH - 2` but 2 px
    tall instead of 1. Hovering a link on an SGR-underlined word
    rendered a visible double-bar; a cursor parked on an
    underlined word painted a stacked pair instead of a single
    line. Extracted `UNDERLINE_INSET_FROM_BOTTOM = 2` constant
    and routed all three paths through it. Cursor's underline
    shape stays 2 px tall (vs 1 px decoration) so it remains
    distinguishable as the cursor.
  - **`paintGhostSuggestion` was hardcoding `#cdd6f4`** even
    though `ansiPalette.ts` already exports the same value as
    `DEFAULT_FG`. Routed through the named constant so a future
    palette swap doesn't need a hex grep.

- **Terminal pane quality sweep — silent UX bugs and dead chrome
  found by review pass.** Self-audit triggered by dogfood "still
  many low-quality areas around the terminal":
  - **Active pane indicator was wired but unused.**
    `TerminalInfoBar` accepted `isActive` from `PaneTreeRenderer`
    and immediately discarded it (`isActive: _isActive`,
    underscore-prefixed = explicitly unused). With splits, both
    panes looked identical regardless of keyboard focus — the
    most basic split-pane affordance was missing. Wired the prop
    to `data-active`; the bar now shows a 1-px gold rule along
    its top edge, a translucent glass background, and a
    gold-tinted shell label when focused. Same convention VS
    Code / Linear / Warp use.
  - **`hollowBlock` cursor was painted as a filled block.**
    Alacritty emits `HollowBlock` when OS focus leaves the
    window — every modern terminal (iTerm2, Terminal.app,
    Windows Terminal) renders this as a 1-px outline so the
    user can tell "I clicked elsewhere". We rendered it
    identically to `block`, silently losing the signal. Now a
    proper `strokeRect` outline (with 0.5-px coordinate inset
    so a 1-px stroke sits crisply on the pixel grid).
  - **`.toggleBtnActive` referenced but never defined.** The
    sync-input toggle (`<ArrowLeftRight>` icon) used
    `${syncMode ? styles.toggleBtnActive : ""}` — but the class
    didn't exist in `TerminalInfoBar.module.css`. So the toggle
    silently rendered identical to the inactive state. Defined
    the class with a gold-subtle background tint and gold
    foreground.
  - **Dead `:global(.xterm)` rules removed.** `TerminalArea.
    module.css` carried two rules (`.xterm` /
    `.xterm-viewport` background-transparent) that targeted DOM
    elements xterm.js used to inject — but xterm was excised in
    Phase 2 (`d4df53a`), so the selectors haven't matched
    anything in months. Dropped, plus updated the
    `.terminalContainer` comment to stop citing xterm's
    CompositionHelper as the rationale for padding (the native
    canvas/IME path doesn't use it).
  - **`padding: 0 8px` hardcoded** in TerminalInfoBar replaced
    with `var(--space-2)` so the bar follows the same spacing
    rhythm as every other surface.
  - **`border-bottom`** harmonised between TerminalInfoBar and
    TimelineBar — both were using different tokens (`--border`
    vs `--white-6`) for the same hairline, now both use
    `--white-6` so they read as one continuous chrome stack.
  - **`exitDot` "glow" comment** rewritten to reflect the
    actual implementation (a 1-px ring, not a blur).

- **Click in the terminal no longer leaves a 1-cell dark
  rectangle behind.** Dogfood: a single click in the terminal
  pane left a visible artefact at the click position that the
  user marked "ダサい". `useTerminalSelection.onMouseDown` was
  calling `setSelection({ anchor: point, focus: point })`
  unconditionally — a zero-width range that the renderer painted
  as a single-cell selection band. Fixed by deferring selection
  creation until `onMouseMove` actually leaves the anchor cell:
  - `pendingAnchorRef` stages the click anchor without
    materialising a selection.
  - `onMouseMove` upgrades to a real selection only when the
    focus cell differs from the anchor (first detectable drag
    step).
  - `onMouseUp` without movement clears any prior selection,
    matching native text-editor behaviour: a stray click
    cancels rather than re-pins the previous range.
  - Shift-click still extends immediately (deliberate range
    gesture).

- **Windows resource metadata embedded into the dev .exe so Task
  Manager actually shows "Aether Terminal".** Dogfood: trying to
  end a hung process from Task Manager turned up nothing matching
  "aether" because `cargo run` builds skip resource embedding —
  `tauri-build` only emits the metadata for release bundles. The
  user couldn't identify the process to kill. Fixed by adding a
  `tauri-winres` step in `build.rs` that runs unconditionally on
  Windows, embedding `ProductName`, `FileDescription`,
  `OriginalFilename`, `CompanyName`, `LegalCopyright`,
  `InternalName` and the bundle icon into the .exe. Also
  enriched `tauri.conf.json bundle` with `publisher`,
  `copyright`, `shortDescription`, `longDescription`, `category`
  so release builds are at least as identifiable.

- **IME candidate window now anchors next to the textarea you're
  actually typing in.** Dogfood: typing into `IMEInputBar` (the
  pane's bottom input strip) made the OS IME prediction popup
  appear in the bottom-right of the window over the right-panel
  — way off from the user's caret. Two compounding causes:
  - **Canvas hook over-fired the window-wide IMM IPC.**
    `useImePosition` is meant for the canvas-embedded hidden
    textarea but called `set_ime_position` on every PTY-cursor
    move regardless of focus. `set_ime_position` writes the
    **window-wide** IMM context via `ImmSetCompositionWindow` /
    `ImmSetCandidateWindow`, so once it fires the coordinates
    persist for *every* focused text input — when the user
    clicked into IMEInputBar, the OS still anchored the
    candidate list at the PTY caret. Guarded the IPC behind a
    `document.activeElement === textarea` check; we now only
    steer IMM while our hidden textarea actually owns focus.
  - **IMEInputBar didn't claim its own IME anchor.** WebView2
    has the documented textarea-IME positioning bug the canvas
    hook was originally written to bypass — IMEInputBar suffers
    from the same bug whenever the canvas previously left a
    stale IMM coordinate behind. Added a `compositionStart`
    handler on IMEInputBar's textarea that calls
    `set_ime_position` with its own caret-line position, so
    every composition session starts anchored to the right
    place.

- **Window close hardened — 800 ms hard-stop fallback.** Even
  with the `core:window:allow-close` capability the close path
  could stall indefinitely if `App.tsx`'s `onCloseRequested`
  callback awaited an IPC (window position fetch) that the busy
  Tauri runtime never resolved. `handleClose` now races
  `window.close()` against an 800 ms timeout; if the close
  hasn't completed in that window we fall through to
  `process.exit(0)`. Both branches log to console (no more
  silent swallow). User now has a guaranteed escape regardless
  of which leg of the lifecycle is hung.

- **Terminal text rendering — sub-pixel drift fixed, CJK glyphs
  no longer collide.** Dogfood screenshot (2026-05-03) showed a
  PowerShell pane with `gemini -m gemini-1.5-flash-8b "あなた…"`
  rendering as a garbled mess where Japanese characters
  overlapped each other and the trailing prompt was unreadable.
  Two compounding bugs:
  - **Cell-width was 8 px when IBM Plex Mono's actual advance is
    8.4 px at fontSize 14.** `Math.round(fontSize * 0.6) = 8`
    was chosen as a "good enough" heuristic; in practice every
    `ctx.fillText(ch, col * 8, …)` call painted ASCII glyphs
    at their natural 8.4-px advance. Cumulative drift hit
    **11.99 px after 30 cells** (≈ 1.5 cell widths) — measured
    in Vite preview against the live font. By the time the
    prompt reached column 30, every subsequent glyph started
    painting *inside the previous glyph's right edge*. CJK
    fallback fonts at full-width amplified the visual collision.
    Fix: derive `cellMetrics.width` from `ctx.measureText("M")`
    on the actual `<canvas>` and pass the unrounded float
    through every `col * width` expression. Sub-pixel positioning
    rasterises crisply; the `<canvas>` bitmap-attribute width
    ceils to keep the rightmost column unclipped.
  - **No CJK font in the fallback chain.** `'IBM Plex Mono',
    'Cascadia Code', monospace` carries no Japanese / Chinese /
    Korean glyphs, so the browser substituted a system
    proportional font (Yu Gothic / Meiryo on Windows) whose
    advance is wider than our 2-cell `WIDE_CHAR` slot. Fixed by
    appending `'BIZ UDGothic', 'Yu Gothic UI', 'Meiryo', 'Noto
    Sans Mono CJK JP'` to the chain (genuine monospace at common
    sizes) and clamping every glyph with `ctx.fillText(ch, x, y,
    cellW)` so even a non-monospace fallback is squeezed into
    its allocated 1- or 2-column slot. Same `maxWidth` clamp now
    applied to the cursor's inverted-glyph repaint and the
    ghost-text path.
  - Vite preview verify: `ctx.measureText('abcdefghijklmnopqrstuvwxyz0123')` reports drift `11.99 → 0 px` after the
    fix.

- **Window close button now actually closes.** Dogfood: "× クリックで
  閉じれない." `core:window:allow-close` was missing from
  `src-tauri/capabilities/default.json`, so the JS-side
  `getCurrentWindow().close()` fallback inside `handleClose`
  threw an `AccessControlNotAllowed` error that the bare `catch
  {}` swallowed. The primary path used `process.exit(0)` which
  bypasses `App.tsx`'s `onCloseRequested` handler — meaning even
  when it *did* work, the unsaved-files prompt was skipped.
  Fixed by:
  - Adding `core:window:allow-close` to the capability list.
  - Reordering `handleClose` to try `window.close()` first
    (which fires `onCloseRequested` so unsaved files get the
    confirm dialog) and only falling back to `process.exit(0)`
    if the window plugin throws — and now both branches log the
    failure to console instead of swallowing it silently, so
    the next regression surfaces immediately.

- **Focus-ring offset audit — three valid tiers, two documented
  exceptions, no more dial-in stragglers.** Dogfood: "tab-cycling
  through the chrome, half the rings sit 1 px outside, a third
  inset by 2, a few hop to -3 — looks like nobody owned the
  convention." Audit pass:
  - **Outside default `1px`** (15 sites, the global `input /
    textarea / button / [role=button]:focus-visible` rule and
    matches across panels) — kisses the element edge, used for
    standalone inputs / buttons / cards.
  - **Outside emphasised `2px`** (8 sites) — hero buttons /
    dialog action rows where the ring needs to read at a glance
    against busy surfaces.
  - **Inside `-2px`** (13 sites, was 9 + 4 normalised) — for
    items in clipping containers (list rows, segmented controls,
    header buttons flush with a glass edge).
  - **Stragglers normalised to `-2px`**: `.trigger` (Select),
    `.hamburger` (MenuBar), `.headerBtn` and `.ctrlBtn`
    (ProjectHeaderBar) — were `-1px` / `-3px`, now match the rest.
  - **Documented exceptions** stay: `WelcomeScreen.openBtn` keeps
    `3px` for hero-CTA prominence; `WelcomeScreen.dragOver` keeps
    `-8px` because it's a drop-zone affordance, not a focus ring.
  - Convention codified in a top-of-block comment in
    `global.css` so the next contributor doesn't redrift.
  - Vite preview verify: `document.styleSheets` walk found
    `.hamburger:focus-visible`, `.headerBtn:focus-visible`,
    `.ctrlBtn:focus-visible` all rendering `outline-offset:
    -2px` post-edit (was `-1px` / `-3px`).
  - `pnpm test`: **808** unchanged. `tsc --noEmit`: 0 errors.

- **Scrollbar unification — thin overlay across every panel.**
  Dogfood: "Firefox / new Chromium ship with a 15-px chrome bar
  on every panel — that's the loudest 'browser default' tell on
  the app, the radix Switch / Select work doesn't help if every
  list still has a Win32-grey gutter next to it."
  - **`*` selector for `scrollbar-width: thin` +
    `scrollbar-color`.** Both properties are non-inherited, so
    the previous `:root` rule only styled `<html>` itself; every
    `<div>`, `<aside>`, `<nav>` descendant fell back to OS chrome.
    Chromium 121+ supports `scrollbar-width` natively, so the same
    declaration now lights up Firefox **and** modern Chromium /
    Tauri webview without a webkit pseudo-element fallback —
    measured: a `.right-panel` `getComputedStyle` reports
    `scrollbar-width: thin` post-fix, was `auto` before.
  - **`::-webkit-scrollbar` height set** — the old rule only
    declared `width`, so `.tabs`, `.editorTabsBar`, `.editorArea`
    and any other `overflow-x: auto` element rendered the
    OS-default ~12-px horizontal bar. Width and height now both
    10 px.
  - **macOS thumb-in-gutter trick** — `border: 3px solid
    transparent` + `background-clip: padding-box` paints the
    thumb 4 px inside a 10-px gutter, same pattern macOS /
    GitHub use. Comfortably hittable, never dominates narrow
    panels. Hover and `:active` states deepen the thumb (0.15 →
    0.28 → 0.4 alpha).
  - **`::-webkit-scrollbar-corner: transparent`** — the diagonal
    corner where horizontal and vertical bars meet was painting
    the OS default (light grey) on `.editorArea`. Now matches
    the rest of the surface.
  - Vite preview verify: a fresh `<div overflow-y:scroll>`
    appended to `<body>` now reserves **10 px** for the
    scrollbar (was 15 px). `:root` rule replaced with `*` after
    a controlled test confirmed inheritance was the root cause.
  - `pnpm test`: **808** unchanged. `tsc --noEmit`: 0 errors.

- **Native `<input type="checkbox">` purge — semantic-correct
  primitives per use case.** Final wave of the "old chrome" pass
  started with the radix Switch / Select rollout (`3c22539`).
  Three remaining native checkboxes were each replaced with the
  primitive that fits the *intent*, not a one-size-fits-all
  Switch:
  - **`RepairJobsPanel` "Watching / Disabled"** → `<Switch>`. A
    settings toggle (binary preference state for a feature) is
    exactly what Switch is for. Wires `onCheckedChange` straight
    through to the existing `onToggleEnabled` callback. ARIA
    label "Enable auto-repair watcher" so SR users hear the
    action verb, not just "switch".
  - **`HelmPanel` task-done check** → `Lucide Circle / CircleCheck`
    icon button (`role="checkbox"` + `aria-checked`). Apple
    Reminders / Things pattern. A 32×18 Switch per row would
    dwarf the task text and read as a settings cluster; the 14-px
    icon matches task-list density. Empty Circle = "open task",
    filled CircleCheck (gold accent) = "done". Hover lights up
    the rim, focus-visible draws a 2-px gold outline.
  - **`OrchestraDialog` role multi-select** → native checkbox now
    sr-only (`position: absolute; width: 1px; clip: rect(0,0,0,
    0)`). The surrounding `.role` card already carried selection
    via `.roleChecked` (border tint + 12 %-mix bg in the role's
    accent colour) — the input on top was redundant chrome. The
    label still wraps the input, so Space toggles via keyboard;
    `:focus-within` on the card draws the role-coloured outline.
    No semantic loss, much less visual noise.
  - Vite preview verify: native `<input type="checkbox">` count
    inside the open repair dialog → 0; switch role exists with
    `aria-checked="false"`, 32×18 px pill. OrchestraDialog: 4
    native inputs each clipped to 1×1 px with rect(0,0,0,0);
    clicking the role card flips `input.checked` *and* the card's
    `.roleChecked` class.
  - `pnpm test`: **808** unchanged (RepairJobsPanel + HelmPanel
    tests updated to query by `role="switch"` /
    `role="checkbox"` instead of `input[type=checkbox]`). `tsc
    --noEmit`: 0 errors.

- **Right panel drag-resize — symmetry with the sidebar.** Dogfood
  follow-up to the sidebar overhaul: "if the left rail has a real
  drag handle, the right rail can't ship with a browser-default
  triangular nubbin — that's the kind of inconsistency Apple
  doesn't ship." The right panel now uses the same JS pointer
  handle pattern as `.left-panel`:
  - **`rightPanelWidth` Zustand state**, persisted to
    `localStorage["aether:rightPanelWidth"]`, clamped to `[260,
    480]` (max bumped from the legacy `400` so the widest agent /
    workflow / toolkit / logs stack has the same headroom as the
    sidebar). Default 320.
  - **`.right-panel-resize-handle`** — 4 px-wide invisible hit
    area on the panel's *left* edge (mirror of the sidebar's
    right-edge handle), `cursor: col-resize`, gold-dim background
    on `:hover` / `:focus-visible` / `:active`. `pointerdown`
    captures, `pointermove` streams `setRightPanelWidth(startW -
    dx)` (sign inverted vs sidebar — handle on the *left* edge
    means dragging *left* widens), `pointerup` releases. Arrow
    keys nudge by 16 px / 64 px (Shift), inverted to match (Left =
    grow, Right = shrink).
  - **Old browser nubbin removed** — `.right-panel.resize:
    horizontal` plus the `direction: rtl` /  `> * { direction: ltr
    }` workaround it required are gone. Cleaner CSS, real
    keyboard accessibility (`role="separator"` +
    `aria-valuemin/max/now`), no more Win32-era control vibe.
  - **`flex-shrink: 0` added** so flex layout honours the inline
    width. The earlier `resize: horizontal` had the same blocker
    invisibly — dragging updated `style.width` but the centre
    column's min-content pulled it back to 320 px, so the user
    never actually got to grow the panel. The new handle plus
    `flex-shrink: 0` gives true ownership; min/max already
    enforced in JS. Inline style drives `flex-basis` *and* `width`
    — Chromium's `flex-basis: auto` did not re-resolve from a
    pure inline `width` change in this layout, so basis is set
    explicitly.
  - Vite preview verify: `getComputedStyle(right).flexShrink="0"`,
    `flexBasis="320px"`, `width="320px"`, layout 240+800+320 =
    1440 (was 240+880+320 before the shrink-fix); handle at
    `x=panel.x-2`, full panel height, `cursor=col-resize`. Drag
    test: `pointerdown→pointermove(-60)→pointerup` advanced
    `localStorage["aether:rightPanelWidth"]` from 320 → 380 and
    rendered 380 px in the next frame.
  - `pnpm test`: **808** (was 803, +5 new clamp / round / persist
    tests covering both `sidebarWidth` and `rightPanelWidth`).
    `tsc --noEmit`: 0 errors.

- **Edge-gap consistency — terminal well now has the same hairline
  on all four sides.** Dogfood: "the right side has no margin
  while the other three do — that's the kind of inconsistency
  Apple doesn't ship." The cause was two-fold:
  - `@media (max-width: 900px) { .right-panel { display: none } }`
    silently hid the right panel whenever the window dropped
    below 900 px (Tauri `minWidth` is 960 px so this rarely
    fired, but a one-off resize would expose it). Removed —
    same Win32-era responsive pattern we already excised from
    the left panel. Both panels are now strictly user-
    controlled (toggle / drag), no media-query overrides.
  - With the right panel hidden, `.center-panel` butted straight
    up against the window edge with no border to provide a
    visual gap (the other three sides borrowed their gap from
    `ProjectHeaderBar.border-bottom`, `.left-panel.border-
    right`, and `StatusBar.border-top`). `.center-panel` now
    owns its own `border-right: 1px solid var(--white-6)` so the
    gap is present whether or not the right panel is mounted.
    `.right-panel.border-left` removed so we don't stack two 1-
    px hairlines side-by-side.
  - Vite preview verify: `getComputedStyle(centre).borderRight`
    = `1px solid rgba(255, 255, 255, 0.06)`,
    `getComputedStyle(right).borderLeft` = `0px none`. Right
    panel renders (Toolkit visible) on every viewport now.
  - `pnpm test`: 803 unchanged. `tsc --noEmit`: 0 errors.

- **Split icons direction-true + IME bar refresh.** Dogfood:
  "the split icon is the wrong way around — I expect a vertical
  divider to mean 'split vertically' but it adds a pane to the
  right. Also the IME bar's height differs across panes and the
  whole strip looks dated."
  - **Split icons swapped** for `Columns2` (Add pane to the
    right) and `Rows2` (Add pane below). The previous
    `SplitSquareVertical` (a single vertical divider) was being
    read as "split vertically" — exactly the inverse of what the
    action does. The 2-column / 2-row icons preview the
    resulting layout silhouette directly. Tooltips moved to
    "Add pane to the right · Alt+Shift+→" / "Add pane below ·
    Alt+Shift+↓" so the action verb leads instead of the
    direction word.
  - **`IMEInputBar` modernised:**
    - **Resting placeholder** trimmed from the long "Enter で
      送信 / Shift+Enter で改行 / Esc でターミナル / ↑↓ で
      履歴" to "メッセージを入力" — long hint shows only when
      the bar gains focus and the input is still empty. Stops
      narrow panes (split-right ×2) from wrapping the strip to
      two lines.
    - **`Ctrl+Shift+J` chip** rendered as a `<kbd>` pill
      (`⌃⇧J`) that's invisible when resting and fades in
      (opacity + 2-px lift) on focus.
    - **Fixed 32-px bar height** across all panes —
      `align-items: center` + `min-height` instead of the old
      `align-items: flex-end` + auto-grown padding that made
      the bar's outer height differ between wide and narrow
      panes.
    - **IME indicator** is now a 18 × 18 mono-pill with the
      letter inside (matches macOS / Win11 system IME), gold
      tint while composing — replaces the standalone faded
      character that read as a typography artefact.
  - Vite preview verify: `aria-label='Add pane to the right'` /
    `aria-label='Add pane below'` confirmed; tooltips include
    the keyboard shortcut. Real IME bar styling needs `pnpm
    tauri:dev` to render (preview can't spawn a PTY) but the
    JSX + CSS land cleanly with no tsc errors.
  - `pnpm test`: 803 unchanged. `tsc --noEmit`: 0 errors.

- **Sidebar overhaul — collapsible sections (Warp/VS Code parity),
  drag-resize handle, smooth splash, default 240 px.** Dogfood:
  "the sidebar's small, panels can't fold, the splash flickers
  on open, and `<details>`-style fold/unfold would be smarter."
  Five connected fixes:
  - **`<CollapsibleSection>` primitive** (`shared/ui/`) on top of
    `@radix-ui/react-collapsible` (new dep). Header strip with a
    chevron that rotates on open, Radix's
    `--radix-collapsible-content-height` keyframe for smooth
    height interpolation, and per-section open state persisted to
    `localStorage["aether:section:<key>"]`. The chrome matches
    the sidebar typography (uppercase 12 px headers, gold focus
    ring).
  - **Sidebar wrapped in three sections**: Files (FileTree,
    default open), Tasks (KanbanBoard, default closed), Source
    Control (SCMPanel, default closed). The sections sit one
    above the next inside `<nav.left-panel>`; flex sizing makes
    the active section take the remaining height so its scroll
    region is the only thing that scrolls — same behaviour as
    VS Code's primary sidebar where Explorer expands to fill.
  - **Drag-resize handle**: 4-px hit area on the sidebar's right
    edge with `cursor: col-resize` and a gold-dim hover/active
    tint. `pointerdown` captures the pointer, `pointermove`
    streams `setSidebarWidth(startW + dx)`, `pointerup` releases.
    Arrow keys nudge by 16 px / 64 px (Shift). Replaces the old
    `resize: horizontal` with the browser-default triangular
    nubbin that read as a Win32 control.
  - **`sidebarWidth` Zustand state**, persisted to
    `localStorage["aether:sidebarWidth"]`, clamped to
    `[200, 480]`. Default bumped 180 → 240 px so the section
    headers and TODO labels in Kanban don't truncate.
  - **`@media (max-width: 700px) { .left-panel { display: none
    } }` removed.** It was silently overriding the explicit
    Ctrl+B / sidebar-button toggle on small windows — exactly
    the legacy Win32 responsive pattern modern apps (VS Code,
    Linear, Warp) avoid.
  - **Splash → React transition smoothed.** `index.html` now
    declares a 220 ms opacity fade on `#splash` keyed off
    `html[data-react-mounted="true"]`. `main.tsx` flips the flag
    in a `requestAnimationFrame` after `createRoot` and removes
    the splash node on `transitionend`. The flicker between
    "Aether Terminal Starting…" and the real chrome is gone.
  - Vite preview verify: `nav[aria-label='Project sidebar']`
    contains 3 `aria-expanded` triggers (Files / Tasks / Source
    Control). Toggling Tasks flipped `aria-expanded` false →
    true and persisted `aether:section:tasks=1`. Sidebar inline
    style is `width: 240px`. `splash` removed from DOM after
    React mounts, `html[data-react-mounted="true"]` set.
    Screenshot confirms 240-px sidebar with 3 sections + chevron
    rotation matches the Warp / VS Code pattern.
  - `pnpm test`: 803 unchanged. `cargo test --lib`: 473
    unchanged. `tsc --noEmit`: 0 errors.

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
