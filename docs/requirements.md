# Aether Terminal (エーテル・ターミナル) — 詳細要件定義書

Version: 1.0.0
Date: 2026-04-09
Status: Draft

---

## 1. ビジョン

Windows環境における、**プロジェクトファーストのAIワークスペースターミナル**。
Moriの「リポジトリ/ブランチ単位のナビゲーション」とScapeの「AIエージェント並列制御」を
融合し、最高峰のUI/UXで提供する。

**ポジショニング:**
- 単なるターミナルエミュレータではない（Alacritty, Windows Terminal と競合しない）
- 単なるAI IDE でもない（Cursor, Windsurf と競合しない）
- **「AIエージェントを指揮するコマンドセンター」+「プロジェクト管理ターミナル」**

**デザイン哲学: Windows Premium**
Macの模倣ではなく、Windows 11のFluent Design Systemを極限まで研ぎ澄ます。
Macユーザーが「それWindowsにしかないの？」と羨むレベルを目指す。
美の3原則:
1. **レイヤーの透明感** — Mica/Acrylicの重ね合わせで奥行きを表現。文字はくっきり
2. **タイポグラフィの完璧さ** — UIとターミナルでフォントを分離し、それぞれ最適化
3. **物理的アニメーション** — Spring Animationによる有機的な動き。道具としての心地よさ

---

## 2. ターゲットユーザー

- Windows をメイン機とするプロフェッショナル・エンジニア
- AIエージェント（Claude Code, Aider, Cline等）を日常的に使用する開発者
- 複数プロジェクトを同時に扱うマルチタスク型
- ツールの美しさと質感を生産性の一部として重視する層

---

## 3. 技術スタック

### 3.1 確定技術

| レイヤー | 技術 | 理由 |
|---------|------|------|
| **Framework** | Tauri v2 | 軽量、WebView2ネイティブ、Mica/Acrylic対応、Rust統合 |
| **Frontend** | Vite + React 19 + TypeScript | SPA。Next.js不要（SSR/ルーティング不要） |
| **Backend** | Rust (Tauri core) | PTY制御、git操作、ファイル監視に最適 |
| **Terminal描画** | xterm.js + `@xterm/addon-webgl` | WebGL2。Canvas比 **596-901%高速**。VS Codeと同じ方式 |
| **PTY** | `portable-pty` (wezterm由来) | ConPTY対応。PowerShell/CMD/WSL2/Git Bash全対応 |
| **Git操作** | `git2-rs` (libgit2バインディング) | Worktree CRUD、ブランチ操作、diff取得 |
| **非同期** | `tokio` | PTY I/O、ファイル監視、IPC全て非同期 |
| **Styling** | Tailwind CSS 4 | ユーティリティファースト |
| **アニメーション** | Motion (旧 Framer Motion) v12+ | GPU-accelerated。`layout` propでFLIPアニメーション |
| **アイコン** | Lucide React + vscode-icons (ファイル種別) | tree-shakable、1500+アイコン |
| **フォント** | Cascadia Code (デフォルト) + Cascadia Next JP (CJK) | Microsoft製、リガチャ対応、日本語対応 |
| **状態管理** | Zustand | 軽量、Reactとの親和性高い |
| **IPC** | Tauri Event Channel (`emit`/`listen`) | invoke式IPCはWindows 10MBで200msと遅い。イベント式を使う |

### 3.2 注意事項

