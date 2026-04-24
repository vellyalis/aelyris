# Phase 3 Plan — Aether Terminal

**作成**: 2026-04-17
**前提**: Phase 1 / Phase 2 全タスク完了 (commit d4df53a 時点)。xterm.js は完全除去、native Rust engine (alacritty_terminal + Canvas 2D) が唯一の描画経路。
**元ネタ**: `docs/analysis_and_ideas.md` + memory `project_strategic_direction.md` (agent management workspace 超 Scape 路線)

## 戦略方針 (Phase 2 から継続)

- ターミナル描画性能勝負ではなく **エージェント管理ワークスペース** としての差別化
- React UI / デザイン資産維持、Tauri + native Rust engine 構成固定
- 既存 backend 実装のうち **配線されていない資産** (`watchdog/auto_repair.rs`, `suggest/SuggestEngine`) を最優先で活性化 — memory `feedback_no_infrastructure_without_wiring.md` の教訓
- 新規追加は「エージェント管理として価値を生むか」で選別

## 全体ロードマップ (着手順)

| Phase | 目的 | 工数目安 |
|---|---|---|
| **3A** 既存資産活性化 | infrastructure-without-wiring を解消 + 起動速度残務 | 1-2 週 |
| **3B** エージェント管理核 | Orchestra mode + semantic history | 2-3 週 |
| **3C** 差別化大物 | Ghost diff overlay / 並行世界 / タイムトラベル | 月単位 |
| **3D** 実験枠 | API 化 / インライン viz / 3D map | 都度判断 |

各 phase 内は記載順に実行。phase 跨ぎは前 phase 完了 + 視覚検証済をエントリ条件。

---

# Phase 3A — 既存資産活性化

## 3A-1. 自己修復ターミナル E2E 仕上げ ✅ 完了 (2026-04-17, commit 1bc5c53)

**目的**: エラー検知 → 隔離 worktree → AI 修正 → テスト → トースト通知の完全自律ループを UI まで開通させる。ideas.md セクション B 後半 + E の実体化。

**前提**:
- `src-tauri/src/watchdog/auto_repair.rs` 19.7K 実装済、単体テスト 4 本グリーン (確認済)
- `AutoRepairManager` は `.manage()` 未登録 ← ここが欠け穴
- `pane_watcher` はあるが `auto_repair.trigger()` への呼び出しなし

**サブタスク**:

1. **Backend 配線 (0.5-1 日)**
   - `lib.rs` に `.manage(Arc<Mutex<AutoRepairManager>>)` 追加
   - `ipc/mod.rs` に `repair_commands.rs` 新規 — `list_repair_jobs` / `trigger_repair_manual` / `cancel_repair` IPC
   - `spawn_terminal` の PTY reader 内で `pane_watcher` が error pattern にヒットしたら `AutoRepairManager::trigger()` を呼ぶ (repo_path は cwd から解決)
   - フレームポーラー: tauri `spawn_blocking` で 500ms 毎に `poll()` → 通知があれば `app.emit("repair:notification", RepairNotification)` + `app.emit("repair:jobs-updated", jobs())`

2. **Frontend Toast + Jobs Panel (1-2 日)**
   - `src/shared/hooks/useRepairJobs.ts` — `listen("repair:jobs-updated")` + `listen("repair:notification")` でローカル state 維持
   - Toast: 既存 `shared/ui/Toast` で success/failure 表示 (動いたら 5s fadeout)
   - Jobs panel: `src/features/repair/RepairJobsPanel.tsx` — StatusBar から開くポップオーバー。各 job の phase (CreatingWorktree / RunningAgent / RunningTests / Succeeded / Failed) を進捗バー + branch 名 + elapsed で表示
   - StatusBar に active 数バッジ (`useRepairJobs.active` > 0 で表示)

3. **テスト (0.5 日)**
   - Rust: `AutoRepairManager::trigger` の capacity / debounce 境界値 (既存テストで概ねカバー)
   - TS: `useRepairJobs` の listen/accumulate ロジック、RepairJobsPanel のレンダリング (vitest + @testing-library/react)

4. **視覚検証 (0.5 日)**
   - `pnpm tauri dev` で:
     - watchdog rule を「cargo error」でトリガ
     - 意図的にビルドエラー出して error line を PTY に流す
     - トースト表示 → jobs panel で phase 遷移を確認
     - worktree が実際に作られ、AI が呼ばれ、成功/失敗で通知が閉じる
   - debounce: 同じエラーが 60s 内に連発しても job は 1 つのみ

**成果物**:
- `src-tauri/src/ipc/repair_commands.rs` 新規 (〜100 行)
- `src-tauri/src/lib.rs` 編集 (状態登録 + invoke_handler 3 コマンド追加)
- `src-tauri/src/ipc/commands.rs` 編集 (PTY reader 内で auto_repair.trigger 呼び出し)
- `src/shared/hooks/useRepairJobs.ts` 新規
- `src/features/repair/RepairJobsPanel.tsx` + module.css 新規
- `src/features/statusbar/Statusbar.tsx` に repair バッジ追加
- Rust/TS テスト各 5-8 本

