# Aether Terminal — Edge Feature Integration Plan

> 5プロジェクト（GitButler, Mori, vibe-kanban, animus-cli, VS Code）の
> ベスト機能を統合し、Scapeの完全上位互換 + 独自エッジを実現する。

---

## Phase 0: Git Worktree Deep Integration（最優先 — Scape差分解消）

Scapeとの最大の差分「git worktreeとの深い統合」を埋める。
GitButler + Mori + animus-cli + VS Code の知見を統合。

### 0-1. WorktreeManager（Rust backend）

**参照**: GitButler `crates/gitbutler-watcher/`, Mori worktree-first arch, animus-cli `workspace_guard.rs`

```
src-tauri/src/worktree/
  mod.rs           // WorktreeManager: create/list/remove/switch
  watcher.rs       // ファイル監視（notify crate, 100msバッチ）
  guard.rs         // セキュリティ: cwd がプロジェクトroot or managed worktree内か検証
```

**Tauri Commands:**
```rust
#[tauri::command]
async fn create_worktree(project: &str, branch: &str) -> Result<WorktreeInfo>
// git worktree add .worktrees/<branch> -b <branch>

#[tauri::command]
async fn list_worktrees(project: &str) -> Result<Vec<WorktreeInfo>>
// git worktree list --porcelain をパース

#[tauri::command]
async fn remove_worktree(project: &str, branch: &str) -> Result<()>
// git worktree remove + ブランチ削除オプション

#[tauri::command]
async fn switch_worktree(project: &str, branch: &str) -> Result<WorktreeInfo>
// アクティブworktreeを切替、ターミナルcwdも連動
```

**WorktreeInfo型:**
```rust
struct WorktreeInfo {
    path: PathBuf,
    branch: String,
    is_main: bool,
    head_sha: String,
    status: WorktreeStatus, // Clean / Modified / Conflicted
    linked_session_id: Option<String>,
}
```

### 0-2. セッション ↔ Worktree ライフサイクル連動

**参照**: Scape "End Session & Remove Worktree", Mori session=branch=dir 1:1:1

```
AgentSession に追加:
  worktree?: {
    path: string;
    branch: string;
    createdAt: number;
  }
```

**フロー:**
1. AgentInspector のセッションカードに「Worktree」インライン入力（Scape準拠）
2. ブランチ名入力 → Create → `create_worktree` invoke → ターミナルタブ自動追加（cwd = worktree path）
3. セッション終了時に選択肢: 「End Session」 / 「End Session & Remove Worktree」
4. 右クリックメニューに "Create Worktree", "Switch to Worktree", "Remove Worktree" 追加

### 0-3. Worktree-Scoped Terminal（VS Code方式）

**参照**: VS Code workspace-folder-scoped terminals

- ターミナルタブに worktree ブランチ名バッジ表示
- `addTabWithCwd(shell, worktreePath)` で worktree ディレクトリにスコープ
- WorkspaceTabs に worktree アイコン + ブランチ名表示
- Toolkit もworktree（ブランチ）スコープで切替（Scape準拠）

### 0-4. Real-time File Watcher（GitButler方式）

**参照**: GitButler `crates/gitbutler-watcher/`, `crates/gitbutler-filemonitor/`

```rust
// src-tauri/src/worktree/watcher.rs
// notify crate で .git/ + worktree ディレクトリを監視
// 100ms バッチで集約 → Tauri Event で frontend に通知
// Frontend: useGitStatus hook が listen して自動更新
```

**通知イベント:**
- `worktree:files-changed` → FileTree + git status 自動更新
- `worktree:branch-updated` → ヘッダーのブランチ表示更新
- `worktree:conflict-detected` → 通知バッジ表示

---

## Phase 1: Agent Orchestration 強化

### 1-1. Agent Bridge — セッション間メッセージング（Mori方式）

**参照**: Mori `MoriIPC`, Agent Bridge protocol

```typescript
// src/shared/types/agent.ts に追加
interface AgentMessage {
  from: string;       // session ID
  to: string;         // session ID or "broadcast"
  type: "delegate" | "report" | "coordinate" | "escalate";
  content: string;
  timestamp: number;
}
```

**実装:**
- Tauri backend: セッション間メッセージキュー（in-memory + SQLite永続化）
- Frontend: AgentInspector の Activity タブにメッセージフロー表示
- ターミナル出力に `[mori-bridge]` 的なメタデータタグを検出 → パース → UI反映

### 1-2. Agent Lifecycle Hooks（Mori方式）

**参照**: Mori agent state introspection

```typescript
// ターミナル出力をパースしてエージェント状態を自動検出
// Claude Code の出力パターン:
//   "⏳ Thinking..." → status: thinking
//   "✏️ Editing..." → status: coding  
//   "● Completed" → status: done
//   "❗ Error" → status: error

// useAgentState hook
function useAgentState(terminalOutput: string): AgentStatus
```

