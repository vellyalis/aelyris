# Phase 3 視覚検証手順書

**最終更新**: 2026-04-18
**対象コミット**: 0e28dd4 (3C-2 MVP)

画面を開きながら、上から順にやるだけで検証が終わる手順書。
分からなくなったら途中で止めて「○番で詰まった」と報告してほしい。

---

## ⚡ ショートカット: ほぼ全部 Claude が自動検証した

`pnpm tauri:dev` で起動する dev build は WebView2 の **CDP ポート (9222)** が開いてて、外から `window.__TAURI_INTERNALS__.invoke` を叩ける。以下を CI みたいに回せる:

```
pnpm tauri:dev               # 起動 (CDP 9222 が開く)
node scripts/verify-3c2.mjs  # A+C+UI を自動検証
# → Summary: 18 OK / 0 FAIL / 0 SKIP
```

自動カバー範囲 (2026-04-18 時点):
- **A (Branch Comparison)**: list_branches → start → shape → get_file → read-only reject (hunk/file) → dismiss_file → dismiss_layer
- **C (Live mode)**: load_app_config → true に flip → restore
- **UI surface**: Command palette / View menu / Settings section / StatusBar button 全部に Compare Branch 系が存在する確認

つまり下の 🔴 A, 🔴 C 章は **既に Claude 側で機能検証済み**。人間が手で触って UX 確認したいとき用の手順が以下。

手動検証が残っている領域:
- **B (Tab/Shift+Tab/Esc accept hunk)** — Orchestra agent の実行が必要で Claude では非現実 (claude CLI を叩くコスト)、ただし apply.rs の Rust test 10 + registry 4 + useGhostPaintForFile の TS test 22 でカバー済
- UX 的な見た目 (色、位置、間隔、アニメ) — 最終は人間の目

---

## そもそも「Ghost Diff Overlay」ってなんだっけ

Phase 3C のテーマは **「別世界のコードを今の画面に半透明で重ねて見せる」** こと。

Aether Terminal は AI agent や別ブランチのコードを**別の git worktree** で動かすことが多い。でもそれをレビューするには:
- worktree を開き直す
- ブランチを切り替える
- `git diff` を眺める

みたいに**コンテキストスイッチ**が発生する。これが面倒。

Ghost Diff Overlay は「別世界 (別 worktree / 別ブランチ / 過去スナップショット) のファイル内容」を、**今開いているエディタ上に半透明の幽霊 (ghost) として重ね描き**する機能。切り替えずに俯瞰できる。

### 3C の中のサブ機能

Phase 3C-1 **Ghost Diff Overlay 基本** (実装済、前セッションで 1a/1b/1c/1d 完了):
- **3C-1a**: ghost layer の登録・panel 一覧表示の基盤
- **3C-1b**: エディタ内に ghost 行を半透明描画 (add 行 = 薄緑 phantom、delete 行 = 取消線)
- **3C-1c**: キーバインド — **Tab で hunk accept**、Shift+Tab で全 accept、Esc で dismiss
- **3C-1d**: **Live mode** 設定 (default off) — agent 実行中のファイル変更をリアルタイムで ghost 表示するか、完了してからまとめて表示するかの切替

Phase 3C-2 **Branch Comparison** (今セッションで実装、未検証):
- **「別のブランチの同じファイル」が今ここでどう違って見えるかを ghost で表示**
- 例: 今 `refactor/xxx` ブランチで作業中、`main` ブランチの同じファイルがどう違うかを**切り替えずに**見たい
- コマンドパレット → **Compare Branch...** → 比較したいブランチ名入力
- 裏で `git diff 現ブランチ..指定ブランチ` が走り、結果が ghost として編集中のエディタに重なる
- **読み取り専用**: Tab/Shift+Tab は効かない (他人のブランチを勝手に merge しないため)。消すのは Esc か panel の dismiss ボタン
- 使い所: main との差分可視化、レビュー前の変更確認、rebase の下見

### 3C-1 と 3C-2 の関係図

```
 別 worktree (AI 編集中)  ─┐
                          ├──→ [ Ghost Diff Overlay ] ──→ Editor に重ね描き
 別ブランチ (main 等)      ─┘         ↑
                                 共通パイプライン
                                (Layer + FileDelta + GhostPainter)
                                      ↑
                      3C-1 (write-capable) と 3C-2 (read-only) は
                      **同じ描画エンジンを使ってる**。違いは source の kind と
                      「Tab で accept できるか」だけ。
```

