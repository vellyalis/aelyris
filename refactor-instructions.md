# refactor-instructions.md

> 渡し方: 実装担当モデル（Codex / Opus 等）に
> 「/goal refactor-instructions.md に書かれたことを完遂しろ」で渡す。
> これは**負債削減リファクタリング専用の作業指示書**であり、機能追加・UI 改修の指示書ではない。
> 目的は **既存仕様を壊さず・負債を減らし・今後変更しやすくする** こと。見た目の綺麗さは目的ではない。
>
> 根拠: 13サブシステム深掘り＋4横断スイープ＋敵対的検証（48エージェント・94所見）による証拠ベース監査。
> 各所見の完全な file:line 証拠は `C:/tmp/audit-digest.md`（このリポジトリ外・監査ダイジェスト）にある。
> 本書の主張は全て監査で裏取り済み（過大主張は降格済み）。**証拠なき大規模削除・全面書き換えは禁止。**

---

## Objective

Aether Terminal（Tauri v2 + React 19 + Rust）の技術的負債を、**挙動を一切変えずに**段階的に削減する。スコープを3層に分ける:

1. **今すぐ実装してよい安全な整理（Tier A）** — 敵対的検証で「pure move・契約に触れない・安全」と確認済みの少数項目のみ。
2. **条件付き（Tier B）** — 内部限定・テスト付きで安全だが前提確認が要る項目。
3. **提案のみ（Tier C）** — IPC契約 / DB schema / セキュリティ境界 / native binary / 進行中 cockpit spec に触れるもの、複数設計案があるもの、観測挙動が変わるもの。**実装せず質問・提案として報告**。

**禁止**: 機能の追加・削除・仕様変更、UI見た目変更、Tier C の独断実装、無関係な整形、ついでのリファクタ。
すべての変更は **pure move / behavior-invariant** を死守。1つでも観測挙動が変わるなら止めて質問する。

---

## Project Understanding（証拠ベース）

### これは何か
Windows 向け「プロジェクトファースト AI ワークスペースターミナル」。Tauri v2（Rust backend + React/TS frontend）。
ターミナル（ConPTY + native engine）/ Monaco エディタ / ファイルツリー / **多エージェント自律開発コックピット**（worktree並列・gated merge）/ git / workflow を統合。**local-only**（GitHub remote / CI なし）。

**現在地（最重要）**: 「コックピット化」設計が進行中で **Codex が実装担当**。権威 spec は `docs/specs/`:
- `docs/specs/CODEX_HANDOFF.md` = マスタープラン（Work Unit・依存DAG・受け入れ基準・do-not-break §6）。
- `docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md` = god-file 分割（`commands.rs` §2.1 / `App.tsx`）・runtime統一の設計。
- `docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md` = 要件の権威（BR4-9）。
**本書は spec と矛盾してはならない。** spec が既に分割方針を持つ箇所（commands.rs / App.tsx 等）は spec に従い、独断で別案を進めない。

### 主要エントリーポイント
- Rust: `src-tauri/src/lib.rs`（Tauri エントリ。`:591` が `generate_handler!` で **191 コマンド**登録）, `main.rs`。
- ネイティブ spike binary: `src-tauri/src/bin/aether_native.rs`（8212行・**未出荷の spike**）, 出荷 CLI `src-tauri/src/bin/aetherctl.rs`（PTY sidecar 制御）。
- Frontend: `src/App.tsx`（`App()` は ~4640行の god-component, 2285-6927行）, `index.html`。
- IPC seam: `src-tauri/src/ipc/`（29ファイル・191 `#[tauri::command]`。既に28個の `*_commands.rs` へ部分分割済み、`commands.rs` 4231行が残渣）。
- HTTP/MCP: `src-tauri/src/api/`（loopback Axum + `aether.mcp.v1` 51 verb）。

### 主要モジュールと責務（Rust）
`pty/`,`term/`(ConPTY+native engine) / `agent/`(headless+interactive session) / `orchestrator/`+`control/`(自律ループの純粋brain+adapter) / `task/`,`event_bus/`,`context_store/`,`cost/`,`knowledge_graph/`,`intent/`(cockpit v2 subsystem) / `git/`,`ghostdiff/`(diff overlay + apply-to-main) / `watchdog/`(tool承認gate+auto-repair) / `review/`,`failure_policy/`,`file_ownership/`(merge適格・lane分離) / `db/`(SQLite) / `api/`(MCP) / `lsp/`,`workflow/`,`config/`,`mux/`。

### データの流れ
FE 操作 → React(`features/*` + Zustand `useAppStore`) → `invoke("<cmd>")` → `ipc/*_commands.rs`（serde camel↔snake）→ ドメインmodule → 結果 or event emit（`agent-event` 等）→ FE 購読。
自律ループ: `orchestrator::autonomy::step`（純粋 `&mut TaskGraph` 状態機械）を `control::loop_ports::run_step` が graph Mutex 下で駆動。IPC face（`orchestrator_step`）と MCP face（`aether.orchestrator.step`）が同一 `run_step`／同一 state を共有。

### 外部依存
Tauri v2 plugins（dialog/notification/opener/process/updater）、xterm代替の native canvas、Monaco+monaco-vim、Radix UI、motion、zustand、marked+dompurify（MD描画）、git2-rs、rusqlite、portable-pty(vendored, ConPTY passthrough)、tokio、axum。`gh` CLI（PR Inspector）。

