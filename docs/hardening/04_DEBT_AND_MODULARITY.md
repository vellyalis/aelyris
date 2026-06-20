# 04 — 負債を作らない/減らす計画（粒度・モジュール・所有・触るな）

> 親: [`00_README.md`](00_README.md) ／ 前: [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md)
>
> **各タスクの着手前にこの粒度ルール、完了時に13観点ゲートを通す。** これが「常に変更しやすい状態」を保つ仕組み。

## 1. 粒度ルール（理想分割）

| 対象 | 上限 | 超えたら |
|------|------|---------|
| 1関数 | 50行 | 抽出（責務で分ける） |
| 1ファイル | 800行（目安200-400） | ドメインで分割 |
| ネスト | 4段 | early return |
| モジュール | 1ドメイン1責務 | 技術種別でなくドメインで切る |

- **MANY SMALL FILES > FEW LARGE FILES**。`db/queries.rs` を肥大させず、永続化は `persistence/` にドメイン別分離（[`02_SPEC.md` §5](02_SPEC.md)）。
- 共通化は「2箇所以上で実際に使う」時だけ。1箇所しか使わないものを共通層に上げない。

## 2. モジュール所有マップ（source of truth）

| 状態/データ | 唯一の所有者 | 書き込み口 | 永続化 |
|------------|------------|-----------|--------|
| 決定 (ADR) | `ContextStoreManager` | Manager.set/remove | `persistence/decision_repo.rs` → `context_decisions` |
| タスクグラフ | （新）`TaskGraphManager` | Manager.add/transition/record_* | `persistence/task_repo.rs` → `tasks`/`task_dependencies` |
| イベント | `EventBus`(manager) | publish | （P3）`persistence/event_repo.rs` → `agent_events` |
| DB接続 | `ManagedDb` (Mutex) | `with(\|db\| ...)` | — |

**禁止**: IPC/MCP ハンドラが Repository や Database を**直接**触ること。必ず Manager 経由（二重所有・FE再合成の排除）。

## 3. 依存方向（一方向を死守）

```
ipc / mcp  →  manager  →  persistence(repo)  →  db
                  ↘  domain core (I/O無し) ↗
```
- domain core（`context_store/mod.rs` の `ContextStore`、`task/graph.rs` の `TaskGraph`）は **db を import しない**。逆流したら設計ミス。

## 4. 13観点ゲート（各タスク完了時にセルフレビュー）

| 観点 | 本Phaseでの具体チェック |
|------|----------------------|
| 重複 | 永続化ロジックがManagerとIPC両方に散らない（repoに一本化） |
| 死コード | 旧 in-memory only パスを残置しない（db=Noneは正規の非永続モードとして明示） |
| 責務の混在 | domain coreにI/Oを混ぜない |
| 所有範囲 | §2マップの通り。書き込み口1つ |
| 過不足な抽象化 | trait地獄にしない。repoは具体型でよい（P5契約のみtrait） |
| 依存方向 | §3一方向 |
| 型・契約 | `as_str`↔`from_str` round-trip テスト。`as`/`\| string`/無検証optional 回避 |
| テスト | `:memory:` でユニット。`db=None` 既存テスト非破壊 |
| エラー/ログ | 永続化失敗はResult伝播＋tracing。silent swallow禁止 |
| 設定/環境差 | `db_path()` は既存。テストは `:memory:` で環境非依存 |
| 非同期/並行 | Mutexクリティカルセクションは短く。await をロック保持中に跨がない |
| パフォーマンス | ContextStore=key差分。TaskGraph=フルスナップショット(数十タスク規模・with_graph_mut逃げ道封じのため意図的)。no-op recompute は書かない。複数writer競合は busy_timeout で待つ |
| セキュリティ境界 | P5 trait で将来の認可点を1箇所に集約 |
| 命名・配置 | `persistence/` 配下、`*_repo.rs`、メソッドは load/upsert/delete で統一 |

## 5. 既存負債（このPhaseで retire するもの）

| ID | 負債 | 解消Phase |
|----|------|----------|
| D-1 | `ContextStore` in-memory揮発 | P1 |
| D-2 | `TaskGraph` in-memory揮発 | P1 |
| D-3 | `EventLog` cap=256 で通知silent drop | P3 |
| C-22 | mergeコンフリクト→永久Running（[memory: project_refactor_audit_2026-06-19]） | P4 |
| D-4 | Supervisor escalation発火しっぱなし（受信実体なし） | P4 |
| D-5 | worktree/branch のhalt時クリーンアップ無し（orphan蓄積） | P4 |

## 6. 触るなリスト（堅牢実証済・回帰させない）

[memory: project_cockpit_readiness_audit] でmutation testingまで通った binding 済みロジック。**振る舞いを変えない**。永続化は「包む」だけ：

- `agent/claude.rs` `reap()` / `reap_timed_out()`（completion/hang検知・テスト完備）
- `task/graph.rs` の `recompute_ready` / `transition` / `can_transition` / 3軸独立カウンタ
- `orchestrator/mod.rs` planner（priority/budget cap）
- `orchestrator/autonomy.rs` の crash/rework/timeout 予算分離
- `cost/mod.rs` 多軸予算

> これらに永続化を足す時は **ロジック本体を編集せず、呼び出し側Managerでrepoを呼ぶ**。diffがロジックファイルに入りそうなら設計を疑う。

## 7. リファクタの安全手順（純粋move/挙動不変の死守）

1. 変更前に該当の既存テストを確認（緑であること）。
2. RED: 新挙動のテストを足す（永続化往復など）。
3. GREEN: 最小実装。domain coreは触らない。
4. 全ゲート緑（cargo/clippy/fmt、FE触れたらtsc/vitest、cargoと直列）。
5. 13観点セルフレビュー（§4）。
6. 1目的=1コミット。

## 8. 「読んでいないコードは変更するな」適用

各タスクで編集対象ファイルを**必ずRead**してから着手。本ドキュメントのファイルパスは2026-06-20時点。着手時にズレていたら docs を先に直す（docも負債にしない）。
