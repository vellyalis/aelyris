# Quorum Cockpit Specs

監査可能な多エージェント開発ワークスペースの
要件・仕様・設計・検証 artifact の入口。これは **docs only ではない**。
2026-06-27 時点で実装済み source / verifier があり、ローカル検証で `.codex-auto` artifact を生成できる。
この README は現在の読み順と権威ソースを示す。

Public note: world-class / tmux-equivalent / BridgeSpace-plus / Ghostty-class /
release-ready は現在の製品主張ではない。現行 machine truth は
`docs/requirements.md` と verifier commands がローカル生成する `.codex-auto/quality/*` が優先し、古い進捗メモの
過去スコアは現在の release readiness を上書きしない。

初版: 2026-06-13。Last reviewed: 2026-06-28 JST。現在は公開読者と実装者向けの spec index として維持する。

Current release evidence for this spec index: `43/100`, `150/351`, grade `D`, `releaseCandidateReady=false` as of 2026-06-28 JST. Current final audit status is `blocked` with `implementationFixableCount=46`, `policyBlockedCount=1`, and `externalBlockedCount=12`. The authenticated prompt gate remains `authenticated-ai-cli-prompt-smoke`; the consent packet is `authenticated-ai-cli-consent-packet`, and token-spending prompt execution requires `QUORUM_AUTH_PROMPT_PROVIDER=codex|claude|gemini` plus explicit consent.

## 実装者はここから: [CODEX_HANDOFF.md](./CODEX_HANDOFF.md)

Repository-level plan: [`../../PLAN.md`](../../PLAN.md).

全 Phase の作業分解（Work Unit）・依存DAG・受け入れ基準・「壊すな」リスト・貼り付け用タスクの**マスタープラン**。各 WU は自己完結ブリーフ付きで cold start 可能。

## 要件の入口: [../requirements.md](../requirements.md)

`AGENTS.md` が参照する安定パス。現行の要件定義、world-class claim
policy、machine truth、更新ルールをまとめる。

## 要件の権威ソース: [AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md](./AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md)

「何を作るか」の権威ソース。**2026-06-15 に AI Agent OS v1.0 のスーパーセットへ改訂(v2.0)**。Task Graph / Event Bus / Context Store / Cost Manager の4 subsystem を追加し、Reviewer agent による gated merge を目標設計として定義する（全ゲート緑・実装者≠Reviewer・人間の監視/override が前提）。これは現在の release-ready 主張ではない。下記の個別 spec のうち merge invariant 記述は v2 と lockstep 更新が必要（要件doc末尾「Cross-spec reconciliation」参照）。

## 設計の北極星

Quorum を「**単一指示で自律ビルドする** AIワークスペース」に近づける。能力（worktree/agent/pane/diff/task/event/context/merge/approval）を**1つの能力レイヤー（Quorum Control API）**に集約し、**2つの顔**が投影する: ① 人間の Cockpit UI（Tauri IPC）② オーケストレーターAI（`aether` MCP server）。Reviewer agent による merge は target / gated design であり、現在の製品完成主張ではない。危険シェル/FS操作の **tool-approval は別軸で watchdog ゲート維持**。

## 仕様一覧

