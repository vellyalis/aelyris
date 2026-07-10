# Aelyris Cockpit Specs

監査可能な多エージェント開発ワークスペースの
要件・仕様・設計・検証 artifact の入口。これは **docs only ではない**。
2026-06-27 時点で実装済み source / verifier があり、ローカル検証で `.codex-auto` artifact を生成できる。
この README は現在の読み順と権威ソースを示す。

Public note: Aelyris is alpha and does not claim production readiness; capability
claims are gated by verifiers. 現行 machine truth は `docs/requirements.md` と
verifier commands がローカル生成する `.codex-auto/quality/*` が優先し、古い進捗
メモの過去スコアは現在の release readiness を上書きしない。

初版: 2026-06-13。Last reviewed: 2026-07-10 JST。現在は公開読者と実装者向けの spec index として維持する。

リリース判断の前に `pnpm verify:quality-score` と `pnpm verify:goal:safe` を
ローカルで再生成して現在値を確認する。認証付き prompt gate は
`authenticated-ai-cli-prompt-smoke`、consent packet は
`authenticated-ai-cli-consent-packet`。token-spending AI CLI prompt/probe は
このリポ/WU では owner の standing consent 済みなので、documented provider env
（例: `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`）を設定して実行してよい。
provider/model/command/artifact を記録し、secret や token file は永続化しない。

