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
| **P2** | 実LLM 1本通し ハードニング（取りこぼし炙り出し） | Core未実戦の不安 | ⬜ |
| **P3** | Event Bus 無損失化（durable log + pub/sub、上限撤廃） | 連絡漏れ | ⬜ |
| **P4** | Supervisor実体 + mergeコンフリクト自動エスカレーション（C-22解消） | 詰まり放置 | ⬜ |
| **P5** | エンタープライズ層を**契約(trait)だけ**用意（RBAC/監査/テナント） | 後付け可能性の担保 | ⬜ |

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
| P1-3 | TaskRepo + 既存 `task::TaskManager` への配線 | P1 | ⬜ | |
| P1-4(task) | lib.rs setup で Task Graph 起動時復元を配線 | P1 | ⬜ | |
| P1-5 | 実機: dispatch→kill→再起動で状態復元 検証 | P1 | ⬜ | |

> 補足: P1-3 は新Managerを作らず**既存 `src-tauri/src/task/manager.rs` `TaskManager`**（`Mutex<TaskGraph>`）に repo を配線する（[`03`](03_IMPLEMENTATION_PLAN.md) の記述を更新済み想定）。`TaskStatus`/`TaskPriority` の `from_str` 追加＋round-trip テストが前提。

> 完了タスクは `⬜ → ✅` に更新し、コミットhashを記入。Phase完了時に [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md) の該当節へ完了印。
