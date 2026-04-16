# Aether Terminal V2 — フルネイティブ要件定義書

Version: 2.0.0
Date: 2026-04-16
Status: Draft
Predecessor: requirements.md (Tauri版 V1 — 廃止)

---

## 1. ビジョン

**Warp の描画品質 + Scape のオーケストレーション = Aether Terminal**

Windows環境における、フルネイティブRust製AIワークスペースターミナル。
WebView、Electron、JavaScript、HTML、CSS を一切使用せず、
wgpu による直接GPU描画で144fps以上を実現する。

**コアアイデンティティ:**
- Warp: フルネイティブGPU描画 + ブロック型出力 + リッチ入力 + 滑らかアニメーション
- Scape: マルチセッションオーケストレーション + Watchdog + Toolkit + Activity Feed
- Aether独自: Windows Premium (Mica/Acrylic) + エディタ内蔵 + SCM統合

**V1 (Tauri版) からの決定的変更:**
- Tauri + WebView2 → 完全削除
- React + xterm.js → 完全削除
- 全UIをRust + wgpu + WGSLシェーダーで自前描画
- npm/node_modules 依存ゼロ

---

## 2. 技術スタック

### 2.1 確定技術 (追加クレートゼロ)

既に Cargo.toml にある依存のみで全機能を実現する。

| レイヤー | クレート | 役割 |
|---------|---------|------|
| GPU描画 | `wgpu 25` | DX12/Vulkan バックエンド。全UI描画 |
| シェーダー | WGSL (wgpu内蔵) | glyph, rect, rounded_rect, blur, line |
| ウィンドウ | `winit 0.30` | イベントループ、入力、IME |
| フォント | `fontdue 0.9` | CascadiaCode + NotoSansJP ラスタライズ |
| ターミナルパーサー | `vte 0.13` | ANSI/VT100 エスケープシーケンス解析 |
| テキストバッファ | `ropey 1` | エディタ用 Rope データ構造 |
| シンタックス | `tree-sitter 0.24` | Rust/JS/Python/JSON/TOML 構文解析 |
| PTY | `portable-pty 0.8` | ConPTY (PowerShell/CMD/WSL/Git Bash) |
| Git | `git2 0.19` | Worktree, status, diff, branch |
| DB | `rusqlite 0.31` | セッション、コマンド履歴、分析データ |
| 設定 | `toml 0.8` + `serde` | config.toml 読み書き |
| Win32 API | `windows 0.61` | Mica/Acrylic, DWM, IMM32, 通知 |
| 非同期 | `tokio` | PTY I/O, ファイル監視 |
| ファイル監視 | `notify 7` | ファイル変更検出 |
| エラー | `thiserror 2` | 型付きエラー |
| クリップボード | `arboard 3` | コピー/ペースト |
| GPU転送 | `bytemuck 1` | Pod/Zeroable derive |
| 正規表現 | `regex 1` | URL検出、出力パーサー |
| Unicode幅 | `unicode-width 0.2` | CJK全角判定 |
| UUID | `uuid 1` | ターミナルインスタンスID |
| ログ | `log 0.4` + `env_logger` | デバッグログ |
| YAML | `serde_yaml 0.9` | Workflow定義 |

### 2.2 不使用 (明示的に排除)

| 技術 | 理由 |
|------|------|
| Tauri | WebView2依存。パフォーマンスボトルネック |
| React / Vue / Svelte | JavaScript不要 |
| xterm.js | 自前VTEパーサー+GPU描画で代替済み |
| HTML / CSS | 全UIをwgpuで直接描画 |
| Electron | 論外 |
| egui | wgpu 25と非互換 (egui 0.28はwgpu 0.20依存) |
| npm / pnpm / node | 一切不要 |

---

## 3. GPUレンダリングアーキテクチャ

### 3.1 レンダリングパイプライン

```
EventLoop (winit 60fps)
  │
  ├─ 入力処理 (キーボード/マウス/IME)
  ├─ 状態更新 (Grid, Editor, UI)
  │
  ▼
Build Phase (CPU)
  ├─ ChromeState.build()     → RectInstance[] + GlyphInstance[]
  ├─ SidebarState.build()    → RectInstance[] + GlyphInstance[]
  ├─ AgentPanel.build()      → RectInstance[] + GlyphInstance[]
  ├─ PaneTree.build()        → RectInstance[] + GlyphInstance[]  (再帰)
  ├─ EditorState.build()     → RectInstance[] + GlyphInstance[]
  ├─ ContextMenu.build()     → RectInstance[] + GlyphInstance[]
  ├─ PaletteState.build()    → RectInstance[] + GlyphInstance[]
  ├─ ToastManager.build()    → RectInstance[] + GlyphInstance[]
  │
  ▼
Merge & Upload (CPU→GPU)
  ├─ 全 RectInstance を1バッファに結合
  ├─ 全 GlyphInstance を1バッファに結合
  ├─ queue.write_buffer()
  │
  ▼
Render Phase (GPU — 2 draw calls)
  ├─ Pass 1: RoundedRect Pipeline (背景、パネル、ボタン、カーソル、選択)
  ├─ Pass 2: Glyph Pipeline (テキスト全て)
  ├─ Pass 3: PostProcess Pipeline (ブラー、グロウ) ← V2新規
  │
  ▼
Present (VSync)
```

