# 24-Panel spacing/sizing audit — 2026-04-28

**Source for**: `docs/ui/PHASE_1_BENTO_SPEC.md` §1.3 hotspots H1-H7
**Audit method**: Explore subagent "very thorough" pass over all `src/features/*/*.module.css` + `src/shared/ui/*.module.css`
**Token coverage average**: 78% (24 panels)
**Panels with raw px**: 22/24 (92%)
**Panels with 100% token coverage**: 0/24

---

## Per-panel summary

(rows ordered by hotspot origin count, descending)

### Panel-level details

#### 1. AgentInspector (hotspot origin: H1, H2, H4, H7)

| property | values found | token-coverage |
|---|---|---|
| padding | `var(--space-{2,3,4,5,6})` mixed scales | 100% (5 different scales) |
| margin/gap | `var(--space-{1,2,3,4})` | 100% (4 scales) |
| border-radius | `--radius-sm`, `--radius`, `--radius-pill` | 100% |
| box-shadow | `inset/0 4px 16px + 0 0 20px, 0 0 10px, 0 -4px 16px` | multi-shadow raw (H4, H7) |
| font-size | `--text-{xs,2xs,base,md}` | 100% |
| icon size | 7px / 5px / 3px line fills, 22px buttons (raw) | 0% (4 raw values) |
| min-h/w | 180px (.logSection), 60px (.activityName) | 0% |

**Hotspots:**
- L174 card padding `var(--space-5) var(--space-5) var(--space-5) var(--space-6)` — asymmetric left
- L229-232 multi-shadow `inset + 0 4px 16px + 0 0 20px` (H7、 unique 3-layer combo, 根拠不明)
- L194-206 status dot 7px → 5px → 3px → 16px ladder is not tokenized (H2)

#### 2. CommandPalette (hotspot origin: H1, H2, H6)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,6,8}` | 100% (4 scales) |
| gap | `--space-{4,6}`, raw 1px | 67% (1 raw) |
| border-radius | `--radius`, `--radius-sm` | 100% |
| box-shadow | `--rim-top` + `--shadow-elevated` | 100% |
| font-size | `--text-{xl,lg,sm,xs}` | 100% |
| icon size | 20px (raw) | 0% |
| min-height | 480px max-height | 0% |

**Hotspots:**
- L50 input padding `--space-6 --space-8` vs L88 .item padding `--space-3 --space-6` (H6: 2x variance)
- L178 footer gap `--space-5` (unique scale not used elsewhere)
- L117 icon 20px hard-coded (H2: matches `--icon-lg` 20、 token 化可能だが未対応)

#### 3. Welcome (hotspot origin: H2, H3, H4)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{4,5,6,8,10,16}` | 100% (6 scales) |
| gap | `--space-{2,3,4,5}`, raw 3px | 83% (1 raw) |
| border-radius | `--radius` | 100% |
| box-shadow | `0 4px 16px, 0 0 12px/20px` raw rgba | 0% (H4) |
| font-size | `--text-{5xl,xl,lg,base,sm,md}` | 100% |
| icon size | 40px logo, 32px avatar (raw) | 0% (H2) |

**Hotspots:**
- L64 logo gap `--space-4` unique combo top-level
- L124-126 button shadow raw rgba color math (H4)
- L257 project card `gap: 3px` raw (H3)

#### 4. FileTree (hotspot origin: H2, H3, H6)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,5}` | 100% (4 scales) |
| gap | `--space-{2,3}`, raw 2px | 67% (1 raw) |
| border-radius | `--radius-sm` | 100% |
| box-shadow | none / inset 2px shadow | 100% |
| font-size | `--text-{base,md,xs,2xs}` | 100% |
| icon size | 10px arrow / arrowSpacer, 6px dots (raw) | 0% (H2) |
| min-height | 22px row (virtualization) | 0% (intentional) |

**Hotspots:**
- L70 row padding `--space-1 --space-4` (vertical=1, horizontal=4)
- L94 focus indicator `inset 2px 0 0 var(--gold)` — 左 edge 専用、 unusual
- L105 arrow 10px + flex-shrink-0 + arrowSpacer 10px = duplication (H2)

#### 5. Search (hotspot origin: H1, H6)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,6,8}` | 100% (5 scales) |
| gap | `--space-{2,4}` | 100% |
| border-radius | `--radius-sm` | 100% |
| box-shadow | none | 100% |
| font-size | `--text-{base,md,2xs,xs}` | 100% |

**Hotspots:**
- L74 file name padding `--space-2 --space-4` (H6 input variance)
- L85 match padding `--space-1 --space-4 --space-1 --space-8` — asymmetrical 4-value (H1)

