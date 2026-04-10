# Aether Terminal 実装計画書

Version: 2.0.0
Date: 2026-04-10
Status: Draft — レビュー待ち

---

## 0. 本計画の位置づけ

### 0.1 現状の監査スコア

| 視点 | 得点 | 満点 |
|------|------|------|
| UIデザイナー | 5 | 25 |
| FEエンジニア | 4 | 25 |
| AIプログラマ | 3 | 25 |
| インフラ | 4 | 25 |
| **合計** | **16** | **100** |

### 0.2 本計画の目標

**16 → 80+ を、以下の戦略で達成する:**

1. **自動テスト可能なPTY層**を先に作り、品質基盤を確立
2. **tmux的なセッション管理**をWindows ConPTYネイティブで再発明
3. **AI統合を実動作レベル**に引き上げる
4. **UIデザインシステム**を統一して一貫性を確保

### 0.3 核心コンセプト: ネストPTYによる自己テスト

tmuxのWindowsネイティブ再発明において最大の課題は「ターミナルのテスト・デバッグは目で見ないとわからない」という通説。これを覆す:

```
テストプロセス (Rust)
  └─ PTYスポーン (portable-pty / ConPTY)
       └─ PowerShell / CMD を子プロセスとして起動
            ├─ stdin に入力を書き込む
            ├─ stdout から出力を読む
            └─ 期待値と比較 → PASS / FAIL
```

**テスト可能な範囲（全体の~80%）:**
- PTYスポーン・入出力サイクル
- セッション管理（作成・保存・復元・detach/reattach概念）
- プロセスライフサイクル（起動・kill・ゾンビ防止）
- エスケープシーケンス解析
- マルチPTY並行動作
- Agent CLI起動・stream-json解析
- Watchdogパターンマッチング

**テスト困難な範囲（残り~20%、別手段で対応）:**
- xterm.js描画結果（Playwrightスクリーンショット比較）
- IME入力挙動（手動テスト）
- Mica/Acrylic透過効果（手動テスト）
- ウィンドウリサイズ時の再描画（Playwright）

---

## 1. アーキテクチャ設計

### 1.1 レイヤー構成

```
┌─────────────────────────────────────────────┐
│               React Frontend                │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ xterm.js│ │ Monaco   │ │ Agent        │  │
│  │ Terminal│ │ Editor   │ │ Inspector    │  │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│       │           │              │           │
│  ┌────┴───────────┴──────────────┴────────┐  │
│  │         Zustand Store (appStore)       │  │
│  └────────────────┬───────────────────────┘  │
├───────────────────┼─────────────────────────┤
│  Tauri Event Channel (emit / listen)        │
├───────────────────┼─────────────────────────┤
│               Rust Backend                  │
│  ┌────────────────┼───────────────────────┐  │
│  │            IPC Commands                │  │
│  │  ┌─────────┬──┴─────┬──────────────┐   │  │
│  │  │SessionMgr│PtyPool │ AgentManager │   │  │
│  │  │(NEW)    │        │              │   │  │
│  │  └────┬────┘  ┌─────┘  ┌───────────┘   │  │
│  │       │       │        │               │  │
│  │  ┌────┴───────┴────────┴────────────┐  │  │
│  │  │        PtyManager (既存)          │  │  │
│  │  │   portable-pty / ConPTY          │  │  │
│  │  └──────────────────────────────────┘  │  │
│  │                                        │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │ GitOps   │ │ Watchdog │ │ Config │  │  │
│  │  │ (git2)   │ │ (Rules)  │ │ (TOML) │  │  │
│  │  └──────────┘ └──────────┘ └────────┘  │  │
│  │                                        │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │   SQLite (session persistence)   │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 1.2 新規追加モジュール

| モジュール | パス | 責務 |
|-----------|------|------|
| **SessionManager** | `src-tauri/src/session/` | tmux的セッション管理。detach/reattach概念 |
| **LayoutEngine** | `src-tauri/src/layout/` | ペイン分割・タイル配置の状態管理 |
| **StreamParser** | `src-tauri/src/agent/parser.rs` | stream-jsonの堅牢なパーサー |
| **WatchdogEngine** | `src-tauri/src/watchdog/engine.rs` | パターンマッチ + PTYフック |
| **Database** | `src-tauri/src/db/` | SQLiteスキーマ・マイグレーション |
| **TestHarness** | `src-tauri/tests/` | ネストPTYテストフレームワーク |

### 1.3 データフロー（PTY入出力）

```
[現在] invoke式 → 同期的、10MB制限、200ms遅延
[目標] Event Channel → 非同期、制限なし、低レイテンシ