### 3.2 シェーダー構成

#### 3.2.1 既存シェーダー (V1)

| ファイル | 用途 |
|---------|------|
| `glyph.wgsl` | テキスト描画。アトラスからグリフをサンプリング、前景色で着色 |
| `rect.wgsl` | 矩形描画。背景、カーソル、選択、セパレーター |

#### 3.2.2 V2 新規シェーダー

**`rounded_rect.wgsl` — 角丸矩形 (全UI部品の基盤)**

```
入力 (per-instance):
  pos: vec2<f32>          // 左上座標 (px)
  size: vec2<f32>         // 幅高さ (px)
  color: vec4<f32>        // 塗りつぶし色 (premultiplied RGBA)
  corner_radius: f32      // 角丸半径 (px)
  border_width: f32       // 枠線幅 (px, 0=なし)
  border_color: vec4<f32> // 枠線色
  shadow_offset: vec2<f32>// 影オフセット (px)
  shadow_blur: f32        // 影ぼかし半径 (px)
  shadow_color: vec4<f32> // 影色

描画手法:
  SDF (Signed Distance Field) で角丸矩形を計算。
  距離値からアンチエイリアスされたエッジを生成。
  影は距離値 + ガウシアン近似で生成。
```

適用箇所:
- タブバーのタブ (角丸8px)
- コマンドパレットの背景 (角丸12px + 影)
- コンテキストメニュー (角丸8px + 影)
- Toast通知 (角丸8px + 左ボーダー)
- Watchdogダイアログ (角丸12px + 影)
- エージェントカード (角丸8px)
- Toolkitボタン (角丸6px)

**`blur.wgsl` — ガウシアンブラー (コンピュートシェーダー)**

```
用途:
  コマンドパレット背景のすりガラス効果。
  Scapeの「Create Watchdog」ダイアログ風のガラス背景。

手法:
  2パスガウシアンブラー (水平→垂直)。
  中間テクスチャに書き込み、最終パスで合成。

パフォーマンス:
  パレット表示時のみ実行 (常時ではない)。
  ダウンサンプリング (1/4解像度) → ブラー → アップサンプリングで負荷軽減。
```

**`line.wgsl` — ライン描画 (折れ線グラフ用)**

```
用途:
  Analytics画面のコスト推移グラフ、トークン使用量グラフ。

手法:
  Line strip をインスタンス描画。
  各セグメントを2三角形の矩形として描画 (line_width対応)。
  アンチエイリアスはSDF距離で処理。
```

### 3.3 インスタンスデータ構造

```rust
// V1 既存 — 変更なし
#[repr(C)]
struct GlyphInstance {
    pos: [f32; 2],       // 位置 (px)
    uv_rect: [f32; 4],   // アトラスUV座標
    fg_color: [f32; 4],  // 前景色
    bg_color: [f32; 4],  // 背景色 (未使用、将来用)
    size: [f32; 2],      // グリフサイズ (px)
}

// V1 既存 — 変更なし (レガシー用途: セル背景、カーソル)
#[repr(C)]
struct RectInstance {
    pos: [f32; 2],
    size: [f32; 2],
    color: [f32; 4],
}

// V2 新規 — UI Chrome用
#[repr(C)]
struct RoundedRectInstance {
    pos: [f32; 2],
    size: [f32; 2],
    color: [f32; 4],
    corner_radius: f32,
    border_width: f32,
    border_color: [f32; 4],
    shadow_offset: [f32; 2],
    shadow_blur: f32,
    shadow_color: [f32; 4],
}
// 合計: 72 bytes per instance

// V2 新規 — グラフ描画用
#[repr(C)]
struct LineInstance {
    start: [f32; 2],
    end: [f32; 2],
    color: [f32; 4],
    width: f32,
    _pad: f32,
}
```

### 3.4 レンダリング順序 (Z-order)

```
Z=0  Clear color (Mica透過: alpha 0.75)
Z=1  ターミナル/エディタ背景 (RectInstance)
Z=2  ターミナル/エディタ テキスト (GlyphInstance)
Z=3  UI Chrome 背景 (RoundedRectInstance): タイトルバー、タブバー、ステータスバー
Z=4  UI Chrome テキスト (GlyphInstance): タブ名、ステータス
Z=5  サイドバー背景 (RoundedRectInstance)
Z=6  サイドバー テキスト (GlyphInstance)
Z=7  ブラー対象領域 (blur.wgsl) ← オーバーレイ表示時のみ
Z=8  パレット/ダイアログ背景 (RoundedRectInstance)
Z=9  パレット/ダイアログ テキスト (GlyphInstance)
Z=10 Toast通知 (RoundedRectInstance + GlyphInstance)
```

### 3.5 テクスチャアトラス

