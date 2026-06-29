# Deferred: Sakura right-panel deep elements still slightly opaque

Status: **deferred follow-up** (user said "OK for now, right panel still a bit weak").
The user-visible top-level right-panel surfaces (mode-rail, widget-frames,
orchestra-command card, toolkit grid, rail controls/chips) were lowered to a
see-through band for the `aelyris-sakura` LIGHT preset (all sakura-scoped, Pro
untouched). What remains are **deep, mostly collapsed-frame internals** that
hardcode dark rgba and don't adapt to the light theme.

## Root cause
Sakura theme values live in two places (modularity debt, tracked as task #10):
`src/shared/themes/moods/{tokens,surfaces}.ts` (applied inline via `useTheme`)
AND `src/styles/global.css` `:root[data-mood="aelyris-sakura"]` blocks. On top of
that, several right-panel CSS modules hardcode dark `rgba(3,9,16,…)`-style
backgrounds with NO sakura `:global(...)` override, so they render as dark patches
on the light theme.

## Remaining items (Class A1 — hardcoded dark, no sakura override)
Make each theme-aware: either swap to a per-mood token whose Pro value ≈ the
current dark rgba (Pro stays identical, sakura resolves light), or add a
`:global(:root[data-mood="aelyris-sakura"])` override. Pro must stay byte-identical.

- `src/features/agent-inspector/ConductorView.module.css`: `.view` :8 `rgba(10,10,10,0.35)`,
  `.roleSummary` :21 `rgba(0,0,0,0.2)`, `.controlSummary` :33 `rgba(0,0,0,0.16)`,
  `.summaryChip` :45 `rgba(0,6,14,0.22)` (orchestra/Agents tab — collapsed by default).
- `src/features/agent-inspector/AgentInspector.module.css`: `.permBadge` :322
  `rgba(3,9,16,0.22)`, `.parallelProgress` :~1332 `rgba(3,9,16,0.28)`, plus ~12 row/hover
  backgrounds (lines 25, 76, 112, 350, 441, 451, 616, 694, 807, 845, 856, 871, 1031)
  not in the sakura override block (1113-1247). Cleanest: one shared per-mood
  `--inspector-row-bg` token rather than 12 `:global` rules. Leave the semantic
  status-tint badges (897/902/1247).
- `src/shared/ui/PanelHeader.module.css`: `.header[data-collapsible]:hover` :25
  `rgba(3,12,22,0.22)` → `var(--rail-control-hover-bg)`; `.count` :103 `rgba(1,6,13,0.22)`
  → `var(--rail-chip-bg)`.
- `src/features/toolkit/ToolkitPanel.module.css`: `.targetPill` :75 `rgba(1,7,15,0.22)`,
  `.targetPill[data-ready]` :84 `rgba(3,18,26,0.3)` → `color-mix(var(--rail-control-bg) …)`.

## Class A2 — token-backed but no FOCUSED sakura override
`--glass-thick`/`--glass-dense` have a sakura value only under
`body[data-window-focused="false"]` (global.css ~799-805); a focused sakura window
falls back to the dark Pro default for these. Consumers: OrchestratorPanel
`.loopBadge`/`.taskRow`, ConductorView `.node`/`.react-flow__controls`, HelmPanel `.helm`.
Add focused sakura values for `--glass-thick`/`--glass-dense` (and `--row-hover`) in the
`:root[data-mood="aelyris-sakura"]` block at global.css ~4290. NOTE: the inline
`useTheme` path (tokens.ts) already sets sakura `--glass-*`; verify which wins at
runtime before editing to avoid a no-op.

## Done this pass (committed)
mode-rail, `.right-panel-widget-frame`/`-header`, `.right-panel-orchestra-command`/lanes,
`--rail-control-bg`/`--rail-chip-bg`/`--rail-control-active-bg`, `--toolkit-*`, plus the
tokens.ts glass tiers / panel bgs / terminal raster and surfaces.ts scrim+blur — all
sakura-scoped, lowered into the see-through band.