### 現在の検証コマンド（→ Baseline Commands に正式版）
`pnpm exec tsc --noEmit` / `pnpm test`(vitest) / `pnpm lint`(biome `src/` のみ) / `cargo test` / `cargo clippy --all-targets -D warnings` / `cargo fmt`。
加えて `scripts/` に ~107 本の `verify-*.mjs`。**release-blocking は実質 `verify-release-gate.mjs` → `verify-production-release-gate.mjs` の2本のみ**、`score-release-quality.mjs` は `.codex-auto/**` の証拠JSONを読むだけ。残りは operator probe（→ 権威が不明＝Debt C-22）。**CI なし**（local-only）。

---

## Behaviors To Preserve（絶対に壊してはいけない既存挙動：監査抽出）

### IPC / 契約
1. **登録↔定義パリティ**: 定義された 191 `#[tauri::command]` 名 == `lib.rs:591` の登録 191（監査で集合差ゼロ確認）。rename/move は lockstep。漏れるとコマンドが消える。
2. **`invoke()` 文字列 == Rust 関数名(snake_case)**。例 `src/shared/lib/nativeClipboard.ts:30` `invoke("write_clipboard_text")` ↔ `commands.rs:3454`。`AppSilentBugs.test.ts:290` が文字列をアサート。rename は FE を無言で壊す。
3. **`ipc/mod.rs` の glob 再エクスポート**（`pub use commands::*`）が `ipc::<cmd>` 解決の経路。新ファイル分割時は `mod`+`pub use` を必ず追加。
4. **統一エラー契約**: fallible コマンドは全て `Result<T, String>`（136個・非String型ゼロ）。FE は文字列 reject に依存。E型を変えない。
5. **`commands.rs` の共有 helper**（`validate_path`,`normalize_cwd`,`record_audit_event`,`persist_command_block`,`capture_if_enter`,`terminal_write_async`,`OutputBufferRegistry` 他）は5兄弟ファイルが import。crate パス解決を維持。
6. **`capture_if_enter`('\r' で UserSubmitted snapshot)** は全 write-side IPC の共通点（time-travel timeline）。per-command 重複に退行させない。

### セキュリティ境界
7. **`validate_path`/`is_dangerous_path`**(`commands.rs:570/665`): ParentDir/NUL/UNC/system-dir 拒否＋canonicalize。全 `fs_commands.rs` 書込を gate。意味を変えない（空文字は意図的に `Ok` = soft no-op）。
8. **watchdog**: 無効時は全て AskUser（`engine.rs:31`）、default `enabled=false`（保守的 opt-in）。first-match-wins・case-insensitive glob を維持。
9. **IPC の `analyze_agent_stream_line` は advisory のみ**（`commands.rs:3056`、AutoDeny は log/emit のみで headless 子を止めない）。実enforcement は MCP `aether.request_approval`（`mcp.rs:961`）だけ。この非対称を前提に。
10. **merge は構造的にのみ gate**: `aether.request_approval`/`request_merge` は queue するだけ、実 git merge は `aether.review.approve`（`mcp.rs:1102`）が pending→merging を lock 下で claim してから。MCP `safety` フィールド（FREE/GATED）は**宣言的メタデータで enforcement ではない**（C-18）。
11. **review() 適格**: 全gate緑 AND reviewer≠implementer（`review/mod.rs:64`）。self-review は緑でも short-circuit で Block。BR9 補償制御＝緩めない。
12. **MD描画の二層防御**: `EditorPanel.tsx:386` で `DOMPurify.sanitize(marked.parse())` ＋ `MarkdownPreview.tsx:39` の `sandbox="allow-same-origin"`(no allow-scripts) iframe。両層を一緒に保つ。
13. **branch名検証**: `git::validate_branch_name`(`worktree.rs:174`) が唯一の validator（`..`/先頭`-`/`:`/非ASCII拒否）。全 merge/worktree/spawn が依存。**（注: PHASE_0_1 §3.1 が「private を public 化＋inline削除」と書くが既に完了済み＝C-23、再実装するな）**。
14. **process spawn は argv ベース**（`agent/claude.rs`・`process.rs`、shell 不使用）＝injection-safe。AI CLI allowlist（`interactive.rs:110`）を緩めない。

### 自律ループ / 並行
15. **autonomy::step は純粋**（`&mut TaskGraph`・lock/await/spawn なし）。両 face は唯一の `TaskManager` Arc + graph Mutex に serialize。**MCP face に別 TaskManager を与えない／background spawn で自動駆動しない**（single-flight 崩壊）。
16. **step 全体が graph Mutex 下**で、metadata は pre-step snapshot から読む（`loop_ports.rs` は re-lock しない＝deadlock 回避、std Mutex は非再入）。
17. **crash と rework は別予算**（`MAX_CRASH_ATTEMPTS`/`MAX_REWORK_ATTEMPTS`, `autonomy.rs:25-30`）。混ぜない。
18. **patterns_overlap は意図的に保守的（over-flag）**（`file_ownership/mod.rs:130`）。検出器 AND dispatch gate（`autonomy.rs:232`）。緩めると2エージェントが同一ファイル書込。
19. **PTY**: 1 PTY=1 reader thread→broadcast（`manager.rs`）。`take_child` one-shot・Drop が唯一の child owner。lock 順は `instances → per-instance(output_buffer/child)`、reader thread は inner のみ（ABBA 回避）。
20. **image escape（Kitty/Sixel/chunked OSC 1338）は alacritty に転送しない**（grid garbage 化）。OSC133 は転送（VTE 整合）。`engine.rs:199-272` の precedence（image→chunked-OSC→OSC133）を保つ。
21. **AgentManager::reap** は exit code で succeeded/failed 分割し各 session を高々1回報告（`claude.rs:246`）。autonomy 回復はこの分割に依存。**Drop は `Arc::strong_count==1` 時のみ stop_all**（request-scoped clone の drop で全 agent を殺さない）。