Frontend                    Rust Backend
  │                            │
  ├─ emit("pty-input", {id, data})──────►│
  │                            │  PtyManager.write(id, data)
  │                            │
  │◄──── emit("pty-output", {id, data})──┤
  │                            │  reader thread (4KB buffer)
  │  xterm.js.write(data)      │
  │                            │
  ├─ emit("pty-resize", {id, cols, rows})─►│
  │                            │  PtyManager.resize(id, ...)
```

---

## 2. 実装フェーズ

### Phase A: テスト基盤 + PTY品質強化（最優先）

**目的:** ネストPTYテストハーネスを構築し、以降の全開発をテスト駆動で進める土台を作る。

**期間目安:** セッション1-2回

#### A-1. テストハーネス構築

**ファイル:** `src-tauri/tests/pty_harness.rs` (新規)

```rust
// テストハーネスの設計
pub struct PtyTestHarness {
    manager: PtyManager,
}

impl PtyTestHarness {
    /// PTYを起動し、コマンドを送信、出力を取得して比較
    pub fn spawn_and_exec(
        shell: &ShellType,
        input: &str,
        timeout_ms: u64,
    ) -> Result<String, String>;

    /// 入力→出力のペアを検証
    pub fn assert_output_contains(
        shell: &ShellType,
        input: &str,
        expected: &str,
    ) -> bool;

    /// PTYのライフサイクルテスト
    pub fn test_lifecycle(shell: &ShellType) -> Result<(), String>;
}
```

**テストケース一覧:**

| # | テスト名 | 入力 | 期待出力 | 検証対象 |
|---|---------|------|---------|---------|
| 1 | `test_pwsh_spawn` | (起動のみ) | プロセス存在確認 | PTYスポーン |
| 2 | `test_pwsh_echo` | `echo "hello"\r\n` | `hello` を含む | 入出力パイプ |
| 3 | `test_cmd_spawn` | (起動のみ) | プロセス存在確認 | CMD対応 |
| 4 | `test_cmd_dir` | `dir\r\n` | ファイル一覧 | CMD入出力 |
| 5 | `test_gitbash_spawn` | (起動のみ) | プロセス存在確認 | Git Bash対応 |
| 6 | `test_gitbash_ls` | `ls\r\n` | ファイル一覧 | Git Bash入出力 |
| 7 | `test_resize` | cols=40→120 | エラーなし | リサイズ |
| 8 | `test_close` | close(id) | リストから消える | クローズ |
| 9 | `test_close_all` | 3つスポーン→close_all | リスト空 | 一括クローズ |
| 10 | `test_write_after_close` | close後write | Err返却 | エラーハンドリング |
| 11 | `test_concurrent_spawn` | 5つ並行スポーン | 全IDユニーク | 並行性 |
| 12 | `test_large_output` | 1MB出力コマンド | 全データ受信 | バッファリング |
| 13 | `test_japanese_io` | `echo "日本語"\r\n` | `日本語`を含む | UTF-8 |
| 14 | `test_escape_sequences` | ANSIカラーコマンド | ESCシーケンス含む | エスケープ透過 |
| 15 | `test_zombie_prevention` | スポーン→Drop | プロセス不在 | ゾンビ防止 |

**実装詳細:**

```
src-tauri/
  tests/
    pty_harness.rs          # ~200行: テストユーティリティ
    test_pty_basic.rs       # ~150行: テスト1-6 (基本スポーン・入出力)
    test_pty_lifecycle.rs   # ~120行: テスト7-10 (リサイズ・クローズ)
    test_pty_advanced.rs    # ~150行: テスト11-15 (並行・大容量・日本語)
```

#### A-2. PtyManager改善

**ファイル:** `src-tauri/src/pty/manager.rs` (既存: 175行 → ~250行)

改善項目:
1. **プロセスID追跡**: `Child`の`id()`を保持し、ゾンビ検出に使用
2. **タイムアウト付きclose**: kill後にwaitpid相当で確実に回収
3. **メタデータ追加**: 起動時刻、cwd、shell_typeをPtyInstanceに保持
4. **エラー型の整理**: `String`から専用`PtyError` enumへ

```rust
// PtyInstance拡張
struct PtyInstance {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
    shell_type: ShellType,
    // 追加フィールド
    pid: Option<u32>,
    cwd: String,
    spawned_at: std::time::Instant,
}

