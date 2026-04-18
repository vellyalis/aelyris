# Phase 3 視覚検証チェックリスト

**最終更新**: 2026-04-18
**対象コミット**: 0e28dd4 (Phase 3C-2 MVP 完了時点)
**所要時間**: コア (3C-2 + 3C-1c) で約 15 分、全項目で約 45 分

Claude から Tauri window 操作ができないので、実機検証はユーザーが行う必要がある。
このドキュメントは「何を触って、何を見て、何なら OK か」を手順レベルで書き下した版。

## 事前準備 (1 回)

- [ ] `pnpm tauri dev` が起動中 (既に起動しているはず — port 1420 占有してる)
- [ ] Tauri window で Aether Terminal が開いている
- [ ] `C:\Users\owner\Aether_Terminal` を **Open Folder** で開く (複数ブランチある必要があるので、このリポジトリ自体が最適)
- [ ] 左サイドバーでファイルツリーが見える状態

トラブル時:
- window が反応しない → タスクマネージャで `aether-terminal.exe` 終了 → `pnpm tauri dev` 再起動
- HMR で挙動が変 → window 再起動

---

# 🔴 コア検証 (必ずやる、所要 15 分)

## A. 3C-2 Branch Comparison — 新規機能 (所要 5 分)

### A-1. コマンドパレットから起動

1. **Ctrl+Shift+P** でコマンドパレット開く
2. `compare` と入力
3. 「**Compare Branch...**」が View カテゴリに現れる → 選択
4. プロンプトが出る:
   - タイトル: `Compare <現在のブランチ> against branch`
   - プレースホルダー: 非 HEAD / 非 remote の branch 名が 8 個まで列挙 (例: `main, xxx, yyy`)
5. `main` と入力 → Enter
   - 現在が `refactor/tauri-react-migration` なら base = それ、head = `main`

**✅ 期待**:
- toast `Branch comparison started` + `<base> ← main` 表示

**❌ 失敗パターン**:
- toast `base and head must differ` → 現在ブランチ名を入れたので `main` 以外にする
- toast `Compare Branch: Open a folder first` → プロジェクト未選択
- toast `Branch comparison failed` → Rust 側エラー。`pnpm tauri dev` ログ確認

### A-2. Ghost Diff Panel で確認

1. StatusBar (画面下) の **Layers ボタン** (⧉ アイコン) をクリック
2. panel pop

**✅ 期待**:
- レイヤーエントリ 1 つ
- sky blue のドット (tint `#89dceb`)
- `branch` ラベル
- **`read-only` バッジ** (sky 色背景、sky ボーダー)
- caption: `refactor/tauri-react-migration ← main` (矢印付き)
- `N files · M hunks` 表示
- `✓` (Check icon) で完了マーク — spinner ではなく静的

**❌ 失敗パターン**:
- spinner 回ってる → is_complete=true が効いてない
- `read-only` badge ない → CSS class 合ってない
- caption に branch 名しか出ない → layerCaption 関数のバグ

### A-3. Editor で inline ghost 確認

1. main と refactor ブランチで差があるファイルを開く (例: `src-tauri/src/lib.rs` or `src-tauri/src/ghostdiff/mod.rs`)
2. 画面右の Editor で差分位置にスクロール

**✅ 期待**:
- add 行 → 薄い sky 色の phantom 行
- delete 行 → 取消線 + 赤背景
- EditorBreadcrumb に `Sparkles` アイコン + layer 数バッジ

**❌ 失敗パターン**:
- 何も表示されない → `get_ghost_layer_file` が branch comparison でファイル返してない
- 色が mauve / peach → tint が auto-repair / orchestra のまま

### A-4. Read-only 性の確認 (最重要)

ghost が見える行にカーソルを置いて:

1. **Tab** を押す
   - **✅ 期待**: **何も起きない**。toast 出ない、ghost もそのまま。Monaco の default (indent 挿入) も発動しない (`aetherGhostHunkAtCursor = false` で context key preempt されない → Monaco default)
   - **❌ NG**: toast `Ghost hunk applied` が出る → read-only reject が効いてない
2. **Shift+Tab** を押す
   - **✅ 期待**: 何も起きない (layersNow が空になるため)
   - **❌ NG**: toast `All ghost hunks applied` 等出る
3. **Esc** を押す
   - **✅ 期待**: 現ファイルの ghost 消える、toast `Ghost layers dismissed`、他ファイルの ghost は残る
   - **❌ NG**: toast エラー

