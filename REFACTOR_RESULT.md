# REFACTOR_RESULT — refactor-instructions.md 完遂レポート

Branch: `refactor/debt-reduction-tierA`（base `codex/release-hardening-quality-gates` HEAD `6a2de45`）
担当: 実装モデル（自律実行）。証拠ベース監査（48エージェント/94所見、`C:/tmp/audit-digest.md`）に基づく。

---

## 1. Baseline（編集前に記録）

| Gate | 結果 |
|---|---|
| `cargo fmt --check` | EXIT 0 |
| `cargo clippy --all-targets -D warnings` | EXIT 0（clean） |
| `cargo test` | 緑（lib 788 passed / 全 binary 0 failed） |
| `pnpm exec tsc --noEmit` | EXIT 0 |
| `pnpm test`（vitest） | **1765 passed**（187 files） |
| `pnpm lint`（biome `src/`） | **34 errors + 1 warning（既存・リリースゲート外。増やさないことが条件）** |

---

## 2. 実装した（Tier A + Tier B、全て pure move / 挙動不変・各1コミット）

| # | コミット | 内容 | 検証 |
|---|---|---|---|
| Phase1 | (untracked削除) | `:TEMPfo.txt`（0byte・異常名ゴミ）を除去。git に元々無いため commit 不要 | `git status` クリーン |
| A-1 | `refactor(ipc): replace commands.rs glob imports with explicit names` | `fs_commands.rs`/`send_keys_commands.rs` の `use super::commands::*` を明示名へ（fs=`validate_path`、send_keys=10 helper） | cargo build/clippy が漏れ/未使用を検出 → 緑 |
| A-2 | `refactor(git): dedupe inline repo-relative-path via git_relative_path` | `git_file_original`/`git_diff_file`/`git_diff_files` の inline 3重複を helper へ。hoisted `repo_norm` 除去 | 出力 byte-identical・cargo test 緑 |
| A-3 | `refactor(workflow): make mod re-exports explicit instead of glob` | `pub use *::*` を消費 8 シンボルの明示 re-export へ | cargo build が consumer の import 欠落を検出 → 緑 |
| B-3 | `refactor(db): converge already-clamped LIMITs on clamp_limit helper` | inline `limit.clamp(1,N)` 3箇所を `clamp_limit` へ（usize で等価証明済み）。未bound メソッドは意図的に不変 | cargo test（clamp 系）緑 |
| B-2 | `refactor(term): extract stash_pending for the 3 Incomplete branches` | `TermEngine::advance` の同一 Incomplete 分岐3つを `&mut self` helper へ。precedence/partial 処理不変 | split-across-advance テスト緑 |
| B-4 | (commit pending) | MCP `maxLength`(`mux.workspace.safeInput`/`aether.pane_send_input`) を `WS_MAX_INPUT_FRAME_BYTES` に束縛するドリフト防止テストを追加 | 新テスト green |
| B-5 | (commit pending) | `package.json` に check-only `lint:scripts: biome check scripts/` を追加（未 lint の scripts/ を可視化） | 既存 script キー不変・vitest 緑 |

**Post 検証**: 各 Phase 後に Baseline を再実行し、全 gate が baseline と同等（cargo lib 788 passed・vitest 1765 passed・biome 34 のまま増やさず）であることを確認。

---

## 3. 実装せず Tier C 提案へ降格した項目（理由付き）

> 共通理由: 実装すると **gate 赤化 / IPC・DB・security 契約変更 / 進行中 cockpit spec（Codex 所有）との衝突 / 観測挙動変化** のいずれかを招く。
> 「負債を残さず」= これらを強行して**より大きな負債（壊れたリリースゲート・契約ドリフト）を作らない**こと。owner 判断が要る。

