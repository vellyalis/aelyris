[English](README.md) | **日本語**

# Aelyris

![プロジェクトツリーと Mission コックピットの横で、複数の AI コーディングエージェントが見えるターミナルペイン内で作業している Aelyris](docs/assets/hero-fleet.png)

**AI コーディングエージェントのための、検証可能なローカル管制室。作業は見え、権限はバックエンドにあり、マージは exact-OID で行われます。**

Aelyris（エイリス）は、自然言語の開発目標を耐久的な **Mission** に変換します。計画、TaskGraph、見える PTY 実行、独立レビュー、正確なコミットのマージ、不変の完了 packet、再起動後の復元は、すべてバックエンドの既存 owner が担当します。オペレーターは実際のエージェント端末を見ながら必要に応じて介入し、終了後には耐久的な証跡を確認できます。

> **アルファ版・開発中。まだリリース可能とは主張しません。**
> focused test が 1 本通っただけで製品機能やリリース品質へ昇格させることはありません。公開主張は、実行可能な verifier、正確な Git provenance、オペレーター／外部ゲートの後ろに置きます。

## 検証済みの Mission 経路

```text
自然言語の Goal
        ↓
バックエンド所有の planner
        ↓
耐久的な Mission + TaskGraph
        ↓
隔離された git worktree 内の visible AI CLI
        ↓
fresh なプロジェクト gate
        ↓
固定された独立 reviewer
        ↓
exact-OID merge
        ↓
CompletedWorkPacket + MissionCompletionPacket
        ↓
再起動後も復元できる現在状態・履歴・完了 receipt
```

この経路は、real Codex worker、visible PTY 実装、独立レビュー、exact-OID merge、不変 settlement、worktree 回収、同一 SQLite での再起動復元まで実機で通しています。Cockpit と MCP は同じバックエンド owner の projection であり、どちらも verdict、candidate OID、packet、完了状態を勝手に作れません。

## ひと目でわかる現在の機能

| 領域 | アルファ版で使えるもの |
| --- | --- |
| **見えるエージェント作業** | 1 ペインに 1 つの本物の対話型 AI CLI。実行中の画面を見て、必要なら方向修正できます |
| **隔離** | オーケストレーションされた worker は専用 git worktree と宣言済み output／ownership lane を使います |
| **耐久的 Mission** | Goal、plan、TaskGraph、実行状態、review lineage、settlement packet、現在 Mission を SQLite から復元 |
| **レビュー／マージ権限** | 固定独立レビュー、機械 gate、exact candidate binding、旧 OID compare-and-swap merge |
| **完了の真実** | Task は不変の `CompletedWorkPacket` がなければ完了ではなく、Mission 全体には `MissionCompletionPacket` が必要 |
| **Mission 履歴** | bounded な newest-first 履歴で、現在の未完了 Mission と過去の packet-backed 完了を明確に分離 |
| **2 つの製品面** | 人間向け Cockpit と型付き MCP／JSON-RPC control plane が、同じ Rust owner と Governance 境界を使用 |
| **ネイティブ端末基盤** | Rust 所有の ConPTY、入力、clipboard、IME、scrollback、pane graph、session lifecycle |
| **Windows 配布** | ローカル unsigned EXE／NSIS／MSI の smoke artifact。正式署名と公開は別 gate |

## Aelyris が必要な理由

複数の coding agent を起動すること自体は難しくありません。難しいのは、各 agent の作業を見える状態に保ち、変更を隔離し、何をテストしたか証明し、レビュー済みの正確なコミットだけを main へ入れることです。

Aelyris は、その問題を後付けスクリプトではなく製品の基本要素として扱います。

- **隠さず見せる** — 実際の agent session が操作面であり、そのままデバッグ記録になります。
- **chat 中心ではなく project 中心** — Mission は repository、TaskGraph、branch、output、evidence、Git identity に結びつきます。
- **権限はバックエンドが所有** — AI は計画・実行・レビュー開始を要求できますが、自分の verdict、merge token、completion packet は書けません。
- **ラベルではなく exact evidence** — `done` と表示されるだけでは完了になりません。統合された exact OID に結びつく検証済み packet lineage が必要です。
- **provider-neutral** — visible PTY が現在の Current Best です。OpenCode や別の structured runtime は必須ではなく、Aelyris の owner を重複させずに明確な優位性を証明した場合だけ候補になります。
- **ローカルファースト** — terminal、worktree、SQLite、audit、control surface はオペレーターの PC 上で動きます。

## 現在できること

### Visible terminal fleet

- 互換 coding-agent CLI を見える terminal pane 内で実行。Codex には current real-provider Mission evidence があり、provider ごとの parity は別 gate のままです。
- pane はブラウザ端末テキストのスクレイプではなく、Rust 所有の native session state に接続。
- multiplexer が workspace／window／tab／pane topology、split、zoom、同期入力、bounded capture、scrollback、restart adoption を所有。
- agent／terminal lifecycle の read projection は value-minimized。raw scrollback は明示的に sensitive な terminal capture 境界からだけ取得。

### Durable Mission OS

- 自然言語 Goal を backend-owned planner へ渡して計画。
- Mission + TaskGraph を atomic に受理。
- 既存 PaneFleet／worktree owner から visible worker を dispatch。
- fresh gate と独立 review。
- exact candidate freeze、MergeIntent、exact-OID merge、不変 settlement、durable completion event、cleanup。
- restart-safe な `mission.current`、bounded `mission.history`、packet-backed `mission.completion`。
- Cockpit 内の Mission history。現在／未完了／完了／不整合を分け、read-only receipt inspector から不変参照だけを確認可能。

### Coordination と Governance

