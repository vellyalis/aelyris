# UI Per-Feature Audit — 2026-04-24

Context: after token-level BLOCK/HIGH/AMBER sweeps closed (commits
`7d896d2` / `7d9ffdc` / `fca5e50`), the user pushed back with
「本当に？ウィンドウも全て？各機能ごとに見ても？」 — token audits can
miss composition-level defects per view. Ran 8 parallel agents over
~42 surfaces, grouped into clusters.

Commit `4eec6df` landed the **critical safety + shell iconography +
ReactFlow chrome** subset. Everything below is what remains.

---

## Cluster results summary

### 1. Shell chrome (always-visible)
- ✅ **Sidebar, MenuBar, TimelineBar** — clean
- 🟡 **ProjectHeaderBar** — right-cluster spacing (icon buttons touch window controls; ctrlBtn 32px inside 48px bar → 16px dead band); `.changes` gold competes with `.name` eye-anchor
- 🟡 **StatusBar** — 9 equal-weight items, no hierarchy; actionable buttons indistinguishable from passive spans; "Aether v0.1.0" permanent chrome should live in About
- 🟡 **WorkspaceTabs** — active bg == hover bg (`--white-6`); 5-element tab crowding; `+` unframed glyph
- ✅ **TerminalInfoBar** (closed in 4eec6df) — Unicode glyphs → Lucide

### 2. Terminal surfaces
- ✅ **IMEInputBar, TerminalCanvas** — clean
- 🟡 **TerminalArea, AgentTerminal** — no empty/loading state (bare void during spawn), no pane-body focus ring (relies solely on InfoBar), asymmetry between the two (AgentTerminal has 2px accent border, TerminalArea nothing)
- 🟡 **AgentTerminal** — `[Agent process exited]` no restart affordance; `:focus-within` uses dead `--agent-accent-rgb` var
- 🟡 **GhostDiffPanel** — viewport-edge clipping risk (fixed 380px, no flip/shift); no arrow/origin pointer; no focus trap

