# Context & Session Lifecycle Spec (Runtime Core)

作成: 2026-06-30 ／ 改訂: 2026-07-01 (rev3, RT-1a0 provider matrix / standing token consent 反映)
WU: WU-RT-1
対象: 長時間動き続ける可視 CLI エージェント群のコンテキスト汚染を防ぎ、Runtime がコンテキスト/セッションのライフサイクル（計測・要約・引継ぎ・再開・リセット）を統治する境界仕様。OS のメモリ管理/プロセス管理に相当する Runtime Core 機能。
実装手順: [CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md](./CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md)（codex 向け cold-start handoff）。

## 0. 結論

ユーザー仮説（「各エージェントに自律的な引継ぎ/セッション管理 API を Runtime Core に。無いとコンテキスト汚染が事故になる」）は正しい。設計の確定軸:

> 1. **新規ストレージではなく、既存の永続基盤（ContextStore / Task restore / EventBus / Audit Journal / FileMuxSnapshot / merge_intent）の上に載せる「自動ライフサイクル層＋API＋計測＋検証ゲート」**。重複実装は禁止（§13 reuse 表）。
> 2. 運用モデル＝**可視対話 CLI エージェント**（claude/codex/gemini を PTY で起動）。Runtime は context window を所有しない。handoff は透過差し替えではなく**「要約付きの新ペイン起動→旧ペイン退役、状態は永続から継続」の可視リサイクル**。
> 3. ★**rev2 の中核訂正**: エージェントとの構造化データ授受は **TUI スクレイプではなくファイル経由**（agent はファイルを書ける対話エージェント）。要約も後継の読込確認も**ファイル/grid 経由**で行う。生 PTY バイトの再構成（alt-screen スクロール・redraw・strip_ansi 不完全・8192 buffer 上限）には依存しない。
> 4. ★**rev2**: 不可逆操作（退役）の前に**耐久 handoff-intent 行**（merge_intent パターン：intent→CAS→boot reconcile）を必ず置く。audit も退役**前**に発行。これで double-spawn・両退役・un-audited 破棄・crash 半完了を防ぐ。
> 5. **計測の現実**: visible CLI は token 直読不可。一次トリガは**頑健な proxy（status 遷移・wall-clock・ターン数）**。Claude TUI の「% context left」行は**補強**（出現が遅延/on-demand で warn を駆動しきれない・実機未確定）。RT-1a0 は Claude/Codex/Gemini の live fixture matrix を採取し、provider-specific telemetry が証明できない CLI は時間/ターン fallback、confidence=unknown と正直に扱う。
> 6. **計測は grid 読取**（`term_snapshot`/GridSnapshot）優先。生バイト正規表現（現 `output_monitor.rs`）は live TUI でほぼ発火せず信頼できない（スモークの thinking 固定の実原因。sidecar feed 自体は生存）。
> 7. **検証ゲート必須**（docs/README.md）。no-loss handoff verifier は **context 無損失 AND audit 無損失**の両方を assert しない限り「実装済み」と言わない。

公開 API（概念 → 実 verb、衝突回避で `session_*`。`snapshot`=端末グリッド、`checkpoint`=workflow-phase と別物）:

| 概念 | 実 IPC/MCP verb | 役割 |
|---|---|---|
| `checkpoint()` | `session_checkpoint` | session 状態＋要約 ref を耐久化（redaction 済） |
| `summarize()` | `session_summarize` | 退役エージェント本人に**ファイルへ**構造化要約を書かせ Runtime が読取・検証 |
| `handoff()` | `session_handoff` | intent 行→checkpoint→後継 spawn(seed)→後継 ack ファイル→旧退役 を fail-closed/冪等で |
| `resume()` | `session_resume` | crash/再起動後、intent 行＋checkpoint から一意収束で再構成（冪等） |
| `reset_context()` | `session_reset_context` | 同 worktree への handoff-to-self（§7/§9 と同一規律で実行＝bare spawn+stop 禁止） |

