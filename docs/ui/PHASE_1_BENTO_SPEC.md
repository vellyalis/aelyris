# Phase 1 — Bento + nested layered cards spec (REV 4)

**Status**: DRAFT REV 4 (2026-04-28、 user 方向修正反映後)
**Bar**: Apple HIG / Steve Jobs minimum standard (= 引き算 / 計測可能 / 重複ゼロ / 装飾ゼロ)
**Scope**: 周辺 panel のみ (terminal 本体は flat 維持)
**Source companion**: `docs/ui/PHASE_1_PANEL_AUDIT_2026-04-28.md` (24 panel audit、 hotspot origin counts)

**REV 4 で user 方向修正に対応した点**:
1. **nested layered cards を Phase 1 主役** に明示 (§3.4 で 5 実装例 + CSS スニペット + ASCII mockup)
2. **shadow-as-border を Phase 1 採用** に昇格 (Phase 2 候補から、 §2 token 4→5: `--rim-hairline` 追加)
3. **commit 戦略を 「Step 1-5 を 1 PR」 に統合** (§6 改訂、 user 「全部作ってからでいい」 反映)
4. **「古臭い」 への直接対策**として、 modern visual hooks (luminance stacking visible / specular rim 強化 / Vercel-style shadow-as-border) を §3.7 で集中実装

---

## 0. 設計憲章 (= 計測可能な 5 条、 §5 NO list と独立 + 自動検出 enforce)

各 rule は CI / commit hook で検出可能なコマンドを併記:

| # | rule | 検出コマンド (CI enforce) |
|---|---|---|
| 1 | **新規 token は §2 の 4 本のみ** | `grep -E '^\s*--' src/styles/global.css \| diff <(git show b0b9362:src/styles/global.css \| grep -E '^\s*--')` で 4 行 diff |
| 2 | **depth ≤ 2 (parent + child glass、 grandchild は flat)** | Playwright `e2e/visual-regression.spec.ts` 内で `page.locator('[class*="bento-card"] [class*="bento-card"] [class*="bento-card"]')` の count == 0 を assert |
| 3 | **alpha ceiling ≤ 0.74** (`combined = 1 - (1-α₁)(1-α₂)`) | §3.4 matrix の ❌ ペアを使う class 組み合わせを grep: `grep -r 'glass-ground.*glass-thick\|glass-ground.*glass-ground\|glass-thick.*glass-thick\|glass-thick.*glass-ground' src/features/*.module.css` で hit 0 |
| 4 | **blur 1-layer only** (parent xor child の片方のみ) | `grep -B 5 'backdrop-filter:.*blur' src/features/*/*.module.css` で nested selector path 検出、 0 |
| 5 | **spacing は既存 `--space-*` のみ** (`--space-{0,1,2,3,4,5,6,8,10,12,16}`) | `grep -E '\b(padding\|margin\|gap):\s*[0-9]+(\.[0-9]+)?(px\|rem)' src/features/*/*.module.css` で 4 倍数外の raw 値 0 |

5 条以外は §5 NO リストに集約、 §0 と §5 で同 rule の重複は禁止。

---

## 1. Inventory

### 1.1 Carrying assets (= Phase 1 で touch しない既存 token)

| 領域 | token | 階層 | 備考 |
|---|---|---|---|
| Glass | `--glass-{clear,ground,frame,standard,dense,thick,solid}` | 7 | Mica 透過に最適化済 (2026-05-02 tuning) |
| Spacing | `--space-{0,1,2,3,4,5,6,8,10,12,16}` | 11 | 4px base |
| Radius | `--radius-{sm,(default),lg,dialog,panel,pill}` | 6 | sm=4 / 8 / lg=12 / dialog=12 / panel=8 / pill=9999 |
| Row height | `--row-h-{dense,standard,comfortable}` | 3 | 24 / 28 / 32 |
| Icon | `--icon-{sm,md,lg}` | 3 | 10 / 14 / 20 |
| Text | `--text-{2xs..5xl}` | 11 | +1px Apple HIG compliance |
| Shadow | `--shadow-{ambient,key,contact,elevated,dialog}` + `--shadow-elev-{1..4}` | 5 + 4 alias | Apple 3-stack + Linear 5-stop |
| Easing | `--ease-{apple,apple-bounce,silk,inout,out,breath}` | 6 | Apple spring primary |
| Letter-spacing | `--tracking-{display,heading,body,caption,micro,label}` | 6 | 負トラッキング (label のみ正) |
| Z-index | `--z-{base,dropdown,sticky,overlay,modal,toast,tooltip}` | 7 | |
| Rim / Specular | `--rim-top` `--rim-top-strong` `--lens-edge` | 3 | Liquid Glass extension |

### 1.2 Apple HIG gap (= Phase 1 で対応 / 明示却下)

