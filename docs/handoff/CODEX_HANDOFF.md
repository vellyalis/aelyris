# Codex 引継ぎ書 — Aether Terminal

**作成**: 2026-04-28
**作成元 master**: `b0b9362`
**前提**: このドキュメントだけで codex が自走できる self-contained 仕様。 別セッション・別 context から開始する codex 向け。

---

## 0. 最初に読むべき優先順 (3 分で把握する)

1. このドキュメントの **§1 (現状)** + **§3 (残作業)** + **§5 (制約)** を順に読む。
2. リポジトリ root の `CLAUDE.md` は本プロジェクトのコーディング規約。 必ず守ること。
3. `~/.claude/CLAUDE.md` (ユーザーグローバル規約) は codex 自身には適用されないが、 「Codex 検証鉄則」 セクションは codex がレビュー対象になる前提なので把握しておく。
4. `docs/ROADMAP_POST_0_2_4.md` は公式ロードマップ。 Tier 🔴/🟡/🟢 grade 規約。

---

## 1. プロジェクト現状 (2026-04-28)

### 1.1 概要

**Aether Terminal**: Windows 向けプロジェクトファースト AI ワークスペースターミナル。 Tauri v2 + Rust backend + React frontend。

| 項目 | 値 |
|---|---|
| Framework | Tauri v2 |
| Frontend | React 19 + TypeScript + CSS Modules + Vite 7 |
| Backend | Rust (portable-pty, git2, rusqlite, tokio) |
| Terminal Engine | native Rust (xterm.js は Phase 2 で除去) |
| Editor | Monaco Editor + Vim mode |
| UI | Radix UI primitives + Lucide + motion |
| Window | Mica (Win11) / Acrylic (Win10 fallback) |
| Theme | Catppuccin Mocha + 18K Gold |
| Database | SQLite (rusqlite) |
| Tests | cargo test (171 cases) + vitest (885 cases) |

### 1.2 git state

- **master**: `5eaba5e` "fix(round-11): scope terminal image cache by pane"
- **branches**: master のみ
- **worktree**: clean (`AGENTS.md` のみ untracked、 round 4 から残り。 削除可否は user judgement)
- **tags**: `v0.2.3`, `v0.2.2`, `v0.2.1`, `v0.2.0` (次 bump 候補は v0.2.4、 ship gate は §3.1 参照)

直近 commits (round 6→11):

```
5eaba5e fix(round-11): scope terminal image cache by pane
d1c72ef docs(handoff): record round-10 ghost apply-all fix
4d44aec fix(round-10): gate ghost apply-all on mounted editor
b0b9362 fix(round-9): clear hunkAnchors when editor handle goes null
1f0582e fix(round-8b): close cross-cycle inflight starvation in useTerminalImages
34125d6 fix(round-8): close 6 silent bugs across shared/hooks
41bc676 fix(round-7): close useGhostLayers listener race via monotonic seq + reorder buffer
2655e1b fix(round-6): close useTerminalSnapshot listener race via wire-level images carry
c6549dc fix(round-5): Settings.tsx loadedConfig stale-snapshot reset
9a62a56 fix(round-4): silent-bug pass across 9 review areas
2c6ee5b fix(agent-inspector): action-keyed diff cache + not-found-only error suppression
```

### 1.3 完了済みのフェーズ

| フェーズ | 状態 | 備考 |
|---|---|---|
| Phase 1 | ✅ | 分割ペイン / ブロック出力 / IME / エージェント UI 基盤 |
| Phase 2 | ✅ `d4df53a` | xterm.js 除去 + native Rust engine |
| Phase 3A | ✅ | 並列エージェント (headless + interactive + output monitor + router) |
| Phase 3B | ✅ | Watchdog (rule + auto-repair pipeline) |
| Phase 3C | ✅ | Ghost diff (3C-1〜3C-4) |
| 3D-1 v1 | ✅ `430a053` | リモート auth / resize / typed errors / session cap |
| 3D-1 v2c | ✅ | CORS / TLS / rate limit (TLS は remote 公開まで据え置き) |
| ROADMAP_POST_0_2_4 🔴 #1 | ✅ | Win APC delivery via chunked OSC 1338 — 全 sprint landed |
| ROADMAP_POST_0_2_4 🟢 #2 | ✅ | inline-image dogfood scripts |
| ROADMAP_POST_0_2_4 🟢 #6 | ✅ | inline-image memory budget telemetry |