```
仕様:
  サイズ: 2048x2048 R8Unorm
  フォーマット: グレースケール (アルファマスク)
  パッキング: 行優先 shelf packing
  フォールバック: CascadiaCode → NotoSansJP → tofu (□)
  キャッシュ: HashMap<(char, CellFlags), AtlasEntry>
  オーバーフロー: アトラス満杯時に使用頻度低のグリフをevict

現状:
  CascadiaCode + NotoSansJP のデュアルフォント対応済み。
  CJK全角文字 (width=2) 対応済み。
```

---

## 4. UIシステム設計

### 4.1 UIフレームワーク概要

自前の即時モード(immediate mode)風UIシステム。
毎フレーム `build()` メソッドで `RectInstance[]` + `GlyphInstance[]` を生成し、
GPUに転送して描画。Reactの仮想DOMに相当する差分計算は不要
(GPUインスタンス描画は毎フレーム全書き換えでも十分高速)。

```
UIコンポーネント階層:

NativeTerminal (winit EventLoop)
├── ChromeState            // タイトルバー + タブバー + ステータスバー
├── SidebarState           // ファイルツリー + エージェントパネル + Toolkitパネル
├── ContentPane            // ターミナル or エディタ (排他)
│   ├── PaneTree           // ターミナル: 再帰的ペイン分割
│   │   └── PaneNode       // Leaf(Grid+PTY) or Split(H/V)
│   └── EditorState        // エディタ: ropey + tree-sitter
├── PaletteState           // コマンドパレット (オーバーレイ)
├── ContextMenuState       // 右クリックメニュー (オーバーレイ)
├── DialogState            // モーダルダイアログ (オーバーレイ) ← V2新規
├── ToastManager           // 通知 (オーバーレイ)
├── ActivityFeed           // アクティビティフィード ← V2新規
└── AnalyticsState         // 分析グラフ ← V2新規
```

### 4.2 アニメーションエンジン

```rust
/// 補間可能な値。毎フレーム tick() で更新。
struct AnimatedValue {
    current: f32,
    target: f32,
    velocity: f32,      // Spring用
    easing: Easing,
}

enum Easing {
    /// Spring (Warp風の物理ベース)
    /// stiffness=300, damping=30 がデフォルト
    Spring { stiffness: f32, damping: f32 },
    /// 単純な線形補間
    Linear { duration_frames: u32, elapsed: u32 },
    /// Cubic ease-out (CSS ease-out相当)
    EaseOutCubic { duration_frames: u32, elapsed: u32 },
}

impl AnimatedValue {
    fn tick(&mut self) {
        match self.easing {
            Easing::Spring { stiffness, damping } => {
                // Spring physics: F = -kx - cv
                let displacement = self.current - self.target;
                let spring_force = -stiffness * displacement;
                let damping_force = -damping * self.velocity;
                self.velocity += (spring_force + damping_force) / 60.0; // dt = 1/60
                self.current += self.velocity / 60.0;
                // Snap when close enough
                if displacement.abs() < 0.5 && self.velocity.abs() < 0.5 {
                    self.current = self.target;
                    self.velocity = 0.0;
                }
            }
            // ...
        }
    }

    fn is_animating(&self) -> bool {
        (self.current - self.target).abs() > 0.01
    }
}
```

**適用箇所:**

| UI要素 | アニメーション | Easing | Duration |
|--------|-------------|--------|----------|
| サイドバー開閉 | width: 0 ↔ 260 | Spring(300, 30) | ~300ms |
| パレット表示 | opacity: 0→1, scaleY: 0.95→1.0 | EaseOutCubic | 150ms |
| パレット非表示 | opacity: 1→0 | EaseOutCubic | 100ms |
| タブ切替 | なし (即時) | — | — |
| Toast表示 | translateY: 20→0, opacity: 0→1 | Spring(400, 35) | ~200ms |
| Toast消去 | opacity: 1→0 | Linear | 500ms (30f) |
| ダイアログ表示 | opacity: 0→1, scale: 0.97→1.0 | Spring(350, 30) | ~250ms |
| ペイン分割 | ratio: 1.0→0.5 | Spring(300, 30) | ~300ms |
| コンテキストメニュー | opacity: 0→1 | EaseOutCubic | 100ms |

### 4.3 ヒットテスト

```rust
/// 全UIコンポーネントのクリック判定。
/// build()フェーズで HitRegion を収集し、クリック時に逆順走査。
struct HitRegion {
    x: f32, y: f32, w: f32, h: f32,
    action: Action,
    z_order: u8,  // V2: Z-orderでソート
}

/// V2: 角丸領域のヒットテスト
fn hit_test_rounded(region: &HitRegion, px: f32, py: f32, radius: f32) -> bool {
    // 角丸の内部判定: 四隅のSDF距離チェック
    // ...
}
```

### 4.4 レイアウトシステム

手動ピクセル配置。Flexbox/CSS Grid は使わない。
各コンポーネントの `build()` に親領域 (x, y, w, h) を渡し、
子は自分のサイズを計算して描画インスタンスを生成。

