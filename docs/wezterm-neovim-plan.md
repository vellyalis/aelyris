# WezTerm + Neovim 級機能計画

> Aether Terminalを「WezTermに戻りたいと思わないレベル」に引き上げる計画。
> AIコマンドセンターとしてのエッジは維持しつつ、日常コーディングの基本操作を完備する。

---

## Phase A: ターミナル自由分割（WezTerm相当）

### 現状の問題

- `PaneTree.tsx`（再帰二分木モデル）が**存在するが未接続**
- App.tsxは`TerminalPane.tsx`（60/40固定2分割）を使用
- ユーザーが動的に分割/結合する手段がない

### 目標

WezTermと同等: 任意方向に無限分割 + キーボードナビゲーション + リサイズ + クローズ。

### 実装計画

#### A-1. PaneTree を App.tsx に接続

**変更ファイル:** `src/App.tsx`

```
Before: <TerminalPane shell={tab.shell} cwd={tab.cwd} />
After:  <PaneTreeContainer shell={tab.shell} cwd={tab.cwd} tabId={tab.id} />
```

- 各タブがPaneTreeインスタンスを持つ
- PaneTree状態をタブごとにlocalStorageに永続化

#### A-2. PaneTree.tsx の機能拡張

**変更ファイル:** `src/features/terminal/PaneTree.tsx`

既存コード（SplitNode/TerminalLeaf二分木 + splitNode/removeNode）をベースに以下を追加:

1. **分割方向の指定**
   ```typescript
   type SplitDirection = "right" | "down" | "left" | "up";
   
   function splitPane(nodeId: string, direction: SplitDirection, shell: ShellType, cwd?: string) {
     // direction → "right"|"left" = horizontal, "up"|"down" = vertical
     // new pane goes to first or second based on direction
   }
   ```

2. **アクティブペイン管理**
   ```typescript
   const [activePaneId, setActivePaneId] = useState<string | null>(null);
   ```
   - ペインクリック → activePaneIdが切り替わる
   - アクティブペインに視覚的ハイライト（border color）

3. **ペインナビゲーション**
   ```
   Alt+Arrow → 隣接ペインにフォーカス移動
   Alt+Shift+Arrow → アクティブペインを指定方向に分割
   Ctrl+Shift+W → アクティブペインを閉じて親splitを解消
   ```

4. **クローズ時のツリー整理**
   - ペインを閉じる → 兄弟ペインが親の位置に昇格
   - 最後のペインは閉じない（タブ自体を閉じる）

5. **リサイズ永続化**
   - SplitPaneのonRatioChangeで比率をstate更新
   - タブID+ノードIDをキーにlocalStorage保存

#### A-3. TerminalInfoBar にペイン操作ボタン追加

**変更ファイル:** `src/features/terminal/TerminalInfoBar.tsx`

```
[Split ↔] [Split ↕] [Maximize ☐] [Close ×]
```

- Split ↔ = 水平分割 (右にペイン追加)
- Split ↕ = 垂直分割 (下にペイン追加)
- Maximize = ペインを最大化 (他のペインを非表示)
- Close = ペインを閉じる

#### A-4. キーボードショートカット追加

**変更ファイル:** `src/shared/hooks/useKeyboardShortcuts.ts`

| キー | アクション |
|------|-----------|
| `Alt+Shift+Right` | アクティブペインを右に分割 |
| `Alt+Shift+Down` | アクティブペインを下に分割 |
| `Alt+Right/Left/Up/Down` | ペイン間フォーカス移動 |
| `Ctrl+Shift+W` | アクティブペインを閉じる |
| `Alt+Enter` | ペイン最大化トグル |

#### A-5. TerminalArea.tsx の改修

- `onFocus` ハンドラで親PaneTreeにactivePaneIdを通知
- `onTerminalReady(terminalId)` で PTY ID をPaneTreeに伝播
- send-keys/capture-pane がペインIDで指定可能に

### ファイル変更一覧

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src/features/terminal/PaneTree.tsx` | 分割方向、ナビゲーション、クローズ整理、永続化 | ~150行 書き直し |
| `src/features/terminal/PaneTreeContainer.tsx` | **新規** — PaneTree + タブ連携ラッパー | ~60行 |
| `src/features/terminal/TerminalInfoBar.tsx` | Split/Maximize/Close ボタン | +30行 |
| `src/features/terminal/TerminalArea.tsx` | onFocus通知、activePaneハイライト | +15行 |
| `src/shared/hooks/useKeyboardShortcuts.ts` | ペイン操作ショートカット | +25行 |
| `src/App.tsx` | TerminalPane → PaneTreeContainer 差し替え | ±10行 |

---

## Phase B: Fuzzy Finder（Telescope相当）

### 現状の問題

- SearchPanel: substring grep のみ、fuzzy matching なし
- CommandPalette: cmdk ベースだがコマンド検索のみ
- Rust backend: `search_files()` はファイル名substring、`grep_files()` は行内容substring
- ファイル一覧を高速に取得するAPIがない

### 目標

4つのモード:
1. **Ctrl+P — File Picker**: ファイル名fuzzy検索 + プレビュー
2. **Ctrl+Shift+F — Live Grep**: ファイル内容fuzzy検索（既存SearchPanel拡張）
3. **Ctrl+Shift+O — Symbol Search**: 関数/クラス名ジャンプ (将来)
4. **Ctrl+Tab — Buffer Switcher**: 開いているファイルのfuzzy切替

### 実装計画

#### B-1. Rust backend: list_all_files (gitignore対応)

**新規ファイル:** `src-tauri/src/git/filelist.rs`

```rust
/// List all files in a project, respecting .gitignore
/// Returns relative paths sorted by modification time (newest first)
pub fn list_all_files(root_path: &str, max_files: usize) -> Result<Vec<FileListEntry>, String> {
    // Use git2-rs to list tracked files (respects .gitignore)
    // Fallback: walk_dir with manual .gitignore parsing
}