非ゴール（§2.3）: headless `-p` パスの context 管理、CLI 内部 compaction の代替/上書き、汎用 RAG/長期記憶。

---

## 1. 背景と問題

長時間（数時間〜数日）運用で各 CLI エージェントの context window が肥大化し、精度低下・コスト増・速度低下を招く。CLI は自前で context を持つため Runtime からは限界が直接見えない。退役/再開/リセットの Runtime verb は**存在しない**（§13）。結果、コンテキスト汚染が「静かな品質劣化」として顕在化する。これは北極星（[project_competitive_direction]「壊れない・監査できる決定的 AI 組織 OS」）の中核要件。OS の memory/GC/process 管理に対応する Context/Session/Handoff 管理を Runtime が担う。

---

## 2. 運用モデルと境界

### 2.1 可視 CLI エージェント前提
人間に見せるエージェントは必ず visible PTY + interactive TUI（[VISIBLE_AGENT_PANE_RUNTIME_SPEC]）。`agent_command_spec`（`src-tauri/src/agent/interactive.rs:213`）は `-p` を使わず、唯一のシードは positional `initial_prompt`（同 :234-246）。**ただしエージェントは Bash/Write 等のツールでファイルを読み書きできる**＝これを構造化データ授受の主経路にする（§6・§7）。

### 2.2 帰結
- Runtime は message 配列を持たない → token 直読不可 → 計測は代理指標（§5）。
- handoff は透過不可 → 可視リサイクル（§7）。
- `reset_context()` は配列クリアでなく**プロセス recycle**（§4.5、§7 と同規律）。

### 2.3 非ゴール
1. headless `-p`/stream-json 経路の context 管理（`agent/claude.rs --resume`、`parser.rs` の正確 cost/tokens は当経路専用・対象外。可視経路に等価物なし）。
2. CLI 内部 compaction の代替/上書き。Runtime は CLI 内部 context を**黒箱＝劣化前に retire する対象**とする。§5.2 で CLI 自動 compaction との競合を扱う。
3. 汎用長期記憶/RAG。要約は「次の継続に必要な最小集合」。

---

## 3. 概念モデル

### 3.1 エンティティ
- **Task**（`src-tauri/src/task/graph.rs`）= 作業単位。耐久 DAG。変更しない。
- **Session**（新規論理エンティティ）= 1 つの作業継続文脈。現 `InteractiveSessionInfo`（`src-tauri/src/agent/interactive.rs:322`）は **`session_id == pty_id`**（`interactive_commands.rs:141`）で PTY 不可分。リサイクルは PTY を張り替えるため **PTY から独立した安定 `logical_session_id`** を導入（§8.2）。
- **Lineage（リサイクル鎖, multi-hop A→B→C）**= 現 `handoffFrom` は FE 専用（`src/shared/hooks/useAgentManager.ts:159-161` で「backend は追跡しない」と明記）。**`session_checkpoints.predecessor_session_id` を辿る耐久チェーンを lineage の SoR**（source of record）とする（§8・§9）。

### 3.2 状態
リサイクルの session 状態は **`AgentRunStatus`（`src-tauri/src/agent/status.rs:18`、9状態）に `summarizing`/`retiring` を追加**して `InteractiveSessionInfo.status` に乗せる（mux の `LifecycleState{Active,Detached}` は pane-PTY ライフサイクルであり session-context とは別軸＝拡張しない、rev2 訂正）。handoff の進行は §8.1 の `session_handoffs.state` 機械が別管理する。

---

## 4. API 契約

各 verb: (a) headless 非対応明記、(b) Audit Journal＋EventBus 二面（§9）、(c) **fail-closed**（後継未確認なら旧を退役しない）。