```
レイアウト定数 (V2 更新):

TITLE_BAR_HEIGHT    = 32px
TAB_BAR_HEIGHT      = 34px
STATUS_BAR_HEIGHT   = 24px
SIDEBAR_WIDTH       = 260px  (ファイルツリー + エージェント + Toolkit)
SIDEBAR_MIN_WIDTH   = 200px
SIDEBAR_MAX_WIDTH   = 400px
PALETTE_WIDTH       = 500px
DIALOG_WIDTH        = 420px
DIALOG_MAX_HEIGHT   = 500px
TAB_CORNER_RADIUS   = 6px
PANEL_CORNER_RADIUS = 8px
DIALOG_CORNER_RADIUS= 12px
SHADOW_BLUR_RADIUS  = 16px
```

---

## 5. 機能要件

### 5.1 ターミナルコア (V1完成済み)

| 機能 | 状態 | 詳細 |
|------|------|------|
| VTEパーサー | 完成 | CSI A-T, SGR 0-107, DECSET/DECRST, OSC 0/2/8 |
| Grid状態機械 | 完成 | セル、カーソル、スクロールバック(10,000行)、代替画面 |
| CJK全角文字 | 完成 | unicode-width による width=2 判定 |
| 256色 + TrueColor | 完成 | SGR 38;5;n / 38;2;r;g;b |
| 選択 + コピー | 完成 | マウスドラッグ選択、Ctrl+Shift+C |
| ペースト | 完成 | Ctrl+V、Bracketed Paste Mode対応 |
| スクロールバック | 完成 | マウスホイール、viewport_offset |
| ターミナル内検索 | 完成 | Ctrl+Shift+F、マッチハイライト |
| ハイパーリンク | 完成 | OSC 8 + Ctrl+Click で開く |
| マウスレポート | 完成 | SGR 1006 + レガシー X10 |
| IME入力 | 完成 | winit Preedit/Commit イベント |
| タブ管理 | 完成 | 新規/閉じる/切替 |
| ペイン分割 | 完成 | H/V分割、PaneTree再帰描画 |

### 5.2 エディタ (V1完成済み)

| 機能 | 状態 | 詳細 |
|------|------|------|
| ファイル表示 | 完成 | ropey Rope、行番号、スクロール |
| テキスト編集 | 完成 | 挿入/削除/改行/タブ |
| Undo/Redo | 完成 | EditOp スタック |
| シンタックスハイライト | 完成 | tree-sitter (Rust/JS/Python/JSON/TOML) |
| Find/Replace | 完成 | Ctrl+F / Ctrl+H、マッチハイライト |
| LSP診断表示 | 完成 | Error/Warning/Info/Hint 波線 |
| Git差分マーカー | 完成 | ガターに Added/Modified/Deleted 表示 |
| バイナリ検出 | 完成 | 先頭8KBにNULバイトがあれば拒否 |

### 5.3 ブロック型出力 (V2新規 — Warp由来)

**概要:** コマンド入力と出力をグループ化し、折りたたみ可能なブロックとして表示。

```
┌─ $ cargo build ─────────────────── [折りたたみ ▾] ─ 2.3s ─┐
│   Compiling aether-terminal v0.1.0                          │
│   Compiling wgpu v25.0.0                                    │
│   ...                                                       │
│   Finished release target(s) in 2.3 secs                    │
└─────────────────────────────────────────────────── ✓ exit 0 ┘

┌─ $ cargo test ──────────────────── [折りたたみ ▾] ─ 1.1s ─┐
│   running 28 tests                                          │
│   test grid::test_put_char_ascii ... ok                     │
│   ...                                                       │
│   test result: ok. 28 passed; 0 failed                      │
└─────────────────────────────────── ✓ exit 0 ─────── 28/28 ┘
```

**実装方式:**

```rust
/// コマンドブロック: プロンプト検出→出力収集→ブロック境界決定
struct CommandBlock {
    command: String,           // ユーザーが入力したコマンド
    start_row: usize,         // Grid上の開始行
    end_row: usize,           // Grid上の終了行 (次のプロンプトの直前)
    exit_code: Option<i32>,   // 終了コード (検出可能な場合)
    duration: Option<Duration>,// 実行時間
    collapsed: bool,          // 折りたたみ状態
}

/// プロンプト検出: シェルのプロンプト文字列をパターンマッチ
/// PowerShell: "PS C:\...>"
/// Bash: "user@host:~$"
/// カスタム: 環境変数 AETHER_PROMPT_MARKER による明示マーク
struct PromptDetector {
    patterns: Vec<Regex>,
    last_prompt_row: usize,
}
```