### DB / 永続化
22. **全 SQL は parameterized**（`params![]`/`?N`・`(?N IS NULL OR col=?N)`）。`format!` で bind を置換しない（injection）。
23. **migration は bootstrap のみ**（`CREATE TABLE IF NOT EXISTS`・冪等・毎起動可）。append-only trigger と sequence-repair を保つ。**（注: schema versioning 不在＝C-19、column 追加は既存DBに届かない）**。
24. **audit journal redaction**（`redact_audit_payload` 他, `queries.rs:2064`）は永続化前に secret を除去。read は redacted のみ。security 境界。
25. **`ManagedDb::with()` Mutex**（`mod.rs:31`）が managed 接続の唯一の直列化。非アトミック多文（`next_audit_sequence` 等）はこれに依存。第2 writer を足さない。

### Frontend
26. **appStore setter は localStorage へ自己永続化** ＋ boot は `load_app_config`(config.toml) で rehydrate（`App.tsx:2353`）。localStorage キーと config 経路の両方が永続化契約。
27. **`mergeAgentSessions`**（`useAgentManager.ts:64`）は backend に無い FE session を**意図的に履歴として残す**（live→done マーク）。backend 行で置換するとログ/系譜を失う。
28. **TaskStatus / AgentRunStatus の serde snake_case 名**は TS 契約テスト（`taskStatusContract.test.ts` 等）と lockstep。rename はテストを壊す。
29. **`RIGHT_RAIL_COMPATIBILITY_CLIENT` マーカー文字列**は `verify-full-native-rust-gap-audit.mjs:967` が substring 検査。consolidate しても文字列を発見可能に保つ。

### Build / gate
30. **`verify-release-gate.mjs`** は package.json script 文字列（`requiredPackageScripts`）と version lockstep（package.json==tauri.conf.json）をアサート。これら npm script 名/値を byte-identical に保つ。
31. **`AppSilentBugs.test.ts`**（161KB）は package.json / App.tsx / commands.rs / lib.rs 等の**ソース文字列**を ~80箇所 readFileSync でアサート（PHASE_0_1 §4.3 が App.tsx 分割の gate と明記）。pure-move でも文字列が動くと赤化＝C-24。
32. **`AETHER_VITE_NO_ESBUILD_SPAWN=1`** は transform pipeline 全体を切替（env-inline chain）。`vite-windows-net-use-shim.cjs` は Windows EPERM 回避。どちらも load-bearing。
33. **`score-release-quality.mjs`** は両 binary の**ソース substring**（関数名・Win32 API名・JSON literal）をアサート（`:1017-1048`）。native-bin の pure-move でも赤化（C-25）。`.codex-auto/**` の JSON キー形状も暗黙契約。

---

## Non-Negotiables

- **読んでいないコードは変更しない。** 編集前に必ず Read。
- **pure move 死守**: 移動時に公開シグネチャ・型・SQL・`invoke` 文字列・gate 用ソース文字列を変えない。rename・引数変更・「ついで改善」を混ぜない。
- **single source of truth** を増やさない（二重所有・FE 再合成を作らない）。
- **型契約を緩めない**（新規 `as`/`any`/無検証 optional/`invoke<T>` 盲信を増やさない）。
- **死コード・未配線インフラの削除は Stop And Ask に従う**（cockpit 計画済みかもしれない）。勝手に消さない。
- **各フェーズで全ゲート緑**を維持。
- `cargo test` と `pnpm test` を**並列実行しない**（link.exe 競合・CLAUDE.md）。
- 観測挙動が変わる変更は実機 `pnpm tauri dev` で視覚確認（vitest 緑だけでは UI/IME 退行を見逃す）。本書スコープでは原則 Tier A/B で挙動不変。

---

## Stop And Ask Conditions（実装せず提案＋質問にする）

1. pure move のはずが、公開シグネチャ・型・SQL・`invoke` 文字列・gate 用ソース文字列の変更が必要になった。
2. テストと実装が矛盾（どちらが正か不明）。
3. 削除候補が本当に未使用か確証できない（`generate_handler!` 登録・MCP catalog・gate script・spec 参照を grep で要確認）。
4. 公開 IPC / DB schema / migration / 保存済みデータに影響しうる。
5. 認証・通知・外部連携（`gh`/MCP/Tauri updater/AI CLI 起動）に影響しうる。
6. 互換性を壊しうる（native binary 統合、serde rename、enum 拡張 等）。
7. 設計案が複数あり、プロダクト/アーキ判断が必要。
8. **`docs/specs/` の進行中 cockpit WU と衝突しうる**（特に commands.rs/App.tsx 分割、useAgentFleet 移行、native-renderer spike、merge/gate 周り）。
9. **観測挙動が変わる**（UTF-8 capture 修正、git refresh タイミング、LIKE wildcard 意味、status 表示語彙 等）。
10. **セキュリティ境界に触れる**（validate_path 移動、watchdog、MCP gate、apply-to-main、token、process spawn）。