**リスク**:
- `claude -p` を spawn するので CI の claude 未インストール環境でテストが不安定 → テストでは process::Command をモックするか skip
- worktree 作成が副作用強い — debounce の境界外れで複数 trigger されるとブランチが大量生成 → `AutoRepairManager::trigger` の capacity 制限 (MAX_CONCURRENT_JOBS=3) に依存

**見積もり**: 2-4 日 (視覚検証含む)

**完了条件**: 視覚検証 5 項目全て OK / vitest + cargo グリーン / commit

---

## 3A-2. Ghost typing 復活 (fish-style) ✅ 完了 (2026-04-18, commit b903493)

**目的**: コマンド入力中、履歴ベースの続きを薄灰色でインライン予測表示。Tab で受諾。ideas.md セクション B 前半。

**前提**:
- `src-tauri/src/suggest/SuggestEngine` 実装済、fish-style prefix match (確認済、12+ テスト)
- `.manage()` 未登録
- memory `feedback_ghost_text_cause.md` — 旧 xterm 版は PSReadLine の予測候補消し残しで誤診、Rust 側 `-PredictionSource None` で対処済
- memory `project_phase2_progress.md` の task 11 末尾 — native path では「プロンプト位置判定が難しく見送り」と記載。**本タスクはこれを克服する**

**設計アプローチ (プロンプト位置の扱い)**:

旧 xterm 版は CommandBlockTracker (削除済) でプロンプト行を検出していた。native path では異なる戦略を取る:

- **入力ミラー方式**: canvas への keypress を `TerminalCanvasInput` で横取り & **PTY に渡す直前でローカル入力バッファに蓄積**
  - printable ASCII / スペース → buffer に追加
  - Backspace → buffer から 1 文字削除
  - Enter (`\r`) → buffer → `SuggestEngine::record()` → buffer クリア
  - 矢印 / Ctrl+C / Esc → buffer クリア (予測取消)
  - Tab / Ctrl+Space → 予測受諾: `suggestion` を PTY に write + buffer に追加
- **予測表示**: buffer が変わるたび `invoke("suggest_next", {prefix: buffer})` → 返値をカーソル直後に薄灰色描画
- **位置**: `snapshot.cursor.row, cursor.col` の直後
- **エッジケース**: マルチライン入力は対応しない (単純プロンプト前提)

**サブタスク**:

1. **Backend 配線 (0.5-1 日)**
   - `lib.rs` に `.manage(Arc<Mutex<SuggestEngine>>)` 追加。起動時 `db.recent_commands(500)` で seed
   - IPC: `suggest_next(prefix) -> Option<String>` / `suggest_record(command)` 新規
   - `save_command_history` の内部で `SuggestEngine::record()` も呼ぶ (二重記録を避けるため IPC 側で一箇所にまとめる)

2. **Frontend 入力バッファ (1 日)**
   - `src/features/terminal/hooks/useInputMirror.ts` 新規 — keyEventToBytes に手を加えず、並列で input buffer state を維持
   - `NativeTerminalArea` / `AgentTerminal` で使う hook。buffer state を TerminalCanvas に prop で渡す
   - Tab / Ctrl+Space 受諾ハンドラ — `writeBytes(suggestion.slice(buffer.length))` で PTY に未入力ぶんだけ書く

3. **Frontend 描画 (0.5 日)**
   - `TerminalCanvas` に `ghostSuggestion?: string` prop 追加
   - paint effect で cursor 位置の直後に薄灰色 (`#585b70` / opacity 0.6) でテキストを描く
   - 描画は cursor row だけ dirty mark

4. **テスト (0.5 日)**
   - Rust: SuggestEngine の既存テストで十分
   - TS: `useInputMirror` の buffer lifecycle (keydown / Enter / Backspace / Tab accept) vitest
   - TerminalCanvas の ghostSuggestion 描画テスト (fillText mock)

5. **視覚検証 (0.5 日)**
   - `git st` → 薄灰色で `atus` が見える
   - Tab で受諾され `git status` が実行される
   - 方向キーで候補消える
   - AI CLI (claude) 実行中は予測が邪魔にならない (AI CLI detected → buffer/予測を無効化)
   - IME 中は予測なし (composingRef check)

**成果物**:
- Rust 3 箇所 (lib.rs / ipc / suggest IPC)
- `src/features/terminal/hooks/useInputMirror.ts` 新規
- `TerminalCanvas.tsx` に ghostSuggestion 描画追加
- `NativeTerminalArea.tsx` / `AgentTerminal.tsx` に配線
- テスト 10+ 本

**リスク**:
- **入力ミラー方式は prompt 前の状態 (`cd /tmp`) 等で誤爆する可能性** — buffer に溜まるのは "cursor が prompt 行にいる前提"。対策: AI CLI detected や IME composing 中は buffer を無効化
- Windows ConPTY 側が勝手に echo を返す → buffer と PTY 実状のズレ。native engine の grid snapshot の cursor.col と buffer.length の差分で補正する fallback を用意
- 予測が誤って実行される (誤タブ受諾) → 受諾時は **PTY に書くだけ、Enter は送らない**

