# Aelyris Cockpit Specs

監査可能な多エージェント開発ワークスペースの
要件・仕様・設計・検証 artifact の入口。これは **docs only ではない**。
2026-06-27 時点で実装済み source / verifier があり、ローカル検証で `.codex-auto` artifact を生成できる。
この README は現在の読み順と権威ソースを示す。

Public note: Aelyris is alpha and does not claim production readiness; capability
claims are gated by verifiers. 現行 machine truth は `docs/requirements.md` と
verifier commands がローカル生成する `.codex-auto/quality/*` が優先し、古い進捗
メモの過去スコアは現在の release readiness を上書きしない。

初版: 2026-06-13。Last reviewed: 2026-06-29 JST。現在は公開読者と実装者向けの spec index として維持する。

リリース判断の前に `pnpm verify:quality-score` と `pnpm verify:goal:safe` を
ローカルで再生成して現在値を確認する。認証付き prompt gate は
`authenticated-ai-cli-prompt-smoke`、consent packet は
`authenticated-ai-cli-consent-packet`、token-spending prompt 実行には
`AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini` と明示的同意が必要。

## 要件の入口: [../requirements.md](../requirements.md)

`AGENTS.md` が参照する安定パス。現行の要件定義、claim policy、machine truth、
更新ルールをまとめる。Task Graph / Event Bus / Context Store / Cost Manager と、
Reviewer agent による gated merge は目標設計（全ゲート緑・実装者≠Reviewer・人間の
監視/override が前提）であり、現在の完成主張ではない。

## 設計の北極星

Aelyris を「**単一指示で自律ビルドする** AIワークスペース」に近づける。能力（worktree/agent/pane/diff/task/event/context/merge/approval）を**1つの能力レイヤー（Aelyris Control API）**に集約し、**2つの顔**が投影する: ① 人間の Cockpit UI（Tauri IPC）② オーケストレーターAI（Qralis MCP/control surface）。Reviewer agent による merge は target / gated design であり、現在の製品完成主張ではない。危険シェル/FS操作の **tool-approval は別軸で watchdog ゲート維持**。

## 仕様一覧

| Spec | 対応 Phase | 中身 |
|---|---|---|
| [PHASE_0_1_ARCHITECTURE_SPEC.md](./PHASE_0_1_ARCHITECTURE_SPEC.md) | 0 + 1 | **能力レイヤー(§0.5)**・runtime統一(`AgentSession`/`AgentRunStatus`/`useAgentFleet`)・god file分割・worktree自動配線・validator単一化・router配線・**ゲートモデル(§5)** |
| [MCP_TOOL_SURFACE_SPEC.md](./MCP_TOOL_SURFACE_SPEC.md) | 2.5 | `aelyris.mcp.v1` の tool catalog（FREE/GATED 分類・既存IPCへのマッピング）・transport(stdio/HTTP)・ゲート強制・orchestrator例 |
| [VISIBLE_AGENT_PANE_RUNTIME_SPEC.md](./VISIBLE_AGENT_PANE_RUNTIME_SPEC.md) | cross-cutting | **可視 agent pane runtime 境界**。GUI に出す agent は visible PTY / interactive TUI / no `-p`、headless `-p` は planner・reviewer・MCP batch に限定。Orchestra dispatch を中央 terminal pane tree へ 1 agent = 1 pane でマウントする目標/未完の修正案と、live activity + symbol/function ownership で並列衝突を防ぐ設計 |
| [UI_TOKEN_DIAL_SPEC.md](./UI_TOKEN_DIAL_SPEC.md) | 1（即効） | `global.css` token dial-up 変更表（type up・border alpha 0.052→0.10・weight 800-950 廃止）・新token・gold単一化・検証。single-blur 死守 |
| [COCKPIT_UX_SPEC.md](./COCKPIT_UX_SPEC.md) | 2 + 4 | 6サーフェス（attentionレール / 承認インボックス / フリートグリッド / マージ待ち / kanban起動 / Windowsトースト）を `useAgentFleet().sessions` 単一ソースの投影として規定 |
| [TYPE_BRIDGE_SPEC.md](./TYPE_BRIDGE_SPEC.md) | 0（WU-0.7） | **front/back 同時開発の地盤**。Rust⇄TS の契約を contract test で凍結（依存ゼロ）＋ frontend mock で待ち時間ゼロ。tauri-specta codegen は後回し |
| [PLANNER_SPEC.md](./PLANNER_SPEC.md) | 5（WU-5.1/5.2） | **自律チーム開発ループの最後の1枚**。一行タスク→要件定義+WU分解→`wu-manifest`→fleet dispatch（5.1）、plan→dispatch→test→review→gated merge→repeat（5.2）。`aelyris-plan` skill で今すぐ手動実行可 |
| [AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md](./AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md) | active / agent coordination | `agmsg` 比較監査を要件・仕様・設計に落とした agent message bus 計画。inbox/history、delivery policy、role lease、directive、driver trust、superset gate |
| [CONTEXT_SESSION_LIFECYCLE_SPEC.md](./CONTEXT_SESSION_LIFECYCLE_SPEC.md) | WU-RT-1 (Runtime Core) | 長時間フリートのコンテキスト汚染防止。可視 CLI agent の context/session ライフサイクルを Runtime が統治: 計測プロキシ（Claude TUI の「% context left」構造検出）・退役前セルフ要約（agent 自筆スキーマ）・no-loss handoff トランザクション（checkpoint→後継 seed→読込確認→旧退役、fail-closed/冪等）・resume/reset_context・no-loss verifier ゲート。既存基盤（ContextStore/Task restore/EventBus/Audit Journal/FileMuxSnapshot）の上の自動ライフサイクル層 |

## 依存関係（要約）

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

Current machine truth (Aelyris is alpha and does not claim production readiness;
capability claims are gated by verifiers):

- `pnpm verify:quality-score` -> current release score is generated locally into
  `.codex-auto/quality/release-quality-score.json`.
- `pnpm verify:goal:safe` -> non-token final safe gate.
- `pnpm verify:current-readiness-source` -> authoritative source hierarchy and
  stale green demotion.

掃除系（docs archive 等）は別 chore。公開時は `docs/README.md` の current / historical 区分を優先する。


