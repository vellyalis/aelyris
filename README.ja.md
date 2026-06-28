[English](README.md) | **日本語**

# Quorum

Quorum — Windows 向けのプロジェクトファースト AI 開発ワークスペース（旧称 Aether Terminal）。

![Quorum の可視分割ペインの中で複数の AI コーディングエージェントが並列に作業している様子。左側にプロジェクトのファイルツリー、右側に起動済み・レビュー済みエージェントを示すオーケストレーターレールがある](docs/assets/hero-fleet.png)

> アルファ版の開発時スクリーンショット。各ペインはそれぞれの git worktree 内で
> 動く対話的なエージェント CLI で、右側にオーケストレーターレールがある。
> 中央ペインツリーへの複数エージェント並列ディスパッチはまだゲート段階
> （`verify:agent-team-orchestration-readiness` は未グリーン）であり、これは
> 並列フリートの保証ではなく土台を示すもの。詳細は下の「現在の状態と制約」を参照。

Quorum は、実ターミナルのワークスペース、可視の AI エージェントペイン、
プロジェクト / worktree のコンテキスト、レビューとマージの制御、機械検証可能な
リリースゲートを 1 つにまとめた Tauri デスクトップアプリです。長期的な狙いは
単なるターミナルのタブ管理ではなく、AI 開発チームのための監査可能な操作面を
作ることにあります。

## 現在の状態

**アルファ / 開発進行中。リリース可能な状態ではありません。**

リポジトリは公開プレビュー可能ですが、現時点では tmux 同等、BridgeSpace-plus、
Ghostty / WezTerm 級、world-class なターミナル AI OS、リリース可能、厳密な
`agmsg` スーパーセットといった主張はまだできません。

直近に記録されたローカル生成の機械的エビデンス（2026-06-28 JST 時点）。
リリースに関する主張を行う前に `pnpm verify:quality-score`、
`pnpm verify:goal:safe`、`pnpm verify:world-class-terminal-ai-os` で再生成して
ください。

- `release-quality-score`: `43/100`、`150/351`、グレード `D`
- `releaseCandidateReady`: `false`
- 機械フィールド: `releaseCandidateReady=false`
- `final-goal-safe`: `ok=false`、`status=blocked`
- `requirements-spec-design-traceability`: `pass-doc-traceability-current`
- `world-class-terminal-ai-os`: `status=external-blocked`

現時点で妥当に言える主張は次の範囲です。

> Quorum には実体のある Rust/Tauri ターミナル、mux、sidecar、可視エージェント、
> MCP、worktree、ownership、レビュー、マージの土台がある。world-class な製品
> 主張は、ライブな耐久性、再起動 / リプレイ、ネイティブ品質、署名 / アップデータ、
> 外部オペレーター検証のゲートによって、まだブロックされている。

## Quorum とは

Quorum は次のワークフローを目標に設計しています。

1. シェルではなくプロジェクトを開く。
2. 作業を可視のエージェントレーンに分割する。
3. エージェントを検査可能なターミナルペインへ向ける（可視 PTY のパスは実装済み、
   ペインツリー全体のオーケストレーションはまだゲート段階）。
4. worktree と ownership クレームで作業を分離する。
5. 監査可能な制御レイヤーを通してレビュー・承認・マージする。
6. 製品の主張を散文ではなく、スクリプトと成果物で裏づけたゲートとして扱う。

## 実装済みの土台

- Windows ターミナルランタイム: Tauri v2、Rust バックエンド、WebView2 フロント
  エンド、ConPTY、xterm.js、ネイティブターミナルの実験。
- ペイン / mux レイヤー: ペインツリー、分割レイアウト、永続化したペイン状態、
  mux グラフ、sidecar 方向、tmux 級コントラクト検証（ライブな mux 復元の証明は
  まだゲート段階）。
- 可視 AI エージェント: 人間に見えるペインで print/headless モードを避ける、
  対話的な Codex / Claude / Gemini CLI の起動パス。
- AI コントロールプレーン: task / orchestrator API、MCP サーフェス、event /
  context のプラミング、コマンドリスク境界。
- プロジェクト操作: ファイルツリー、検索、Monaco エディタ、PR インスペクタ、
  Git / worktree ツール、レビュー / マージ意図フロー、ownership 追跡。
- リリース証明チェーン: 品質スコア、最終ゴール監査、トレーサビリティ、衛生、
  反負債、mux / native / エージェントオーケストレーション、外部ゲート検証。

## 既知の制約

これらは隠れた脚注ではなく、意図的な公開準備の境界です。