| ギャップ | Apple stance | Aether 現状 | Phase 1 |
|---|---|---|---|
| Single chrome accent | Apple Blue 1 色のみ | gold + ctp blue/mauve/cyan/magenta が chrome で混在 | **必須対応** (chrome → gold 1 色) |
| SF optical sizing | Display ≥20 / Text ≤19 自動切替 | IBM Plex Sans のみ | 却下 (font 第 2 face 導入の cost > benefit) |
| Shadow-as-border | Vercel 流、 Mica と整合 + nested cards の depth 表現に最適 | 一部 panel で raw `border: 1px` 使用 | **Phase 1 採用** (= `--rim-hairline` token 追加、 nested card 区切りに使用) |
| Whisper border | Linear / Notion 流 | `--rim-top` に部分実装済 | 既存 token 活用 + nested card 内側 border に拡大適用 |
| Luminance stacking visible | Linear 流、 alpha 重畳ではなく明度差で depth 表現 | 5-level glass alpha で実装済だが視覚的に弱い | **Phase 1 強化** (= nested card で alpha 差 ≥ 0.07 を確保、 視覚的に layer 識別可能に) |

### 1.3 24-panel hotspots (= source: `PHASE_1_PANEL_AUDIT_2026-04-28.md`、 origin count 付き)

| # | hotspot | origin count | 主要 panel |
|---|---|---|---|
| H1 | Padding asymmetry (3-10x scale) | **24** (全 panel) | 全 panel |
| H2 | Icon/dot 14 distinct sizes (3-48px raw) | **18** | AgentInspector / GitStatusPip / FileTree / CommandPalette / Welcome / etc. |
| H3 | Micro-spacing 1/2/3/4 raw px | **10** | Welcome / Workflow / Analytics / IMEBar / SCM / Toast / FileTree / Kanban / SplitPane / GitStatusPip |
| H4 | Shadow 35% raw rgba | **8** | AgentInspector / Welcome / IMEBar / Button / StatusBar / Toolkit / Workflow / Toast |
| H5 | Border-radius 5+2 tier mix | **7** | PRInspector / Settings / Welcome / Toast / ProjectHeaderBar / Watchdog / Analytics |
| H6 | Input padding 3x mismatch | **6** | CommandPalette / Settings / FileTree / Search / SCM / IMEBar |
| H7 | AgentInspector 3-layer multi-shadow unique | **1** | AgentInspector のみ |

### 1.4 Hotspot scope decision (= H1-H7 をどの Step で閉じるか)

| H | Closed by Step | 根拠 |
|---|---|---|
| H1 (24 origin) | Step 2 (mechanical) + Step 3 (visual semantic) + Step 4 (chrome cluster) | 24 panel 全部に影響、 全 step で順次対応 |
| H2 (18 origin) | Step 2 (mechanical: 6/14/20px → token) + Step 3 (visual: status dot 5/6/7→6 統一) | mechanical で取れる箇所が大半 |
| H3 (10 origin) | Step 2 (mechanical: 1/3px → `--space-1`、 2/4 → token) | 全部 mechanical |
| H4 (8 origin) | Step 2 (mechanical: raw rgba → `--shadow-elev-*` if equivalence) + Step 3 (visual: AgentInspector 3-layer audit) | 大半 mechanical、 1 件 (H7 と重複) は visual |
| H5 (7 origin) | Step 2 (mechanical: raw 999/4/2px → token) + Step 4 (chrome cluster: dialog/lg merge 候補は Phase 2 へ) | mechanical のみ Phase 1 |
| H6 (6 origin) | Step 3 (visual semantic: input 全 panel 統一) | semantic shift、 visual review 必須 |
| H7 (1 origin) | **Step 5 (optional、 AgentInspector Bento 化)** | 1 panel のみ、 visual impact 限定。 Phase 1 close 必須ではない |

→ Phase 1 close = H1-H6 が green。 H7 は Step 5 で closure できれば Phase 1 完了、 できなければ Phase 2 持ち越し。

---

## 2. New tokens (= 5 本、 各々 justify)

### 2.1 `--bento-cell: 80px`

最小 cell サイズ。 Apple HIG 推奨 tap target (44px) × 約 2 = 88px が「label + 1 metric」 を含む最小、 80px でほぼ等価。 既存 `--space-*` (max 32px) では表現不可、 `--row-h-comfortable` (32px) × 2.5 でも非整数。 **新規必須**。

### 2.2 `--aspect-wide: 3 / 2`

Bento wide cell の縦横比。 16:9 (動画) / 4:3 (写真) はターミナル context で過剰、 3:2 が情報密度に最適 (audit 結果)。 `--aspect-square: 1/1` は CSS native `aspect-ratio: 1` で済むので token 化しない。

### 2.3 `--cq-narrow: 240px`、 `--cq-wide: 360px`

Container query (panel 幅依存の reflow)。 既存 `left-panel` min-width 200 / max 480、 `right-panel` min 260 / max 480 の median を取って 240 / 360。 panel 個別 reflow に必須。

### 2.4 `--rim-hairline` (shadow-as-border)

**Why**: nested layered cards の **child surface 周囲を 1px 線で区切る** modern hook。 Vercel 流の `box-shadow: 0 0 0 1px rgba(0,0,0,0.08)` パターン。 既存 `--rim-top` は **上端 1px** highlight のみで、 全周 hairline は存在しない。 nested card で「親 card 内に子 card が乗ってる」 ことを明示する視覚 cue として必須。

```css
--rim-hairline: 0 0 0 1px rgba(255, 255, 255, 0.06);     /* outer hairline */
--rim-hairline-inset: inset 0 0 0 1px rgba(255, 255, 255, 0.06); /* inner hairline */
```

(token は 1 本、 `--rim-hairline` のみ。 inset variant は同 token を呼び出し時に `inset` キーワード付加で表現可能、 別 token 不要。 ただし既に inset 必要なら別 token 化、 今は 1 本で開始。)

