# Aether Terminal Native UI 設計書

> Tauri+React 版のUIを wgpu 直描画で完全再現（またはそれ以上）するための実装計画。

## 前提: エディタは搭載しない

Monaco Editor 相当の機能は VS Code に委譲する（Toolkit の「Open in VS Code」ボタン）。
ネイティブ版は**高性能ターミナル + AIワークスペース UI**に特化する。

---

## Phase 0: 透過・ブラー基盤の修正 (最優先)

### 問題
wgpu レンダラーが不透明な背景を描画し、Acrylic/Mica の透過効果を殺している。

### 修正項目

#### 0-1. サーフェス透過の確認
- `surface.rs`: `CompositeAlphaMode::PreMultiplied` が選択されていることを確認 → **済み**
- `renderer.rs`: clear color の alpha を 0.0 に変更（現在は 1.0 の可能性）
- **検証**: `cargo run --bin native-terminal` で壁紙が透けて見えること

#### 0-2. ブラーパイプラインの接続
`blur.rs` のシェーダーは完成済み。render.rs に接続するだけ。

```
レンダリング順序:
1. scene_texture にターミナル内容 + UI chrome を描画
2. ブラー対象領域（パレット/ダイアログの背景）を blur_pipeline で処理
3. ブラー済みテクスチャの上にフローティング UI を描画
4. 最終合成を swapchain surface に出力
```

実装箇所:
- `native/render.rs` の `render()` メソッド末尾
- パレット/ダイアログ描画前に `blur_pipeline.blur()` を呼ぶ
- `scene_texture` は既に `NativeTerminal` に確保済み

#### 0-3. ガラス階層の alpha 適用
全 UI コンポーネントの背景色を CSS の glass 変数と一致させる:

```rust
// ui/theme.rs に追加 (premultiplied RGBA)
pub const GLASS_CLEAR:    [f32; 4] = premul(12, 12, 12, 0.02);
pub const GLASS_GROUND:   [f32; 4] = premul(10, 10, 10, 0.85);
pub const GLASS_FRAME:    [f32; 4] = premul(16, 16, 16, 0.45);
pub const GLASS_STANDARD: [f32; 4] = premul(20, 20, 20, 0.55);
pub const GLASS_DENSE:    [f32; 4] = premul(22, 22, 22, 0.62);
pub const GLASS_THICK:    [f32; 4] = premul(28, 28, 28, 0.72);
pub const GLASS_SOLID:    [f32; 4] = premul(26, 26, 26, 0.82);

fn premul(r: u8, g: u8, b: u8, a: f32) -> [f32; 4] {
    let rf = r as f32 / 255.0 * a;
    let gf = g as f32 / 255.0 * a;
    let bf = b as f32 / 255.0 * a;
    [rf, gf, bf, a]
}
```

現在の `cat::` モジュールの色定数を全てこの形式に統一。

### 完了基準
- `cargo run --bin native-terminal` でデスクトップ壁紙が透けて見える
- パレットを開いた時、背景がブラーされる
- 左パネル/右パネル/ヘッダー/ステータスバーが異なる透過度で表示される

---

## Phase 1: レイアウトシステムの構築

### 問題
全UIが手計算ピクセル座標。CSS の flexbox/grid 相当が存在しない。

### 解決: 軽量レイアウトエンジン

```rust
// ui/layout.rs (新規)
pub struct LayoutBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub struct FlexLayout {
    pub direction: FlexDirection,  // Row | Column
    pub gap: f32,
    pub padding: [f32; 4],        // top, right, bottom, left
    pub children: Vec<FlexChild>,
}

pub enum FlexChild {
    Fixed(f32),       // 固定サイズ (48px, 24px, etc.)
    Flex(f32),        // flex: N (残りスペースの比率)
    Content,          // 内容に合わせる
}

impl FlexLayout {
    pub fn compute(&self, available: LayoutBox) -> Vec<LayoutBox> { ... }
}
```

### アプリレイアウトの定義

```
Window (Column)
├── ProjectHeaderBar   Fixed(48)
├── MenuBar            Fixed(24)
├── Main               Flex(1)    (Row)
│   ├── LeftPanel      Fixed(180) (Column)
│   │   ├── FileTree   Flex(1)
│   │   ├── Kanban     Flex(1)
│   │   └── SCMPanel   Flex(1)
│   ├── CenterPanel    Flex(1)    (Column)
│   │   └── Terminal   Flex(1)
│   └── RightPanel     Fixed(320) (Column)
│       ├── AgentInsp  Flex(1)
│       ├── Workflow   Content
│       └── Toolkit    Content
├── WorkspaceTabs      Fixed(28)
└── StatusBar          Fixed(24)
```

### 完了基準
- ウィンドウリサイズ時に全パネルが正しくリフロー
- 各パネルの背景色が CSS のガラス階層と一致

---

## Phase 2: コンポーネント別 UI 再現

各コンポーネントを CSS Module の値と完全一致させる。
**1コンポーネントずつ実装 → `cargo run` で目視確認 → 次へ**。