該当時の出力: 「実装前に確認すべき質問」へ追記し、当該 Debt の `recommendation` を尊重して実装を止める。

---

## Baseline Commands

編集前に**必ず全実行し結果（緑/赤・実数）を記録**。各フェーズ後も同等（緑は緑・件数同等以上）を確認。

```bash
# Frontend（プロジェクトルート）
pnpm exec tsc --noEmit
pnpm test                 # vitest（実数を記録。README:270 / memory:1765 と乖離。実行値が真）
pnpm lint                 # biome check src/（scripts/ は対象外＝C-26）

# Rust（src-tauri/）— pnpm test と同時に走らせない
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt   --manifest-path src-tauri/Cargo.toml -- --check

# pure-move 不変の機械的証跡（IPC を触る時）
# 定義名集合 == 登録名集合 を移動前後で比較（generate_handler! と #[tauri::command]）
```

release-blocking gate（重い・必要時のみ）: `pnpm verify:release` / `pnpm verify:release:production`。
native-bin / 一部 FE を触ったら `node scripts/score-release-quality.mjs` で EXIT=0 を確認（ソース substring gate）。

---

## Debt Map

各項目: 根拠(file:line) / なぜ負債 / 影響 / リスク / 改善案 / 検証 / **判定**。
判定: 🟢=今すぐ可（検証済み pure move）/ 🟡=条件付き（内部限定・テスト付き・前提確認）/ 🔴=提案のみ（質問）。
**敵対的検証の降格は反映済み。** 完全証拠は `C:/tmp/audit-digest.md` 参照。

### Tier A — 今すぐ実装してよい（🟢 検証で confirmed・pure move・契約不変）

> いずれも「1項目=1コミット」。`invoke`文字列・`generate_handler!`登録・DB・gate文字列に触れない。

**A-1 🟢 glob import → 明示 import（ipc）** [dependency_direction]
- 根拠: `fs_commands.rs:7` と `send_keys_commands.rs:7` が `use super::commands::*;`（4231行の全公開面を取り込む）。対比 `mux_commands.rs:10` は明示 import（テンプレ）。
- なぜ: 共有 helper 契約が不可視・不安定（god-file に pub が増えると無言で名前空間に侵入）。
- 改善案: 2ファイルの `use super::commands::*;` を明示名リストに置換（clippy unused-import が正解集合を示す）。`pub use` ではなく private `use` なので mod.rs 再エクスポートに無影響。
- 検証: `cargo build` + `cargo clippy -D warnings`（漏れ/未使用を検出）+ `cargo test`。`invoke`/登録不変＝FE テスト無影響。
- 判定: **🟢 implement_now**（検証 confirmed=true / overclaim=false / 全保護軸クリア）。

**A-2 🟢 `git_relative_path` 重複の解消（git-diff）** [duplication]
- 根拠: `git_commands.rs:165` に正規 `pub(crate) fn git_relative_path`。同ファイル `:144-150`(git_file_original) / `:178-184`(git_diff_file) / `:207-216`(git_diff_files) が同一4行を inline 再実装。
- 改善案: 3箇所の inline を `let relative = git_relative_path(&repo_path, &file_path);` に置換（出力 byte-identical を確認済み）。コマンド名/シグネチャ/登録(`lib.rs:664-666`)不変。
- 検証: `cargo test git_relative_path`（既存テスト `:296-309`）+ clippy/fmt。
- 判定: **🟢 implement_now**（検証 confirmed=true / IPC契約・DB・security・native・spec いずれも未接触）。

**A-3 🟢 `workflow/mod.rs` の glob 再エクスポート → 明示（v2）** [abstraction]
- 根拠: `workflow/mod.rs:5-7` `pub use executor::*; pub use parser::*; pub use types::*;`。新 subsystem（`task/mod.rs:14`,`history/mod.rs:16`）は明示で対比。
- 改善案: `ipc/workflow_commands.rs` が消費する名のみを明示 `pub use ...::{...}` 列挙。workflow/mod.rs 内に閉じる。
- 検証: `cargo build`+`cargo test`（消費側の import 欠落を検出）+ clippy。
- 判定: **🟢 implement_now**（検証 confirmed=true / 影響は workflow/mod.rs に限定）。

### Tier B — 条件付き（🟡 内部限定・テスト付き・前提を1つ確認してから）

**B-1 🟡 `commands.rs` から clipboard 4コマンドを抽出（god-file 分割の最小スライス）** [naming_layout]
- 根拠: clipboard cluster `commands.rs:3424-3683`（save/read/write_clipboard + DIB helper）が**agent ドメインの中に挟まっている**（`start_chat_agent` ~3421 と `stop_chat_agent` 3686 を分断）。terminal/agent state と zero coupling。
- 改善案: `commands.rs:3424-3683` を新 `ipc/clipboard_commands.rs` へ pure move。`mod.rs` に `mod clipboard_commands; pub use clipboard_commands::*;`（alphabetical）。
- **前提（必ず確認）**: `base64_decode` は `start_chat_agent` が使うので `commands.rs` に残し、新ファイルから `use super::commands::base64_decode`。**かつ Q-2（Codex の commands.rs 分割計画と衝突しないか）に OK が出てから**。
- 検証: `cargo test`/clippy/fmt + 定義==登録 集合差ゼロ + `pnpm test`（`AppSilentBugs.test.ts:290` の `"write_clipboard_text"` invoke 文字列不変）。
- 判定: **🟡 conditional**（検証 confirmed=true・低リスク。ただし PHASE_0_1 §2.1 が commands.rs 分割を所有＝Codex と歩調合わせ）。