今回の検証 **A** はこの 3C-2 を触る。**B** は 3C-1c のキーバインド、**C** は 3C-1d の live mode を触る。

---

## 0. 画面全体の地図

起動後の画面レイアウト (プロジェクト開いた状態):

```
┌──────────────────────────────────────────────────────────────┐
│ メニューバー (File / Edit / View …)                           │ ← 一番上
├──────┬──────────────────────────────────────┬────────────────┤
│      │                                      │                │
│      │                                      │                │
│ 左   │   メイン領域                          │   右パネル      │
│サイド│   (ターミナル or エディタ)            │ (AgentInspector)│
│バー  │                                      │                │
│      │                                      │                │
│ファイ│                                      │ ♫ + … のボタン群│
│ル /  │                                      │  は右パネル上端  │
│タスク│                                      │  タブバー右端に  │
│ / エ │                                      │  ある            │
│ージ  │                                      │                │
│ェント│                                      │                │
│      │                                      │                │
├──────┴──────────────────────────────────────┴────────────────┤
│ powershell │ git branch │ 3 changed ⋯ cpu ⋯ 🔧 ⧉ UTF-8 LF v… │ ← StatusBar (最下部)
└──────────────────────────────────────────────────────────────┘
                                              ↑      ↑
                                     Wrench   Layers
                                  (Auto-repair) (Ghost diff)
```

**キーワード対応**:
- 🔧 = `Wrench` アイコン (レンチ) = Auto-repair 用
- ⧉ = `Layers` アイコン (四角が重なった絵) = **Ghost diff パネル起動**
- ♫ = 音符マーク = **Orchestra ダイアログ起動**

StatusBar は画面の**最下部**、横幅いっぱい。アイコンは StatusBar の**右側**に並んでる。

---

## 事前準備 (1 回だけ)

1. タスクマネージャで `aether-terminal.exe` が既に動いてなければ、ターミナルで:
   ```
   cd /c/Users/owner/Aether_Terminal
   pnpm tauri dev
   ```
   (今はもう動いてるはず)

2. window が出たら、中央の「**Open Folder**」ボタンをクリック
3. `C:\Users\owner\Aether_Terminal` を選択して開く
4. 画面が切り替わって、左に **ファイルツリー**、中央に **ターミナル**、右に **AgentInspector** が出るはず

これで準備完了。

---

# 🔴 A. Branch Comparison (3C-2 の新機能) — 約 5 分

**これは何?**
別ブランチに切り替えずに、そのブランチのコードが今の画面でどう違って見えるかを **半透明 ghost で重ね表示** する機能。

**どういうシーンで使うか?**
- 「main に対して自分のブランチで何を変えてきたか」を視覚的に振り返る
- PR 出す前にチーム同僚のブランチを軽くプレビュー
- rebase/merge 前の下見

**普通の `git diff` と何が違う?**
git diff は CLI でテキスト表示、行番号と実ファイルの対応が頭で追いにくい。Ghost overlay なら**エディタで今のファイル上に直接差分が浮く**ので、前後の文脈込みで一目。

**重要な性質**: **読み取り専用**。Tab で accept はできない (他人のブランチを勝手に自分に取り込まない)。見るだけ、消すだけ。

## 💡 どこから起動するの?

**現状、画面上のボタンは存在しない**。起動口は以下の 2 つだけ:

1. **コマンドパレット (Ctrl+Shift+P)** → `compare` と入力 → `Compare Branch...` 選択 ← 今回はこっち
2. **メニューバー "View" メニュー → Compare Branch...** ← 次の commit でメニューにも追加する

⚠️ サイドバーにも、AgentInspector にも、StatusBar にも、エディタ右クリックメニューにも**まだ無い**。
将来的にはブランチ一覧 (サイドバー) からの右クリック「Compare with ...」等を足したいが、MVP 範囲外。

## A-1. コマンドパレットから起動

**手順**:

1. **`Ctrl+Shift+P`** を押す
2. 画面中央に暗い角丸の**パレット** (Command パネル) が上から降りてくる
3. そこに `compare` と入力
4. **"Compare Branch..."** という項目が現れる (View カテゴリ、GitBranch アイコン付き)
5. 矢印キーで選択して Enter、または直接クリック

**ここで出るはずの画面**: パレットが消えて、別のプロンプト (入力ボックス) が中央に現れる。

プロンプトには:
- タイトル: `Compare refactor/tauri-react-migration against branch`
  (「refactor/…」部分は**現在の git ブランチ名**)
