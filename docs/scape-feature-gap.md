# Scape vs Aether 機能差分（動画55フレーム分析）

## 最重要（ないと「ただのターミナル」）

### 1. Monaco Editor 統合
- ファイルツリーでファイルクリック → 中央パネルにコード表示
- Vimモード対応（:wq, INSERT）
- シンタックスハイライト（JS/TS/Python/Rust）
- AI変更のdiff表示（緑/赤インライン）
- Scapeではターミナルと横並びまたは切替で表示

### 2. ターミナル上下分割
- 上: Claude Codeセッション（AIとの対話）
- 下: 通常シェル（git status, npm run dev等）
- 各パネルに全画面切替ボタン（□アイコン、右下）

### 3. Claude Code情報バー（ターミナル上部）
- `Claude Code v3.1.89`
- `Opus 4.6 (1M context) · Claude Max`
- org名 + ディレクトリパス
- ターミナル内のステータスライン: `~/dev/project / main / personal / Opus 4.6 / 0m / <$0.01`

## 重要（UXの質に大きく影響）

### 4. Toolkitボタン実行
- Create PR → `gh pr create` 実行
- Commit & Push → `git add . && git commit && git push`
- Worktree → `git worktree add` GUI
- Dev Server → `npm run dev` 実行
- 各ボタンにカスタムコマンド設定可能

### 5. ファイル検索フィルター
- サイドバー上部に「Filter Files...」入力欄
- リアルタイムファイル名フィルタリング
- `Ctrl+K` で数字入力

### 6. Watchdog ダイアログ
- 「Create Watchdog」モーダル
- 名前入力（例: "Oreo"）
- Instructions入力（例: "Approve everything"）
- Cancel / Create ボタン（Createは紫/ピンク色）

### 7. セッション管理
- 複数セッション同時実行（5つ同時確認）
- Ctrl+0-9 でセッションジャンプ
- Ctrl+[ / Ctrl+] で前後移動
- セッションクリックでそのワークスペースに切替

### 8. git変更表示
- ファイルツリーで変更ファイルに色マーク
- 「Show X changes」ボタン（サイドバー下部）
- diff表示と連動

## あると嬉しい（Phase 5+）

### 9. 音声入力
- 下部に字幕バー表示
- Parakeet on-device STTモデル
- Windows: Whisper.cpp等で代替可能

### 10. ワークスペース下部アクション
- Generators / Create / Import ボタン
- 右端に追加アクションUI

### 11. プロジェクトアバター
- ピクセルアート風のプロジェクトアイコン
- セッションカードに表示
