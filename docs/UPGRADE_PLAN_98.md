# Aether Terminal — 98点到達計画

**現状: 69.1/100 → 目標: 98+/100**
**エッジ領域（100点目標）: AIワークスペース / wgpu描画 / ワークフローエンジン**

---

## フェーズ構成

| Phase | 名称 | 目標スコア上昇 | セッション数 |
|-------|------|---------------|-------------|
| S | セキュリティ緊急修正 | 63→90 | 1 |
| A | 基盤品質（バグ修正+テスト） | 69→82 | 2 |
| B | UX研磨（エラーUI+状態管理） | 82→88 | 2 |
| C | エッジ磨き1: AIワークスペース100点化 | 88→93 | 2 |
| D | エッジ磨き2: wgpu描画接続+透過 | 93→95 | 2 |
| E | エッジ磨き3: ワークフローエンジン完成 | 95→97 | 1 |
| F | 最終研磨（E2E+パフォーマンス+差別化機能） | 97→98+ | 2 |

---

## Phase S: セキュリティ緊急修正 (63→90)

**1セッション、最優先。リリースブロッカー3件。**

### S-1. Toolkit コマンドインポート検証
- `ToolkitPanel.tsx:152-161` — JSONインポート時に確認ダイアログ表示
- インポートされたコマンドに危険パターン（`rm -rf`, `format`, `del /s`等）があれば警告
- `onRunCommand`呼び出し前にユーザー確認（初回実行時）

### S-2. 画像ペーストのパスエスケープ
- `TerminalArea.tsx:97` — ダブルクォート、バッククォート、`$`、`\`をエスケープ
- Windows/Unix両方のパスでテスト

### S-3. spawn_terminal の cwd 検証
- `commands.rs:88` — `validate_path(&cwd)` を追加
- UNCパス、システムディレクトリへの起動をブロック

### S-4. CSP設定の厳格化
- `tauri.conf.json` の `security.csp` を `null` から適切な値に
- `script-src 'self'`, `connect-src 'self' http://localhost:*`

### S-5. デフォルトコミットメッセージ修正
- `ToolkitPanel.tsx:33` — `'update'` ハードコードを削除
- コミット時にPromptDialogでメッセージ入力必須化

---

## Phase A: 基盤品質 — バグ修正+テスト基盤 (69→82)

**2セッション。全CRITICALバグ修正 + テストカバレッジ80%。**

### A-1. ワークフローrejectロジック修正
- `WorkflowPanel.tsx:139-146` — reject後にadvancePhaseを呼ばない
- reject → ワークフロー停止 or 前フェーズに戻る選択肢

### A-2. 検索Enter/Shift+Enter競合修正
- `TerminalArea.tsx:170-174` — `if...else if` に修正

### A-3. nextId グローバル変数をUUIDに置換
- `operations.ts:5` — `crypto.randomUUID().slice(0,8)` に変更
- `useTabManager.ts:12` — 同上
- HMRでのID衝突を完全排除

### A-4. TerminalArea cwd変更対応
- `TerminalArea.tsx:44-45` — cwdが変わった場合にPTY再接続するか、
  少なくとも`cd <newCwd>`を送信する仕組み

### A-5. テスト基盤構築（80%カバレッジ目標）

| テスト対象 | テスト種別 | 件数目安 |
|-----------|-----------|---------|
| operations.ts | ユニット | 完了済み (15件) |
| usePaneTree | React hooks テスト | 10件 |
| useTabManager | React hooks テスト | 8件 |
| useAgentManager | React hooks テスト | 10件 |
| SplitPane | コンポーネント | 5件 |
| TerminalInfoBar | コンポーネント | 5件 |
| WorkflowPanel | コンポーネント | 8件 |
| PaneTreeRenderer | 統合テスト | 5件 |
| PTY manager (Rust) | ユニット | 10件 |
| workflow executor (Rust) | ユニット | 8件 |
| GPU grid (Rust) | 完了済み (18件) |
| **合計** | | **~100件追加** |

### A-6. E2Eテスト基盤
- Playwright + WebView2 デバッグポートでTauriアプリに接続
- 基本シナリオ5本:
  1. 起動→ターミナル表示→コマンド入力→出力確認
  2. split right→2ペイン表示→両方に入力→close
  3. maximize→restore→内容維持
  4. タブ追加→切替→状態保持→タブ閉じ
  5. ファイルツリー→ファイル選択→エディタ表示

