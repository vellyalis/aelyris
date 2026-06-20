# Aether Runtime Hardening — ドキュメント一式

> **目的**: Agent Runtime Core（AI組織OSの心臓部）を「単一オペレータ・単一プロジェクト・ローカル専用」でも **再起動で会社が消えない / 連絡漏れゼロ / 詰まり自動エスカレーション** な堅牢基盤へ引き上げる。負債を残さず、理想粒度でモジュール化し、常に変更しやすい状態を保つ。
>
> **作成**: 2026-06-20 / **ブランチ**: `feat/runtime-hardening`（base `feat/autonomy-visible-panes` HEAD `d660a62`）

---

## このフォルダの読み方（進めながら参照する順）

| # | ファイル | 何が書いてあるか | いつ読む |
|---|---------|-----------------|---------|
| 01 | [`01_REQUIREMENTS.md`](01_REQUIREMENTS.md) | 要件定義。何を満たせば「堅牢」と言えるか（FR/NFR + 受入条件） | 最初に全部 |
| 02 | [`02_SPEC.md`](02_SPEC.md) | 仕様書。アーキ層・永続化パターン・SQLiteスキーマ・データ契約・モジュール境界 | 実装着手前 |
| 03 | [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md) | 詳細実装計画。Phase別・タスク粒度・ファイルパス・TDD手順・ゲート | 各Phase着手時 |
| 04 | [`04_DEBT_AND_MODULARITY.md`](04_DEBT_AND_MODULARITY.md) | 負債を作らない/減らす計画。粒度ルール・所有マップ・13観点ゲート・触るなリスト | 毎タスクの前後 |

---

## 北極星（North Star）

```
人間 → Claude(指揮役) → Agent Runtime Core → worker fleet(claude/codex/gemini) → コード
                              ↑ ここを堅牢にする
```

能力は **1枚のAPIに2つの顔（UI / MCP）**。Coreが正しければ入口は後から何でも付く。
**今やるのはCoreの堅牢化であって、入口やエンタープライズ鎧の量産ではない。**

---

## 現状（2026-06-20 監査結果の要約）

- **Core実装率 約60-70%**: spawn / task routing(DAG) / crash・hang回復(BR9) / cost予算 / file ownership は実装済・テスト堅牢。
- **致命的弱点**: `ContextStore`(決定共有)も `TaskGraph`(仕事の割り振り)も **in-memory のみ → プロセス再起動で全喪失**。
- **Event Bus** は真のpub/subでなくポーリング＋ログ上限256件 → 高トラフィックで**通知が黙って捨てられる**。
- **Supervisor** はescalationイベントを**発火するだけ**で実体なし。
- **git mergeコンフリクト** → タスクが永久 `Running` で詰まる（既知バグ候補 C-22）。

詳細な実コード根拠は [`01_REQUIREMENTS.md` §背景](01_REQUIREMENTS.md) 参照。

---

## Phaseマップ（ゴール射程 = 堅牢ローカルファースト基盤）

| Phase | テーマ | 解消する弱点 | 状態 |
|-------|-------|------------|------|
| **P1** | 永続化（ContextStore + TaskGraph → SQLite write-through + 起動時復元） | 再起動で会社が消える | ⬜ 未着手 |
| **P2** | 並行耐久性の証明（自動）+ 実LLM中規模実走（手動受入） | Core未実戦の不安 | 🟡 |
| **P3** | Event Bus 無損失化（durable log + seqカーソル + 自己回復） | 連絡漏れ | ✅ |
| **P4** | Supervisor実体（escalation durable化）+ C-22回帰 | 詰まり放置 | ✅ |
| **P5** | governance choke point（MCP境界の認可+監査、policy差し替え可能） | 後付け可能性の担保 | ✅ |

> エンタープライズ機能の実装本体は **P5の射程外**（contract-onlyで後付け可能に保つだけ）。Coreが実戦で正しいと分かってから鎧を着せる。

---

## 不変の運用ルール（全Phase共通）