// 専用エラー型
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("PTY spawn failed: {0}")]
    SpawnFailed(String),
    #[error("Terminal {0} not found")]
    NotFound(String),
    #[error("Lock poisoned")]
    LockPoisoned,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

#### A-3. Shell検出の堅牢化

**ファイル:** `src-tauri/src/pty/shell.rs` (既存: 66行 → ~100行)

改善項目:
1. **pwsh.exe vs powershell.exe の区別**: PowerShell 7と5.1を別`ShellType`に
2. **Git Bashパスの動的検出**: `where git`→親ディレクトリ+`/bin/bash.exe`
3. **WSLディストリビューション列挙**: `wsl -l -q`で利用可能なディストロ一覧

```rust
pub enum ShellType {
    PowerShell7,        // pwsh.exe
    PowerShell5,        // powershell.exe
    Cmd,
    GitBash,
    Wsl(String),        // ディストリビューション名
}
```

---

### Phase B: セッション管理 + SQLite永続化

**目的:** tmux的な「セッション」概念を導入。アプリ終了→再起動でターミナル状態を復元できるようにする。

**期間目安:** セッション2-3回

#### B-1. SQLiteスキーマ設計

**ファイル:** `src-tauri/src/db/mod.rs` (新規, ~50行)
**ファイル:** `src-tauri/src/db/migrations.rs` (新規, ~80行)
**ファイル:** `src-tauri/src/db/queries.rs` (新規, ~150行)

**依存追加:** `Cargo.toml` に `rusqlite = { version = "0.31", features = ["bundled"] }`

```sql
-- テーブル設計

-- セッション（tmuxの"session"に相当）
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    is_active   INTEGER NOT NULL DEFAULT 1
);

-- ウィンドウ（tmuxの"window"に相当 = タブ）
CREATE TABLE windows (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    layout_type TEXT NOT NULL DEFAULT 'single'  -- single, hsplit, vsplit, grid
);

-- ペイン（tmuxの"pane"に相当 = 個別ターミナル）
CREATE TABLE panes (
    id          TEXT PRIMARY KEY,
    window_id   TEXT NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    shell_type  TEXT NOT NULL,
    cwd         TEXT NOT NULL,
    cols        INTEGER NOT NULL DEFAULT 120,
    rows        INTEGER NOT NULL DEFAULT 30,
    -- レイアウト内の位置
    flex_basis  REAL NOT NULL DEFAULT 1.0,  -- 比率
    position    TEXT NOT NULL DEFAULT 'center'  -- left, right, top, bottom, center
);

-- エージェントセッション
CREATE TABLE agent_sessions (
    id          TEXT PRIMARY KEY,
    pane_id     TEXT REFERENCES panes(id) ON DELETE SET NULL,
    model       TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'idle',
    cost        REAL NOT NULL DEFAULT 0.0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT
);

-- スクロールバック履歴（オプション、大容量注意）
CREATE TABLE scrollback (
    pane_id     TEXT NOT NULL REFERENCES panes(id) ON DELETE CASCADE,
    data        BLOB NOT NULL,  -- xterm.js serialize addon出力
    saved_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**保存場所:** `~/.aether/aether.db`

#### B-2. SessionManager実装

**ファイル:** `src-tauri/src/session/mod.rs` (新規, ~30行)
**ファイル:** `src-tauri/src/session/manager.rs` (新規, ~250行)

```rust
pub struct SessionManager {
    db: rusqlite::Connection,
    pty_manager: Arc<PtyManager>,
}

impl SessionManager {
    // セッションCRUD
    pub fn create_session(name: &str) -> Result<SessionId, Error>;
    pub fn list_sessions() -> Result<Vec<Session>, Error>;
    pub fn delete_session(id: &str) -> Result<(), Error>;

    // ウィンドウ（タブ）CRUD
    pub fn create_window(session_id: &str, title: &str) -> Result<WindowId, Error>;
    pub fn list_windows(session_id: &str) -> Result<Vec<Window>, Error>;