→ **新 token 数: 5** (`--bento-cell` / `--aspect-wide` / `--cq-narrow` / `--cq-wide` / `--rim-hairline`)。 r1 r2 で「4 本のみ」 と書いたが REV 4 で +1。

### 2.5 没にした候補 (= 引き算根拠)

| 候補 | 没理由 |
|---|---|
| `--bento-gutter: 12px` | 既存 `--space-6` (12px) と同値 |
| `--bento-pad: 16px` | 既存 `--space-8` (16px) と同値 |
| `--aspect-square: 1 / 1` | CSS `aspect-ratio: 1` で十分 |
| `--space-micro: 1px` | 1/3px raw を `--space-1` (2px) に round up |
| `--rim-hairline-inset` 別 token | inset prefix 付加で同値、 別 token 不要 |

---

## 3. Bento layout rule

### 3.1 Container declaration (既存 token のみ使用)

```css
.bento-container {
  container-type: inline-size;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--bento-cell), 1fr));
  gap: var(--space-6);     /* 12px */
  padding: var(--space-8); /* 16px */
}
```

### 3.2 Cell span utility

```css
.bento-cell      { aspect-ratio: 1; }
.bento-cell-wide { grid-column: span 2; aspect-ratio: var(--aspect-wide); }
.bento-cell-tall { grid-row: span 2; }
.bento-cell-2x2  { grid-column: span 2; grid-row: span 2; }
```

### 3.3 Card surface (depth-1)

```css
.bento-card {
  background: var(--glass-thick);
  backdrop-filter: blur(20px);
  border-radius: var(--radius);
  border: 1px solid var(--white-6);
  box-shadow: var(--rim-top);
  padding: var(--space-8);
}
```

### 3.4 Nested layered card — Phase 1 で実装する 5 例 (= user 「nested layered cards 取り入れた？」 への直接回答)

**全 5 例**で、 親 card (depth-1) + 子 card (depth-2) の重ね、 各々:
- alpha ≤ 0.74 で Mica 透過保持
- alpha 差 ≥ 0.07 で luminance stacking 可視化
- 子 card 周囲に `--rim-hairline` で 1px 区切り (modern hook)
- blur は parent xor child の片方のみ
- grandchild は flat (透明 / solid color)

#### 例 1: Sidebar rail + nav group card