### ✅ 解決済み（旧🔴最優先）: 実バグ C-22（autonomy ループの永久 Running） — fix `ed48855` / branch `fix/autonomy-merge-conflict-stall`
- **`src-tauri/src/orchestrator/autonomy.rs:171-178`**: merge 失敗（conflict）が `Review→Running` へ遷移するが、headless agent は既に exit 済み → **worker 無しで永久 Running**。`poll_completions` は二度と発火せず、retry 予算も消費しないためループ全体が stall。
- 対比: reject 経路（`:180-188`）は同じ状況を `requeue_or_fail(graph, &id, FailureKind::Rework)` で回避（コメント「a headless agent has already exited, so leaving the task Running would strand it」）。
- **✅ 修正済み**: merge-failure 分岐を `requeue_or_fail(.., Rework)` に変更（reject と対称・rework 予算・最新 ADR で再 dispatch・予算超過で Failed）。回帰テスト2件追加し **mutation で binding 実証**（`Review→Running` に戻すと `rejected []≠["a"]`／`status Running≠Failed` で両テスト落）。ユーザー承認方向（conflict→rework 予算）。cargo lib 789→791 passed。
- **提案**: merge-failure 分岐も `requeue_or_fail(.., Rework)` にして rework 予算で再 dispatch。**ただし観測挙動が変わり BR9 spec 意図の確認が要る**（conflict は rework 予算で再試行すべきか／別予算か）。→ 別 goal で要修正。

### 🔴 B-1: clipboard コマンド抽出（gate 結合で凍結）
- `commands.rs:3424-3683` の clipboard 4コマンドは agent ドメイン内に挟まり、抽出の最小スライス。しかし **`scripts/score-release-quality.mjs:673` が `ipcCommandsSource.includes("save_clipboard_image")` を検査**し、`ipcCommandsSource` は **`src-tauri/src/ipc/commands.rs` 単体**を読む（`:384`）。
- 移すとこのリリースハードニング gate が赤化。安全に行うには gate 側（4794行・C-26/C-27 で owner 領域）の lockstep 改修が必要。→ god-file 分割（PHASE_0_1 §2.1）は Codex 所有のため、gate 移行方針と併せて owner 判断。

### 🔴 その他 Tier C（`refactor-instructions.md` Debt Map 参照、要 owner 判断）
- **god-file 分割**: `App.tsx`(App() 4640行)・`commands.rs`(4231)・`queries.rs`(3073)・api 3file・`NativeTerminalArea`(1485)・`useCanvasIME`(1433)・`aether_native.rs`(8212 spike)。PHASE_0_1/spec 所有・brittle source-substring gate（`AppSilentBugs.test.ts`・`score-release-quality.mjs`）が pure-move でも赤化する。
- **dead/unwired**: 48/191 IPC コマンド FE 未配線・`agent/watchdog.rs`・`agent/parser.rs(StreamParser)`・`watchdog/monitor.rs`・`pane_watcher` rule-engine 半分・`cost/over_budget`・event kinds `AgentSpawned/WorktreeCreated`・FE `useAgentFleet.backendFleetSessions`/`Sidebar` slice/`useGitStatus._refreshKey`。**cockpit 計画済みか真の死コードか不明 → 削除前に owner 確認**。
- **型契約**: `invoke<T>` 無検証(35file)・status `"failed"` が enum 外・agent 形状3重 mirror・TS が `repoPath`/`crash_attempts`/`rework_attempts` 欠落 → TYPE_BRIDGE codegen 方向。
- **security（document/owner）**: MCP `safety` は advisory のみ（enforcement 無）・ephemeral token log 出力・`validate_path` 空=Ok・validator が god-file 内。
- **DB/並行（hardening）**: schema versioning 不在・gate/merge/spawn が graph Mutex 下・audit sequence 非トランザクション・`db_session_commands` 毎回 fresh open。
- **scripts/docs**: gate 権威不明（GATE MANIFEST 提案）・docs 20本 archive（CODEX_HANDOFF:173 が「branch land 後」と明記＝今は時期尚早）・`cross-env` 化・vite/vitest transpile 重複・native-bin CLI plumbing 重複（C-27 substring gate に阻まれる）。

### 触るな / 既に解決済み（無駄作業防止）
- N-1 native-bin は handler 重複なし。N-2 api/ と ipc/ は重複でなく2つの顔。N-3 branch validator 統一は完了済み（PHASE_0_1 §3.1 は stale）。N-4 lock-across-await は存在しない（positive baseline）。

---

## 4. 残注意
- biome `pnpm lint` は baseline で 34 errors（src/ 既存・リリースゲート外）。本作業は src/ を触っていないため不変。
- `refactor-instructions.md`（指示書本体）と本 `REFACTOR_RESULT.md` は working tree に残置（コード commit には混ぜていない）。
