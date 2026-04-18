# Phase 3 視覚検証チェックリスト

**最終更新**: 2026-04-18
**対象コミット**: 25016df (Phase 3C-1d 完了時点)

Phase 3 の全機能を実機で確認するためのチェックリスト。各項目は plan (`docs/phase3_plan.md`) の「視覚検証」節から抽出。チェック欄にマーク付けながら順次確認する。

## 前提

- `pnpm tauri dev` で起動済
- `AETHER_TERM_NATIVE=1` 環境変数 (native renderer 有効化) 推奨
- プロジェクトは git worktree が使えるもの (aether-terminal 自身で OK)
- テスト用エラー出しに適当な Rust/TS プロジェクトがあると便利

## 3C-1c. Hotkey accept/reject + apply (最優先)

**セットアップ**: 3C-1a / 3C-1b のセットアップ済とする (ghost layer が見えている状態)。

- [ ] カーソルを ghost hunk の行に置いた状態で **Tab** → hunk 実体化、トースト `Ghost hunk applied` が出る
- [ ] hunk なしの行で **Tab** → Monaco の default tab (indent) が動作
- [ ] **Shift+Tab** → file 内の全非衝突 hunk が一気に accept、トースト `All ghost hunks applied`
- [ ] **Esc** → 現ファイルの ghost 消える、トースト `Ghost layers dismissed`。同 layer の **他ファイルの ghost は残る**
- [ ] apply 後ファイルが modified マーク (breadcrumb の dot) になる
- [ ] apply 後 `Ctrl+S` で保存 → ディスク反映
- [ ] Accept 後カーソル位置がおおむね保たれている (1,1 にリセットされない)
- [ ] AI CLI 実行中 (claude 等) に Tab/Esc が pty に送られない (ContextKey gated)
- [ ] 競合 hunk (dirty line と交差) がある時、Tab でそれが accept されない (EditorBreadcrumb に warning badge)

## 3C-1d. Live mode flag

- [ ] `Ctrl+,` で Settings 開く → "Ghost Diff Overlay" セクションがある
- [ ] Live mode toggle が **default off** になっている
- [ ] toggle off のまま agent 起動 → panel には layer 出るが inline ghost paint **出ない**
- [ ] agent 完了 (is_complete=true) → inline ghost paint 出現
- [ ] toggle on にして save → agent 実行中でも inline paint がリアルタイム表示
- [ ] アプリ再起動後も toggle 設定が保持される (`%USERPROFILE%\.aether\config.toml` の `[ghost_diff]` 確認)

## 3C-1b. Monaco inline ghost paint

- [ ] auto-repair もしくは Orchestra で agent 起動
- [ ] agent が別 worktree でファイル編集
- [ ] EditorPanel でそのファイルを開く → 薄緑の ghost 行 (add) が insert 位置に出現
- [ ] delete 行 → 取消線 + 赤背景
- [ ] EditorBreadcrumb に `Sparkles` badge (layer 数)
- [ ] 自分がファイルの別の箇所編集 → ghost paint は維持される (非衝突)
- [ ] 自分が ghost と同じ行を編集 → ghost 非表示 + breadcrumb が `FileWarning` red badge
- [ ] ファイル閉じる → ghost paint 消える (panel の layer は残る)
- [ ] 再度同じファイル開く → ghost paint 復活

## 3C-1a. Ghost diff panel

- [ ] StatusBar の 🔧 横に Layers ボタン + active count バッジ
- [ ] Layers ボタン click → panel pop で layer 一覧
- [ ] auto-repair 1 件走らせる → layer が panel に 1 秒以内出現、completed マークが付く
- [ ] Orchestra で 2 agent 起動 → layer 2 つ並び、各 layer の左に role color が出る
- [ ] agent が追加で書く → panel の file count / hunk count が動く
- [ ] panel の dismiss ボタンで layer 全体消える

## 3A-1. 自己修復 E2E

**セットアップ**: Watchdog rule で "cargo error" 等のパターンを登録 (コマンドパレット > Watchdog: Edit Rules)

- [ ] 意図的にビルドエラーを PTY に流す (例: `cargo build` で壊れた Rust コード)
- [ ] Watchdog が検知 → トースト "修復を開始" 的な表示
- [ ] StatusBar の 🔧 バッジで active count 増える
- [ ] jobs panel で phase 遷移確認 (CreatingWorktree → RunningAgent → RunningTests → Succeeded/Failed)
- [ ] 別 worktree が実際に作られている (`git worktree list`)
- [ ] Claude CLI が呼ばれる (タブで見える)
- [ ] 成功 or 失敗で通知閉じる
- [ ] **debounce**: 同じエラーを 60s 内に 10 回流しても job は 1 つのみ

## 3A-2. Ghost typing (fish-style)

**セットアップ**: 通常シェルで履歴に `git status` が入ってる状態

- [ ] `git st` 入力 → 薄灰色で `atus` がインライン表示
- [ ] **Tab** で受諾 → `git status` 完成、Enter で実行
- [ ] 方向キー (←↑→↓) で予測消える
- [ ] Backspace で予測再計算される
- [ ] AI CLI (claude) 起動中は予測が出ない (`aiCli.active` で mirror 停止)
- [ ] IME 変換中は予測なし
- [ ] 空入力時は予測なし

## 3B-1 / 3B-1c. Orchestra mode + Conductor DAG

- [ ] AgentInspector の ♫ ボタン → OrchestraDialog が開く
- [ ] textarea にタスク + role checkboxes (implementer/tester/reviewer デフォルト ON)
- [ ] 3 agents 起動 → 各 SessionCard に role badge (icon + label) + role color
- [ ] 2 agent が同じファイル編集 → conflict badge (peach FileWarning)
- [ ] AgentInspector の "conductor" タブ (Share2 icon) → ReactFlow で 3 列表示
- [ ] 各 node の色が role color
- [ ] session 右クリック → Handoff → role dropdown + task 入力 → 起動 → edge 線が親 → 子に伸びる

## 3B-2. Semantic history search

- [ ] **Ctrl+R** → HistorySearchDialog が開く
- [ ] 入力 → debounce 後に候補リスト
- [ ] ↑↓ 選択 / Enter で command を入力欄に書く (実行はしない、fish 流)
- [ ] "Failed only" chip → 失敗コマンドだけフィルタ
- [ ] "This project" chip → cwd prefix フィルタ
- [ ] Esc で dialog 閉じる

## 横断チェック

- [ ] アプリ再起動で Settings (テーマ/Live mode/etc) が保持される
- [ ] Ctrl+? でヘルプ開いてショートカット一覧が表示される
- [ ] パネル開きっぱなしでメモリリークしない (時間置いて Task Manager で確認)

---

## 報告フォーマット

検証中問題を見つけたら:
```
❌ 3C-1c: Tab で hunk accept した後 ghost paint が消えない
   再現: ...
   期待: ghost paint 消失
   実際: ghost paint 残る、次の Tab は効かない
```

## 完了条件

全項目 ✅ で Phase 3 積み残し検証 クローズ。