```
┌─────────────────────────────┐ ← left-panel (glass-standard 0.35)
│  ┌───────────────────────┐  │
│  │ glass-thick 0.55      │  │ ← combined 0.7075、 visible layer
│  │ ┌───────────────────┐ │  │
│  │ │ transparent (flat)│ │  │ ← grandchild (depth-3)
│  │ └───────────────────┘ │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

```css
.left-panel { /* depth-1 parent */
  background: var(--glass-standard); /* 0.35 */
  backdrop-filter: blur(20px);
  border: 1px solid var(--white-6);
}
.left-panel .nav-card { /* depth-2 child */
  background: var(--glass-thick); /* 0.55 → combined 0.7075 ✅ */
  /* NO backdrop-filter — parent already has blur */
  box-shadow: var(--rim-hairline); /* 1px outer hairline */
  border-radius: var(--radius); /* 8px */
  padding: var(--space-6);
}
.left-panel .nav-card .item { /* grandchild flat */
  background: transparent;
}
```

#### 例 2: Right panel + detail card (high info density)

```css
.right-panel { /* dense 0.42 */
  background: var(--glass-dense);
  backdrop-filter: blur(24px);
}
.right-panel .detail-card { /* thick 0.55 → combined 0.7390 ✅ ぎりぎり */
  background: var(--glass-thick);
  box-shadow: var(--rim-hairline-inset); /* inset variant */
  border-radius: var(--radius);
}
```

luminance diff = 0.13 (大、 視覚的に明確に layer 識別可能)。

#### 例 3: Frame chrome + tab strip (subtle layer)

```css
.app-header { /* frame 0.28 */
  background: var(--glass-frame);
  backdrop-filter: blur(20px);
}
.app-header .tab-strip { /* standard 0.35 → combined 0.5320 ✅ 余裕 */
  background: var(--glass-standard);
  box-shadow: var(--rim-hairline);
  border-radius: var(--radius-sm);
}
```

luminance diff = 0.07 (subtle、 chrome に溶け込む程度の layer)。

#### 例 4: Workspace + group card + transparent grandchild (3 visual depths)

```css
.workspace-tabs { /* standard 0.35 */
  background: var(--glass-standard);
  backdrop-filter: blur(20px);
}
.workspace-tabs .group-card { /* standard 0.35 → combined 0.5775 ✅ */
  background: var(--glass-standard);
  box-shadow: var(--rim-hairline);
  /* NO backdrop-filter */
}
.workspace-tabs .group-card .item { /* depth-3 flat — visible 3rd "layer" via transparency */
  background: transparent;
  border-bottom: 1px solid var(--white-6); /* whisper border */
}
```

depth-3 で background なしの transparent + whisper border で **視覚的に 3 層 perceive** させる (実際は 2 layer + flat、 alpha ceiling 守る)。

#### 例 5: Sidebar rail + info panel (max allowed combination)

```css
.sidebar-rail { /* ground 0.55 — darkest anchor */
  background: var(--glass-ground);
  backdrop-filter: blur(20px);
}
.sidebar-rail .info-panel { /* dense 0.42 → combined 0.7390 ✅ ceiling 直前 */
  background: var(--glass-dense);
  box-shadow: var(--rim-hairline);
  border-radius: var(--radius);
}
```

alpha ceiling 直前 (0.7390 / 0.74)、 visual で 「重い感じ」 が出る。 主要 dashboards / agent-inspector で使用候補。

### 3.4-bis Nested card alpha matrix (= 上記 5 例の根拠)

計算式: `combined = 1 - (1 - parentα) × (1 - childα)`、 ceiling = **0.74**

`clear` (terminal center、 alpha 0.02) は parent/child いずれにも nested しない (§0 rule 2 / terminal flat)。 `solid` (modal/dialog、 alpha 0.78) は overlay surface として独立、 Bento parent/child にしない (全組合せが ❌ ≥ 0.84 になるため自動的に除外)。 → 残り 5 level (ground/frame/standard/dense/thick) を parent / child に置くと 5 × 5 = **25 通り**:

| parent ↓ / child → | ground (0.55) | frame (0.28) | standard (0.35) | dense (0.42) | thick (0.55) |
|---|---|---|---|---|---|
| **ground** (0.55) | ❌ 0.7975 | ✅ 0.6760 | ✅ 0.7075 | ✅ 0.7390 | ❌ 0.7975 |
| **frame** (0.28) | ✅ 0.6760 | ✅ 0.4816 | ✅ 0.5320 | ✅ 0.5824 | ✅ 0.6760 |
| **standard** (0.35) | ✅ 0.7075 | ✅ 0.5320 | ✅ 0.5775 | ✅ 0.6230 | ✅ 0.7075 |
| **dense** (0.42) | ✅ 0.7390 | ✅ 0.5824 | ✅ 0.6230 | ✅ 0.6636 | ✅ 0.7390 |
| **thick** (0.55) | ❌ 0.7975 | ✅ 0.6760 | ✅ 0.7075 | ✅ 0.7390 | ❌ 0.7975 |

**集計**: ✅ **21 通り** / ❌ **4 通り** (= ground+ground / ground+thick / thick+ground / thick+thick) / 計 25 通り。

参考: solid を含めた完全 7 × 7 matrix では n/a 13 (clear 関与) + ❌ 15 + ✅ 21 = 49。 Phase 1 で関心があるのは Bento parent/child として有効な 25 通り部分。

### 3.5 Grandchild (depth-3) は flat

```css
.bento-card .bento-card .item {
  background: transparent;  /* or solid var(--ctp-surface0) */
  /* backdrop-filter は禁止 (§5.1) */
}
```

### 3.6 2026 トレンド採用 (= REV 4 で Phase 1 採用に昇格)

10-brand audit + user 方向修正を踏まえ、 以下を Phase 1 で **積極採用**:

| pattern | 採用形 | Phase 1 で適用する場所 |
|---|---|---|
| **Vercel shadow-as-border** (`box-shadow: 0 0 0 1px ...`) | `--rim-hairline` token (§2.4) | nested layered card (§3.4 全 5 例) の child surface 区切り |
| **Linear luminance stacking** (alpha 重畳ではなく明度差で depth 表現) | nested で alpha 差 ≥ 0.07 を確保 | §3.4 例 3-4 の subtle layer (= 0.07-0.13 luminance diff で「重なってる感」 を出す) |
| **Notion whisper border** (`1px solid rgba(255,255,255,0.06)`) | 既存 `--rim-top` 拡張 + 新 `--rim-hairline` | grandchild flat surface の row 区切り (§3.4 例 4) |
| **Apple specular rim** (existing `--rim-top`) | 全 nested card の上端で利用 | 「光が当たってる」 感を維持、 古臭さ回避の核 |
| **Multi-layer low-opacity shadow** (Notion / Cursor) | 既存 `--shadow-elevated` (Apple 3-stack) | Step 5 で AgentInspector の 3-layer multi-shadow を等価化 |

→ Phase 1 で **shadow-as-border + whisper border + luminance stacking + specular rim** の 4 modern hook を **同時実装**。 これが「古臭くない」 への直接対策。 既存 5-level glass scheme は維持、 hook は token + utility class 追加で実現。

(Apple 自身は nav blur 維持なので、 「blur 撤廃」 は方針転換しない、 hybrid に modern hook を重ねる。)

### 3.7 古臭さ回避の visual hooks (= Phase 1 で同時実装)

「古臭い」 と感じる原因 = (a) 平板な panel、 (b) 装飾の音楽性不足、 (c) edge / depth が見えない。 各々への対策:

| 原因 | 対策 | 実装場所 |
|---|---|---|
| **(a) 平板な panel** | nested layered cards (§3.4 全 5 例)、 各 panel に depth-2 で「重なり」 を入れる | Step 3 の 4 panel |
| **(b) 装飾音楽性不足** | Bento grid (§3.1-3.2)、 size grid + gap rhythm を統一 | Step 3 + Step 4 |
| **(c) edge / depth 見えない** | `--rim-hairline` で 1px 線、 `--rim-top` で上端 highlight、 luminance diff ≥ 0.07 | Step 1 (token) + Step 3 適用 |

加えて **modern micro-interaction**:
- hover で `transform: translateY(-1px)` + `box-shadow` 強化 (Linear / Vercel 流)、 ただし `prefers-reduced-motion` に対応
- focus で `--rim-hairline` を gold accent に切替 (Apple 流の selection ring)
- click で 100-150ms の subtle scale 0.99 (Apple spring `--ease-apple`)

(これらは §5.5 の motion 禁止と矛盾しないか確認:
- 「装飾的無限アニメ」 ≠ hover/focus/click は finite interaction → OK
- 「静的 card への hover transform」 は禁止だが、 これは **interactive** card に対する hover なので OK
- `prefers-reduced-motion` 対応は §5.5 で必須)

---

### 3.8 2026 トレンド観察 (= 普遍則ではない、 参考)

10-brand audit から:

- **Apple 自身は nav で blur 維持** (`backdrop-filter: saturate(180%) blur(20px)`)。 「blur ゼロ trend」 は誤った一般化。
- 2026 で blur 撤廃は **Vercel / Raycast / Notion / Stripe / Warp の 5/10**。 残り 5/10 (Apple / Linear / Cursor / Claude / Superhuman) は blur or border-shadow combo。
- 結論: Aether の Mica + 5-level glass は **Apple 系列**、 2026 トレンドの正規系列。 Phase 1 で blur 撤廃しない。
- ADAPT (Phase 2 候補): Vercel shadow-as-border、 Notion whisper border (`--rim-top` で既存)
- ADOPT (採用済): Linear luminance stacking (5-level glass scheme と同型)

### 3.7 Step 3 panel 選定根拠 (= hotspot origin score)

`PHASE_1_PANEL_AUDIT_2026-04-28.md` の hotspot origin counts に基づき、 各 panel の score (= 起源 hotspot の origin count 合計) を計算:

| panel | hotspot 起源 | score | Step 3? |
|---|---|---|---|
| **AgentInspector** | H1, H2, H4, H7 | 24+18+8+1 = 51 | ✅ Step 3 #1 |
| **CommandPalette** | H1, H2, H6 | 24+18+6 = 48 | ✅ Step 3 #2 |
| **SCM** | H1, H3, H6 | 24+10+6 = 40 | ✅ Step 3 #3 |
| **Welcome** | H2, H3, H4 | 18+10+8 = 36 | ✅ Step 3 #4 |
| Kanban | H1, H3 | 24+10 = 34 | Step 5 (optional) |
| FileTree | H2, H3, H6 | 18+10+6 = 34 | Step 5 |
| Settings | H1, H5 | 24+7 = 31 | Step 4 (chrome 整理) |
| Search | H1, H6 | 24+6 = 30 | Step 5 |
| 他 | (10 panel 略) | < 30 | Step 5 |

**Step 3 = score top 4 = AgentInspector / CommandPalette / SCM / Welcome**。

(REV 2 で書いた `CommandPalette / Welcome / FileTree / Search` は誤り、 hotspot origin score で再選定した)

---

## 4. Migration strategy (= 機械的 / 視覚 / 構造 の 3 種)

### 4.1 Mechanical tokenization (1 commit、 sed-replaceable、 visual diff = 0)

**真に diff 0 の置換のみ**:

| 現状 raw | 置換先 | 件数 | 視覚 diff |
|---|---|---|---|
| `4px` gap raw | `--space-2` (4px) | ~5 | 0 |
| `border-radius: 4px` raw | `--radius-sm` (4px) | ~4 | 0 |
| `border-radius: 999px` raw | `--radius-pill` (9999px、 視覚的に同じ) | ~2 | 0 |
| `border-radius: 12px` raw | `--radius-lg` (12px) | ~3 | 0 |
| 既存 token aliasing 矛盾 (`--aether-bg-*` 経由 vs `--glass-*` 直接) | `--glass-*` 統一 | ~多数 | 0 |

検証: `pnpm test` / `pnpm exec tsc --noEmit` / Playwright threshold ≤ 0.1%。 1 commit。

### 4.2 Visual / semantic changes (= 別 commit、 manual review 必須)

**1px 以上の shift を伴う変更はここ**:

| 現状 | 変更 | 視覚 diff | 該当 panel |
|---|---|---|---|
| `1px / 3px gap` raw | `--space-1` (2px、 round up) | ≤1px shift | Welcome / Workflow / Analytics |
| `padding: 1px N` raw | `padding: 0 N` | 1px shift | PRInspector stat pill / PanelHeader count badge |
| AgentInspector 3-layer multi-shadow (`inset + 0 4px 16px + 0 0 20px`) | `--shadow-elev-3` (= ambient + key + contact) audit、 等価なら置換、 違うなら理由 comment | 5-15% diff | AgentInspector (= H7) |
| AgentTerminal `border-top: 2px` | `1px` (他 panel と統一) | hairline shift | AgentTerminal |
| Status dot 5/6/7px | 6px に統一 (色で状態表現) | dot サイズ shift | AgentInspector / Kanban / FileTree |
| Icon 14 distinct → 既存 `--icon-{sm,md,lg}` 3 tier に collapse | `--icon-*` token 化、 例外は CSS comment 必須 | icon サイズ shift | 10+ panel |
| Input padding `2/4` `3/4` `3/5` `6/8` 混在 | `--space-3 var(--space-5)` に統一 | input height shift | FileTree / Search / SCM / CommandPalette / Settings (= H6) |

各変更は **個別 commit** + Playwright diff (threshold 10%) + manual screenshot review。

### 4.3 Structural changes (= Bento 化、 panel 個別 commit)

§6 Step 3-5 で実施。 panel 内の DOM 構造を Bento grid に書き換え。 sed 不可、 component 単位の手作業。

### 4.4 業界 baseline alignment

| 項目 | Apple HIG 必須? | Phase 1 |
|---|---|---|
| Single chrome accent (gold 1 色) | YES (Apple) | **必須** (Step 4 で実施、 chrome から ctp 8色除去) |
| Border-radius 4 → 3 tier collapse | NO (Apple は 6 tier) | candidate (Phase 2) |
| Shadow-as-border 採用 | optional | candidate (Phase 2) |
| Linear luminance stacking | implicit | 採用済 |

---

## 5. NO list (= 拡張禁止事項、 §0 と独立 / 重複禁止)

§0 で書いた 5 rule (token 数 / depth / alpha / blur / spacing) は **§5 では再掲しない**。 §5 はそれ以外の禁止のみ。

### 5.1 Layering (§0 rule 2-4 で enforce 済、 ここでは追加事項のみ)

| NO | 理由 |
|---|---|
| terminal canvas に backdrop-filter | terminal flat 死守、 文字 contrast 保護 (§0 rule 1-5 では明示してない要件) |
| dropdown / tooltip に Bento layout を入れる | overlay = 1 surface 1 機能、 nested 化すると視線が迷う |

### 5.2 Sizing

| NO | 理由 |
|---|---|
| 同 panel 内で flex と grid を同列混在 | 子 alignment 破綻 |
| icon tier 拡張 (`--icon-{sm,md,lg}` = 10/14/20 以外) | 視線分散 |
| icon size を `width: ... !important` で強制 | token 逃げ道、 既存 WorkflowBuilder L166-169 違反は Phase 1 で除去 |

### 5.3 Shadow / Border / Radius

| NO | 理由 |
|---|---|
| box-shadow の新規 elevation 階層 | 既存 4 階層 (`--shadow-elev-{1..4}`) で十分 |
| border-radius の新規値 (4/8/12/9999 以外) | 既存 4 tier で完結 |
| raw rgba multi-shadow を新規 | 既存 token 化済 |

### 5.4 Typography

| NO | 理由 |
|---|---|
| 新規 font 導入 | 既存 IBM Plex Sans + Mono で Apple HIG 合致 |
| weight 400/500/600 以外を chrome に | conventional ladder 維持。 Linear 510 等は Phase 2 検討 |
| 正 letter-spacing (label `--tracking-label` 以外) | 負トラッキングが Apple/Linear/Vercel 流の正規 |
| 装飾 gradient (`--gold-surface` 既存以外) | Apple HIG「pure color」 |

### 5.5 Motion / Animation

| NO | 理由 |
|---|---|
| 装飾的無限アニメーション (pulse / breathe / shimmer) を新規追加 | 周辺視野 noise、 Apple HIG「subtle motion only」 |
| 静的 card への hover transform (scale / translate) | 視線揺れ、 Apple HIG「motion serves function」 |
| `prefers-reduced-motion` 未対応の keyframes | a11y 必須 |
| 600ms 超の duration を chrome interaction に | 既存 `--duration-luxe` 500ms が上限 |

### 5.6 Color

| NO | 理由 |
|---|---|
| chrome に ctp 8色 (mauve / blue / cyan / magenta 等) を使う | §1.2 single accent rule、 chrome は gold |
| 同 component に gold 以外の chrome accent 追加 | 同上 |

### 5.7 a11y

| 項目 | Phase 1 内 / scope 外 |
|---|---|
| WCAG AA 4.5:1 contrast | **Phase 1 内** (既存 `--text-primary` × Mica 上 background は audit 済、 Phase 1 visual changes 後に再 verify) |
| Focus visible (`--focus-ring` / `--focus-ring-on-gold`) | **Phase 1 内** (§7.3 success gate で全 interactive 確認) |
| Keyboard nav (Tab / Shift+Tab / Arrow) | **Phase 1 内** (Radix primitives 維持) |
| `prefers-reduced-motion` | **Phase 1 内** (§5.5 で禁止規則化) |
| `prefers-color-scheme: light` (light theme) | **Phase 1 scope 外** (既存 dark のみで Catppuccin Mocha 固定、 light は Phase 3 以降) |
| High-contrast mode (Windows OS forced colors) | **Phase 1 scope 外** (Mica 透過と forced-colors mode は incompatible、 Phase 4+ 検討) |
| RTL (right-to-left languages) | **Phase 1 scope 外** (English / Japanese のみ supported、 RTL 対応は別 phase) |
| Print stylesheet | **Phase 1 scope 外** (terminal app は print 対象外) |

### 5.8 Process

| NO | 理由 |
|---|---|
| Phase 1 で wire format / Rust 変更 | scope 厳守、 frontend CSS only |
| Phase 1 で新規 component 作成 | 整理 + 引き算のみ、 機能追加 0 |
| `width: ... !important` で grid 上書き | §5.2 重複だが既存違反 (WorkflowBuilder) は Phase 1 で除去対象 |

---

## 6. Phase 1 scope (= Step 1-5、 **REV 4 で 1 unified PR に統合**)

REV 3 まで Step ごとに別 commit としていたが、 user 方向修正 「全部作ってからでいい」 に従い **Step 1-5 を 1 PR / 1 巨大 commit にまとめる** 戦略に変更。 user の視覚確認は 1 度きり、 commit も 1 度きり。

### 6.0 Unified PR scope

1 PR で以下全部を包含:
- §2 の 5 token 追加 (Step 1)
- §3 の `.bento-*` utility class 追加 (Step 1)
- §4.1 mechanical tokenization 全件 (Step 2)
- §4.2 visual / semantic 全件 (Step 3 内訳の総和)
- §3.4 の 5 nested layered example を 4 panel (Step 3) + chrome cluster (Step 4) に適用
- AgentInspector multi-shadow 解消 (Step 5 の H7 closure)
- chrome single accent (Step 4 の gold 統一)
- 必要 panel の Bento 化 (Step 5 partial — AgentInspector + Kanban のみ Phase 1 内)

Playwright spec は Step ごとの threshold ではなく **1 度の baseline 更新** で運用 (= 旧 baseline `b0b9362` → 新 baseline = 本 PR commit)。

### 6.1 Implementation order (= 1 PR 内の順序、 review 容易性のため)

### Step 1: Token + utility 追加 (1 commit)

- §2 の 4 token を `:root` に追加
- §3 の `.bento-container` `.bento-cell-*` `.bento-card` utility を追加
- 機能影響ゼロ、 consumer ゼロ
- 検証: `pnpm test` 全 pass、 `pnpm exec tsc --noEmit` clean、 Playwright diff ≤ 0.1%

### Step 2: Mechanical tokenization (1 commit)

- §4.1 の sed-replaceable のみ
- visual diff = 0
- 検証: vitest / tsc / Playwright threshold ≤ 2% (token 経路変化吸収のため余裕)

### Step 3: Visual / semantic changes (4 commit、 hotspot origin score top 4)

| 順 | panel | score | 対応 hotspot |
|---|---|---|---|
| 1 | **AgentInspector** | 51 | H1 (asymmetric padding) + H2 (status dot 5/6/7→6) + H4 (multi-shadow→token) — **H7 は Step 5** |
| 2 | **CommandPalette** | 48 | H1 (input padding 6/8 vs item 3/6) + H2 (icon 20px→`--icon-lg`) + H6 (input padding canonical) |
| 3 | **SCM** | 40 | H1 (branchBar 2/6 vs commitArea 4/6) + H3 (groupActions raw 2px) + H6 (commitInput 3/4 → canonical) |
| 4 | **Welcome** | 36 | H2 (icon 32/40/48 audit) + H3 (3px gap) + H4 (raw shadow → `--shadow-elev-2/3`) |

各 commit:
- Playwright diff threshold 10%、 visual review 必須
- screenshot を §10 Appendix 追記

### Step 4: Chrome cluster + single accent (1 commit)

- header / statusbar / palette outer / settings の余白統一
- chrome accent を gold 1 色に統一: `grep -r 'var(--ctp-' src/features/{header,statusbar,workspace-tabs,menubar}/` で hit 0 にする
- `--space-3` (6px) で button cluster gap 統一
- header `48px` / statusbar `24px` 高さ既存維持

### Step 5: Optional Bento 化 (= H7 + 残り panel)

- **AgentInspector Bento 化** (= H7 closure、 multi-shadow 解消 + Bento card 構造)
- Kanban Bento Board (= 既に Bento 的な構造、 整理)
- 他 panel (Settings / FileTree / Search / Toolkit / PRInspector / Analytics / Workflow / Watchdog) は Phase 1 close 必須ではなく Phase 2 候補
- 各 commit 1 panel、 individual review

---

## 7. Verification

### 7.1 Automated

```bash
# 1. Unit tests
pnpm test