- 入力欄 + プレースホルダーテキスト: `main, xxx, yyy` (ローカルブランチ名が最大 8 個並ぶ)

**✅ OK の条件**:
- プロンプトが出る
- タイトルに現在のブランチ名が正しく入る
- プレースホルダーに `main` が含まれる (このリポには main ブランチがある前提)

**❌ NG**:
- パレットに `Compare Branch...` が出てこない → command palette 登録漏れ
- プロンプト出た直後に toast `Compare Branch: Open a folder first` → プロジェクト未選択 (事前準備やり直し)

---

## A-2. `main` と入力して実行

**手順**:

1. プロンプトの入力欄に `main` とタイプ
2. Enter

**ここで出るはずの画面**:
- プロンプトが消える
- 画面**右上または右下**に緑系の **toast 通知**:
  > **Branch comparison started**
  > `refactor/tauri-react-migration ← main`
- 約 1 秒で自動消滅

**✅ OK の条件**: 上記 toast が緑で出て消える

**❌ NG**:
- 赤い toast `Compare Branch: Base and head must differ` → `main` 以外のブランチ名を入れた可能性、または現在が既に main ブランチ。別名を試す
- 赤い toast `Branch comparison failed: ...` → Rust 側エラー。このときは `pnpm tauri dev` を動かしてるターミナルにエラーログが出てるので、そこを確認して報告

---

## A-3. Ghost Diff Panel で登録確認

**どこにあるか**: StatusBar (画面の**最下部**) の**右側**に並んでるアイコン群。

StatusBar 右側を左から右に見ると:
```
cpu? │ 🔧Wrench │ ⧉Layers │ UTF-8 │ LF │ Aether v0.1.0
```

**⧉ (四角が 2 枚重なった絵) がターゲット**。🔧 Wrench の**右隣**にある。

**手順**:

1. StatusBar の右側、⧉ (Layers) アイコンをクリック
2. そのボタンの**真上**に小さな popover パネルが出る

**ここで出るはずの画面**:

```
┌─────────────────────────────────────────┐
│  ⧉ Ghost diff            1 layer        │
├─────────────────────────────────────────┤
│ › ● branch [read-only] refactor/… ← main│
│     N files · M hunks              ✓  ×│
└─────────────────────────────────────────┘
```

行の中身:
- 先頭 `›` — chevron (展開用)
- `●` — **sky blue (薄い水色) のドット** (branch comparison の tint)
- `branch` — role label テキスト
- `[read-only]` — **sky 色背景 + sky 枠の小さいバッジ** ← これが新機能の目印
- `refactor/tauri-react-migration ← main` — caption (矢印つき)
- `N files · M hunks` — 件数
- `✓` 緑のチェックマーク (spinner じゃない、静止)
- `×` dismiss ボタン

**✅ OK の条件**:
- layer が 1 行見える
- sky blue のドット
- **`read-only` バッジが確実に見える**
- caption に矢印 `←` が出る
- spinner ではなく緑の ✓ が出る

**❌ NG**:
- spinner が回ってる → `is_complete = true` が効いてない
- ドットが紫 (mauve) や橙 (peach) → tint が別のものになってる
- `read-only` バッジが無い → CSS 当たってない、または conditional rendering バグ
- caption に branch 名 1 つしか出ない (矢印なし) → `layerCaption` 関数のバグ

---

## A-4. Editor で ghost paint 確認 (差分が実際に描画されるか)

**手順**:

1. 左サイドバー (ファイルツリー) から差分がありそうなファイルを探す
   - `CLAUDE.md` (ブランチ間で内容が結構違う)
   - `src-tauri/src/lib.rs` など
2. ファイル名をクリック → 中央のターミナルの代わりに **エディタ (Monaco) が開く**
3. エディタ画面で上下にスクロール

**ここで出るはずの画面**:
- 行番号の左に `+` や `-` 的な gutter マーク
- 追加行: 背景が**薄い sky blue** (半透明)、行頭に `+` 的な色変化
- 削除行: **取消線** + 赤系の背景 (半透明)
- 変更混在の hunk は gutter にだけマーク

**Editor 上部 (breadcrumb)**:
- ファイル名の近くに **黄色い Sparkles (星) アイコン** + 数字バッジ (layer 数)

**✅ OK の条件**:
- ghost paint が見える (何か半透明の行が出ている)
- breadcrumb のバッジが出る