### 4.1 `session_checkpoint(logical_session_id) -> CheckpointRef`
- session 状態（cli/model/cwd/worktree/status/cost/tokens/context_pct/started_at/last_activity）＋要約 ref＋`predecessor_session_id`＋**inFlightDiff の保全 ref（§6.1/§7）**を耐久化。
- 実装: 永続 repo パターン（`src-tauri/src/persistence/mod.rs`）に倣う `SessionCheckpointRepo`＋`session_checkpoints` 表（§8.1）。原子書込は `FileMuxSnapshotStore.save_graph`（`src-tauri/src/mux/store.rs` tmp+rename）か SQLite tx。
- **redaction 済の summary_json のみ保存**（§6.4、Rust 境界で適用）。
- 冪等: UNIQUE(`logical_session_id`,`checkpoint_seq`)。

### 4.2 `session_summarize(logical_session_id) -> SummaryRef`
- 退役エージェント本人に **§6.1 スキーマを JSON ファイルへ書かせる**（TUI スクレイプ廃止）。駆動・受領・検証は §6。

### 4.3 `session_handoff(logical_session_id, reason) -> HandoffResult`
- §7 のトランザクション。`reason` ∈ {context_pressure, task_boundary, manual, error_recovery}。
- 既存 FE フロー（`HandoffDialog`/`showHandoff`＋`AgentInspector.handleHandoff` `src/features/agent-inspector/AgentInspector.tsx:288-306`）は現状**後継 spawn のみで旧を退役しない**（重大ギャップ）→ §7 の「spawn＋ack＋退役＋no-loss」へ昇格。
- ★退役は **`stop_interactive_agent`（プロセス kill のみ）**を使う。**handoff 中の `end_session_and_remove_worktree` は禁止**（後継と共有する worktree を消し作業損失＝§7・rev2）。

### 4.4 `session_resume(...) -> logical_session_id`
- crash/再起動後、**`session_handoffs` intent 行の state を読み一意収束**で後継を採用し predecessor を退役（double-spawn 防止、§7 crash 節）。冪等。
- restore 系列（`lib.rs restore_task_graph`→`TaskManager::attach_db`（`task/manager.rs:61`）→`TaskRepo::load_graph`（`task_repo.rs:115`）→`tasks_for_restore`（`task/mod.rs:42`）→`recompute_ready`（`task/graph.rs:291`））に並ぶ新 `restore_interactive_sessions` を追加（現 `adopt_sidecar_terminals`（`commands.rs:1869`）は生存 PTY を generic pane としか再採用せず cli/model/status/cost/worktree/initial_prompt が失われる＝crash 冪等の穴）。
- ★**resume 時に過去 ack を信用しない**：durable ack 不在/未検証なら再確認（§7 step4・rev2）。
- workflow resume 語彙（`WorkflowExecutor.resume_from_phase` `workflow/executor.rs`）は workflow-phase であって agent-context でない。語彙のみ範。

### 4.5 `session_reset_context(logical_session_id) -> logical_session_id`
- **これは predecessor==self・同 task/worktree の handoff である**（rev2）。bare spawn+stop でなく **§7 fail-closed 順序＋§9 二面書込を必ず実行**。退役は worktree 非削除の `stop_interactive_agent`。§11 verifier の対象に含める。

---

## 5. 計測（context-size プロキシ）

CLI が context を所有するため直接計測不可。**一次は頑健 proxy、%行は補強**（rev2）。信頼度順:

1. **status 遷移（一次・頑健）**: `DetectedStatus`（`output_monitor.rs:7`）。idle ≒ ターン完了。タスク境界判定にも使う。
2. **wall-clock / ターン数（一次・頑健）**: `started_at`＋新規 `last_activity`（§8.2）。ターン境界は status idle 遷移をカウント。
3. **Claude TUI「context left until auto-compact」（補強・要実機確定）**: **`term_snapshot`/GridSnapshot（`src-tauri/src/ipc/commands.rs` 付近、cell モデル）を読んで**残量行を拾う（生バイト正規表現でなく grid。alt-screen/redraw に強い）。必要に応じ **periodic `/context` 注入**で読出しを強制。**出現が遅延/on-demand で warn を単独駆動できない**ため一次ではない。
4. token/cost 正規表現（**弱い・Claude のみ**）: `cost_re`/`token_re`（`output_monitor.rs` ClaudeParser）。live 対話 TUI は該当行を通常出さず `tokens_used` は 0/陳腐化（**スモークの status thinking 固定の実原因**。sidecar feed は生存：daemon→WS→`run_stream_supervisor`→broadcast→`run_output_monitor`、`pty_sidecar.rs` で検証済）。
5. FE プロキシ: `agentContextPercent=tokensUsed/getMaxTokens`（`src/shared/lib/workstationSummary.ts:48`、per-model `src/shared/types/model.ts` MODEL_OPTIONS：Claude 200k/Codex 192k/Gemini 1M）。(4) が弱い分これも弱い。`TelemetryConfidence`（exact|parsed|estimated|unknown）でラベル。