**見積もり**: 3-5 日

**完了条件**: 視覚検証 5 項目 / vitest + cargo グリーン / commit

---

## 3A-3. gpu/ backend 撤去 + 起動速度 second stage ✅ 完了 (2026-04-18, commit 44e4805)

**目的**: Phase 2 で孤立した `src-tauri/src/gpu/` 30 ファイルの撤去 (現 React 側から完全孤立)。Phase 1 残務の起動速度 second stage も畳む。

**前提**:
- `gpu/*.rs` は `lib.rs` で `GpuTerminalManager` + `gpu::commands::*` の 12 IPC を登録している。frontend は `WebGpuTerminal.tsx` 削除済なので invoke は 0
- `ui/*` は `gpu::*` 型を import している — これらも wgpu native UI 実装 (未配線) なので併せて撤去候補
- Phase 1 メモ: `[boot]` マーカー実装済、実測値取得待ち

**サブタスク**:

1. **gpu/ 孤立度確認 (0.5 日)** — `grep` で frontend/backend から `gpu::` を参照している箇所を総ざらい。ui/* が依存しているなら ui/* も撤去対象
2. **gpu/ + ui/ 物理削除 (1 日)** — 30+ファイル削除 / `lib.rs` から 12 IPC 削除 / `GpuTerminalManager` の `.manage()` 削除 / `Cargo.toml` から wgpu / winit 系依存削除
3. **起動速度 実測 (0.5 日)** — `pnpm tauri dev` で DevTools の `[boot]` ログ収集。ボトルネックが xterm: first-mount 無関係になったので現状のチャンク分割がまだ有効か再評価
4. **最適化 (1 日)** — 実測結果次第: monaco-vim 2.75MB の dynamic import 検討 / WorkflowBuilder 184kB は既に lazy 済なので変更なし想定
5. **視覚検証 (0.5 日)** — 起動 OK / 全機能触って regress なし / `[boot]` 時間を memory に記録

**成果物**:
- net -数千行 (gpu/ui 撤去)
- `Cargo.toml` から wgpu / winit 系削除
- ボトルネック実測の記録 (memory 更新)

**リスク**:
- ui/ は `lib.rs` で managed state として登録されているか? → 事前確認必須
- wgpu / winit 依存を削るとビルド時間短縮

**見積もり**: 2-3 日

**完了条件**: cargo / vitest / build グリーン / 視覚検証 / commit

---

# Phase 3B — エージェント管理核

**詳細は 3A 完了時点で確定**。スケルトンのみ:

## 3B-1. Orchestra mode

### 3B-1 MVP ✅ 完了 (2026-04-18, commit 7c675fc)
- OrchestraRoleId + icon/color、AgentSession.role / handoffFrom、useAgentManager が meta を永続化
- OrchestraDialog (task textarea + 4 role checkboxes)、AgentInspector の ♫ ボタンから起動
- SessionCard: role badge + conflict badge (peach FileWarning icon)
- AgentInspector parallel view: conflictsByPath サマリ chip
- detectFileConflicts() で active session 間のファイル重複検出
- tests: orchestraRoles 14 + OrchestraDialog 5

### 3B-1c ✅ 完了 (2026-04-18, commit f3e17bc)
- `shared/lib/conductorLayout.ts` — 純粋 layout (column = role、row = startedAt)、edge = handoffFrom
- `features/agent-inspector/ConductorView.tsx` — ReactFlow で role-colored node + 動的 edge
- AgentInspector に "conductor" タブ追加 (Share2 icon)
- HandoffResult に `role` 追加、HandoffDialog に role dropdown
- AgentInspector.handleHandoff で `handoffFrom: session.id` + `role` を startAgent meta に渡す
- tests: conductorLayout 6 + HandoffDialogRole 4

## 3B-2. Semantic history search ✅ 完了 (2026-04-18)
- embedder: `history::HashingNgramEmbedder` (256-dim char n-gram hashing trick, MODEL_ID `char-ngram-hash-v1`)
  - 依存ゼロ (fastembed は ONNX/ort で配布+ビルド重いため見送り、`Embedder` trait で将来差し替え可)
- vec store: SQLite `command_embeddings` テーブル (BLOB f32 LE) + Rust cosine 全件スキャン
  - history 数万件までは <50ms、sqlite-vec extension 不要
- パイプライン: `save_command_history` → DB save → 別スレッド embed → insert (PTY reader 非阻害)
- UI: Ctrl+R で `HistorySearchDialog` (radix-ui、↑↓/Enter/Esc、failed-only + this-project filter chip)、Enter 時は command 書込のみで Enter 未送信 (fish/zsh 流)
- backfill: 起動時に未インデックス行 (または別モデルで書かれた行) を worker thread で埋める

---

# Phase 3C — 差別化大物

3B 完了済 (2026-04-18)。**3C-1 は以下で詳細化**。3C-2 / 3C-3 は 3C-1 の LayerRegistry 完成時点で再確定する (revision / snapshot 差し替えで再利用する想定)。

- **3C-1 Ghost diff overlay** — 別 worktree の AI 修正を editor に inline ghost 重ね (ideas.md D1) ✅ 完了
- **3C-2 並行世界のターミナル** ✅ MVP 完了 (2026-04-18, commit 0e28dd4) — ブランチ比較 overlay で MVP。拡張 3C-2b/c/d は後続判断
- **3C-3 タイムトラベルデバッグ** — PTY 状態スナップショット + replay (ideas.md A 後半)

---

## 3C-1. Ghost Diff Overlay

### 思想 (確定済、2026-04-18)

- **核は inline ghost line**: 自分が編集中のファイルに、別 worktree の AI 修正が Monaco decoration + view zone として半透明で浮かぶ。side-by-side DiffEditor は MVP 外
- **2 打完結 accept/reject**: hunk 単位で Tab accept / Esc reject。パネル経由のボタンは補助のみ
- **Layer engine として抽象化**: `ghostdiff::LayerRegistry` は source (worktree path + revision) / content (file deltas) / presentation (tint/opacity) を抽象化。3C-2 は revision 差し替え、3C-3 は snapshot 差し替えで再利用
- **デフォルト completed、flag で live**: agent exit まで buffer し、完了後に ghost 出現。`aether.ghostDiff.liveMode = true` で中間状態も流す
- **hunk 衝突時は ghost を譲る**: ユーザー dirty hunk と ghost hunk が交差する行は ghost 非表示、EditorBreadcrumb に file-level badge 退避。非衝突 hunk は inline ghost 表示

### 前提

- `auto_repair::AutoRepairManager` / Orchestra `AgentManager` が worktree を active に持つ (3A-1 / 3B-1 で配線済)
- `notify` / `notify-debouncer-mini` は既存依存 (`src-tauri/src/watcher.rs` で使用)
- `git_diff_file` / `git_file_original` IPC は main worktree 向けで、**worktree 指定版**が未実装 → 本 phase で追加
- Monaco `editor.deltaDecorations()` + `editor.changeViewZones()` は `editorRef.current` 経由で操作可能 (`EditorPanel.tsx` の ref 使用)

### サブタスク構成

#### 3C-1a. Layer engine + backend + panel サマリ ✅ 完了 (2026-04-18, commit 75ac4bf)

**Rust 新規** — `src-tauri/src/ghostdiff/` 配下
- `mod.rs` — 公開 API re-export
- `layer.rs` — 型定義
  - `Layer { id: LayerId, source: LayerSource, content: LayerContent, is_complete: bool, tint: LayerTint }`
  - `LayerSource::Worktree { path: PathBuf, branch: String }` (3C-2/3C-3 で variant 追加予定)
  - `LayerContent::Diff { base_revision: String, files: Vec<FileDelta> }`
  - `FileDelta { path: String, hunks: Vec<DiffHunk>, base_content: String, head_content: String }`
  - `DiffHunk { base_start, base_len, head_start, head_len, lines: Vec<HunkLine> }`
  - `LayerTint { role_color: String }` (Orchestra role 由来、auto-repair は固定 `peach`)
- `registry.rs` — `LayerRegistry { layers: DashMap<LayerId, Layer> }` + register/unregister/refresh/mark_complete
- `watcher.rs` — per-worktree fs watcher (notify-debouncer-mini、300ms debounce)。変更時 `LayerRegistry::refresh(id)` → diff 再計算 → event emit
- `diff_engine.rs` — `git diff --no-color HEAD` を Command 実行 → `FileDelta` に parse

**Rust 配線**
- `AutoRepairManager::trigger()` で worktree 作成後 `LayerRegistry::register_worktree_layer(job_id, worktree_path, branch, tint=peach)`
- `InteractiveSessionManager` spawn 時に同じ登録 (Orchestra role color を tint に)
- Phase 完了時 (`RepairPhase::Succeeded` / `Failed`、Orchestra session stop) で `mark_complete(layer_id)`
- `lib.rs` で `LayerRegistry` を `.manage()` 登録 + 500ms poller スレッド (repair と同様) で差分 event emit

**IPC 新規** — `src-tauri/src/ipc/ghostdiff_commands.rs`
- `list_ghost_layers() -> Vec<LayerSummary>`
- `get_ghost_layer_file(layer_id, file_path) -> FileDelta`
- `apply_ghost_hunk(layer_id, file_path, hunk_index) -> Result<()>` (3C-1c で実装、a では stub)
- `dismiss_ghost_layer(layer_id) -> ()`

**Event**
- `ghost-diff:layer-updated` (payload: LayerSummary)
- `ghost-diff:layer-completed` (payload: layer_id)
- `ghost-diff:layer-removed` (payload: layer_id)

**Frontend 新規** — `src/features/ghost-diff/`
- `useGhostLayers.ts` — event 購読 + state 管理
- `GhostDiffPanel.tsx` — layer リスト (source badge / file count / hunk count / completed マーク)。file 展開で既存 `DiffViewer` 再利用
- `src/features/statusbar/Statusbar.tsx` に active layer 数バッジ追加

**テスト**
- Rust: `LayerRegistry` ライフサイクル (8+)、`diff_engine` parse 正確性 (4+)
- TS: `useGhostLayers` event accumulate (5+)、`GhostDiffPanel` render (3+)

**視覚検証**
- auto-repair 1 件走らせる → layer が panel に 1 秒以内出現 / completed マーク
- Orchestra で 2 agent 起動 → layer 2 つ並ぶ (role color で区別)
- agent が 2 回書いた時 panel の file 数が動く
- dismiss で layer 消える

#### 3C-1b. Monaco inline ghost paint ✅ 完了 (2026-04-18)

**Frontend 新規** — `src/features/editor/ghostPaint.ts`
- `GhostPainter { install(editor, monaco, hunks, tint): Disposable }`
- add hunks → `changeViewZones` でファントム行挿入 + dim 緑背景
- delete hunks → `deltaDecorations` で取消線 + dim 赤背景
- modify hunks → `after` inline widget で新内容を半透明重ね
- **MVP は add-only inline、add+delete 混在 hunk は gutter アイコンで退避** (詳細は 3C-1c)

**EditorPanel.tsx 編集**
- mount 時 `useGhostLayers()` から当該 filePath に該当する FileDelta を取得
- filePath / dirty 状態から **衝突 hunk 判定** (`detectHunkConflict(userDirtyRanges, ghostHunks)`)
- 非衝突 hunk のみ `GhostPainter.install()`
- 衝突 hunk は `EditorBreadcrumb` に「N 件の提案あり (conflict)」badge 表示

**テスト**
- `ghostPaint.ts` の decoration / view zone 生成 (monaco mock、5+)
- `detectHunkConflict` の hunk 交差判定 (8+ 本、境界値 / 同一行 / 前後隣接 / 包含)

**視覚検証**
- auto-repair が `src/foo.ts` を touch → EditorPanel で開いていると薄緑 ghost 行が add 位置に出現
- 自分が 50 行編集中、agent が 55 行 touch → 非衝突、ghost 表示
- 自分が 55 行編集中、agent も 55 行 touch → ghost 非表示 + breadcrumb warning badge
- ファイル閉じると ghost 消える (layer は残る)

#### 3C-1c. Hotkey accept/reject + apply ✅ 完了 (2026-04-18, commit 3e06521)

**Frontend** — EditorPanel keybind
- Tab (editor focus、ghost hunk がカーソル位置): hunk accept → `invoke("apply_ghost_hunk", ...)` → 成功で editor reload
- Shift+Tab: file 内全 hunk accept
- Esc: 現ファイルの ghost 全 dismiss (他ファイル・他 layer には触れない)

**Rust 実装** — `apply_ghost_hunk`
- 対象 hunk の `head_content` を main worktree ファイルに patch 適用
- `diffy` crate 追加して unified hunk apply
- 適用後 `LayerRegistry::refresh_layer(layer_id)` で diff 再計算 → layer 側からも該当 hunk が消える

**gutter アイコン** (3C-1b から持ち越した複雑 hunk の表示)
- add+delete 混在 hunk は gutter アイコンで退避、click で popover に hunk 詳細 + Apply ボタン

**視覚検証**
- Tab で hunk accept → ghost 実体化 / ファイル modified マーク
- Shift+Tab で file 内全 accept
- Esc で ghost 消える (再度開くと復活)
- apply 失敗時 toast エラー (main が変わっていて patch 当たらない等)

#### 3C-1d. Live mode flag ✅ 完了 (2026-04-18, commit 25016df)

- `config.toml [ghost_diff]` に `live_mode: bool` (default false、serde default で legacy toml 互換)
- Settings UI に "Ghost Diff Overlay" セクション追加、toggle + 説明文
- `appStore.ghostDiffLiveMode` (localStorage bootstrap → Settings open 時に config.toml から rehydrate)
- `useGhostPaintForFile` に `liveMode` arg、`layersForFile` で `(liveMode || l.isComplete)` フィルタ
- 既定: completed layer のみ paint / live ON: in-progress layer も paint
- Rust 側は `LayerRegistry` 変更不要 (現状 refresh emit は常時発火、frontend 側で filter)
- tests: Rust 3 (default/legacy/round-trip) + TS 2 (off skip / on paint)

### リスク

- **diff_engine の精度**: git CLI 経由 unified diff parse は format fragile。MVP は git CLI、問題出れば `git2` diff API に移行
- **Monaco view zone と scroll 協調**: ghost add 行を view zone で入れると実ファイル行番号と表示行番号がズレる。cursor 位置変換の helper を共通化する
- **fs watch の雷鳴**: 1 回の agent 実行で数十 file write → 300ms debounce で吸収 (既存 100ms より長め、diff 計算コスト考慮)
- **apply 時の race**: ghost 表示中にユーザーが同ファイルを編集 → apply で conflict。toast で「main が変化、手動 merge」誘導
- **Orchestra 2 agent 同一 hunk 衝突**: tint 色を重ねて z-index は startedAt 順 (3B-1 conflict detection と同じ発想)

### 成果物まとめ

- Rust: `src-tauri/src/ghostdiff/` 4 ファイル (~600 行) + `ipc/ghostdiff_commands.rs` (~150 行)
- `Cargo.toml`: `diffy = "0.4"` 追加
- Rust テスト: 20+ 本
- TS: `src/features/ghost-diff/` (panel + hook、~400 行) + `src/features/editor/ghostPaint.ts` (~300 行) + EditorPanel 編集
- TS テスト: 25+ 本

### 見積もり

| sub | 目安 |
|---|---|
| 3C-1a | 2-3 日 |
| 3C-1b | 2-3 日 |
| 3C-1c | 1-2 日 |
| 3C-1d | 0.5 日 |
| **合計** | **6-9 日** (視覚検証含む) |

### 完了条件 (sub ごと)

- 視覚検証全項目クリア
- cargo test / vitest / tsc / build 全グリーン
- memory `project_phase3_progress.md` 更新
- commit (sub ごと 1 commit を想定、3C-1c と 3C-1d は纏めても可)

---

## 3C-3. タイムトラベルデバッグ (ideas.md A 後半)

### 思想 (再確定、2026-04-18)

- **核は「過去のターミナル画面に戻れる」**。コマンド実行前/後の state を復元して、「さっき何が起きたか」を**再現**する
- 既存 LayerRegistry / GhostPainter を **snapshot 軸で再利用**。3C-2 の read-only 思想をそのまま継承
- plan 初版の「月単位」見積は過大評価。**MVP は 2-3 週** — snapshot capture + timeline slider + 読み取り専用 replay だけに絞る

### なぜ差別化になるか

- 既存 terminal: scrollback は text のみで cursor / selection / ANSI state が失われる
- タイムトラベル: **grid 全体 (cells + cursor + flags + scroll offset) を命令単位で保存**、任意時点で画面丸ごと再生可能
- 「10 コマンド前に何が出てたか」「エラー直前の出力状態」を切替なしで見せる
- 使い所: AI agent 出力のデバッグ、長時間シェル作業の振り返り、過去エラーへの遡及

### MVP スコープ (2-3 週)

- **対象**: 通常 PTY セッション (AI CLI は除外 — interactive session は別 snapshot 戦略)
- **粒度**: プロンプト検出 or コマンド実行ごとに 1 snapshot (scrollback 丸ごとじゃない)
- **UI**: タイムラインスライダー (timeline slider)、クリックで当該時点の grid を read-only で現 terminal 領域に重ね描き
- **read-only**: 過去画面に戻っても編集不可、Esc で現在に戻る (3C-2 と同じ思想)
- **保存先**: in-memory のみ (アプリ再起動で消える)。永続化は拡張 3C-3b で

### 非スコープ (後回し)

- 3C-3b: **permanent 保存** (SQLite snapshot 永続化、アプリ再起動で復元)
- 3C-3c: **replay モード** (タイムライン自動再生で command 履歴を動画的に見る)
- 3C-3d: AI CLI セッション対応 (interactive_session の state snapshot は別ドメイン)
- 3C-3e: **edit from past** (過去時点から分岐して "あの時こうしてれば" を試す) — 3C-3 の最終形だが、ターミナル状態の fork は別モデル必要

### 設計方針

#### Snapshot data model

```rust
// 新設 src-tauri/src/ghostdiff/snapshot.rs
pub struct TerminalSnapshot {
    pub id: SnapshotId,         // uuid
    pub session_id: String,     // PTY session
    pub captured_at: u64,       // unix seconds
    pub trigger: SnapshotTrigger, // PromptDetected { line } | UserMarked | CommandExit { code }
    pub grid: GridSnapshot,     // Vec<Vec<Cell>> + cursor + viewport
    pub scrollback_tail: Vec<GridLine>, // 直近 N 行、full scrollback は保存しない
}

pub struct GridSnapshot {
    pub cells: Vec<Vec<Cell>>,  // current viewport
    pub cursor: (u16, u16),
    pub cols: u16,
    pub rows: u16,
}
```

- **Cell** は既存 `alacritty_terminal::Cell` を shallow copy (flags + fg/bg + char)
- **圧縮**: 連続 snapshot で同一 cell が多いので diff compression は拡張で
- サイズ目安: 80x24 grid × 4 bytes/cell ≈ 8 KB/snapshot、100 snapshots で 800 KB (MVP は in-memory OK)

#### LayerRegistry への統合

```rust
pub enum LayerSource {
    Worktree { ... },         // 3C-1
    BranchComparison { ... }, // 3C-2
    Snapshot {                // 3C-3 NEW
        session_id: String,
        snapshot_id: SnapshotId,
        captured_at: u64,
    },
}
```

- `Layer::is_read_only()` は Snapshot も true 返す
- `LayerContent` は既存 Diff variant を流用しない — snapshot は terminal grid state なので新 variant `LayerContent::TerminalState { grid: GridSnapshot }` 追加
- GhostPainter は ghost **行** を描くだけ、terminal grid は別 renderer 必要

#### Snapshot capture タイミング

- PTY reader に **プロンプト検出**ロジック追加 (ANSI OSC 7 or heuristic)
- 検出時、現在の grid 全体を snapshot_store に push
- 数上限 (例: session あたり 100 snapshots) で古いものから削除
- CPU/memory 影響: 100 snapshots * 8KB = 800KB、capture は O(cols*rows) で sub-ms

#### UI (新規)

- **TimelineBar** コンポーネント (terminal 上部 or 下部に pinned)
- 横長バー、snapshot 数に比例して目盛り、hover で preview
- クリック → `Layer { source: Snapshot {...} }` を `LayerRegistry` に register + terminal viewport を snapshot grid で上書き描画
- Esc で戻る (既存 dismissFileLayers 流用)

### サブタスク構成

#### 3C-3a. Snapshot capture + store ✅ 完了 (2026-04-18)
- ✅ `src-tauri/src/snapshot/` 新規 — `types.rs` (SnapshotId / SnapshotTrigger / TerminalSnapshot / SnapshotSummary) + `store.rs` (per-session `VecDeque` ring buffer, cap 100, O(n) id lookup)
- ✅ Capture hook: `ipc/commands.rs` の `write_terminal` に追加 — 入力に `\r` が含まれる瞬間に `NativeTerminalRegistry::snapshot()` を呼んで `UserSubmitted` トリガで push
- ✅ `close_terminal` で `SnapshotStore::remove_session` 呼び出し → session cleanup
- ✅ IPC: `list_snapshots(sessionId)` / `get_snapshot(snapshotId)` / `mark_snapshot({sessionId, label?})` (3種) を `ipc/snapshot_commands.rs` で実装、`lib.rs` invoke_handler に登録
- ✅ Rust tests: 26 本 (types + store + serde round-trip) — `cargo test --lib` 269 本グリーン
- ✅ `scripts/verify-3c3.mjs` 雛形 (CDP 経由) — spawn → Enter → list/get → mark → eviction (130→≤100) → close の 6 ステップ

**Note**: プロンプト検出は「PTY write に `\r` が入った瞬間」= 事前の Enter heuristic。OSC 133 は 3C-3b の拡張へ先送り。

#### 3C-3b. LayerSource::Snapshot + Rust registry 統合 ✅ 完了 (2026-04-18)
- ✅ `layer.rs` に `LayerSource::Snapshot { session_id, snapshot_id, captured_at }` + `LayerContent::TerminalState { grid: GridSnapshot }` variant 追加。`is_read_only` / `worktree_path` / `repo_path` / `summary` / `find_file` を exhaustive 化。新アクセサ `terminal_grid() -> Option<&GridSnapshot>`
- ✅ `LayerTint::snapshot()` — Catppuccin teal (#94e2d5) + label "snapshot"
- ✅ `Layer::new_snapshot` 構築関数 — is_complete=true (snapshot は registration 時点で確定)
- ✅ `registry.rs` 全 match site 更新: `register_worktree_layer` の irrefutable let-pattern を if-let 化、`refresh` / `get_source_snapshot` / `source_snapshots` / `remove_hunk` / `clear_file_hunks` に TerminalState 対応 arm 追加 (すべて no-op)
- ✅ `LayerRegistry::register_snapshot_layer` 追加 — grid 埋め込みで 1 回の呼び出しで完結
- ✅ IPC: `start_snapshot_overlay(snapshotId) -> LayerSummary` を `snapshot_commands.rs` に実装、`lib.rs` invoke_handler 登録。dismiss は既存 `dismiss_ghost_layer` 流用
- ✅ Read-only enforcement: `apply_ghost_hunk` / `apply_ghost_file` は既存の `registry.is_read_only()` gate で自動 reject (snapshot source が true を返す)
- ✅ Tests: layer 6 本 + registry 6 本 (read-only / duplicate id reject / source_snapshots skip / refresh no-op / remove_hunk none / clear_file_hunks false) 追加
- ✅ `scripts/verify-3c3.mjs` に G ステップ追加 — overlay 起動 → list 確認 → apply_* reject × 2 → unknown id reject → dismiss

#### 3C-3c. Frontend TimelineBar ✅ 完了 (2026-04-18)
- ✅ `src/shared/types/snapshot.ts` 新規 — SnapshotId / SnapshotTrigger / TerminalSnapshot / SnapshotSummary / SnapshotCapturedEvent TS side。`triggerLabel()` ユーティリティ付き
- ✅ `src/shared/types/ghostdiff.ts` 拡張 — LayerSource の `snapshot` variant + LayerContent (新規) の `terminalState` variant。`isReadOnlyLayer` は snapshot も true
- ✅ `src/shared/hooks/useSnapshots.ts` 新規 — `list_snapshots` で初期化 + `snapshot:captured-{sessionId}` イベントで再 fetch。`fetchFullSnapshot` / `startOverlay` / `markSnapshot` もラップ
- ✅ `src/features/timeline/TimelineBar.tsx` 新規 + `.module.css` — 横長バー、snapshot ごとに tick、userMarked は pink の太 tick、active は teal+glow。empty 状態テキスト / Mark ボタン / "Viewing past state" pill + dismiss
- ✅ `src/features/terminal/NativeTerminalArea.tsx` 統合:
  - overlay state `{ layerId, snapshotId, grid }` を保持、terminalId 変化で自動 clear
  - tick click → `get_snapshot` でフル grid 取得 → `start_snapshot_overlay` で Layer 作成 → `TerminalCanvas snapshotOverride={overlay.grid}` に渡す (既存の test-injection prop を流用)
  - Esc (terminal area 内フォーカス時) で `dismiss_ghost_layer` + state clear
  - `ghost-diff:layer-removed` 受信で外部 dismiss も検知
  - overlay 中は ghostSuggestion を抑制
- ✅ `GhostDiffPanel.tsx` の `layerCaption` に snapshot arm 追加 — 時刻付きキャプション + セッション ID プレフィックス。`readOnly` を `isReadOnlyLayer` ヘルパ経由に refactor
- ✅ Tests: `useSnapshots.test.ts` 7本 + `TimelineBar.test.tsx` 7本 = 14本。`pnpm test` 579 passed
- ✅ `scripts/verify-3c3.mjs` H-step 追加 — TimelineBar DOM presence / label / tick count

#### 3C-3d. E2E verify (1 日) — 人間検証待ち
- `scripts/verify-3c3.mjs` A〜H 自動検証はコード完了 (3C-3a/b/c で随時追加)
- 実走は `pnpm tauri:dev` 前提、GUI 長時間プロセスなので手動キック必要
- 手順書: `docs/visual-check-phase3.md` の 3C-3 タイムトラベル手動検証章

### Post-review follow-up (2026-04-18)
code-reviewer agent の結果に対応する fix を別 commit で実施:
- **HIGH**: tick 高速クリックで LayerRegistry に未 dismiss 残る → `snapshotOverlayRef` + `selectSnapshot` で「新 overlay 起動前に既存を dismiss」
- **MEDIUM 1**: terminalId 変化で backend layer 未 dismiss → terminalId effect の cleanup で dismiss
- **MEDIUM 2**: ghost-diff:layer-removed listener 登録レース → mount 時に ref 経由で unconditional 登録
- **MEDIUM 3**: useSnapshots 二重インスタンス → TimelineBar 側の hook 呼び削除、NativeTerminalArea から `snapshots` prop で注入
- **LOW 2**: mark_snapshot label 無上限 → 256 バイト cap (`sanitize_label` + 5 unit tests)
- **LOW 1 (send_keys bypass)**: `send_keys` IPC は snapshot 捕捉しない既存バグ、3C-3 スコープ外 → memory に「send_keys 経路は timeline に乗らない」と記録のみ
- **LOW 3 (overlay 中 typing)**: 仕様通り live shell に届く、`docs/visual-check-phase3.md` D-1-f に注記済み

### 見積

| sub | 目安 |
|---|---|
| 3C-3a | 4-5 日 |
| 3C-3b | 2-3 日 |
| 3C-3c | 3-4 日 |
| 3C-3d | 1 日 |
| **合計** | **2-3 週** |

### リスク

- **プロンプト検出精度**: PowerShell / bash / CMD で挙動バラつく。最初は Enter 押下 + PTY quiet window で近似、精度出なければ OSC 133 (最新シェル) 対応
- **grid snapshot のメモリ圧**: 100 snapshots で 800KB、長時間セッションで増える。上限 + eviction で制御
- **terminal 描画への侵襲**: 既存 xterm 風 renderer に snapshot overlay を挿入する箇所の設計が微妙。grid を一時差し替えるか、別レイヤで描くか決める必要あり
- **AI CLI セッションは除外**: interactive session の state snapshot は別問題 (prompt 検出できない)、MVP 後に判断

### 完了条件 (sub ごと)

- Rust tests / TS tests グリーン
- `scripts/verify-3c3.mjs` で全 check 通過
- plan + memory 更新
- commit (sub ごと 1 commit)

---

# Phase 3D — 実験枠

**都度判断**:

- **3D-1 Terminal-as-an-API** (ideas.md H) — HTTP/WS で PTY 公開
- **3D-2 インライン viz** (ideas.md C1) — ログ内数値の動的グラフ
- **3D-3 3D project map** (ideas.md C3) — LSP 依存の 3D 可視化

---

# 進行管理

- 各タスク開始時: このドキュメントを参照 + memory の `project_phase3_progress.md` (完成時作成) を参照
- 各タスク完了時: commit + 本ドキュメントに完了マーク + memory 更新
- phase 跨ぎ: 前 phase の視覚検証が 100% 済でないと先に進まない

# 非スコープ (Phase 3 では扱わない)

- フルネイティブ wgpu 版への再移行 — 戦略確定済で見送り
- macOS/Linux 対応 — Windows 11 に集中
- マルチユーザ / 共同編集 — 単独開発者向けに固定
