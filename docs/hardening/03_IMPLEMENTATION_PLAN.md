# 03 — 詳細実装計画（Phase別・TDD・ゲート）

> **STATUS (2026-07-02): program completed June 2026 (see [00_README.md](00_README.md) tracker); the ⬜ checkboxes below were never back-filled and do not indicate open work.**

> 親: [`00_README.md`](00_README.md) ／ 前: [`02_SPEC.md`](02_SPEC.md) ／ 次: [`04_DEBT_AND_MODULARITY.md`](04_DEBT_AND_MODULARITY.md)
>
> 各タスクは **RED（テスト先行）→ GREEN（最小実装）→ ゲート緑** の順。完了で `⬜→✅`＋コミット。
> 全ゲート: `cargo test` / `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check`（FE触れたら `tsc --noEmit` / `pnpm test`、cargoと**直列**）。

---

## Phase 1 — 永続化（最優先・FR-1/2/3）

> 目的: 再起動で `ContextStore` と `TaskGraph` が消えない。挙動は不変（非永続テストは全て緑のまま）。

### P1-1 ⬜ スキーマ migration
- **ファイル**: `src-tauri/src/db/migrations.rs`（`run_migrations` の execute_batch に追記）
- **変更**: [`02_SPEC.md` §3](02_SPEC.md) の `context_decisions` / `tasks` / `task_dependencies` を追加（`agent_events` はP3で追加可、ここで入れても可）。
- **テスト(RED)**: `:memory:` で `run_migrations` 後、各テーブルに INSERT/SELECT できる（`db/migrations.rs` test）。
- **ゲート**: cargo test / clippy / fmt。
- **粒度**: ~30行。単一責務。

### P1-2 ⬜ DecisionRepo（context_store 永続化）
- **新規ファイル**: `src-tauri/src/persistence/{mod.rs,decision_repo.rs}`
- **API**:
  - `DecisionRepo::load_all(db) -> Result<BTreeMap<String,String>, String>`
  - `DecisionRepo::upsert(db, key, value) -> Result<(), String>`
  - `DecisionRepo::delete(db, key) -> Result<(), String>`
- **配線**: `ContextStoreManager` に `db: Option<Arc<ManagedDb>>` を追加。`set`→`upsert`、`remove`→`delete`（**変更があった時=戻り値Someの時だけ**永続化）。`db=None` では従来通り（既存テスト非破壊）。
- **テスト(RED)**:
  - repo単体: upsert→load_all が往復一致、delete で消える（`:memory:`）。
  - manager: `db=Some` で set→新Manager.load→get一致（再起動シミュレーション）。
  - **既存テスト非破壊**: `db=None` の既存4テストが緑。
- **ファイル**: `manager.rs` 改修は ~20行追加。`decision_repo.rs` ~60行。
- **観点チェック**(04): 二重所有なし（書き込み口はManagerのみ）/ silent swallow なし（Result伝播）。

### P1-3 ⬜ TaskRepo（task_graph 永続化）
- **新規ファイル**: `src-tauri/src/persistence/task_repo.rs`
- **前提追加（実装で判明）**: `TaskStatus::from_str` は **既に存在**（status.rs、round-trip テスト済）。追加が要るのは `TaskPriority` の `as_str` + `FromStr` のみ（graph.rs、round-trip テスト追加）。
- **API（実装で確定）**:
  - `TaskRepo::load_graph(db) -> Result<TaskGraph, String>`（sort_order ASC で order 復元、依存は rowid 順、status は from_str で復元＝**recompute しない**）
  - `TaskRepo::save_graph(db, &TaskGraph) -> Result<(), String>`（**全タスク+依存を1トランザクションでフル upsert**。`unchecked_transaction` で `&Database` のまま原子的に）
- **配線（実装で確定）**: **新 Manager は作らない**。既存 `task/manager.rs` `TaskManager`（`Mutex<TaskGraph>`）に `db: Mutex<Option<Arc<ManagedDb>>>` を追加し、`create`/`transition`/`recompute_ready`/`with_graph_mut` の**各ミューテーション後に `save_graph`（フルスナップショット）**。これにより `with_graph_mut`（autonomy の不透明変更）の書き漏らしを構造的に排除。
- **テスト(RED)**:
  - repo: 3タスク(1依存)を save_graph→load_graph で構造・status・attempts・order・branch 完全一致。
  - manager: transition→再load で status 保持。**`with_graph_mut` 経由の record_crash→再load で crash_attempts 保持**。
- **注意**: `TaskGraph` のドメインロジック（recompute_ready等）は**変更しない**。Manager が薄く包むだけ。
- **粒度**: `task_repo.rs` ~230行（RawTask + save + load + tests）。800行ルール内。