### 5.1 per-CLI（正直スコープ）
`GeminiParser`/`CodexParser`（`output_monitor.rs`）は usage を一切抽出しない（`DetectedUsage::default`）。∴ **provider-honest**: RT-1a0 で Claude/Codex/Gemini の live fixture matrix を採取し、Claude は (3)+(1)(2) を狙う。Codex/Gemini は provider-specific fixture が exact/parsed telemetry を証明するまで (1)(2) 時間/ターン fallback・confidence=unknown。§0 と整合（「全 CLI のコンテキスト汚染を防ぐ」は全 CLI で fallback 保護を持ち、完全な残量検出は provider proof ごとに昇格）。per-CLI 残量検出は follow-on。

### 5.2 閾値ポリシー（既存と重複させない, rev2）
- **既存の `contextWarnPct`（既定 85, `src/shared/lib/budgetStatus.ts`）と `ContextGauge` 閾値（60/80/95, `src/shared/ui/ContextGauge.tsx`）を再利用**。新たな warn80/hard92 定数を増やさない。warn=既存 warn、hard=auto-compact 直前（実機確定）。
- **タスク境界優先**（実装完了→handoff）。mid-edit 強制は hard のみ。
- per-session の window 割合は `src-tauri/src/cost/mod.rs` の `over_budget` 決定パターンを per-session 版で踏襲（`CostCaps` は fleet 上限＝別軸）。

### 5.3 ★実機 spike（RT-1a0, 必須前提）
(3) の残量行フォーマット、provider 別 telemetry の有無、許可メニュー構造（§PRE-2）、数字キー確定挙動は**実 Claude/Codex/Gemini CLI の visible bytes/grid で未確定**。native backend/packaged build で CDP スモーク採取し fixture 化してから RT-1a の gate を確定（[project_surface2_plumbing_done] の sidecar/native 制約参照）。token spending は standing owner consent 済みだが、provider/model/command/artifact を記録し、secret/token file/transcript は永続化しない。strip_ansi は不完全（CSI-letter のみ、`\x1b[?…` DEC private・OSC `\x1b]…\x07`・alt-screen を落とさない）→ grid 読取を使うか strip を強化。

---

## 6. 退役前セルフ要約（ファイルベース）

### 6.1 スキーマ
`aelyris.session.v1`（`ContextPackJson v1`＝`src/shared/lib/contextPack.ts` を範に formal 化）。必須:
`goal` / `currentTask{id,status,subtasks}` / `decisions[key]`（ContextStore 参照） / `openQuestions[]` / `files[]`＋`symbols[]`（所有） / **`inFlightDiff{present, disposition, ref}`** / `nextAction` / `risks[]`。

### 6.2 駆動・受領（TUI スクレイプ廃止＝rev2 中核訂正）
- 駆動: warn 閾値かタスク境界で、**かつ対象が `DetectedStatus::Idle`（または OSC133 prompt-mark）に達した時のみ**（mid-turn 注入は破損するため, rev2）、当エージェントへ「§6.1 スキーマを **`<worktree>/.aelyris/handoff/<logical_session_id>.<seq>.json` に Write ツールで書き、書き終えたら `…/<…>.done` を作れ**」を `PtySidecarClient::write`（`pty_sidecar.rs:358`）注入。
- 受領: Runtime が `.done` 出現を監視→JSON ファイルを読む（ANSI/スクロール/buffer 上限と無関係。grid/byte スクレイプに依存しない）。
- hard 閾値までに idle に達しないなら: 強制注入を試み、失敗時は**要約なし checkpoint**にフォールバックせず handoff を中断（fail-closed）。