各タスクの**着手前**に [`04_DEBT_AND_MODULARITY.md`](04_DEBT_AND_MODULARITY.md) の粒度ルールと13観点を確認し、**完了時**に全ゲート緑を維持する：

```
pnpm exec tsc --noEmit          # TS型
pnpm test                       # vitest（cargo testと並列実行しない）
cargo test                      # Rustユニット
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

- **挙動不変を死守**。挙動が変わる変更は実機Tauriで視覚/動作確認（vitest緑だけでUI/IO退行を見逃さない）。
- **単一の source of truth**: 状態の所有者を1つに。in-memory ↔ SQLite の二重所有は repository パターンで「メモリ=ホットキャッシュ、SQLite=真実」を明確化（[`02_SPEC.md` §永続化パターン](02_SPEC.md)）。
- **infra without wiring 禁止**: 作ったら即 IPC/MCP/UI まで繋ぐ。
- TDD: テスト先行（RED → GREEN → リファクタ）。

---

## ステータストラッカー（ここを更新しながら進める）

| タスクID | 内容 | Phase | 状態 | コミット |
|---------|------|-------|------|---------|
| — | docs一式作成 | — | ✅ | `9e72c20` |
| P1-1 | 永続化スキーマ migration（context_decisions/tasks/task_dependencies） | P1 | ✅ | feat/runtime-hardening |
| P1-2 | DecisionRepo + ContextStoreManager write-through/復元 | P1 | ✅ | 〃 |
| P1-4(context) | lib.rs setup で Context Store 起動時復元を配線 | P1 | ✅ | 〃 |
| P1-3 | TaskRepo(フルスナップショット) + 既存 `TaskManager` write-through | P1 | ✅ | feat/runtime-hardening |
| P1-4(task) | lib.rs setup で Task Graph 起動時復元を配線 | P1 | ✅ | 〃 |
| P1-audit | 敵対的マルチレンズ監査(18 agent)→確定12件、busy_timeout(HIGH)等を修正 | P1 | ✅ | 〃 |
| P1-5a | 実ファイル再起動(接続close→reopen)統合テスト=耐久性の決定的証明 | P1 | ✅ | `tests/test_runtime_persistence.rs` |
| P1-5b | 実GUI(`pnpm tauri dev`)で dispatch→kill→再起動の手動確認 | P1 | ⬜ | 新binビルド+起動が要(現稼働は旧bin) |

> **P1-5a**: `tests/test_runtime_persistence.rs` 2件PASS。実DBファイルに ContextStore + TaskGraph を**別々の専用接続**で書き(multi-writer+busy_timeout経路)、全接続drop(WALチェックポイント)→新Managerで再オープン→decisions/status/crash_attempts/依存/terminal状態を完全復元。プロセス再起動の決定的プロキシ。GUI不要・CI可能。
> **P1-5b(残)**: 実アプリでの最終目視確認。現在 Aether.exe は**旧バイナリ**稼働中なので、新binをビルド・起動してからの確認になる（任意・低リスク。ロジックは P1-5a で証明済）。

### P5 — governance choke point（✅ branch `feat/runtime-hardening`）

| タスクID | 内容 | 状態 |
|---------|------|------|
| P5-trait | `governance/`: `AccessControl`/`TenantResolver` trait + `AllowAll`/`SingleTenant` default + `Governance` holder | ✅ |
| P5-choke | `tools_call`(MCP)先頭に単一認可ゲート。Deny→durable監査(audit journal)+403。default allow-allで挙動不変 | ✅ |
| P5-wire | ApiState `governance`(default)+`with_governance`/`with_access_and_tenants`。`ApiError::Forbidden`(403) | ✅ |
| P5-audit | 敵対レビュー→#1(MED境界)文書化 + #4b/#4c/#3.5b 修正 | ✅ |

> **意義**: 外部プログラム面(MCP)の全 verb が**1つの認可choke point**を通る。enterprise は `AccessControl` を差し替えるだけで RBAC を強制でき、verb handler を一切触らない＝「契約は配線済み、実装は後付け」。拒否は audit journal に durable 記録(enterprise audit trail)。
> **敵対レビューの確定対応**:
> - **#1(MED 境界限界)**: governance は **MCP verb 面のみ**。REST `/sessions`・WS・`/mux/*` は素通り(同等のPTY操作)。**現auth=単一トークン単一ユーザー＝authn==authzで現時点実害ゼロ**、multi-user RBAC化で顕在化。→ module docに境界を明記(誇張しない)。フルRBACはREST/WSも要gate＋actor解決＝別productization。
> - **#4c**: Deny reasonを403ボディに返すと内部情報漏洩→**汎用403**、詳細はaudit のみ。
> - **#4b**: TenantResolver注入builder無し→`with_access_and_tenants`追加。
> - **#3.5b**: db付きdeny→audit行検証テスト追加。
> **既知 limitation(意図的)**: actor=`"operator"`固定(単一トークンauthにidentity解決元が無い)。per-verbポリシーは効くがper-actor RBACはmulti-user auth待ち。trait shapeは actor 受領可能な正しい形。allowは未監査(denyのみ)。**フルenterprise(マルチノード/RBAC backend/SSO)はlocal-first範囲外**。

### P3 — Event Bus 無損失化（✅ branch `feat/runtime-hardening`）

| タスクID | 内容 | 状態 |
|---------|------|------|
| P3-log | `agent_events` テーブル + `persistence/event_repo.rs`(append/since(seq)/by_channel_since)。seq単調(AUTOINCREMENT) | ✅ |
| P3-bus | `EventBus` write-through publish + `since` カーソル。リングは表示用ホットキャッシュに降格。db後付けattach | ✅ |
| P3-mcp | MCP `aether.event.since` verb(afterSeq/limit→nextSeq)。購読者は欠番なく全件取得 | ✅ |
| P3-audit | 敵対レビュー→**H-1/M-1/L-1 全修正** | ✅ |

> **no-loss の意味**: cap256リングは古いイベントをsilent evictし再起動で消える。durable log は全件を単調seqで保持し、`since(cursor)`で欠番なく取得＝再起動・evict耐性。ライブfeedは既存Tauri emit(push)で元々落ちない。
> **P3-audit で潰した3件**:
> - **H-1(HIGH)**: append失敗時、イベントがring(ライブ)に出るがdurableに入らず`since`がsilent loss(busy以外のディスク満杯/IOで発生)。→ **順序保持・有界(4096)・自己回復するpendingリトライキュー**で修正。失敗→pending退避(ringにも入れライブ維持)、次publishで順序維持ドレイン＝transient障害が自己回復しdurableに必着。DROP TABLE注入テストで縛る。
> - **M-1(MED)**: 未知kind/channelの1行で`since`全体が空(部分破損で全件巻き添え)。→ 不良行はwarnしてskip、ストリームを止めない。
> - **L-1(LOW)**: limit/afterSeqのサーバ側clamp無し→巨大limitで`LIMIT -1`全件返却。→ `clamp(1,1000)`/`max(0)`。
> **既知特性**: pendingは次publishで再試行。完全idle中の自己回復はしない(bounded保持+loud log、将来は背景flush)。フロントのcockpit feedはlive push継続(since-cursor化は任意の後続)。

### P2 — 並行耐久性 + 実LLM実走（🟡 自動部分✅ / 手動受入は残）

| タスクID | 内容 | 状態 |
|---------|------|------|
| P2-conc | **並行耐久性ストレステスト** `tests/test_concurrent_durability.rs`：本番トポロジ(ContextStore/TaskGraph/audit が各自の接続で1ファイルを叩く)を3スレッド同時×各100書き込み→**1件も損失なし**を縛る。busy_timeout が実負荷で効く証明・デッドロックなし | ✅ |
| P2-llm(手動) | 実 claude/codex 3体で中規模1機能を完成まで(worktree→Reviewer→merge)。`scripts/conduct-build.mjs` が土台(d660a62で最小実証済)。**要: 新binビルド+起動+認証CLI** | ⬜ |
| P2-scale(注記) | `TaskRepo::save_graph` はフルスナップショット=1ミューテーション O(N)、N回createで O(N²)。数十タスクは安価(100タスク0.9s)。**数千タスク規模では incremental save が必要**(現状はlocal-first想定で許容、必要時に最適化＝早すぎる最適化を避ける) | 📝 |

> **P2-conc の意義**: 監査HIGH(busy_timeout欠如→SQLITE_BUSYで書き込みsilent drop)の修正が、実際の並行書き込み下で本当に取りこぼさないことを決定的に証明。busy_timeout=0なら落ちる不変を縛る。エンタープライズの durability-under-concurrency の核心。
> **P2-llm の手動性**: 実LLMをGUIで走らせる最終受入は稼働アプリ+認証CLIが要るため自動化不可。新binを起動して `scripts/conduct-build.mjs` で中規模実走し、走行中の取りこぼし/詰まりを観察→出たものをP3/P4のREDに落とす運用。

### P4 — Supervisor 実体 + C-22（✅ branch `feat/runtime-hardening`）

| タスクID | 内容 | 状態 |
|---------|------|------|
| P4-C22 | **C-22 は既修正と判明** → 実git 3wayコンフリクト回帰テストで根絶を担保 | ✅ |
| P4-sink | Escalation Sink: give-up を durable な audit journal 行へ（揮発リング卒業） | ✅ |
| P4-both | durable sink を**ロジック層**(run_step/run_step_visible)へ畳み込み、IPC+MCP両faceを単一経路に | ✅ |
| P4-audit | 敵対レビュー(general-purpose)→HIGH「MCP face非対称」を捕捉し上記で解消 | ✅ |
| P4-rest(任意) | manual re-plan 経路を足す時の escalation 冪等キー(L-2 潜在)・operator toast 強化 | ⬜ |

> **C-22 の真相**: 「mergeコンフリクト→永久Running」は過去のコックピット監査で既に修正済だった。`perform_merge` は git2 インメモリ3way mergeで**コンフリクト時にrepoを汚さず**`Conflict`を返し、`LoopPortsAdapter::merge`が`Err`化、pure loopが rework→Failed+escalation。`merge_conflict_escalates_and_never_strands_the_task` で実gitコンフリクト→Failed+escalation を回帰固定。
> **P4 の真の価値**: escalation が**揮発EventBusリング(cap256)に出るだけ**で①再起動消失②evict③proactive通知なし＝「発火しっぱなし」だったのを、**durable audit journal 行**(再起動耐性・evictなし・task_id/reason/action でtraceable)へ昇格。敵対レビューが「MCP/自律faceだけ durable化漏れ」(HIGH)を捕捉→ループ駆動関数に sink を畳み込み両face対称化。live可視性は既存のEventBus feed(OrchestratorPanelが`escalation_raised`表示)が継続。

> **P1-audit 結果**: HIGH=「WAL複数writer×busy_timeout未設定→SQLITE_BUSYで書き込みsilent drop」を修正(全接続に`busy_timeout=5s`)。他: 依存Vec順序保持/i64→u32安全変換/no-op recompute非永続化/docs整合。受容(設計上妥当)=panic時非永続(full snapshotで自己回復)・load all-or-nothing(失敗時attachせず上書きしない)・ManagedDb poison(既存・範囲外)。誤検知1件(WAL未有効)は棄却。

> 補足: P1-3 は新Managerを作らず**既存 `src-tauri/src/task/manager.rs` `TaskManager`**（`Mutex<TaskGraph>`）に repo を配線する（[`03`](03_IMPLEMENTATION_PLAN.md) の記述を更新済み想定）。`TaskStatus`/`TaskPriority` の `from_str` 追加＋round-trip テストが前提。

> 完了タスクは `⬜ → ✅` に更新し、コミットhashを記入。Phase完了時に [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md) の該当節へ完了印。