- file／symbol ownership、衝突検出、lease。
- 共有 decision、typed intent、durable event、blocker、activity、knowledge-graph impact query。
- Principal-scoped discovery／authorization。
- mutation と coordination read の payload-minimized audit。
- cost cap と、信頼できる telemetry がない cap 軸を 0 と見なさず fail-closed にする admission。

### AI 自己操作

サポートされた Mission 経路は型付き MCP tool から利用できます。

```text
aelyris.mission.plan
aelyris.mission.current
aelyris.mission.run_next
aelyris.mission.review_and_settle
aelyris.mission.completion
aelyris.mission.history
```

caller が渡せるのは各段階に必要な bounded identity／Goal だけです。planner 選択、TaskGraph 権限、reviewer identity、verdict、candidate OID、merge 権限、packet 生成はバックエンドに残ります。

## 正直な制約

Aelyris はまだアルファ版です。

- 正式な **Authenticode**、updater 署名、`.sig`／`latest.json`、公開、update endpoint の証拠は未完了。
- installer の実 install／relaunch／upgrade／rollback はオペレーター gate。
- real Windows sleep／resume と一部の外部 A9 certification は別証拠。
- 現在の UI は、native Rust terminal／runtime substrate の上に Tauri／React／WebView2 Cockpit を載せています。Full Native UI は、再利用可能な **Alyce** framework と activation evidence が整うまで parked。
- 衝突回避が保護するのは Aelyris 所有の orchestration lane。外部からの任意 Git 操作は回避できます。
- Aelyris は既存の coding-agent CLI を協調させる製品であり、model やオペレーターの最終判断を置き換えません。
- 現在の主対象は Windows です。

## ロードマップの方向

優先順位は value-first です。

1. 残っている operator／external release certification を閉じる。
2. visible PTY を Current Best とし、structured runtime は明確な優位性を証明した場合だけ採用する。`promote_none` も正しい結論。
3. 既存 durable owner から deterministic Mission replay／recovery を構築する。第二 journal、第二 TaskGraph、第二 packet store は作らない。
4. Proofbook、Remote Continuity、governed multi-client operation は、それぞれ別に承認された境界で拡張。
5. Alyce が完成し、測定済み migration gate が開いた後に Full Native Rust UI へ進む。

## 技術スタック

- **Tauri v2** — Rust backend + React／WebView2 Cockpit
- **Rust** — Tokio、Git2、rusqlite、Windows native API、ConPTY
- **Frontend** — React 19、TypeScript、Vite 7、CSS Modules、Radix primitives
- **Editor** — Monaco + Vim mode
- **Control plane** — 共有 owner 上の authenticated REST／MCP／JSON-RPC projection
- **Packaging** — Windows EXE、NSIS、MSI、updater contract、Release Doctor

## 必要環境

- Windows 11 推奨
- Rust MSVC toolchain
- Node.js 24+
- pnpm 10+
- WebView2 Runtime
- live agent 作業には互換 AI coding-agent CLI が 1 つ以上必要

## 開発環境の準備

```powershell
git clone https://github.com/vellyalis/aelyris.git
cd aelyris
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-development.ps1
corepack pnpm tauri dev
```

bootstrap は toolchain を確認し、frozen install を行い、tracked Git truth から ignored continuation state を再構築し、fresh-clone gate を実行します。別 PC の credential、token、署名材料、generated evidence はコピーしません。

自動 UI 検証では、オペレーターのアクティブウィンドウを絶対に奪いません。非表示・非フォーカスの Tauri runtime には `corepack pnpm tauri:dev:verification` を使い、通常の `tauri:dev` は明示的な対話開発にだけ使用します。

## Build

```powershell
corepack pnpm build
corepack pnpm tauri:build:dist
```

canonical Windows distribution wrapper が Rust PTY sidecar を build し、ローカル unsigned NSIS／MSI artifact を生成します。unsigned artifact は smoke evidence であり、release-ready の主張ではありません。

## 検証

普段の focused lane:

```powershell
corepack pnpm verify:fast
cargo check --manifest-path src-tauri/Cargo.toml --lib
corepack pnpm verify:mcp-orchestrator
corepack pnpm verify:ai-decision-knowledge
```

配布／release evidence:

```powershell
corepack pnpm verify:dist
corepack pnpm verify:release:doctor
corepack pnpm verify:supply-chain
corepack pnpm verify:stack-risk
corepack pnpm verify:goal:safe:no-token
```

別 PC での継続性:

```powershell
corepack pnpm bootstrap:continuation
corepack pnpm verify:product-delivery:continuation
corepack pnpm verify:cross-pc-continuation
```

現在の readiness を README や古い score artifact から推測しないでください。必ず exact current HEAD で必要な gate を再生成します。

## ドキュメント

- [GitHub 紹介文／About copy](docs/GITHUB_INTRODUCTION.md)
- [ドキュメント索引](docs/README.md)
- [Contributor workflow](docs/AGENT_WORKFLOWS.md)
- [Publication readiness](docs/PUBLICATION_READINESS.md)
- [Requirements／claim policy](docs/requirements.md)
- [仕様索引](docs/specs/README.md)
- [MCP tool surface](docs/specs/MCP_TOOL_SURFACE_SPEC.md)
- [Visible agent runtime](docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md)

## 名前

- 製品名: **Aelyris**
- 読み: **Aelys** / **エイリス**
- CLI／短縮名: `aelys`
- 協調エンジン: **Qralis**

## Contributing

変更前に `AGENTS.md` と `CONTRIBUTING.md` を読んでください。requirements、implementation、test、verifier、public claim を同じ事実へ揃えます。Mission、TaskGraph、PTY、review、merge、packet、durable state の第二 owner を追加しないでください。

## License

[LICENSE](LICENSE) を参照してください。
