# UI Token Dial Spec — Tier-1 "Dial Up"

Status: PROPOSED (apply-ready change list, NOT applied)
Author: design engineering
Date: 2026-06-13
Scope: `src/styles/global.css` `:root` token register + the three consumer
sites that resolve these tokens (`WorkspaceTabs.module.css`,
`AgentInspector.module.css`, and the `.mode-rail*` / `.right-panel*` rules that
live inside `global.css` itself).

> HARD CONSTRAINT: This document is analysis + documentation only. No source
> file under `src/` or `src-tauri/` is edited by this task. Every "current
> value" below is grounded in a real `file:line`. The actual edits are a
> separate, reviewed change.

---

## 0. Context — what the audit found

The design system is excellent: a 5-level luminance-stacked glass scheme
(`--glass-clear` → `--glass-solid`, `global.css:17-30`), a single-blur rule for
nested cards (`global.css:585-610`), an Apple-spring easing curve
(`--ease-apple`, `global.css:385`), a full type scale with role aliases
(`--type-*`, `global.css:431-438`), and three density modes
(`global.css:827-873`). The problem is calibration, not architecture: the
system **renders too timid**. Three quantifiable symptoms:

1. **Role type aliases are pinned to the bottom two rungs of the scale.**
   `--type-card-title` and `--type-rail-section-title` both resolve to
   `--text-sm` = 11px (`global.css:432-433`); `--type-metadata-label` resolves
   to `--text-2xs` = 9px (`global.css:434`). Card titles, rail section heads,
   and the densest metadata labels are therefore all whisper-quiet.

2. **The chrome borders are nearly invisible.** `--aelyris-border` is
   `rgba(121, 202, 226, 0.052)` (`global.css:38`) and `--aelyris-border-strong`
   is `rgba(146, 221, 239, 0.096)` (`global.css:39`). At 5.2% / 9.6% alpha the
   panel and card edges read as a suggestion, not a boundary.

3. **The codebase compensates for #1 by carpet-bombing font-weight.** There are
   **75** `font-weight: 800|820|850|900|950` overrides in `global.css` alone
   (verified count). Weight is being used as the primary emphasis channel
   because size and contrast were dialed down too far. Heavy weight on 9-11px
   text on a dark glass surface produces muddy, blobby glyphs — the opposite of
   the crisp Apple-class look the project targets.

The fix is to **move emphasis from weight to size + tracking + color**, lift the
two border alphas, give nested cards a real luminance delta on selection, and
add a dedicated selected-surface token so "active" reads as intent rather than a
slightly different gray.

### Invariants that MUST survive every change below

- **Single-blur rule.** Only one `backdrop-filter` per stacking path. Every
  change in this spec touches *alpha, size, color, or tracking only* — never
  adds a second `backdrop-filter`. The nested-card contract at
  `global.css:603-610` (child sets `backdrop-filter: none`) stays byte-for-byte.
- **Combined-alpha ceiling.** Nested child surfaces must keep ≥ 0.07 luminance
  delta vs. parent and must not breach the ~0.74 combined-alpha ceiling against
  `--glass-dense` (documented at `AgentInspector.module.css:184-186`). New fill
  values below are chosen to sit inside that ceiling.
- **Density compression.** Each proposed value is a token or a token reference,
  so the `data-density` overrides at `global.css:827-873` keep compressing it.
  Section 5 confirms each change per mode.
- **Sakura mood + forced-colors + reduced-motion** paths
  (`global.css:736-742`, `4907-4962`, `5126-5137`) are color-channel and
  media-query overrides that sit *downstream* of the tokens; lifting a base
  alpha or size does not regress them.

---

## 1. Change table — type register up

All rows edit the `:root` alias block at `global.css:431-438`. The underlying
`--text-*` scale (`global.css:326-336`) is NOT touched; we only re-point the
**role aliases** at higher rungs. This is the safest possible lever: one line
each, every consumer inherits.