### A-5. 不正入力の検証

1. Ctrl+Shift+P → Compare Branch... → 現ブランチと **同じ名前** 入力
   - **✅ 期待**: toast `Compare Branch: Base and head must differ`
2. Ctrl+Shift+P → Compare Branch... → **存在しないブランチ名** (例: `zzz-no-such`) 入力
   - **✅ 期待**: toast `Branch comparison failed: git diff ... failed: ...`

---

## B. 3C-1c Hotkey accept/reject + apply (所要 5 分)

### B-1. セットアップ (ghost layer 作成)

3C-2 の **B-3 まで終わってれば** 比較 layer がある。ただし read-only なので apply 試せない。
したがって write-capable な **Orchestra agent** か **auto-repair** で worktree layer を作る必要がある。

**手抜きパターン**: 既存の worktree (`dazzling-saha-e4a1b4` worktree 等) があれば、それを ghost layer として別 IPC から push する手はあるが、現実的には Orchestra で小さな agent を起動するのが早い。

1. 右サイドバー下部の **AgentInspector** → **♫ ボタン** (Orchestra dialog)
2. textarea に `src/App.tsx に // HELLO コメントを 1 行追加して` 等の軽いタスク
3. `implementer` だけチェック → Start

または **時間かけたくない場合**: 3C-2 の A-2 で作った branch comparison で視覚的 ghost paint だけは見える (ただし accept 試せない)。

### B-2. Tab で accept

1. Orchestra agent が worktree でファイル編集完了まで待つ (panel で ✓ 付くまで)
2. EditorPanel で **そのファイル**を開く (panel の file 名クリック or 自分で開く)
3. ghost の add 行 (薄緑) 行にカーソル置く
4. **Tab** 押す

**✅ 期待**:
- toast `Ghost hunk applied`
- 該当 hunk が **実体化** (ghost paint 消える、通常テキストとして残る)
- breadcrumb に dot (modified マーク)
- カーソル位置が **その行付近に留まる** (1,1 に飛ばない) ← M1 fix 確認

**❌ 失敗パターン**:
- toast `Apply failed: ...` → Rust 側 apply error、dev ログ確認
- カーソルが (1,1) に飛ぶ → M1 fix 壊れ
- ghost paint 残る → registry.remove_hunk が発火してない

### B-3. Tab 連打で 2 回目無視 (H1 fix 確認)

1. 同じファイルに 2 個以上の hunk がある状態を作る (Orchestra で複数箇所編集指示)
2. 1 個目の hunk 行にカーソル → **Tab を 2 連打**

**✅ 期待**:
- 最初の Tab で 1 個目 accept + toast
- **2 回目の Tab は無視される** (2 個目が誤 accept されない)
- その後、2 個目 hunk 行に移動 → Tab 押せば正常 accept

**❌ 失敗パターン**:
- Tab 連打で 2 個目も巻き込んで accept される → inFlightRef 壊れ

### B-4. Shift+Tab で全 accept

1. 複数 hunk ある状態で **Shift+Tab**

**✅ 期待**:
- toast `All ghost hunks applied`
- ファイル内全 hunk が実体化、ghost paint すべて消える

### B-5. Esc で dismiss

1. ghost 残ってる状態で Editor focus 中に **Esc**

**✅ 期待**:
- toast `Ghost layers dismissed`
- 現ファイルの ghost 消える
- panel で **layer 自体は残る** (他ファイルあれば)
- もしその layer が 1 ファイルしかない場合 → layer の file_paths から該当除外 (hunks空)

### B-6. Ctrl+S で保存

1. Tab で accept した後、**Ctrl+S**

**✅ 期待**:
- toast `Saved <filename>`
- ディスクに反映
- breadcrumb の dot 消える

---

## C. 3C-1d Live mode toggle (所要 3 分)

### C-1. Settings UI

1. **Ctrl+,** (Settings 開く)
2. "**Ghost Diff Overlay**" セクションがある
3. toggle: "Live mode (paint in-progress layers)"
4. 説明文: "When off, ghost paint appears only after the agent run finishes..."

**✅ 期待**:
- default **OFF** (初回起動時)
- toggle UI が他 toggle と同じ見た目

### C-2. Live mode OFF の挙動

1. toggle OFF、Save
2. Orchestra で agent 起動 (実行に時間かかるタスク)
3. agent 実行中 (panel で spinner 表示):
   - Editor でそのファイル開く