### 1.4 戦略方針 (2026-04-17 確定)

`project_strategic_direction` に記録: **Agent workspace 超 Scape 方針**。 Tauri+React 維持、 フルネイティブ wgpu は見送り。 過去の `docs/handoff/` (01〜05) はフル Rust 移行用の旧計画。 採用しない。

### 1.5 local-only 運用

**Aether Terminal は local-only**。 GitHub remote を使わず、 push / PR / release 作成は提案しない。 codex も remote 操作はしないこと。

### 1.6 採用しない技術

- **Tailwind CSS** (Liquid Glass design system + CSS Modules を採用)
- **shadcn/ui** (Tailwind 前提のため)

代わりに **Radix UI primitives** + 自前 design tokens + CSS Modules。

---

## 2. アーキテクチャ概観

```
aether-terminal/
  src-tauri/              # Rust backend
    src/
      pty/                # PTY (ConPTY, シェル起動, 出力バッファ)
      agent/              # AI エージェント (headless + interactive + output monitor + router)
      git/                # git2-rs (status, worktree, file tree, discovery)
      lsp/                # LSP JSON-RPC (rust-analyzer / pyright / etc.)
      db/                 # SQLite 永続化
      config/             # TOML 設定
      watchdog/           # ツール承認 + auto-repair
      workflow/           # YAML マルチフェーズワークフロー
      suggest/            # コマンドサジェスト
      session/            # セッション/ペイン lifecycle
      ipc/                # Tauri コマンドハンドラ (68+ commands)
      ghostdiff/          # Phase 3C-1 ghost paint レイヤ管理
      watcher.rs          # FS 変更監視
      lib.rs              # Tauri アプリエントリ
  src/                    # React frontend
    features/
      terminal/           # ターミナル (ペイン分割, ブロック出力, Ghost Text)
      editor/             # Monaco (LSP, Diff, Vim mode, ghost paint)
      file-tree/          # ファイルツリー (git status 統合)
      agent-inspector/    # エージェント監視パネル
      agent-terminal/     # インタラクティブエージェントターミナル
      command-palette/    # コマンドパレット (cmdk)
      kanban/             # タスクボード
      workflow/           # ワークフロービルダー (ReactFlow)
      scm/                # Git 操作 (stage/commit/push)
      watchdog/           # Watchdog ルール編集
      toolkit/            # ワンクリックツールボタン
      analytics/          # セッション分析
      search/             # ファイル内テキスト検索
      settings/           # 設定 UI
      welcome/            # プロジェクト選択画面
      pr-inspector/       # PR 表示
      statusbar/          # ステータスバー
      workspace-tabs/     # タブ管理
      header/             # プロジェクトヘッダー
      menubar/            # メニューバー
    shared/
      ui/                 # 共通 UI (SplitPane, Toast, Dialog, etc.)
      hooks/              # React hooks (25 ファイル、 round 4-8 で多くを review 済)
      store/              # Zustand
      lib/                # ユーティリティ
      types/              # TypeScript 型定義
    styles/
      global.css          # design system (Liquid Glass, トークン, スペーシング)
```

### 2.1 重要な wire / IPC 規約

| 規約 | 場所 | 影響 |
|---|---|---|
| chunked OSC 1338 (inline image) | `docs/chunked-osc-image-protocol.md` | Win11 ConPTY APC が 25H2 で silently drop されるため OSC 側チャネル経由 |
| `GridDiff::images: Option<Vec<ImageRef>>` | `src-tauri/src/term/...` + `src/shared/hooks/useTerminalSnapshot.ts` | round 6 で wire 追加。 image set を full=true 毎 + partial で changed 時に carry |
| `LayerEvent { seq, ... }` + `LayerSnapshot` | `src-tauri/src/ghostdiff/registry.rs` + `src/shared/hooks/useGhostLayers.ts` | round 7 で wire 追加。 monotonic seq + reorder buffer で listener race close |
| OSC 133 prompt marks | `src/shared/hooks/usePromptMarks.ts` | round 8 で listener-before-seed + 順序保証 mergeMark に書き換え |

