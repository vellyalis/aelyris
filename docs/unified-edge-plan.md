# Aether Terminal — 統合エッジ計画書

Version: 1.0.0
Date: 2026-04-10
Status: Draft

基づく文書: `docs/reference-analysis.md` (4プロジェクト分析)

---

## 0. 現状サマリ

### 実装済み

| 機能 | 元ネタ | 実装状態 |
|------|--------|---------|
| Agent Inspectorセッションカード | tmux-agent-sidebar | ステータス/コスト/トークン/ログ表示済み |
| Activity Stream (ログ統合) | tmux-agent-sidebar | 全セッションの直近100件表示 |
| SubagentTreeコンポーネント | tmux-agent-sidebar | **コンポーネント存在、データ未接続** |
| Smart Agent Router | ao-cli | Haiku/Sonnet/Opus自動選択 + 予算制御 |
| Kanbanボード | vibe-kanban | 4列+優先度+エージェント起動ボタン |
| DiffViewer (Monaco) | vibe-kanban | side-by-side表示のみ、コメントなし |
| Web Inspector | vibe-kanban | iframe + localhost:3000固定 |
| PR Inspector | GitHub | PR一覧+diff表示+Agent Review起動 |
| send-keys/capture-pane | tmux | 今日実装済み |
| pane_watcher | Aether独自 | トリガー→通知/AI/send-keys |

### 未実装（本計画の対象）

| 機能 | 元ネタ | 優先度 |
|------|--------|--------|
| パーミッションモードバッジ | tmux-agent-sidebar | 高 |
| ポート自動検出 | tmux-agent-sidebar | 高 |
| Task↔Agentリンク | vibe-kanban | 最高 |
| インラインdiffコメント | vibe-kanban | 高 |
| デバイスエミュレーション | vibe-kanban | 低 |
| ワークフローステータスバッジ | Mori | 中 |
| PTYキャッシュ (LRU) | Mori | 中 |
| 環境変数メタデータ注入 | Mori | 高 |
| YAMLワークフロー定義 | ao-cli | 最高 |
| 品質ゲート | ao-cli | 高 |
| スケジューリング | ao-cli | 中 |
| Visual Workflow Builder | Aether独自 | 高 |
| Inline Diff Feedback Loop | Aether独自 | 高 |
| Living Dashboard | Aether独自 | 中 |

---

## 1. フェーズ構成

```
Phase 1: Task-Agent Link (Kanban↔Agent接続)
    ↓
Phase 2: Agent Enrichment (バッジ、メタデータ、ツリー接続)
    ↓
Phase 3: Workflow Engine (YAML定義 + 品質ゲート)
    ↓
Phase 4: Diff Feedback Loop (インラインコメント→Agent修正)
    ↓
Phase 5: Living Dashboard (コスト予測、進捗グラフ)
    ↓
Phase 6: Visual Workflow Builder (GUI)
```

Phase 1,2は順序必須。3-6は2の完了後に独立可能。

---

## 2. Phase 1: Task-Agent Link

### 目的

Kanbanタスクとエージェントセッションを双方向にリンクする。
「タスクを作る→エージェントが自動的にworktreeで作業→完了したらカラム移動」の一連を実現。

### 現状の問題

- KanbanTaskに`assignedAgentId`フィールドはあるが**未使用**
- エージェント起動ボタン(▶)はあるが、起動後のセッションをタスクに紐付けていない
- タスク完了時にKanbanカラムが自動移動しない
- Worktreeとの連携が不完全（`worktreePath`フィールドあるが未設定）

### 実装内容

#### 1-1. エージェント起動時のタスクリンク

**ファイル:** `src/features/kanban/KanbanBoard.tsx`

```typescript
// 現状: タスク.titleをpromptとしてagent起動
onStartAgent?.(task.title);

// 変更: 起動後のsession.idをタスクに紐付け
const sessionId = await onStartAgent?.(task.title);
if (sessionId) {
  updateKanbanTask(task.id, {
    assignedAgentId: sessionId,
    column: "in_progress",
  });
}
```

#### 1-2. セッション完了時のカラム自動移動

**ファイル:** `src/shared/hooks/useAgentManager.ts`