| Token | Current value (file:line) | Proposed value | Rationale | Risk |
|---|---|---|---|---|
| `--type-card-title` | `var(--text-sm)` = 11px — `global.css:433` | `var(--text-base)` = 13px | Card titles (`AgentInspector .cardName` 298, `right-panel-inspector-hero-head strong` 1367, `right-panel-essential-card strong` 1918) are the primary scan target; 11px is caption-tier. 13px is the body baseline and reads as a title. | LOW. +2px on a flex/grid title row already `ellipsis`-clamped; no reflow risk. |
| `--type-rail-section-title` | `var(--text-sm)` = 11px — `global.css:432` | `var(--text-md)` = 12px | Section heads must out-rank body. Keeping them at body-size (after body rises to 13, see below) inverts hierarchy; 12px + the tracking/color change in §3 restores rank without shouting. | LOW. Consumed by `right-panel-widget-frame-title` (4791) inside an `ellipsis` row. |
| `--type-metadata-label` | `var(--text-2xs)` = 9px — `global.css:434` | `var(--text-xs)` = 10px | 9px is below the comfortable floor for non-mono UI text on translucent dark glass. This alias is the single most-used label token across the right rail (inspector grid `dd` 1419, decision/advisor/now labels). 10px is the genuine minimum for legibility. | MEDIUM. Highest fan-out alias; +1px multiplies across dense grids. §5 confirms dense-mode geometry still holds (rows are height-driven, not text-driven). |
| `--type-metric-value` | `var(--text-lg)` = 14px — `global.css:435` | `var(--text-2xl)` = 17px | Hero metrics are the "number you came to read." 14px under-sells them next to a 13px title. 17px (the scale's display-numeric rung) gives metrics unmistakable visual weight **by size, letting us drop the weight:900 hammer** (see §3). | LOW–MEDIUM. Used by metric/percent displays; verify the few fixed-height metric chips (e.g. `right-panel-now-state`) still vertically center — they use `line-height:1`/`1.15` so 17px fits a 34-40px row. |
| body min (raise floor) | UI text frequently bottoms out at `--text-sm` 11px / `--text-2xs` 9px via the aliases above; `--text-base` = 13px — `global.css:330` | Treat **13px (`--text-base`) as the body floor**: any *prose / readable* string should resolve ≥ `--text-base`. No new token; this is the design rule that the alias re-points above enforce. Mono telemetry (`--type-mono-telemetry` = `--text-2xs`, 435/436) is exempt — tabular 9px mono is legible and intentional. | Eliminates sub-12px non-mono body text, the single biggest "timid" tell. | LOW as a rule; the concrete lever is the four alias rows above. |

### Latent bug surfaced while grounding (do not expand scope, just note)

`--type-ui-small` is referenced at `global.css:2403`, `:3262`, `:4260`
(`right-panel-edge-score-label` etc.) but is **never defined** in `:root`
(confirmed by grep — only the three usages, zero declarations). Those
`font-size` declarations currently resolve to nothing (inherit). When the type
register is dialed up, define `--type-ui-small: var(--text-md)` (12px) in the
`:root` alias block so these labels join the system instead of silently
inheriting. Flagged here; track separately.

---

## 2. Change table — border / fill alpha up

Rows edit the legacy alias block (`global.css:38-39`) and the nested-card fill
helpers. These are alpha-only edits — the single-blur rule is untouched.

| Token | Current value (file:line) | Proposed value | Rationale | Risk |
|---|---|---|---|---|
| `--aelyris-border` | `rgba(121, 202, 226, 0.052)` — `global.css:38` | `rgba(121, 202, 226, 0.10)` | 5.2% alpha makes panel hairlines disappear on bright Mica wallpapers. ~10% is the lowest alpha that still reads as a deliberate edge over Acrylic. Hue/RGB unchanged, so the cool-glass character is preserved. | LOW. `--aelyris-border` feeds `--border` (216); a brighter hairline cannot break layout. |
| `--aelyris-border-strong` | `rgba(146, 221, 239, 0.096)` — `global.css:39` | `rgba(146, 221, 239, 0.16)` | The "strong" variant must out-read the base by a clear margin; at 9.6% vs 5.2% the two are nearly indistinguishable. 16% restores a legible base→strong step used on emphasized rails/cards. | LOW. Alpha only. |
| Nested card fill delta | `.bento-card .bento-card` relies on `--rim-hairline` + parent alpha only, no own fill (`global.css:603-610`); `.card` fill `rgba(1,6,13,0.054)` (`AgentInspector.module.css:175`) | Ensure any **nested/active** card fill carries a **≥ 0.12 alpha delta** over its parent surface (was effectively ~0.05). Concretely: route the selected state through the new `--surface-selected` token in §4 (which bakes a +0.12 fill delta), rather than nudging base `.card` alpha. | Gives nested + selected cards a real "lifted off the parent" read instead of a 5% whisper, while staying under the 0.74 combined-alpha ceiling. | MEDIUM. Delta must be validated against `--glass-dense` (right-panel parent). §5 + §6 cover the check. Keep child `backdrop-filter:none`. |

> Note: `--rim-hairline` (`global.css:501`, `rgba(128,218,238,0.048)`) is the
> shadow-as-border for nested cards. It may be lifted to ~0.09 in the same pass
> for parity with `--aelyris-border`, but that is OPTIONAL and lower priority than
> the two named border tokens above. Flagged, not required.

---

## 3. Change table — replace weight 800-900 with size + tracking + color

This is the heart of the dial-up. The 75 heavy-weight overrides are an
anti-pattern: weight is doing the job that size, tracking, and color should do.
The rule is **demote weight, promote the other three channels**. This is a
mechanical, reviewable sweep — but because it touches 75 sites it is staged.

**Replacement recipe (apply per archetype, not per line):**

| Archetype (current) | Representative sites | Proposed treatment |
|---|---|---|
| Card / metric **title** at `font-weight: 900` | `right-panel-inspector-hero-head strong` (1368), `right-panel-run-loop-main strong` (1538), `right-panel-essential-card strong` (1919), `mode-rail-brand` (936) | Drop to `--weight-semibold` (600, token at `global.css:308`). Compensate with the §1 size lift (`--type-card-title` 11→13) + `color: var(--text-primary)`. Size + full-contrast color reads as "title"; 900 was over-correcting for 11px. |
| Uppercase **kicker / eyebrow** at `font-weight: 800-900` + mono | `right-panel-inspector-kicker` (1361), `right-panel-edge-score-kicker` (2378), `right-panel-goal-track-kicker` (2537), `right-panel-decision-kicker` (2167) | Drop to `--weight-semibold` (600), add **positive tracking** via a new `--tracking-kicker: 0.04em` (see §4), keep `text-transform: uppercase` + `--gold` color. Tracking is the canonical eyebrow channel; weight is not. |
| Metadata **label / value** at `font-weight: 820-850` | `right-panel-inspector-grid dd` (1420, `820`), `right-panel-edge-score-item strong` (2465, `850`), summary `span` (1744, `850`) | Drop to `--weight-medium` (500, `global.css:307`). The §1 lift (`--type-metadata-label` 9→10) + existing `--text-secondary`/`--text-primary` color split carries the hierarchy. |
| **Numeric** displays at `900-950` | `mode-rail-shortcut` (1017, `900`), `orchestra-lanes span` (1602, `950`), `edge-score-head strong` (2386, `900`) | Drop to `--weight-semibold` (600). For the big metric, the §1 `--type-metric-value` 14→17 lift supplies the emphasis; mono `tnum` figures (`--font-features-num`, `global.css:412`) already render evenly without extra weight. |

**Why color is the third lever:** the app already has a clean three-tier text
ramp — `--text-primary` #faf6eb / `--text-secondary` #d7d2c6 / `--text-muted`
#aaa39a (`global.css:207-209`). Title vs. label distinction should be carried by
*which tier* + *size*, not by stacking 900 weight on every primary-colored
string. Most `900` titles are already `--text-primary`; the size lift alone
makes the weight redundant.

| Token / rule | Current | Proposed | Rationale | Risk |
|---|---|---|---|---|
| 75× `font-weight: 800..950` | scattered, `global.css` (see §0 count, e.g. 936,999,1017,1361,1368,1413,1420,1495,1531,1538,1602,1608,1638,1919,2378,2386,2465,2537,2545,4806,4842,4849 …) | Collapse onto the existing semantic ladder: `--weight-semibold` 600 for titles/kickers/numbers, `--weight-medium` 500 for labels. Reserve ≥ 700 for genuine rare emphasis only. | Crisper glyph rendering at small sizes on glass; emphasis re-sourced to size/tracking/color per recipe above. | MEDIUM (volume). Staged: do one archetype at a time, screenshot each. Pure visual change, no layout. |

---

## 4. New tokens to add

Add to the `:root` block (logical home: alongside the existing state tokens at
`global.css:219-232` and the type/tracking blocks). None of these change
existing behavior until a consumer opts in.

| New token | Proposed value | Consumed by (proposed) | Rationale |
|---|---|---|---|
| `--surface-selected` | `linear-gradient(135deg, color-mix(in srgb, var(--gold) 14%, transparent), transparent 60%), color-mix(in srgb, var(--glass-thick) 100%, var(--gold) 4%)` — a gold-tinted fill carrying ≥ 0.12 alpha delta over the unselected card | `WorkspaceTabs .tabWrap[data-active]` (60-76), `.mode-rail-button[data-active="true"]` (972-979), `AgentInspector .cardActive` (262-271), `right-panel-mode-tab[data-active="true"]` (1275-1282) | Today "active" = a faint cyan wash (`--rail-control-active-bg`, 83-84) or a 5%-alpha bg (`.cardActive`, 264). A dedicated gold-tinted selected surface makes selection read as *intent*. Routes chrome selection to gold per §5 unification. |
| `--surface-selected-inset` | `inset 0 0 0 1px color-mix(in srgb, var(--gold) 26%, transparent), inset 0 1px 0 rgba(244, 224, 160, 0.10)` | same four sites, as the `box-shadow` companion to the fill | Gives the selected surface a brighter **gold rim** (the §2 border lift, specialized for selection) + a top specular line. Pairs with `--rim-top` without adding blur. |
| `--surface-selected-rim` | `0 0 0 1px color-mix(in srgb, var(--gold) 30%, transparent)` | optional outer ring for selected cards that sit on busy rails (`.right-panel-essential-card`, `.cardActive`) | A single brighter outline so the selected card lifts off a crowded panel; one value so all "selected" outlines swing together. |
| `--tracking-kicker` | `0.04em` | every uppercase kicker/eyebrow rule listed in §3 archetype 2 | The eyebrow emphasis channel that replaces `font-weight: 900` on kickers. Currently all `--tracking-*` are `0` (`global.css:396-401`) — uppercase mono labels are the one place positive tracking is idiomatic and legible. |
| `--type-ui-small` | `var(--text-md)` (12px) | the three already-existing-but-dangling usages (`global.css:2403`, `3262`, `4260`) | Defines the token those rules already reference (see §1 latent bug). Not net-new UI; it fixes an inherit-to-nothing. |

> Implementation note for `--surface-selected`: the AgentInspector card already
> threads a per-session accent via `--session-accent` (default `--gold`,
> `AgentInspector.module.css:269`). The selected token should **respect that
> override** — i.e. the gold tint is the default, but a session-colored card
> keeps its session hue. Express as `color-mix(... var(--session-accent,
> var(--gold)) ...)` at that one site so per-session theming survives.

---

## 5. Accent unification — gold for chrome, cyan for terminal

The app currently mixes two accents in chrome: `--accent` cyan (#4fc1ff,
`global.css:217`) and `--gold` (`global.css:163`). The active states of the
mode rail and right-panel tabs lean cyan (`--rail-control-active-bg` 83-84,
`color-mix … var(--accent) …` at 917, 1318, 1468, 2334), while WorkspaceTabs and
AgentInspector already moved selection to gold (`WorkspaceTabs.module.css:73`
active underline = gold; `.activityDot` 119 explicitly migrated cyan→gold; card
focus/active uses gold at 250/254/273). The result is inconsistent: two
different "you are here" colors.

**Rule (already half-applied — finish it):**

1. **Chrome emphasis → `--gold`.** Any "selected / active / current" state on
   app *chrome* (mode-rail buttons, right-panel mode tabs, workspace tabs,
   inspector cards, kickers, goal-track) routes through the new
   `--surface-selected*` tokens (§4), which are gold-based. This makes
   WorkspaceTabs/AgentInspector the reference and pulls the mode-rail and
   right-panel-mode-tab into line.
2. **`--accent` cyan → restricted to the terminal domain.** Cyan stays the
   identity of the terminal well and its directly-attached chrome
   (`--terminal-*` tokens 41-68, the center panel, terminal selection,
   scrollbar thumb 5026/5036). Cyan as a *structural / glass-rim* tint
   (the low-alpha `rgba(121,202,226,…)` borders, the panel washes) is fine —
   that is glass material, not "accent emphasis." The change is narrow:
   **stop using `--accent` to signal selection in chrome**; use gold.
3. Progress bars that intentionally blend both (`right-panel-goal-track-bar
   span`, `linear-gradient(90deg, var(--accent), var(--gold))`, 2570) stay —
   the cyan→gold sweep is a deliberate "terminal → goal" gradient, not a
   selection signal.

| Surface | Current accent (file:line) | Proposed |
|---|---|---|
| `.mode-rail-button[data-active="true"]` | cyan wash via `--rail-control-active-bg` (972-979 → 83-84) | gold via `--surface-selected` + `--surface-selected-inset` |
| `.right-panel-mode-tab[data-active="true"]` | cyan wash via `--rail-control-active-bg` (1275-1282) | gold via `--surface-selected` |
| `.cardActive` | gold-ish 5% (262-271) | gold via `--surface-selected` (deeper, ≥0.12 delta) |
| `.tabWrap[data-active]::after` | already gold (73) | unchanged — this is the reference |
| terminal well / scrollbar / selection | cyan (41-68, 5026, 5054-5057) | unchanged — cyan stays terminal-domain |

Risk: LOW–MEDIUM. This is a perceptual recoloring of selection, not a layout
change. The biggest watch item is that the mode-rail active button must stay
legible — gold tint on `--text-primary` label is fine; verify in §6.

---

## 6. Density-mode interaction — does each change still compress?

The three density modes override **spacing and row-height tokens only**
(`--space-*`, `--row-h-*`, `--density-*`), at `global.css:827-845` (focus),
`847-853` (balanced), `855-873` (dense). They do **not** touch type, border, or
fill tokens. So:

| Change | Compresses in dense mode? | Why |
|---|---|---|
| `--type-card-title` 11→13 | YES | Titles sit in `ellipsis`-clamped flex/grid cells; row height is driven by `--row-h-*` (dense: 22/26/30, `865-869`), not by text. 13px fits a 22px row (line-height ≤ 1.25). |
| `--type-rail-section-title` 11→12 | YES | `right-panel-widget-frame-title` (4789) is in a header whose height is padding-driven, not text-driven. |
| `--type-metadata-label` 9→10 | YES — primary watch item | Highest fan-out. Dense rows are 22px (`--row-h-dense`, 867). 10px text at `line-height:1`–`1.15` (e.g. `right-panel-now-state` 2311) fits with headroom. Grid `dd` cells (1417) are `min-width:0` + `ellipsis`, so width is unaffected. **Verify** the 2-column inspector grid (1387-1389) at the 240px right-panel min-width in dense mode (visual-qa matrix already covers 584px window). |
| `--type-metric-value` 14→17 | YES | Metric chips use fixed `min-height` + centered `line-height:1` (e.g. `right-panel-now` 2267). 17px centers in a 34px row in all modes; dense only shrinks the row to 30px comfortable which still fits. |
| border alphas | YES (no geometry) | Alpha-only; independent of density. |
| weight→size/tracking/color | YES (no geometry) | Semibold vs. 900 has identical metrics box. Tracking `0.04em` on short uppercase kickers adds < 1px total across a ~6-char eyebrow; the eyebrow rows are not width-constrained. |
| `--surface-selected*` | YES (no geometry) | Fill + shadow only. |

Net: every change is type/color/alpha; none fights the density spacing
overrides. The one row that warrants an explicit dense-mode screenshot is
`--type-metadata-label` 9→10 in the 2-up inspector grid at the narrowest panel.

---

## 7. Motion — adopt the existing `--ease-apple` entrance/state choreography

The Apple spring already exists (`--ease-apple`, `global.css:385`;
`--ease-apple-bounce`, 386) and `--ease-silk` already aliases to it (322), so
most `transition`s inherit the right curve. What is *missing* is **entrance /
state choreography** on the surfaces this dial-up makes more prominent. Adopt it
conceptually (no new keyframes required for the token pass; this is a follow-on
list, called out so the spec is complete):

Surfaces that should adopt `--ease-apple` entrance + state on selection change
(conceptually — list, not code):

1. **`AgentInspector .card` / `.cardActive`** (`AgentInspector.module.css:166`,
   262) — when a card becomes selected, the new `--surface-selected` fill +
   rim should *ease in* on `--ease-apple` over `--duration-state` (200ms), not
   snap. The transition list at 197-201 already uses `--ease-silk` (= apple);
   only the new background/box-shadow need to be in that transition set.
2. **`.mode-rail-button` / `.right-panel-mode-tab` active** (`global.css:972`,
   1275) — gold selection should slide in on the existing 120ms `--ease-silk`
   transitions already declared (961-964, 1252-1255). No new motion, just make
   sure `background`/`box-shadow` are in the transition property list when the
   token swaps to gold.
3. **`WorkspaceTabs .tabWrap[data-active]::after`** (underline, 65-76) — give
   the gold underline a `transform: scaleX` entrance on `--ease-apple` so tab
   switches feel like Apple's segmented controls. Currently the underline just
   appears.
4. **Right-panel cards that gain emphasis from §1/§4** (`right-panel-essential-card`
   1856, `right-panel-edge-score` 2325, `right-panel-goal-track` 2481) — their
   border/fill state changes (`data-tone`, `data-status`) should transition on
   `--ease-apple` / `--duration-state` rather than instant.

Constraint: all of the above respect `prefers-reduced-motion` via the existing
global guards (`global.css:4897-4905`, `5126-5137`) — no per-site reduced-motion
work needed.

---

## 8. Verification plan

Run after applying, in this order. All are existing gates.

### 8.1 Static / contract gates (fast, run first)

| Gate | Command | What it protects against here |
|---|---|---|
| Right-rail information density | `node scripts/verify-right-rail-information-density.mjs` | Asserts the essential grid stays `repeat(3, minmax(0,1fr))` and primary-action counts (`verify-right-rail-information-density.mjs:234,244`). Confirms the type/fill lift did not blow out the density budget. |
| Right-rail scale contract | `node scripts/verify-right-rail-scale-contract.mjs` | Scale/geometry contract for the rail; catches a metadata-label lift that overflows a dense row. |
| Right-rail edge feedback | `node scripts/verify-right-rail-edge-feedback.mjs` | Edge-score card states (tone borders) — confirms the §2/§4 border + selected-surface changes keep `data-tone` legibility. |
| Right-rail goal track (Tauri) | `node scripts/verify-right-rail-goal-track-tauri.mjs` | Goal-track gold border + progress gradient still resolve after the accent unification. |
| Right-rail suite | `node scripts/verify-right-rail-suite.mjs` | Umbrella over the above right-rail scripts. |
| Clauge UI refresh contract | `node scripts/verify-clauge-ui-refresh-contract.mjs` | Broad UI-refresh invariants. |
| Terminal font render contract | `node scripts/verify-terminal-font-render-contract.mjs` | Confirms the accent unification did NOT leak gold into the terminal domain (cyan must stay terminal-only, §5). |

### 8.2 Playwright visual gates

| Gate | Command | Notes |
|---|---|---|
| Visual QA layout matrix | `pnpm exec playwright test e2e/visual-qa-layout.spec.ts` | Runs the rail × width × density matrix (`visual-qa-layout.spec.ts:4-6`: 3 rails × {584,960,1440,1920} × {focus,balanced,dense}). This is the primary gate for §5/§6 — it exercises every density mode at every breakpoint. **Review the `.codex-auto/visual-qa/p2-05` artifacts** (output dir, line 9) by eye. |
| Visual regression | `pnpm exec playwright test e2e/visual-regression.spec.ts` | Snapshot diff. Expect intentional diffs on every surface touched (titles, borders, selected states); update baselines deliberately, do not blanket-accept. |
| UI interactions | `pnpm exec playwright test e2e/ui-interactions.spec.ts` | Confirms selection / tab-switch interactions still fire after the motion + selected-surface changes. |

### 8.3 What a human reviewer must eyeball (cannot be asserted)

1. **Glyph crispness at small sizes.** Open the right rail at balanced density;
   confirm 10px metadata labels and 13px card titles render *crisp*, not
   blobby. This is the whole point of the weight→size swap — verify the 900s are
   actually gone and text looks sharper, not just bigger.
2. **Selection reads as gold intent.** Click a workspace tab, a mode-rail
   button, a right-panel mode tab, and an AgentInspector card. All four should
   now share the same gold "you are here" language (§5). No cyan selection
   anywhere in chrome.
3. **Cyan still owns the terminal.** The terminal well, its scrollbar, and text
   selection must stay cyan. No gold bleed into the center panel.
4. **Border lift looks deliberate, not heavy.** On a bright wallpaper (Mica),
   panel and card hairlines should now be visible but still hairline — not a
   chunky 1px slab. Compare `--aelyris-border` panels against the terminal edge.
5. **Nested-card lift.** A selected/active card should look genuinely *lifted*
   off its parent (≥ 0.12 fill delta), but the parent must not have gained a
   second blur — confirm the glass still reads as a single frosted layer
   (single-blur rule, §0). If anything looks double-frosted, the change breached
   the contract — STOP and revert that fill.
6. **Dense-mode metadata grid.** At the 584px matrix width in dense mode,
   confirm the 2-up inspector grid `dd` values (now 10px) don't clip or wrap.

### 8.4 Single-blur regression guard

The single most important non-visual check: grep that **no new
`backdrop-filter` was introduced** by the change. After applying, the count of
`backdrop-filter` declarations in `global.css` and the three module files must
be unchanged from baseline, and `.bento-card .bento-card` (global.css:603-610)
and `AgentInspector .card` (which has no `backdrop-filter`) must still declare
none. Every token in this spec is alpha/size/color/tracking only — if a
`backdrop-filter` diff appears, it is out of scope and must be removed.