Current machine truth refreshed 2026-07-10 JST by the comprehensive audit safe
chain: `pnpm verify:quality-score` reports `65/100` (`228/351`), grade `D`,
`releaseCandidateReady=false`.
The final-goal audit is `blocked` with `implementationFixableCount=17`,
`policyBlockedCount=3`, and `externalBlockedCount=19`; this remains an
alpha/not-release-ready state.

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
| [AELYRIS_DIFFERENTIATION_POLISH_SPEC.md](./AELYRIS_DIFFERENTIATION_POLISH_SPEC.md) | cross-cutting / differentiation polish | **BridgeSpace-plus** visible agent workspace と **Scape-plus** Proofbooks を機能要件に落とす設計正本。center terminal pane tree、1 agent = 1 visible PTY pane、bounded shared brain、symbol/function ownership、Proofbook canvas + run timeline + proof inspector、no duplicate runner / no second dispatcher、not release-ready claim boundary を固定 |
| [AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md](./AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md) | D0-D8 implementation design | Differentiation polish の詳細設計。D0 spec/verifier gate、D1 center-pane fleet、D2 durable runtime、D2R Remote Continuity + SSH Attach、D3 live activity + ownership、D4 bounded shared brain、D5 Proofbook UI、D6 PB-5/PB-6/PB-7、D7 governed merge-ready lane、D8 claim gate を分離し、技術負債を残さない実装順を定義 |
| [COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md](./COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md) | active R0-A9 remediation program | 2026-07-10 総合監査を authority/evidence、terminal input、Windows trust、UI trust、durability、execution supervision、modularity、CompletedWorkPacket、native spike、release lane の依存順へ変換した tracked 実行正本。root work order は `audit-remediation-instructions.md` |
| [../WORK_RECORD_AND_CONTINUATION_PROTOCOL.md](../WORK_RECORD_AND_CONTINUATION_PROTOCOL.md) | cross-cutting workflow contract | tracked plan + ignored per-session worklog + canonical local-only handoff の三層で、session close と `続き` の再開手順、必須記録、clear-safe 条件を固定 |
| [AELYRIS_REMOTE_CONTINUITY_SPEC.md](./AELYRIS_REMOTE_CONTINUITY_SPEC.md) | D2R / remote continuity requirements | 外出先からの tab/pane state sync、read-only remote fleet monitor、fingerprint-checked remote approval、SSH attach、attach lease、scoped principal、not release-ready claim boundary を定義する仕様書 |
| [AELYRIS_REMOTE_CONTINUITY_DESIGN.md](./AELYRIS_REMOTE_CONTINUITY_DESIGN.md) | D2R / remote architecture design | daemon-owned state projection、remote event stream、private-network web monitor、SSH/TUI attach、attach leases、principal/scope model の設計。SSH は state owner ではなく transport として扱う |
| [AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md](./AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md) | D2R / remote detailed design | RemoteWorkspaceSnapshot、RemotePaneProjection、RemoteApprovalProjection、RemoteAttachLease、MCP/HTTP/API shape、`aelys attach`/forced command、RC0-RC7 work units、verifier plan を固定 |
| [TERMINAL_CORE_DESIGN.md](./TERMINAL_CORE_DESIGN.md) | pillar 1 | terminal core decision record + staged GPU renderer plan |
| [UI_TOKEN_DIAL_SPEC.md](./UI_TOKEN_DIAL_SPEC.md) | 1（即効） | `global.css` token dial-up 変更表（type up・border alpha 0.052→0.10・weight 800-950 廃止）・新token・gold単一化・検証。single-blur 死守 |
| [COCKPIT_UX_SPEC.md](./COCKPIT_UX_SPEC.md) | 2 + 4 | 6サーフェス（attentionレール / 承認インボックス / フリートグリッド / マージ待ち / kanban起動 / Windowsトースト）を `useAgentFleet().sessions` 単一ソースの投影として規定 |
| [TYPE_BRIDGE_SPEC.md](./TYPE_BRIDGE_SPEC.md) | 0（WU-0.7） | **front/back 同時開発の地盤**。Rust⇄TS の契約を contract test で凍結（依存ゼロ）＋ frontend mock で待ち時間ゼロ。tauri-specta codegen は後回し |
| [PLANNER_SPEC.md](./PLANNER_SPEC.md) | 5（WU-5.1/5.2） | **自律チーム開発ループの最後の1枚**。一行タスク→要件定義+WU分解→`wu-manifest`→orchestrator dispatch（5.1）、plan→dispatch→test→review→gated merge→repeat（5.2）。現在の実装済み face は `aelyris.orchestrator.plan` / `aelyris.orchestrator.step` |
| [PROOFBOOK_AUTOMATION_SPEC.md](./PROOFBOOK_AUTOMATION_SPEC.md) | proposal / automation roadmap + PB-2 local backend runner/ledger + PB-3 MCP integration slice + PB-4 agentSession runtime start + completion/status settlement slice | **Proofbooks**。Scape Playbooks 型の多段 automation を Aelyris の verifier / evidence artifact / governance / visible fleet / merge gate に接続する設計。PB-2 local backend runner/ledger は `shell`・`verifier`・`waitFor`・`manualGate` を Tauri IPC 経由で扱い、PB-3 MCP integration slice は既存 `tools/call` schema/governance 経路で cataloged run/status verbs と `mcpTool` を扱い、PB-4 agentSession runtime は既存 agent runtime 経由で visible または許可された headless agent session を running ledger step として記録し、completion/status settlement は explicit done signal / final report / required artifact settlement / reviewer-batch proof のみで完了させる。Proofbook UI / create・update・distill / HTTP・fan-out・subProofbook・Evidence Store / native UI completion は未実装の設計 target であり、Proofbooks 全体の実装済みclaimではない |
| [PROOFBOOK_PB1_DETAILED_DESIGN.md](./PROOFBOOK_PB1_DETAILED_DESIGN.md) | PB-1 implementation blueprint | PB-1 schema/parser/validator + list/validate IPC の詳細設計。`PROOFBOOK_AUTOMATION_SPEC.md` を置き換えず、PB-1実装範囲・typed error・camelCase schema・unknown step validation・path containment・no-runner境界・focused Rust test matrix の正本として扱う。未実装の設計 gate であり、Proofbooks 実装済みclaimではない |
| [PROOFBOOK_PB1_CONTINUATION.md](./PROOFBOOK_PB1_CONTINUATION.md) | PB-1 continuation | セッションクリア後に `続き` から PB-1 schema/parser/validator 実装へ戻るための handoff。読み順、現在の machine truth、実装対象ファイル、禁止範囲、Verifier コマンド、pasteable `/goal` を固定 |
| [AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md](./AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md) | active / agent coordination | `agmsg` 比較監査を要件・仕様・設計に落とした agent message bus 計画。inbox/history、delivery policy、role lease、directive、driver trust、superset gate |
| [CONTEXT_SESSION_LIFECYCLE_SPEC.md](./CONTEXT_SESSION_LIFECYCLE_SPEC.md) | WU-RT-1 (Runtime Core) | 長時間フリートのコンテキスト汚染防止。可視 CLI agent の context/session ライフサイクルを Runtime が統治: 計測プロキシ（Claude/Codex/Gemini live fixture matrix、Claude の「% context left」は補強、他 CLI は fixture proof まで fallback）・退役前セルフ要約（agent 自筆スキーマ）・no-loss handoff トランザクション（checkpoint→後継 seed→読込確認→旧退役、fail-closed/冪等）・resume/reset_context・no-loss verifier ゲート。既存基盤（ContextStore/Task restore/EventBus/Audit Journal/FileMuxSnapshot）の上の自動ライフサイクル層 |
| [WU_RT_1_CONTINUATION.md](./WU_RT_1_CONTINUATION.md) | continuation | セッションクリア後の再開用 handoff。hardening H1-H8 の repo-owned completion audit は現行 final-goal audit truth に superseded。次セッションは current machine truth を再確認してから次の repo-owned blocker または外部 gate handoff を選ぶ |
| [PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md](./PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md) | proposal / decision record | **次の work-order 候補の意思決定台帳**。API 化ギャップ（approval.resolve / visible spawn / pane verbs+短ID `%N` / `aelys` MCP bridge / workflow・cost verbs）、core 強化（stale-approval guard 全書込経路化・done-marker 衝突・catalog memoize・KG live index・governance principal・event bus overflow）、herdr 比較の adopt/have/skip、非エンジニア向け差別化要素（Fleet Briefing / リスク別承認バッチ / リモート監視 / 平文タスク投入 / cost meter / fleet recipes）と推奨実行順 |
| [FLEET_API_HARDENING_SPEC.md](./FLEET_API_HARDENING_SPEC.md) | WU-FA-1 (approved work unit) | **Fleet API & Hardening Wave 1 の要件/仕様/設計**。C1 broadcast stale-approval ガード・C2 done-marker 衝突・C3 catalog memoize・A1 `aelyris.approval.resolve`・A2 `spawn_visible`・A3b 短ID `%N`・A4 `aelys mcp` bridge + `report --title`。委譲マップ（cockpit 内部関数への delegate 必須）と受入ゲート付き。実行順は repo root の `fleet-api-instructions.md`（貼り付け用 /goal 同梱） |
| [UI_DENSITY_AUDIT_2026-07-03.md](./UI_DENSITY_AUDIT_2026-07-03.md) | audit / work-order-ready | **ターミナル面積の実測監査**（2×2 分割で window の ~30% しか grid でない）と是正計画 D1-D10（IMEInputBar/TimelineBar の auto-hide、gutter/padding 統合、`--terminal-chrome-density` トークン、rail 圧縮、Zen mode）。目標: 2×2 で center-panel の ≥80% を grid に。density 検証ゲート追加込み |
| [FINAL_GOAL_SCORE_PATH_2026-07-06.md](./FINAL_GOAL_SCORE_PATH_2026-07-06.md) | execution ledger / release-score backlog | **リリーススコア backlog の triage 台帳**。final-goal audit の blocker を RERUN（stale 証拠の再実行、コード禁止）/ LIVE-HOST（CDP 9222・実スリープ）/ TOKEN-CONSENT（同意 env 必須）/ UPSTREAM / DERIVED（集約行・直接作業禁止）/ CODE（fresh 再実行後も落ちるものだけ）に分類し、エリア→正確な refresh コマンド→artifact パスの対応表と実行ルート（resume rule 付き）、実行 agent 向け禁止則（stale≠broken・gate 弱体化禁止・artifact 捏造禁止・環境無しは environment-blocked 報告で先へ）を固定。数値 truth は本文に置かず必ず再生成 |
| [UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md](./UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md) | audit / work-order-ready (WU-UQ-1) | **信頼性優先の製品 UI/UX 監査**（post WU-UD-1 baseline、verdict=REVIEW）。fake-alive pane（sidecar 無言再接続・pane lifecycle 未配線）、複数行ペースト無警告実行、ownership/blockedReason データ有り描画無し、review-queue のヒューリスティック判定が権威風表示、キーボード承認パス不在、実レンダリング UI 検証（Playwright/CDP/screenshot）が全て CI 未ゲート、を file:line 証拠つきで確定。是正計画 Q0-Q11（gate-first trust 検証器 → liveness → reconnect events → paste guard → ownership/blocker 描画 → keyboard approval → evidence honesty → dead-layer 掃除 → rendered-truth CI）。実行順と貼り付け用 /goal は repo root の `ui-quality-instructions.md`。**ロードマップ登録済**: `PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md` §5 の #6（Q0-Q3 安全サブセット）と #9（Q4-Q11 残り）。透明感/ガラスは絶対（owner law）・レイアウト再設計はスコープ外（owner 判断固定） |

## Active Remediation Program

現在の実行入口は repo root の `audit-remediation-instructions.md`。詳細な
依存順は `COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md` の R0-A9 を
正とする。下の Batch A-F は既存 cockpit program の設計履歴であり、現在の
next Work Unit routing ではない。

## 依存関係（既存 cockpit program 要約）

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
- `pnpm verify:goal:safe` -> ordered final safe gate; the 2026-07-10 run
  reported `tokenSpendingPromptExecuted=true`, so it is not a no-token command.
- Hardening H1-H8 repo-owned completion audit -> superseded by current
  `blocked` final-goal audit truth; do not restart it unless a current verifier
  shows a repo-owned regression.
- `pnpm verify:current-readiness-source` -> authoritative source hierarchy and
  stale green demotion.
- `pnpm verify:renderer:perf` -> terminal renderer baseline/comparison artifact
  in `.codex-auto/quality/renderer-perf.json`; current R6 proposal keeps WebGL2
  opt-in and leaves `canvas2d` as the default.

掃除系（docs archive 等）は別 chore。公開時は `docs/README.md` の current / historical 区分を優先する。
