# Aelyris Agent Guide

Windows向けプロジェクトファーストAI開発ワークスペース。

製品名: `Aelyris`。読みは `Aelys` / `エイリス`。CLI / short name は `aelys`。機能名は `Aelyris Core`、`Aelyris Grid`、`Aelyris Pane`。協調エンジン名は `Qralis`。

このファイルは Codex / Claude / other coding agents 共通の作業入口です。
Claude Code 固有の補足は `CLAUDE.md` に置きますが、矛盾した場合はこの
`AGENTS.md` と `docs/requirements.md` の current claim policy を優先します。

Operating-policy version: `2.0.0-aelyris.1` (2026-07-16). This is an
Aelyris-specific adaptation of `AGENTS.gpt56.md`: its Goal/R-PDCA discipline is
adopted, its fixed verification-volume cap is rejected, and the project claim,
continuation, and work-order contracts below remain mandatory.

## Goal Quality And Task Mode

- Goal の達成水準を都合のよい MVP や測定しやすい局所改善へ縮小しない。
  小さく進めるときは Goal ではなく、依存順に並べた仮説・Work Unit・検証単位を
  小さくする。
- Research、thinking、planning、説明、テスト、安全設計、進捗報告、スコアは
  成果物とユーザー価値を改善する手段または証拠であり、その代替ではない。
  focused gate の PASS や局所 phase の完了を、program 全体や release readiness
  の完了へ昇格しない。
- Task Router を開く前に、課題を次の mode に分類する。これは model effort や
  active work-order phase を上書きしない。
  - `Routine`: Goal、owner、解法、評価が明確。最有力案を短い R-PDCA で実装し、
    focused gate から検証する。
  - `Exploration`: 原因、要求、設計、または創造方向に実質的な未知性がある。
    Current Best と構造的に異なる仮説を、期待価値がある範囲で比較する。
  - `Critical`: 失敗が不可逆、外部公開、security/auth、データ損失、release claim、
    または大きな blast radius に関わる。承認境界、復元性、独立 review、
    fail-closed proof を優先する。
- mode は作業量や難しさだけでなく、不確実性、失敗影響、可逆性、探索の期待価値で
  選ぶ。Routine に複数仮説や大規模調査を儀式として強制せず、Exploration を
  最初に思いついた局所解だけで閉じない。

### Autonomy And Questions

- 確認、説明、レビュー、診断、計画の依頼では read-only に調査して報告し、変更を
  行わない。作成、変更、修正の依頼では、scope 内のローカル変更と非破壊検証を
  不要な確認で止めない。
- 外部送信/公開、削除/不可逆変更、購入/有料処理、認証情報/権限変更、重大な scope
  拡張、Goal invariants または責任境界を変える製品判断は実行前に確認する。
- 質問へ逃げる前に repo と machine truth から安全に発見できる事項を調査する。
  確認が必要な場合は、推奨案、主要な選択差、判断基準、回答後の実行内容を示す
  closed question にする。

### Goal State And Comparison Discipline

複数 phase または複数 session の work では、新しい並行 state file を増やさず、
既存の tracked work order、plan、ignored worklog、canonical local handoff に次を
維持する。詳細形式は `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md` を正とする。

- Goal invariants: 主語、対象、scope、責任境界、汎用性条件、成功条件。
- Current Best と Goal Gap。Gap は `global` / `local` / `external` を区別し、
  local gap を比較なしで global bottleneck に昇格しない。
- Responsibility map: backend/domain owner、adapter、UI projection、operator、
  environment の責任を分離する。
- Current hypothesis、反証条件、Verification Surface、next exact action。

候補は少なくとも mechanism、architecture、default、context setting、preference、
verification strategy を混同せず、同じ責任者・Goal invariants・評価 context を持つ
comparison class 内で比べる。context ごとの最適値の違いだけを mechanism の欠陥や
自動化の根拠にしない。新 UI、自動化、authoring、calibration は独立した value
hypothesis として評価する。

### Adaptive R-PDCA

1. **Research**: current source、artifact、Current Best、成功例・失敗例、制約、
   破損条件を確認し、事実・仮説・不確実性・反証条件を分ける。
2. **Plan**: owner、原因仮説、変更、正しい場合と誤っている場合の観測、採否条件、
   副作用、終了条件を定める。
3. **Do**: Goal 価値へ因果的につながる最小の falsifiable slice を実装する。
   表面装飾、説明追加、無目的な parameter 調整だけを進捗にしない。
4. **Check**: 同じ条件の Current Best と比較し、コード量・作業量ではなく、観測差、
   再現性、Goal 寄与、回帰、副作用で判断する。metric と直接観測が乖離したら、
   metric gaming ではなく Goal Model または verifier を修正する。