#### 6. Settings (hotspot origin: H1, H5)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,8,10}` | 100% (4 scales) |
| gap | `--space-{2,3,4,6}` | 100% |
| border-radius | `--radius`, `--radius-sm`, `--radius-dialog` | 100% (3 variants) |
| box-shadow | `--rim-top`, `--shadow-dialog` | 100% |
| font-size | `--text-{lg,base,2xl,sm}` | 100% |

**Hotspots:**
- L48 header padding `--space-8 --space-10` (H1: largest combo, 1.25× wider than content)
- L91 content padding same `--space-8 --space-10` but section margin-bottom `--space-12` (rhythm mismatch)
- L37 / L124 radius variance: `--radius-dialog` panel vs `--radius` inputs (H5)

#### 7. Kanban (hotspot origin: H1, H3)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,6,8}` | 100% (5 scales) |
| gap | `--space-{1,2,3}` | 100% |
| border-radius | `--radius`, `--radius-sm` | 100% |
| box-shadow | none / glass tokens | 100% |
| font-size | `--text-{sm,md,2xs}` | 100% |
| icon size | 5/6px dots, 48px placeholder | 0% (H2) |

**Hotspots:**
- L184 .groupEmpty `--space-4 --space-8` (widest 8) but .groupHeader `--space-3 --space-6` — 2x gap (H1)
- L191 .groupEmpty margin `--space-1 --space-6 --space-3` — 3-value margin
- L198 item indent `padding-left: calc(var(--space-8) - 2px)` raw math (H3)

#### 8. SCMPanel (hotspot origin: H1, H3, H6)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,6}` | 100% |
| gap | `--space-{2,6}`, raw 2px | 67% (1 raw, H3) |
| border-radius | `--radius-sm` | 100% |
| box-shadow | none | 100% |
| font-size | `--text-{xs,sm}` | 100% |
| icon size | 14px fileStatus, 6px dots (raw) | 0% (H2) |

**Hotspots:**
- L13 .branchBar `--space-2 --space-6` vs L? .commitArea `--space-4 --space-6` (H1: 2x vertical)
- L170 .groupActions / .fileActions raw `0 2px` padding (H3)
- L201 .fileRow `1px var(--space-6) 1px calc(var(--space-6) + 16px)` — raw px in top/bottom + math left

#### 9. StatusBar (hotspot origin: H1, H2, H4)

| property | values found | token-coverage |
|---|---|---|
| padding | `0 var(--space-6), --space-{1,2,3}` | 100% |
| gap | `--space-{1,2,4}` | 100% |
| border-radius | `--radius-sm`, `--radius` | 100% |
| box-shadow | `0 -4px 16px` raw inline | 0% (H4) |
| font-size | `--text-sm` | 100% |
| icon size | 16px badge, 12px separator (raw) | 0% (H2) |

**Hotspots:**
- L94 picker padding `--space-2 --space-6` vs action `--space-1 --space-3` (H1: 2x)
- L52 separator hard-coded `12px` height (H2)
- L171 badge `min-width: 16px; height: 16px` — only one with min/max ratio constraint

#### 10. ProjectHeaderBar (hotspot origin: H2)

| property | values found | token-coverage |
|---|---|---|
| padding | `0 var(--space-{3,6})` | 100% |
| gap | `--space-{1,2,4,5}` | 100% |
| border-radius | `--radius-sm`, raw 0 | 100% |
| font-size | `--text-{lg,xs}` | 100% |
| icon size | 48px button, 36px min-w, 46×48 window controls (all raw) | 0% (H2) |

**Hotspots:**
- L142-148 redundant `width: 36px; min-width: 36px` + `border-radius: 0` (H5 mismatch)
- L179 window controls `46px × 48px` raw — intentional native chrome (will keep with comment)
- L41 chromeCluster gap `--space-1` vs .left gap `--space-5` — 5x difference (H1)

#### 11. MenuBar (hotspot origin: H1)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{3,5}` | 100% |
| gap | `--space-{2,4}` | 100% |
| border-radius | `--radius-sm`, `--radius-dialog` | 100% |
| box-shadow | `--rim-top` + `--shadow-elevated` | 100% |
| font-size | `--text-{base,sm}` | 100% |

**Hotspots:**
- L31 dropdown `min-width: 240px` — only hard-coded width
- L130 divider `--space-2 --space-4` margin — only UI element using this combo

#### 12. AgentTerminal (hotspot origin: H3)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,4,6}` | 100% |
| gap | `--space-4` | 100% |
| border-radius | `--radius-sm` | 100% |
| font-size | `--text-{sm,xs}` | 100% |
| min-height | 2px border (raw) | 0% (H3) |

**Hotspots:**
- L7 `border-top: 2px solid` — only panel with explicit 2px border (H3)
- L56 exit overlay `--space-6` positioning + `--space-2 --space-4` padding asymmetry

