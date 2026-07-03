# UI Density Audit — Terminal Space Budget & Refinement Plan (2026-07-03)

> **STATUS: AUDIT + WORK-ORDER-READY PLAN — measurements are point-in-time
> (2026-07-03, commit `ec85061` era), re-measure before claiming any number.**
> Owner complaint driving this: "the UI leans web-app; the terminal area is
> cramped, especially when panes are split." The numbers below confirm it.

Measurement methodology: (a) live CDP measurement of the running app
(1440×900, dpr 1, left+right panels open, 3-pane split): summed visible
canvas area = **30.6% of the window**; (b) independent static CSS audit
reproduced the same result analytically (**29.7%** for a 2×2 split, 37.6%
for a single pane). Both artifacts agree; the numbers are real.

## 1. Where the pixels go

### Outer shell (1440×900)
| Element | px | Source |
|---|---|---|
| mode-rail (activity bar) | 64 w | `global.css:976` |
| left panel (FILES) default | 240 w | `global.css:1133`, `appStore.ts:1192` |
| right panel default | 320–340 w | `global.css:1250`, `appStore.ts:1214` |
| app-main paddings+gaps | 50 w | `global.css:950-951` |
| header / bottom tabs / status bar | 48+30+24 h | `ProjectHeaderBar.module.css:5`, `WorkspaceTabs.module.css:18`, `StatusBar.module.css:6` |

With both panels open, **~674px of 1440 (47%) of width is not terminal**.

### Per-pane chrome (multiplied by every split!)
Each pane stacks three chrome strips and three concentric paddings:

| Element | px | Source |
|---|---|---|
| TerminalInfoBar (pane header) | 22 h | `TerminalInfoBar.module.css:6` |
| TimelineBar (ALWAYS rendered, 18 even when empty) | 24 h | `TimelineBar.module.css:11,26`; mounted unconditionally `NativeTerminalArea.tsx:1339` |
| IMEInputBar (ALWAYS visible) | 30 h | `IMEInputBar.module.css:17`; mounted `NativeTerminalArea.tsx:1507` |
| terminalViewport gutter | 10 per edge | `TerminalArea.module.css:70`, mirrored by `CANVAS_GUTTER=10` `NativeTerminalArea.tsx:97` |
| nested paddings (mount 2 + area 4 + viewport 10) | 16 per edge | `PaneTreeRenderer.module.css:44`, `TerminalArea.module.css:12` |
| **Total per pane** | **114 h × 32 w** | |

In a 2×2 split: 4×(22+24+30) = **304px of vertical bars alone**; per 778px
column, two stacked panes spend 228px (29%) on chrome before any glyph.

### The broken lever
A density system EXISTS (`data-density="focus|balanced|dense"`,
`global.css:897-943`, driven by `workspaceProfile.visualDensity`) — but it
only rescales `--space-*` gap tokens (2–10px). **Every dominant cost above is
a hardcoded px value immune to density.** Switching to "dense" today changes
almost nothing. This is the root cause of the "web-like" feel: chrome was
designed per-component, never budgeted per-pane.

## 2. Design target

North star (matches the standing design decision: Apple HIG restraint +
Linear-grade polish, no Tailwind/shadcn):

- **Single pane:** ≥ 90% of the center panel is grid (today 81.8%).
- **2×2 split:** ≥ 80% of the center panel is grid (today 64.6%); ≥ 45% of
  the whole window with both side panels open (today ~30%).
- **Chrome must earn its pixels**: anything not carrying live information
  auto-hides; nothing renders an empty strip.

## 3. Work-order-ready changes (priority order)