**B-2 🟡 `TermEngine::advance` の3つの同一 Incomplete-stash 分岐を helper 化（pty-term）** [duplication]
- 根拠: `engine.rs:226-230 / 248-252 / 276-282` が byte-identical（flush+stash+early-return）。precedence は image→chunked-OSC→OSC133。
- 改善案: `&mut self` を取る free helper（borrow 上 closure 不可）を抽出し3分岐から呼ぶ。precedence/partial 処理を変えない。
- 検証: split-across-advance テスト（`engine.rs` L593/L804/L928 等）緑 + clippy/fmt。
- 判定: **🟡 conditional**（元 implement_now → 検証で「borrow 実現可だが precedence をテストで縛れ」として conditional に降格）。

**B-3 🟡 `db/queries.rs` の `limit.clamp(1,N)` を `clamp_limit` に収束（db）** [abstraction]
- 根拠: free `clamp_limit`(`:2258`) と inline `.clamp(1,N)` が混在（`:1148`,`:1199`,`:1330`）。検証で **等価を証明済み**（x==0→1, x≥1→x.min(N)）。
- 改善案: **既に clamp 済みの3箇所のみ** `clamp_limit(...)` に置換（bound 不変）。**未bound の `recent_commands`/`search_commands` は触らない**（挙動変化＝Q）。
- 検証: `cargo test`（`test_audit_events_query_filters`,`test_terminal_output_journal_lists_bounded_rows_in_order`）。
- 判定: **🟡 conditional**（検証 confirmed=true・等価証明済み。内部限定）。

**B-4 🟡 MCP schema==const のドリフト防止テスト追加（mcp-api）** [type_contract]
- 根拠: `mcp.rs:229`/`:328` schema literal `1048576` と const `WS_MAX_INPUT_FRAME_BYTES`(`mod.rs:87`)、`lines` 10000 が `:200`/`:812` で二重。同期を縛るアサートが無い。
- 改善案: `tools_list` を parse して schema 値 == const をアサートするテストを追加（production 挙動不変）。
- 検証: 追加テスト緑 + const 変更→赤化で binding を確認。
- 判定: **🟡 conditional**（test-only・安全。input-size security bound なので一応 review）。

**B-5 🟡 `lint:scripts` タスク追加（build）** [config_env]
- 根拠: `package.json:118` `lint: biome check src/` で `scripts/`（4794行 scorer 含む ~107本）が未 lint。`biome.json:49` は `**` で対象化済み。
- 改善案: **check-only** `"lint:scripts": "biome check scripts/"` を追加（`--write` しない＝gate 文字列を churn しない）。既存 `lint`/`format` の scope は広げない。
- 検証: `biome check scripts/` で件数列挙（書込なし）+ `pnpm test` 緑。
- 判定: **🟡 conditional**（検証 confirmed=true・package.json のみ・非挙動）。

> B-6 候補（要オーナー判断のため Tier C 寄り）: `git-diff` の `compute_diff`/`compute_branch_comparison` 共通尾部を `assemble_deltas` に抽出（`diff_engine.rs:52-86`/`:115-149`、内部 helper）。検証で conditional・confirmed。fs-vs-git-show の content source を厳密に保つこと。**Q-2 と同様 cockpit 非衝突を確認後**。

### Tier C — 提案のみ（🔴 実装せず、現状・リスク・選択肢・必要判断を Reporting に出す）

> 共通理由: IPC契約 / DB schema / セキュリティ境界 / native binary / 進行中 cockpit spec への接触、複数設計案、または観測挙動変化。**独断実装禁止。**

#### C群-1: god-file 分割（spec 所有 or 大規模・要 staging）
- **C-10 🔴 `commands.rs`(4231行/39cmd) 残渣分割** — PHASE_0_1 §2.1 が分割先を設計済み（Codex 所有）。terminal/agent/clipboard + 共有 helper 層が同居。B-1(clipboard) 以外は spec と歩調を合わせて段階実施。security helper（validate_path 等）の移動は C-18/C-20 と統合判断。
- **C-11 🔴 `App.tsx` `App()` 4640行 god-component** [mixed_responsibility/high] — routing/right-rail/pane/agent/editor/final-goal を1コンポーネントに集約（41 useState/33 useEffect/49 useCallback/34 useMemo）。PHASE_0_1 が分割を所有・`AppSilentBugs.test.ts` が gate。提案: right-rail cluster(`2409-2436`)/final-goal(`2419-2422`)/pane-request(`2620-2627`) を**pure-move custom hook** に。Codex と sequencing 必須。
- **C-12 🔴 api god-files**（`mcp.rs` 1760 / `mod.rs` 2004 / `mux.rs` 1026） + **`tools_call` 840行 single-match(51 arm)** [naming_layout] — section 境界で submodule 分割可だが auth/rate-limit と gated verb dispatch を含む。
- **C-13 🔴 `db/queries.rs` 3073行（~1590行 impl 1個）** — domain 単位で `db/queries/<domain>.rs` へ pure move（SQL 文字列不変・mod.rs 再エクスポート byte-identical）。security/DB なので Q。
- **C-14 🔴 FE god-component**: `NativeTerminalArea.tsx` 1485行（PTY/search/snapshot/IME 混在・extracted hook パターン既存）、`useCanvasIME.ts` 1433行（diagnostics+composition+positioning。検証で「import は3領域に綺麗に分かれない・barrel 必須」と判明＝confirmed=false なので慎重に）、`native_input.rs` ~1147行（paste-guard と Win32 unsafe FFI 混在・IME 実機確認必須）。
- **C-15 🔴 `aether_native.rs` 8212行 spike** — 未出荷・native-renderer track 所有・`score-release-quality.mjs` がソース substring を gate。**機械分割不可**。promote/retire まで monolith 維持か module 化かを Q。

