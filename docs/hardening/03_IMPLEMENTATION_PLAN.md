# 03 — 詳細実装計画（Phase別・TDD・ゲート）

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
- **前提追加**: `TaskStatus` / `TaskPriority` に `from_str(&str)->Option<Self>` を追加（`as_str` の逆）。**round-trip テスト**で縛る（[`02_SPEC.md` §4](02_SPEC.md)）。
  - ファイル: `src-tauri/src/task/status.rs`（status）、`task/graph.rs`（priority）。
- **API**:
  - `TaskRepo::load_graph(db) -> Result<TaskGraph, String>`（sort_order ASC で order 復元、依存テーブル結合）
  - `TaskRepo::upsert_task(db, &Task, sort_order) -> Result<(), String>`
  - `TaskRepo::replace_dependencies(db, task_id, &[String]) -> Result<(), String>`
- **配線**: **新 `TaskGraphManager`**（`Mutex<TaskGraph>` + `db: Option`）を `task/manager.rs` に新設。現在 `TaskGraph` を直接 Tauri state にしている箇所（`ipc/task_commands.rs`, `orchestrator/*`）を Manager 経由へ寄せる。
  - add/transition/record_* の各変更後に該当タスクを upsert（差分のみ）。
- **テスト(RED)**:
  - repo: 3タスク(1依存)を upsert→load_graph で構造・status・attempts・order 完全一致。
  - manager: transition→再load で status 保持。record_crash→再load で crash_attempts 保持。
- **注意**: `TaskGraph` のドメインロジック（recompute_ready等）は**変更しない**。Manager が薄く包むだけ。
- **粒度**: `task_repo.rs` ~120行 → 超えそうなら load/upsert/deps で分割。

### P1-4 ⬜ 起動時復元 + lib.rs 配線
- **ファイル**: `src-tauri/src/lib.rs`（setup で Manager 構築箇所）
- **変更**: アプリ起動で `db_path()` から `Database` を開き（既存）、`DecisionRepo::load_all` / `TaskRepo::load_graph` で Manager を初期化して `manage()`。
- **エラー方針**: load失敗は**起動中断＋ログ**（空で握り潰さない、[`02_SPEC.md` §6](02_SPEC.md)）。
- **テスト**: lib.rs は実機寄りなので、復元ロジック本体は P1-2/P1-3 のユニットでカバー済。ここは配線。
- **観点チェック**: infra without wiring 禁止 → MCP `aether.context.*` / `aether.task.*` が新Manager経由で永続化されることを1つ結合テスト。

### P1-5 ⬜ 実機検証（耐久性の証明）
- **手順**: `pnpm tauri dev` → 指揮役で context.set + task数件をRunningへ → プロセス kill → 再起動 → context/task が復元されていることを確認（CDPまたはMCP `aether.context.all` / `aether.task.list`）。
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
- P3-5 ⬜ MCP `aether.event.*` を since カーソル対応に（infra wiring）。

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