### 6.3 完全性検証（外部真実に接地, rev2）
JSON 妥当だけでは不十分。**外部と突合**: `inFlightDiff` を `git status`/diff と、`currentTask`/subtasks を Task graph（`task/graph.rs`）と、`decisions` を ContextStore と照合。必須フィールドの構造検証は決定的に。不合格で handoff 中断（旧を退役させない）。劣化対策＝**早め要約**（warn＋タスク境界、hard は最後の手段）。

### 6.4 redaction（Rust 境界で適用＝rev2）
- ★FE の `redactSensitiveText`（`contextPack.ts`、TS）は durable Rust 経路に効かない。**単一の Rust-side redaction utility を capture 境界で適用**し、`SessionCheckpointRepo` 永続化前 AND audit payload 構築前の両方に掛ける（新 `session_checkpoints` 表は現状 redaction 皆無）。
- パターンを拡張: PEM ブロック / JWT / AWS・GCP キー / `user:pass@` URI / 高エントロピー検出。**捕捉要約は untrusted boundary input** として扱う（リポの input-validation 方針）。

---

## 7. no-loss handoff トランザクション（intent-row + file-ack + in-flight 保全）

順序（fail-closed・rev2 で全面強化）:
1. **耐久 intent 行を先に書く**（merge_intent パターン `src-tauri/src/merge_intent/store.rs`）: `session_handoffs(predecessor_id, 事前採番した successor logical_session_id, handoff_seq, state=pending_summary)`、UNIQUE(`predecessor_id`,`handoff_seq`)。これが idempotency-key の**実体行**＝double-spawn 防止。
2. `session_summarize`（§6）→ SummaryRef・完全性検証。**`inFlightDiff` 非空なら退役前に保全**：`commit_worktree` か `git stash create` で durable ref 化し checkpoint に記録（後継が決定的に復元）。state→`checkpointed`。
3. `session_checkpoint`（§4.1）耐久化（commit 完了待ち）。
4. **handoff intent の audit を退役前に発行**（§9、`session_handoff committing` を journal append）。state→`successor_spawning`。
5. 後継 `spawn_interactive_agent` を**要約ファイル参照付きでシード**（seed は `build_adr_header`（`src-tauri/src/control/loop_ports.rs` の decision ヘッダ注入）を範に「§checkpoint の要約ファイルを最初に読め。読了後 `…/<successor>.ack` を Write せよ」）。state→`successor_spawned`。
6. **後継 ack ファイル**出現を観測（EventBus::since ではない＝CLI は publish 不可, rev2）。**＋後継が running/idle に達し debounce 窓だけ生存**を確認（ack は読込を示すが liveness を示さない, rev2）。state→`successor_acked`。
7. **確認後にのみ** predecessor を `stop_interactive_agent`（kill のみ・worktree 非削除）で退役。state→`predecessor_retired`。lineage（`predecessor_session_id`）を checkpoint に確定。`session_handoff committed` audit。
8. 失敗時: 後継未確認なら退役しない（両生存の方が安全）。`session_handoff failed` audit。

crash 冪等（rev2 で merge_intent 方式に統一）:
- 各 state 遷移は idempotency-key（`predecessor_id:handoff_seq`）で再実行安全。**restore-pending 規律は lineage/retire intent を運べない**ため使わない（finding 訂正）。代わりに **boot 時 `reconcile_dangling`**（merge_intent の boot reconcile 同型）が `session_handoffs` を走査し、live PTY/worktree を実検査して一意収束（successor_spawned で crash→resume は ack を**再確認**してから退役。両 spawn/両退役を出さない）。
- ⚠ `ManagedDb::with`（`db/mod.rs:33`）は mutex で SQL tx でない → 原子性は intent 行＋CAS 層で担保（単一 DB tx に頼らない）。