#### C群-2: 死コード / 未配線インフラ（削除は Q・cockpit 計画済みの可能性）
- **C-16 🔴 48/191 IPC コマンドが FE 未配線** [dead_code/high] — `generate_handler!` 登録済みだが `src/**` に文字列 match 無し。**削除せず**台帳化（(A) cockpit 進行中 orchestrator_/ownership_/workflow_/task_/context_/failure_（Jun14-16）は据置、(B) legacy 候補は Q）。
- **C-16 子: 具体的 dead/重複コマンド** — `workflow_approve_gate`/`workflow_reject_gate`（`_decision` 版のみ FE 使用・厳密 subset）; `git_diff_file`/`git_diff_files`/`open_in_vscode_diff`（別名コマンドに置換済み）。いずれも自己完結だが IPC 契約＝Q。
- **C-17 🔴 Rust dead modules** — `agent/watchdog.rs::WatchdogManager`(388行・`watchdog::engine` に置換済・log文字列のみ参照); `agent/parser.rs::StreamParser`(258行・stream-json は `commands.rs` で untyped 手書き parse＝**重複**); `watchdog/monitor.rs::SessionMonitor`(94行・未instantiate); `pane_watcher` の rule-engine 半分(`evaluate_output`/`WatchAction` 等・`matches_trigger` のみ生存); `cost/manager.rs::over_budget`(非test caller ゼロ); event kinds `AgentSpawned`/`WorktreeCreated`(宣言・MCP 広告のみ・publisher 無し)。**全て security/cockpit 近接 → 削除前に Q-3**。
- **C-17 子: FE dead** — `useAgentFleet.backendFleetSessions`+`selectFleetSession`（live event 購読するが誰も読まない＝未配線。FE 再合成 `fleetSessions` を使用）; `Sidebar.tsx`+`sidebarSection` store slice（未mount・`productMode` rail に置換）; `useGitStatus._refreshKey`（どの effect も依存せず refresh() が実質 no-op・`isDirty` も未消費）。

#### C群-3: 型・契約のドリフト（→ TYPE_BRIDGE/codegen 方向）
- **C-18 🔴 `invoke<T>` 境界が無検証**（35ファイルが直 import・`Invoke<T>` も純 assertion）— Rust struct と TS mirror のドリフトが compile 時不可視。提案: 高頻度 struct に contract test（`taskStatusContract.test.ts` 方式）拡張、または tauri-specta codegen（CODEX_HANDOFF 0.7）。
- **C-18 子: 具体ドリフト** — `useAgentManager.ts:77` `r.status as AgentStatus`（`isAgentStatus` guard を bypass、canonical status 語彙が legacy union に無い→無言 fallback）; agent session 形状が3箇所手 mirror（`AgentSessionRaw`/`BackendAgentFleetSession`/Rust `AgentSession`、`workspace_scope?` は list_agents が emit しない phantom・`started_at` 無視）; TS `RepairJobInfo` が `repoPath` 欠落; TS `Task` が `crash_attempts`/`rework_attempts` 欠落; snake/camel 混在（serde 属性のばらつきを TS が追従）。
- **C-19 🔴 status 'failed' が enum 外**（`claude.rs:251` が `"failed"` を書くが `AgentRunStatus::FromStr` に arm 無し→`session.rs:35` で `Error` に無言 coerce）— Q: `Failed` variant 追加 or `"error"` に統一（reap_tests も更新）。FE 契約。

#### C群-4: セキュリティ境界（document / Q・挙動不変でない限り触らない）
- **C-20 🔴 security validator が god-file 内**（`validate_path`/`is_dangerous_path` が `commands.rs`）— 将来分割が境界を無言で動かすリスク。`ipc/path_safety.rs` への pure move を提案（テスト同伴・glob 経由で解決維持）。C-10/C-13 と統合。
- **C-18(MCP) 🔴 `safety`(GATED/REVIEWER_AUTHORITY) は advisory のみ**（`tools_call` は safety を読まない・唯一の境界は bearer token）— token 保持者は全 verb 実行可。enforcement shim を入れるか localhost-single-token 信頼が意図かを Q。
- **C-21 🔴 ephemeral token を log 出力**（`AETHER_API_TOKEN` 未設定時、runtime 全体を `127.0.0.1:9333` に自動 bind し token を log）— log 読める local process が spawn_agent+review.approve 権限取得。fingerprint のみ log / 明示設定要求を Q。
- その他 document のみ（挙動変えない）: `start_branch_comparison` が branch名を validate せず `git diff` に渡す（read-only・低severity・`validate_branch_name` 追加を Q）; `validate_path` 空文字=Ok の soft no-op に意図 comment; MD XSS 二層を一緒に保つ invariant 明記; AI CLI headless spawn が API 経路の NUL/長さ bound を持たない（defense-in-depth gap）。