---

## Phase B: UX研磨 — エラーUI+状態管理 (82→88)

**2セッション。ユーザーが「何が起きているかわかる」UIに。**

### B-1. Toast通知システム
- 全async操作にToast通知を追加
- 成功: 緑、エラー: 赤、情報: 青、警告: 黄
- 自動消滅（3秒）+ 手動dismiss

| 対象 | 現状 | 修正後 |
|------|------|--------|
| git commit成功 | 何も表示されない | ✅ "Committed: <message>" |
| git push失敗 | catch握り潰し | ❌ "Push failed: <reason>" |
| ワークフロー開始 | 何も表示されない | ✅ "Workflow started: <name>" |
| ワークフロー失敗 | catch握り潰し | ❌ "Workflow failed: <reason>" |
| エージェント停止 | スピナー残留 | ✅ "Agent stopped" |
| ファイル保存 | 何も表示されない | ✅ "Saved: <filename>" |
| worktree作成失敗 | catch握り潰し | ❌ "Worktree failed: <reason>" |

### B-2. ローディング状態の統一パターン
- 全コンポーネントで `try { setLoading(true); await ...; } finally { setLoading(false); }` 統一
- loading中のボタンはdisabled + Spinner表示

### B-3. 未保存変更の検出改善
- `App.tsx:152` のCSS依存を廃止
- Zustand storeに `modifiedFiles: Set<string>` を追加
- ウィンドウ閉じる時の確認ダイアログ

### B-4. アクセシビリティ強化
- 全ボタンに `aria-label` 追加
- キーボードナビゲーション:
  - `Ctrl+Tab` / `Ctrl+Shift+Tab` でタブ切替
  - `Alt+←/→` でペイン移動
  - `Ctrl+`` でターミナルフォーカス（現在未実装）
- フォーカストラップ: モーダル・ダイアログ内でTabが外に出ない

### B-5. エラーバウンダリの強化
- 各パネルに個別ErrorBoundary
- パネル単位でクラッシュしても他パネルは動き続ける
- "Something went wrong" + リトライボタン

---

## Phase C: エッジ磨き1 — AIワークスペース 100点化 (88→93)

**2セッション。競合（Warp, Cursor）を超える独自価値。**

### C-1. コマンドブロック分離UI ★100点ポイント
Warpの最大の差別化点。Aetherでも実装する。
- PTY出力をコマンド単位でブロック分割
- 各ブロック: コピー、再実行、AIに「このエラーを直して」送信
- プロンプト検出: `PS1`/`$`/`#`パターンでコマンド開始を識別
- xterm.jsのデコレーション機能（addon）で実装

### C-2. AIエージェントのインライン結果表示 ★100点ポイント
Cursorのように、エージェントの実行結果をターミナルUIにインライン表示。
- エージェントがファイル変更 → diff をターミナル下部にインライン
- 承認/却下ボタン → git apply/revert
- Watchdog: エラー検出 → 自動修正提案

### C-3. コンテキストゲージの正確化
- モデル別最大トークン数テーブル
  - sonnet: 200K, opus: 200K, haiku: 200K
- `ContextGauge` に正確なパーセント表示
- 80%超で警告色、95%超で赤

### C-4. マルチエージェント並列実行
- 2-3エージェントを同時実行し結果を比較
- Kanbanタスク → エージェント自動割り当て
- SubagentTree で実行状況をリアルタイム表示

### C-5. セッション履歴・レジューム
- SQLiteに保存された過去のエージェントセッションを復元
- 「前回の続きから」ボタン
- コスト累計表示（日別、週別）

---

## Phase D: エッジ磨き2 — wgpu描画接続+透過 (93→95)

**2セッション。WezTerm級のGPU描画性能。**

### D-1. Render Loop実装
- Rust側で `requestAnimationFrame` 相当のループ
- `Grid.needs_redraw` をチェック → `renderer.render_frame()`
- 60fps上限、dirty行のみ再描画

### D-2. フォントフォールバック改善
- fontdue → swash に移行（OpenType機能対応）
- リガチャサポート（`=>` `->` `!=`）
- Nerd Fonts対応（アイコン文字）

### D-3. フィーチャーフラグでA/B切替
- Settings UIに「GPU描画（実験的）」トグル
- xterm.js → wgpu の切替がワンクリック
- パフォーマンス比較表示（入力遅延, フレームレート）

