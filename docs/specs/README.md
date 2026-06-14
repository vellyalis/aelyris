# Aether Cockpit Specs

多エージェント並列開発コックピット化の設計仕様一式。**全て draft / docs only — ソースコード変更は含まない。**
実装は **Codex** が担当。背景監査は memory `cockpit-readiness-audit-2026-06-13`。

作成: 2026-06-13 / branch `codex/release-hardening-quality-gates`（dirty WIP 上）

## 👉 実装者はここから: [CODEX_HANDOFF.md](./CODEX_HANDOFF.md)

全 Phase の作業分解（Work Unit）・依存DAG・受け入れ基準・「壊すな」リスト・貼り付け用タスクの**マスタープラン**。各 WU は自己完結ブリーフ付きで cold start 可能。

## 設計の北極星

Aether を「AIが操作できるワークスペース」に。能力（worktree/agent/pane/diff/merge/approval）を**1つの能力レイヤー（Aether Control API）**に集約し、**2つの顔**が投影する: ① 人間の Cockpit UI（Tauri IPC）② オーケストレーターAI（Opus、`aether` MCP server）。`approval` と `merge-to-main` は**ゲート**（AIは要求のみ、付与は watchdog/人間）。

## 仕様一覧

| Spec | 対応 Phase | 中身 |
|---|---|---|
| **[CODEX_HANDOFF.md](./CODEX_HANDOFF.md)** | all | 作業分解・依存DAG・受け入れ基準・実行バッチ・do-not-break。**入口** |
| [PHASE_0_1_ARCHITECTURE_SPEC.md](./PHASE_0_1_ARCHITECTURE_SPEC.md) | 0 + 1 | **能力レイヤー(§0.5)**・runtime統一(`AgentSession`/`AgentRunStatus`/`useAgentFleet`)・god file分割・worktree自動配線・validator単一化・router配線・**ゲートモデル(§5)** |
| [MCP_TOOL_SURFACE_SPEC.md](./MCP_TOOL_SURFACE_SPEC.md) | 2.5 | `aether.mcp.v1` の tool catalog（FREE/GATED 分類・既存IPCへのマッピング）・transport(stdio/HTTP)・ゲート強制・orchestrator例 |
| [UI_TOKEN_DIAL_SPEC.md](./UI_TOKEN_DIAL_SPEC.md) | 1（即効） | `global.css` token dial-up 変更表（type up・border alpha 0.052→0.10・weight 800-950 廃止）・新token・gold単一化・検証。single-blur 死守 |
| [COCKPIT_UX_SPEC.md](./COCKPIT_UX_SPEC.md) | 2 + 4 | 6サーフェス（attentionレール / 承認インボックス / フリートグリッド / マージ待ち / kanban起動 / Windowsトースト）を `useAgentFleet().sessions` 単一ソースの投影として規定 |
| [TYPE_BRIDGE_SPEC.md](./TYPE_BRIDGE_SPEC.md) | 0（WU-0.7） | **front/back 同時開発の地盤**。Rust⇄TS の契約を contract test で凍結（依存ゼロ）＋ frontend mock で待ち時間ゼロ。tauri-specta codegen は後回し |
| [PLANNER_SPEC.md](./PLANNER_SPEC.md) | 5（WU-5.1/5.2） | **自律チーム開発ループの最後の1枚**。一行タスク→要件定義+WU分解→`wu-manifest`→fleet dispatch（5.1）、plan→dispatch→test→review→gated merge→repeat（5.2）。`aether-plan` skill で今すぐ手動実行可 |

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

## 状態

設計完了・実装未着手。Codex の Go 待ち。掃除系（docs archive 等）は現 dirty ブランチ着地後の別 chore。local-only（PR不要）。Codex は 2026-07-01 まで usage limit（引き継ぎは durable）。