---

## 8. 永続化

### 8.1 新表
- `session_checkpoints`（repo パターン `persistence/mod.rs`）: `logical_session_id`,`checkpoint_seq`,`pty_id`,`cli`,`model`,`cwd`,`worktree_*`,`status`,`cost`,`tokens_used`,`context_pct`,`summary_json`(redacted),`inflight_ref`,`predecessor_session_id`(lineage SoR),`created_at`。UNIQUE(`logical_session_id`,`checkpoint_seq`)。
- `session_handoffs`（§7 state 機械）: `predecessor_id`,`successor_id`,`handoff_seq`,`state`(pending_summary|checkpointed|successor_spawning|successor_spawned|successor_acked|predecessor_retired|failed),`correlation_id`,`updated_at`。UNIQUE(`predecessor_id`,`handoff_seq`)。crash 復旧の権威マーカー。
- idempotency UNIQUE＋append-only/immutability トリガは `merge_intents`（`src-tauri/src/db/migrations.rs`）を範に。
- per-session context proxy/handoffReady は **既存 `agent_identity_records.context_usage_json`（`db/queries.rs`）を live runtime telemetry で書く**（現状は静的 proof のみ `bin/aelyris_native.rs`）。新 checkpoint 表と二重管理しない（rev2）。

### 8.2 安定 session id ＋ last_activity
`InteractiveSessionInfo` に `logical_session_id`（pty_id と独立）と `last_activity` を追加。`session_id==pty_id` の現状ではリサイクルで identity が切れる（段階移行・§14）。

### 8.3 restore
`lib.rs` の restore_* 群に `restore_interactive_sessions` を追加。生存 sidecar PTY（daemon が app より長命）を `adopt_sidecar_terminals` と協調して `InteractiveSessionManager` へ復元。`session_handoffs` の `reconcile_dangling` を boot で実行（§7）。

---

## 9. 統治・監査（rev2 で順序・SoR・compaction を訂正）

handoff/recycle は重大な context 破棄＝**統治される行為**。
- ライブ可視: 新 `AgentEventKind::SessionHandoff`/`ContextRecycled`（`src-tauri/src/event_bus/mod.rs` に variant＋as_str/from_str/default_channel＋round-trip テスト）を `publish_and_emit`（`ipc/event_commands.rs`）。
- 耐久監査（**ガバナンスのゲートはこちら**）: `audit::append_audit_event_and_emit`（`src-tauri/src/audit.rs`）で `AuditJournalAppend{kind:"session_handoff", session_id, pane_id, terminal_id, agent_id, correlation_id, payload_json}`（既に当該列を持つ, `db/queries.rs`）。sha256 hash・append-only・monotonic seq を得る。
- ★**順序**: `escalation_sink`（`src-tauri/src/supervisor/escalation_sink.rs`）は「durable 半分＋別 live publish」であり**二面の原子性は無い**（rev2 訂正）。よって **durable audit append（Tauri emit ではなく）を不可逆 retire の前に**置く（§7 step4）。退役後 audit では un-audited 破棄窓ができる。
- ★**lineage の SoR は `session_checkpoints.predecessor_session_id`（multi-hop A→B→C）**。`correlation_id` は **1 handoff の EventBus＋audit を束ねる ID**であって多段 lineage ではない（`get_audit_trace` は 1 handoff のみ辿る, rev2 訂正）。
- ★**compaction 注意**: audit journal は保持超過行を DELETE する（`audit_compact_boundary`）。長期フリートで handoff audit が aging out しうる → `session_handoff`/`context_recycled` kind を compaction 除外、または lineage SoR（checkpoints 表・非 compaction）を権威記録とする（rev2）。
- ⚠ 軽量 `record_audit_event`（`ipc/commands.rs`, table `audit_events`, hash/seq/emit 無し・best-effort drop）は**使わない**。統治は journal 経路。

---

## 10. 可視性（UI）