### P1-4 ⬜ 起動時復元 + lib.rs 配線
- **ファイル**: `src-tauri/src/lib.rs`（setup の DB 初期化直後）
- **変更**: 各 Manager に**同一DBファイルへの専用接続**を `attach_db` で渡し、`load_*` で in-memory を再構築（[`02_SPEC.md` 実装メモ](02_SPEC.md)）。
- **エラー方針（実装で確定）**: load失敗は**loud な error ログ＋in-memory継続（soft-fail）**。デスクトップアプリを丸ごと止めない。重要: 失敗時は `attach_db` が Err を返し **db を attach しない**ので、以後のミューテーションは永続化されず、壊れた可能性のあるDBを**上書きしない**（安全）。
- **テスト**: lib.rs は実機寄りなので、復元ロジック本体は P1-2/P1-3 のユニットでカバー済。ここは配線。
- **観点チェック**: infra without wiring 禁止 → MCP `aelyris.context.*` / `aelyris.task.*` が新Manager経由で永続化されることを1つ結合テスト。

### P1-5 ⬜ 実機検証（耐久性の証明）
- **手順**: `pnpm tauri dev` → 指揮役で context.set + task数件をRunningへ → プロセス kill → 再起動 → context/task が復元されていることを確認（CDPまたはMCP `aelyris.context.all` / `aelyris.task.list`）。
- **記録**: 結果を [`00_README.md`](00_README.md) ステータストラッカーと memory `project_visible_pane_integration_handoff.md` に追記。
- **完了条件**: FR-1/2/3 の受入条件すべてPASS。

**Phase 1 完了ゲート**: cargo813+α 緑 / clippy / fmt / 実機 再起動復元PASS / 既存挙動不変。

---

## Phase 2 — 実LLM 1本通し ハードニング（FR背景リスク解消）

> 目的: Coreを実LLMで殴って取りこぼしを炙り出す。`scripts/conduct-build.mjs`（d660a62で最小実証済）を土台に。

- P2-1 ⬜ 3 worker・2依存の中規模ビルドを実LLMで1本通し（worktree分離→Reviewer→main merge）。
- P2-2 ⬜ 走行中に観測した「取りこぼし/詰まり」を **再現テスト** に落とす（Event取りこぼし・mergeコンフリクト等 → P3/P4のRED）。
- P2-3 ⬜ 永続化(P1)が実走でロック競合/スループット劣化を起こさないか計測。問題あれば短クリティカルセクション化。

---

## Phase 3 — Event Bus 無損失化（FR-4）

- P3-1 ⬜ `agent_events` migration（[`02_SPEC.md` §3](02_SPEC.md)）＋ `EventRepo::append/since(seq)`。
- P3-2 ⬜ `event_bus/manager.rs` を durable log 主・ring従に。`recent`/`by_channel` は `since` ベースへ。
- P3-3 ⬜ 256件超でも全件保持・購読カーソル欠番なしを assert（FR-4受入）。
- P3-4 ⬜ （任意）tokio broadcast で真のpush。ポーリング購読は後方互換で残す。
- P3-5 ⬜ MCP `aelyris.event.*` を since カーソル対応に（infra wiring）。

---

## Phase 4 — Supervisor 実体 + C-22（FR-5）

- P4-1 ⬜ C-22回帰テスト先行（RED）: `autonomy.rs` の merge段にコンフリクト注入→現状は永久Running を**赤で固定**。
- P4-2 ⬜ コンフリクト → `Failed`＋`record_*`消費＋`EscalationRaised`（有限ステップ収束）。
- P4-3 ⬜ `supervisor/mod.rs` に escalation 受信ループ実体（`agent_events` 記録＋人間通知IPC）。
- P4-4 ⬜ worktree/branch の loop halt 時クリーンアップ（orphan蓄積防止）。
- P4-5 ⬜ controller 自身のcrash時の再開（最低限: 永続化済みP1状態から resume）。

---

## Phase 5 — エンタープライズ契約（contract-only）

- P5-1 ⬜ `governance/mod.rs` に `AccessControl`/`AuditSink`/`TenantResolver` trait＋デフォルト実装（[`02_SPEC.md` §9](02_SPEC.md)）。
- P5-2 ⬜ Core の MCP 入口（`api/mcp.rs`）を trait 越し呼び出しに（デフォルトはallow-all/既存audit委譲で挙動不変）。
- P5-3 ⬜ 差し替えテスト: deny実装を注入→拒否される、を1つ。**本体実装は別プロジェクト送り**。

---

## 進め方の原則（再掲）
- 1タスク=1コミット=1目的。複数の無関係変更を混ぜない。
- 各タスク着手前に [`04_DEBT_AND_MODULARITY.md`](04_DEBT_AND_MODULARITY.md) 粒度ルール＋13観点を確認。
- 迷ったら **メモリ=キャッシュ / SQLite=真実 / 書き込み口はManager1つ** に立ち返る。
