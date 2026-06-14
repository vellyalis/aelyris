# Aether Terminal 

Windows向けプロジェクトファーストAIワークスペースターミナル。

## 🎯 進行中の設計 — 実装着手はここから

多エージェント並列開発コックピット化の設計が完了しています。実装を始める前に
**[`docs/specs/CODEX_HANDOFF.md`](docs/specs/CODEX_HANDOFF.md)** を読むこと（マスタープラン）。
Work Unit を1つ選び、その WU が指定する spec 節と対象ファイルだけを開いて実装する。
共有契約は HANDOFF §3、壊してはいけないものは §6。背景は `docs/specs/README.md`。

## Tech Stack

- **Framework**: Tauri v2 (Rust backend + React frontend)
- **Frontend**: React 19 + TypeScript + CSS Modules + Vite 7
- **Terminal**: xterm.js v6 + WebGL addon
- **Editor**: Monaco Editor + Vim mode
- **UI**: Radix UI (primitives) + Lucide (icons) + motion (animations)
- **Backend**: Rust (portable-pty, git2, rusqlite, tokio)
- **Window**: Mica 透過 (Win11) / Acrylic フォールバック (Win10)
- **Theme**: Catppuccin Mocha + 18K Gold accent

## Commands
| Command | Description |
|---------|-------------|
| `pnpm dev` | Vite dev server起動 |
| `pnpm build` | プロダクションビルド |
| `pnpm tauri dev` | Tauri開発モード（Rust+Frontend同時） |
| `pnpm tauri build` | リリースビルド |
| `cargo test` | Rustユニットテスト (171テスト) |
| `pnpm test` | Frontendテスト (270テスト) |

## Architecture
```
aether-terminal/
  src-tauri/              # Rust backend (core logic)
    src/
      pty/                # PTY管理 (ConPTY, シェル起動, 出力バッファ)
      agent/              # AIエージェント管理 (headless + interactive + output monitor + router)
      git/                # git2-rs (status, worktree, file tree, discovery)
      lsp/                # LSP JSON-RPC クライアント (rust-analyzer, pyright, etc.)
      db/                 # SQLite セッション・コマンド履歴永続化
      config/             # TOML設定管理
      watchdog/           # ツール自動承認エンジン + auto-repair パイプライン
      workflow/           # YAML マルチフェーズワークフロー実行
      suggest/            # コマンドサジェストエンジン
      session/            # セッション/ペイン ライフサイクル管理
      ipc/                # Tauri コマンドハンドラ (68+ commands)
      watcher.rs          # ファイルシステム変更監視
      lib.rs              # Tauri アプリエントリ
  src/                    # React frontend
    features/
      terminal/           # xterm.js ターミナル (ペイン分割, ブロック出力, Ghost Text)
      editor/             # Monaco エディタ (LSP, Diff, Vim mode)
      file-tree/          # ファイルツリー (git status統合)
      agent-inspector/    # AIエージェント監視パネル (セッション管理, Analytics)
      agent-terminal/     # インタラクティブエージェントターミナル
      command-palette/    # コマンドパレット (cmdk)
      kanban/             # タスクボード (ドラッグ&ドロップ)
      workflow/           # ワークフロービルダー (ReactFlow)
      scm/                # Git操作パネル (stage/commit/push)
      watchdog/           # Watchdogルール編集ダイアログ
      toolkit/            # ワンクリックツールボタン
      analytics/          # セッション分析 (コスト/トークン/ツール使用)
      search/             # ファイル内テキスト検索
      settings/           # 設定UI
      welcome/            # プロジェクト選択画面
      pr-inspector/       # PR表示
      statusbar/          # ステータスバー
      workspace-tabs/     # タブ管理
      header/             # プロジェクトヘッダー
      menubar/            # メニューバー
    shared/
      ui/                 # 共通UIコンポーネント (SplitPane, Toast, Dialog, etc.)
      hooks/              # React hooks (useTabManager, useAgentManager, etc.)
      store/              # Zustand ストア
      lib/                # ユーティリティ
      types/              # TypeScript型定義
    styles/
      global.css          # デザインシステム (ガラス階層, カラートークン, スペーシング)
```

## キーボードショートカット
| キー | 動作 |
|------|------|
| Ctrl+Shift+P | コマンドパレット |
| Ctrl+P | Quick Open ファイル検索 |
| Ctrl+R | コマンド履歴検索 |
| Ctrl+Shift+F | ファイル内テキスト検索 |
| Ctrl+B | サイドバー トグル |
| Ctrl+, | 設定 |
| Ctrl+S | エディタ ファイル保存 |
| Ctrl+Shift+H | ペイン水平分割 |
| Ctrl+Shift+V | ペイン垂直分割 |
| Ctrl+Space | Ghost text サジェスト受入 |
| F12 | Go to Definition (LSP) |
| Escape | エディタ/検索/Diff → ターミナル復帰 |

## Gotchas
- Mica: Win11専用。Win10はAcrylicフォールバック
- ConPTY: `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) はWin11 22H2+のみ

## Docs
- 要件定義: `docs/requirements.md`