- リサイクルは `emit_agent_fleet`/`agent_fleet_snapshot`（`ipc/commands.rs`、`AgentSession`＋`From<InteractiveSessionInfo>` `src-tauri/src/agent/session.rs:62`）経由で「旧退役・後継マウント」を可視化。
- `ContextGauge`（`src/shared/ui/ContextGauge.tsx`）が context% を表示しトリガを駆動。
- lineage（A→B→C）を inspector に表示（FE-only `handoffFrom` を耐久 backend＝checkpoints lineage 由来へ）。
- `summarizing`/`retiring` は §3.2 のとおり `AgentRunStatus` 拡張で表現。

---

## 11. 検証（no-loss handoff verifier ゲート, rev2 で audit no-loss 追加）

docs/README.md 方針で**必須**。`ProcessGateRunner`（`src-tauri/src/control/gate_runner.rs`）を範に `scripts/verify-session-handoff-no-loss.mjs` を作り `verify:goal:safe` 配線。assert:
- **context 無損失**: checkpoint 行が耐久化 AND 後継が要約ファイルを ack（消費）AND 旧ペイン解放 AND `inFlightDiff` が後継 worktree に復元。
- **audit 無損失（rev2 追加）**: handoff 後 `audit_event_journal` に `session_handoff`（hash 連鎖・append-only）が lineage `correlation_id` 付きで存在 AND `get_audit_trace(correlation_id)` が返る。これが無いとガバナンス穴が緑で出荷される。
- **crash 安全**: 各 state で crash 注入 → resume が「両退役なし／二重 spawn なし／worktree 非削除」で一意収束。
- 範テスト: Task restore の `restore_tests`/`graph_survives_a_simulated_restart_via_db`/`restore_regates_a_dependent_and_never_dispatches_it_before_its_dependency`。
- `reset_context`（§4.5）も対象に含める。RT-1e は sibling verifier `scripts/verify-session-resume-idempotent.mjs` で `session_resume` の冪等収束・ack 再確認・identity mismatch fail-closed と、`session_reset_context` が bare spawn/stop ではなく no-loss handoff 規律を再利用することを assert する。
- ★実機: §5.3 の spike（provider 別 telemetry・残量行・メニュー構造）を実 Claude/Codex/Gemini fixture matrix で確定。

---

## 12. 段階実装計画

依存: RT-1a0(spike) → RT-1a(計測) → (RT-1b 要約, RT-1c checkpoint/persist) → RT-1d(handoff tx) → RT-1e(resume/reset) → RT-1f(UI)。詳細・編集点・受入は [CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md]。各フェーズ独立緑化＋verifier。前提に PR #4 follow-up（PRE-1 分類は全文・PRE-2 Approve を決定的 Yes）。

---

## 13. 既存資産マップ（reuse vs new）

| 機能 | 既存（再利用） | 新規 |
|---|---|---|
| 耐久 K/V・ADR | `ContextStoreManager`＋`DecisionRepo`＋`context_decisions`（write-through/restore） | session-scoped 記録（現 k→v string のみ） |
| Task 永続/復元 | full restore 系列（§4.4 引用） | Task↔session 耐久バインド（現 source_branch のみ） |
| Event/Audit | EventBus no-loss `since`／Audit Journal（hash/append-only/correlation/session_id 等）／`escalation_sink`（durable 半分） | `SessionHandoff`/`ContextRecycled` variant・`session_handoff` kind・**退役前 audit 順序** |
| crash 冪等永続 | **`merge_intent`（intent 行＋CAS＋boot reconcile）**／`FileMuxSnapshot`(atomic tmp+rename)／`agent_events` monotonic seq | `session_handoffs` state 機械・`reconcile_dangling`（restore-pending は不採用） |
| 要約スキーマ | `ContextPackJson v1`＋redaction（FE 組立） | **agent 自筆をファイル経由で受領**・外部突合検証・**Rust 境界 redaction** |
| handoff フロー | `HandoffDialog`/`buildHandoffPrompt`/`AgentInspector.handleHandoff`（spawn のみ） | **ack＋退役＋no-loss tx**・耐久 lineage（現 FE-only）・worktree 非削除退役 |
| 計測プロキシ | `agentContextPercent`/`getMaxTokens`/`ContextGauge`/`budgetStatus`(contextWarnPct=85)/`TelemetryConfidence`／`started_at`／**`term_snapshot`/GridSnapshot** | grid からの残量読取（Claude）・`last_activity`・per-CLI fallback・periodic `/context` |
| spawn/retire | `spawn_interactive_agent`／`stop_interactive_agent`(kill のみ)／seed=`initial_prompt` argv | seeded-successor＋ordered retire の合成・安定 session id |
| resume 語彙 | `WorkflowExecutor.resume_from_phase`(workflow-phase)／`claude --resume`(headless 専用) | visible session resume・`restore_interactive_sessions`・ack 再確認 |
| 検証ゲート | `ProcessGateRunner`／`verify-*.mjs`／Task restore tests | `verify-session-handoff-no-loss.mjs`（context＋audit 両 no-loss） |

