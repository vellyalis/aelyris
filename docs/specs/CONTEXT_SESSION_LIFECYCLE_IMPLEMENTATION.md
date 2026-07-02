# WU-RT-1 Implementation Handoff (for codex)

作成: 2026-06-30 ／ 改訂: 2026-07-01 (rev3, RT-1a0 provider matrix / standing token consent 反映)
対象読者: 実装を引き継ぐ codex（または任意の実装エージェント）。本書は **cold-start で着手できる**ことを目的とし、会話履歴なしで自己完結する。
親仕様: [CONTEXT_SESSION_LIFECYCLE_SPEC.md](./CONTEXT_SESSION_LIFECYCLE_SPEC.md)（WU-RT-1, rev2）。本書はその実装ブレイクダウン。spec が真・本書が手順。矛盾時は spec 優先で両方直す。

## 0. 使い方（codex cold-start）

1. 読む順: `AGENTS.md` → `docs/specs/README.md` → 親 spec → 本書 → 各フェーズが名指す owner file のみ。
2. **1 回に 1 フェーズだけ開く**（AGENTS.md「pick ONE Work Unit」）。各フェーズは独立に緑化・コミット。
3. 検証コマンド（Windows）:
   - Rust: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - FE 単体: `$env:AELYRIS_VITE_NO_ESBUILD_SPAWN=1; pnpm test`
   - 型/lint: `pnpm exec tsc --noEmit` ／ `pnpm exec biome lint <files>`
   - フェーズ verifier: `node scripts/verify-<name>.mjs`（新規作成→`verify:goal:safe` 配線）
   - ★**cargo と pnpm を Windows で並列実行禁止**（file lock / DLL init crash）。
4. 規約: 不変更新志向 / 小ファイル / 可視エージェントに `-p` 禁止 / コミットはフェーズ単位（attribution 無し＝リポ設定）/ push・PR・merge はオーナー許可後。
5. **禁止**: 既存基盤の重複実装（親spec §13 reuse 表）／統治に `record_audit_event`（journal 経路必須）／`snapshot`・`checkpoint` 名再利用（verb は `session_*`）／**handoff 中の `end_session_and_remove_worktree`**（後継の共有 worktree を消す＝作業損失）／**生 PTY バイトスクレイプでの構造化データ授受**（ファイル/grid 経由に統一, rev2 中核）。
6. ★rev2 設計原則（必ず守る）:
   - エージェントとの構造化データ授受は**ファイル経由**（要約も後継 ack も `.aelyris/handoff/` 配下のファイル）。TUI スクレイプは要約/ack に使わない。
   - 計測は **grid 読取（`term_snapshot`/GridSnapshot）** と頑健 proxy（status/時間/ターン）を一次に。`% context left` 行は補強。**provider-honest**（Claude/Codex/Gemini を RT-1a0 live matrix で採取し、fixture proof がない telemetry は fallback・confidence=unknown）。
   - 不可逆操作（退役）の**前に**耐久 intent 行（`session_handoffs`）と audit を置く。fail-closed（後継未確認なら退役しない）。

## 0.5 codex 運用プロトコル（毎フェーズ・恒久）

このリポで codex に WU-RT-1 を実装させる時の標準手順。**1 セッション = 1 フェーズ**。

**A. 読む順**: `AGENTS.md` → `docs/specs/README.md` → 本 spec の親 `CONTEXT_SESSION_LIFECYCLE_SPEC.md`(真) → 本書（§1 ゲート・§2 当該フェーズ・§5 DoD）→ そのフェーズが名指す owner file **だけ**。

**B. ゴール設定**: `IMPLEMENTATION.md §2` の**1フェーズだけ**を実装。**Definition of Done** = (1) 実装 (2) `cargo test --manifest-path src-tauri/Cargo.toml --lib` / `AELYRIS_VITE_NO_ESBUILD_SPAWN=1 pnpm test` / `pnpm exec tsc --noEmit` / `pnpm exec biome lint <files>` / **フェーズ verifier** 全緑 (3) そのフェーズに効く **§1 ゲート（SEC-1 / CX-1〜CX-4）充足** (4) reuse 表(spec §13)に反する重複なし。**成果物 = 「フェーズ完了・緑・ゲート充足」の報告**。