### 2.2 listener arming pattern (must follow)

`useTerminalSnapshot` (round 6) → `useGhostLayers` (round 7) → `usePromptMarks` (round 8) で確立した正規 pattern。 Tauri event を listen する hook を新規作成 / 修正する場合は必ず:

```ts
useEffect(() => {
  setState(initialEmpty);  // terminalId 変化時の reset を保証
  if (!terminalId) return;
  let cancelled = false;
  let unlisten: UnlistenFn | null = null;
  (async () => {
    try {
      // Step 1: register listener BEFORE seed invoke
      unlisten = await listen<T>(`event:${terminalId}`, (event) => {
        if (cancelled) return;
        setState((prev) => mergeWithSeq(prev, event.payload));
      });
      if (cancelled) {
        unlisten();
        unlisten = null;
        return;
      }
      // Step 2: seed and merge with anything the listener already delivered
      const seed = await invoke<T[]>("seed_command", { id: terminalId });
      if (cancelled) return;
      if (Array.isArray(seed)) {
        setState((prev) => seed.reduce(mergeWithSeq, prev));
      }
    } catch {
      /* backend unreachable */
    }
  })();
  return () => {
    cancelled = true;
    unlisten?.();
  };
}, [terminalId]);
```

このパターンを破ると round 6/7/8 で見たような silent listener race が再発する。

---

## 3. 残作業 (優先度順)

### 3.1 🔴 v0.2.4 ship blocker

**ship 出来る状態だが実機 verify が止まっている。** 順番に消化する:

1. **Win11 dogfood**: `node scripts/diag-chunked-osc.mjs` を Win11 25H2 build 26200+ で実行、 4/4 expected 結果。
2. **Tauri 実機 visual verify (累積 68 項目)**: Rust + Frontend 同時再ビルド後に通しで実施。 round 6/7/8/9/10/11 累積項目を §6 から拾うこと。
3. **status-bar inline-image budget badge** の preview-server visual 確認。
4. ↑ 3 つ green になれば v0.2.4 tag 候補。 user 判断で bump。

### 3.2 🟡 silent-bug pass 残候補 (round 10+)

| # | 場所 | 概要 | 影響 |
|---|---|---|---|
| 4 | `src/features/agent-terminal/AgentTerminal.tsx` | exited 状態でも IMEInputBar が active | UX confusion |
| 5 | `src/features/editor/DiffViewer.tsx` | `onGlyphMarginClick` stale closure | 将来拡張で問題化 |
| 7 | (前 handoff) | `<$prefix` 4 箇所 / Accept stub / button-in-button / tokens / 10000 / cardBranch 重複 | low |
| 8 | `src/features/kanban/KanbanCard.tsx` + `KanbanColumn.tsx` | dead-code refactor (削除 or 採用判断必要) | code health |
| 11 | `src/features/agent-inspector/ConductorView.tsx` 連携部分 | レビュー未着手 | unknown |

### 3.3 🟡 round 7-8 で持ち越した残存リスク

| # | 概要 |
|---|---|
| 12 | `useGhostLayers` の `pendingRef` stuck pending recovery: backend バグで seq=N が永遠に来ない場合の resync (5 秒 setInterval で gap 検出 → `list_ghost_layers` snapshot で resync → pendingRef drain) |
| 13 | `send_happens_under_lock_so_channel_order_matches_seq_order` test の strength: 単一スレッドのみで assert している。 multi-thread fuzz (proptest 等) で 「lock 外 send は必ず落ちる」 を強い regression として保証 |

### 3.4 🟢 ロードマップ後回し (`docs/ROADMAP_POST_0_2_4.md` 残)

| # | Tier | 概要 |
|---|---|---|
| 3 | 🟢 | Frontend canvas pixel-sample E2E spec — `addInitScript` で `__TAURI_INTERNALS__.invoke` stub する harness 必要 |
| 4 | 🟢 | OSC 1337 (iTerm2 imgcat) inline image protocol — payload が OSC 133 scanner と overlap、 Kitty/Sixel と同等 |
| 5 | 🟢 | Scrollback inline image rendering — `ImageRef` に history index 必要、 snapshot shape も別。 dogfood で痛みが出るまで保留 |