    // ペインCRUD + PTY紐付け
    pub fn create_pane(window_id: &str, shell: ShellType, cwd: &str) -> Result<PaneId, Error>;
    pub fn split_pane(pane_id: &str, direction: SplitDirection) -> Result<PaneId, Error>;

    // セッション保存・復元
    pub fn save_state() -> Result<(), Error>;
    pub fn restore_state() -> Result<RestoredSession, Error>;
}

pub enum SplitDirection { Horizontal, Vertical }

pub struct RestoredSession {
    pub windows: Vec<RestoredWindow>,
}

pub struct RestoredWindow {
    pub title: String,
    pub panes: Vec<RestoredPane>,
    pub layout: LayoutType,
}

pub struct RestoredPane {
    pub shell: ShellType,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}
```

#### B-3. セッション関連テスト

**ファイル:** `src-tauri/tests/test_session.rs` (新規, ~200行)

| # | テスト名 | 検証対象 |
|---|---------|---------|
| 1 | `test_create_session` | セッション作成→DB確認 |
| 2 | `test_create_window` | ウィンドウ追加→session紐付け |
| 3 | `test_create_pane_spawns_pty` | ペイン作成→PTY起動確認 |
| 4 | `test_split_horizontal` | 水平分割→2ペイン |
| 5 | `test_split_vertical` | 垂直分割→2ペイン |
| 6 | `test_save_and_restore` | 保存→DB確認→復元→構造一致 |
| 7 | `test_delete_session_cleanup` | セッション削除→PTYも閉じる |
| 8 | `test_nested_split` | 分割→再分割→3ペイン |
| 9 | `test_concurrent_sessions` | 2セッション並行 |
| 10 | `test_restore_with_missing_shell` | WSL未インストール環境で復元→フォールバック |

#### B-4. IPCコマンド追加

**ファイル:** `src-tauri/src/ipc/commands.rs` (既存: 469行 → ~600行)

追加コマンド:
```rust
#[tauri::command]
fn create_session(name: &str) -> Result<String, String>;
#[tauri::command]
fn list_sessions() -> Result<Vec<Session>, String>;
#[tauri::command]
fn restore_last_session() -> Result<RestoredSession, String>;
#[tauri::command]
fn split_pane(pane_id: &str, direction: &str) -> Result<String, String>;
```

---

### Phase C: Agent統合を実動作レベルに

**目的:** Claude Code連携を「コードはあるが動作未確認」→「テスト済みで動く」に引き上げる。

**期間目安:** セッション2-3回

#### C-1. stream-jsonパーサー書き直し

**ファイル:** `src-tauri/src/agent/parser.rs` (新規, ~200行)

現状の問題: `claude.rs`内でstream-json解析がtry-catchで雑。部分JSON、マルチライン未対応。

```rust
/// Claude Code stream-json イベント型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StreamEvent {
    #[serde(rename = "system")]
    System {
        subtype: String,    // "init" | "model_info"
        #[serde(flatten)]
        data: serde_json::Value,
    },
    #[serde(rename = "assistant")]
    Assistant {
        subtype: String,    // "text" | "tool_use" | "tool_result"
        content: Option<String>,
        tool_name: Option<String>,
        tool_input: Option<serde_json::Value>,
    },
    #[serde(rename = "result")]
    Result {
        subtype: String,
        cost_usd: f64,
        total_tokens: u64,
        duration_ms: u64,
    },
}

/// 行ベースのストリーミングパーサー
pub struct StreamParser {
    buffer: String,
}

impl StreamParser {
    pub fn new() -> Self;

    /// 受信データを投入、パース可能なイベントを返す
    pub fn feed(&mut self, chunk: &str) -> Vec<StreamEvent>;

    /// 不完全JSONの蓄積 + 行区切りで分割 + 各行をパース
    fn try_parse_line(&self, line: &str) -> Option<StreamEvent>;
}
```

#### C-2. AgentManager改善

**ファイル:** `src-tauri/src/agent/claude.rs` (既存: 177行 → ~250行)

改善項目:
1. **`--bare` フラグ追加**: 予測可能な動作のため
2. **環境変数パススルー**: `ANTHROPIC_API_KEY`等
3. **stderr分離キャプチャ**: エラーログを独立ストリームで取得
4. **セッション再開**: `--resume <session_id>` 対応
5. **プロセスツリーkill**: Windows `taskkill /T /F /PID` で確実に子プロセスごと停止

```rust
impl AgentManager {
    pub fn start_session(
        &self,
        prompt: &str,
        cwd: &str,
        model: Option<&str>,
        allowed_tools: Option<Vec<String>>,
        resume_id: Option<&str>,        // 追加: セッション再開
    ) -> Result<String, String>;

