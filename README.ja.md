[English](README.md) | **日本語**

# Aelyris

Aelyris — Windows 向けのプロジェクトファースト AI 開発ワークスペース。

Aelyris は、実ターミナルのワークスペース、可視の AI エージェントペイン、
プロジェクト / worktree のコンテキスト、レビューとマージの制御、機械検証可能な
リリースゲートを 1 つにまとめた Tauri デスクトップアプリです。実ペインでの並列作業、関数単位の衝突回避、コミットに束縛されたマージを 1 つの監査可能な操作面にまとめることを目指しています。intent bus や shared brain は計画 / 進行中の領域であり、完成主張は verifier がグリーンになるまで行いません。

## 命名

- 製品名: **Aelyris**、読みは **Aelys** / **エイリス**。
- CLI / short name: `aelys`。
- 機能名: **Aelyris Core**、**Aelyris Grid**、**Aelyris Pane**。
- 協調エンジン名: **Qralis**。

## 現在の状態

**アルファ / 開発進行中。リリース可能な状態ではありません。**

Aelyris はアルファであり、製品としての完成（プロダクションレディ）を主張しません。
能力に関する主張は verifier（検証コマンド）でゲートされます。リポジトリは公開
プレビュー可能ですが、リリースに関する判断の前に `pnpm verify:quality-score` と
`pnpm verify:goal:safe` をローカルで再生成して現在値を確認してください。

現時点で妥当に言える主張は次の範囲です。

> Aelyris には実体のある Rust/Tauri ターミナル、mux、sidecar、可視エージェント、
> MCP、worktree、ownership、レビュー、マージの土台がある。より大きな製品主張は、
> ライブな耐久性、再起動 / リプレイ、ネイティブ品質、署名 / アップデータ、外部
> オペレーター検証のゲートによって、まだブロックされている。

## Aelyris とは

Aelyris は次のワークフローを目標に設計しています。

1. シェルではなくプロジェクトを開く。
2. 作業を可視のエージェントレーンに分割する。
3. エージェントを検査可能なターミナルペインへ向ける（可視 PTY のパスは実装済み、
   ペインツリー全体のオーケストレーションはまだゲート段階）。
4. worktree と ownership クレームで作業を分離する。
5. 監査可能な制御レイヤーを通してレビュー・承認・マージする。
6. 製品の主張を散文ではなく、スクリプトと成果物で裏づけたゲートとして扱う。

## 実装済みの土台

- Windows ターミナルランタイム: Tauri v2、Rust バックエンド、WebView2 フロント
  エンド、ConPTY、ネイティブ Rust ターミナルレンダリング。
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
- 完全なセッション耐久性は、ライブ復元と sidecar / host 証明のゲートによって
  まだブロックされています。
- shared brain（共有ブレイン）の主張には、ライブな再起動 / リプレイ証明と、能力の
  あるホスト上での緑のエージェントチームオーケストレーション証拠が必要です。
- ネイティブ級のターミナル品質は、日常使い、ネイティブの視覚リグレッション、
  テキストシェイピング / フォールバック、再接続、実機のスリープ / レジューム証拠が
  すべて最新になるまで主張しません。
- 一部のライブ検証には WebView2/CDP アクセス、実機 Windows のスリープ / レジューム、
  すべての開発サンドボックスでは使えないホストプロセスポリシーが必要です。
- 認証付き AI CLI のプロンプトスモークテストはトークンを消費する可能性があり、
  明示的なオペレーター同意なしには実行しません。
- リリース署名 / アップデータの成果物はオペレーター所有で、既定では生成されません。
- intent bus を含むローカルエージェントメッセージングは計画 / 進行中であり、完成
  主張はまだできません。

## 技術スタック

- Tauri v2
- Rust、Tokio、portable-pty、git2、rusqlite
- React 19、TypeScript、Vite 7
- ネイティブ Rust ターミナルレンダリング（ConPTY、Rust-owned input / clipboard / IME）
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
pnpm verify:mux-durability-contract
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
- エージェントワークフローガイド: `docs/AGENT_WORKFLOWS.md`
- 公開準備状況: `docs/PUBLICATION_READINESS.md`
- 要件の入口: `docs/requirements.md`
- 仕様インデックス: `docs/specs/README.md`
- 可視エージェントランタイム境界:
  `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`
- エージェントメッセージバススーパーセット仕様:
  `docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`

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
`docs/specs/README.md` を読み、スコープを絞った work unit を選び、要件・
実装・検証成果物の整合を保ってください。

公開コントリビューションのワークフローは `CONTRIBUTING.md` を参照してください。

## セキュリティ

脆弱性はトリアージされるまで GitHub Issue として公開しないでください。
`SECURITY.md` を参照してください。

## ライセンス

MIT。`LICENSE` を参照してください。