### 3.5 次の大物テーマ (未確定)

`docs/ROADMAP_POST_0_2_4.md` 末尾より: **「2026-05-14 まで `project_dogfood_log.md` で痛みを蓄積、 そこから次の Tier 🔴 を起こす」** 方針。 作業着手は user 判断待ち。 codex 自走では着手しないこと。

---

## 4. 検証 / build / commands

### 4.1 必須 commands

```bash
# Frontend dev (Vite)
pnpm dev

# Tauri dev (Rust + Frontend)
pnpm tauri dev          # production
pnpm tauri:dev          # CDP attach 有効版 (port 9222)

# build
pnpm build
pnpm tauri build

# tests
cargo test --manifest-path src-tauri/Cargo.toml    # Rust unit tests (171)
pnpm test                                          # vitest (885)
pnpm exec tsc --noEmit                             # TS type check

# Rust 単体 check (build せず)
cargo check --manifest-path src-tauri/Cargo.toml

# E2E (CDP attach 必要 → pnpm tauri:dev 起動中)
node scripts/verify-3c2.mjs
node scripts/verify-3c3.mjs
node scripts/verify-ime.mjs
```

### 4.2 Rust 再コンパイル要件 (累積)

round 6 で `GridDiff::images` wire 追加、 round 7 で `LayerEvent` 構造体変更、 前々セッション (`259b7a2`) で `core:window:allow-destroy` capability + `build.rs` 変更。 **実機 verify 前に Rust + Frontend 同時再ビルド必須**:

```powershell
Get-Process aether-terminal -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item "C:\Users\owner\Aether_Terminal\src-tauri\target\debug\aether-terminal.exe" -Force -ErrorAction SilentlyContinue
pnpm tauri:dev
```

### 4.3 反映タイミング

| 種類 | 反映方法 |
|---|---|
| TS / CSS 変更 | Vite HMR (即時) |
| `tauri.conf.json` | プロセス再起動 |
| `src-tauri/capabilities/*.json` | **Rust 再コンパイル必須** |
| `src-tauri/build.rs` | Rust 再コンパイル必須 |
| `src-tauri/src/**/*.rs` | Rust 再コンパイル必須 |

### 4.4 RTK (Rust Token Killer) 制約

User 設定で全 shell command は `rtk` プレフィックス必須 (Codex 検証ハンドオフを除く)。 codex は通常 shell を自由に使えるが、 Claude が codex に diff を渡す際は `rtk proxy <cmd>` か rtk なしで生出力を取る。 codex 自身が shell を叩く分には rtk 不要。

---

## 5. 制約 (codex が違反してはいけないルール)

1. **読んでいないコードを変更しない** — 推測で書き換え禁止。 変更前に必ず Read で確認。
2. **commit message は日本語可だが本文は英語推奨** (round 6-9 の commit message 参照)。
3. **`--force` push を main/master にしない** (そもそも remote 無いが)。
4. **新規 doc を勝手に作らない** — 既存 docs を更新する。 例外: 本ドキュメントのような明示的依頼。
5. **Tailwind / shadcn を導入しない**。
6. **listener arming pattern (§2.2) を守る** — 新規 listener hook はこのパターン以外不可。
7. **wire format 変更時は consumer を全部 grep して migrate** — round 7 で `LayerEvent` 変更時に `NativeTerminalArea.tsx` を漏らした教訓。
8. **silent-bug fix は test 必須** — fix だけで test 無しは BLOCK 対象 (round 8 で codex r0 が指摘)。
9. **memory file (`~/.claude/projects/.../memory/`) は触らない** — Claude 専用領域。 codex はリポジトリ内の docs / 本ドキュメントのみ更新可。
10. **path に space が含まれる場合は double-quote** で囲む。

---

## 6. 累積 Tauri 実機 visual verify 項目 (68 項目)

dogfood 機 (Win11 25H2 build 26200+) で通し実施する。 内訳は memory `project_next_session_handoff.md` に詳細あり。 圧縮版を以下に再掲:

### round 11 で追加 (1 項目)

