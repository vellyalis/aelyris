# Scape 操作フロー完全解析（124フレーム1秒単位分析）

## 核心的な操作パターン

### 1. プロジェクト選択フロー
- 起動時: 「Your workspace is ready」Welcome画面
- 「Start Claude Code」ボタンクリック → プロジェクト選択
- 選択後: 左FileTree、中央Claude session、右Sessions/Toolkit が全てそのプロジェクトで表示

### 2. セッション切替フロー（最重要）
- 右パネルのセッションカードをクリック
- → ヘッダーバーのプロジェクト名が変わる
- → FileTreeのルートが変わる
- → ターミナルがそのworktreeのClaude sessionに切り替わる
- → 下部タブバーにそのworktreeのタブがアクティブになる
- → ToolkitのプロジェクトSCOPEが変わる
- ★ 全UIが連動して切り替わる。部分切替ではない。

### 3. Worktree並列フロー
- メインworktreeでClaude Code実行中
- 右パネルの「+」ボタンで新セッション作成
- → 新しいgit worktreeが自動作成される
- → 新セッションカードが右パネルに追加
- → 下部タブバーに新タブ追加
- 同時に5セッションまで確認（TiltRun, Mockuply, draftframe, draftframe-lexical-yjs, draftframe-exporting）

### 4. ターミナルレイアウト
- 上部: Claude Codeセッション（プロンプト入力 + AI出力）
- 下部: 通常シェル（git status, npm run dev等）
- 各ペインに全画面切替ボタン（右下の□アイコン）
- ステータスライン: `~/dev/project / branch / personal / Opus 4.6 / 0m / <$0.01 / e medium / /effort`

### 5. Claude Code情報バー
- ターミナルの最上部に固定表示
- `Claude Code v3.1.89`
- `Opus 4.6 (1M context) · Claude Max`
- `elliot@venturemedias.com's Organization`
- `~/dev/draftframe`

### 6. ファイルツリー操作
- 「← web-app」のようにパンくずナビ（上に戻るボタン）
- 「Filter Files...」検索ボックス（上部固定）
- 「Show 1 changes」ボタン（下部 git変更数）
- ファイルクリック → Monaco Editorで表示（voice動画で確認）

### 7. セッションカード詳細
- アバター（ピクセルアート16x16）
- プロジェクト名 + ブランチ名 + 鍵アイコン（設定）
- ステータス: ● Idle (緑) / ● Thinking (黄) / ● Needs Attention (赤) / ● Generating (紫)
- 経過時間: 43d ago / 240d ago / 51d ago
- モデル: Opus 4.6 (1M context)
- コスト: <$0.01
- プログレスバー + パーセント（0% / 2%）
- ⌘0-9 Jump · ⌘[ Prev · ⌘] Next

### 8. 確認ダイアログ
- Claudeが「Do you want to proceed?」と聞く
- > Yes, and don't ask | > again for | > No
- UIとして表示される（ターミナル内のテキスト）

## Aetherに致命的に不足している機能
1. プロジェクト選択UI（フォルダ選択で開く）
2. セッションクリック → 全UI連動切替
3. Worktree自動作成+セッション紐付け
4. Claude Code情報バー
5. 上下分割デフォルト（Claude + shell）
6. Welcome画面
7. パンくずナビ（← project-name）
