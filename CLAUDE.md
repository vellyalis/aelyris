# Aether Terminal 

Windows向けプロジェクトファーストAIワークスペースターミナル。

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
| F12 | ターミナル ファンクションキー送出 (CSI `\x1b[24~`)。※LSP Go to Definition は未実装 |
| Escape | エディタ/検索/Diff → ターミナル復帰 |

## Gotchas
- Mica: Win11専用。Win10はAcrylicフォールバック
- ConPTY: `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) はWin11 22H2+のみ
- LSP: 現状 `textDocument/completion` と `hover` のみ surface (`src/features/editor/lsp/registerProviders.ts`)。
  go-to-definition / 診断(publishDiagnostics) / references は未実装。また `notifyChange` (`useLsp.ts`) が
  未配線で、`didOpen` 後の編集がサーバへ届かず補完/hover が陳腐化する既知バグあり。

## 開発方針（負債管理・変更容易性）
コード変更時は常に「**既存仕様を壊さず・負債を減らし・今後変更しやすく**」を満たす。

### 鉄則
- **各段階で全ゲート緑を維持**: `pnpm exec tsc --noEmit` / `pnpm test`(vitest) / `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt`。純粋move・挙動不変を死守。挙動変化を伴う場合は実機 Tauri で視覚確認（vitest 緑だけでは UI 退行を見逃す）。
- **単一の source of truth**: 状態・データの所有者を1つに。二重所有・二重実装・FE再合成を避け、所有 hook / backend を明確に。
- **型で契約を表現**: `as` cast・`| string`・無検証 optional を避け、schema/型で不変条件を保証。Rust(snake_case)↔TS(camelCase) 契約はずれない形（理想は codegen）に。
- **死コード・重複は即時解消**: 未配線インフラ（infra without wiring）を残さない。共通ロジックは1箇所に。1ファイル800行・1関数50行を超えたら分割。
- **cargo test は pnpm test と並列実行しない**（link.exe がリソース競合で落ちる）。

### 変更前後でチェックする13観点（負債を作らない・増やさない）
重複 / 死コード / 責務の混在 / 所有範囲の曖昧さ / 過不足な抽象化 / 依存方向の乱れ / 型・schema・契約の曖昧さ / テスト不足や壊れやすいテスト / エラー・ログの不統一 / 設定・環境差分の複雑さ / 非同期・並行処理の危険 / パフォーマンスリスク / セキュリティ境界 / 命名・配置の分かりにくさ。

## Docs
- 要件定義: `docs/requirements.md`
