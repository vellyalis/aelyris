# Scape v1.53 技術分析

DMG解析結果 (2026-04-09)

## 技術スタック
- **言語**: Swift (ネイティブmacOS)
- **ターミナル**: macOSネイティブ（libghosttyではなく独自実装の可能性）
- **コードエディタ**: Monaco Editor (WebView埋め込み)
- **Diffビューア**: Monaco Diff Editor (WebView埋め込み)
- **ノートエディタ**: Lexical (React 18, WebView埋め込み)
- **永続化**: GRDB (SQLite)
- **音声**: parakeet-tdt-0.6b-v3-coreml (CoreML on-device STT)
- **MCP**: ScapeMCPServer バイナリ同梱

## フォント
| 用途 | フォント |
|------|---------|
| UI | IBM Plex Sans (Light/Medium/Regular/SemiBold) |
| ターミナル/コード | IBM Plex Mono (Light/Medium/Regular/SemiBold) |
| ノート | Monaspace Neon Var (可変フォント) |
| タイトル/見出し | Archivo Variable (可変フォント) |

## カラーパレット (Monaco設定から)
- 背景: `#1a1a1a`
- 行番号: `#555555`
- アクティブ行番号: `#888888`
- Vimステータスバー: `#212121`
- テキスト: `rgba(255, 255, 255, 0.88)`
- ライトモード: `rgba(0, 0, 0, 0.84)`
- リンク: `#4fc1ff`

## Claude Code連携方式
1. **bridge.sh**: Claude Codeのstatusline hookとして動作
   - PPID (Claude Codeのプロセス) を取得
   - git branch、worktree状態、dirty状態を検出
   - JSON状態ファイルを `~/.claude/scape/sessions/{pid}.json` に書き出し
   - Scapeが FSEvents で監視してUIに反映

2. **notify.sh**: Claude Codeのhookイベントハンドラ
   - UserPromptSubmit → "thinking"
   - PreToolUse/PostToolUse → activity状態更新
   - macOS通知トリガー

3. **状態管理**: `.activity` ファイル + JSON ファイルのダブルバッファ
   - レースコンディション回避のため

## Aether Terminalへの示唆
- Monaco EditorはWebViewで組み込むべき（既に計画済み）
- 背景色を `#1a1a1a` に変更（`#1e1e2e` より暗い方がプロフェッショナル）
- IBM Plex系フォントを検討（現在のInter/Geist/Cascadia Codeの代替として）
- Claude Code連携はstatusline hook + JSONファイル監視方式を採用
- Lexical editorはノート機能追加時に参考にする