| Spec | 対応 Phase | 中身 |
|---|---|---|
| **[QUORUM_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md](./QUORUM_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md)** | cross-cutting | 要件 -> 仕様 -> 実装設計 -> verifier -> artifact の追跡表。今後の作業で doc/gate を更新しているかの監査入口 |
| **[CODEX_HANDOFF.md](./CODEX_HANDOFF.md)** | all | 作業分解・依存DAG・受け入れ基準・実行バッチ・do-not-break。**入口** |
| [PHASE_0_1_ARCHITECTURE_SPEC.md](./PHASE_0_1_ARCHITECTURE_SPEC.md) | 0 + 1 | **能力レイヤー(§0.5)**・runtime統一(`AgentSession`/`AgentRunStatus`/`useAgentFleet`)・god file分割・worktree自動配線・validator単一化・router配線・**ゲートモデル(§5)** |
| [MCP_TOOL_SURFACE_SPEC.md](./MCP_TOOL_SURFACE_SPEC.md) | 2.5 | `aether.mcp.v1` の tool catalog（FREE/GATED 分類・既存IPCへのマッピング）・transport(stdio/HTTP)・ゲート強制・orchestrator例 |
| [VISIBLE_AGENT_PANE_RUNTIME_SPEC.md](./VISIBLE_AGENT_PANE_RUNTIME_SPEC.md) | cross-cutting | **可視 agent pane runtime 境界**。GUI に出す agent は visible PTY / interactive TUI / no `-p`、headless `-p` は planner・reviewer・MCP batch に限定。Orchestra dispatch を中央 terminal pane tree へ 1 agent = 1 pane でマウントする目標/未完の修正案と、live activity + symbol/function ownership で並列衝突を防ぐ設計 |
| [UI_TOKEN_DIAL_SPEC.md](./UI_TOKEN_DIAL_SPEC.md) | 1（即効） | `global.css` token dial-up 変更表（type up・border alpha 0.052→0.10・weight 800-950 廃止）・新token・gold単一化・検証。single-blur 死守 |
| [COCKPIT_UX_SPEC.md](./COCKPIT_UX_SPEC.md) | 2 + 4 | 6サーフェス（attentionレール / 承認インボックス / フリートグリッド / マージ待ち / kanban起動 / Windowsトースト）を `useAgentFleet().sessions` 単一ソースの投影として規定 |
| [TYPE_BRIDGE_SPEC.md](./TYPE_BRIDGE_SPEC.md) | 0（WU-0.7） | **front/back 同時開発の地盤**。Rust⇄TS の契約を contract test で凍結（依存ゼロ）＋ frontend mock で待ち時間ゼロ。tauri-specta codegen は後回し |
| [PLANNER_SPEC.md](./PLANNER_SPEC.md) | 5（WU-5.1/5.2） | **自律チーム開発ループの最後の1枚**。一行タスク→要件定義+WU分解→`wu-manifest`→fleet dispatch（5.1）、plan→dispatch→test→review→gated merge→repeat（5.2）。`aether-plan` skill で今すぐ手動実行可 |
| [QUORUM_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md](./QUORUM_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md) | active / agent coordination | `agmsg` 比較監査を要件・仕様・設計に落とした agent message bus 計画。inbox/history、delivery policy、role lease、directive、driver trust、superset gate |
| [AETHER_FUSION_COORDINATOR_AUDIT_2026-06-23.md](../history/AETHER_FUSION_COORDINATOR_AUDIT_2026-06-23.md) (history) | future / composition | **Fusion Coordinator 監査**。LLM重み合体ではなく inference-time multi-agent / MoA / swarm coordination を Quorum Control API 上に載せる判断、Claude `-p` 監査結果、API shape、安全境界、実装順序 |
| [QUORUM_COMPETITIVE_GAP_AUDIT_2026-06-25.md](./QUORUM_COMPETITIVE_GAP_AUDIT_2026-06-25.md) | current audit | tmux / BridgeSpace / Ghostty / release readiness の現状監査。world-class claim は REVIEW / BLOCK |
| [QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md](./QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md) | active closure | G1-G6 workstreams、anti-debt rules、fallback policy、G5 native terminal closure、G6 aggregate gate |

## 依存関係（要約。詳細DAGは CODEX_HANDOFF §5）

```
Batch A 即効: UI token dial(1.3→1.4) ∥ validator(0.5) ∥ status(0.1)   ← 依存なし、先行可
Batch B 基礎: AgentSession(0.2)→useAgentFleet(0.3) ∥ 能力レイヤー(0.4)
Batch C 最大ROI: worktree自動配線(1.1 ⚠gate lockstep) + router配線(1.2)
Batch D コックピット: rail/inbox/grid/diff(2.x) ∥ MCP scaffold(2.5.1)
Batch E 尻尾: merge backend(3.1)→queue(3.2)→outcomes UI(3.3)→MCP gate(2.5.2)
Batch F 仕上げ: god file分割(0.6) ∥ kanban(4.1) ∥ toast(4.2) ∥ review(4.3) ∥ monitor(4.4)
```

- ⚠ **WU-1.1 lockstep**: `verify-agent-team-orchestration-readiness.mjs:218` が dispatch 行を文字列完全一致で検査。`branchName` 追加時は同コミットで gate 文字列も更新。
- surface 4（マージ待ち）と MCP `request_merge` は Phase 3 の**新規 merge backend**（現状 merge/rebase コマンドは grep 0件）に依存。

## 現在状態

実装は進行中。古い未着手扱いのステータスではない。

Current machine truth:

- `pnpm verify:world-class-terminal-ai-os` -> expected `BLOCK` until
  `tmux`, `bridgespace`, `ghostty`, and `release` claims all pass.
- `pnpm verify:quality-score` -> current release score is generated locally into
  `.codex-auto/quality/release-quality-score.json`.
- `pnpm verify:current-readiness-source` -> authoritative source hierarchy and
  stale green demotion.
- `pnpm verify:requirements-spec-design-traceability` -> this doc stack stays
  connected to active gates.

掃除系（docs archive 等）は別 chore。公開時は `docs/README.md` の current / historical 区分を優先する。