#### 13. PRInspector (hotspot origin: H1, H5)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,5,6}` | 100% (5 scales) |
| gap | `--space-{1,3,4}` | 100% |
| border-radius | `--radius-sm`, `--radius`, raw `999px` | 67% (H5) |
| box-shadow | `--rim-top` + `--shadow-elevated` | 100% |
| font-size | `--text-{sm,xs,2xs,md}` | 100% |
| icon size | 22px iconBtn (raw) | 0% (H2) |

**Hotspots:**
- L87 prCard padding `--space-3 --space-4` — unique 3/4 combo (H1)
- L126 pill radius `999px` (hardcoded) vs `--radius` panel (H5: intent mismatch)
- L120 stat pill `1px var(--space-2)` (H3: raw px top/bottom)

#### 14. Analytics (hotspot origin: H3, H4, H5)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,8}` | 100% |
| gap | `--space-{3,4,6}`, raw 2/3px | 71% (2 raw, H3) |
| border-radius | `--radius-sm`, raw 4/2px | 67% (H5) |
| box-shadow | none (background colors) | 100% |
| font-size | `--text-{sm,xs,lg,2xs}` | 100% |
| icon size | 6px dots (raw) | 0% (H2) |
| min-height | 8/4/2px cost bars (raw) | 0% (H3) |

**Hotspots:**
- L140 cost bar `height: 8px` → L? `4px` → 2px borders ladder (H2/H3)
- L141, L194 raw `4px`, `2px` border-radius (H5)
- L174, L215 raw `3px`, `2px` gap (H3)
- L108 metric gap `2px` — only 2px gap in entire app

#### 15. WorkflowBuilder (hotspot origin: H3)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,6,8}` | 100% (5 scales) |
| gap | `--space-{1,3}`, raw 3px | 67% (H3) |
| border-radius | `--radius`, `--radius-sm`, `--radius-dialog` | 100% (3 variants) |
| box-shadow | `--rim-top`, `--shadow-dialog`, `--shadow-elev-2` | 100% |
| font-size | `--text-{xs,sm}` | 100% |
| icon size | 8px handles (raw) | 0% |

**Hotspots:**
- L86 step bar `gap: 3px` raw (H3)
- L131 node `min-width: 160px` hard-coded
- L166-169 handle `width: 8px !important` (§5.2 rule violation 既存)

#### 16. WorkflowPanel (hotspot origin: H3)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{4,6}`, raw 2/4px | 67% (2 raw, H3) |
| gap | `--space-{1,2,3,4}`, raw 3px | 80% (H3) |
| border-radius | `--radius-sm` | 100% |
| font-size | `--text-{xs,2xs}` | 100% |
| icon size | 22px buttons (raw) | 0% |

**Hotspots:**
- L95 phase detail `padding: 2px 4px` (H3)
- L86 step gap `3px` (H3, same as Builder)
- L29 badge `padding: 0 4px; border-radius: 8px` micro-padding + unique radius

#### 17. Watchdog (hotspot origin: H1)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3,4,8,10}` | 100% (5 scales) |
| gap | `--space-{1,3,4,6}` | 100% |
| border-radius | `--radius-sm`, `--radius`, `--radius-dialog` | 100% |
| box-shadow | `--rim-top`, `--shadow-dialog` | 100% |
| font-size | `--text-{base,sm,2xl}` | 100% |

**Hotspots:**
- L193-205 .cancelBtn `--space-3 --space-8` vs .createBtn `--space-3 --space-10` (H1: 2px difference)
- L110 .ruleToggle `--space-1` padding — singular usage
- L146 input `--space-3 --space-4` — unique combo

#### 18. IMEInputBar (hotspot origin: H3, H4)

| property | values found | token-coverage |
|---|---|---|
| padding | `--space-{2,3}`, `0 var(--space-2)` | 100% |
| gap | `--space-3` | 100% |
| border-radius | `--radius-sm` | 100% |
| box-shadow | `0 -4px 12px (raw), inset 0 1px 0 (raw)` | 0% (H4) |
| font-size | 10px, 11px (raw) | 0% (H3) |
| icon size | 18px IME indicator (raw) | 0% (intentional special) |
| min-height | 32px (raw) | 0% (intentional) |

**Hotspots:**
- L45-46 `font-size: 11px; font-family: var(--font-mono)` — only raw 11px in app
- L42-44 IME indicator 18px fixed (intentional non-grid)
- L83 `line-height: 1.4` (raw ratio, no token)
- L29-31 raw rgba shadow (H4)

#### 19. Toolkit (hotspot origin: minimal — Phase 5)

clean shared/ui ベース、 hotspot 起源 0。 Step 5 Bento 化候補。

#### 20-24. Shared UI: Button / PanelHeader / Toast / Tooltip / SplitPane / GitStatusPip

