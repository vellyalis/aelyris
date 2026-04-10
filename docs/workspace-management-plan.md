# Aether Terminal — ワークスペース管理計画書

Version: 1.0.0
Date: 2026-04-10
Status: Draft

---

## 0. 目的

tmuxの最大の強みである**「複数ペインを一つの論理的な作業空間として管理し、ペイン間で干渉できる」**機能を、Aether Terminal上でWindows+AI統合の文脈で再発明する。

単なるtmux模倣ではなく、**AIエージェントがペイン出力を読み、他ペインに入力し、判断する**という上位体験を目指す。

---

## 1. 現状分析

### 1.1 今あるもの

| 概念 | tmux | Aether Terminal | 実装場所 |
|------|------|----------------|---------|
| Session | `tmux new -s work` | SQLite sessions テーブル | `db/queries.rs`, `session/manager.rs` |
| Window (タブ) | `Ctrl-b c` | useTabManager | `hooks/useTabManager.ts` |
| Pane (分割) | `Ctrl-b %` | TerminalPane (60/40固定) | `TerminalPane.tsx` |
| PTY管理 | サーバープロセス | PtyManager (HashMap) | `pty/manager.rs` |

### 1.2 ないもの（本計画で実装）

| 機能 | tmuxコマンド | 重要度 | 難易度 |
|------|-------------|--------|--------|
| **send-keys** | `tmux send-keys -t pane_id "cmd" Enter` | 最高 | 低 |
| **capture-pane** | `tmux capture-pane -t pane_id -p` | 最高 | 中 |
| **synchronize-panes** | `setw synchronize-panes on` | 高 | 低 |
| **ペイン名前付け** | `select-pane -T "name"` | 中 | 低 |
| **自由分割** | `split-window -h/-v` | 高 | 中 |
| **レイアウトプリセット** | `select-layout even-horizontal` | 中 | 中 |
| **pane-to-window** | `break-pane` / `join-pane` | 低 | 高 |
| **AI capture-and-act** | （tmuxにはない） | 最高 | 高 |

---

## 2. アーキテクチャ

### 2.1 ペインID体系

現状の問題: TerminalAreaは自分のterminal_idを外部に公開していない。`connectPty`内でローカル変数として消費される。

**修正方針:** terminal_idをReact stateとして保持し、親コンポーネントに公開する。

```
App
  └── TerminalPane
        ├── TerminalArea (terminal_id: "abc-123")  ← IDを上位に公開
        └── TerminalArea (terminal_id: "def-456")
```

### 2.2 PaneRegistryの導入（Rust側）

全ペインのIDと名前を一元管理するレジストリ。send-keys/capture-paneの宛先解決に使う。

```rust
pub struct PaneRegistry {
    panes: Arc<Mutex<HashMap<String, PaneInfo>>>,
}

pub struct PaneInfo {
    pub terminal_id: String,
    pub name: String,              // ユーザー定義名 ("server", "logs" 等)
    pub shell_type: ShellType,
    pub cwd: String,
    pub output_buffer: VecDeque<String>,  // capture-pane用の出力リングバッファ
}
```

### 2.3 出力バッファ（capture-pane基盤）

現状のデータフロー:
```
PTY stdout → base64 encode → emit("pty-output-{id}") → xterm.js
```

capture-pane対応:
```
PTY stdout → base64 encode → ①output_bufferに蓄積 + ②emit → xterm.js
```

リングバッファで直近N行（デフォルト1000行）を保持。Rust側で蓄積するので、FE側のxterm.jsに依存しない。

---

## 3. 実装フェーズ

### Phase 1: send-keys（他ペインに入力を送る）

**最もインパクトが大きく、最も簡単。**

#### 1-1. Rust IPCコマンド追加

```rust
/// Send keystrokes to a specific terminal
#[tauri::command]
fn send_keys(terminal_id: &str, data: &str) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.write(terminal_id, data.as_bytes())
}

/// Send keystrokes to all active terminals (synchronize-panes)
#[tauri::command]
fn broadcast_keys(data: &str) -> Result<u32, String> {
    let pty_manager = app.state::<PtyManager>();
    let ids = pty_manager.list();
    let mut count = 0;
    for id in &ids {
        if pty_manager.write(id, data.as_bytes()).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}
```

**テスト:**
```rust
#[test]
fn test_send_keys() {
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).unwrap();
    // Send keys to the terminal
    mgr.write(&id, b"echo sent_via_api\r\n").unwrap();
    // Read output and verify
    // ... (pty_harness pattern)
}
```