5. **Act**: 証拠が支持した owner/contract/current-best だけを更新し、採用理由、
   再現条件、副作用、残存不確実性、次の最優先 action を記録する。

同じ前提・仮説・手法で二回連続して Current Best を更新できない場合、微調整を
続けず、問題表現、owner、評価、data path、strategy、tool constraint を監査する。
Workstream は成功終了条件と限界価値を満たせば local gap が残っていても閉じ、
program 全体は重大な global gap、回帰、未証明 claim が残る間は完了扱いしない。

### Selection, Creativity, Verification, And Completion

- `Object Selection`（同一 comparison class の候補）、`Strategy Selection`
  （候補を生む方法）、`Portfolio Selection`（次に投資する workstream）を混同しない。
  各 Act 後に、Goal 寄与、依存、リスク、限界改善、機会費用で workstream を選び直す。
- Exploration では必要に応じて、色、名称、数値、配置だけではない構造的に異なる
  仮説を比較する。新規性、自動化、UI 追加を creativity の証拠にせず、Current Best
  との差、Goal への因果経路、反証条件、副作用を示す。
- ユーザーが直接品質を検証しにくい課題では、主要 claim を反証可能にする
  Verification Surface を成果物と同時に用意する。Before/After、同条件比較、失敗例、
  boundary、ablation、reproduction のうち判断に必要なものだけを選ぶ。
- 検証量は本体 diff との固定比率ではなく、semantic risk、blast radius、回帰可能性、
  証拠の不確実性で決める。小さい security/data-integrity/concurrency 修正では、検証が
  本体実装より大きくてもよい。逆に既存の評価基盤で主要 claim を判定できるなら、
  新しい runner、benchmark、report を増やさない。
- 実装完了、テスト PASS、説明完了だけを Goal 完了にしない。Workstream は成功条件、
  重大回帰なし、残差分類、限界価値を満たしたら閉じる。成果物全体は重大な global
  gap と未証明 claim がなく、Goal invariants、responsibility、主要品質 claim が
  証拠で支持された場合だけ完成とする。
- 同じ前提/仮説/手法で二回連続 Current Best を更新できない場合は微調整を止め、
  問題表現、owner、comparison class、評価、data path、strategy、tool constraint を
  監査する。明白な劣化や破損は二回を待たず rollback または再設計する。

### Prompt Discipline

- root `AGENTS.md` には複数タスクで持続する高価値な規則、hard safety gate、routing
  だけを置く。タスク固有の一時状態は work order / spec / handoff / generated artifact
  へ置き、同じ指示や volatile machine truth を複数文書へ複製しない。
- 本ファイルの operating policy を変えるときは変更群を限定し、代表的な Routine、
  Exploration、Critical、長期 continuation で同じ評価契約を再実行する。質問回数、
  tool 数、token 削減は Goal 品質と完了率を維持した場合だけ改善とみなす。

## Current Status

- 公開ステータス: alpha / active development / not release-ready.
- Aelyris is alpha and does not claim production readiness; capability claims are
  gated by verifiers. リリース判断の前に `pnpm verify:quality-score` と
  `pnpm verify:goal:safe:no-token` をローカルで再生成して現在値を確認する。
- Current machine truth is intentionally not hard-coded in this stable guide.
  Read `.codex-auto/quality/release-quality-score.json` and
  `.codex-auto/quality/final-goal-audit.json` only after regenerating their owner
  commands. For a read-only status request, do not regenerate: inspect the existing
  artifacts and timestamps, label the result as an observed snapshot, and state if
  it may be stale. A release/publication claim must fail closed until a mutation-
  authorized refresh has run. A focused proof-registry PASS is not release readiness.
  `pnpm verify:goal:safe` remains a separate aggregate and must be rerun before a
  current safe-chain claim. Historical safe evidence reported token spending;
  do not describe the legacy command as no-token. Phase A0 of
  `audit-remediation-instructions.md` owns the command/policy split.
  `authenticated-ai-cli-prompt-smoke` runs only through
  `authenticated-ai-cli-consent-packet` with
  `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.
  `pnpm verify:goal:finalize` excludes git finalization by default;
  `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is
  optional, and git finalization is not required for product/safe/finalize evidence.

現在の安全な主張は narrower claim です: Rust/Tauri terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, merge substrate はあるが、
より大きな product claim は live durability / restart replay / native quality /
signing/updater / operator proof gates 待ちです。

## Task-Routed Reading

