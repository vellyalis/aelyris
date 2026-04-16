# Aether Terminal 

Windows向けプロジェクトファーストAIワークスペースターミナル。

## Native Terminal (推奨)

**フルネイティブRustバイナリ** — WebView2不要、wgpu直描画。

```bash
cd src-tauri
cargo run --bin native-terminal          # 開発
cargo build --bin native-terminal --release  # リリース (14MB)
```

### Native Tech Stack
- **Renderer**: wgpu 25 (DX12) — RectInstance + GlyphInstance パイプライン
- **Window**: winit 0.30 — カスタムタイトルバー、Mica透過
- **PTY**: portable-pty (ConPTY) — PowerShell
- **Font**: fontdue — CascadiaCode + NotoSansJP
- **Editor**: ropey (Rope) + tree-sitter (シンタックスハイライト)
- **LSP**: 自前JSON-RPC クライアント (rust-analyzer, pyright, etc.)
- **Theme**: Catppuccin Mocha — UI Chrome + エディタ統一パレット

### Native Architecture
```
src-tauri/src/
  bin/native_terminal.rs  # メインバイナリ — winit EventLoop
  gpu/                    # wgpu レンダラー (atlas, font, grid, renderer, surface)
  native/                 # アプリケーション本体 (mod.rs, app_handler.rs, render.rs,
                          #   input.rs, actions.rs, helpers.rs, panes.rs, types.rs, mica.rs)
  ui/                     # UI Chrome (mod.rs, sidebar.rs, editor.rs, syntax.rs,
                          #   palette.rs, toast.rs, block.rs, toolkit.rs, activity.rs,
                          #   analytics.rs, animation.rs, scm.rs, search.rs, welcome.rs)
  agent/                  # エージェント監視 (watchdog.rs)
  watchdog/               # Auto-repair パイプライン (auto_repair.rs)
  suggest/                # Ghost typing サジェストエンジン
  pty/                    # PTY管理
  lsp/                    # LSP クライアント (manager.rs, types.rs)
  config/                 # 設定管理
  db/                     # SQLite セッション永続化
```

### Native 操作
| キー | 動作 |
|------|------|
| Ctrl+Shift+P | コマンドパレット |
| Ctrl+P | Quick Open ファイル検索 |
| Ctrl+R | コマンド履歴検索 |
| Ctrl+Shift+F | ターミナル内テキスト検索 |
| Ctrl+Shift+G | ファイル内テキスト検索 |
| Ctrl+F | エディタ Find |
| Ctrl+H | エディタ Find/Replace |
| Ctrl+B | サイドバー トグル |
| Ctrl+, | 設定 |
| Ctrl+? | ヘルプ (キーボードショートカット一覧) |
| Ctrl+Shift+C | テキスト選択コピー |
| Ctrl+V | ペースト (bracketed paste) |
| Ctrl+S | エディタ ファイル保存 |
| Ctrl+Z | エディタ Undo |
| Ctrl+Shift+Z | エディタ Redo |
| Ctrl+Shift+H | ペイン水平分割 |
| Ctrl+Shift+V | ペイン垂直分割 |
| Ctrl+Shift+W | フォーカスペイン閉じる |
| Alt+Tab | ペインフォーカス切替 |
| Ctrl+Click | ハイパーリンクをブラウザで開く |
| Ctrl+Space | Ghost text サジェスト受入 |
| F12 | Go to Definition (LSP) |
| Escape | エディタ/カンバン/検索/Diff → ターミナル復帰 |
| 右クリック | コンテキストメニュー (コンテンツ/サイドバー) |

### パレットコマンド
- New Terminal Tab / New Terminal (Select Shell) / Close Tab
- Toggle Sidebar / Save File / Close Editor
- Git: Create/Switch/Delete Worktree
- Git: Stage All / Commit / Push
- PR: List Pull Requests
- Workflow: List / Status
- Command History (Ctrl+R)
- Agent: Start Claude/Codex/Gemini (モデル入力可)
- Settings (Theme/Font Size/Opacity)
- Terminal Search / Quick Open / Search in Files
- Kanban Board / Tasks (Helm)
- View Analytics
- Watchdog: Edit Rules
- Help: Keyboard Shortcuts / About Aether Terminal