# 2. Type check
pnpm exec tsc --noEmit

# 3. Playwright visual regression (e2e/visual-regression.spec.ts)
pnpm exec playwright test e2e/visual-regression.spec.ts

# 4. §0 rule 1 (token count) check
diff <(git show b0b9362:src/styles/global.css | grep -E '^\s*--' | sort -u) \
     <(grep -E '^\s*--' src/styles/global.css | sort -u)
# expected: 4 added lines (--bento-cell, --aspect-wide, --cq-narrow, --cq-wide)

# 5. §0 rule 5 (raw px) check
grep -E '\b(padding|margin|gap):\s*[0-9]+(\.[0-9]+)?(px|rem)' src/features/*/*.module.css | grep -vE ':(2|4|6|8|10|12|16|20|24|32|40|48|64|80)px'
# expected: 0 hits (例外は audit doc に記載済 panel のみ)

# 6. §0 rule 3 (alpha NG combo) check
grep -E 'glass-(ground|thick).*glass-(ground|thick)' src/features/*/*.module.css
# expected: 0 hits

# 7. chrome single accent (Step 4 完了後)
grep -r 'var(--ctp-\(red\|green\|yellow\|blue\|magenta\|cyan\|peach\|mauve\|sky\)' src/features/{header,statusbar,workspace-tabs,menubar}/
# expected: 0 hits
```

baseline:
- master `b0b9362` (round 9 close、 2026-04-28) を Playwright baseline
- screenshot 配置: `e2e/__screenshots__/visual-regression.spec.ts/<panel>.png`
- baseline 更新は Step 1 commit と同 commit (= 「token 追加によるごく僅かな diff」 を baseline 化)

threshold:
- Step 1: ≤ 0.1% (consumer ゼロ)
- Step 2: ≤ 2% (token 経路化吸収)
- Step 3-4: ≤ 10% + manual review
- Step 5: per-panel review (panel 内構造変化のため diff 大きい)

### 7.2 Manual (= Tauri / Mica 実機限定)

Win11 25H2 build 26200+ で:

- Mica wallpaper 透過保持
- backdrop-filter blur GPU 動作 (paint cost monitoring)
- DWM window corner 整合
- focus ring on gold (`--focus-ring-on-gold` 表示)
- terminal contrast (WCAG AA 4.5:1 以上)

`pnpm tauri:dev` 起動 + Tauri window で目視。 各 Step 後に screenshot を §10 に追記。

### 7.3 Per-step success gate

各 Step 完了の checklist (= 全部 green で次 Step へ):

- [ ] vitest 全 pass (自動)
- [ ] tsc clean (自動)
- [ ] Playwright diff ≤ Step threshold (自動)
- [ ] §7.1 grep checks 全 0 (自動)
- [ ] screenshot を §10 Appendix に追記 (手動)
- [ ] DOM inspector で alpha 重畳 0.74 超 nested 無し (手動)
- [ ] focus ring 全 interactive で表示 (手動)
- [ ] `prefers-reduced-motion` で全 keyframes 静止 (手動)
- [ ] chrome accent grep で gold 以外 0 (Step 4 後のみ、 自動)

自動 5 / 手動 4。 比率 = 5:4 ≈ 56% 自動。

---

## 8. Closing (= 計測可能な 3 文)

Phase 1 完了の客観基準:

1. **Token 数**: `:root` 内のカスタムプロパティは現状 +4 ちょうど (`--bento-cell` / `--aspect-wide` / `--cq-narrow` / `--cq-wide`)、 既存 token は 1 つも touch しない (検証: §7.1 cmd 4)。
2. **Raw px 制約**: 24 panel `*.module.css` 内で 4px 倍数外の raw padding/gap/radius は **0 件**。 例外は (a) virtualization 高さ (FileTree row 22px)、 (b) native chrome (window controls 46-48px)、 (c) IME bar special (32/18px)、 すべて CSS comment で根拠記載 (検証: §7.1 cmd 5)。
3. **Visual / a11y**: Playwright diff threshold 内、 全 nested で alpha ≤ 0.74、 全 interactive で focus ring 表示、 chrome accent gold 1 色 (検証: §7.1 cmd 6 + 7 + Playwright run)。

3 つ全部 green の時点で Phase 1 close。 主観判断 (「最新感」 「綺麗」) は使わない。

---

## 9. Operational (= rollback / owner / version pin)

### 9.1 Rollback procedure

各 Step 完了後の commit が次 Step の baseline。 任意の Step で問題が出た場合:

```bash
# Step N が問題 → Step N-1 baseline に rollback
git revert <step-N-commit-sha>
# Playwright baseline は同 commit で更新されているので、 revert で baseline も戻る
pnpm exec playwright test e2e/visual-regression.spec.ts  # green を確認
```

実機 verify で問題が見つかった場合 (= visual regression test では拾えない Mica 統合問題):

```bash
git revert <step-N-commit-sha>
# 再度 pnpm tauri:dev で 実機確認
```

破壊的変更 (= alpha ceiling 違反、 単一 accent 崩れ等) は revert 必須、 修正 commit (= roll-forward) は Phase 内では避ける (= 同 Step 再 commit でなく rollback → 設計再考 → 別 Step として実施)。

### 9.2 Owner per step

| Step | Owner | 責任 |
|---|---|---|
| Step 1 (token + utility) | Claude | 実装 + commit、 codex review |
| Step 2 (mechanical) | Claude (sed) + codex (review) | 機械的、 visual diff 0 を Playwright で証明 |
| Step 3 (4 panel visual/semantic) | Claude (実装) + codex (panel 単位 adversarial review) | 各 panel 1 commit、 manual screenshot を user 承認 |
| Step 4 (chrome cluster + single accent) | Claude + codex | chrome accent grep 0 を verify |
| Step 5 (optional Bento) | Claude (実装) + codex (review) + user (visual 承認) | Phase 1 close 必須ではない、 user 判断 |

### 9.3 Target version pin

Phase 1 動作前提:

| 項目 | version |
|---|---|
| Tauri | v2.x (現状 master) |
| WebView2 Runtime | 134.x (= Win11 25H2 default) |
| React | 19 |
| Vite | 7 |
| Playwright | (existing, e2e/playwright.config.ts に依存) |
| Win11 build | 22621+ (Mica 必須)、 dogfood は 25H2 build 26200+ |

WebView2 134 未満では `container-type: inline-size` (CSS Containment Level 3) のサポートが不完全な可能性、 Phase 1 で `@container` を使う場合は user の WebView2 update 後に dogfood verify 必須。

---

## 10. Appendix (= 各 Step 後に screenshot 貼付)

(空。 Step 1 commit 後に最初の screenshot 一式を追記する運用)

### 10.1 Step 1 baseline (post-commit)

(TBD)

### 10.2 Step 2 baseline (post-commit)

(TBD)

(以下、 Step 5 まで)

---

**END (REV 3)**