**❌ NG**:
- 何も色が付かない → `get_ghost_layer_file` が branch comparison で file delta 返せてない
- 色が緑系 (mauve) → tint 貫通してない
- ghost paint 位置がおかしい → hunk parser バグ

---

## A-5. ⭐ Read-only の確認 (一番大事)

ghost paint が見えてる行にカーソル置いた状態で:

**A-5-a. Tab を押す**
- **✅ 期待**: **何も起きない**。toast 出ない、ghost paint もそのまま。Monaco の default Tab (indent 挿入) も**発動しない** (context key が false のため)
- **❌ NG**: toast `Ghost hunk applied` が出る → read-only reject が効いてない (backend の `is_read_only` チェック壊れ)

**A-5-b. Shift+Tab を押す**
- **✅ 期待**: 何も起きない
- **❌ NG**: toast `All ghost hunks applied` が出る or エラー toast

**A-5-c. Esc を押す**
- **✅ 期待**:
  - toast `Ghost layers dismissed`
  - 当該ファイルの ghost paint が消える
  - ⧉ Layers パネルを再度開くと、layer **そのものは残ってる** (他ファイル touch してる可能性あるので)。ただしこのファイルは file list から除外される (panel の chevron 展開で確認可能)

- **❌ NG**: エラー toast / ghost paint が残ったまま

---

## A-6. エラー系の確認 (念のため)

1. **Ctrl+Shift+P** → `Compare Branch...` 選択
2. プロンプトに**現在と同じブランチ名**を入力 (例: `refactor/tauri-react-migration`) → Enter

**✅ 期待**: 赤い toast `Compare Branch: Base and head must differ`

---

3. もう一度 `Compare Branch...` → **存在しないブランチ名** (例: `zzz-no-such-branch`) → Enter

**✅ 期待**: 赤い toast `Branch comparison failed: git diff ... failed: ...`

---

# 🔴 B. Tab/Shift+Tab/Esc で hunk 操作 (3C-1c) — 約 5 分

**これは何?**
エディタに ghost layer (AI agent が別 worktree で編集中のファイル差分) が見えている状態で、その ghost を**自分のコードに取り込む** or **捨てる**ためのショートカット。

- **Tab**: カーソル位置にある 1 個の hunk を accept → 実際のファイルに書き込む
- **Shift+Tab**: ファイル内の全 hunk をまとめて accept
- **Esc**: 現ファイルの ghost を dismiss (捨てる。実ファイルには触れない)

**なぜこれが必要?** AI が worktree で書いたコードを、1 つずつ自分のメインブランチに取り込みたい時がある。今までは worktree 切替 → cherry-pick みたいなことしてたのを、エディタ上でキー 1 発で済ませる。

**A の branch comparison との違い**: branch comparison は read-only だから Tab が効かない。B のテストには **Orchestra AI agent を起動して worktree layer を作る**必要がある (write-capable だから accept できる)。

## B-1. Orchestra で agent 起動 (セットアップ)

**どこにあるか**: 画面の**右パネル (AgentInspector)** の一番上、タブバーの**右端**。

タブバーには左から順に「sessions」「parallel」「conductor」「diffs」タブのアイコン、その右端に以下のボタン:
```
 $0.00  📋 ♫ +
```

- `$0.00` 総コスト
- 📋 ClipboardCopy (session 情報 copy)
- **♫ 音符マーク — これが Orchestra 起動ボタン**
- `+` Plus (通常の session 追加)

**手順**:

1. 右パネル上部、♫ ボタンをクリック
2. **OrchestraDialog** (大きめのダイアログ) が出る:
   - 上部に **textarea** (task 入力)
   - 下に 4 つの **役割チェックボックス** (implementer / tester / reviewer / researcher など)
   - 下に Start ボタン
3. textarea に軽いタスクを貼る:
   ```
   CLAUDE.md に "VERIFY-MARK" という単語を 1 行追加して
   ```
4. `implementer` だけにチェック入ってる状態にする (他は外す)
5. **Start** ボタン押す

**ここで起きること**:
- ダイアログ閉じる
- 右パネル (AgentInspector) の sessions タブに **新しいセッションカード**が追加される
- カードには spinner が回ってて、進捗が動く
- agent は git worktree を新規作成して、そこで CLAUDE.md 編集する

**待ち時間**: 30 秒 〜 2 分 (Claude CLI 次第)

**完了サイン**:
- カードの spinner が静止チェックマーク (✓) に変わる
- StatusBar の ⧉ Layers バッジに数字が出る