#### C群-5: DB / 並行（hardening・挙動 sensitive）
- **C-19(DB) 🔴 schema versioning 不在**（migration は bootstrap のみ・`user_version`/`ALTER TABLE` 無し）— 既存DBへの column 追加が届かず latent な "no such column"。versioned runner 導入 or "bootstrap" と明記を Q。
- **C-22 🔴 自律ループの real bug 候補**: merge 失敗(conflict)が `Review→Running` 遷移（`autonomy.rs:171-178`）だが headless agent は既に exit 済み＝**worker 無しで永久 Running**（reject 経路は同じ状況を `requeue_or_fail` で回避）。retry 予算も消費せずループ全体を stall。**最優先 Q**（BR9 spec 意図と突合・conflict は rework 予算で再 dispatch すべきか）。
- **C-23 🔴 並行 hardening（document 主体・触らない）**: mechanical gate が graph Mutex 下で test/lint を shell out（`pnpm test` 中 task subsystem 全 stall）; run_step が graph Mutex 下で blocking git2 merge + child spawn（contention ceiling）; audit sequence 割当+insert が非トランザクション（Mutex+UNIQUE 頼み）; `db_session_commands` の7コマンドが毎回 fresh `Database::open`（全 migration 再実行 + 非直列化の第2 WAL writer）。lock-across-await は**無し**（positive baseline・guardrail として記録）。

#### C群-6: リポジトリ衛生 / scripts / docs
- **C-24 🟢→🔴 root ゴミ `:TEMPfo.txt`**（0byte・untracked・U+F03A 始まりの異常名）— **Phase 1 で単独削除可**（Q-1 で意図的でない確認後）。`.codex-*.log`/`.png` は既に gitignore（`!!`）＝放置可。
- **C-25 🔴 docs sprawl**（top-level docs 31本中 20本が inbound 参照ゼロの dated audit/plan）— CODEX_HANDOFF:173 が「dirty branch land 後の別 chore」と明記。`docs/archive/` への `git mv` を提案（freshness gate の5本＝`verify-goal-documentation-freshness.mjs:11-15` と `docs/specs/`・`release-build-playbook.md` は触らない）。
- **C-26 🔴 gate 権威の不明**（~101 `verify:*` だが release-blocking は2本のみ・`score-release-quality.mjs` は読むだけ）— 削除せず GATE MANIFEST 表（blocking / evidence-probe / operator-only）を作る提案。
- **C-27 🔴 brittle ソース-substring gate**（`AppSilentBugs.test.ts` ~80箇所 / `score-release-quality.mjs` native-bin substring）— pure-move でも赤化。挙動テストへの移行を Q（App.tsx/native-bin 分割の前提）。
- **C-28 🔴 cmd.exe-only `set X=Y&&` prefix**（bash で no-op・transpile pipeline が無言で変わる）— `cross-env` 化 or 「cmd/PowerShell 限定」明記を Q（文字列が gate 依存）。
- **C-29 🔴 vite/vitest の transpile plugin 重複**（`vite.config.ts:19` ↔ `vitest.config.ts:9`・`ts.transpileModule` ブロックが byte-identical）— 共有 module 抽出を提案。検証で「config 外＝gate 外だが build 影響大」として conditional→propose に降格。before/after で `pnpm build` dist hash と `pnpm test` 数の一致を要証明。
- **C-30 🔴 native-bin CLI plumbing 重複**（`aether_native.rs` と `aetherctl.rs` に byte-identical な6関数＋3定数: `request`/`api_base_url`/`api_token`/`token_path`/`option_value`/`print_json`、`DEFAULT_BASE_URL`/`SIDECAR_BASE_URL`/`TOKEN_FILE_NAME`）— port/token 契約が2-3箇所。shared module 抽出は pure move だが `score-release-quality.mjs` substring gate（C-27）に阻まれる＝先に gate 移行か lockstep。

### Negative findings（重要：触るな・既に解決済み）
- **N-1 native-bin は handler/business ロジックを重複していない** — daemon HTTP の純 client（session/pty/mux は daemon 所有）。「consolidate」しようとするな。
- **N-2 `api/`(HTTP/WS) と `ipc/`(Tauri) は重複ではない** — 同一 core（`crate::mux`/`pty`/`file_ownership`）への2つの顔。「dedup」するな（北極星設計）。
- **N-3 branch validator 統一は既に完了** — `worktree.rs:174` は既に pub・inline validator は削除済み。PHASE_0_1 §3.1 は **stale**。再実装するな（docs-update のみ）。
- **N-4 lock-across-await は存在しない**（positive baseline）。clone-release / AsyncMutex 規律を guardrail として保つ。

---

## Implementation Phases（小さく安全な順）

> 各フェーズ後に Baseline Commands 再実行し結果記録。1フェーズ=複数の小コミット。🔴 は実装せず Reporting へ。

