# 02 — 仕様書（アーキテクチャ / 永続化 / スキーマ / 契約）

> 親: [`00_README.md`](00_README.md) ／ 前: [`01_REQUIREMENTS.md`](01_REQUIREMENTS.md) ／ 次: [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md)

## 1. アーキテクチャ層（依存は上→下の一方向のみ）

```
┌─────────────────────────────────────────────┐
│ UI (React)            MCP (api/mcp.rs 50 verb)│  ← 2つの顔
├─────────────────────────────────────────────┤
│ IPC handlers (ipc/*_commands.rs)              │  ← Tauri command 境界
├─────────────────────────────────────────────┤
│ Manager (Mutex所有 / Tauri state)             │  ContextStoreManager, (新)TaskGraphManager
│   ├─ in-memory ホットキャッシュ                 │
│   └─ Repository 経由で永続化（write-through）    │  ← 本Phaseで追加する層
├─────────────────────────────────────────────┤
│ Domain core (純粋ロジック・I/O無し)             │  ContextStore, TaskGraph, EventLog
├─────────────────────────────────────────────┤
│ Persistence (db/) rusqlite                    │  Database / ManagedDb / migrations
└─────────────────────────────────────────────┘
```

**鉄則**: Domain core は I/O を知らない（テスト容易）。永続化は Manager と Domain の**間**に Repository を挟む。Domain coreの既存ロジック（`TaskGraph::recompute_ready` 等）は**一切変更しない**。

## 2. 永続化パターン — write-through repository

```
set/transition 呼び出し
   │
   ▼
Manager（Mutexロック取得）
   │  1. clone/candidate 上で変更を stage（公開状態は未変更）
   │  2. 変更があった時だけ Repository.persist(candidate/diff) を commit
   │  3. commit 成功後だけ in-memory hot cache を publish
   │  4. persist 失敗は Result で上位へ返し、旧 in-memory 状態を保持
   ▼
Repository（db: &Database）
   │  ContextStore: 単一 key の UPSERT / DELETE（差分）
   │  TaskGraph   : グラフ全体スナップショットを1トランザクションで保存（下記注）
   ▼
SQLite（真実）
```

> **P1で確定した書き込み粒度（A4.7で順序是正）**: ContextStore は key 単位の差分 upsert/delete でよい。**TaskGraph は「フルスナップショット保存」を採用**。理由=`TaskManager::run_autonomy_step` が status・crash/rework/timeout カウンタ・branch binding を一括変更するため、差分追跡では「書き漏らしサイト＝silent durability hole」が生まれる。各ミューテーションは clone 上で stage し、全タスクを1トランザクションで保存（`TaskRepo::save_graph`）してから memory へ公開する。no-op の `recompute_ready()` は書かない。

- **メモリ = ホットキャッシュ、SQLite = 真実**。読み取りはメモリから（高速）、書き込みは両方（write-through）。
- **起動時**: `Repository.load_all()` → in-memory を再構築（FR-3）。
- **source of truth の単一性**: 書き込み口は Manager 1つ。IPC/MCPは Manager しか呼ばない（直接DBを触らせない）。

### なぜ event-sourcing でなく write-through か
決定もタスクも「現在状態」が必要十分で、履歴再生は不要。最小の負債で耐久性を得る。イベント履歴が要るEvent Bus(P3)だけ append-only log にする。

### 実装メモ（P1で確定した接続所有）
`ManagedDb` は Tauri に**値で**管理され、36箇所が `State<ManagedDb>` で参照している。Manager に共有させるため全消費者を `Arc<ManagedDb>` へ変えるのは波及が大きいので、**Context Store は同一DBファイルへの専用接続を1本持つ**（`attach_db(Arc<ManagedDb>)`、テストは `:memory:` 共有）。SQLite WAL は複数接続を安全に扱う。`context_decisions` は Context Store のみが書くため、Rust 側 Mutex を跨ぐ整合の問題は出ない。

## 3. SQLiteスキーマ（`db/migrations.rs` に追記、全て `IF NOT EXISTS`）

既存様式（TEXT PK / `datetime('now')`）に揃える。

```sql
-- FR-1: 決定の永続化（ContextStore の BTreeMap<String,String> を平坦化）
CREATE TABLE IF NOT EXISTS context_decisions (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FR-2: タスク本体（Task 構造体を平坦化。enum/Vec は下記方針）
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',  -- TaskStatus snake_case
    owner           TEXT,
    model           TEXT,
    priority        TEXT NOT NULL DEFAULT 'medium',   -- TaskPriority snake_case
    estimate        INTEGER,
    outputs_json    TEXT NOT NULL DEFAULT '[]',       -- Vec<String> as JSON
    source_branch   TEXT,
    target_branch   TEXT,
    crash_attempts  INTEGER NOT NULL DEFAULT 0,
    rework_attempts INTEGER NOT NULL DEFAULT 0,
    timeout_attempts INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0          -- TaskGraph.order を保持
);

-- FR-2: 依存辺（正規化。Vec<String> dependencies）
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dep_id  TEXT NOT NULL,
    PRIMARY KEY (task_id, dep_id)
);

-- FR-4(P3): durable event log（cap撤廃、append-only、購読カーソル可）
CREATE TABLE IF NOT EXISTS agent_events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 単調増加カーソル
    kind       TEXT NOT NULL,
    channel    TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_events_channel ON agent_events(channel, seq);
```