#### 1-2. FE: CommandPalette統合

```
Ctrl+Shift+P → "Send Keys to..." → ペイン選択 → 入力内容
```

#### 1-3. FE: terminal_id公開

`TerminalArea`がterminal_idをコールバック/refで親に通知する。

```typescript
interface TerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  onTerminalReady?: (terminalId: string) => void;  // 追加
}
```

**新規・変更ファイル:**

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/ipc/commands.rs` | `send_keys`, `broadcast_keys` 追加 | +20 |
| `src-tauri/src/lib.rs` | invoke_handler登録 | +2 |
| `src-tauri/tests/test_pty_advanced.rs` | send_keysテスト | +20 |
| `src/features/terminal/TerminalArea.tsx` | `onTerminalReady` prop | +5 |
| `src/features/terminal/TerminalPane.tsx` | terminal_id管理 | +15 |

---

### Phase 2: capture-pane（ペイン出力を取得する）

**AIがターミナルの状態を理解するための基盤。**

#### 2-1. Rust: 出力バッファ追加

`spawn_terminal`のストリームスレッド内で、出力をリングバッファに蓄積する。

```rust
// pty/manager.rs に追加
pub struct OutputBuffer {
    lines: VecDeque<String>,
    max_lines: usize,
}

impl OutputBuffer {
    pub fn new(max_lines: usize) -> Self {
        Self { lines: VecDeque::with_capacity(max_lines), max_lines }
    }

    pub fn push(&mut self, line: &str) {
        if self.lines.len() >= self.max_lines {
            self.lines.pop_front();
        }
        self.lines.push_back(line.to_string());
    }

    /// Get last N lines
    pub fn tail(&self, n: usize) -> Vec<String> {
        self.lines.iter().rev().take(n).rev().cloned().collect()
    }

    /// Get all buffered content as one string
    pub fn content(&self) -> String {
        self.lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}
```

#### 2-2. IPCコマンド

```rust
/// Capture recent output from a terminal pane
#[tauri::command]
fn capture_pane(terminal_id: &str, lines: Option<usize>) -> Result<String, String> {
    let pty_manager = app.state::<PtyManager>();
    let n = lines.unwrap_or(50);
    pty_manager.capture(terminal_id, n)
}
```

#### 2-3. 出力蓄積の実装場所

`commands.rs`の`spawn_terminal`内に既にストリーミングスレッドがある:

```rust
// 現状: emit only
let _ = app_handle.emit(&event_name, &encoded);

// 変更: emit + buffer
let _ = app_handle.emit(&event_name, &encoded);
output_buffer.lock().unwrap().push(&raw_text);
```

**課題:** 出力はbase64エンコード済みバイナリ。ANSIエスケープシーケンスを含む。capture-paneで返す際に:
- **raw mode**: エスケープシーケンス込みで返す（AIが解析する場合に有用）
- **clean mode**: エスケープシーケンスを除去してプレーンテキストで返す（人間が読む場合）

両方をパラメータで切り替え可能にする。

```rust
#[tauri::command]
fn capture_pane(
    terminal_id: &str,
    lines: Option<usize>,
    strip_ansi: Option<bool>,  // true=プレーンテキスト, false=生出力
) -> Result<String, String>
```

ANSIストリップは `strip-ansi-escapes` crateで簡単に実装できる。

**テスト:**
```rust
#[test]
fn test_capture_pane() {
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).unwrap();
    mgr.write(&id, b"echo capture_test_123\r\n").unwrap();
    std::thread::sleep(Duration::from_millis(500));
    let output = mgr.capture(&id, 10).unwrap();
    assert!(output.contains("capture_test_123"));
}
```

**新規・変更ファイル:**

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/pty/buffer.rs` | OutputBuffer実装 | ~60 |
| `src-tauri/src/pty/mod.rs` | bufferモジュール追加 | +2 |
| `src-tauri/src/pty/manager.rs` | OutputBuffer統合, capture() | +30 |
| `src-tauri/src/ipc/commands.rs` | `capture_pane` 追加、蓄積ロジック | +30 |
| `src-tauri/Cargo.toml` | `strip-ansi-escapes` 追加 | +1 |
| `src-tauri/tests/test_pty_advanced.rs` | capture テスト | +30 |

---

### Phase 3: synchronize-panes（全ペイン同時入力）

#### 3-1. Rust側

Phase 1の`broadcast_keys`で実装済み。

#### 3-2. FE: UIトグル

```
TerminalInfoBar に [Sync] ボタン追加
  ON → 入力がすべてのアクティブペインに送信される
  OFF → 通常モード（対象ペインのみ）
```