```typescript
// agent-exit イベント受信時
listen(`agent-exit-${id}`, () => {
  // ステータスをdoneに
  setSessions(...);
  // 紐付いたKanbanタスクをreviewに移動
  onAgentComplete?.(id);
});
```

**ファイル:** `src/App.tsx`

```typescript
// useAgentManagerにコールバック追加
// agent完了時にkanbanタスクのカラムをreviewに移動
const handleAgentComplete = (agentId: string) => {
  const task = kanbanTasks.find(t => t.assignedAgentId === agentId);
  if (task) {
    moveKanbanTask(task.id, "review");
  }
};
```

#### 1-3. タスク→Worktree自動作成

エージェント起動時に、タスク名からブランチを切ってworktreeで作業させる。

**ファイル:** `src/App.tsx` or 新規 `src/shared/hooks/useTaskAgent.ts`

```typescript
async function startAgentForTask(task: KanbanTask, projectPath: string) {
  // 1. ブランチ名生成
  const branch = `task/${task.id.replace('task-', '')}`;

  // 2. Worktree作成 (既存IPCコマンド)
  try {
    await invoke("create_worktree", { repoPath: projectPath, branchName: branch });
  } catch { /* already exists */ }

  // 3. タスクにworktree情報を保存
  updateKanbanTask(task.id, { branch, worktreePath: `${projectPath}-${branch}` });

  // 4. そのworktreeのcwdでエージェント起動
  const sessionId = await startAgent(task.title, `${projectPath}-${branch}`, selectedModel);

  // 5. リンク
  updateKanbanTask(task.id, { assignedAgentId: sessionId });

  return sessionId;
}
```

#### 1-4. Agent Inspector↔Kanbanの相互リンク

- Agent Inspectorのセッションカードに「関連タスク」バッジ表示
- Kanbanタスクカードに「エージェントステータス」バッジ表示

**新規コンポーネント:** なし（既存コンポーネントにprops追加）

#### 1-5. テスト

| # | テスト | 方法 |
|---|--------|------|
| 1 | タスク起動→assignedAgentId設定 | Vitest (appStore) |
| 2 | セッション完了→カラムreview移動 | Vitest (appStore) |
| 3 | タスク削除→エージェント停止 | Vitest |
| 4 | 複数タスク並行起動 | Vitest |

### ファイル変更一覧

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src/features/kanban/KanbanBoard.tsx` | 起動時リンク、ステータスバッジ | +30 |
| `src/shared/hooks/useAgentManager.ts` | onAgentComplete コールバック | +15 |
| `src/shared/hooks/useTaskAgent.ts` | **新規** Task-Agent連携ロジック | ~80 |
| `src/App.tsx` | handleAgentComplete統合 | +15 |
| `src/shared/types/kanban.ts` | (変更なし、フィールド既存) | 0 |
| `src/__tests__/taskAgent.test.ts` | **新規** テスト4本 | ~60 |

---

## 3. Phase 2: Agent Enrichment

### 目的

エージェントセッションに「パーミッションモード」「ポート検出」「サブエージェントツリー接続」「環境変数注入」を追加。tmux-agent-sidebarとMoriの強みを取り込む。

### 2-1. パーミッションモードバッジ

Claude Codeのセッションには権限モードがある: `auto-accept`, `plan`, `normal`, `restricted`。これをAgent Inspectorに表示。

**データソース:** Claude CLIの`--output-format stream-json`で`system`イベントに含まれる場合がある。含まれない場合は`--allowedTools`の有無から推定。

**ファイル:** `src/shared/types/agent.ts`

```typescript
interface AgentSession {
  // 既存フィールド...
  permissionMode?: "full" | "edit" | "readonly" | "restricted"; // 追加
}
```

**ファイル:** `src/features/agent-inspector/AgentInspector.tsx`

```tsx
// セッションカードにバッジ追加
{session.permissionMode && (
  <Badge variant={permissionVariant(session.permissionMode)}>
    {session.permissionMode}
  </Badge>
)}
```

### 2-2. ポート自動検出

エージェントがdev serverを起動したら、そのポートを検出してWeb Inspectorに表示。

**方法:** capture-paneの出力を監視し、`localhost:\d+`や`http://127.0.0.1:\d+`パターンを検出。