    pub fn take_stderr(&self, id: &str) -> Result<BufReader<ChildStderr>, String>;  // 追加

    // Windows ConPTYプロセスツリー停止
    fn kill_process_tree(pid: u32) -> Result<(), String> {
        Command::new("taskkill")
            .args(&["/T", "/F", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| format!("taskkill failed: {}", e))?;
        Ok(())
    }
}
```

#### C-3. Watchdogエンジン実装

**ファイル:** `src-tauri/src/watchdog/engine.rs` (新規, ~150行)

現状: ルール定義のみ、マッチングロジックなし。PTYフックなし。

```rust
pub struct WatchdogEngine {
    rules: WatchdogRules,
}

impl WatchdogEngine {
    /// stream-jsonのtool_useイベントに対してルールマッチ
    pub fn evaluate(&self, tool_name: &str, tool_input: &str) -> WatchdogDecision;

    /// glob風パターンマッチ
    fn matches_pattern(pattern: &str, input: &str) -> bool;
}

pub enum WatchdogDecision {
    AutoApprove { rule: String },
    AutoDeny { rule: String },
    AskUser,    // ルールにマッチしない → ユーザーに確認
}
```

#### C-4. Agent関連テスト

**ファイル:** `src-tauri/tests/test_agent.rs` (新規, ~250行)

| # | テスト名 | 方法 | 検証対象 |
|---|---------|------|---------|
| 1 | `test_stream_parser_single_line` | JSONテキスト投入 | パース正常 |
| 2 | `test_stream_parser_partial_json` | 不完全JSON→追加投入 | バッファリング |
| 3 | `test_stream_parser_multiline` | 複数行一括投入 | 複数イベント返却 |
| 4 | `test_stream_parser_malformed` | 壊れたJSON | エラーなくスキップ |
| 5 | `test_stream_parser_all_types` | system/assistant/result | 全型パース |
| 6 | `test_watchdog_approve` | "Read" → "Read"ルール | AutoApprove |
| 7 | `test_watchdog_deny` | "Bash(rm -rf /)" → denyルール | AutoDeny |
| 8 | `test_watchdog_ask_user` | 未知ツール | AskUser |
| 9 | `test_watchdog_glob_pattern` | "Bash(git status*)" → "git status --short" | マッチ |
| 10 | `test_watchdog_disabled` | enabled=false | 全てAskUser |
| 11 | `test_agent_spawn_mock` | ダミースクリプト起動 | プロセスID取得 |
| 12 | `test_agent_kill_tree` | 子プロセス付きで起動→kill | 全プロセス終了 |

**ダミーエージェント（テスト用）:**

テスト時に実際のClaude CLIを呼ばず、ダミーのstream-json出力をするスクリプトを使う。

**ファイル:** `src-tauri/tests/fixtures/mock_agent.ps1` (新規, ~30行)

```powershell
# stream-jsonをシミュレートするモックエージェント
$events = @(
    '{"type":"system","subtype":"init","session_id":"test-123"}',
    '{"type":"assistant","subtype":"text","content":"Hello from mock agent"}',
    '{"type":"assistant","subtype":"tool_use","tool_name":"Read","tool_input":{"path":"test.txt"}}',
    '{"type":"result","subtype":"success","cost_usd":0.001,"total_tokens":100,"duration_ms":500}'
)
foreach ($e in $events) {
    Write-Output $e
    Start-Sleep -Milliseconds 100
}
```

---

### Phase D: UIデザインシステム統一

**目的:** スペーシング・色・アイコン・アニメーション・状態表示の一貫性を確立。

**期間目安:** セッション2回

#### D-1. デザイントークン定義

**ファイル:** `src/shared/styles/tokens.css` (新規, ~80行)

```css
:root {
  /* Spacing scale (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Z-index scale */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;

  /* Transitions */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* Font sizes */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 14px;
  --text-xl: 16px;
}
```

#### D-2. Catppuccin テーマ変数統一

**ファイル:** `src/shared/themes/catppuccin.ts` (既存 or 新規, ~120行)

全コンポーネントでCSS変数参照に統一。直接rgba値のハードコードを全廃。

```typescript
export const themes = {
  mocha: {
    base: '#1e1e2e',
    mantle: '#181825',
    crust: '#11111b',
    surface0: '#313244',
    surface1: '#45475a',
    surface2: '#585b70',
    overlay0: '#6c7086',
    text: '#cdd6f4',
    subtext0: '#a6adc8',
    blue: '#89b4fa',
    green: '#a6e3a1',
    red: '#f38ba8',
    yellow: '#f9e2af',
    // ... 全色定義
  },
  // frappe, macchiato, latte
} as const;
```

#### D-3. 共通UIコンポーネント整備

| コンポーネント | ファイル | 行数目安 | 用途 |
|--------------|---------|---------|------|
| `Spinner` | `src/shared/ui/Spinner.tsx` | ~20行 | 統一ローディング表示 |
| `ErrorMessage` | `src/shared/ui/ErrorMessage.tsx` | ~30行 | 統一エラー表示 |
| `EmptyState` | `src/shared/ui/EmptyState.tsx` | ~25行 | データなし状態 |
| `Badge` | `src/shared/ui/Badge.tsx` | ~25行 | ステータスバッジ |
| `Tooltip` | `src/shared/ui/Tooltip.tsx` | ~40行 | ツールチップ |
| `KeyboardShortcut` | `src/shared/ui/KeyboardShortcut.tsx` | ~20行 | ショートカット表示 |

#### D-4. 既存コンポーネントのトークン移行

全コンポーネントで直接値(`4px`, `#313244`, `rgba(...)`)をCSS変数参照に置換。

**対象ファイル（要置換）:**

| ファイル | 置換箇所の見込み |
|---------|----------------|
| `App.tsx` | spacing 15箇所+, 色 10箇所+ |
| `Sidebar.tsx` | spacing 10箇所+, 色 8箇所+ |
| `StatusBar.tsx` | spacing 5箇所+, 色 5箇所+ |
| `TitleBar.tsx` | spacing 8箇所+, 色 6箇所+ |
| `TabBar.tsx` | spacing 8箇所+, 色 8箇所+ |
| `TerminalArea.tsx` | 色 5箇所+ |
| `MenuBar.tsx` | spacing 10箇所+, 色 8箇所+ |
| その他features/* | 各5-10箇所 |

**目標:** `git grep -c "rgba\|#[0-9a-fA-F]\{6\}"` の直接色指定を90%以上削減。

#### D-5. アニメーション追加

**対象とアニメーション定義:**

| 要素 | アニメーション | Motion設定 |
|------|-------------|-----------|
| サイドバー開閉 | 横スライド | `x: [0, -240]`, spring stiffness=300, damping=30 |
| タブ切替 | フェード+スケール | `opacity: [0,1]`, `scale: [0.98, 1]`, duration=150ms |
| パネル分割 | flex-basis変化 | `layoutId` + spring |
| コマンドパレット | 上からスライド+フェード | `y: [-20, 0]`, `opacity: [0,1]`, spring |
| ステータスバッジ | パルス | `scale: [1, 1.1, 1]`, repeat |
| エラーメッセージ | シェイク | `x: [0, -4, 4, -4, 0]`, duration=300ms |

---

### Phase E: フロントエンド品質強化

**目的:** テスト・a11y・パフォーマンス・セキュリティの底上げ。

**期間目安:** セッション2回

#### E-1. Vitestテスト拡充

現状5テスト → **最低30テスト**に拡充。

**テスト対象とファイル:**

| ファイル | テスト数 | テスト内容 |
|---------|---------|-----------|
| `appStore.test.ts` | 8 | Zustand store: 全action + persistence |
| `useTabManager.test.ts` | 5 | タブ作成/切替/閉じる/順序変更 |
| `useAgentManager.test.ts` | 5 | Agent開始/停止/ステータス更新 |
| `useGitStatus.test.ts` | 3 | ブランチ表示/dirty状態 |
| `Sidebar.test.tsx` | 3 | プロジェクト一覧/選択/折りたたみ |
| `CommandPalette.test.tsx` | 3 | 表示/検索/選択 |
| `StatusBar.test.tsx` | 3 | 表示内容/テーマ反映 |

#### E-2. アクセシビリティ (a11y)

**全コンポーネント共通:**
1. `aria-label` を全インタラクティブ要素に付与
2. `role` 属性: sidebar→`navigation`, terminal→`application`, tabs→`tablist`
3. `focus-visible` の `outline` を統一（`2px solid var(--ctp-blue)`）
4. キーボードナビ: `Tab`で全パネル間移動可能に
5. `outline: none` の全箇所を削除し、`focus-visible`に置換

#### E-3. パフォーマンス最適化

| 項目 | 現状 | 対策 |
|------|------|------|
| Monaco Editor | 丸ごとバンドル(数MB) | `React.lazy` + `Suspense` で遅延読み込み（実装済み確認→未適用箇所を修正） |
| Agent polling | 2秒間隔setInterval | Tauri Event Channelのpush型に変更 |
| Re-render | React.memo不足 | 全shared/uiコンポーネントにReact.memo適用（一部済み→残りを処理） |
| EventListener | 解除漏れの可能性 | useEffect cleanupを全hookで監査 |

---

## 3. 新規ファイル一覧

| パス | 行数目安 | Phase |
|------|---------|-------|
| `src-tauri/tests/pty_harness.rs` | 200 | A |
| `src-tauri/tests/test_pty_basic.rs` | 150 | A |
| `src-tauri/tests/test_pty_lifecycle.rs` | 120 | A |
| `src-tauri/tests/test_pty_advanced.rs` | 150 | A |
| `src-tauri/src/db/mod.rs` | 50 | B |
| `src-tauri/src/db/migrations.rs` | 80 | B |
| `src-tauri/src/db/queries.rs` | 150 | B |
| `src-tauri/src/session/mod.rs` | 30 | B |
| `src-tauri/src/session/manager.rs` | 250 | B |
| `src-tauri/tests/test_session.rs` | 200 | B |
| `src-tauri/src/agent/parser.rs` | 200 | C |
| `src-tauri/src/watchdog/engine.rs` | 150 | C |
| `src-tauri/tests/test_agent.rs` | 250 | C |
| `src-tauri/tests/fixtures/mock_agent.ps1` | 30 | C |
| `src/shared/styles/tokens.css` | 80 | D |
| `src/shared/themes/catppuccin.ts` | 120 | D |
| `src/shared/ui/Spinner.tsx` | 20 | D |
| `src/shared/ui/ErrorMessage.tsx` | 30 | D |
| `src/shared/ui/EmptyState.tsx` | 25 | D |
| `src/shared/ui/Badge.tsx` | 25 | D |
| `src/shared/ui/Tooltip.tsx` | 40 | D |
| `src/shared/ui/KeyboardShortcut.tsx` | 20 | D |
| `src/__tests__/appStore.test.ts` | 100 | E |
| `src/__tests__/useTabManager.test.ts` | 80 | E |
| `src/__tests__/useAgentManager.test.ts` | 80 | E |
| **合計** | **~2,680行** | |

## 4. 既存ファイル変更一覧

| パス | 現行行数 | 変更行数目安 | Phase |
|------|---------|------------|-------|
| `src-tauri/Cargo.toml` | ~30 | +10 (rusqlite, thiserror追加) | B |
| `src-tauri/src/pty/manager.rs` | 175 | +75 (メタデータ, エラー型) | A |
| `src-tauri/src/pty/shell.rs` | 66 | +34 (PowerShell分離, 動的検出) | A |
| `src-tauri/src/agent/claude.rs` | 177 | +73 (--bare, resume, kill_tree) | C |
| `src-tauri/src/ipc/commands.rs` | 469 | +130 (session系コマンド) | B |
| `src-tauri/src/lib.rs` | ~20 | +10 (新モジュール登録) | B |
| `src-tauri/src/main.rs` | ~30 | +15 (DB初期化, SessionManager) | B |
| `src/App.tsx` | 381 | ~50 (トークン置換, a11y) | D,E |
| `src/shared/store/appStore.ts` | 142 | +40 (session state追加) | B |
| `src/shared/hooks/useAgentManager.ts` | 158 | +30 (push型通知, parser統合) | C |
| `src/features/terminal/hooks/useTerminal.ts` | 177 | +20 (テーマ変数同期) | D |
| 各features/*.tsx (15ファイル) | 各100-300 | 各10-20 (トークン置換) | D |

---

## 5. 依存関係グラフ

```
Phase A (テスト基盤)
  │
  ├──► Phase B (セッション管理)
  │       │
  │       └──► Phase E (FE品質)
  │
  └──► Phase C (Agent統合)
          │
          └──► Phase D (UI統一) ◄── Phase Eと並行可能
```

- **A → B,C は順序必須**（テスト基盤がないと品質保証できない）
- **B → E は順序必須**（セッション状態がないとFEテストが書けない）
- **C と D は並行可能**（独立した領域）
- **D と E は並行可能**（UIとテストは独立）

---

## 6. テスト実行方法

### Rust側（ネストPTY自動テスト）

```bash
# 全テスト実行
cd src-tauri && cargo test

# PTYテストのみ
cargo test --test test_pty_basic
cargo test --test test_pty_lifecycle
cargo test --test test_pty_advanced

# セッションテスト
cargo test --test test_session

# Agentテスト（モックエージェント使用）
cargo test --test test_agent

# 特定テスト
cargo test test_pwsh_echo
```

### Frontend側

```bash
# 全テスト
pnpm test

# カバレッジ
pnpm test -- --coverage

# 特定テスト
pnpm test -- --grep "appStore"
```

### E2E（Playwright, Phase E以降）

```bash
# xterm.js描画テスト
pnpm test:e2e

# スクリーンショット比較
pnpm test:e2e -- --update-snapshots
```

---

## 7. 完了条件

### Phase A 完了条件
- [ ] `cargo test` で15テスト全パス
- [ ] PowerShell, CMD, Git Bashの3シェルでスポーン→入出力→クローズが自動テスト通過
- [ ] ゾンビプロセスが残らないことを確認

### Phase B 完了条件
- [ ] SQLite DBが`~/.aether/aether.db`に作成される
- [ ] セッション作成→ウィンドウ追加→ペイン追加→保存→アプリ再起動→復元 の一連が動作
- [ ] `cargo test --test test_session` で10テスト全パス

### Phase C 完了条件
- [ ] モックエージェントを使ったstream-json解析テスト12本全パス
- [ ] Watchdogのパターンマッチが正しく動作
- [ ] `taskkill /T` によるプロセスツリー停止が確認済み

### Phase D 完了条件
- [ ] `git grep "rgba\|#[0-9a-fA-F]\{6\}" src/` の直接色指定が90%以上減少
- [ ] spacingが`var(--space-*)` に統一
- [ ] サイドバー開閉にSpringアニメーション適用

### Phase E 完了条件
- [ ] Vitestテスト30本以上
- [ ] `aria-label` が全インタラクティブ要素に付与
- [ ] Agent pollingがpush型に変更済み

### 最終目標（全Phase完了後の再監査スコア）

| 視点 | 現在 | 目標 |
|------|------|------|
| UIデザイナー | 5 | 18+ |
| FEエンジニア | 4 | 18+ |
| AIプログラマ | 3 | 20+ |
| インフラ | 4 | 16+ |
| **合計** | **16** | **72+** |

---

## 8. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| ConPTYテストがCI環境で動かない | テスト基盤が機能しない | ローカルテスト前提。CIではPTYテストをskip可能にする(`#[cfg(not(ci))]`) |
| rusqliteのbundledビルドが遅い | ビルド時間増加 | `features = ["bundled"]`で初回のみ。キャッシュ後は問題なし |
| stream-jsonフォーマットがClaude CLIバージョンで変わる | パーサー壊れる | モックテスト + バージョン検出 + 緩いパース(unknown fieldは無視) |
| Windows 10でConPTYの挙動が異なる | テスト結果が環境依存 | Win10でのフォールバック動作を明示的にテスト |
| 429レート制限（本日の問題） | 開発速度低下 | 並列エージェント呼び出しを制限。シーケンシャル実行を基本に |

---

## 付録: 既存コードベースの品質負債

Phase実装前に認識しておくべき技術的負債:

| 負債 | 場所 | 重要度 | 対応Phase |
|------|------|--------|----------|
| エラー型がすべて`String` | Rust全体 | 中 | A (thiserror導入) |
| `App.tsx` 381行 | フロントエンド | 中 | D (Zustand移行は済み、レイアウト分離が残る) |
| パスバリデーション不完全 | `commands.rs` | 高 | B (セキュリティ修正) |
| `env_logger`未初期化 | `main.rs` | 低 | B |
| フォント未バンドル | フロントエンド | 低 | D (Geist/Interをローカルバンドル) |
| `outline: none` 多数 | CSS全体 | 中 | E (a11y修正) |