- **Vulkan/Direct2D直接描画は不採用。** xterm.js WebGL2で十分な性能。独自GPU描画は開発コストに見合わない
- **Next.js不採用。** Tauri WebView内はSPA。サーバーサイドレンダリング不要
- **FluentUI v9は限定使用。** ツールバー・設定画面等のchrome部分のみ。ターミナル本体はカスタムUI
- **Windows IPC:** ConPTYの `PSEUDOCONSOLE_RESIZE_QUIRK` (0x2), `PSEUDOCONSOLE_WIN32_INPUT_MODE` (0x4), `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8, Win11 22H2+) フラグが重要。`portable-pty-psmux` クレートの採用を検討

---

## 4. UI/UX 要件

### 4.1 デザイン言語

**Windows Native Premium:**
- Windows 11 **Mica** マテリアルを全面採用（背景がデスクトップと透過）
- Tauri v2 設定:
  ```json
  {
    "app": {
      "windows": [{
        "decorations": false,
        "transparent": true,
        "windowEffects": { "effects": ["mica"] }
      }]
    }
  }
  ```
- HTML/CSS `body { background: transparent; }` 必須
- Win10フォールバック: Acrylic（ただしリサイズ性能劣化あり）

**マテリアルの使い分け（Mica vs Acrylic）:**
- **Mica** → ウィンドウ全体の背景。壁紙の色を抽出し「落ち着いた透明感」。パフォーマンス負荷極小
- **Acrylic** → サイドバー、メニュー、コマンドパレット等の一時的要素。すりガラス質感で「奥行き（Z-depth）」を表現
- 両者の重ね合わせでレイヤー構造を視覚的に伝える

**色彩システム:**
- テーマエンジン: **Catppuccin** (Mocha/Frappe/Macchiato/Latte) ベース
- Windows システムテーマ検知: `window.theme()` + `onThemeChanged()` (Tauri JS API)
- アクセントカラー取得: Rust側で `DwmGetColorizationColor` (`windows` crate v0.58)
- ターミナルANSI色(0-15) をテーマパレットにマッピングし、UIサーフェスと調和させる
- **ダークモード:** 純黒(#000)禁止。青み/紫みのある深いグレーをMica背景に敷き高級感を演出
- **角丸:** 8-12px統一。Win11ネイティブウィンドウと調和させる

**Fluent Design エフェクト:**
- **Reveal Highlight:** ホバー時にマウス位置から光が漏れるグロー効果。ボタン・リスト・タブに一貫適用
- CSS実装: `radial-gradient` + `pointer-events` でマウス追従する光源を生成
- 過度な演出は避ける — 「気づくか気づかないか」の閾値が正解

**タイポグラフィ（UIとターミナルで分離）:**
- **UIフォント**（サイドバー、設定、ステータスバー）: `Geist` (Vercel製) or `Inter`
  - 日本語: `Source Han Sans JP` (源ノ角ゴシック) → `BIZ UDPゴシック` → `Noto Sans JP`
- **ターミナルフォント**（コード表示）: `Cascadia Code` (Windows同梱、リガチャ対応)
  - 日本語: `Cascadia Next JP` → `Source Han Sans JP` → `monospace`
- CSS: `font-feature-settings: "calt" 1` でリガチャ有効化
- ユーザーカスタマイズ可能（フォント、サイズ、行間、リガチャON/OFF）

**アニメーション原則:**
- **物理ベース（Spring Animation）:** 「スッと動いてピタッと止まる」バネ挙動。質量を感じるわずかな揺れ
- Motion `transition={{ type: "spring", stiffness: 300, damping: 30 }}` を基本値とする
- GPU-acceleratedプロパティのみ: `opacity`, `transform` (`x`, `y`, `scale`)
- パネルリサイズ: `flex-basis` + `will-change` で60fps維持
- `width`/`height` の直接アニメーション禁止
- Motion `layout` propでスプリット/マージのFLIPアニメーション
- **過剰演出禁止:** osu!lazer的な派手さではなく、道具としての「心地よさ」を追求

### 4.2 レイアウト構成

```
┌──────────────────────────────────────────────────────────┐
│  Title Bar (カスタム、Mica透過、ドラッグ可能)              │
├────────┬─────────────────────────────┬───────────────────┤
│        │                             │                   │
│  Side  │   Multi-Terminal Canvas     │  Agent Inspector  │
│  bar   │                             │  (トグル可能)      │
│        │   ┌───────┬───────┐         │                   │
│ Projects│   │ Term1 │ Term2 │         │  ・思考プロセス    │
│ Worktrees│  │       │       │         │  ・ログストリーム  │
│ Branches│  ├───────┴───────┤         │  ・提案diff       │
│        │   │    Term3      │         │  ・トークン消費    │
│        │   │               │         │                   │
│        │   └───────────────┘         │                   │
├────────┴─────────────────────────────┴───────────────────┤
│  Status Bar (git branch, shell type, RTK savings, CPU)   │
└──────────────────────────────────────────────────────────┘
```

**各パネル詳細:**

| パネル | 機能 | サイズ |
|--------|------|--------|
| **Sidebar** | プロジェクト一覧、Worktreeツリー、ブランチ切替、検索 | 幅 240-320px、折りたたみ可 |
| **Terminal Canvas** | 複数ターミナルのタイル/スタック配置。ドラッグで分割/マージ | メイン領域。最低600px |
| **Agent Inspector** | AIエージェント監視パネル。思考ログ、diff、自動応答制御 | 幅 300-400px、オーバーレイ/固定切替 |
| **Command Palette** | `Ctrl+Shift+P` で起動。全操作をコマンド検索 | オーバーレイ、中央表示 |
| **Status Bar** | 現在のブランチ、シェル種別、RTK節約量、リソース使用率 | 高さ 24px固定 |

### 4.3 キーバインド

| 操作 | デフォルト |
|------|-----------|
| コマンドパレット | `Ctrl+Shift+P` |
| 新規ターミナル | `Ctrl+Shift+T` |
| ターミナル閉じる | `Ctrl+Shift+W` |
| 水平分割 | `Ctrl+Shift+H` |
| 垂直分割 | `Ctrl+Shift+V` |
| パネル間移動 | `Ctrl+Tab` / `Ctrl+1-9` |
| Sidebar トグル | `Ctrl+B` |
| Agent Inspector トグル | `Ctrl+Shift+I` |
| プロジェクト切替 | `Ctrl+Shift+O` |
| 設定 | `Ctrl+,` |

全キーバインドはユーザーカスタマイズ可能（JSON設定ファイル）。

---

## 5. 機能要件

### 5.1 プロジェクト & Worktree 管理

**Auto-Discovery:**
- 指定ディレクトリ（例: `H:/claude/`, `C:/Users/owner/Documents/`）を再帰スキャン
- `.git` ディレクトリの存在でGitリポジトリを自動検出
- `git2-rs` の `Repository::discover()` を使用
- スキャン結果をSQLiteにキャッシュ（初回以降は差分検出のみ）

**Worktree管理:**
- GUIからワンクリックで `git worktree add` 実行
- Worktree作成時間: ~50-200ms（checkout + HEAD ref作成のみ）
- 各Worktreeに独立したターミナルセッションを自動割当
- Worktree削除時はセッションの自動クリーンアップ
- `git2-rs` API: `repo.worktrees()`, `repo.worktree(name, path, opts)`

**Session Persistence:**
- アプリ終了時: 各ターミナルの作業ディレクトリ、コマンド履歴、レイアウト配置を保存
- アプリ起動時: 前回のセッションを完全復元
- 永続化: SQLite（`aether.db`）
- バックグラウンドプロセスは保持しない（tmuxと異なるアプローチ — シンプルさ優先）

### 5.2 ターミナル・コア

**PTY管理 (Rust側):**
```rust
// 各シェルの起動
CommandBuilder::new("pwsh.exe")           // PowerShell 7
CommandBuilder::new("powershell.exe")     // PowerShell 5.1
CommandBuilder::new("cmd.exe")            // CMD
CommandBuilder::new("wsl.exe").arg("-d").arg("Ubuntu")  // WSL2
CommandBuilder::new("C:/Program Files/Git/bin/bash.exe") // Git Bash
```

**xterm.js構成 (Frontend側):**
- `@xterm/xterm` — コア
- `@xterm/addon-webgl` — WebGL2 GPU描画（必須）
- `@xterm/addon-fit` — コンテナサイズ自動追従
- `@xterm/addon-search` — ターミナル内検索
- `@xterm/addon-unicode11` — Unicode全幅文字サポート（日本語）
- `@xterm/addon-web-links` — URL自動検出・クリック
- `@xterm/addon-serialize` — セッション保存/復元用

**データフロー:**
```
PTY (Rust) ──emit("pty-output")──> Tauri Event Channel ──> xterm.js (React)
xterm.js (React) ──emit("pty-input")──> Tauri Event Channel ──> PTY (Rust)
```
- JSON-RPCではなくバイナリイベントで転送（低レイテンシ）
- 各ターミナルインスタンスにユニークIDを付与して多重化

### 5.3 AIエージェント・オーケストレーション

**Multi-Agent Slots:**
- 異なるWorktree/ターミナルで複数のClaude Codeセッションを同時実行
- 各スロットの状態表示: `idle` / `thinking` / `coding` / `waiting` / `error`
- Agent Inspectorでリアルタイム監視

**Claude Code連携（SDK方式）:**
```bash
# ヘッドレスモード（プログラマティック制御）
claude -p "prompt" --output-format stream-json --verbose
```
- `stream-json` でトークンストリーミング受信
- `session_id` でセッション管理（`--continue`, `--resume <id>`）
- `--allowedTools` でツール制限
- `--bare` で自動検出スキップ（予測可能な動作）
- 将来的にはIPC対応待ち（[#15553](https://github.com/anthropics/claude-code/issues/15553)）

**Watchdog（自動応答）:**
- AIからの権限確認に対し、事前定義ルールで自動応答
- ルールファイル: プロジェクトルートの `CLAUDE.md` を参照（独自形式は作らない）
- 自動応答ログは Agent Inspector に表示
- デフォルトは保守的（自動承認OFF、ユーザーが明示的にONにする）

**コンテキスト管理:**
- 独自形式（`.aetherrules`）は**作らない**
- 既存の `CLAUDE.md` / `.claude/settings.json` をそのまま参照
- Claude Code エコシステムとの互換性を維持

### 5.4 Diff Viewer

- git2-rsで差分取得 → Monacoベースのインラインdiff表示
- Side-by-side / Unified 切替
- Agent Inspector内でAIが提案した変更のプレビュー
- Accept / Reject / Edit のアクション

### 5.5 設定システム

**設定ファイル構成:**
```
~/.aether/
  config.toml          # メイン設定
  keybindings.json     # キーバインド
  themes/              # カスタムテーマ
  aether.db            # セッション永続化（SQLite）