**C. commit は owner が行う**: codex はサンドボックスで `.git` に書けない（ACL 修正では直らない・設計上の read-only）。**codex は commit/branch/push を試さない**。緑報告 → **owner（commit できるセッション）が差分 review→commit→push**。codex の code WIP は報告まで未コミットで良い。

**D. フェーズ順 と ゲート対応**:
| フェーズ | 効くゲート(§1) | 備考 |
|---|---|---|
| RT-1a0 spike | — | ★**multi-AI-CLI live matrix**（Claude/Codex/Gemini。token 使用は standing owner consent 済み。native backend/CDP または visible PTY proof） |
| RT-1a 計測 | — | RT-1a0 の fixture 前提 |
| RT-1b 要約 | (CX-2) | ファイル経由・Rust redaction |
| RT-1c persist/restore | **SEC-1 / CX-1 / CX-3** | 最初に整えると最短（現 WIP が跨ぐ） |
| RT-1d handoff tx | — | no-loss verifier は最終 |
| RT-1e resume/reset | — | ack 再確認 |
| RT-1f UI | — | lineage/recycle |
| 横断（承認硬化） | **CX-4** | resolve 前 waiting_approval 検証 |

**E. 指示テンプレ（`<PHASE>`・`<GATES>` を差し替えて codex に渡す）**:
```text
WU-RT-1 の <PHASE> を実装する。ブランチは feat/wu-rt-1-context-lifecycle。
読む順: AGENTS.md → docs/specs/README.md → CONTEXT_SESSION_LIFECYCLE_SPEC.md(真) →
CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md(§0.5, §1 ゲート, §2 <PHASE>, §5 DoD) →
<PHASE> が名指す owner file だけ。1フェーズのみ・他は開かない。
守る: ファイル経由の授受(TUI スクレイプ禁止)/grid 読取＋頑健 proxy・provider-honest/退役前 intent＋audit・
fail-closed/handoff 中 worktree 削除禁止/verb=session_*/既存基盤を重複しない/PRE-1・PRE-2 は再実装しない。
このフェーズのゲート: <GATES>（§1 参照）。
検証: cargo --lib / (AELYRIS_VITE_NO_ESBUILD_SPAWN=1) pnpm test / tsc / biome / フェーズ verifier。
★cargo と pnpm を並列実行しない。.git 書込は試さない。
実装＋全緑＋ゲート充足まで終えたら「<PHASE> 完了・緑・ゲート充足」と報告(commit は owner)。
feat/approval-inbox には触れない。spec の穴は修正提案付きで報告。
```

**F. 推奨初手**: 現 WIP は RT-1a/1b/1c を跨ぐ。**まず RT-1c を1本に整えて緑化**（SEC-1／CX-1／CX-3 を同時に潰す）が最短。RT-1a0 spike は token を使ってよい（standing owner consent 済み）ので、次は Claude/Codex/Gemini の provider matrix を実機で埋める。

## 1. 前提の状態 と 現在の必須是正

### 済み: PR #4（PRE-1/PRE-2）は main に merge 完了（2026-07-01, `d6b0b95`）
承認インボックス＋PRE-1（分類は全文）＋PRE-2（Approve を決定的 Yes・Yes ハイライト限定検出）は **main に載っている＝WU-RT-1 のベース**。**codex はこれらを再実装しない**。参考として §1.9 に元の内容を残す。

