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
  ui/                     # UI Chrome (mod.rs, sidebar.rs, editor.rs, syntax.rs)
  pty/                    # PTY管理
  lsp/                    # LSP クライアント (manager.rs, types.rs)
```

### Native 操作
| キー | 動作 |
|------|------|
| Ctrl+Shift+P | コマンドパレット |
| Ctrl+R | コマンド履歴検索 |
| Ctrl+B | サイドバー トグル |
| Ctrl+Shift+C | テキスト選択コピー |
| Ctrl+V | ペースト (bracketed paste) |
| Ctrl+S | エディタ ファイル保存 |
| Ctrl+Z | エディタ Undo |
| Ctrl+Shift+Z | エディタ Redo |
| Escape | エディタ → ターミナル復帰 |
| サイドバーファイルクリック | エディタでファイル表示 |

### パレットコマンド
- New Terminal Tab / Close Tab
- Toggle Sidebar / Save File / Close Editor
- Git: Create/Switch/Delete Worktree
- Command History (Ctrl+R)

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