### D-4. Child HWND入力処理
- `wnd_proc`でWM_KEYDOWN/WM_CHAR/WM_IME_*をキャプチャ
- キーイベント→PTYバイト変換（`input.rs`）
- IME候補ウィンドウのカーソル追従

### D-5. 透過描画の実証
- wgpu clear color alpha = 0.85
- Mica/Acrylicが透けて見えることを実証
- スクリーンショット撮影して品質確認

---

## Phase E: エッジ磨き3 — ワークフローエンジン完成 (95→97)

**1セッション。GitHub Copilot Workspace超えの独自機能。**

### E-1. ワークフローの成果物可視化
- 各フェーズ完了時のファイル変更差分を表示
- フェーズ間の成果物パイプライン図
- 失敗フェーズのエラーログ展開

### E-2. ワークフローテンプレートライブラリ
- Bug Fix, Feature Implementation, Refactoring, Review の4テンプレート強化
- カスタムテンプレート作成UI（Visual Builder改善）
- テンプレートのインポート/エクスポート

### E-3. ワークフロー状態のイベントドリブン化
- 3秒ポーリング → Tauri event emitに切替
- `workflow_phase_changed` イベント
- `workflow_completed` / `workflow_failed` イベント

### E-4. ゲート承認UIの改善
- 承認/却下 + コメント入力
- 差分プレビュー（そのフェーズで何が変わったか）
- 条件付き承認（「この部分だけ修正して再実行」）

---

## Phase F: 最終研磨 (97→98+)

**2セッション。プロダクション品質の最終仕上げ。**

### F-1. パフォーマンス最適化
- base64デコードをWebWorkerに移動
- xterm.js FitAddonの呼び出し頻度をdebounce
- React.memo + useMemo で不要再レンダリング排除
- Lighthouse監査（WebView2内）

### F-2. タブドラッグ&ドロップ
- タブの並び替え
- タブを別ウィンドウに分離（Tauri multiwindow）

### F-3. 設定の永続化・同期
- テーマ、フォントサイズ、レイアウト比率をlocalStorage/config.toml
- ペインレイアウトの保存・復元
- ウィンドウ位置・サイズの記憶

### F-4. プロダクションビルド最適化
- `pnpm tauri build` の成功確認
- MSIXインストーラー
- 自動更新（tauri-plugin-updater）
- コード署名

### F-5. ドキュメント
- README.md（スクリーンショット付き）
- キーボードショートカット一覧
- ワークフローYAML仕様書

---

## スコア到達見通し

| Phase完了後 | UI/UX | 機能 | ワークフロー | コード品質 | パフォーマンス | セキュリティ | 総合 |
|------------|-------|------|------------|-----------|-------------|------------|------|
| 現状 | 68 | 72 | 61 | 74 | 70 | 63 | **69.1** |
| Phase S後 | 68 | 73 | 61 | 76 | 70 | 90 | **72.4** |
| Phase A後 | 72 | 78 | 68 | 85 | 72 | 90 | **78.9** |
| Phase B後 | 85 | 82 | 72 | 88 | 75 | 92 | **84.3** |
| Phase C後 | 90 | 92 | 78 | 90 | 78 | 92 | **89.6** |
| Phase D後 | 92 | 94 | 80 | 92 | 92 | 93 | **92.3** |
| Phase E後 | 93 | 95 | 95 | 93 | 93 | 94 | **94.1** |
| Phase F後 | 98 | 98 | 97 | 96 | 97 | 96 | **97.5** |

---

## 100点を目指すエッジ（差別化ポイント）

### 1. AIワークスペース統合（競合なし）
- ターミナル + エージェント + ワークフロー + Kanban が一画面で連携
- エラー検出 → 自動修正提案 → 承認 → 適用 の自動化ループ
- **WarpのAIはコマンド提案止まり。Cursorはエディタ中心。Aetherはターミナル+AI+ワークフローの統合**

### 2. wgpu GPU描画（WezTerm級）
- ターミナル描画がネイティブGPU（Child HWND + wgpu）
- UI部分はReactのまま（開発速度維持）
- **このハイブリッドアプローチは他にない**

### 3. ワークフローエンジン（競合なし）
- YAML定義 → 自動実行 → ゲート承認 → 次フェーズ
- **GitHub Copilot Workspaceに近いがローカル実行。セルフホスト可能。**
