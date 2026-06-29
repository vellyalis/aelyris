# Competitive Roadmap — Aelyris と BridgeSpace / tmux の比較メモ（historical）

> 親: ①の1対1監査（実コード根拠）を戦略に落とした実装計画。**音声(BridgeVoice相当)はスコープ外**（ユーザー指示）。
> 作成: 2026-06-20 / 監査根拠: フロントUX・ターミナル持続性・共有メモリの3並列実コード監査 + P1–P5/E1 セッション知見。

## 0. 戦略（どの土俵で勝つか）

**彼らの土俵で戦わない。** BridgeSpace の強み＝速さ・賑やかさ・スイートの幅・流通。ここを正面から追うと不利（出荷済み・音声・25+テーマ・課金ユーザー）。

**自分たちの強みで差別化する。** Aelyris の特徴＝**壊れにくい・監査できる・決定的なAI開発ワークスペース** + **堅牢なターミナル持続性** + **深いエディタ(LSP+Vim+Diff)**。①監査では、この領域は BridgeSpace/tmux と比べても作り込みがある、という所見だった（claim ではなく監査メモ）。

### キーショット（最重要インサイト）
🔴UX の穴（可視化が無い）と 🟢堀（堅牢な runtime backend）は**同じ場所で重なる**。
- 例: 永続Event Bus(P3) / DAGタスクグラフ / governance監査 / file ownership は**すべて backend は既にある**が UI が無い。
- ∴ **「既にハードニングした runtime を可視化する」**だけで、**UX の穴を埋めつつ堀を製品価値に変える**＝1手で二度効く。これが最短勝ち筋。

---

## Tier 0 — 穴埋め（即・安価・"infra without wiring" 解消）

| ID | 内容 | 根拠/理由 | 工数 | 倒す相手 |
|----|------|----------|------|---------|
| T0-1 | **Knowledge Graph を永続化** | 監査で判明: `knowledge_graph` は**in-memoryのみで再起動消失**(P1で取りこぼし)。`persistence/knowledge_repo.rs` を decision/task/event_repo と同型で追加→`attach_db`→lib.rs配線 | S | BridgeMemory「決定が残る」に追いつく前提条件 |
| T0-2 | **Intent Bus を永続化**(任意) | 同じく in-memory。pre-fact提案がセッション跨ぎで残ると価値 | S | — |
| T0-3 | **TLS/mTLS**(リモート公開する場合) | 監査: REST/WS は token のみ、TLS未実装。remote 公開の前提 | M | tmux over ssh の安全性に追いつく |

> T0-1 は P1 と同型なので低リスク・即。**最優先**(堀の前提が欠けている)。

---

## Tier 1 — 堀の可視化（差別化を製品価値に＝キーショット）

backend は全て既存。**UIを足すだけ**で UX穴埋め × 堀の可視化を同時達成。

| ID | 内容 | 既存backend | 工数 | 倒す相手 |
|----|------|------------|------|---------|
| T1-1 | **Run Timeline / Replay**: 永続Event Bus を時系列ビューに。`aelyris.event.since(seq)` で全イベントを欠番なく再生(タスク生成→dispatch→review→merge→escalation) | event_repo(P3, no-loss durable) | M | BridgeSpace に**無い「決定的リプレイ」**。「何が起きたか完全再現」 |
| T1-2 | **DAG タスクグラフ可視化**(force-directed/ReactFlow) | task graph(永続化済) + knowledge_graph(T0-1後) | M | BridgeMemory の force-directed view に**追いつき**つつ、**依存・blast radius(impact)**で超える |
| T1-3 | **Governance / Audit ログビューア**: access_denied + escalation の durable監査を表示 | audit journal(P4/P5) | S | BridgeSpace に**無い監査性**。enterprise/長時間無人運用の訴求 |
| T1-4 | **Fleet Health ダッシュボード**: supervisor health + 予算 + file lane を可視化 | supervisor/cost/file_ownership | M | 「誰が何を触り、どこが詰まり、予算は」の一望 |

> このTierが**戦略の本体**。「賑やかさ」でなく「信頼性の可視化」で差別化。

---

## Tier 2 — 表層の追いつき（第一印象で負けない最小限）

| ID | 内容 | 現状(監査) | 工数 | 倒す相手 |
|----|------|----------|------|---------|
| T2-1 | **コマンドブロックUI**: Warp風の出力ブロック表示 | backend(terminal_command_blocks)有, **UI無し** | M | BridgeSpace のブロックに追いつく(infra-without-wiring解消) |
| T2-2 | **ワークスペーステンプレート**: 1/2/4/6/8ペイン等の既製レイアウト選択 | 動的分割のみ, プリセット無し | S | BridgeSpace の1–16テンプレ |
| T2-3 | **テーマ拡充**: 8→20+(既にパレット編集基盤あり) | 8テーマ + ThemePaletteEditor | S | 25+テーマ |
| T2-4 | **ナレッジ/決定の markdown エクスポート**: SQLite→`.md`(wikilink)でgit commit/grep可に | SQLite(opaque) | M | BridgeMemory の local-first/git親和に追いつく |

---

## Tier 3 — tmux との差を詰める（ターミナルの強みを伸ばす）

| ID | 内容 | 現状(監査) | 工数 | 倒す相手 |
|----|------|----------|------|---------|
| T3-1 | **クロスマシン detach/reattach**: detach先を別マシンから reattach(sidecar daemonをremote化) | 同マシンのみ, PTYはrespawn | L | tmux over ssh の本丸 |
| T3-2 | **read-only セッション共有**: 複数クライアントRO接続(WS broadcastは既存, 制御権ロックを追加) | 全員RW | M | tmux attach -r |
| T3-3 | **prefix-key 操作**(任意): キーボード主導のpane操作 | UI/APIメニュー主体 | M | tmux C-b |

---

## Tier 4 — 構造的な差別化（容易に真似されにくい特徴）

| ID | 内容 | なぜ堀か |
|----|------|---------|
| T4-1 | **決定的・再現可能なエージェントループ** | pure-loop がテストで縛れる(2600+)。「壊れない」を技術的に保証＝vibe coding の不安定さの逆 |
| T4-2 | **「AI組織OS」の能力API(1枚に2つの顔: UI/MCP)** | 53 MCP verb。外部から組織を操作。BridgeMCP(12)を量・統制で超える |
| T4-3 | **governance + 監査 + 永続の三位一体** | enterprise/規制業務/長時間無人運用＝彼らの speed 訴求が届かない層 |

---

## 推奨シーケンス

1. **T0-1**(KG永続化, 即) → 堀の前提を埋める
2. **T1-1〜T1-4**(runtime可視化) → 戦略本体。UX穴埋め×差別化を同時に
3. **T2-1〜T2-3**(表層追いつき) → 第一印象を底上げ
4. 必要に応じて **T3**(tmux超え) / **T2-4**(markdown) / **T0-3**(TLS)
5. **T4** は常に「製品メッセージ」として前面に（実装でなく positioning）

> 各タスクは hardening 同様: TDD + 全ゲート緑(cargo/clippy/fmt/tsc/vitest) + UI変更は実機Tauri視覚確認 + 敵対レビュー。1タスク=1ブランチ/1コミット。

## 方向性(一言)
**派手さで競うのではなく、「壊れにくい・見える・監査できるAI開発ワークスペース」を目指す。** 表層は最小限追いつかせ、既にある土台(堅牢runtime + 持続ターミナル + 深いエディタ)を可視化していく。これは positioning メモであり、現時点の製品主張ではない。