### 3. Editor / code
- 🔴 **EditorPanel** — no empty state (`if (!filePath) return null`); **duplicate diff path** (renders own Monaco DiffEditor inline, bypassing DiffViewer); Monaco font hardcoded `"IBM Plex Mono, Cascadia Code, monospace"` instead of `--font-mono`; emoji in comment badges 🔧✓💬
- 🔴 **DiffViewer** — orphaned (EditorPanel doesn't use it); no split/unified toggle; no empty state; no binary/moved/renamed guard; `theme="aether-theme"` set before register → flash
- 🔴 **MarkdownPreview** — iframe `background: transparent` on the iframe + `body { background: transparent }` inside → white flash on first paint (same pattern WebInspector had)
- 🟡 **EditorStatusBar, EditorBreadcrumb** — mostly clean, minor polish

### 4. Right-panel clusters
- 🔴 **ConductorView** (partial fix in 4eec6df) — selection state invisible (fixed); edge arrows + Controls chrome + nested blur (fixed). Remaining: `columnLabels` hardcoded `width: 260px`, `nodesDraggable={false}` limits UX
- 🔴 **SubagentTree** — not actually a tree (`.line` always `left: 5px; top: -10px; height: 10px`, no depth awareness; `ChevronRight` is static decoration, not a toggle; component takes `AgentNode[]` flat — doesn't model parent/child)
- 🟡 **KanbanBoard** — weak drag affordance (no `setDragImage`, no drop placeholder showing where card lands); 6-element crowding per row when hovered
- 🟡 **HelmPanel** — row height mismatch with Kanban (26px vs 28px); different hover color (purple vs white-4) — sibling drift
- 🟡 **ToolkitPanel** — (dangerous-cmd confirm fixed in 4eec6df). Remaining: no empty state, ⊕ glyph (non-Lucide), no running-state on buttons
- 🟡 **AgentInspector** — card information overload (10+ badges); 3 states (hover/active/selected) too similar on non-gold sessions; Conductor/Diffs tabs icon-only without label
- 🟡 **InlineResultPanel** — hardcoded 10px (token bypass); decorative Accept button that only toasts (misleading); header padding drifts from AgentInspector tabBar

### 5. Left panels
- ✅ **HistorySearchDialog** — strong composition, arrow-key cursor, active-row ring, footer hints
- 🟡 **FileTree** — `role="tree"` but no `role="treeitem"`/`aria-expanded`/arrow-key nav; no virtualization (10k+ stutter); no empty state for zero-file projects; `confirm()` browser dialog for delete breaks glass aesthetic; `.changesBar` div with cursor:pointer but not keyboard-activatable
- 🟡 **SearchPanel** — no keyboard nav between matches; file-group header not collapsible; error state conflates "no matches" with "grep failed"

### 6. Git / SCM
- 🔴 **WorktreeManager** (fixed in 4eec6df) — delete was a no-op; switch is optimistic (if parent fails, active highlight lies)
- 🔴 **PRInspector** — `state` field is declared and fetched but **never rendered**; no author/CI/review/updated-at despite being fetchable — card unusable for triage
- 🟡 **SCMPanel** — commit textarea `rows={2}` (cannot fit body); no current branch name displayed anywhere; no ahead/behind indicator; no upstream info; `renamed` status has CSS but never assigned a group; empty state is plain text not `EmptyState`
- 🟡 **GhostDiffPanel** SCM integration — worktree-kind layer shows branch but doesn't cross-link to WorktreeManager
- 🔴 **Cross-surface**: status pip vocabulary not shared. Need `shared/ui/GitStatusPip` consumed by SCM + PR + GhostDiff + FileTree. Currently SCM has M/A/D/R, PR has nothing, GhostDiff has dots.

### 7. Dialogs / overlays family
- 🔴 **Family-level chaos**:
  - 11 dialogs, 11 widths (320/380/380/420/420/520/520/520/560/560/640) — no size system
  - 5 different backdrop-blur values (4/8/12/16/blur tokens)
  - 4 different surface tokens (hard-coded `rgba(24,24,24,0.92)` vs `--glass-thick`)
  - Close-affordance anarchy: × top-right only / footer Close only / both / neither
  - Animation split: shared/ui dialogs animate, feature/* ones don't
  - Keyboard: only About/Settings/Watchdog/Help/Prompt (Radix). Analytics/Handoff/Orchestra/OnboardingOverlay/QuickOpen/WebInspector/Repair do NOT have focus trap
- 🔴 **OnboardingOverlay** — magic margin-left:280px / margin-right:300px, own glow+lift, feels like marketing page not app chrome
- 🔴 **QuickOpen vs CommandPalette** — sibling typeahead dialogs differ in width (520/560), radius, blur, surface, positioning — should be twins
- ✅ **RepairJobsPanel --radius-md undefined** (fixed in 4eec6df)
- 🟡 **Settings** — primary "Save" button in HEADER (HIG violation — should be footer right)
- 🟡 **Toast close button** unicode × vs Help Lucide

### 8. Workflow / Welcome
- ✅ **WorkflowBuilder ReactFlow chrome + arrows** (fixed in 4eec6df)
- 🔴 **WorkflowBuilder** — no visible "Run Workflow" / "Save & Run" affordance inside the Builder; step pills in WorkflowPanel do not match PhaseNode styling (two different DAG UIs in same app)
- 🔴 **WorkflowPanel** — Gate approve/reject ✓/✗ Unicode glyphs (hit-target fails, clash with Lucide)
- ✅ **Welcome SCAN_DIRS hard-coded developer paths** (fixed in 4eec6df)
- 🟡 **Welcome** — logo+wordmark rhythm off (gap too wide), greeting conditional on userName (no warmth fallback), drop zone only exists DURING drag (no resting affordance), `has_changes` fetched but never rendered, branch icon literal `⚡` emoji (mixed with Lucide)

### Cross-cluster inconsistencies (composition-level)
- **Hover tokens** differ across sibling row lists: Kanban white-4, Helm purple-0.08, Toolkit white-6, SubagentTree white-6, Helm .task != SCM .fileRow hover
- **Plus / add glyph**: Kanban `<Plus size=14>`, Helm `+`, Toolkit `+` and `⊕`, AgentInspector `<Plus size=12>` — standardize
- **Panel header primitive** missing: 7 right-panel surfaces, 7 different header treatments
- **Icon sizing**: SCM 10px, Worktree 14px, PR text-md — three densities for one git domain
- **Deleted vs modified rely on color alone** (red D vs yellow M) — a11y fail
- **Dialog tokens** not published: `--radius-dialog`, `--radius-panel`, `--scrim-*`, `--dialog-width-*` all missing

---

## Remaining fix plan (priority order)

### P0 — ship-blockers / safety
_(none — all P0 items closed in 4eec6df)_

### P1 — composition-level RED (user-visible broken features) — ✅ closed in `47f9b5e`
1. ✅ **DiffViewer** — split/unified segmented toggle, empty + binary + too-large guards, theme registered in beforeMount, `onGlyphMarginClick` prop exposed
2. ✅ **EditorPanel** — now routes through DiffViewer (inline DiffEditor deleted), empty state on no file, Monaco font via new `getMonoFontStack()`, comment badges → Lucide Wrench/Check/MessageSquare
3. ✅ **MarkdownPreview iframe flash** — iframe element background set to `var(--aether-bg)`
4. ✅ **SubagentTree → SubagentList** — flat list, decorative connector + static chevron removed, keyboard activation + focus ring
5. ✅ **PRInspector card** — state pill + author + CI rollup + review decision + relative updated-at; backend extended to fetch isDraft / updatedAt / reviewDecision / statusCheckRollup
6. ✅ **WorkflowPanel gate → Lucide** (22px tap targets, focus ring) + WorkflowBuilder "Save & Run" CTA wired via `handleStartRef`; traffic-light phase-gate swapped to `ShieldCheck`
7. ✅ **OnboardingOverlay** — PromptDialog chrome (rgba 0.92 / blur 20 / radius-lg), magic margin-left:280 / margin-right:300 removed, focus rings on Skip/Next

### P2 — shared primitives (once-and-done payoff) — ✅ closed in `68e4e7d`
1. ✅ `shared/ui/GitStatusPip` — `letter` + `dot` variants, non-color differentiation (deleted ring / untracked hollow), consumed by SCMPanel + FileTree. PR/GhostDiff do not render per-file status today, so no retrofit needed there.
2. ✅ `shared/ui/PanelHeader` — single primitive with title/subtitle/count/leadingIcon/actions/collapsible slots. Rolled out to Kanban/Helm/Toolkit/InlineResultPanel. AgentInspector's tab bar stays bespoke.
3. ✅ Dialog tokens added to `global.css`: `--radius-dialog`, `--radius-panel`, `--scrim-standard-bg/-blur`, `--scrim-heavy-bg/-blur`, `--dialog-width-xs|sm|md|lg`, `--dialog-surface`, `--dialog-surface-blur`.
4. ✅ QuickOpen snapped to CommandPalette chrome — same surface/blur/radius/positioning/border/shadow. Consumes `--dialog-width-md` + scrim tokens.
5. ⚠️ Partial — Escape + token alignment landed for OnboardingOverlay + SessionAnalytics. Full Radix Dialog migration for Analytics/Onboarding/QuickOpen remains for a follow-up pass (HandoffDialog and OrchestraDialog were already Radix).

### P3 — composition polish
1. **SCMPanel** — commit textarea rows=3 autogrow, add branch name + ahead/behind, show upstream, `renamed` group classifier
2. **Welcome** — logo rhythm, greeting fallback, resting drop zone, `has_changes` dot, `⚡` → Lucide GitBranch
3. **StatusBar hierarchy** — elevate branch as eye-anchor, separate actionable Wrench/Layers from passive spans, move version to About
4. **FileTree** — arrow-key nav, virtualization, empty state, replace `confirm()` with ConfirmDialog
5. **KanbanBoard** — drop placeholder, `setDragImage`
6. **AgentInspector** — card info budget (collapse secondary badges into overflow), clarify 3 states
7. **ProjectHeaderBar** — ctrlBtn stretch-align to 48px, add separator between Refresh/Settings and window controls, mute `.changes`

### P4 — cross-cluster unification
1. Hover token unification (`--row-hover`?)
2. Plus icon standardization
3. Panel header primitive rollout

---

## Snapshot files (point-in-time per-cluster audit bodies)
Full audit text lived in `C:/tmp/ui-per-feature-*.md` at audit time. Key
findings preserved above. If the tmp files still exist:
- ui-per-feature-shell.md
- ui-per-feature-terminal.md
- ui-per-feature-editor.md (not saved to tmp but agent output was captured in handoff)
- ui-per-feature-left.md
- ui-per-feature-git.md
- ui-per-feature-dialogs.md
- ui-per-feature-workflow.md