68. **useTerminalImages cross-pane image id reuse**: terminal A で inline image を 1 枚表示してから、 別 terminal B で同じ `ImageId=0` になる inline image を表示する。 B に切り替えた直後、 B には B の画像だけが描画され、 A の画像が一瞬でも混入しないことを確認。 検証手段: 明確に異なる色/サイズの画像を使い、 pane switch 後の canvas を目視 + screenshot 比較する。

### round 10 で追加 (1 項目)

67. **useGhostPaintForFile apply-all editor=null silent corruption**: ghost layer painted な file タブを 1 つ開いた状態で同 file タブを閉じる、 または EditorPanel を hide する。 その状態で palette command "Apply all ghost hunks in file" を発火 → no-op で完了 (旧バグだと `apply_ghost_file` が走って main file が編集される)。 検証手段: file 閉じた後に `git diff` を実行して main 側に余計な編集が無いことを assert。

### round 9 で追加 (1 項目)

66. **useGhostPaintForFile editor=null silent corruption**: ghost layer painted な file タブを 1 つ開いた状態で同 file タブを閉じる、 または EditorPanel を hide する。 その状態で palette command "Apply ghost hunk at cursor" を発火 → no-op で完了 (旧バグだと apply 走って main file が編集される)。 検証手段: file 閉じた後に `git diff` を実行して main 側に余計な編集が無いことを assert。

### round 8 で追加 (6 項目)

60. **useTerminalImages**: 大小違う画像を OSC 1337 で複数表示中、 ターミナル resize で full=true diff が連続発生しても画像が消えずに paint され続ける (旧バグだと resize で画像が一時消える)。
61. **usePromptMarks**: PowerShell + OSC 133 prompt mark が連続発火する shell プロファイル (Starship 等) で、 マウント直後に prompt mark が抜け落ちずに表示される。
62. **useTerminalNotifications**: タブを高速で開閉してもリスナー leak しない (Memory Profiler 確認)。
63. **useImageMetrics**: 画像メトリクス badge を表示中に Win+D で minimize → restore を 5 回繰り返しても、 IPC 重複呼び出しなし (devtools network panel)。
64. **useLogStream**: in-app log panel をマウント直後の最初の 1 秒で発生したログが表示される (旧 race だと最初の 1 秒分が overwrite で消える)。
65. **useArrowKeyList**: ファイルツリーで多数選択された状態から item を削除 → 残りの item で Enter が反応する (現在 consumer 無いが将来用に保証)。

### round 7 で追加 (1 項目)

59. ghost layer overlay (auto-repair / branch-comparison / snapshot) を表示中、 ghost-diff panel から layer dismiss → 即座に panel から消える + NativeTerminalArea の snapshot overlay も同期解除。 また同時に他 layer の event が発火しても reorder buffer 経由で正しい順序適用。

### round 1〜6 累積 (58 項目)

memory `project_next_session_handoff.md` の旧履歴に詳細。 取り出すには Claude 経由で memory 読む or 過去 commit の handoff コメントを参照。 codex がここに access できない場合は user に確認すること。

---

## 7. codex に依頼する場合の作業手順テンプレート

### 7.1 silent-bug 修正案件

```
1. handoff §3.2 / §3.3 から item を 1 つ選ぶ。
2. 該当ファイルを Read で完全に読む (推測しない)。
3. silent bug の trace を書く (どの input で何が起きるか具体的に)。
4. fix を minimal に書く。 副作用最小化。
5. 既存テストを Read、 新規 test を 1〜3 件追加。
6. 検証:
   - `pnpm test`
   - `pnpm exec tsc --noEmit`
   - 必要なら `cargo check --manifest-path src-tauri/Cargo.toml`
7. user に diff stat を見せて commit を求める。
8. commit message は round 6-9 のフォーマットに揃える (英語、 概要 1 段 + 詳細 + 検証コマンド)。
9. `docs/handoff/CODEX_HANDOFF.md` (本ドキュメント) を更新:
   - §1.2 git state の HEAD と直近 commits
   - §3.2 / §3.3 から完了 item を消す
   - §6 累積 visual verify 項目を追加 (該当する場合)
```

### 7.2 v0.2.4 ship 案件