**ファイル:** `src-tauri/src/watchdog/pane_watcher.rs` に新しいWatchAction追加

```rust
pub enum WatchAction {
    Notify,
    AgentInvestigate { prompt_template: String },
    SendKeys { target_pane: String, keys: String },
    DetectPort,  // 追加: ポートを検出してフロントエンドに通知
}
```

**ファイル:** `src-tauri/src/ipc/commands.rs`

spawn_terminalのストリーミングスレッド内で、出力から`localhost:\d+`を検出したらemit。

```rust
// PTY出力ストリーム内
let port_re = regex::Regex::new(r"(?:localhost|127\.0\.0\.1):(\d{4,5})").unwrap();
if let Some(caps) = port_re.captures(&text) {
    let port: u16 = caps[1].parse().unwrap_or(0);
    if port > 0 {
        let _ = app_handle.emit("port-detected", serde_json::json!({
            "terminal_id": terminal_id,
            "port": port,
        }));
    }
}
```

**ファイル:** `src/features/web-inspector/WebInspector.tsx`

```typescript
// ポート検出イベントをリッスンしてURLを自動更新
listen("port-detected", (event) => {
  setUrl(`http://localhost:${event.payload.port}`);
});
```

### 2-3. SubagentTree接続

SubagentTree.tsxコンポーネントは既に存在する。データを接続する。

**データソース:** Claude Codeのstream-jsonで`subagent`タイプのイベントが来た場合にツリーを構築。

**ファイル:** `src/shared/types/agent.ts`

```typescript
interface AgentSession {
  // 既存...
  parentId?: string;           // 追加: 親エージェントID
  children?: string[];         // 追加: 子エージェントID
}
```

**ファイル:** `src-tauri/src/agent/parser.rs`

StreamEventにsubagent関連フィールド追加（Claude CLIが出力する場合）。

### 2-4. 環境変数メタデータ注入

Moriの`MORI_PROJECT`のように、各PTYに環境変数を注入してエージェントがコンテキストを把握できるようにする。

**ファイル:** `src-tauri/src/pty/manager.rs`

```rust
// spawnメソッドに環境変数を追加
cmd.env("AETHER_TERMINAL_ID", &id);
cmd.env("AETHER_PROJECT", resolved_cwd);
cmd.env("AETHER_SHELL", shell.program());
```

### ファイル変更一覧

| ファイル | 変更内容 | 行数 |
|---------|---------|------|
| `src/shared/types/agent.ts` | permissionMode, parentId, children | +5 |
| `src/features/agent-inspector/AgentInspector.tsx` | パーミッションバッジ、ツリー接続 | +25 |
| `src-tauri/src/ipc/commands.rs` | ポート検出ロジック | +15 |
| `src-tauri/Cargo.toml` | `regex` crate追加 | +1 |
| `src/features/web-inspector/WebInspector.tsx` | ポート自動検出リスナー | +15 |
| `src-tauri/src/pty/manager.rs` | 環境変数注入 | +5 |
| `src-tauri/src/agent/parser.rs` | subagentフィールド | +10 |
| `src-tauri/src/watchdog/pane_watcher.rs` | DetectPort action | +10 |

---

## 4. Phase 3: Workflow Engine

### 目的

ao-cliのYAMLワークフロー定義をAether Terminal内で実行可能にする。
「フェーズ→エージェント→品質ゲート→次フェーズ」のパイプラインを定義・実行。

### 3-1. ワークフロー型定義

**ファイル:** `src-tauri/src/workflow/mod.rs` (新規)

```rust
pub struct Workflow {
    pub name: String,
    pub description: String,
    pub phases: Vec<Phase>,
}

pub struct Phase {
    pub name: String,
    pub agent_config: AgentConfig,
    pub quality_gate: Option<QualityGate>,
    pub depends_on: Vec<String>,  // 他フェーズ名
}

pub struct AgentConfig {
    pub model: String,           // "auto" | "claude-sonnet" | etc
    pub prompt_template: String, // {task_title}, {project_path} 等のプレースホルダ
    pub allowed_tools: Vec<String>,
    pub max_cost: f64,           // コスト上限
    pub timeout_secs: u64,
}

pub struct QualityGate {
    pub gate_type: GateType,
    pub criteria: String,
}