### 設計判断
- `dependencies` は**正規化テーブル**（join可・整合性）。`outputs` は問い合わせ不要なので **JSON列**（過剰正規化を避ける＝負債回避）。
- `sort_order` で `TaskGraph.order`（挿入順＝安定リスト）を復元。
- enum は Rust 側の `serde(rename_all="snake_case")` と一致する文字列で保存（既存の `as_str()` を流用）。

## 4. データ契約（Rust ↔ テーブル）

| Rust | テーブル列 | 変換 |
|------|-----------|------|
| `ContextStore.decisions: BTreeMap<String,String>` | `context_decisions(key,value)` | 行=エントリ。load時 BTreeMap 再構築で順序自動回復 |
| `Task.status: TaskStatus` | `tasks.status TEXT` | `status.as_str()` ↔ `TaskStatus::from_str`（要追加・要テスト） |
| `Task.priority: TaskPriority` | `tasks.priority TEXT` | 同上（snake_case） |
| `Task.dependencies: Vec<String>` | `task_dependencies` | 多対多行 |
| `Task.outputs: Vec<String>` | `tasks.outputs_json` | `serde_json` |
| `TaskGraph.order: Vec<String>` | `tasks.sort_order` | load時 sort_order ASC で復元 |

> **契約のずれ防止**: `TaskStatus`/`TaskPriority` の `as_str()`↔`from_str()` の往復をユニットテストで縛る（round-trip property）。理想は将来 codegen。

## 5. 新規モジュール配置（ドメイン別・小さく）

```
src-tauri/src/persistence/        # 新規: repository 層（domainとdbの橋渡し）
    mod.rs                        #   re-export
    decision_repo.rs              #   FR-1: context_decisions の load/upsert/delete
    task_repo.rs                  #   FR-2: tasks + task_dependencies の load/upsert/transition
    event_repo.rs                 #   FR-4(P3): agent_events の append/since(cursor)
```

- repository は `&Database`（rusqlite Connection ラッパ）を受け取り、**1メソッド=1責務**。
- Manager 側に薄い `db: Option<Arc<ManagedDb>>` を持たせ、`None`（テスト/非永続）でも動く（既存テスト非破壊）。

> **代替案検討**: db/queries.rs に直書きも可能だが、queries.rs が肥大（800行ルール）するため**ドメイン別 persistence/ に分離**。これが粒度的に正解（[`04`](04_DEBT_AND_MODULARITY.md)）。

## 6. エラーモデル

- repository は `Result<T, String>`（既存 `ManagedDb::with` の慣習に合わせる）。
- 永続化失敗の扱い（A4.7で是正）: ContextStore は `Result<Option<DecisionChange>, String>`、TaskGraph は `TaskGraphError::Persistence` で失敗を IPC/MCP/loop driver まで返す。commit 失敗時は staged candidate を捨て、旧 memory state と revision を保持する。ログ出力だけを成功扱いの代替にしない。
- production manager は durable DB が attach されるまで authoritative mutation を拒否する。DB open/load 失敗後の in-memory fallback は補助コマンドのpanic回避に限定し、ContextStore/TaskGraphの成功応答には使用しない。テストの明示的 ephemeral manager だけがDBなし変更を許す。

## 7. Event Bus pub/sub（A4.8 未完了 target contract）

- `agent_events` append-only log は存在するが、process-local pending buffer、query/corrupt-row errorのempty/skip、durable consumer ACK不在が残るため、現状をno-loss/exactly-onceとは主張しない。
- A4.8で effect と同一transactionのoutbox、単調cursor、durable consumer ACK、idempotency key、gap/degraded markerを既存EventBus ownerへ追加する。
- in-memory ring/pendingは直近表示・一時配送用キャッシュに限定し、overflow・query failure・corrupt rowを成功/空配列へ変換しない。

## 8. Supervisor 実体 + C-22（P4 設計・先出し）

- `autonomy.rs` の merge段で、コンフリクト検出時に `Task` を `Failed` 化 → `record_*` 予算を消費 →（枯渇で）`EscalationRaised`。
- `supervisor/mod.rs` に受信ループを実装し、escalation を `agent_events` + 人間通知（toast/IPC）へ。**発火しっぱなしを終わらせる**。
- C-22回帰テスト: コンフリクト注入 → 有限ステップで `Failed`＋escalation を assert。

## 9. エンタープライズ契約（P5・trait のみ）

```rust
// src-tauri/src/governance/mod.rs (新規・契約だけ)
pub trait AccessControl { fn can(&self, actor: &str, action: &str, resource: &str) -> bool; }
pub trait AuditSink     { fn record(&self, ev: &AuditEntry); }
pub trait TenantResolver{ fn tenant_of(&self, actor: &str) -> TenantId; }
// デフォルト: AllowAll / NoopAudit(既存audit.rsに委譲) / SingleTenant
```
Core はこれら trait 越しに呼ぶ。差し替え可能性をテストで担保。**実装本体はスコープ外。**
