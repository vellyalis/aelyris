# 04 新アーキテクチャ設計

## 全体構成

```
aether-terminal (native binary)
│
├── main.rs (winit event loop)
│   ├── App state
│   ├── Window management
│   └── Input dispatch
│
├── render/
│   ├── wgpu_context.rs    — Device, Queue, Surface 管理
│   ├── terminal.rs        — Grid → GPU instanced rendering
│   ├── ui_chrome.rs       — タイトルバー, タブ, ステータスバー
│   └── egui_layer.rs      — egui 統合 (サイドパネル, ダイアログ)
│
├── terminal/
│   ├── grid.rs            — (既存) VTE parser + cell grid
│   ├── font.rs            — (既存) fontdue フォント管理
│   ├── atlas.rs           — (既存) glyph atlas
│   ├── input.rs           — (既存) キーコード → PTY バイト変換
│   ├── selection.rs       — (既存) テキスト選択
│   ├── search.rs          — (既存) テキスト検索
│   └── link.rs            — (既存) URL検出
│
├── pty/                   — (既存) PTY管理
├── git/                   — (既存) git2-rs 操作
├── db/                    — (既存) SQLite 永続化
├── agent/                 — (既存) AI CLI制御
├── watchdog/              — (既存) 出力監視
├── workflow/              — (既存) YAML ワークフロー
│
└── config/
    ├── settings.rs        — TOML設定ファイル
    └── theme.rs           — Catppuccin テーマ定義
```

## データフロー

### ターミナル描画
```
PTY stdout
  → reader thread (std::io::Read)
  → VTE parser (vte::Perform)
  → Grid state (cells, cursor, dirty_rows)
  → render_tick() (wgpu instanced draw)
  → Surface present (DX12 swap chain)

所要時間: < 1ms (同一プロセス、ゼロコピー)
```

### キーボード入力
```
winit KeyboardInput event
  → key_to_pty_bytes() (input.rs)
  → pty.write() (portable-pty)
  → ConPTY → Shell

所要時間: < 0.1ms
```

### AIエージェント
```
ユーザー入力 (egui テキストフィールド)
  → agent::router::start_agent()
  → std::process::Command("claude", "--output-format", "stream-json")
  → output_monitor thread → StreamParser
  → UI state update → egui 再描画
```

## レンダリングパイプライン

### ターミナルテキスト (instanced rendering)
```
1. Grid cells → GlyphInstance[] (位置, UV, 色)
2. Upload to GPU vertex buffer
3. Draw instanced quads (1 draw call for entire grid)
4. Fragment shader: sample glyph atlas texture
```

### UI Chrome (egui)
```
1. egui::Context::begin_frame()
2. Layout panels (egui::SidePanel, TopBottomPanel)
3. egui::Context::end_frame() → primitives
4. egui-wgpu renderer → GPU
```

### 合成
```
1. Clear (Mica alpha = 0.75)
2. Draw terminal glyphs (instanced)
3. Draw cursor rects
4. Draw egui UI overlay
5. Present
```

## 状態管理

### Tauri版 (現行)
```
React (Zustand store) ←IPC→ Rust (HashMap, Mutex)
```

### ネイティブ版 (新)
```
Rust (Arc<Mutex<AppState>>) — 全て同一プロセス

AppState {
    terminals: HashMap<String, Terminal>,  // PTY + Grid per tab
    active_tab: String,
    tabs: Vec<TabInfo>,
    agent_sessions: Vec<AgentSession>,
    git_status: GitStatusInfo,
    settings: AppConfig,
    db: Database,
}
```

## ファイル構成

### 既存 (src-tauri/src/) — そのまま使える
```
pty/          236+294+70 = 600行
gpu/grid.rs             = 866行
gpu/renderer.rs         = 497行
gpu/font.rs             = 120行
gpu/atlas.rs            = 200行
git/                    = 500行
db/                     = 560行
agent/                  = 1000行
watchdog/               = 400行
workflow/               = 300行
合計: ~5,000行 (再利用可能)
```

### 廃止
```
gpu/surface.rs     — Child HWND (winit surface に置換)
gpu/commands.rs    — Tauri IPC (直接関数呼び出しに置換)
ipc/commands.rs    — Tauri IPC (直接関数呼び出しに置換)
ipc/interactive_commands.rs — 同上
lib.rs             — Tauri setup (main.rs に置換)
```

### 新規作成
```
bin/native_terminal.rs  — エントリポイント (作成済み)
render/                 — 統合レンダリング (新規)
ui/                     — egui パネル群 (新規)
config/                 — 設定管理 (新規)
```