```typescript
// TerminalArea.tsx 変更
term.onData((data) => {
  if (syncMode) {
    invoke("broadcast_keys", { data });
  } else {
    invoke("write_terminal", { id, data });
  }
});
```

**新規・変更ファイル:**

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src/features/terminal/TerminalArea.tsx` | syncMode prop追加 | +10 |
| `src/features/terminal/TerminalInfoBar.tsx` | Syncボタン | +15 |
| `src/features/terminal/TerminalPane.tsx` | syncMode state管理 | +10 |

---

### Phase 4: ペイン名前付け + 自由分割

#### 4-1. ペイン名前

```rust
// PaneRegistryに名前設定
#[tauri::command]
fn rename_pane(terminal_id: &str, name: &str) -> Result<(), String>;

// 名前でsend-keys
#[tauri::command]
fn send_keys_by_name(name: &str, data: &str) -> Result<(), String>;
```

#### 4-2. 自由分割

現状: TerminalPaneが60/40固定で2ペイン。

目標: ユーザーが任意のタイミングで水平/垂直分割できる。

```typescript
// ペインツリー構造
type PaneTree =
  | { type: "terminal"; id: string; shell: ShellType; cwd?: string }
  | { type: "split"; direction: "h" | "v"; ratio: number; first: PaneTree; second: PaneTree };
```

再帰的にレンダリング:

```typescript
function renderPaneTree(node: PaneTree): React.ReactNode {
  if (node.type === "terminal") {
    return <TerminalArea shell={node.shell} cwd={node.cwd} />;
  }
  return (
    <SplitPane
      direction={node.direction === "h" ? "horizontal" : "vertical"}
      defaultRatio={node.ratio}
      first={renderPaneTree(node.first)}
      second={renderPaneTree(node.second)}
    />
  );
}
```

**新規・変更ファイル:**

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/pty/registry.rs` | PaneRegistry実装 | ~80 |
| `src-tauri/src/ipc/commands.rs` | `rename_pane`, `send_keys_by_name` | +20 |
| `src/features/terminal/TerminalPane.tsx` | PaneTree再帰レンダリング | ~100 (全面書き直し) |
| `src/features/terminal/PaneTree.tsx` | ペインツリーコンポーネント | ~80 (新規) |

---

### Phase 5: AI capture-and-act（tmuxにない機能）

**Aether Terminal独自の最大の差別化ポイント。**

AIエージェントが:
1. **capture-pane**でターミナル出力を読む
2. 出力を解析（ビルドエラー？テスト失敗？サーバーログ？）
3. 判断に基づいて**send-keys**で別ペインにコマンドを送る

#### 5-1. Agent用IPCコマンド

```rust
/// AI agent reads pane output, decides action, sends keys to target
#[tauri::command]
fn agent_observe_and_act(
    source_pane: &str,     // 監視対象ペイン
    target_pane: &str,     // アクション送信先ペイン
    prompt_context: &str,  // AIへの追加コンテキスト
) -> Result<String, String>
```

#### 5-2. Watchdog連携

既存のWatchdogルールを拡張:

```json
{
  "enabled": true,
  "auto_approve": [...],
  "pane_watchers": [
    {
      "source_pane": "server",
      "trigger": "Error|Exception|FATAL",
      "action": "capture_and_notify",
      "target_agent": true
    }
  ]
}
```

`pane_watchers`はOutputBufferを監視し、正規表現にマッチしたら:
- Agent Inspectorに通知
- オプションでClaude Codeエージェントを起動してエラー解析

#### 5-3. ユースケース

```
[Pane "server"]  npm run dev → Error: Cannot find module './config'
        ↓ (capture-pane で検出)
[Watchdog]  エラー検出 → Agent起動
        ↓
[Agent]  capture-pane("server") → エラーを読む → ファイル確認 → 修正
        ↓ (send-keys で修正確認)
[Pane "server"]  自動リスタート → 正常動作
```

**新規ファイル:**

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/watchdog/pane_watcher.rs` | OutputBuffer監視 + トリガー評価 | ~120 |
| `src-tauri/src/ipc/commands.rs` | `agent_observe_and_act` | +30 |
| `src/features/watchdog/PaneWatcherConfig.tsx` | 監視ルール設定UI | ~80 |

---

## 4. 依存関係

```
Phase 1 (send-keys)  ← 独立。今すぐ着手可能
    │