### 2-1. ProjectHeaderBar (48px)
```
背景: GLASS_FRAME + blur(20px)
境界: 下辺 1px border(white-6)
内容:
  [Logo 32x32 r=4] [gap=10]
  [Column]
    [projectName 14px semibold text-primary]
    [Row: branch 10px mono green | changes 10px mono gold]
  [Spacer flex=1]
  [statusDot 6px pulse animation]
  [statusLabel 10px muted]
  [model 11px mono blue]
  [cost 10px mono peach]
  [buttons: refresh, settings, minimize, maximize, close]
```

### 2-2. MenuBar (24px)
```
背景: transparent
内容: [File] [Edit] [View] [Terminal] [Help] (各13px, text-secondary)
ホバー: bg white-6, color text-primary, r=4
ドロップダウン: GLASS_THICK + blur(20px) + shadow-lg, r=8, min-w=220
```

### 2-3. StatusBar (24px)
```
背景: rgba(15, 15, 15, 0.42) + blur(12px)
境界: 上辺 1px border(white-6)
左: [shell 11px white-50] [branch 11px green] [changes 11px gold]
右: [encoding 11px] [lineCol 11px] [agent status 11px]
```

### 2-4. WorkspaceTabs (28px)
```
背景: GLASS_FRAME
境界: 上辺 1px border
タブ: 10px text-muted, r=4, hover: bg white-6
アクティブ: text-primary, bg white-6
Activity dot: 5px green circle, pulse animation
```

### 2-5. LeftPanel — FileTree
```
背景: GLASS_STANDARD + blur(20px)
ヘッダー: 12px semibold uppercase tracking=0.03em text-secondary
行: 22px高, padding 1px 8px, r=4
  hover: bg white-4, color text-primary
  矢印: 9px white-25, 回転90deg on open
  ファイル名: 13px text-secondary (changed=gold, added=green)
  変更ドット: 5px circle (gold/green/red)
```

### 2-6. LeftPanel — KanbanBoard
```
ヘッダー: 13px semibold text-primary + count badge (10px mono bg white-6 r=8)
グループ: 11px semibold uppercase tracking=0.03em
  ドット: 6px circle (todo=muted, progress=blue, review=yellow, done=green)
タスク: 12px text-secondary, drag cursor
  priority dot: 5px (low=green, med=yellow, high=red)
  hover: bg white-4
  active: bg gold-8%, border-left 2px gold
```

### 2-7. LeftPanel — SCMPanel
```
コミットエリア: textarea 10px mono, focus border blue
ボタン: Stage All (bg white-6), Commit (bg green), Push (bg blue)
ファイル行: 10px, ステータス (M=yellow, A=green, D=red, U=red bold)
  hover: bg white-4, actions opacity 0→1
```

### 2-8. RightPanel — AgentInspector
```
カード: gradient bg (thick→dense), r=8, border white-10
  左ストライプ: 3px, accent color
  hover: translateY(-2px), glow shadow, stripe glow
  active: stronger glow, accent border
  statusDot 7px + name 13px w500 + pct 12px gold mono
  model 11px mono blue + cost 11px mono peach
  progress bar: 2px gold
ログ: 11px mono, tool_use=blue, error=red, system=muted italic
```

### 2-9. RightPanel — ToolkitPanel
```
グリッド: 2列, gap 6px
ボタン: bg white-3, 11px text-secondary, r=4
  hover: bg white-6, text-primary, shadow gold glow, translateY(-1px)
  badge: 4px circle
```

### 2-10. RightPanel — WorkflowPanel
```
折りたたみヘッダー: 11px, chevron回転
実行中カード: bg white-4, r=4
  ステップバー: running=green, waiting=yellow, passed=green70%, failed=red
```

### 2-11. CenterPanel — TerminalGrid
```
背景: GLASS_CLEAR (ほぼ透明)
セル: cell_width × cell_height
カーソル: block/bar/underline, blink 530ms
選択: rgba(200, 160, 80, 0.25)
検索ハイライト: rgba(249, 226, 175, 0.3)
```

### 2-12. フローティング UI

#### CommandPalette
```
位置: 上から80px, 中央寄せ, w=480, max-h=360
背景: GLASS_DENSE + blur(20px) + shadow 0 8px 32px black-50
overlay: rgba(0,0,0,0.5) + blur(12px)
入力: 15px, padding 12 16, border-bottom
項目: 14px, padding 8 12, r=8
  hover/selected: bg white-10, text-primary
  shortcut badge: 12px mono, bg white-6, r=4
spring animation: stiffness=400, damping=30
```

#### ダイアログ共通
```
overlay: rgba(0,0,0,0.5) + blur(8px)
パネル: GLASS_THICK or GLASS_SOLID, r=12, shadow-lg
タイトル: 17px semibold text-primary
ボタン: Cancel (ghost) + Action (gold bg)
spring animation: scale 0.95→1
```