---

## B-2. Editor でファイル開いて Tab accept

**手順**:

1. 左サイドバーのファイルツリーで `CLAUDE.md` をクリック → Editor が開く
2. 画面を見渡して、**sky blue じゃなく mauve (紫) の tint** で ghost 行が出ているはず (Orchestra default tint)
3. ghost add 行 (薄紫の phantom 行) にカーソル合わせる
4. **Tab** を押す

**✅ 期待**:
- toast 緑 `Ghost hunk applied`
- その hunk の ghost paint が消える
- 代わりに**通常のテキスト**としてその行が実体化される
- Editor breadcrumb に **modified dot** (未保存マーク) が付く
- カーソルが ghost 行付近にある (1,1 にジャンプしない) ← M1 fix

**❌ NG**:
- `Apply failed: ...` → Rust側のapply エラー
- カーソルが (1,1) に飛ぶ → M1 修正が効いてない
- ghost paint 残る → registry.remove_hunk が動いてない

---

## B-3. Tab 連打テスト (H1 fix 確認)

**前提**: 同じファイルに 2 個以上の hunk が欲しい。B-1 のタスクを少し変えて「CLAUDE.md の先頭と末尾に VERIFY-MARK を追加して」にして複数 hunk が出来るようにしても良い。

**手順**:

1. hunk が 2 個以上ある状態で、1 個目の hunk 行にカーソル
2. **Tab を高速で 2 連打** (キーを 2 回連続プレス)

**✅ 期待**:
- 1 回目の Tab で 1 個目 accept、toast 1 回
- 2 回目の Tab は**何も起きない** (in-flight lock で無視)
- 2 個目の hunk は残ったまま
- カーソルを 2 個目 hunk 行に移動して Tab を押すと、通常通り accept される

**❌ NG**:
- 2 個目まで巻き込んで accept され、toast が 2 回出る → in-flight lock 壊れ

---

## B-4. Shift+Tab で全 accept

**手順**:

1. まだ hunk 残ってる状態で **Shift+Tab**

**✅ 期待**:
- toast `All ghost hunks applied`
- ファイル内の ghost paint すべて消える
- 全 hunk が実体化