- 安定した公開リリースはまだ出していません。
- パッケージは `"private": true` のままで、npm 公開を意図していません。
- 完全な tmux 同等の耐久性は、ライブ復元と sidecar / host 証明のゲートによって
  まだブロックされています。
- BridgeSpace-plus の共有ブレイン主張には、ライブな再起動 / リプレイ証明と、
  能力のあるホスト上での緑のエージェントチームオーケストレーション証拠が必要です。
- Ghostty / WezTerm 級のターミナル品質は、日常使い、ネイティブの視覚リグレッ
  ション、テキストシェイピング / フォールバック、再接続、実機のスリープ / レジューム
  証拠がすべて最新になるまで主張しません。
- 一部のライブ検証には WebView2/CDP アクセス、実機 Windows のスリープ / レジューム、
  すべての開発サンドボックスでは使えないホストプロセスポリシーが必要です。
- 認証付き AI CLI のプロンプトスモークテストはトークンを消費する可能性があり、
  明示的なオペレーター同意なしには実行しません。
- リリース署名 / アップデータの成果物はオペレーター所有で、既定では生成されません。
- 厳密な `agmsg` 級のローカルエージェントメッセージングは計画段階であり、まだ
  実装も主張もできません。

## 技術スタック

- Tauri v2
- Rust、Tokio、portable-pty、git2、rusqlite
- React 19、TypeScript、Vite 7
- xterm.js と WebGL ターミナルレンダリング
- Monaco Editor（Vim モード）
- Radix UI プリミティブ、Lucide アイコン、CSS Modules
- Windows WebView2、ConPTY、Mica/Acrylic ウィンドウスタイリング

## 必要環境

- Windows 11 推奨
- Rust ツールチェーン
- Node.js 24+
- pnpm 10+
- WebView2 ランタイム

Windows 10 でも、視覚 / ランタイム挙動が低下した形で動作する場合があります。

## 開発

```powershell
pnpm install
pnpm tauri dev
```

最初の Rust/Tauri ビルドは、特に Cargo の `target` ディレクトリをクリーンした
後は時間がかかることがあります。

## ビルド

```powershell
pnpm build
pnpm tauri:build:dist
```

## 検証

トークンを消費しない便利なチェック:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
pnpm verify:goal:safe
```

主張ゲート:

```powershell
pnpm verify:world-class-terminal-ai-os
pnpm verify:mux-tmux-grade-contract
pnpm verify:visible-agent-pane-binding
pnpm verify:terminal:native-boundary
```

トークンを消費する AI プロンプト検証はオプトインのみです。認証付きプロンプト
スモークテストを実行する前に、同意パケット検証を参照してください。

```powershell
pnpm verify:terminal:authenticated-ai-cli-consent-packet
```

## ドキュメントマップ

- ドキュメントガイド: `docs/README.md`
- GitHub 紹介ドラフト: `docs/GITHUB_INTRODUCTION.md`
- ロードマップ計画: `PLAN.md`
- エージェントワークフローガイド: `docs/AGENT_WORKFLOWS.md`
- 公開準備状況: `docs/PUBLICATION_READINESS.md`
- 要件の入口: `docs/requirements.md`
- Work-unit ハンドオフ: `docs/specs/CODEX_HANDOFF.md`
- 可視エージェントランタイム境界:
  `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`
- 要件 / 仕様 / 設計トレーサビリティ:
  `docs/specs/AETHER_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md`
- エージェントメッセージバススーパーセット仕様:
  `docs/specs/ASTRA_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`
- ギャップクローズ設計:
  `docs/specs/AETHER_WORLD_CLASS_GAP_CLOSURE_IMPLEMENTATION_DESIGN_2026-06-25.md`

## リポジトリの衛生

生成されるローカル成果物は意図的に無視されます。

- `node_modules/`
- `dist/`
- `.codex-auto/`
- `artifacts/`
- `src-tauri/target/`
- `src-tauri/pty-server/target/`
- `src-tauri/binaries/`

シークレット、ローカルの `.env` ファイル、生成された署名素材、Cargo のビルド
出力はコミットしないでください。

## コントリビューション

このプロジェクトは速く動いています。変更を出す前に `AGENTS.md` と
`docs/specs/CODEX_HANDOFF.md` を読み、スコープを絞った work unit を選び、要件・
実装・検証成果物の整合を保ってください。

公開コントリビューションのワークフローは `CONTRIBUTING.md` を参照してください。

## セキュリティ

脆弱性はトリアージされるまで GitHub Issue として公開しないでください。
`SECURITY.md` を参照してください。

## ライセンス

MIT。`LICENSE` を参照してください。
