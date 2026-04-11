# Aether Terminal — ROADMAP

> 全計画書の索引 + 実行順序。「今どこにいて、次何やるか」の唯一の真実。
>
> 最終更新: 2026-04-11

---

## 現在地

- UI/デザイン刷新: **完了**
- ターミナル基盤: **完了** (ConPTY, multi-shell, IMEオーバーレイ, Canvas描画)
- send-keys / capture-pane: **完了**
- Phase 0 (Worktree Deep Integration): **完了** — WorktreeManager, File Watcher, インラインUI
- Phase 1 (Task-Agent Link): **完了** — Kanban↔Agent双方向リンク, 自動カラム移動
- Phase 2 (Agent Enrichment): **完了** — 環境変数注入, ポート検出, パーミッションバッジ
- Phase 3 (Workflow Engine): **完了** — YAML定義, 品質ゲート, WorkflowPanel

**次のマイルストーン: Phase 4 (SCM Panel)**

---

## Phase 0: Git Worktree Deep Integration

**目的:** Scapeとの最大差分を解消。ブランチ=Worktree=Session=Terminalの統合。
**優先度:** P0 (最優先)
**依存:** なし
**詳細:** [`integration-plan.md` Phase 0](integration-plan.md#phase-0-git-worktree-deep-integrationscape)

| Step | 内容 | 規模 | ソース |
|------|------|------|--------|
| 0-1 | WorktreeManager (Rust: create/list/remove/switch) | ~300行 Rust | GitButler, Mori, animus-cli |
| 0-2 | Session↔Worktree ライフサイクル連動 | ~200行 TS | Scape, Mori |
| 0-3 | Worktree-Scoped Terminal (タブにブランチバッジ) | ~100行 TS | VS Code |
| 0-4 | Real-time File Watcher (notify crate, 100msバッチ) | ~200行 Rust | GitButler |

**完了条件:**
- [ ] セッションカードからインラインWorktree作成ができる (Scape準拠)
- [ ] "End Session & Remove Worktree" が動作する
- [ ] ターミナルタブにWorktreeブランチ名が表示される
- [ ] ファイル変更が100ms以内にFileTree/git statusに反映される

---

## Phase 1: Task-Agent Link

**目的:** KanbanタスクとAgentセッションを双方向リンク。タスク→Worktree→Agent自動起動。
**優先度:** P0
**依存:** Phase 0
**詳細:** [`unified-edge-plan.md` Phase 1](unified-edge-plan.md#2-phase-1-task-agent-link)

| Step | 内容 | 規模 |
|------|------|------|
| 1-1 | エージェント起動時のタスクリンク | +30行 |
| 1-2 | セッション完了時のカラム自動移動 | +15行 |
| 1-3 | タスク→Worktree自動作成 | ~80行 (useTaskAgent.ts) |
| 1-4 | Agent Inspector↔Kanban相互リンク | +30行 |

**完了条件:**
- [ ] タスク▶ → Worktree作成 → Agent起動 → assignedAgentId設定
- [ ] Agent完了 → カードが"review"列に自動移動
- [ ] Agent Inspector/Kanban双方にリンクバッジ表示

---

## Phase 2: Agent Enrichment

**目的:** エージェントセッションにパーミッション/ポート検出/サブエージェントツリー/環境変数注入を追加。
**優先度:** P1
**依存:** Phase 1
**詳細:** [`unified-edge-plan.md` Phase 2](unified-edge-plan.md#3-phase-2-agent-enrichment) + [`integration-plan.md` Phase 1](integration-plan.md#phase-1-agent-orchestration-)

| Step | 内容 | ソース |
|------|------|--------|
| 2-1 | パーミッションモードバッジ | tmux-agent-sidebar |
| 2-2 | ポート自動検出 → Web Inspector連携 | tmux-agent-sidebar |
| 2-3 | SubagentTree データ接続 | tmux-agent-sidebar |
| 2-4 | 環境変数メタデータ注入 (AETHER_*) | Mori |
| 2-5 | Agent Lifecycle Hooks (状態自動検出) | Mori |
| 2-6 | Agent Bridge (セッション間メッセージング) | Mori |

**完了条件:**
- [ ] セッションカードにパーミッションバッジ表示
- [ ] dev server起動 → ポート自動検出 → Web Inspectorに反映
- [ ] SubagentTreeにデータが表示される
- [ ] ターミナル出力からエージェント状態を自動検出

---

## Phase 3: Workflow Engine

**目的:** YAMLワークフロー定義 + 品質ゲート + 自動ディスパッチ。
**優先度:** P1
**依存:** Phase 2
**詳細:** [`unified-edge-plan.md` Phase 3](unified-edge-plan.md#4-phase-3-workflow-engine)

| Step | 内容 | 規模 |
|------|------|------|
| 3-1 | ワークフロー型定義 (Rust) | ~50行 |
| 3-2 | YAMLパーサー | ~120行 |
| 3-3 | ワークフロー実行エンジン | ~200行 |
| 3-4 | IPC + Frontend (WorkflowPanel) | ~200行 |
| 3-5 | Kanban統合 (ワークフロー選択ダイアログ) | +20行 |

**完了条件:**
- [ ] `.aether/workflows/feature.yaml` が読み込める
- [ ] plan→implement→reviewのパイプラインが自動実行
- [ ] 品質ゲート (test_pass/human_review) が動作

---

## Phase 4: SCM Panel + Conflict Resolution

**目的:** VS Code式のSource Control Panel + GitButler式のConflict Resolution。
**優先度:** P2
**依存:** Phase 0-4 (File Watcher)
**詳細:** [`integration-plan.md` Phase 3](integration-plan.md#phase-3-scm-panelvs-code--gitbutler-)

| Step | 内容 | ソース |
|------|------|--------|
| 4-1 | Resource Groups (Staged/Unstaged/Conflicts) | VS Code |
| 4-2 | Stage/Unstage/Discard アクション | VS Code |
| 4-3 | Commit UI (メッセージ入力 + Commit & Push) | VS Code |
| 4-4 | Commit Graph / Timeline | VS Code, GitButler |
| 4-5 | 3-way Conflict Resolution (ours/theirs/base) | GitButler |

**完了条件:**
- [ ] ファイルがStaged/Unstaged/Conflictsにグループ分けされる
- [ ] GUI上でstage/unstage/commit/pushができる
- [ ] コンフリクトファイルの3-way mergeビューが動作

---

## Phase 5: Diff Feedback Loop

**目的:** DiffViewerで行クリック→コメント→Agent即修正。人間↔AIのフィードバック最短化。
**優先度:** P2
**依存:** Phase 1
**詳細:** [`unified-edge-plan.md` Phase 4](unified-edge-plan.md#5-phase-4-inline-diff-feedback-loop)

| Step | 内容 | 規模 |
|------|------|------|
| 5-1 | DiffViewer行クリック→コメントUI | +100行 |
| 5-2 | コメント→Agent起動→修正→自動リロード | ~50行 |

---

## Phase 6: Session Analytics + Living Dashboard

**目的:** エージェントのコスト/進捗/リソースをリアルタイム可視化。
**優先度:** P2
**依存:** Phase 2
**詳細:** [`unified-edge-plan.md` Phase 5](unified-edge-plan.md#6-phase-5-living-dashboard) + [`integration-plan.md` Phase 4](integration-plan.md#phase-4-session-analytics--events)

| Step | 内容 | ソース |
|------|------|--------|
| 6-1 | Per-Session Analytics (右クリック→View Analytics) | Scape |
| 6-2 | コスト推移グラフ | unified-edge-plan |
| 6-3 | Event Stream (JSONL永続化) | animus-cli |
| 6-4 | Decision Contracts (confidence/risk表示) | animus-cli |
| 6-5 | Model Routing (タスク複雑度→モデル自動選択UI) | animus-cli |

---

## Phase 7: Visual Workflow Builder

**目的:** YAMLワークフローをGUIで視覚的に構築。reactflowノードエディタ。
**優先度:** P3
**依存:** Phase 3
**詳細:** [`unified-edge-plan.md` Phase 6](unified-edge-plan.md#7-phase-6-visual-workflow-builder)

---

## Phase 8: Session Persistence

**目的:** アプリ再起動後にセッション復元。SQLite永続化。
**優先度:** P3
**依存:** なし (独立実装可能)
**詳細:** [`implementation-plan.md` Phase B](implementation-plan.md#phase-b-session-management--sqlite-persistence) + [`integration-plan.md` Phase 5](integration-plan.md#phase-5-persistent-statemori)

---

## 依存関係グラフ

```
Phase 0 (Worktree) ←── 最優先、全ての基盤
  │
  ├──► Phase 1 (Task-Agent Link)
  │      │
  │      ├──► Phase 2 (Agent Enrichment)
  │      │      │
  │      │      ├──► Phase 3 (Workflow Engine)
  │      │      │      │
  │      │      │      └──► Phase 7 (Visual Builder)
  │      │      │
  │      │      └──► Phase 6 (Analytics + Dashboard)
  │      │
  │      └──► Phase 5 (Diff Feedback)
  │
  └──► Phase 4 (SCM Panel) ← Phase 0-4 (File Watcher) 必須

Phase 8 (Persistence) ← 独立。いつでも着手可能
```

---

## 計画書一覧

| ドキュメント | 内容 | 状態 |
|-------------|------|------|
| [`requirements.md`](requirements.md) | ビジョン・技術スタック・UI要件 | 確定 |
| [`design-philosophy.md`](design-philosophy.md) | デザイン哲学 | 確定 |
| [`scape-analysis.md`](scape-analysis.md) | Scape v1.53 技術分析 (DMG解析) | 完了 |
| [`scape-feature-gap.md`](scape-feature-gap.md) | Scape機能差分 (55フレーム) | 完了 |
| [`scape-ui-analysis.md`](scape-ui-analysis.md) | Scape UI分析 | 完了 |
| [`reference-analysis.md`](reference-analysis.md) | 4プロジェクト分析 (tmux/vibe-kanban/Mori/ao-cli) | 完了 |
| [`integration-plan.md`](integration-plan.md) | 5プロジェクト統合計画 (GitButler/Mori/vibe-kanban/animus-cli/VS Code) | 完了 |
| [`unified-edge-plan.md`](unified-edge-plan.md) | 統合エッジ計画 Phase 1-6 | 実装待ち |
| [`workspace-management-plan.md`](workspace-management-plan.md) | tmux再発明 (send-keys/capture-pane/sync) | Phase 1-2 完了 |
| [`implementation-plan.md`](implementation-plan.md) | 実装計画 v2.0 (テスト基盤/PTY/セッション管理) | 部分完了 |

---

## 競合比較サマリ

Aether Terminalが全Phaseを完了した時点での立ち位置:

| 機能領域 | Scape | Aether (現在) | Aether (全Phase完了) |
|---------|-------|--------------|-------------------|
| Git Worktree統合 | ✅ | ❌ | ✅ Phase 0 |
| Task↔Agent連動 | ❌ | ❌ | ✅ Phase 1 |
| Agent監視/制御 | ✅ | ✅ | ✅+ Phase 2 |
| Workflow Engine | ❌ | ❌ | ✅ Phase 3 (独自エッジ) |
| SCM Panel | ❌ | ❌ | ✅ Phase 4 (独自エッジ) |
| Diff Feedback Loop | ❌ | ❌ | ✅ Phase 5 (独自エッジ) |
| Analytics Dashboard | 一部 | ❌ | ✅ Phase 6 |
| Visual Workflow Builder | ❌ | ❌ | ✅ Phase 7 (独自エッジ) |
| Session Persistence | ✅ | ❌ | ✅ Phase 8 |
| Code Editor | ❌ | ✅ | ✅ |
| Kanban Board | ❌ | ✅ | ✅+ |
| Multi-shell | ❌ | ✅ | ✅ |
| IME / CJK | ❌ | ✅ | ✅ |
| Local Voice | ✅ | ❌ | ❌ (後回し) |