pub struct FileListEntry {
    pub relative_path: String,
    pub size: u64,
    pub modified_at: u64, // unix timestamp
}
```

**IPCコマンド:** `list_all_files(root_path, max_files)` → Vec<FileListEntry>

#### B-2. Frontend: match-sorter 導入

```bash
pnpm add match-sorter
pnpm add -D @types/match-sorter
```

#### B-3. QuickOpen コンポーネント（Ctrl+P）

**新規ファイル:** `src/features/quick-open/QuickOpen.tsx`

```
┌─────────────────────────────────────┐
│ 🔍 [ファイル名を入力...]            │
├─────────────────────────────────────┤
│ ◉ src/App.tsx               2.1kB  │ ← active (highlight)
│   src/features/kanban/Ka...  1.4kB │
│   src/shared/hooks/useAg...  0.8kB │
│   ...                              │
├─────────────────────────────────────┤
│ Preview: (ファイル内容先頭20行)     │
└─────────────────────────────────────┘
```

**データフロー:**
1. Ctrl+P → QuickOpen マウント
2. マウント時にRust `list_all_files` 呼び出し → 全ファイルパスをメモリキャッシュ
3. 入力文字が変わるたびに `matchSorter(files, query, { keys: ['relative_path'] })` でフィルタ
4. 上下キー/Enterで選択 → `openFile(path)` 呼び出し
5. 右側プレビュー（オプション）: Rust `read_file` で先頭50行読み込み

**パフォーマンス対策:**
- ファイルリストはキャッシュ (fs:changed イベントで invalidate)
- match-sorter の結果は50件にlimit (UIに表示する分だけ)
- 入力デバウンス: 100ms

#### B-4. SearchPanel 拡張（Live Grep）

**変更ファイル:** `src/features/search/SearchPanel.tsx`

- 既存 `grep_files` は維持
- match-sorter でファイル名のfuzzy候補も表示 (ファイル名マッチ + 行内容マッチの2セクション)
- ページネーション: 最初の50件表示 → "Load More" ボタン

#### B-5. Buffer Switcher（Ctrl+Tab）

**変更ファイル:** `src/features/quick-open/QuickOpen.tsx` (モード切替)

- Ctrl+Tab → 開いているファイル (`openFiles`) のfuzzy検索
- MRU (Most Recently Used) 順にソート
- Escで閉じる

### ファイル変更一覧

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/git/filelist.rs` | **新規** — gitignore対応ファイル一覧 | ~80行 |
| `src-tauri/src/git/mod.rs` | filelist モジュール追加 | +2行 |
| `src-tauri/src/ipc/commands.rs` | `list_all_files` IPC | +15行 |
| `src-tauri/src/lib.rs` | ハンドラ登録 | +1行 |
| `src/features/quick-open/QuickOpen.tsx` | **新規** — Ctrl+P / Ctrl+Tab fuzzy finder | ~200行 |
| `src/features/quick-open/QuickOpen.module.css` | **新規** | ~100行 |
| `src/features/search/SearchPanel.tsx` | fuzzy候補追加 | +30行 |
| `src/shared/hooks/useKeyboardShortcuts.ts` | Ctrl+P, Ctrl+Tab ショートカット | +10行 |
| `src/App.tsx` | QuickOpen マウント + ファイルキャッシュ | +20行 |

---

## Phase C: Monaco LSP強化

### 目標

Rust, Python, Go の基本的なLSP機能（補完、診断、定義ジャンプ）を有効化。

### 方針

Monaco EditorにはLSP統合の仕組み（`monaco-languageclient`）がある。
ただしこれは**Language Serverプロセスをバックエンドで起動**して**WebSocket/stdio経由で接続**する必要がある。

Tauri backendで言語サーバーを子プロセスとして起動し、stdin/stdout経由でMonacoと接続する。

#### C-1. Language Server Manager (Rust)

**新規ファイル:** `src-tauri/src/lsp/mod.rs`

```rust
pub struct LspManager {
    servers: HashMap<String, Child>, // language -> process
}

impl LspManager {
    pub fn start_server(language: &str, root_path: &str) -> Result<(), String>;
    pub fn stop_server(language: &str) -> Result<(), String>;
    // stdin/stdout proxied via Tauri events
}
```

対応サーバー:
- TypeScript: `typescript-language-server`
- Rust: `rust-analyzer`
- Python: `pyright` or `pylsp`
- Go: `gopls`

#### C-2. monaco-languageclient 統合

```bash
pnpm add monaco-languageclient vscode-languageclient vscode-ws-jsonrpc
```

EditorPanelのonMountで、ファイル拡張子に応じたLSP接続を確立。

### 推定規模

| ファイル | 行数 |
|---------|------|
| `src-tauri/src/lsp/mod.rs` | ~150行 |
| `src/features/editor/lsp-config.ts` | ~100行 |
| `src/features/editor/EditorPanel.tsx` | +50行 |

---

## 実装優先順位

```
Phase A (ターミナル自由分割)  ← 最優先。日常使いの最大障壁
    ↓
Phase B (Fuzzy Finder)        ← 2番目。ファイルナビゲーション不可欠
    ↓
Phase C (Monaco LSP)          ← 3番目。エディタとしての完成度
```

### 総規模

| Phase | 新規ファイル | 変更ファイル | 新規行数 |
|-------|------------|------------|---------|
| A: ターミナル分割 | 1 | 5 | ~290 |
| B: Fuzzy Finder | 3 | 4 | ~460 |
| C: Monaco LSP | 2 | 2 | ~300 |
| **合計** | **6** | **11** | **~1,050** |