各々:
- **Button** (h H1): `--space-{1,3,4,6,10}` 6 scales, raw rgba shadow (H4), `inset 0 1px 0 (raw alpha)` + `0 8px 24px (raw color)`
- **PanelHeader** (H1): padding 4/6 vs dense 3/5 — 1 unit each axis less. count badge `1px --space-2` (H3)
- **Toast** (H3, H5): padding `--space-5/6` + raw 2px/8px (H3). border-left `3px solid` hard-coded (H5)
- **Tooltip**: clean、 hotspot 0
- **SplitPane** (H3): handle 1px/3px raw、 margin `0 -1px` (H3)
- **GitStatusPip** (H2): 5 different sizes (14/6/5/7px) — 14px letter / 6px dot / 5px untracked / 7px deleted、 1.5px border (H3)

---

## Hotspot origin counts (= Step 3 panel 選定の根拠)

各 hotspot が出現する panel 数 (= origin count):

| Hotspot | origin count | 主要 panel |
|---|---|---|
| **H1** Padding asymmetry | **24** (全 panel に存在) | 全 panel |
| **H2** Icon/dot 14 raw sizes | **18** | AgentInspector / GitStatusPip / FileTree / CommandPalette / Welcome / etc. |
| **H3** Micro-spacing 1/2/3/4 raw | **10** | Welcome / Workflow / Analytics / IMEBar / SCM / Toast / FileTree / Kanban / SplitPane / GitStatusPip |
| **H4** Shadow 35% raw rgba | **8** | AgentInspector / Welcome / IMEBar / Button / StatusBar / Toolkit / Workflow / Toast |
| **H5** Border-radius 5+2 tier mix | **7** | PRInspector / Settings / Welcome / Toast / ProjectHeaderBar / Watchdog / Analytics |
| **H6** Input padding 3x mismatch | **6** | CommandPalette / Settings / FileTree / Search / SCM / IMEBar |
| **H7** AgentInspector 3-layer multi-shadow unique | **1** | AgentInspector |

→ Phase 1 Step 3 で対応する 4 panel は hotspot origin score sum が最大の panel:

| panel | hotspot 起源 | score |
|---|---|---|
| AgentInspector | H1, H2, H4, H7 | 24+18+8+1 = 51 |
| Welcome | H2, H3, H4 | 18+10+8 = 36 |
| CommandPalette | H1, H2, H6 | 24+18+6 = 48 |
| FileTree | H2, H3, H6 | 18+10+6 = 34 |
| Settings | H1, H5 | 24+7 = 31 |
| SCM | H1, H3, H6 | 24+10+6 = 40 |
| Search | H1, H6 | 24+6 = 30 |
| Kanban | H1, H3 | 24+10 = 34 |

→ score top 4 = **AgentInspector (51) / CommandPalette (48) / SCM (40) / Welcome (36)**

→ ただし AgentInspector の H7 (multi-shadow unique) は **AgentInspector でのみ発生**、 他 panel に migrate value 弱い。 H7 を除いた score では:
- AgentInspector: 50
- CommandPalette: 48
- SCM: 40
- Welcome: 36
- FileTree: 34

→ Phase 1 Step 3 panel 選定: **AgentInspector / CommandPalette / SCM / Welcome** の 4 panel (各々 score 36+)。

(spec REV 2 の `CommandPalette / Welcome / FileTree / Search` は hotspot 起源数で見ると最適ではない。 REV 3 で再選定する。)

---

## Cross-panel inconsistency table

(condensed from subagent A output)

### 1. Padding scale explosion (24 panels)

space-1 〜 space-10 まで使用、 grid 不在。 「card」 patterns 4-6、 「input」 2-8、 「button」 1-10。

### 2. Border-radius (5 + 2 tier)

`--radius-sm` (90%) / `--radius` (80%) / `--radius-pill` / `--radius-dialog` / `999px` (raw、 PRInspector + Welcome) / `0` (intentional、 ProjectHeaderBar window controls).

### 3. Icon/dot 14 distinct sizes

3px / 5 / 6 / 7 / 8 / 10 / 14 / 16 / 18 / 20 / 22 / 32 / 36 / 40 / 46-48px。

### 4. Shadow 35% raw rgba

AgentInspector inset+0 4px 16px+0 0 20px / Welcome 0 4px 16px+0 0 12px/20px / Welcome project card raw rgba math / IMEBar 0 -4px 12px / Button raw rgba.

### 5. Input padding 3x mismatch

`2/4` (FileTree, Search) / `3/4` (SCM commit) / `3/5` (Settings) / `6/8` (CommandPalette) / `2/0` (IME).

### 6. Micro-spacing raw px

1/2/3/4 px gap が 10 sites、 token 不在。

---

**END**