### ★現在の必須是正（codex の WU-RT-1 WIP 由来。該当フェーズを commit する前に潰す）
- **SEC-1 [HIGH path-traversal] `session_checkpoint` の任意ファイル読取**（`src-tauri/src/ipc/interactive_commands.rs` の `summary_path` を無検証 `read_to_string`）。→ spec §6.2 準拠へ: **IPC は `summary_json`(inline) のみ**、または **backend 構築の `summary_files(worktree_path, logical_session_id, seq)` パス（`.aelyris/handoff/<id>.<seq>.json`）のみ読む**。外部パスを受けるなら `..` 拒否＋`std::fs::canonicalize`＋ベースディレクトリ配下検証。回帰テスト（ベース外/`..` 拒否）必須。**owner はこの是正まで RT-1b/1c を commit しない。**
- **CX-1 [codex review P1] commit 完全性**: RT-1 の新規ファイル（`agent/context_lifecycle.rs`/`agent/session_lifecycle.rs`/`persistence/session_checkpoint_repo.rs`/`shared/lib/contextTelemetry.ts`/**及び `package.json:90-93` と `verify:goal:safe` が参照する 4 本の verifier scripts**: `verify-context-proxy.mjs`/`verify-self-summary.mjs`/`verify-runtime-core-rt1a0-live.mjs` 等）は `mod.rs`/`package.json` が宣言済＝**commit 時に必ず `git add` 同梱**（漏らすと clean checkout で `verify:goal:safe` が module-not-found／ビルド失敗）。package.json/verify:goal:safe の配線は対応スクリプトと同一 commit で。
- **CX-2 [codex review / PRE-1b] 分類は無 elide 全文で**: `output_monitor.rs` の 4096字 `elide_middle` は >4096字で**分類前に中央を落とす**（危険/secret が中央のみだと分類・tooltip から消失）。→ 分類/review 用は無 elide の全文、clip は表示専用値に分離。
- **CX-3 [codex review P1] restore の二重配線を避ける（RT-1c）**: `restore_interactive_sessions`(`src-tauri/src/lib.rs`) は `adopt_sidecar_terminals` が既に subscribe/backfill 済みの sidecar PTY を**再 subscribe しない**（すると `run_output_monitor` が `pty-output-*`/native advance を二重化＝各 chunk が2回 render/parse）。→ **adopted stream を再利用、または session/status state のみ attach**。
- **CX-4 [codex review P2] stale 承認の書込防止**: fixed in this branch. `resolve_interactive_approval` now requires `expected_prompt_key`, re-looks up the live `InteractiveSessionManager` entry by PTY before any write, rejects unless the session is still `waiting_approval`, and compares the current captured `approval_prompt` fingerprint (`stableTextKey`/Rust `stable_text_key`). Missing or changed fingerprints fail closed with `stale_approval`; `GateMode::Atomic` and the `approval_resolved` audit event remain the delivery path. Regression coverage: `src-tauri/src/ipc/send_keys_commands.rs` stale-status/mismatch/matching-vector tests, `src/__tests__/decisionInbox.test.ts` shared fingerprint vectors, `src/__tests__/AppSilentBugs.test.ts` invoke/source-scan guard, and `scripts/verify-runtime-core-preconditions.mjs` CX-4 source assertions.

### 1.9（参考・実装済み）PRE-1: 危険分類はプロンプト**全文**で（描画時のみ切り詰め）
- 問題: `src-tauri/src/agent/output_monitor.rs` の `detect_permission_menu` が `elide_middle(prompt,300)` で**中央を落とした**文字列を `approval_prompt` にし、FE `src/shared/lib/decisionInbox.ts` の `typeFromText` がそれで分類 → 中央の `rm -rf`＋良性末尾が **medium 判定→危険を見せず承認**されうる。
- 修正: backend は分類用に全文保持（IPC 安全のため緩い上限、超過時のみ head/tail elide）。FE は `typeFromText(全文)` で分類、**中央省略は `DecisionInboxPanel.tsx` の描画時**（CSS clamp＋`title` 全文）に移す。`shortText` で分類前に削らない。
- 受入/テスト: 中央 `rm -rf`＋良性末尾 → `destructive_operation`/`critical`（`decisionInbox.test.ts`）。output_monitor に full 保持/ display elide 分離テスト。

### 1.9（参考・実装済み）PRE-2: Approve を決定的に「Yes」へ
- 問題: `src-tauri/src/ipc/send_keys_commands.rs:108` の approve は素 Enter＝カーソル位置を実行。`CURSOR_OPTION_RE`（`output_monitor.rs`）が yes|no 両方を受理 → No ハイライトでもゲート化＋人間がカーソル移動後 Approve すると Deny/「Yes, don't ask again」を実行しうる。
- 修正: (1) 検出を Yes ハイライト限定（`…\d+[.)]\s+yes\b`、No ハイライトは resolvable にしない）。(2) approve は明示的に Yes を選ぶ（候補: 数字「1」送出。★実キー挙動は実機 spike で確定）。
- 残リスク TOCTOU: 検出時 Yes→クリック前に移動。完全クローズは解決時 live ハイライト再読（RT-1a の grid 読取後に実装可能）。spec §14-3 に記載。
- ★実機 spike（RT-1a0 と共通）でカーソル glyph・option 番号・数字キー確定挙動を採取。

---

## 2. フェーズ別ブリーフ

依存: **RT-1a0(spike) → RT-1a(計測) → (RT-1b 要約, RT-1c persist) → RT-1d(handoff tx) → RT-1e(resume/reset) → RT-1f(UI)**。各「Goal / Owner files / Edit points / Contract / Reuse / Verifier / 受入 / Out-of-scope」。

### RT-1a0 実機 spike（必須前提・コードは最小）
- Goal: 実 Claude/Codex/Gemini CLI の visible bytes/grid で (a) 許可メニュー構造（カーソル glyph・option 番号・数字キー確定）と (b) context/usage telemetry の有無・形式を採取し fixture 化。Claude は「% context left until auto-compact」行フォーマットを確定し、Codex/Gemini は実 telemetry が取れなければ fallback・confidence=unknown を fixture で証明する。
- 手順: provider ごとに documented env（例: `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`）を設定し、native backend か packaged build で `AELYRIS_ENABLE_WEBVIEW2_CDP=1 pnpm tauri:dev` → CDP 9222 → `spawn_interactive_agent`(Bash 誘発 prompt) → `term_snapshot`（grid）／`capture_pane(stripAnsiCodes:true)`／`list_interactive_agents` で採取。token 消費は standing owner consent 済み。provider/model/command/artifact を記録し、secret/token file/transcript は保存しない。⚠ sidecar dev は monitor へ feed されるが計測/検出の最終確定は実機（[project_surface2_plumbing_done] 制約）。
- 成果物: `src-tauri/src/agent/__fixtures__/` 等に provider 別の実バイト/grid fixture。RT-1a/PRE-2 の gate はこの fixture matrix で確定。
- Out-of-scope: 実装本体。

### RT-1a 計測（context-size プロキシ＋トリガ）
- Goal: 頑健 proxy 一次＋Claude grid 残量で warn/hard トリガ。
- Owner files: `output_monitor.rs`、`interactive.rs:322`（`last_activity`/`context_pct`/`logical_session_id` 追加は RT-1c と調整）、`interactive_commands.rs`（`run_output_monitor` parse / grid 読取）、`src-tauri/src/ipc/commands.rs`（`term_snapshot`/GridSnapshot）、FE `workstationSummary.ts:48`/`ContextGauge.tsx`/`budgetStatus.ts`。
- Edit points: (1) 一次 proxy=status 遷移＋wall-clock＋ターン数（idle 遷移カウント）。(2) Claude 残量は **grid 読取**（`term_snapshot`）で拾う＋必要なら periodic `/context` 注入。生バイト正規表現に依存しない。(3) 閾値は**既存 `contextWarnPct`(85)/`ContextGauge`(60/80/95) を再利用**（新定数を増やさない）。per-session window は `cost/mod.rs over_budget` 範。
- Contract: confidence ラベル必須。Codex/Gemini は provider-specific fixture が exact/parsed を証明するまで時間/ターン fallback・unknown。
- Reuse: `detect_permission_menu`/`MENU_BUFFER`（構造検出前例）、`TelemetryConfidence`、`getMaxTokens`。
- Verifier: `scripts/verify-context-proxy.mjs`＋Rust 単体（RT-1a0 provider fixture matrix で残量・閾値・confidence）。
- 受入: fixture から context% 抽出＋warn/hard 発火。provider-specific telemetry が無い CLI は fallback・unknown を明示。
- Out-of-scope: handoff 実行（RT-1d）。

### RT-1b 退役前セルフ要約（ファイルベース）
- Goal: 退役エージェント本人に**要約をファイルへ書かせ**、受領・redact・外部突合検証。
- Owner files: `interactive_commands.rs`（駆動 `PtySidecarClient::write` `pty_sidecar.rs:358`／`.done` 監視＋ファイル読取）、新 Rust redaction utility（`src-tauri/src/...`）、スキーマ範 `src/shared/lib/contextPack.ts`。
- Edit points: (1) `SummaryDoc`(`aelyris.session.v1`) 型（親spec §6.1）。(2) 駆動: **対象が `DetectedStatus::Idle`/OSC133 prompt-mark の時のみ**、warn/タスク境界で「§6.1 を `<worktree>/.aelyris/handoff/<logical_session_id>.<seq>.json` に Write し、完了後 `…/<…>.done` を作れ」を注入。(3) 受領: `.done` 出現→JSON 読取（TUI スクレイプ禁止）。(4) **Rust 境界 redaction**（PEM/JWT/AWS・GCP/`user:pass@`/高エントロピー）を persist 前 AND audit payload 前に適用。(5) 完全性検証: `inFlightDiff`↔`git status`、`currentTask`↔`task/graph.rs`、`decisions`↔ContextStore。不合格で handoff 中断。
- Contract: 最小継続集合。`inFlightDiff` 必須。secret は redact 後のみ耐久化（untrusted boundary input 扱い）。idle 未到達で hard 到達なら要約なし checkpoint にフォールバックせず中断（fail-closed）。
- Reuse: `contextPack.ts`（スキーマ＋FE redact パターン移植元）、`detect_permission_menu`（idle/prompt-mark 検出）。
- Verifier: `scripts/verify-self-summary.mjs`（注入→ファイル受領→スキーマ妥当→redact で secret 不在→外部突合）。
- 受入: 合成出力からファイル要約を受領、secret 不在、不完全要約を reject。
- Out-of-scope: 永続化（RT-1c）、退役順序（RT-1d）。

### RT-1c checkpoint / 永続化 / restore
- Goal: session 状態＋要約 ref を耐久化、安定 session id、再起動復元、handoff state 表。
- Owner files: 新 `src-tauri/src/persistence/session_checkpoint_repo.rs`、`src-tauri/src/db/migrations.rs`（新表）、`interactive.rs:322`（`logical_session_id`/`last_activity`）、`src-tauri/src/lib.rs`（`restore_interactive_sessions`）、`commands.rs:1869`（`adopt_sidecar_terminals` 協調）、`db/queries.rs`（`agent_identity_records.context_usage_json` を live 書込へ）。
- Edit points: (1) `session_checkpoints` 表＋`session_handoffs` state 表（親spec §8.1、UNIQUE・トリガは `merge_intents` 範）。(2) `SessionCheckpointRepo`(load_all/upsert)。原子書込は `mux/store.rs` の tmp+rename か SQLite tx。(3) `logical_session_id`（pty 独立）＋`last_activity`。(4) `restore_interactive_sessions`＋boot `reconcile_dangling`。(5) per-session proxy は既存 `context_usage_json` に書き、新表と二重管理しない。
- Contract: checkpoint 冪等。`ManagedDb::with`(`db/mod.rs:33`) は tx でない→原子性は intent 行＋CAS で。★**§1 SEC-1（summary_path 任意読取）・CX-1（新規ファイル同梱）・CX-2（分類は全文）をこのフェーズで満たすまで owner は commit しない。**
- Reuse: `ContextStoreManager`/`TaskRepo`/`tasks_for_restore`/`FileMuxSnapshotStore`/`merge_intent/store.rs`。
- Verifier: `scripts/verify-session-checkpoint-restore.mjs`（再起動シミュで復元・id 安定・idempotent）。
- 受入: 再起動跨ぎで session メタ復元、二重 checkpoint で重複なし。
- Out-of-scope: handoff 配信（RT-1d）。

### RT-1d handoff トランザクション（no-loss）＋統治
- Goal: intent→checkpoint→audit→後継 spawn(seed)→後継 ack ファイル＋liveness→旧退役 を fail-closed/冪等。
- Owner files: `interactive_commands.rs`（spawn/stop の合成）、`control/loop_ports.rs`（`build_adr_header` 範の seed）、`event_bus/mod.rs`（variant）、`audit.rs`（journal）、`supervisor/escalation_sink.rs`（durable 半分の範）、`merge_intent/store.rs`（intent/CAS/reconcile 範）。
- Edit points（親spec §7 の順序を厳守）:
  1. **耐久 intent 行**を先に（`session_handoffs`：predecessor_id＋**事前採番 successor logical_session_id**＋handoff_seq＋state=pending_summary、UNIQUE で double-spawn 防止）。
  2. `session_summarize`（§RT-1b）＋**inFlightDiff 非空なら退役前に `commit_worktree`/`git stash create` で durable ref 化**し checkpoint 記録。state→checkpointed。
  3. `session_checkpoint`（耐久化 commit 待ち）。
  4. **退役前に handoff audit を journal append**（§9、`session_handoff committing`）。state→successor_spawning。
  5. 後継 `spawn_interactive_agent` を**要約ファイル参照シード**（「checkpoint の要約ファイルを最初に読め。読了後 `…/<successor>.ack` を Write せよ」）。state→successor_spawned。
  6. **後継 ack ファイル**観測（EventBus::since ではない＝CLI publish 不可）**＋後継が running/idle に達し debounce 窓生存**を確認（ack=読込, liveness は別）。state→successor_acked。
  7. **確認後にのみ** predecessor を **`stop_interactive_agent`（kill のみ・worktree 非削除）**で退役。lineage を checkpoint 確定。`session_handoff committed` audit。state→predecessor_retired。
  8. 失敗時: 後継未確認なら退役しない。`session_handoff failed` audit。
- crash 冪等: idempotency-key=`predecessor_id:handoff_seq`。**boot `reconcile_dangling`** が `session_handoffs` を走査し live PTY/worktree を実検査して一意収束（restore-pending は使わない＝lineage/retire intent を運べない）。
- Contract: 後継未確認で旧退役なし。lineage=`predecessor_session_id`。1 handoff=1 correlation_id。
- Reuse: `escalation_sink`（durable 半分）、`AuditJournalAppend`（session_id/correlation_id/payload_json 既存）、`emit_agent_fleet`。
- Verifier: **`scripts/verify-session-handoff-no-loss.mjs`（必須）**。assert: context 無損失（checkpoint 耐久＋後継 ack＋旧解放＋inFlightDiff 復元）AND **audit 無損失**（journal に `session_handoff`＋correlation_id、`get_audit_trace` 返る）AND crash 注入で「両退役なし/二重 spawn なし/worktree 非削除」。
- 受入: 無損失 handoff、crash 半完了から一意収束。
- Out-of-scope: resume/reset 単独 verb（RT-1e）。

### RT-1e resume / reset_context
- Goal: crash/再起動からの再構成（冪等・ack 再確認）＋handoff-to-self。
- Owner files: `interactive_commands.rs`、`interactive.rs`（spawn seed）、`shared_brain.rs`（再シード read model）。
- Edit points: `session_resume`（`session_handoffs` state を読み一意収束。**過去 ack を信用せず再確認**）、`session_reset_context`（predecessor==self の handoff＝§7/§9 と同規律、worktree 非削除退役）。workflow resume 語彙（`workflow/executor.rs`）は語彙のみ範。
- Reuse: RT-1c restore、`shared_brain::snapshot`。
- Verifier: `scripts/verify-session-resume-idempotent.mjs`（crash 注入→resume×2 が同一結果、ack 再確認）。
- 受入: resume 冪等、reset_context が §11 verifier 対象。

### RT-1f UI / 可視化
- Goal: リサイクル可視遷移＋lineage（A→B→C）表示。
- Owner files: FE `AgentInspector.tsx`、`ContextGauge.tsx`、`agentFleet.ts`/`src-tauri/src/agent/session.rs:62`。
- Edit points: `handoffFrom` を FE-only から耐久 backend（checkpoints lineage）由来へ。recycle を `emit_agent_fleet` で可視化。`AgentRunStatus` に `summarizing`/`retiring`。
- Verifier: `src/__tests__/` に lineage 表示＋recycle 遷移テスト。
- 受入: inbox/inspector で lineage と recycle が見える。

---

## 3. 共有契約（フェーズ横断）

- **verb**: `session_checkpoint`/`session_summarize`/`session_handoff`/`session_resume`/`session_reset_context`（IPC＋MCP）。
- **handoff ファイル規約**: 要約 `<worktree>/.aelyris/handoff/<logical_session_id>.<seq>.json`＋完了印 `.done`。後継 ack `<worktree>/.aelyris/handoff/<successor_id>.ack`。`.gitignore` に `.aelyris/` を追加。
- **SummaryDoc**(`aelyris.session.v1`): goal, currentTask{id,status,subtasks}, decisions[key], openQuestions[], files[], symbols[], inFlightDiff{present,disposition,ref}, nextAction, risks[]。**Rust 境界で redact 後のみ**耐久化。
- **state 機械**(`session_handoffs.state`): pending_summary→checkpointed→successor_spawning→successor_spawned→successor_acked→predecessor_retired／failed。
- **イベント/監査**: EventBus `SessionHandoff`/`ContextRecycled`（mod.rs round-trip テスト）。Audit Journal kind `session_handoff`/`context_recycled`（**journal 経路のみ・退役前 append・compaction 除外**）。lineage SoR=`session_checkpoints.predecessor_session_id`、correlation_id=1 handoff。
- **計測**: `ContextRemaining{pct, confidence(exact|parsed|estimated|unknown)}`。

## 4. グローバル受入・スモーク・リスク

- 各フェーズ: cargo --lib／vitest／tsc／biome／フェーズ verifier 緑。フェーズ単位コミット。
- **実機スモーク（RT-1a0/PRE-2 必須）**: §RT-1a0 手順で Claude/Codex/Gemini のメニュー構造・context/usage telemetry を採取し検出器/ fallback を確定。token spending は standing owner consent 済み。
- リスク（親spec §14）: TUI フォーマット drift・要約劣化・承認 TOCTOU・session==pty 波及・CLI 内部 compaction 競合・実機依存・コスト。

## 5. Definition of Done（フェーズ共通）

1. owner file のみ変更（スコープ厳守）。2. 全ゲート＋フェーズ verifier 緑（`verify:goal:safe` 配線）。3. spec 該当節と本書を実装に合わせ更新（同時）。4. reuse 表（親spec §13）に反する重複なし。5. 統治は journal 経路・退役前 audit。6. ファイル/grid 経由（TUI スクレイプ禁止）。7. handoff 中 worktree 非削除。8. コミットはフェーズ単位・attribution 無し。push/PR/merge はオーナー許可後。