**Phase 0 — 現状把握・安全網**
- `git status` 確認。既存 untracked（`:TEMPfo.txt`）を自分の変更と混ぜない。
- Baseline 全実行→緑/赤・テスト実数を記録（文書値を信用しない）。
- 触る予定領域の既存テスト確認。**安全網が無いまま god-file/DB を分割しない**（無ければ pure-move 証跡＝定義==登録 grep・SQL grep・テストで担保。担保できなければ Stop And Ask）。
- 作業ブランチ `refactor/debt-reduction-tierA` を切る（main 直コミット禁止）。

**Phase 1 — root 衛生（🟢 C-24）**
- Q-1 で意図的でないと確認後、`:TEMPfo.txt` を単独コミットで削除。`git status` クリーン化。

**Phase 2 — Tier A pure move（🟢 A-1,A-2,A-3）**
- A-1（glob→明示 import ×2ファイル）→ A-2（git_relative_path dedup ×3）→ A-3（workflow/mod.rs 明示）。各1コミット。各後に `cargo build/test/clippy/fmt`。

**Phase 3 — Tier B 条件付き（🟡、前提確認後のみ）**
- B-5（lint:scripts 追加・最安全）→ B-4（MCP schema==const テスト）→ B-3（clamp_limit 収束 ×3）→ B-2（Incomplete-stash helper）→ **B-1（clipboard 抽出）は Q-2 OK 後**。
- 各コミットで pure-move 証跡を diff に示す。

**Phase 4 — 提案作成（🔴 Tier C 全部・実装しない）**
- C-22（autonomy merge-conflict stall bug）を**最優先の質問**として要約（再現条件・修正案・BR9 突合）。
- god-file 分割（C-10〜C-15）・dead/unwired（C-16,C-17）・型契約（C-18,C-19）・security（C-20,C-21）・DB/並行（C-19DB,C-22,C-23）・scripts/docs（C-25〜C-30）を、各「現状・リスク・選択肢・必要判断・推奨 sequencing（cockpit spec との関係）」付きで Reporting にまとめる。
- N-1〜N-4（触るな/完了済み）を明記し、無駄な作業を防ぐ。

---

## Verification Requirements

- **各フェーズ・各コミット後**に Baseline（`cargo test` と `pnpm test` は別々に）。
- pure move 証跡: 移動した関数/SQL/コマンド名を移動前後で grep し**集合一致**を示す。
- IPC: 定義名集合 == `generate_handler!` 登録集合（追加削除ゼロ）。`invoke` 文字列 diff ゼロ。
- DB: SQL 文字列 grep 一致 + DB テスト緑。
- gate 文字列（`AppSilentBugs.test.ts`・`verify-release-gate` requiredPackageScripts・`score-release-quality` substring）を新たに赤化しない。触る場合は同コミットで gate 側も更新（Stop And Ask 対象）。
- 既存で緑の `verify:*` を赤化しない。ただし合否の**主基準は Baseline Commands**。
- 観測挙動が疑われる時のみ実機 `pnpm tauri dev`（IME/terminal/right-rail/SCM の視覚確認）。

---

## Reporting Format

各フェーズ完了時:
```
## Phase <n>: <名称>
- 実行コマンドと結果:
  - pnpm exec tsc --noEmit → <緑/赤,件数>
  - pnpm test → <pass/fail,実数>
  - pnpm lint → <件数>
  - cargo test → <pass/fail,実数>
  - cargo clippy → <0 warnings か>
  - cargo fmt --check → <差分なしか>
- 変更ファイルと「なぜ pure move か」（grep 一致の証跡）
- コミット単位（1コミット=1関心事）
- Stop And Ask 該当（実装せず質問として列挙）
```
最終報告: 実施 Phase / 残提案（🔴 一覧、C-22 を筆頭に）/ 最後に実行した全コマンドと結果 / 未解決質問。

---

## Out-of-scope Items

- 機能追加・削除・仕様変更・UI 見た目変更（token/color/layout 含む）。
- `docs/specs/` の cockpit 機能実装（WU 実装は別 goal）。
- Tier C 全項目の独断実装（god-file 大規模分割・dead code 削除・security/DB 変更・型 codegen・並行修正・docs/script 改変）。
- `verify:*` の削除・統合（GATE MANIFEST 提案のみ）。
- 依存アップグレード、Rust↔TS codegen 導入（TYPE_BRIDGE_SPEC で別途）。
- N-1〜N-4（native-bin/api-ipc の「dedup」、branch validator 再実装）。
- `cargo test` と `pnpm test` の並列化／main への force push（禁止）。

---

## 着手前チェックリスト
- [ ] 最初に `git status` を確認した
- [ ] 既存 untracked（`:TEMPfo.txt`）を自分の変更と混ぜていない
- [ ] Baseline 実数を記録した
- [ ] `docs/specs/CODEX_HANDOFF.md` と `PHASE_0_1_ARCHITECTURE_SPEC.md` を読み、衝突しないと確認した
- [ ] Tier A/B のみ実装し、Tier C は提案に留めた
- [ ] 変更は小さく戻しやすい単位（1コミット1関心事）
- [ ] 無関係な整形・ついでのリファクタを入れていない
- [ ] pure move 証跡（grep 一致・登録不変）を示した
- [ ] 正しさ不明・契約/security/spec 接触は止めて質問にした
- [ ] 各フェーズで検証した
- [ ] 最後に実行コマンドと結果を報告した