| # | Change | Reclaims | Files | Notes |
|---|---|---|---|---|
| D1 | **IMEInputBar auto-hide**: render collapsed (0px) unless pane focused or composing; expand on focus/IME start | 30px/pane (120px in 2×2) | `NativeTerminalArea.tsx:1507`, `IMEInputBar.module.css:17` | IME composition anchoring MUST keep working (Phase A+B design: hidden textarea + bar are the two composition paths) — the bar collapses visually but the textarea path stays mounted. Visual-test on real IME before claiming. |
| D2 | **TimelineBar conditional render**: `null` when no snapshots AND no overlay; merge tick marks into the pane header strip when sparse | 24px/pane (96px in 2×2) | `NativeTerminalArea.tsx:1339`, `TimelineBar.module.css:11,26` | Keep the Mark button reachable via pane header overflow menu. |
| D3 | **Gutter 10→4**: shrink `terminalViewport` padding and `CANVAS_GUTTER` together | 12px V + 12px H per pane | `TerminalArea.module.css:70`, `NativeTerminalArea.tsx:97` | Both MUST move together or cols/rows math drifts (grid clipping). |
| D4 | **Collapse triple padding to one layer** (mount 2 + area 4 → 0 in split mode) | ~12px V + 12px H per pane | `PaneTreeRenderer.module.css:44`, `TerminalArea.module.css:12` | Keep the 1px focus ring; it is the split-pane focus affordance. |
| D5 | **Pane header slim + conditional**: 22→18px; hide entirely on a lone/maximized pane (title lives in StatusBar) | 18–22px/pane | `TerminalInfoBar.module.css:6`, `PaneTreeRenderer.tsx:385` | Header becomes the ONE strip per pane (absorbs role badge, %N id, task title from PRODUCT proposal A4.3, sparse timeline ticks). |
| D6 | **`--terminal-chrome-density` token set**: wire ALL of the above px into the existing `data-density` blocks so "dense" actually compresses the terminal | structural | `global.css:897-943` + the module files above | compact: header 18, timeline 0/18, input 0-on-blur, gutter 4, gaps 0. |
| D7 | **Right panel collapsible + default 320→280**; left panel auto-collapse reusing `.left-panel-collapsed` | up to ~330px + ~250px width | `global.css:1250,1169`, `appStore.ts:1214,1192` | Keyboard toggle + remember per workspace. |
| D8 | **mode-rail 64→48 icon-only** (the ≤720px breakpoint already hides labels — make it default) | 16px width | `global.css:976,5361` | |
| D9 | **app-main gaps/padding 10→4-6 in dense** | ~20-30px width | `global.css:928-929,950-951` | |
| D10 | **Zen/Focus mode**: one keybinding hides both side rails + header chrome, leaving panes + status bar | situational ~700px width | existing collapse plumbing | The "cockpit goes fullscreen" moment; pairs with pane zoom which already exists. |

Combined D1-D5 on a 2×2: vertical chrome per pane drops 114 → ~40px, lifting
window-level grid utilization from ~30% to **~45%**, and center-panel
utilization from 64.6% to **~84%** — hitting the §2 target without removing
any capability.

## 4. Refinement beyond density (the "beautiful & polished" half)

- **One strip per pane**: after D1-D5 each pane has exactly one 18px header
  carrying: `%N` short id · agent/task title · state dot · role badge ·
  overflow menu. Everything else appears on demand. This single rule is what
  makes tmux-lineage tools feel "terminal-native" instead of "web".
- **Typography discipline**: pane chrome should drop to 11px mono-labels with
  0.04em tracking (tokens exist in `global.css`); no mixed-size labels inside
  a strip.
- **Contrast on wallpaper**: chrome strips over the acrylic/wallpaper need the
  measured-contrast treatment already used for terminal text
  (`enhanceTerminalTextColor`) — audit strip label contrast ≥ 4.5:1 with the
  wallpaper cascade active.
- **Motion restraint**: no animation on split/close beyond a 120ms opacity;
  the current resize feels web-ish partly because bars reflow visibly.
- **Verification**: extend the right-rail visual gates pattern with a
  `verify-terminal-density-contract` (assert computed heights of the strips
  per density mode via CDP) so density never silently regresses — same
  mechanism as the existing visual QA gates.

## 5. Execution notes for the work-order author

- D1 is the riskiest (IME). It requires the live visual mandate: real
  Japanese IME composition test in the running app before the claim.
  Everything else is CSS/conditional-render with unit-testable conditions.
- D1-D6 are one work unit (same files); D7-D10 a second; §4 polish a third.
- Do not touch `terminalPaint`/renderer contracts; this is pure layout.
- Re-run the pixel measurement (CDP script exists in session scratchpad;
  trivially recreatable: sum visible canvas rects / window area) before and
  after, and record both numbers in the work-unit evidence.