**✅ 期待**:
- panel には layer 表示される (spinner 付き)
- editor には **ghost paint 出ない**
- agent 完了 (✓) と同時に ghost paint 出現

### C-3. Live mode ON の挙動

1. Settings で toggle ON、Save
2. 新 agent 起動
3. agent 実行中に editor 開く

**✅ 期待**:
- panel には spinner 付き layer
- editor に **即座に ghost paint**
- agent 進むごとに ghost paint 動的更新

### C-4. 永続化

1. Live mode ON で Save
2. **アプリ完全再起動** (window 閉じる → 再起動)
3. Settings 再度開く

**✅ 期待**:
- toggle が ON のまま
- `C:\Users\<user>\.aether\config.toml` を開くと `[ghost_diff]` セクションで `live_mode = true`

---

# 🟡 優先度中 — 既存機能の回帰確認 (所要 15 分)

## D. 3C-1a Ghost diff panel 基本動作

- [ ] StatusBar Layers ボタンに **active count バッジ** (in-progress 数)
- [ ] panel 開閉で UI ブレなし
- [ ] layer の chevron で file list 展開/折り畳み
- [ ] 各 layer の × で panel から dismiss → layer 自体が消える (worktree layer でも branch comparison でも)
- [ ] panel 外クリックで閉じる
- [ ] Esc で panel 閉じる

## E. 3C-1b Monaco inline ghost paint 再確認

C-2 で十分カバーされたので、ここでは **conflict** の UX 確認のみ:

1. Orchestra agent が `src/App.tsx` 編集開始
2. 同じ `src/App.tsx` をユーザー側でも同じ行を編集
3. 期待:
   - ghost hunk 非表示
   - breadcrumb に **red `FileWarning` badge** (conflict count > 0)
4. dirty を戻す (Ctrl+Z):
   - ghost 復活、conflict badge → yellow Sparkles

---

# 🟢 優先度低 — セットアップ重い or 既確認 (optional)

## F. 3A-1 自己修復 E2E

Watchdog rule 作るのが 3 分、エラー出すのに 2 分、修復待ち 30-60 秒。試したいときだけ。

手順: `docs/phase3_plan.md` の 3A-1 視覚検証節を参照。

## G. 3A-2 Ghost typing

- `git st` 入力 → `atus` が薄灰色
- Tab で受諾
- AI CLI 実行中は予測消える

## H. 3B-1 Orchestra role tagging / H-1c Conductor DAG

- ♫ で 3 agent 起動 → role badge が各 SessionCard
- 2 agent 同ファイル編集 → conflict badge
- AgentInspector `Conductor` タブ → ReactFlow で role-colored node
- session 右クリック → Handoff → role 選択 → edge 線

## I. 3B-2 Ctrl+R Semantic history

- Ctrl+R で HistorySearchDialog
- 入力で debounce 検索
- ↑↓ Enter で command を入力欄に書く
- Failed only / This project chip

---

# 📝 報告フォーマット

問題見つけたら以下の形式で:

```
❌ B-3 Tab 連打: 2 回目で 2 個目が accept されてしまう
   再現手順:
     1. Orchestra で 2-hunk タスク起動、complete 待ち
     2. 1 個目 hunk 行にカーソル
     3. Tab を <100ms 間隔で 2 連打
   期待: 2 回目は null 返し、何も起きない
   実際: 2 個目 hunk も実体化、toast 2 回出る
   備考: dev ログに ... のエラー
```

## 完了条件

- 🔴 A, B, C 全項目 ✅ で Phase 3C の積み残し検証クローズ
- D, E はできれば
- F-I は optional

報告する粒度は「セクション単位で OK / NG」+ 問題あれば個別報告。

---

## クイックリファレンス

| やりたいこと | やり方 |
|---|---|
| コマンドパレット | Ctrl+Shift+P |
| Settings | Ctrl+, |
| Layer panel | StatusBar の Layers ボタン (⧉) |
| ファイル検索 | Ctrl+P |
| ghost accept | Tab (ghost 行にカーソル) |
| ghost accept-all | Shift+Tab |
| ghost dismiss | Esc (Editor focus 中) |
| 保存 | Ctrl+S |
| Orchestra | AgentInspector (右 sidebar) の ♫ |
| 履歴検索 | Ctrl+R |
| branch 比較 | Ctrl+Shift+P → Compare Branch... |