この root guide は mandatory safety contract です。RAG 型にする対象は
knowledge docs の展開であり、current claim boundary / Fable override / active
work-order safety を task-dependent にしない。読み方は二段階にする。

1. Mandatory preflight: このファイルの current status と該当する hard guardrail を確認する。
2. Task-routed expansion: `AI_GUIDE.md` の Task Router から必要な owner docs だけを読む。

広範な公開整理・claim policy 変更・architecture 変更・task が曖昧な場合だけ full
knowledge stack に広げる。

```yaml
agent_context:
  product: Aelyris
  cli_short_name: aelys
  public_status: alpha_active_development
  claims:
    production_ready: false
    release_candidate_ready: false
    current_truth_source:
      - verifier_command_output
      - .codex-auto/quality/*.json
    must_regenerate_before_release_claim:
      - pnpm verify:quality-score
      - pnpm verify:goal:safe:no-token
    stale_claims_blocked:
      - S
      - A
      - legacy_fixed_score
      - legacy release-ready
  mandatory_preflight:
    always_check:
      - AGENTS.md:current_status
      - AGENTS.md:work_rules
    conditional_hard_gates:
      fable_world_class_cue:
        applies_when:
          - Fable is explicitly named
          - world-class is tied to Fable blocker, review, implementation, or continuation
        excludes:
          - generic product or design aspiration using world-class alone
        read_first:
          - .claude/agent-memory-local/CLAUDE_MUST_READ_FABLE_REVIEW_WORLD_CLASS_BLOCKERS_LOCAL_ONLY.md
          - .claude/agent-memory-local/CLAUDE_MUST_READ_NEXT_SESSION_FABLE_WORLD_CLASS_IMPLEMENTATION_LOCAL_ONLY.md
      implementation_review_progress_or_session_clear:
        applies_when:
          - audit-remediation-instructions.md is not ACTIVE
          - no Fable continuation cue applies
        read_in_order:
          - refactor-instructions.md
          - hardening-instructions.md
          - renderer-instructions.md
      release_or_public_claim:
        read:
          - docs/requirements.md
        verify_before_claim:
          - pnpm verify:quality-score
          - pnpm verify:goal:safe:no-token
      implementation_work_unit:
        read:
          - docs/specs/README.md
  task_routed_expansion:
    public_or_claim:
      - README.md
      - docs/README.md
      - docs/PUBLICATION_READINESS.md
      - docs/requirements.md
    goal_or_tradeoff:
      - GOAL.md
      - DECISION_FRAMEWORK.md
      - DELEGATION_FRAMEWORK.md
      - DECISIONS.md
    architecture:
      - ARCHITECTURE.md
    contracts:
      - contracts/README.md
    agent_workflow:
      - docs/AGENT_WORKFLOWS.md
      - tasks/README.md
    implementation:
      - docs/specs/README.md
      - selected_spec_or_work_unit_only
      - owner_source_files_only
    style:
      - STYLE.md
```

Human-readable fallback index:

- Public overview: `README.md`, `docs/README.md`,
  `docs/PUBLICATION_READINESS.md`.
- Claim policy and requirements: `docs/requirements.md`, `GOAL.md`.
- Decision knowledge: `AI_GUIDE.md`, `DECISION_FRAMEWORK.md`,
  `DELEGATION_FRAMEWORK.md`, `DECISIONS.md`.
- Architecture and contracts: `ARCHITECTURE.md`, `contracts/README.md`.
- Workflow and task packets: `docs/AGENT_WORKFLOWS.md`, `tasks/README.md`,
  `docs/specs/README.md`.
- Style: `STYLE.md`.

### Fable / World-Class Continuation Override

ユーザーが `Fable`, `Fable返答後`, `P1 command evidence`、Fable/world-class
blocker の review/implementation/continuation、またはその文脈での
「セッションクリア後の続き」を明示した場合は、generic release / hardening
continuation から始めない。一般的な製品設計の目標として `world-class` とだけ述べた
場合はこの override を発火させず、Task Router で扱う。override 適用時は以下の
local-only handoff を最優先で読む。

1. `.claude/agent-memory-local/CLAUDE_MUST_READ_FABLE_REVIEW_WORLD_CLASS_BLOCKERS_LOCAL_ONLY.md`
2. `.claude/agent-memory-local/CLAUDE_MUST_READ_NEXT_SESSION_FABLE_WORLD_CLASS_IMPLEMENTATION_LOCAL_ONLY.md`
3. `docs/specs/README.md`
4. その local-only handoff が列挙する current generated artifacts / verifiers