pub enum GateType {
    TestPass,            // テスト全パスが条件
    BuildSuccess,        // ビルド成功が条件
    HumanReview,         // 人間の承認が必要
    AgentReview,         // 別のエージェントがレビュー
    Custom(String),      // カスタムコマンド
}
```

### 3-2. YAMLパーサー

**ファイル:** `src-tauri/src/workflow/parser.rs` (新規)

ワークフロー定義ファイル `.aether/workflows/*.yaml` を読み込む。

```yaml
# .aether/workflows/feature.yaml
name: Feature Implementation
description: 新機能の実装パイプライン

phases:
  - name: plan
    agent:
      model: claude-opus
      prompt: |
        {task_title}の実装計画を立ててください。
        プロジェクト: {project_path}
      max_cost: 0.50
    quality_gate:
      type: human_review

  - name: implement
    depends_on: [plan]
    agent:
      model: claude-sonnet
      prompt: |
        計画に基づいて{task_title}を実装してください。
        TDDで進めること。
      allowed_tools: [Read, Write, Edit, Bash, Grep, Glob]
      max_cost: 2.00
    quality_gate:
      type: test_pass

  - name: review
    depends_on: [implement]
    agent:
      model: claude-opus
      prompt: |
        実装をレビューしてください。
        CRITICAL/HIGHの問題を報告。
      max_cost: 0.50
    quality_gate:
      type: human_review
```

### 3-3. ワークフロー実行エンジン

**ファイル:** `src-tauri/src/workflow/executor.rs` (新規)

```rust
pub struct WorkflowExecutor {
    workflow: Workflow,
    current_phase: usize,
    phase_results: HashMap<String, PhaseResult>,
}

pub struct PhaseResult {
    pub status: PhaseStatus,
    pub agent_session_id: Option<String>,
    pub cost: f64,
    pub output_summary: String,
}

pub enum PhaseStatus {
    Pending,
    Running,
    WaitingGate,   // 品質ゲート待ち
    Passed,
    Failed(String),
}

impl WorkflowExecutor {
    pub fn start(&mut self, agent_manager: &AgentManager) -> Result<(), String>;
    pub fn advance(&mut self) -> Result<(), String>;  // 次フェーズへ
    pub fn approve_gate(&mut self, phase: &str) -> Result<(), String>;
    pub fn reject_gate(&mut self, phase: &str, reason: &str) -> Result<(), String>;
    pub fn status(&self) -> WorkflowStatus;
}
```

### 3-4. IPC + Frontend

**Rust IPCコマンド:**

```rust
#[tauri::command]
fn list_workflows(project_path: &str) -> Vec<WorkflowSummary>;
#[tauri::command]
fn start_workflow(project_path: &str, workflow_name: &str, task_title: &str) -> Result<String, String>;
#[tauri::command]
fn workflow_status(workflow_id: &str) -> WorkflowStatus;
#[tauri::command]
fn approve_gate(workflow_id: &str, phase_name: &str) -> Result<(), String>;
#[tauri::command]
fn reject_gate(workflow_id: &str, phase_name: &str, reason: &str) -> Result<(), String>;
```

**Frontend:**

**ファイル:** `src/features/workflow/WorkflowPanel.tsx` (新規)

- ワークフロー一覧表示
- 実行中のフェーズをステップバーで表示
- 品質ゲートの承認/却下ボタン
- 各フェーズのエージェントセッションへのリンク

### 3-5. Kanban統合

タスク起動時にワークフローを選択可能:

```
タスク ▶ ボタン → ワークフロー選択ダイアログ
  - Quick (直接エージェント起動)
  - Feature Implementation (plan→implement→review)
  - Bug Fix (reproduce→fix→test)
  - カスタムワークフロー
```

### ファイル変更一覧

| ファイル | 行数 |
|---------|------|
| `src-tauri/src/workflow/mod.rs` | ~50 |
| `src-tauri/src/workflow/parser.rs` | ~120 |
| `src-tauri/src/workflow/executor.rs` | ~200 |
| `src-tauri/src/ipc/commands.rs` | +40 |
| `src-tauri/Cargo.toml` | +1 (serde_yaml) |
| `src/features/workflow/WorkflowPanel.tsx` | ~150 |
| `src/features/workflow/WorkflowStepBar.tsx` | ~60 |
| `src/features/kanban/KanbanBoard.tsx` | +20 (ワークフロー選択) |
| `.aether/workflows/feature.yaml` | ~30 (テンプレート) |
| `.aether/workflows/bugfix.yaml` | ~25 (テンプレート) |
| テスト | ~100 |

---

## 5. Phase 4: Inline Diff Feedback Loop

### 目的

DiffViewerでコードの行をクリック→コメント入力→エージェントが即修正。人間↔AIのフィードバック最短化。

### 4-1. DiffViewer拡張

**ファイル:** `src/features/diff-viewer/DiffViewer.tsx`

Monaco Editorの`addGlyphMarginWidget`と`onMouseDown`でコメント機能を追加。

```typescript
// 行クリック → コメント入力ポップアップ
editor.onMouseDown((e) => {
  if (e.target.type === EditorMouseTargetType.GLYPH_MARGIN) {
    const lineNumber = e.target.position?.lineNumber;
    if (lineNumber) {
      showCommentInput(lineNumber);
    }
  }
});

// コメント → エージェントに送信
function submitComment(lineNumber: number, comment: string) {
  const context = getLineContext(lineNumber, 5); // 前後5行
  const prompt = `File: ${fileName}, Line ${lineNumber}\n\nContext:\n${context}\n\nFeedback: ${comment}\n\nPlease fix this issue.`;
  onStartAgent?.(prompt);
}
```

### 4-2. コメントデコレーション

```typescript
interface DiffComment {
  lineNumber: number;
  comment: string;
  status: "pending" | "fixing" | "resolved";
  agentSessionId?: string;
}
```

MonacoのdecorationsAPIで、コメントがある行にアイコン+背景色を表示。

### 4-3. Agent Inspector連携

コメントから起動したエージェントが完了したら:
1. コメントのstatusを`resolved`に
2. 修正後のdiffを自動リロード
3. 未解決コメントがゼロになったら通知

### ファイル変更一覧

| ファイル | 行数 |
|---------|------|
| `src/features/diff-viewer/DiffViewer.tsx` | +100 (コメントUI) |
| `src/features/diff-viewer/DiffComment.tsx` | ~50 (新規) |
| `src/shared/types/diff.ts` | ~20 (新規) |
| テスト | ~40 |

---

## 6. Phase 5: Living Dashboard

### 目的

エージェントのコスト、進捗、リソース使用をリアルタイムダッシュボードで可視化。

### 5-1. コストトラッカー

**ファイル:** `src/features/dashboard/CostTracker.tsx` (新規)

- セッション別コスト棒グラフ
- 累計コスト推移（時系列折れ線グラフ）
- 予算残高ゲージ
- 「このタスクの推定残コスト」表示

データソース: `AgentSession.cost` + `AgentSession.tokensUsed`

### 5-2. 進捗推定

**ファイル:** `src/features/dashboard/ProgressEstimator.tsx` (新規)

- タスク完了度 (Kanbanの列位置から)
- エージェントのツール呼び出し回数からの進捗推定
- 推定完了時間（過去セッションの平均から）

### 5-3. リソースモニター

**ファイル:** `src-tauri/src/ipc/commands.rs`

```rust
#[tauri::command]
fn system_resources() -> SystemResources {
    SystemResources {
        cpu_usage: get_cpu_usage(),
        memory_mb: get_memory_usage(),
        active_processes: count_child_processes(),
    }
}
```

### ファイル変更一覧

| ファイル | 行数 |
|---------|------|
| `src/features/dashboard/CostTracker.tsx` | ~80 |
| `src/features/dashboard/ProgressEstimator.tsx` | ~60 |
| `src/features/dashboard/Dashboard.tsx` | ~50 |
| `src-tauri/src/ipc/commands.rs` | +20 (system_resources) |
| テスト | ~30 |

---

## 7. Phase 6: Visual Workflow Builder

### 目的

ao-cliのYAMLをGUIで視覚的に構築。ノードエディタ形式で
フェーズ→ゲート→次フェーズをドラッグ&ドロップで配置。

### 7-1. ノードエディタ

**ライブラリ候補:** `reactflow` (MITライセンス、ノードベースUI)

**ファイル:** `src/features/workflow/WorkflowBuilder.tsx` (新規)

- フェーズノード: モデル選択、プロンプト入力、コスト上限
- ゲートノード: テスト/ビルド/レビュー/カスタム
- エッジ: フェーズ間の依存関係
- Export: YAML生成

### 7-2. プリセットテンプレート

```
Feature Implementation: plan → implement → review
Bug Fix: reproduce → fix → verify
Refactoring: analyze → refactor → test
Documentation: scan → generate → review
```

### ファイル変更一覧

| ファイル | 行数 |
|---------|------|
| `src/features/workflow/WorkflowBuilder.tsx` | ~200 |
| `src/features/workflow/nodes/PhaseNode.tsx` | ~60 |
| `src/features/workflow/nodes/GateNode.tsx` | ~40 |
| `src/features/workflow/ExportYaml.tsx` | ~50 |
| `package.json` | +1 (reactflow) |
| テスト | ~40 |

---

## 8. 全体ファイル・行数サマリ

| Phase | 新規ファイル | 変更ファイル | 新規行数 | テスト |
|-------|------------|------------|---------|-------|
| 1: Task-Agent Link | 2 | 4 | ~200 | 4本 |
| 2: Agent Enrichment | 0 | 8 | ~100 | 4本 |
| 3: Workflow Engine | 7 | 3 | ~800 | 8本 |
| 4: Diff Feedback | 3 | 1 | ~210 | 4本 |
| 5: Living Dashboard | 3 | 1 | ~240 | 3本 |
| 6: Workflow Builder | 4 | 1 | ~390 | 3本 |
| **合計** | **19** | **18** | **~1,940** | **26本** |

---

## 9. 依存関係グラフ

```
Phase 1 (Task-Agent Link)
    │
    ├──► Phase 2 (Agent Enrichment)
    │       │
    │       ├──► Phase 3 (Workflow Engine)
    │       │       │
    │       │       └──► Phase 6 (Visual Builder) ← Phase 3必須
    │       │
    │       └──► Phase 5 (Living Dashboard) ← Phase 2のデータ必要
    │
    └──► Phase 4 (Diff Feedback) ← Phase 1と独立可能だが2の後が理想
```

---

## 10. 完了時の姿

```
┌─────────────────────────────────────────────────────────────┐
│  Aether Terminal — Unified AI Command Center                │
├────────┬──────────────────────────────┬─────────────────────┤
│        │                              │  Agent Inspector    │
│ Kanban │   Terminal / Editor          │  ┌─────────────┐   │
│ Board  │                              │  │ Session Card │   │
│        │   ┌──────────┬──────────┐    │  │ 🔒 full     │   │
│ ┌────┐ │   │ Pane     │ Pane     │    │  │ 🌐 :3000    │   │
│ │Todo│ │   │ "server" │ "agent"  │    │  │ $0.23 1.2k  │   │
│ │ ▶  │ │   │          │          │    │  └─────────────┘   │
│ │    │ │   │ capture  │ send-keys│    │                     │
│ ├────┤ │   └──────────┴──────────┘    │  Subagent Tree      │
│ │WIP │ │                              │  ├─ Main Agent      │
│ │ ⏳ │ │   ┌─────────────────────┐    │  │  ├─ Planner      │
│ ├────┤ │   │ Diff Viewer         │    │  │  └─ Reviewer     │
│ │Rev │ │   │ 💬 line 42: fix this│    │  │                   │
│ │ 🔍 │ │   │ → Agent fixing...   │    │  Workflow Progress   │
│ ├────┤ │   └─────────────────────┘    │  plan ✅ → impl ⏳  │
│ │Done│ │                              │  → review ⬜ → done │
│ │ ✅ │ │                              │                     │
│ └────┘ │                              │  Cost: $1.23 / $5   │
├────────┴──────────────────────────────┴─────────────────────┤
│  PowerShell │ ⚡main │ 3M │ Workflow: feature.yaml running  │
└─────────────────────────────────────────────────────────────┘
```

これが**tmux-agent-sidebar + vibe-kanban + ao-cli + Mori**の全てを
1つのWindowsネイティブGUIに統合した姿。