**プロンプト検出戦略:**
1. 既知パターンマッチ (PS >, $, %, #)
2. OSC 133 (Shell Integration Protocol) — `\x1b]133;A\x07` 等
3. 環境変数 `AETHER_PROMPT_MARKER` による明示マーク
4. コマンド入力時の `command_buffer` 内容とGrid行の照合

**ブロック描画:**
- ブロック境界は `RoundedRectInstance` で角丸枠を描画
- 折りたたみ時はヘッダー行 (コマンド + exit code + duration) のみ表示
- 展開ボタン (▸/▾) をクリックでトグル

### 5.4 Watchdog (V2新規 — Scape由来)

**概要:** エージェントセッションを自律的に監視し、権限確認に自動応答する。

```rust
/// Watchdog定義
struct Watchdog {
    id: String,
    name: String,                  // 例: "Oreo"
    instructions: String,          // 自然言語の指示
    target_session: String,        // 監視対象のPTY ID
    auto_approve_patterns: Vec<Regex>, // 自動承認パターン
    auto_deny_patterns: Vec<Regex>,    // 自動拒否パターン
    status: WatchdogStatus,
    created_at: chrono::NaiveDateTime, // ← rusqlite経由で保存
}

enum WatchdogStatus {
    Active,      // 監視中
    Paused,      // 一時停止
    Completed,   // 対象セッション終了
}

/// 判定ロジック
enum WatchdogAction {
    AutoApprove,          // 自動承認 (yを送信)
    AutoDeny,             // 自動拒否 (nを送信)
    AskUser,              // ユーザーに通知して判断を仰ぐ
    RunCustomInstruction,  // 指示に基づく応答
}
```

**UI:**
- パレットに「Create Watchdog」コマンド追加
- ダイアログ: 名前入力 + 指示入力 (テキストエリア) + 対象セッション選択
- サイドバーに「WATCHDOGS」セクション追加 (ステータスドット + 名前)
- Watchdogの判定ログは Toast + Activity Feed に表示

**Watchdog設定ファイル:**
```toml
# .aether/watchdogs.toml
[[watchdog]]
name = "Builder"
instructions = "cargo buildとcargo testの権限要求は常に許可"
auto_approve = ["allow .* to execute cargo", "allow .* to read"]
auto_deny = ["allow .* to execute rm", "allow .* to delete"]
```

### 5.5 Toolkit (V2新規 — Scape由来)

**概要:** よく使うコマンドをワンクリックで実行できるツール一覧。

```rust
/// ツール定義
struct Tool {
    id: String,
    name: String,        // 例: "Deploy"
    command: String,     // 例: "cargo build --release && scp ..."
    icon: char,          // Unicode アイコン文字
    shortcut: Option<String>, // キーバインド
    run_in_background: bool,  // バックグラウンド実行
}
```

**定義ファイル:**
```toml
# .aether/toolkit.toml
[[tool]]
name = "Build & Test"
command = "cargo build && cargo test"
icon = "🔨"
shortcut = "F5"

[[tool]]
name = "Create PR"
command = "gh pr create --fill"
icon = "📬"

[[tool]]
name = "Deploy"
command = "cargo build --release"
icon = "🚀"
run_in_background = true
```

**UI:**
- サイドバー下部に「TOOLKIT」セクション (Scapeと同じ位置)
- 各ツールは `RoundedRectInstance` ボタンとして描画
- クリックで新PTYタブを開いてコマンド実行 (or バックグラウンド)
- 実行結果はToastで通知

### 5.6 Activity Feed (V2新規 — Scape由来)

**概要:** 全セッションの操作履歴をタイムライン表示。

```rust
/// アクティビティエントリ
struct ActivityEntry {
    timestamp: i64,        // Unix timestamp
    session_id: String,    // PTY ID
    event_type: ActivityType,
    summary: String,       // 表示テキスト
}

enum ActivityType {
    SessionStarted,
    SessionEnded,
    AgentThinking,
    AgentCoding,
    AgentDone,
    WatchdogTriggered,
    ToolExecuted,
    CommitCreated,
    ErrorOccurred,
}
```

**永続化:** `rusqlite` の `activity` テーブル

```sql
CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL
);
```

**UI:**
- サイドバーの「Activity」タブ (Sessions | Activity 切替、Scapeと同じ)
- 時系列リスト、最新が上
- アイコン + タイムスタンプ + サマリー
- クリックで該当セッションにジャンプ

### 5.7 Analytics (V2新規 — Scape由来)

**概要:** エージェント使用量のコスト・トークン分析。

```rust
/// 分析データポイント
struct UsagePoint {
    timestamp: i64,
    session_id: String,
    cli: String,        // claude/codex/gemini
    model: String,
    cost: f64,          // USD
    tokens: u64,
    duration_secs: u64,
}
```

**永続化:** `rusqlite` の `usage` テーブル

**UI:**
- パレットから「View Analytics」で表示
- ContentPaneを Analytics モードに切替
- wgpuで折れ線グラフを直描画:
  - X軸: 時間 (日/週/月)
  - Y軸: コスト ($) / トークン数
  - 複数系列: CLI別に色分け
- サマリー: 今日/今週/今月の合計コスト、合計トークン、セッション数

**グラフ描画:**
```rust
/// 折れ線グラフを LineInstance[] + GlyphInstance[] に変換
fn build_line_chart(
    data: &[UsagePoint],
    area: Rect,          // 描画領域
    font: &FontManager,
    atlas: &mut GlyphAtlas,
) -> (Vec<LineInstance>, Vec<RoundedRectInstance>, Vec<GlyphInstance>) {
    // 1. データを正規化 (min-max → area座標)
    // 2. LineInstance を生成 (折れ線)
    // 3. RoundedRectInstance でデータポイントのドット
    // 4. GlyphInstance で軸ラベル
}
```

### 5.8 ダイアログシステム (V2新規)

**概要:** Scapeの「Create Watchdog」風のモーダルダイアログ。

```rust
/// モーダルダイアログ
struct DialogState {
    visible: bool,
    title: String,
    fields: Vec<DialogField>,
    focused_field: usize,
    on_confirm: DialogAction,
}

enum DialogField {
    TextInput { label: String, value: String, placeholder: String },
    TextArea { label: String, value: String, placeholder: String, lines: usize },
    Select { label: String, options: Vec<String>, selected: usize },
}

enum DialogAction {
    CreateWatchdog,
    CreateTool,
    ConfirmDelete,
    Custom(Box<dyn FnOnce(Vec<String>)>),
}
```

**描画:**
- 背景: ブラー + 半透明オーバーレイ (blur.wgsl)
- ダイアログ本体: `RoundedRectInstance` (corner_radius=12, shadow_blur=16)
- 入力フィールド: `RoundedRectInstance` (corner_radius=6, border=1px)
- ボタン: 「Cancel」(テキスト) + 「Create」(アクセントカラー背景)
- キー操作: Tab=フィールド移動、Enter=確定、Escape=キャンセル

### 5.9 OS通知 (V2新規)

```rust
/// Win32 Toast通知 (windows クレート)
fn send_os_notification(title: &str, body: &str) {
    // Windows ToastNotification API
    // または簡易: MessageBoxW
}
```

**トリガー:**
- エージェントが `Done` 状態になった時
- Watchdog が自動応答した時
- ビルドエラーが発生した時
- バックグラウンドツール完了時

### 5.10 SCM統合 (V1実装済み + V2拡張)

| 機能 | V1状態 | V2追加 |
|------|--------|--------|
| git status 表示 | 完成 | — |
| Stage All | 完成 | — |
| Commit (パレット経由) | 完成 | — |
| Push | 完成 | — |
| PR一覧 (gh cli) | 完成 | — |
| **Diff表示** | なし | **インラインdiff (エディタ内)** |
| **Stage/Unstage個別** | 部分的 | **SCMパネルからファイル単位操作** |
| **Commit amend** | なし | **追加** |

### 5.11 設定システム (V1実装済み + V2拡張)

```toml
# ~/.aether/config.toml — V2 追加項目

[appearance]
theme = "catppuccin-mocha"
font_size = 14
line_height = 1.4
opacity = 0.85
corner_radius = 8        # V2: UI角丸半径
animations = true         # V2: アニメーション有効/無効
blur_enabled = true       # V2: ブラー有効/無効

[terminal]
default_shell = "pwsh.exe"
scrollback = 10000
cursor_style = "bar"
block_mode = true         # V2: ブロック型出力
prompt_patterns = []      # V2: カスタムプロンプトパターン

[agent]
watchdog_enabled = false
default_cli = "claude"

[toolkit]
file = ".aether/toolkit.toml"   # V2: Toolkit定義ファイルパス

[analytics]
enabled = true            # V2: 使用量記録
retention_days = 90       # V2: データ保持期間
```

---

## 6. データモデル

### 6.1 SQLite スキーマ (V2 追加テーブル)

```sql
-- V1 既存
CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pty_id TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pty_id TEXT NOT NULL,
    shell TEXT NOT NULL,
    cwd TEXT,
    started_at DATETIME,
    ended_at DATETIME
);

-- V2 新規
CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL
);
CREATE INDEX idx_activity_ts ON activity(timestamp DESC);

CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    cli TEXT NOT NULL,
    model TEXT NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    duration_secs INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_usage_ts ON usage(timestamp DESC);

CREATE TABLE watchdogs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    target_session TEXT,
    auto_approve TEXT,   -- JSON array
    auto_deny TEXT,      -- JSON array
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. パフォーマンス目標

| 指標 | V1現状 | V2目標 | Warp参考値 |
|------|--------|--------|-----------|
| フレームレート | ~60fps | **144fps** | >144fps |
| フレーム描画時間 | ~16ms | **<7ms** | 1.9ms |
| 起動時間 | ~200ms | **<300ms** | ~500ms |
| メモリ使用量 | ~40MB | **<80MB** | ~150MB |
| バイナリサイズ | ~14MB | **<20MB** | ~100MB |
| 入力遅延 | ~3ms | **<5ms** | N/A |
| ペイン分割描画 | 4ペインOK | **8ペインOK** | N/A |
| グリフアトラス | 2048x2048 | 2048x2048 | N/A |

---

## 8. ファイル構成 (V2)

```
src-tauri/src/
├── bin/
│   └── native_terminal.rs      // メインバイナリ (winit EventLoop)
├── gpu/
│   ├── mod.rs                  // GpuTerminalManager
│   ├── atlas.rs                // グリフアトラス
│   ├── font.rs                 // FontManager
│   ├── grid.rs                 // VTE Grid状態機械
│   ├── renderer.rs             // TerminalRenderer
│   ├── surface.rs              // wgpu Surface管理
│   ├── cursor.rs               // カーソルブリンク
│   ├── ime.rs                  // IME状態
│   ├── input.rs                // キー入力処理
│   ├── link.rs                 // URL検出
│   ├── search.rs               // ターミナル内検索
│   ├── selection.rs            // テキスト選択
│   ├── commands.rs             // GPU IPC (レガシー)
│   └── shaders/
│       ├── glyph.wgsl          // テキスト描画
│       ├── rect.wgsl           // 矩形描画 (レガシー: セル背景)
│       ├── rounded_rect.wgsl   // V2: 角丸矩形 (UI Chrome全般)
│       ├── blur.wgsl           // V2: ガウシアンブラー
│       └── line.wgsl           // V2: 折れ線グラフ
├── ui/
│   ├── mod.rs                  // ChromeState (タイトル/タブ/ステータス)
│   ├── sidebar.rs              // SidebarState (ファイルツリー)
│   ├── editor.rs               // EditorState (ropey + tree-sitter)
│   ├── palette.rs              // PaletteState (コマンドパレット)
│   ├── syntax.rs               // SyntaxState (tree-sitter統合)
│   ├── scm.rs                  // ScmState (Git操作パネル)
│   ├── toast.rs                // ToastManager (通知)
│   ├── dialog.rs               // V2: DialogState (モーダル)
│   ├── toolkit.rs              // V2: ToolkitState (ワンクリックツール)
│   ├── activity.rs             // V2: ActivityFeed (タイムライン)
│   ├── analytics.rs            // V2: AnalyticsState (グラフ)
│   ├── block.rs                // V2: CommandBlock (ブロック型出力)
│   └── animation.rs            // V2: AnimatedValue (補間エンジン)
├── agent/
│   ├── mod.rs
│   ├── claude.rs               // Claude Code連携
│   ├── interactive.rs          // AgentCli定義
│   ├── output_monitor.rs       // 出力パーサー
│   ├── parser.rs               // CLI出力解析
│   ├── router.rs               // エージェントルーティング
│   └── watchdog.rs             // V2: Watchdogエンジン
├── pty/                        // PTY管理 (変更なし)
├── git/                        // Git操作 (変更なし)
├── config/                     // 設定管理 (変更なし)
├── db/                         // SQLite (V2テーブル追加)
├── lsp/                        // LSPクライアント (変更なし)
├── session/                    // セッション管理 (変更なし)
├── watcher.rs                  // ファイル監視 (変更なし)
└── workflow/                   // Workflow実行 (変更なし)
```

---

## 9. 実装フェーズ

### Phase A: レンダリング品質 (角丸 + アニメーション)

**ゴール:** UIの見た目を「プロトタイプ」→「プロダクト」に引き上げる

| タスク | 詳細 | 工数 |
|--------|------|------|
| A-1 | `rounded_rect.wgsl` SDF角丸シェーダー実装 | 2日 |
| A-2 | `RoundedRectInstance` 構造体 + パイプライン追加 | 1日 |
| A-3 | 全UI部品を RoundedRect に移行 (タブ、パレット、メニュー、Toast) | 2日 |
| A-4 | `animation.rs` AnimatedValue + Spring/EaseOut実装 | 1日 |
| A-5 | サイドバー開閉アニメーション | 0.5日 |
| A-6 | パレット表示/非表示アニメーション | 0.5日 |
| A-7 | Toast スライドイン/フェードアウト | 0.5日 |
| A-8 | 影 (drop shadow) をシェーダーに追加 | 1日 |

**合計: 8-9日**
**完了条件:** タブ、パレット、Toast、メニューが全て角丸+影付き。サイドバーが滑らかに開閉。

### Phase B: ブロック型出力 (Warp差別化機能)

| タスク | 詳細 | 工数 |
|--------|------|------|
| B-1 | `PromptDetector` プロンプトパターンマッチ | 2日 |
| B-2 | `CommandBlock` 構造体 + ブロック境界管理 | 2日 |
| B-3 | OSC 133 (Shell Integration) パーサー追加 | 1日 |
| B-4 | ブロック描画 (角丸枠 + ヘッダー + 折りたたみ) | 3日 |
| B-5 | 折りたたみ/展開操作 + スクロール統合 | 2日 |
| B-6 | exit code / duration 表示 | 1日 |
| B-7 | テスト (PowerShell/Bash/CMD各シェル) | 2日 |

**合計: 13-15日**
**完了条件:** PowerShellでコマンド実行→ブロック化→折りたたみ/展開が動作。

### Phase C: Watchdog + Toolkit + Dialog (Scape機能)

| タスク | 詳細 | 工数 |
|--------|------|------|
| C-1 | `dialog.rs` モーダルダイアログ描画 | 2日 |
| C-2 | `blur.wgsl` ガウシアンブラー (ダイアログ背景) | 2日 |
| C-3 | `watchdog.rs` Watchdogエンジン (パターンマッチ+自動応答) | 3日 |
| C-4 | Watchdog UI (ダイアログ作成 + サイドバー表示) | 2日 |
| C-5 | `toolkit.rs` TOML読み込み + ボタン描画 | 2日 |
| C-6 | Toolkit実行 (PTY起動 or バックグラウンド) | 1日 |
| C-7 | OS通知 (Win32 Toast) | 1日 |

**合計: 13-14日**
**完了条件:** Watchdog作成→自動応答→ログ表示。Toolkit定義→ワンクリック実行。

### Phase D: Activity Feed + Analytics

| タスク | 詳細 | 工数 |
|--------|------|------|
| D-1 | `activity.rs` + SQLiteテーブル + イベント記録 | 2日 |
| D-2 | Activity Feed UI (タイムラインリスト) | 2日 |
| D-3 | `usage` テーブル + エージェント使用量記録 | 1日 |
| D-4 | `line.wgsl` ライン描画シェーダー | 1日 |
| D-5 | `analytics.rs` 折れ線グラフ描画 | 3日 |
| D-6 | サマリー表示 (今日/今週/今月の集計) | 1日 |

**合計: 10-11日**
**完了条件:** Activity Feedにイベントが流れる。Analyticsでコスト推移グラフが表示される。

### Phase E: 磨き上げ

| タスク | 詳細 | 工数 |
|--------|------|------|
| E-1 | インラインDiff (エディタ拡張) | 3日 |
| E-2 | Reveal Highlight (マウスホバー光源) | 1日 |
| E-3 | ペインリサイズアニメーション | 1日 |
| E-4 | キーバインドカスタマイズ (keybindings.toml) | 2日 |
| E-5 | テーマ切替の実装 (7テーマの色定義) | 2日 |
| E-6 | パフォーマンス最適化 (144fps安定化) | 2日 |
| E-7 | テスト追加 (Watchdog/Toolkit/Activity) | 2日 |

**合計: 13-14日**

---

## 10. 全体スケジュール

```
Phase A (描画品質):      ■■■■■■■■■ 9日
Phase B (ブロック出力):   ■■■■■■■■■■■■■■■ 15日
Phase C (Watchdog等):    ■■■■■■■■■■■■■■ 14日
Phase D (Activity等):    ■■■■■■■■■■■ 11日
Phase E (磨き上げ):      ■■■■■■■■■■■■■■ 14日
                        ─────────────────
                        合計: 63日 (~9週間)
```

**依存関係:**
- Phase A → Phase B, C, D (角丸シェーダーが全UIの基盤)
- Phase A → Phase C (ブラーシェーダーがダイアログの前提)
- Phase B, C, D は互いに独立 (並列実行可能)
- Phase E は全Phase完了後

**クリティカルパス:** A → B → E = 38日 (~5.5週間)

---

## 11. 競合分析 (V2更新)

| | Warp | Scape | Alacritty | WezTerm | **Aether V2** |
|---|---|---|---|---|---|
| 言語 | Rust | Swift推定 | Rust | Rust | **Rust** |
| GPU描画 | Metal/wgpu | なし | OpenGL | OpenGL/wgpu | **wgpu (DX12)** |
| ターミナル自前 | Yes | No (iTerm2) | Yes | Yes | **Yes** |
| ブロック出力 | Yes | No | No | No | **Yes** |
| エディタ内蔵 | No | No | No | No | **Yes** |
| LSP統合 | No | No | No | No | **Yes** |
| SCM統合 | No | No | No | No | **Yes** |
| Watchdog | No | Yes | No | No | **Yes** |
| Toolkit | No | Yes | No | No | **Yes** |
| Activity Feed | No | Yes | No | No | **Yes** |
| Analytics | No | 部分的 | No | No | **Yes** |
| ペイン分割 | No | No | No | Yes | **Yes** |
| Windows対応 | Yes | No | Yes | Yes | **Yes** |
| macOS対応 | Yes | Yes | Yes | Yes | 将来 |
| **WebView不要** | **Yes** | 不明 | **Yes** | **Yes** | **Yes** |

**Aether V2のユニークポジション:**
Warpの描画品質とブロック出力 + Scapeのオーケストレーション +
エディタ/LSP/SCM統合 + Windows Premium。
この組み合わせを持つ競合は存在しない。

---

## 12. リスクと対策

| リスク | 影響度 | 対策 |
|--------|--------|------|
| 角丸SDFシェーダーの品質 | 中 | Warpのブログ記事を参考に実装。Iquilezles SDF参照 |
| ブラーのパフォーマンス | 中 | ダウンサンプリング (1/4) + 2パスで負荷軽減 |
| プロンプト検出の精度 | 高 | OSC 133対応を優先。パターンマッチは補助 |
| ブロック出力とalt screen の共存 | 高 | alt screen (vim等) ではブロックモード無効化 |
| Watchdogの安全性 | 高 | デフォルトOFF。auto_deny優先。ログ全記録 |
| 144fps維持 | 中 | dirty flag最適化。変更なしフレームはスキップ |