Phase 2 (capture-pane)  ← Phase 1完了後
    │
    ├── Phase 3 (synchronize-panes)  ← Phase 1のみ依存
    │
    ├── Phase 4 (名前付け + 自由分割)  ← Phase 1,2完了後
    │
    └── Phase 5 (AI capture-and-act)  ← Phase 2必須
```

Phase 1→2 は順序必須。3,4,5 は2完了後に並行可能。

---

## 5. 新規ファイル一覧

| パス | 行数 | Phase |
|------|------|-------|
| `src-tauri/src/pty/buffer.rs` | ~60 | 2 |
| `src-tauri/src/pty/registry.rs` | ~80 | 4 |
| `src-tauri/src/watchdog/pane_watcher.rs` | ~120 | 5 |
| `src/features/terminal/PaneTree.tsx` | ~80 | 4 |
| `src/features/watchdog/PaneWatcherConfig.tsx` | ~80 | 5 |
| **合計** | **~420行** | |

## 6. 既存ファイル変更一覧

| パス | 変更行数 | Phase |
|------|---------|-------|
| `src-tauri/src/ipc/commands.rs` | +100 | 1-5 |
| `src-tauri/src/pty/manager.rs` | +30 | 2 |
| `src-tauri/src/pty/mod.rs` | +4 | 2,4 |
| `src-tauri/src/lib.rs` | +6 | 1-4 |
| `src-tauri/Cargo.toml` | +1 | 2 |
| `src-tauri/tests/test_pty_advanced.rs` | +50 | 1,2 |
| `src/features/terminal/TerminalArea.tsx` | +15 | 1,3 |
| `src/features/terminal/TerminalPane.tsx` | +100 (書き直し) | 4 |
| `src/features/terminal/TerminalInfoBar.tsx` | +15 | 3 |
| **合計** | **~320行** | |

---

## 7. テスト計画

| # | テスト | Phase | 方法 |
|---|--------|-------|------|
| 1 | send_keys: 別ペインに入力→出力確認 | 1 | ネストPTY |
| 2 | send_keys: 存在しないIDにエラー | 1 | ネストPTY |
| 3 | broadcast_keys: 3ペインに同時送信 | 1 | ネストPTY |
| 4 | capture_pane: コマンド実行→出力取得 | 2 | ネストPTY |
| 5 | capture_pane: ANSIストリップ | 2 | ユニットテスト |
| 6 | capture_pane: バッファ上限超過 | 2 | ユニットテスト |
| 7 | capture_pane: 空出力 | 2 | ネストPTY |
| 8 | rename_pane + send_keys_by_name | 4 | ネストPTY |
| 9 | PaneTree再帰分割レンダリング | 4 | Vitest |
| 10 | pane_watcher: トリガー検出 | 5 | ユニットテスト |

---

## 8. 完了条件

### Phase 1
- [ ] `send_keys` IPCコマンドが動作
- [ ] `broadcast_keys` IPCコマンドが動作
- [ ] TerminalAreaがterminal_idを親に通知
- [ ] テスト3本パス

### Phase 2
- [ ] OutputBufferが出力を蓄積
- [ ] `capture_pane` IPCコマンドで直近N行取得可能
- [ ] ANSIストリップが動作
- [ ] テスト4本パス

### Phase 3
- [ ] TerminalInfoBarにSyncボタン
- [ ] 全ペインに同時入力可能

### Phase 4
- [ ] ペインに名前を付けられる
- [ ] 任意タイミングで水平/垂直分割できる
- [ ] PaneTreeが再帰的にレンダリング

### Phase 5
- [ ] pane_watcherが出力をリアルタイム監視
- [ ] 正規表現トリガーでAgent Inspectorに通知
- [ ] capture-pane→AI解析→send-keysの一連が動作

---

## 9. tmux機能対照表（最終形）

| tmux | Aether Terminal (実装後) | 上位互換 |
|------|------------------------|---------|
| `send-keys -t pane` | `invoke("send_keys", {id, data})` | 同等 |
| `capture-pane -p` | `invoke("capture_pane", {id, lines})` | ANSIストリップ付き |
| `synchronize-panes` | `invoke("broadcast_keys", {data})` | UIトグル付き |
| `select-pane -T name` | `invoke("rename_pane", {id, name})` | 同等 |
| `split-window -h/-v` | PaneTree再帰分割 | ドラッグ＆ドロップ |
| `break-pane` / `join-pane` | 未実装 | Phase 4+で検討 |
| **（tmuxにない）** | AI capture-and-act | **Aether独自** |
| **（tmuxにない）** | Watchdog pane_watcher | **Aether独自** |