**❌ NG**:
- toast `Apply-all failed` → 全 layer apply 失敗時の error toast (#M2 fix 動作確認)

---

## B-5. Esc で現ファイル dismiss

**手順**:

1. ghost paint が見える状態で (別ファイル開いても OK)、Editor focus 中に **Esc**

**✅ 期待**:
- toast `Ghost layers dismissed`
- 当該ファイルの ghost paint が消える
- `⧉ Layers` パネルを開いても、同じ layer の**他ファイル** (あれば) の ghost は残ってる

---

## B-6. Ctrl+S 保存

**手順**:

1. accept 後、**Ctrl+S**

**✅ 期待**:
- toast `Saved CLAUDE.md`
- breadcrumb の modified dot が消える
- ディスクにも反映される (git status で見える)

---

# 🔴 C. Live mode toggle (3C-1d) — 約 3 分

**これは何?**
AI agent が worktree でファイルを書いている最中に、その途中結果を ghost でリアルタイム表示するかどうかの **on/off トグル**。

**3 つの挙動**:
| 設定 | AI agent 実行中 | AI agent 完了時 |
|---|---|---|
| Live mode **OFF** (default) | 何も表示されない | そこで初めて ghost が全部出る |
| Live mode **ON** | agent が書くたび ghost もリアルタイム更新 | そのまま表示継続 |

**なぜ default OFF?** AI は試行錯誤で書いて消してを繰り返すので、途中結果を逐一見せられるとチラついて集中を切られる。完了してから一括で見る方が落ち着く。ただしライブコーディングを「見たい」派もいるので opt-in で ON にできる。

**保存先**: `%USERPROFILE%\.aether\config.toml` の `[ghost_diff].live_mode` として永続化される。アプリ再起動しても設定は残る。

## C-1. Settings 画面を開く

**手順**:

1. **Ctrl+,** (Ctrl + カンマ)
2. 画面中央にモーダル (Settings パネル) が出る

**ここで出るはずの画面**:

Settings パネルは縦長で、セクションが並んでる:
- Appearance (theme / font)
- Terminal (shell / cursor)
- **Ghost Diff Overlay** ← 新セクション
- Keyboard Shortcuts (読み取り専用)

---

## C-2. Ghost Diff Overlay セクション確認

Settings パネルを下にスクロールするか、そのまま「Ghost Diff Overlay」セクションを探す。

**ここで出るはずの画面**:

```
─────────────────────────────────────────
 GHOST DIFF OVERLAY
─────────────────────────────────────────
 ☐ Live mode (paint in-progress layers)
    When off, ghost paint appears only
    after the agent run finishes. When
    on, every fs change from the agent's
    worktree streams into the editor as
    it happens.
```

**✅ OK の条件**:
- セクション見出し "GHOST DIFF OVERLAY" がある
- チェックボックス + ラベル "Live mode (paint in-progress layers)"
- 説明文 (小さい薄灰色) が付く
- チェックボックスは **default OFF** (初回起動時)

---

## C-3. OFF のまま agent 起動 (完了まで ghost 出ない確認)

**手順**:

1. toggle OFF のまま Save 押して Settings 閉じる
2. B-1 と同じ手順で Orchestra agent 起動
3. agent 実行中 (spinner 回ってる最中) に CLAUDE.md を Editor で開く

**✅ 期待**:
- `⧉ Layers` panel には layer 表示される (spinner 付き)
- **Editor には ghost paint が出ない** (agent 完了まで待機)
- agent 完了 (✓) と同時に ghost paint 出現

**❌ NG**:
- agent 実行中から既に ghost paint 出る → liveMode フィルタ効いてない

---

## C-4. ON にして即座 paint 確認

**手順**:

1. Ctrl+, で Settings 再度開く
2. Live mode チェックボックス **ON**
3. Save
4. 新しい Orchestra agent 起動
5. すぐに Editor で対象ファイル開く

**✅ 期待**:
- agent 実行中でも **ghost paint が即座に出る**
- agent が書き進むと ghost paint も動的に更新

---

## C-5. 永続化確認

**手順**:

1. Live mode を ON にして Save 済みの状態
2. Tauri window を**完全に閉じる**
3. `pnpm tauri dev` を止めて、再度起動
4. プロジェクト再度開いて、Ctrl+, で Settings

**✅ 期待**:
- Live mode checkbox が **ON のまま**

また、`C:\Users\owner\.aether\config.toml` をテキストエディタで開くと:
```toml
[ghost_diff]
live_mode = true
```
セクションがある。

---

# 🟡 D/E: 他の既存機能の回帰確認 (optional、時間あれば)

- **D**: `⧉` Layers panel の chevron で file list 展開 / `×` で layer dismiss / panel 外クリックで閉じる
- **E**: Orchestra agent がファイル編集中に、同じファイルをユーザーも編集 → ghost paint 消えて breadcrumb に **red FileWarning badge** が出る (conflict)

---

# 🟢 F-I: さらに時間があれば (optional)

F. Auto-repair (Watchdog rule 作ってエラーで走らせる) — セットアップ重いので後回し推奨
G. Ghost typing — シェルで `git st` → `atus` 薄灰色 → Tab で受諾
H. Orchestra Conductor タブ — ReactFlow DAG
I. Ctrl+R History 検索

---

# 📝 報告の仕方

section 単位で結果ください。例:

```
A: OK
B: B-2 で詰まった。Tab 押しても toast 出ない、ghost paint も残る。
   pnpm tauri dev のログに "apply_ghost_hunk: layer ... is read-only" と出た
C: OK
```

または全部通ったら「A/B/C 全部 OK」で十分。

## クイックリファレンス (何がどこ)

| やりたい | どこを触る |
|---|---|
| コマンドパレット | **Ctrl+Shift+P** |
| Settings | **Ctrl+,** |
| Ghost diff panel | 画面下 StatusBar 右側の **⧉ (Layers アイコン)** クリック |
| Auto-repair panel | StatusBar 右側の **🔧 (Wrench アイコン)** クリック |
| Orchestra 起動 | 右パネル上部タブバー右端の **♫** ボタン |
| 通常 agent 起動 | 右パネル上部タブバー右端の **+** ボタン |
| ファイル開く | 左サイドバー (ファイルツリー) でクリック |
| 履歴検索 | **Ctrl+R** |
| Branch 比較 | **Ctrl+Shift+P** → Compare Branch... |
| ghost accept | Editor 内 hunk 行にカーソル → **Tab** |
| ghost accept 全部 | Editor focus → **Shift+Tab** |
| ghost dismiss | Editor focus → **Esc** |
| 保存 | **Ctrl+S** |