### エージェント機能
- パレットからClaude/Codex/Gemini CLIをPTYタブとして起動
- 出力モニタリング: CLI固有パーサーでステータス/コスト/トークン自動検出
- ステータスバー: エージェントタブで CLI名/モデル/ステータス/コスト/経過時間
- サイドバー AGENTS パネル: アクティブセッション一覧 (ステータスドット+コスト)

### Watchdog
- エージェントPTY出力を監視し、許可プロンプト(y/n等)を自動判定
- ユーザー定義のapprove/denyパターン(正規表現)でAutoApprove/AutoDeny/AskUser分岐
- パレット「Watchdog: Edit Rules」からルール作成ウィザード(名前→指示→ターゲット選択)
- アクションログで全自動応答を記録

### Toolkit
- `.aether/toolkit.toml` からツールボタンをロード
- サイドバー下部にワンクリック実行ボタンとして表示
- 各ツール: name, command, icon, run_in_background を定義可能

### Activity Feed
- 全タブ横断のセッションイベントタイムライン
- イベント種別: SessionStarted/Ended, AgentThinking/Coding/Done, WatchdogTriggered, ToolExecuted, CommitCreated, ErrorOccurred
- 種別ごとにカラードットで視覚的区別、スクロール対応

### Analytics
- エージェント利用のコスト/トークン追跡 (CLI別: claude, codex, gemini)
- 今日/累計のコスト・トークン集計
- wgpu直描画の折れ線チャートで可視化
- パレット「View Analytics」で表示切替

### Block Output
- Warp風ブロック出力 — プロンプト行+コマンド+出力を折りたたみ可能なブロックにグループ化
- プロンプト検出で自動ブロック分割
- ブロック単位の折りたたみ/展開

### Ghost Text サジェスト
- コマンド履歴ベースのプレフィックスマッチング
- ゴーストテキスト(薄い文字)でインライン表示
- Ctrl+Space で受入

### Auto-Repair パイプライン
- エラー検出時の自動修復ジョブ管理
- デバウンス付きワーカースレッドでバックグラウンド実行
- 結果をトースト通知で表示(成功/失敗)

## Tauri版 (レガシー)

Tauri v2 + React + xterm.js 版。段階的に native 版に移行中。

### Tauri Commands
| Command | Description |
|---------|-------------|
| `pnpm dev` | Vite dev server起動 |
| `pnpm build` | プロダクションビルド |
| `pnpm tauri dev` | Tauri開発モード（Rust+Frontend同時） |
| `pnpm tauri build` | リリースビルド |
| `cargo test` | Rustユニットテスト (156テスト) |
| `pnpm test` | Frontendテスト |

### Tauri Architecture
```
aether-terminal/
  src-tauri/              # Rust backend
    src/
      pty/                # PTY管理（ConPTY, シェル起動）
      git/                # git2-rs Worktree操作
      config/             # config.toml 読み書き
      ipc/                # Tauri Event Channel ハンドラ
      db/                 # SQLite セッション永続化
  src/                    # React frontend
    features/
      terminal/           # xterm.js ターミナルコンポーネント
      sidebar/            # プロジェクト/Worktreeサイドバー
      agent-inspector/    # AIエージェント監視パネル
      command-palette/    # Ctrl+Shift+P コマンドパレット
      diff-viewer/        # Monaco diff表示
      settings/           # 設定UI
    shared/
      ui/                 # 共通UIコンポーネント
      hooks/              # React hooks
      lib/                # ユーティリティ
      types/              # TypeScript型定義
```

## Gotchas
- Mica: Win11専用。Win10はAcrylicフォールバック
- ConPTY: `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) はWin11 22H2+のみ
- tree-sitter: C パーサーのコンパイルに cc クレートが必要
- wgpu 25: egui 0.28 と非互換（wgpu 0.20 依存）→ UI Chrome は wgpu 直描画

## Docs
- 要件定義: `docs/requirements.md`
- 移行計画: `docs/handoff/03_MIGRATION_PLAN.md`