```

**config.toml 主要設定:**
```toml
[appearance]
theme = "catppuccin-mocha"      # テーマ名
font_family = "Cascadia Code"
font_size = 14
line_height = 1.4
ligatures = true
window_effect = "mica"          # mica | acrylic | none
opacity = 0.95

[terminal]
default_shell = "pwsh.exe"
scrollback = 10000
cursor_style = "bar"            # bar | block | underline
cursor_blink = true

[projects]
scan_dirs = ["H:/claude", "C:/Users/owner/Documents"]
auto_discover = true

[agent]
watchdog_enabled = false         # 安全側デフォルト
auto_approve_patterns = []
```

---

## 6. 非機能要件

### 6.1 パフォーマンス

| 指標 | 目標 |
|------|------|
| 起動時間 | < 1秒（コールドスタート） |
| ターミナル入力遅延 | < 16ms (1フレーム) |
| メモリ使用量 | < 200MB（ターミナル5タブ時） |
| バイナリサイズ | < 30MB（インストーラー） |
| GPU描画 | 60fps以上（4Kディスプレイ対応） |
| Worktree作成 | < 500ms |

### 6.2 対応プラットフォーム

| OS | 優先度 | 備考 |
|----|--------|------|
| **Windows 11** | **P0 (必須)** | Mica、ConPTY完全対応 |
| Windows 10 (1903+) | P1 | Acrylic fallback、ConPTY基本対応 |
| macOS | P2 (将来) | Tauri v2 はクロスプラットフォーム |
| Linux | P3 (将来) | 同上 |

### 6.3 セキュリティ

- Watchdog自動応答はデフォルトOFF
- シェルコマンドのサンドボックス化はしない（ターミナルの本質に反する）
- 設定ファイルに機密情報を保存しない
- アップデート機構: Tauri v2 内蔵アップデーター（署名付き）

---

## 7. ロードマップ

### Phase 1: 美麗ターミナル (MVP)
**ゴール:** 見た目が最高に良い、基本的なマルチタブターミナル

- [ ] Tauri v2 + Vite + React プロジェクト初期化
- [ ] カスタムタイトルバー（Mica透過、ドラッグ、最小化/最大化/閉じる）
- [ ] xterm.js + WebGL描画のターミナル1画面
- [ ] PowerShell / CMD / Git Bash / WSL2 切替
- [ ] タブ管理（新規、閉じる、切替）
- [ ] Catppuccin テーマ適用
- [ ] Cascadia Code + CJKフォント設定
- [ ] ステータスバー（シェル種別表示）
- [ ] 基本キーバインド
- [ ] config.toml による設定

**完了条件:** Windows Terminalより見た目が良く、基本操作に支障がない

### Phase 2: プロジェクト管理
**ゴール:** Mori的なプロジェクトファーストナビゲーション

- [ ] Sidebar: プロジェクト一覧表示
- [ ] Auto-Discovery: 指定ディレクトリのGitリポジトリ自動検出
- [ ] プロジェクト選択→そのディレクトリでターミナル開く
- [ ] ブランチ表示・切替
- [ ] Git Worktree の一覧・作成・削除（GUI）
- [ ] Worktreeごとに独立したターミナルセッション
- [ ] セッション永続化（SQLite）
- [ ] コマンドパレット（`Ctrl+Shift+P`）

**完了条件:** プロジェクト間の移動がサイドバークリック1つで完結

### Phase 3: ターミナル分割 & 高度なUI
**ゴール:** 複数ターミナルの自由配置

- [ ] 水平/垂直スプリット
- [ ] ドラッグ&ドロップでパネル再配置
- [ ] パネルリサイズ（スムーズアニメーション）
- [ ] レイアウトプリセット（2列、3列、グリッド等）
- [ ] ターミナル内検索（`Ctrl+F`）
- [ ] URL自動検出・クリック
- [ ] ダーク/ライトテーマ自動切替
- [ ] アクセントカラー同期（Windows設定と連動）

**完了条件:** 4分割ターミナルで並行作業が快適

### Phase 4: AIエージェント統合
**ゴール:** Scape的なAIオーケストレーション

- [ ] Agent Inspector パネル
- [ ] Claude Code ヘッドレスモード連携（stream-json）
- [ ] セッション管理（開始、一時停止、再開）
- [ ] 思考プロセスのリアルタイム表示
- [ ] Watchdog（自動応答）基本実装
- [ ] Diff Viewer（Monaco Editor統合）
- [ ] 複数エージェント並列実行
- [ ] トークン使用量・コスト表示

**完了条件:** Claude Codeセッション2つを並列で監視・制御できる

### Phase 5: 磨き上げ & 拡張
- [ ] キーバインドカスタマイズUI
- [ ] テーマエディタ
- [ ] プラグインシステム（将来拡張用API）
- [ ] 自動アップデート
- [ ] パフォーマンスプロファイリング・最適化
- [ ] macOS対応（P2）

---

## 8. 技術的リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| Tauri v2 IPC がWindows で遅い（10MB=200ms） | ターミナル出力の遅延 | Event Channelを使う。バイナリ転送。バッファリング |
| ConPTY のWin10互換性問題 | 一部環境でPTYが動作しない | `portable-pty-psmux`でフラグ制御。Win10は基本機能のみ保証 |
| xterm.js WebGL2 非対応環境 | GPUなしVM等で描画できない | Canvas rendererにフォールバック |
| Claude Code IPC が未実装 | インタラクティブセッション制御不可 | ヘッドレスモード(`-p`)で代替。IPC実装を待つ |
| Mica が Win10 非対応 | Win10で視覚品質低下 | Acrylic + 半透明fallback |
| libgit2 の大規模リポジトリ性能 | monorepoでWorktree一覧が遅い | キャッシュ（SQLite）+ バックグラウンドスキャン |

---

## 9. 競合分析

| ターミナル | プラットフォーム | 特徴 | Aetherとの差別化 |
|-----------|---------------|------|-----------------|
| **Windows Terminal** | Windows | MS公式。タブ、プロファイル | プロジェクト管理なし、AI統合なし |
| **Warp** | macOS, Linux | AI統合、ブロック型UI | Windows非対応 |
| **Mori** | macOS | プロジェクト/Worktree管理 | Windows非対応 |
| **Scape** | macOS | Claude Code並列制御 | Windows非対応、ターミナルとしての汎用性低 |
| **Alacritty** | クロス | 高速GPU描画 | プロジェクト管理なし、AI統合なし |
| **Rio** | クロス | WebGPU描画 | プロジェクト管理なし、AI統合なし |
| **Ghostty** | macOS, Linux | libghostty、高速 | Windows非対応 |

**Aetherのユニークポジション:** Windows + プロジェクト管理 + AI統合 の交差点。この組み合わせに競合は存在しない。

---

## 10. 参考実装・リソース

| リソース | URL | 用途 |
|---------|-----|------|
| Terminon (Tauri+xterm.js) | https://github.com/Shabari-K-S/terminon | Tauri製ターミナルの参考実装 |
| tauri-plugin-pty | https://github.com/Tnze/tauri-plugin-pty | PTY Tauriプラグイン |
| Mori | https://github.com/vaayne/mori | プロジェクト/Worktree管理アーキテクチャ |
| portable-pty | https://crates.io/crates/portable-pty | Rust PTYライブラリ |
| git2-rs | https://crates.io/crates/git2 | Rust Gitバインディング |
| Catppuccin | https://catppuccin.com/ | テーマシステム |
| xterm.js | https://xtermjs.org/ | ターミナル描画 |
| Claude Code SDK | https://code.claude.com/docs/en/headless | AI連携 |