- セッションカードのステータスバッジをリアルタイム更新
- ターミナルタブにもステータスアイコン表示（⚡/❗/✅）
- macOS通知 → Windows Toast通知 に変換

### 1-3. Decision Contracts（animus-cli方式）

**参照**: animus-cli `PhaseDecisionContract`

```typescript
interface PhaseDecision {
  verdict: "advance" | "rework" | "skip" | "fail";
  confidence: number;  // 0.0 - 1.0
  risk: "low" | "medium" | "high";
  evidence: string[];
  reworkCount: number;
  maxReworkAttempts: number; // default: 3
}
```

- AgentInspector に「Decision History」タイムライン追加
- 各フェーズの confidence をビジュアルゲージで表示
- rework ループの収束パターンを可視化

### 1-4. Model Routing（animus-cli方式）

**参照**: animus-cli model routing by complexity

```typescript
interface ModelRoute {
  taskType: "architecture" | "feature" | "bugfix" | "docs" | "test";
  complexity: "high" | "medium" | "low";
  model: string;      // "opus" | "sonnet" | "haiku"
  estimatedCost: number;
}

// AgentInspector の "Start Agent" ダイアログに:
// - タスクタイプ選択
// - 推奨モデル自動表示
// - 推定コスト表示
```

---

## Phase 2: KanbanBoard → Agent Workspace Hub（vibe-kanban統合）

### 2-1. Issue → Workspace 直接起動

**参照**: vibe-kanban agent workspace orchestration

**フロー:**
1. Kanban カードの "Start" ボタン → worktree 自動作成
2. ターミナルタブ自動追加（cwd = worktree）
3. Claude Code セッション自動起動（プロンプト = issue description）
4. セッション完了 → カード自動で "Done" 列へ移動

```typescript
// KanbanBoard.tsx
const handleStartWorkspace = async (card: KanbanCard) => {
  // 1. Create worktree
  const wt = await invoke("create_worktree", { 
    project: projectPath, 
    branch: `feat/${card.id}` 
  });
  // 2. Add terminal tab
  addTabWithCwd("powershell", wt.path);
  // 3. Start agent
  const sessionId = await onStartAgent(card.description, selectedModel);
  // 4. Link session to card
  updateCard(card.id, { sessionId, status: "in_progress" });
};
```

### 2-2. Multi-Select Bulk Operations

**参照**: vibe-kanban `useIssueMultiSelect.ts`

- Ctrl+Click で複数カード選択
- Shift+Click で範囲選択
- 選択時にフローティングアクションバー表示:
  - 一括ステータス変更
  - 一括優先度変更
  - 一括削除
  - 一括エージェント起動

### 2-3. Inline Diff Review（vibe-kanban方式）

**参照**: vibe-kanban `ReviewProvider.tsx`, `EditDiffRenderer.tsx`

- Kanban カード展開時に、そのブランチの diff を表示
- 行レベルでコメント追加可能
- レビュー完了 → Done 列へ移動

---

## Phase 3: SCM Panel（VS Code + GitButler ハイブリッド）

### 3-1. Resource Group ファイルビュー

**参照**: VS Code SCM resource groups

```
┌─ Source Control ──────────────────┐
│ ▼ Staged Changes (3)             │
│   ✚ src/App.tsx                   │
│   ✎ src/styles.css               │
│   ✚ src/utils.ts                 │
│ ▼ Changes (5)                    │
│   ✎ README.md                    │
│   ✎ package.json                 │
│   ✚ src/new-feature.ts          │
│   ✚ src/new-feature.test.ts     │
│   ✗ old-file.ts                  │
│ ▼ Untracked (2)                  │
│   ? temp.log                     │
│   ? debug.txt                    │
│ ▼ Merge Conflicts (1)           │
│   ⚠ src/config.ts               │
├──────────────────────────────────┤
│ [Stage All] [Unstage All]        │
│ [Commit Message...         ]     │
│ [Commit] [Commit & Push]         │
└──────────────────────────────────┘
```

### 3-2. Commit Graph / Timeline

**参照**: VS Code timeline, GitButler stack visualization

- ブランチグラフを Canvas or SVG で描画
- stacked branches の親子関係を可視化
- ファイル単位の変更履歴タイムライン

### 3-3. Conflict Resolution UI（GitButler方式）

**参照**: GitButler conflict-friendly rebase

- 3-way merge ビュー（ours / theirs / base）
- コンフリクトファイル一覧 → 任意順序で解決
- "Accept Ours" / "Accept Theirs" / "Manual Edit" ボタン
- Monaco Editor の inline diff で解決

