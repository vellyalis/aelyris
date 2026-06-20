# BridgeSpace 競合監査 — 取り込むべきもの (2026-06-20)

対象: BridgeMind **BridgeSpace**（Agentic Development Environment）。出典: 製品ページ /
docs.bridgemind.ai/docs/bridgespace / roadmap（browser-UA fetch, 2026-06-20）。
Aether 側はコードで実在確認（grep ベース、推測でない）。

## BridgeSpace 機能インベントリ（公開情報）
- マルチペインターミナル 1–16、**Warp風コマンドブロック**（command text / full output /
  exit-code 緑赤 / timestamp / collapsible）
- ターミナル: 分割H/V、検索(Cmd/Ctrl+F)、右クリックメニュー、ファイルD&Dでパス貼付、
  **インライン画像プレビュー**、scroll-to-bottom インジケータ
- 統合エディタ: syntax highlight / language detection / **file watching** / Quick Open(Cmd+P) / タブ
- ファイルサイドバー（tree / icons / D&D）
- **AIエージェント**: Kanban(Todo/In Progress/In Review/Complete)、タスク選択→project解決→
  workspace/terminal生成→**knowledge context付きコマンド構築**→自動実行(agent auto-launch)
- **ワークスペーステンプレート**（1/2/4/6/8/10/12/14/16ペインのプリセット）
- **25+テーマ**（Void/Neon Tokyo/Synthwave/Dracula…）
- 自動更新（背景）
- エコシステム: **BridgeMCP**(共有エージェントメモリ/タスク連携/cross-tool sync)、
  **BridgeVoice**(オンデバイスWhisper・sub-second の音声コーディング)、BridgeShot

## Aether の実在確認（コード）
| 機能 | Aether | 証拠 |
|---|---|---|
| マルチペイン分割/mux | ✅ | `pane-tree`, `mux_*` |
| コマンドブロック+exit表示 | ✅ | `TerminalInfoBar.ExitStatusDot`(緑/赤), `CommandBlockJournal`, prompt marks |
| 折りたたみコマンドブロック | △要確認 | exit表示はあるが per-block collapse UX は未確認 |
| ターミナル検索/分割/画像 | ✅ | term_image IPC, search, splits |
| 統合エディタ | ✅(上) | Monaco + **LSP + Vim + Diff**（BridgeSpaceより厚い） |
| file watching | ✅ | `watcher.rs` |
| ファイルツリー(+git status) | ✅ | `file-tree` |
| Kanban | ✅ | `features/kanban` |
| **マルチエージェント自律** | ✅(大幅に上) | Task Graph/依存ゲート/Scheduler/Reviewer自動マージ/worktree隔離/file所有/BR9回復/2-faces API(MCP 54)/Knowledge Graph/Cost上限 |
| テーマシステム | ✅(プリセット少) | `shared/themes/catppuccin`+`moods`+accent overrides。**プリセット数が少ない** |
| **ワークスペーステンプレート** | ❌ギャップ | 動的split+保存レイアウトはあるが one-click N-pane プリセット無し |
| 自動更新 | △ | plugin+conf 配線済だが placeholder pubkey で未有効（署名鍵=運用ゲート） |
| **音声入力** | ❌ギャップ | 該当コード無し（"whisper"はCSSコメントの別物） |
| 共有エージェントメモリ(MCP) | ✅(同等以上) | Context Store + Knowledge Graph + Event Bus |

## 取り込むべきもの（優先順）
1. **【最優先・低工数・高効果】ワークスペース/ペインのプリセットテンプレート**
   特に **「Fleet」テンプレート（N体のエージェントペインを一発レイアウト）**。今回作った
   「ループ dispatch→実分割ペインで稼働」を増幅し、デモ/運用の即戦力。BridgeSpace の
   テンプレート機能の“自律版”として上位互換になる。
2. **【低工数・磨き】テーマプリセット拡充**。アーキは既にある（mood+accent override）。
   プリセットを数個足すだけ。「カッコいい」要件に直結。
3. ~~音声で“指揮”（BridgeVoice 相当）~~ **不採用（ユーザー判断 2026-06-20）**。音声系は作らない。
4. **【配布時】自動更新の有効化**（署名pubkey生成=運用ゲート、`docs/auto_updater_setup.md`）。
5. **【確認】コマンドブロックの per-block 折りたたみ UX**（exit表示はある、折りたたみ要確認）。

## 取り込まない（既に上 or 別路線）
- コア自律オーケストレーション（Aether が大幅に深い）/ エディタ深さ(LSP/Vim/Diff) /
  ネイティブRustターミナルエンジン＋PTYサイドカー。

## 結論（音声系除外後）
製品体験（テンプレ/テーマ/配布）は BridgeSpace が先行、**自律の深さと API-first
（外部AIが指揮）は Aether が上**。採用するのは **(1) Fleet含むテンプレート → (2) テーマ
プリセット**（＋配布時に(4)自動更新、(5)ブロック折りたたみ確認）。**音声系(3)は不採用。**
