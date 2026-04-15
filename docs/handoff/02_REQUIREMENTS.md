# 02 要件定義 — フルネイティブRust移行

## 目的

Tauri (WebView2 + React) を廃止し、フルネイティブRustアプリに移行する。
Warp / Alacritty / WezTerm 級のパフォーマンスを実現しつつ、
AIワークスペース機能 (エージェント/ワークフロー/Kanban) を維持する。

## 必須要件 (Must Have)

### MR-1: GPU描画ターミナル
- wgpu (DX12/Vulkan) でターミナルグリッドを60fps描画
- CascadiaCode + NotoSansJP のフォントレンダリング
- ANSIカラー (256色 + TrueColor)
- カーソル表示 (bar/block/underline, blink)
- スクロールバック (10,000行)
- テキスト選択 + コピー
- リンク検出 + クリック

### MR-2: PTY管理
- PowerShell / CMD / Git Bash / WSL 対応
- 複数PTY同時管理 (タブ/ペイン)
- リサイズ追従
- プロセス終了検出

### MR-3: ウィンドウ管理
- Win11 Mica/Acrylic 透過
- カスタムタイトルバー (最小化/最大化/閉じる)
- ウィンドウ位置/サイズ記憶
- DPI対応

### MR-4: キーボード入力
- ASCII全文字
- 矢印キー / Home / End / Delete / PageUp / PageDown
- Ctrl+C / Ctrl+D / Ctrl+Z (シグナル)
- IME (CJK入力)
- Ctrl+V ペースト

### MR-5: AIエージェント統合
- Claude / Codex / Gemini CLI の起動・制御
- PTYベースのインタラクティブセッション
- ヘッドレスセッション (バックグラウンド実行)
- セッション出力のリアルタイム表示

### MR-6: Git統合
- ブランチ表示
- 変更ファイル検出
- Worktree 作成/削除
- ファイルDiff表示

### MR-7: データ永続化
- SQLite: セッション/コマンド履歴/エージェント履歴
- TOML: アプリ設定
- localStorage相当: テーマ/レイアウト/最後のプロジェクト

## 希望要件 (Should Have)

### SR-1: ワークフローエンジン
- YAML定義のマルチフェーズ実行
- 承認ゲート (human_review / test_pass)

### SR-2: ファイルツリー
- プロジェクトファイル一覧
- .gitignore対応
- ファイルアイコン

### SR-3: テキストエディタ
- tree-sitter ベースのシンタックスハイライト
- 基本的な編集操作 (入力/削除/コピー/ペースト/Undo)
- Diffビューア

### SR-4: コマンドパレット
- Ctrl+Shift+P でファジー検索
- 全コマンドのキーバインド表示

### SR-5: Kanban/タスクボード
- TODO / IN PROGRESS / REVIEW / DONE
- エージェントセッションとの紐付け

## 非要件 (Will Not)

- マルチウィンドウ (初期版では1ウィンドウ)
- プラグインシステム
- Web版 / Linux版 / macOS版 (初期はWindows専用)
- SSH接続