---

## Phase 4: Session Analytics & Events

### 4-1. Per-Session Analytics（Scape差分解消）

**参照**: Scape "View Analytics"

```typescript
interface SessionAnalytics {
  tokensUsed: number;
  tokensLimit: number;
  costBreakdown: { input: number; output: number; total: number };
  filesModified: string[];
  linesAdded: number;
  linesRemoved: number;
  duration: number;
  reworkCycles: number;
  toolCalls: { name: string; count: number }[];
}
```

- AgentInspector の右クリック → "View Analytics" でモーダル表示
- コスト推移グラフ、ファイル変更ヒートマップ

### 4-2. Event Stream（animus-cli方式）

**参照**: animus-cli GraphQL subscriptions, JSONL event log

- Tauri Event Channel でリアルタイムイベント配信
- Activity タブにイベントタイムライン
- フィルタリング: タイプ別、プロジェクト別、セッション別
- イベントログを JSONL で永続化（デバッグ・分析用）

---

## Phase 5: Persistent State（Mori方式）

### 5-1. Session Persistence

**参照**: Mori SQLite persistence + 5s polling

```rust
// src-tauri/src/db/sessions.rs
// SQLite テーブル:
// sessions: id, name, project, branch, worktree_path, status, model, cost, tokens, created_at, updated_at
// session_logs: id, session_id, content, timestamp
// session_events: id, session_id, event_type, data, timestamp
```

- アプリ再起動後にセッション復元
- ターミナルバッファのキャッシュ（IndexedDB）
- LRU キャッシュ（最大10セッション）で高速切替

---

## 実装優先順位

| Priority | Phase | 推定規模 | 依存関係 |
|----------|-------|---------|---------|
| **P0** | 0-1: WorktreeManager (Rust) | ~300行 Rust | なし |
| **P0** | 0-2: Session↔Worktree連動 | ~200行 TS | 0-1 |
| **P0** | 0-3: Worktree-Scoped Terminal | ~100行 TS | 0-1, 0-2 |
| **P1** | 0-4: File Watcher | ~200行 Rust | 0-1 |
| **P1** | 2-1: Kanban→Workspace起動 | ~150行 TS | 0-1, 0-2 |
| **P1** | 1-2: Agent Lifecycle Hooks | ~100行 TS | なし |
| **P2** | 3-1: SCM Resource Groups | ~300行 TS+CSS | 0-4 |
| **P2** | 1-1: Agent Bridge | ~200行 Rust+TS | なし |
| **P2** | 4-1: Session Analytics | ~200行 TS+CSS | なし |
| **P2** | 2-2: Multi-Select Bulk Ops | ~150行 TS | なし |
| **P3** | 1-3: Decision Contracts | ~150行 TS | 1-2 |
| **P3** | 1-4: Model Routing | ~100行 TS | なし |
| **P3** | 3-2: Commit Graph | ~400行 TS+Canvas | 0-4 |
| **P3** | 3-3: Conflict Resolution | ~300行 TS | 3-1 |
| **P3** | 5-1: Session Persistence | ~300行 Rust | なし |
| **P3** | 4-2: Event Stream | ~200行 Rust+TS | 5-1 |
| **P4** | 2-3: Inline Diff Review | ~250行 TS | 3-1 |

---

## アーキテクチャ変更サマリ

### Rust backend 追加モジュール
```
src-tauri/src/
  worktree/          # NEW: WorktreeManager + FileWatcher + Guard
    mod.rs
    watcher.rs
    guard.rs
  bridge/            # NEW: Agent間メッセージング
    mod.rs
  db/
    sessions.rs      # EXTEND: セッション永続化
    events.rs        # NEW: イベントログ
```

### Frontend 追加/変更コンポーネント
```
src/features/
  agent-inspector/
    AgentInspector.tsx      # EXTEND: Worktreeインライン作成, Analytics, Decision Timeline
    SessionAnalytics.tsx    # NEW
    AgentBridge.tsx          # NEW
  kanban/
    KanbanBoard.tsx          # EXTEND: Workspace起動, Multi-select
    BulkActionBar.tsx        # NEW
  scm/                      # NEW: Source Control Panel
    SCMPanel.tsx
    ResourceGroup.tsx
    CommitGraph.tsx
    ConflictResolver.tsx
  terminal/
    TerminalArea.tsx         # EXTEND: Worktreeバッジ, Agent状態アイコン
src/shared/
  types/
    agent.ts                 # EXTEND: AgentMessage, PhaseDecision, SessionAnalytics
    worktree.ts              # NEW
  hooks/
    useWorktree.ts           # NEW
    useAgentState.ts         # NEW
    useAgentBridge.ts        # NEW
    useFileWatcher.ts        # NEW
```
