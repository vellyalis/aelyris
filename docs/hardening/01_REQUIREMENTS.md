# 01 — 要件定義（Runtime Hardening）

> 親: [`00_README.md`](00_README.md) ／ 次: [`02_SPEC.md`](02_SPEC.md)

## 1. ゴール

Agent Runtime Core を、ローカルファーストのまま **本番運用に耐える堅牢さ** に引き上げる。
堅牢さの定義は「機能が多い」ではなく、以下の4つが**証明可能**であること：

1. **耐久性 (Durability)** — プロセス/マシンが落ちても、進行中の決定とタスクは失われない。
2. **無損失 (No-loss)** — エージェント間の通知が黙って捨てられない。
3. **自己回復 (Self-recovery)** — 詰まり（crash/hang/mergeコンフリクト/予算枯渇）が放置されず、必ず再試行 or エスカレーションされる。
4. **変更容易性 (Changeability)** — 上記を満たしても、モジュール境界が明確で、後からエンタープライズ層を契約越しに足せる。

## 2. 背景（実コード根拠）

| 領域 | 実体 | 弱点 |
|------|------|------|
| 決定共有 | `src-tauri/src/context_store/{mod,manager}.rs` `ContextStore`(BTreeMap) | in-memory のみ。再起動で喪失 |
| タスク割当 | `src-tauri/src/task/graph.rs` `TaskGraph`(HashMap+order) | in-memory のみ。再起動で喪失 |
| 通知 | `src-tauri/src/event_bus/mod.rs` `EventLog`(cap=256) | ポーリング＋上限で取りこぼし |
| 回復 | `src-tauri/src/orchestrator/autonomy.rs` `reap_or_escalate` | escalationは発火のみ。supervisor実体なし |
| 永続層 | `src-tauri/src/db/{mod,migrations,queries}.rs` `Database`/`ManagedDb` | session/pane/historyは永続。**decision/task は未永続** |

> ✅ 既に堅牢（触らない）: `reap()`/`reap_timed_out()`（claude.rs）、planner（orchestrator/mod.rs）、`TaskGraph` のDAG/transition/recompute ロジック、3軸独立リトライ予算。これらは [`04`](04_DEBT_AND_MODULARITY.md) の「触るなリスト」。

## 3. アクター

| アクター | 役割 |
|---------|------|
| 指揮役 Claude | 単一命令を受け、Runtime経由でfleetを編成・配給・統合判断 |
| worker fleet | claude/codex/gemini CLI。worktreeで実装、可視ペインで実行 |
| 人間オペレータ | 単一命令の投入、エスカレーション受領、最終承認 |
| Runtime Core | spawn/context/event/task/recovery を司る（本要件の対象） |

## 4. 機能要件（FR）

各要件は **受入条件（テストで縛れる形）** とセット。

### FR-1 決定の永続化
- 指揮役が `context.set("auth_method","jwt")` を呼ぶと、SQLiteに即時 write-through される。
- **受入**: set後にプロセス再起動 → `context.get("auth_method")` が `jwt` を返す。新規ユニットテスト + 実機。

### FR-2 タスクグラフの永続化
- `task.create` / `transition` / `record_crash|rework|timeout` の各変更がSQLiteに反映される。
- **受入**: 3タスク（1依存）をRunningまで進め再起動 → グラフ構造・status・各attemptカウンタが完全復元。

### FR-3 起動時復元
- アプリ起動時、SQLiteから `ContextStore` と `TaskGraph` をロードして in-memory を再構築する。
- **受入**: 空DBなら空、既存DBなら前回状態。マイグレーションは冪等（既存 `run_migrations` 同様）。

### FR-4 通知の無損失（P3）
- イベントは durable log（SQLite）に追記され、上限で**黙って捨てない**。購読者は欠番なく受け取れる。
- **受入**: 256件超のイベントを発行 → 全件がlogに残る／購読カーソルが取りこぼさない。

### FR-5 詰まりの必達エスカレーション（P4）
- crash/hang/rework 予算枯渇、**および git mergeコンフリクト**で、タスクは永久 `Running` に留まらず `Failed` 化＋`EscalationRaised` を発火し、supervisor実体が受信して人間へ通知する。
- **受入**: mergeコンフリクトを注入 → タスクが有限時間で `Failed`、escalation 1件、supervisor が通知レコードを残す（C-22回帰テスト）。

### FR-6 エンタープライズ契約の用意（P5・contract-only）
- RBAC / 監査 / テナント解決を **trait** として定義し、デフォルトは no-op/allow-all 実装で配線。本体実装は後日。
- **受入**: trait境界が存在し、Core呼び出しがtrait越しに通る。差し替えで挙動が変わることをテストで確認（実装本体は範囲外）。

## 5. 非機能要件（NFR / 堅牢さ）

| ID | 要件 | 基準 |
|----|------|------|
| NFR-1 耐久性 | 永続化はトランザクション境界を持ち、書き込み失敗を握り潰さない | write失敗は `Result` で上位へ伝播。silent swallow 禁止 |
| NFR-2 単一source of truth | メモリ=ホットキャッシュ、SQLite=真実。二重所有を作らない | repository層が唯一の書き込み口（[`02`](02_SPEC.md)） |
| NFR-3 後方互換 | 既存スキーマ・既存テスト（cargo813）を壊さない | migrationは追加のみ。`IF NOT EXISTS` |
| NFR-4 観測可能性(lite) | 永続化・回復・escalationに構造化ログ（tracing） | 既存tracing踏襲。メトリクスはP5契約 |
| NFR-5 変更容易性 | 1関数<50行 / 1ファイル<800行 / ドメイン別モジュール | [`04`](04_DEBT_AND_MODULARITY.md) 粒度ルール |
| NFR-6 決定性 | 永続化/復元ロジックはユニットテスト可能（時刻/乱数を注入） | in-memory SQLite (`:memory:`) でテスト |

## 6. スコープ外（明示）

- ❌ マルチノード分散・リーダー選出・分散トレースの**実装本体**（P5は契約のみ）。
- ❌ RBAC/監査/マルチテナントの**実装本体**（契約のみ）。
- ❌ TLS/mTLS・rate limiting（local-only方針、[memory: project_local_only]）。
- ❌ Event Busの完全な外部MQ化（SQLite durable logで足りる範囲に留める）。

## 7. リスクと前提

- **前提**: Core機構は決定的部分がテスト済だが**実LLM長時間A/B運用は未検証**（最小ビルドはd660a62で実証済）。→ P2で1本通し。
- **リスク**: 永続化のたびにロック競合でスループット低下 → ContextStore は key 差分、TaskGraph はフルスナップショット（数十タスク規模で安価）。複数接続の writer 競合は `busy_timeout=5s` で待たせて取りこぼさない（[`02`](02_SPEC.md)）。P2-3 で実測。
- **リスク**: cargo testとpnpm testの並列実行でlink.exe競合 → 直列実行（CLAUDE.md鉄則）。