★lifecycle verb（checkpoint/summarize/handoff/resume/reset_context）の runtime 実装は**ゼロ**（grep 0 hit。`handoff`/`checkpoint` は静的 proof or workflow-phase のみ）。

### 13.1 名前衝突
`snapshot`（`src-tauri/src/snapshot/`）=端末グリッド time-travel／`checkpoint`（`workflow/executor.rs`）=workflow-phase resume → verb は `session_*`（§0）。

---

## 14. リスクと未解決

1. **計測信頼性**: 残量行フォーマットは CLI 版依存・実機未確定（§5.3 spike 必須）。一次は頑健 proxy にしたためリスク低減。未対応 CLI は confidence=unknown＋時間/ターン。
2. **要約劣化**: 自筆要約品質。早め＋外部突合検証で緩和、ゼロ化不可。
3. **承認 TOCTOU（PR #4・PRE-2）**: 検出時 Yes ハイライト→クリック前に人間が移動。解決時 live ハイライト再読が要る（RT-1a の grid 読取基盤で実装可能）。
4. **session==pty 前提の波及**: 安定 session id は `interactive_commands.rs:141` 周辺の id 仮定に触れる→段階移行。
5. **CLI 内部 compaction との競合**: hard を auto-compact 直前に置くが、CLI が先に compact したら handoff skip＋計測 reset。
6. **検証の実機依存**: §11 ゲートは決定的に書けるが、計測の TUI 確定は実機スモーク。
7. **コスト**: 要約・/context 注入のトークン。過剰 handoff churn を頻度ポリシーで抑制。

---

## 改訂履歴
- rev3 (2026-07-01): RT-1a0 を Claude-only spike から Claude/Codex/Gemini provider matrix に拡張。token-spending prompt/probe は standing owner consent 済みとし、provider/model/command/artifact 記録と secret/token file 非永続化を必須化。
- rev2 (2026-06-30): 敵対デザインレビュー38件（critical6/high14/medium11/low7）反映。中核変更: ①要約/ack を **TUI スクレイプ→ファイル経由**（critical）②後継読込確認を **EventBus→ack ファイル＋liveness**（critical）③**耐久 intent 行＋state 機械（merge_intent 方式）**で double-spawn/audit 順序/crash 復旧（critical×3）④**in-flight 未コミット作業の保全＋worktree 非削除退役**（critical/high）⑤**Rust 境界 redaction**（critical/high）⑥計測は **grid 読取・robust proxy 一次・provider-honest 正直化**（high）⑦**verifier に audit no-loss 追加**（high）⑧**lineage SoR=checkpoints 表**・compaction 除外（high/medium）。line:citation drift 修正。

## 参照
- [CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md] codex 向け実装 handoff。
- [VISIBLE_AGENT_PANE_RUNTIME_SPEC.md] 可視エージェント境界（-p 禁止）。
- [AGENTS.md]/[docs/specs/README.md]/[docs/README.md] WU 索引・「1 WU を開く」・spec/verifier/status 同時更新。
