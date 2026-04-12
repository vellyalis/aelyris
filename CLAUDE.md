# Aether Terminal 

Windows向けプロジェクトファーストAIワークスペースターミナル。

## Tech Stack
- **Framework**: Tauri v2 (Rust backend + WebView2)
- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS 4
- **Terminal**: xterm.js + @xterm/addon-webgl (WebGL2 GPU描画)
- **PTY**: portable-pty (ConPTY) — PowerShell/CMD/WSL2/Git Bash対応
- **Git**: git2-rs (libgit2)
- **Async**: tokio
- **Animation**: Motion (旧 Framer Motion) v12+
- **State**: Zustand
- **Theme**: Catppuccin + Fluent Design (Mica/Acrylic/Reveal Highlight)
- **UI Font**: Geist or Inter + Source Han Sans JP (源ノ角ゴシック)
- **Terminal Font**: Cascadia Code + Cascadia Next JP

## Commands
| Command | Description |
|---------|-------------|
| `pnpm dev` | Vite dev server起動 |
| `pnpm build` | プロダクションビルド |
| `pnpm tauri dev` | Tauri開発モード（Rust+Frontend同時） |
| `pnpm tauri build` | リリースビルド |
| `cargo test` | Rustユニットテスト |
| `pnpm test` | Frontendテスト |

## Architecture
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
- Tauri IPC: invoke式は10MBで200ms遅延。**Event Channel(`emit`/`listen`)**を使うこと
- Mica: Win11専用。Win10はAcrylicフォールバック
- ConPTY: `PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) はWin11 22H2+のみ
- xterm.js WebGL: GPU非対応環境はCanvas rendererにフォールバック必要
- WSL2パス: `/mnt/c/` ↔ `C:\` の変換ロジック要注意

## Docs
- 要件定義: `docs/requirements.md`
