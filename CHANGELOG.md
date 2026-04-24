# Changelog

All notable changes to Aether Terminal are tracked here. Dates are listed in
`YYYY-MM-DD`. Commit hashes reference `refactor/tauri-react-migration`.

## [0.2.1] — unreleased

Focus: **Apple-class UI per-feature audit closure**. Two rounds of audit —
an 8-axis token pass (typography / spacing / color / interaction / motion /
material / a11y / rhythm) followed by a per-feature composition audit across
~42 surfaces — were fully landed. Groundwork from Phase 3D-1 v2 (API
hardening) and PTY refinements are also included.

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
