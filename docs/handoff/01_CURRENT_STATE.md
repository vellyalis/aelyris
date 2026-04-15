# 01 現在の状態

## テクノロジースタック

### 現行版 (Tauri)
```
Frontend: React 19 + TypeScript + Vite (12,000行)
Backend:  Rust + Tauri v2 (10,000行)
Terminal: xterm.js + WebGL2
PTY:      portable-pty (ConPTY)
Git:      git2-rs (libgit2)
DB:       rusqlite (SQLite)
GPU:      wgpu (DX12/Vulkan) ※Child HWNDでフリーズ、実質未使用
```

### ネイティブ版 (開発中)
```
binary: native-terminal (cargo run --bin native-terminal)
Window: winit 0.30
GPU:    wgpu 25 (DX12)
VTE:    vte 0.13
Font:   fontdue 0.9
状態:   PTY接続+GPU描画動作。グリフ位置ズレ。UIなし。
```

## Rustモジュール一覧 (再利用可能)

| モジュール | パス | 行数 | 状態 | ネイティブ版で再利用 |
|-----------|------|------|------|-------------------|
| PTY管理 | pty/ | 600 | 安定 | そのまま |
| VTEパーサー+Grid | gpu/grid.rs | 866 | 安定 | そのまま |
| GPUレンダラー | gpu/renderer.rs | 497 | 動作 | そのまま |
| フォント管理 | gpu/font.rs | 120 | 安定 | そのまま |
| グリフアトラス | gpu/atlas.rs | 200 | 安定 | そのまま |
| Git操作 | git/ | 500 | 安定 | そのまま |
| SQLite DB | db/ | 560 | 安定 | そのまま |
| Watchdog | watchdog/ | 400 | 安定 | そのまま |
| ワークフロー | workflow/ | 300 | 安定 | そのまま |
| AIエージェント | agent/ | 1000 | 安定 | そのまま |
| IPCコマンド群 | ipc/ | 1700 | Tauri依存 | **要書き換え** |
| GPU Surface | gpu/surface.rs | 226 | Child HWND | **廃止** |
| GPU commands | gpu/commands.rs | 352 | Tauri依存 | **要書き換え** |

## Frontendコンポーネント一覧 (移行対象)

| コンポーネント | 行数 | 優先度 | Rustで再実装する方針 |
|--------------|------|--------|-------------------|
| App.tsx (レイアウト) | 430 | 高 | egui/iced レイアウト |
| TerminalArea | 205 | **不要** | native-terminalが代替 |
| EditorPanel (Monaco) | 377 | 中 | tree-sitter + 独自エディタ |
| AgentInspector | 352 | 高 | egui パネル |
| FileTree | 289 | 高 | egui ツリービュー |
| WorkflowPanel | 270 | 中 | egui パネル |
| ToolkitPanel | 315 | 低 | egui ボタングリッド |
| WorkflowBuilder | 299 | 低 | 後回し |
| CommandPalette | 84 | 高 | egui テキスト入力 |
| Settings | 203 | 低 | egui ダイアログ |

## テスト状況

| 種別 | 件数 | 状態 |
|------|------|------|
| Rust ユニット | 147 | 全通過 |
| Frontend ユニット | 270 | 全通過 |
| E2E (Playwright) | 17 | 全通過 |
| 合計 | 434 | 全通過 |

## ビルド成果物

- `pnpm tauri dev` — Tauri版 (xterm.js)
- `pnpm tauri build` — MSI + NSISインストーラー
- `cargo run --bin native-terminal` — ネイティブ版 (wgpu)
