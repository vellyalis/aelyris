# 参考プロジェクト分析 — Aether独自エッジの設計

## 各プロジェクトのユニークな価値

### 1. tmux-agent-sidebar
**核心**: 全tmuxセッション横断でAIエージェントを一覧監視
- **Cross-session monitoring** — セッション/ウィンドウを超えて全エージェントを表示
- **Pane jump** — エージェント選択→Enterでそのペインに即ジャンプ
- **Subagent tree** — 親子関係のツリー表示（サブエージェント生成を可視化）
- **Task progress** — タスク完了度 (3/7) をリアルタイム同期
- **Activity log** — ツール呼び出し (Read, Edit, Bash) をストリーミング
- **Permission mode badge** — auto/plan/! をバッジ表示
- **Pane metadata** — localhost ポート、実行コマンド、経過時間

→ **Aetherに採用すべき**: サブエージェントツリー表示、パーミッションバッジ、ポート検出

### 2. vibe-kanban
**核心**: カンバンボード + コーディングエージェントワークスペース
- **Kanban issues** — タスクを作成→優先度→アサイン
- **Workspace per issue** — 各ワークスペースにブランチ+ターミナル+devサーバー
- **Inline diff review** — diffにインラインコメント→エージェントに直接フィードバック
- **Built-in browser** — devtools, inspect mode, device emulation
- **10+ agent support** — Claude/Codex/Gemini/Copilot/Amp/Cursor/OpenCode/Droid/CCR/Qwen
- **AI-generated PR descriptions** — PR作成+マージまでUI内で完結

→ **Aetherに採用すべき**: カンバンボード(Helmの進化)、インラインdiffコメント、マルチエージェント対応、デバイスエミュレーション

### 3. Mori
**核心**: プロジェクト/Worktreeファーストのネイティブターミナル
- **Project-first navigation** — リポジトリ+ブランチ単位でナビゲーション
- **Terminal surface caching** — LRU3キャッシュでPTY再生成を最小化
- **Workflow status badges** — todo/inProgress/needsReview/done
- **Agent introspection** — `mori pane list`でJSON出力、エージェント種別検出
- **Pane identity metadata** — 環境変数(MORI_PROJECT等)を全ペインに注入
- **Unix Socket IPC** — CLIとアプリ間の構造化メッセージング

→ **Aetherに採用すべき**: ワークフローステータスバッジ、PTYキャッシュ、環境変数メタデータ注入

### 4. ao-cli (Animus)
**核心**: YAML定義→AIエージェント自動ディスパッチパイプライン
- **YAML-driven** — agents/phases/workflows/schedulesを宣言的に定義
- **Multi-agent dispatch** — Claude/Codex/Geminiにタスクを自動振り分け
- **Isolated worktrees** — タスクごとにgit worktreeで分離
- **Quality gates** — フェーズ間にレビュー/テストゲート
- **Cron scheduling** — work-planner(5m), pr-reviewer(5m), reconciler(5m)
- **Autonomous pipeline** — 人間不在でもPR作成→レビュー→マージ

→ **Aetherに採用すべき**: YAMLワークフロー定義、自動ディスパッチ、品質ゲート、スケジューリング

---

## Aether独自のエッジ（他にないもの）

### 1. Unified Command Center
tmux-agent-sidebarのcross-session監視 + vibe-kanbanのカンバン + ao-cliの自動ディスパッチ を **1つのGUIウィンドウに統合**。
既存ツールはCLI/TUIで、GUIで全部見えるのはAetherだけ。

### 2. Visual Workflow Builder
ao-cliのYAML定義をGUIで構築。ドラッグ&ドロップでフェーズ/エージェント/ゲートを配置。
→ YAML手書きの必要なし。初心者でもAIパイプラインを組める。

### 3. Inline Diff Feedback Loop
vibe-kanbanのインラインdiffコメント + Aetherのエージェント制御を組み合わせ。
diffの行をクリック→コメント→エージェントが即修正。人間↔AI間のフィードバックが最短。

### 4. Smart Agent Router
ao-cliのマルチエージェント対応をリアルタイムに。
タスクの性質を分析→最適なエージェント(Claude/Codex/Gemini)に自動ルーティング。
モデルのコスト/能力/得意分野を考慮。

### 5. One-Click Onboarding
「ターミナルはとっつきにくい」問題の解決。
- Welcome画面にインタラクティブチュートリアル
- よく使うコマンドのビジュアルボタン(Toolkit)
- AIに自然言語で指示→Toolkitに自動変換
- 「何をしたい？」から始まるタスクランチャー

### 6. Living Dashboard
tmux-agent-sidebarのメタデータ表示を進化:
- 各エージェントのCPU/メモリ使用率
- トークン消費速度グラフ
- 推定完了時間
- コスト予測（「このタスクは$0.50で完了見込み」）