```
1. user 環境 (Win11 25H2) で:
   - Rust + Frontend 同時再ビルド (§4.2 手順)
   - `pnpm tauri:dev` 起動
2. `node scripts/diag-chunked-osc.mjs` 実行 → 4/4 expected を確認。
3. 累積 68 項目を §6 順に通し verify。 結果を `docs/handoff/v0.2.4-verify-result.md` に記録。
4. 全項目 green になったら user に v0.2.4 tag 提案 (codex 単独で tag しない)。
```

### 7.3 wire format 変更案件

```
1. backend (Rust) と frontend (TS) 双方の consumer を全部 grep。
2. wire 変更の motivation を doc に記録 (`docs/handoff/` 配下に新規作成可)。
3. backend 変更 → cargo test green。
4. frontend types 更新 → tsc green。
5. consumer 全部を migrate → vitest green。
6. 検証 + commit。
7. §2.1 の wire 規約表に追記。
8. §4.2 Rust 再ビルド要件に追加。
9. 累積 visual verify 項目に追加。
```

---

## 8. user 傾向メモ (意思決定の手がかり)

memory `project_next_session_handoff.md` ユーザー傾向セクションから抜粋。 codex が user response を受ける際の参考:

- 「全部終わった」 と言うと真摯に再検証される。 「全部見たか?」 を聞かれる。
- visual verify を skip すると指摘される。 cargo check だけでは不十分。
- Apple クラスの quality bar で減点要素を厳しく問われる (`feedback_apple_class_ui_baseline.md`)。
- shadcn / Tailwind を使わない代わりに Radix で自前実装。
- 「読み流すんじゃなくてレビュー」 と言われる。
- 「codex にもレビューさせて」 と言われる (本来 Claude 側のフロー)。
- 「つぎ」 / 「つづけて」 / 「次に進んで」 短い指示 → handoff memo を読み直して自律判断で進める。
- 「すすんでる？」 / 「進んでる？」 中間確認 → 簡潔に進捗報告。
- 「A でいいんじゃない 問題が無ければ」 → review verdict が valid なら commit 進める。
- **「どれが最適で最善なの？？それを先にいえ」 → 推奨を断定して先に出す**。 選択肢を並べる前に判断を置く。

---

## 9. 参考リソース

| 用途 | パス |
|---|---|
| 公式ロードマップ | `docs/ROADMAP_POST_0_2_4.md` |
| 旧ロードマップ (履歴) | `docs/ROADMAP_POST_0_2_2.md`, `docs/ROADMAP.md` |
| 要件定義 | `docs/requirements.md`, `docs/requirements-v2-native.md` |
| chunked OSC 1338 protocol | `docs/chunked-osc-image-protocol.md` |
| chunked OSC sprint 計画 | `docs/chunked-osc-sprint2-3-plan.md` |
| inline image dogfood | `docs/inline-image-dogfood.md` |
| inline image user guide | `docs/inline-image-user-guide.md` |
| inline image troubleshooting | `docs/chunked-osc-troubleshooting.md` |
| Phase 3 計画 | `docs/phase3_plan.md` |
| Phase 3 code review | `docs/phase3-code-review.md` |
| design system | `docs/DESIGN_SYSTEM_NATIVE.md`, `docs/NATIVE_UI_DESIGN.md` |
| keyboard shortcuts | `docs/KEYBOARD_SHORTCUTS.md` |
| design philosophy | `docs/design-philosophy.md` |
| auto updater setup | `docs/auto_updater_setup.md` |
| 旧ハンドオフ (フル Rust 移行用、 採用しない) | `docs/handoff/01_*` 〜 `05_*` |

---

## 10. 連絡 / 質問

codex がブロッカー (例: §3.5 のような大物テーマ着手判断) に当たった場合:

1. 質問を整理: 何を判断したいか、 選択肢、 各 trade-off。
2. 推奨を 1 つ決めて先に出す。
3. user に提示。 yes/no で進む形にする。

「考えながら聞く」 のではなく 「断定 + 確認」 のスタイル。

---

**END**

このドキュメントは round 6〜9 の積み上がりに対する snapshot。 round 10 以降の commit が入ったら §1.2 git state と §6 累積 visual verify を更新すること。