これらの `.claude/agent-memory-local/*` はローカル専用で、commit しない・
tracked docs に中身を移さない。現在の Fable 後の default next WU は
P1 Command Evidence Durability であり、`pnpm verify:terminal:command-evidence`,
`pnpm verify:terminal:multipane-command-evidence`,
`pnpm verify:terminal:recovered-command-evidence`,
`pnpm verify:terminal:process-reconnect-command-evidence` から再確認する。
local-only handoff が存在しない場合だけ、`docs/specs/WU_RT_1_CONTINUATION.md`
と current artifacts に fallback する。この local-only handoff は task 層の
入力であり、knowledge 層（`GOAL.md` / `AI_GUIDE.md` / framework 群）と
claim policy を上書きしない。

### Comprehensive Audit Remediation Continuation Override

`audit-remediation-instructions.md` が `STATUS: ACTIVE` の間に、ユーザーが
`続き`、`セッションクリア後`、`総合監査`、`audit remediation`、または
「監査結果の実装」を指示した場合は、generic renderer/release continuation
から始めない。以下を順に読む。

1. `audit-remediation-instructions.md`
2. `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md`
3. `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`
4. `docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md` の active phase
5. handoff が列挙する current Git/artifact truth と owner files

local handoff がない、古い、または Git truth と矛盾する場合は、実装前に
`pnpm verify:audit-remediation:continuation` を実行し、handoff を現在値へ直す。
この override は work order routing であり、claim policy を上書きしない。

## Active Work Orders

完了または明示的に廃止されるまで、実装・レビュー・進捗監査・session clear handoff
を始める前に以下を毎回明示的に読む。該当しない作業でも、読んだうえで
対象外と判断する。これは Task Router の例外であり、shared files をまたぐ古い
work-order を誤って再開・並行実行しないための safety preflight です。

例外は、単一ファイルの typo/format 修正など、behavior、claim、contract、state、
dependency、生成artifactを変えない reversible な `Routine micro-edit` だけとする。
この場合は root guide の Current Status / Work Rules と対象 diff を確認すればよく、
全 work order や application Work Unit を読まない。claim/public/release 文言へ触れる、
対象が増える、または意味が変わる時点でこの例外を失い、通常 preflight に戻る。

1. `refactor-instructions.md` - complete on this branch; re-check current
   machine truth only.
2. `hardening-instructions.md` - H1-H8 repo-owned completion audit is complete
   on this branch; broader remaining blockers must be read from the current
   final-goal audit before choosing implementation vs external/operator work.
3. `audit-remediation-instructions.md` - **ACTIVE**. Read its exact current phase,
   active slice, and next implementation slice; do not copy volatile frontier truth
   into this stable guide.
4. `ui-quality-instructions.md` - scheduled work is owned by audit-remediation
   phase A3. Do not execute it as a concurrent work order.
5. `renderer-instructions.md` - deferred to conditional audit-remediation phase
   A8. Do not reopen from the old generic route.

現行実行順は `refactor (complete) -> hardening (complete) -> audit remediation
R0..A9`。audit remediation 内の完了済み phase は fresh verifier/review regression
が出た場合だけ同じ tracked program 内で再開し、exact frontier は root work order と
canonical local handoff を正とする。
同時実行は禁止。work order 群は
`package.json`、`scripts/`、`src/features/terminal/` などを共有しうるため、
1つの work order/phase だけを選び、対象ファイルを明示して進める。

実装を始める前に `docs/specs/README.md` を読み、Work Unit を1つ選び、その WU が指定する spec 節と対象ファイルだけを開く。設計/doc routing のみの変更では、該当
Work Unit がないことを明示し、アプリ実装 WU に拡張しない。

## Work Rules

- current machine truth は verifier artifact と生成コマンドを優先する。古い docs の
  fixed grade/score や `legacy release-ready` は現在値ではない。
- `.codex-auto/quality/*.json` はローカル生成 artifact。公開読者には再生成コマンドを示す。
- visible agent pane では interactive TUI / visible PTY を使う。human-visible path で `-p` / `--print` を使わない。
- headless `-p` は planner / reviewer / MCP batch / no-webview automation だけに限定する。
- 実装時は既存仕様を壊さず、負債を減らし、今後変更しやすくする。
- 状態・データの owner を1つにする。二重所有、二重実装、frontend 再合成を避ける。
- 型/schema で契約を表現する。無検証 `as` cast や曖昧 optional を増やさない。
- 死コード、重複、未配線 infrastructure を残さない。
- Cargo build outputs, `node_modules`, `.codex-auto`, `dist`, `artifacts`, `.env*`, signing material, token files は commit しない。
- token-spending AI CLI prompt/probe verifiers は、このリポ/WU では owner の
  standing authorization 済み。必要なら documented provider env
  （例: `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`）を設定し、
  `pnpm verify:goal:operator:token-smoke` から実行する。wrapper が invocation ごとの
  short-lived one-use packet を発行し、no-token chain からは実行しない。
  provider/model/command/artifact を記録し、`.env*`, token files, secrets,
  signing material, secret-bearing transcripts は保存・commit しない。
