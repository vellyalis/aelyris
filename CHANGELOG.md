# Changelog

All notable changes to Aether Terminal are tracked here. Dates are listed in
`YYYY-MM-DD`. Commit hashes reference `refactor/tauri-react-migration`.

## [Unreleased] — post-0.2.2 Tier 1 closure

Three commits closing every remaining Tier 1 (senior-blocker) item from
`docs/ROADMAP_POST_0_2_2.md`. After this set the senior-bar audit list
contains only Tier 2 polish.

### Reliability

- **PTY crash recovery** (`74bbb60`) — `ConPTY` child exit is now
  observable: `PtyManager` retains the boxed `Child`, the IPC layer
  spawns a waiter that calls `wait()` and emits `pty-exit-<id>` with a
  typed `ExitInfo { code, crashed }` payload (NTSTATUS heuristic on
  Windows). `respawn_terminal` IPC + frontend banner restart the shell
  in place; `NativeTerminalRegistry::create` is now idempotent so prompt
  marks + scrollback survive across the crash boundary.

### UX

- **Shell integration installer** (`4ebdc5c`) — Settings panel surfaces
  per-shell install state (PowerShell / Bash / Zsh). Embedded scripts
  are written to `~/.aether/shell-integration/` and a single `source`
  line is appended to the user's profile, gated by an install marker
  for idempotency. Risk hedge from the roadmap honoured: install fires
  only on explicit click, with a "Copy line" alternative for users on
  non-standard profile paths.

### Distribution

- **Auto-updater wiring** — `tauri-plugin-updater` is registered with a
  placeholder pubkey + `https://updates.aether.invalid/...` endpoint.
  `bundle.createUpdaterArtifacts = true` so a signed `.sig` lands next
  to each NSIS / MSI installer when Tauri sees a private signing key in
  the environment. New surfaces: `<UpdateBanner>` at the top of the app
  (auto-check, silent on errors), Settings → Updates → "Check for
  updates" (surfaces errors verbatim), `scripts/setup-updater-keys.mjs`
  (one-time keypair generation under gitignored `.aether-updater/`),
  `scripts/generate-update-manifest.mjs` (writes `latest.json` next to
  the bundles). Local-only by default — see `docs/auto_updater_setup.md`
  for the full release flow.

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