#### Toast
```
位置: 右下 (bottom=40, right=16)
背景: GLASS_THICK + blur(20px) + shadow 0 8px 24px
border-left: 3px (info=blue, success=green, warning=yellow, error=red)
animation: slideIn from right 0.2s
auto-dismiss: 3s
```

---

## Phase 3: アニメーションシステム

### 既存: animation.rs
- `AnimatedValue::spring(stiffness, damping)`
- `AnimatedValue::ease_out(duration_frames)`
- `AnimatedValue::linear(duration_frames)`

### 追加必要
```rust
// ui/animation.rs に追加
pub struct AnimatedColor {
    current: [f32; 4],
    target: [f32; 4],
    speed: f32,  // 0.0-1.0, frames to converge
}

impl AnimatedColor {
    pub fn tick(&mut self) {
        for i in 0..4 {
            self.current[i] += (self.target[i] - self.current[i]) * self.speed;
        }
    }
}
```

### アニメーション対象
| 要素 | 種類 | CSS 相当 |
|------|------|---------|
| パレット表示 | Spring(400, 30) | scale 0.95→1, opacity 0→1 |
| ダイアログ表示 | Spring(400, 30) | scale 0.95→1, opacity 0→1 |
| トースト入退場 | EaseOut(0.2s) | translateX 20→0, opacity 0→1 |
| ツールチップ | EaseOut(0.12s) | scale 0.96→1, opacity 0→1 |
| メニュー展開 | EaseOut(0.1s) | translateY -4→0, opacity 0→1 |
| ステータスドット | Pulse 2s infinite | scale 1↔1.15, opacity 1↔0.9 |
| タブ Activity | Pulse 1.5s infinite | 緑ドット点滅 |
| ホバー遷移 | Linear(120ms) | bg/color smooth transition |
| サイドバー幅 | Spring(300, 25) | 開閉アニメーション |
| カード選択 | EaseOut(280ms) | translateY(-2px) + glow |

---

## Phase 4: Light Leak + プリズマティック効果

### CSS の効果
```css
#root::before { radial-gradient(gold, 0.08 opacity, top-left) }
#root::after  { radial-gradient(cyan, 0.05 opacity, bottom-right) }
```

### wgpu 実装
`render.rs` の先頭に2つの `GradientRectInstance` を追加:
- Gold light leak: 左上, 幅50%, 高さ50%, radial gradient
- Cyan light leak: 右下, 幅40%, 高さ40%, radial gradient

`gradient_rect.wgsl` は linear gradient のみ対応なので、
radial gradient 用の新しいフラグを追加:
```wgsl
// gradient_rect.wgsl に追加
if (gradient_type == 1u) {  // radial
    let center = vec2<f32>(0.3, 0.3);
    let dist = distance(uv, center);
    alpha = 1.0 - smoothstep(0.0, 0.7, dist);
}
```

---

## Phase 5: フォント改善

### 現状
- CascadiaCode + Consolas (mono only)
- IBM Plex Sans/Mono は未ロード

### 対応
1. IBM Plex Mono をプロジェクトに同梱 (`assets/fonts/`)
2. IBM Plex Sans を UI テキスト用に追加ロード
3. UI テキスト (ヘッダー名, メニュー, ラベル) は Plex Sans で描画
4. ターミナル / コード は Plex Mono で描画
5. フォント切り替えのために `FontManager` に `ui_font` フィールド追加

---

## 実装順序と依存関係

```
Phase 0 (透過+ブラー) ← 全ての見た目の基盤
    ↓
Phase 1 (レイアウト) ← コンポーネント配置の基盤
    ↓
Phase 2 (コンポーネント再現) ← 1つずつ順番に
  2-1  HeaderBar
  2-2  MenuBar
  2-3  StatusBar
  2-4  WorkspaceTabs
  2-5  FileTree
  2-6  KanbanBoard
  2-7  SCMPanel
  2-8  AgentInspector
  2-9  ToolkitPanel
  2-10 WorkflowPanel
  2-11 TerminalGrid
  2-12 フローティングUI (Palette, Dialogs, Toast)
    ↓
Phase 3 (アニメーション) ← Phase 2 と並行可能
    ↓
Phase 4 (Light Leak) ← 仕上げ
    ↓
Phase 5 (フォント) ← 仕上げ
```

## テスト方針

**全フェーズ共通**: 実装したら即 `cargo run --bin native-terminal` で目視確認。
`cargo check` だけでは完了としない。

各コンポーネントで確認すること:
1. 色が CSS 変数の値と一致しているか
2. サイズ・パディング・マージンが CSS と一致しているか
3. ホバー状態が正しく反応するか
4. 透過度がガラス階層と一致しているか
5. アニメーションが滑らかか

## 見積もり

| Phase | セッション数 |
|-------|------------|
| Phase 0 | 1 |
| Phase 1 | 1 |
| Phase 2 (12コンポーネント) | 4-6 |
| Phase 3 | 1 |
| Phase 4-5 | 1 |
| **合計** | **8-10** |