- focused gate が通った phase / Work Unit の commit は owner の standing
  authorization 済み。毎回 commit 許可を聞かず、対象 path を明示 stage して
  `one phase = one commit` で確定する。push / PR / merge / rebase / reset /
  amend / history rewrite / force push はこの許可に含めず、別の明示許可が
  ある場合だけ実行する。
- workflow/checklist の詳細は `docs/AGENT_WORKFLOWS.md` または Aelyris 専用 skill に置き、この root guide を肥大化させない。

## Tech Stack

- Framework: Tauri v2 (Rust backend + React frontend)
- Frontend: React 19 + TypeScript + CSS Modules + Vite 7
- Terminal: Native Rust-backed terminal rendering (ConPTY; no xterm.js runtime dependency)
- Editor: Monaco Editor + Vim mode
- UI: Radix UI primitives + Lucide + motion
- Backend: Rust (portable-pty, git2, rusqlite, tokio)
- Window: Mica on Windows 11 / Acrylic fallback on Windows 10
- Theme: Catppuccin Mocha + 18K Gold accent

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | production frontend build |
| `pnpm tauri dev` | Tauri dev mode |
| `pnpm tauri:build:dist` | distribution build wrapper |
| `pnpm test` | frontend tests |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests |
| `pnpm verify:release:hygiene` | public/release hygiene gate |
| `pnpm verify:requirements-spec-design-traceability` | requirements/spec/design trace gate |
| `pnpm verify:quality-score` | release quality score |
| `pnpm verify:goal:safe:no-token` | descriptor-first no-token gate; emits current-run token execution truth |
| `pnpm verify:goal:operator:token-smoke` | explicit provider-selected token-spending smoke with one-use execution packet |
| `pnpm verify:goal:safe` | legacy ordered aggregate; historical token evidence is not current-run no-token proof |

Do not run `cargo test` and `pnpm test` in parallel on Windows; `link.exe` can fail under resource contention.

## Architecture

```text
aelyris/
  src-tauri/              # Rust backend
    src/
      pty/                # PTY management, ConPTY, buffers
      agent/              # headless + interactive agents, monitor, router
      git/                # git2-rs status/worktree/file tree/discovery
      lsp/                # LSP JSON-RPC client
      db/                 # SQLite sessions and history
      config/             # TOML config
      watchdog/           # tool approval and repair pipeline
      workflow/           # YAML workflow execution
      suggest/            # command suggestion engine
      session/            # session/pane lifecycle
      ipc/                # Tauri commands
  src/                    # React frontend
    features/             # terminal, editor, file tree, agent, command palette, SCM, etc.
    shared/               # UI, hooks, store, lib, types
    styles/               # global design tokens
```

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Shift+P | command palette |
| Ctrl+P | quick open |
| Ctrl+R | command history search |
| Ctrl+Shift+F | search in files |
| Ctrl+B | toggle sidebar |
| Ctrl+, | settings |
| Ctrl+S | save editor file |
| Ctrl+B then `%` | split pane right |
| Ctrl+B then `"` | split pane down |
| Ctrl+Space | accept ghost text |
| Escape | editor/search/diff -> terminal focus |

F12 currently sends the terminal function key sequence in Claude's notes; do not document LSP Go to Definition as implemented unless the LSP gate proves it.

## Known Gotchas

- Mica is Windows 11 only; Windows 10 uses Acrylic fallback.
- ConPTY `PSEUDOCONSOLE_PASSTHROUGH_MODE` (`0x8`) requires Windows 11 22H2+.
- LSP currently exposes completion/hover paths; go-to-definition, diagnostics, references, and edit-change notification wiring need proof before being claimed.
- Some live verifiers require WebView2/CDP, real Windows sleep/resume, signing material, or process policies unavailable in sandboxed sessions.
- Cargo `target` directories are disposable and can be cleaned; first rebuild will be slow.

## Public Documentation

- Public overview: `README.md`
- Docs guide: `docs/README.md`
- Agent workflow guide: `docs/AGENT_WORKFLOWS.md`
- Publication readiness: `docs/PUBLICATION_READINESS.md`
- Requirements: `docs/requirements.md`
- Spec index: `docs/specs/README.md`
