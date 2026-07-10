# Aelyris Agent Guide

Windows向けプロジェクトファーストAI開発ワークスペース。

製品名: `Aelyris`。読みは `Aelys` / `エイリス`。CLI / short name は `aelys`。機能名は `Aelyris Core`、`Aelyris Grid`、`Aelyris Pane`。協調エンジン名は `Qralis`。

このファイルは Codex / Claude / other coding agents 共通の作業入口です。
Claude Code 固有の補足は `CLAUDE.md` に置きますが、矛盾した場合はこの
`AGENTS.md` と `docs/requirements.md` の current claim policy を優先します。

## Current Status

- 公開ステータス: alpha / active development / not release-ready.
- Aelyris is alpha and does not claim production readiness; capability claims are
  gated by verifiers. リリース判断の前に `pnpm verify:quality-score` と
  `pnpm verify:goal:safe:no-token` をローカルで再生成して現在値を確認する。
- Current machine truth refreshed 2026-07-10 JST by the comprehensive audit safe
  chain: `pnpm verify:quality-score` = `19/100` (`62/327`), grade `D`,
  `releaseCandidateReady=false`.
  `pnpm verify:final-goal-audit` is `blocked` with
  `implementationFixableCount=196`, `policyBlockedCount=12`, and
  `externalBlockedCount=15`; `pnpm verify:goal:safe` is `blocked`, with failed
  steps including authenticated preflight/consent packet, final-goal audit,
  documentation freshness, real OS sleep/operator handoff, completion matrix,
  external-gate readiness, and operator finish. The same safe run reported
  `tokenSpendingPromptExecuted=true`; do not describe this command as no-token.
  Phase A0 of `audit-remediation-instructions.md` owns the command/policy split.
  The safe proof registry contract is `proofArtifactPassCount=28/28` when all
  registered proofs pass. `authenticated-ai-cli-prompt-smoke` runs only through
  `authenticated-ai-cli-consent-packet` with
  `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`. `pnpm verify:goal:finalize`
  excludes git finalization by default; `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is
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
      - 95/100
      - 96/100
      - legacy release-ready
  mandatory_preflight:
    always_check:
      - AGENTS.md:current_status
      - AGENTS.md:work_rules
    conditional_hard_gates:
      fable_world_class_cue:
        read_first:
          - .claude/agent-memory-local/CLAUDE_MUST_READ_FABLE_REVIEW_WORLD_CLASS_BLOCKERS_LOCAL_ONLY.md
          - .claude/agent-memory-local/CLAUDE_MUST_READ_NEXT_SESSION_FABLE_WORLD_CLASS_IMPLEMENTATION_LOCAL_ONLY.md
      implementation_review_progress_or_session_clear:
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

ユーザーが `Fable`, `world-class`, `Fable返答後`, `P1 command evidence`,
または「セッションクリア後の続き」を明示した場合は、generic release /
hardening continuation から始めない。以下の local-only handoff を最優先で読む。

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

1. `refactor-instructions.md` - complete on this branch; re-check current
   machine truth only.
2. `hardening-instructions.md` - H1-H8 repo-owned completion audit is complete
   on this branch; broader remaining blockers must be read from the current
   final-goal audit before choosing implementation vs external/operator work.
3. `audit-remediation-instructions.md` - **ACTIVE**. R0 continuation contract is
   the current documentation slice; A0 is the next implementation phase.
4. `ui-quality-instructions.md` - scheduled work is owned by audit-remediation
   phase A3. Do not execute it as a concurrent work order.
5. `renderer-instructions.md` - deferred to conditional audit-remediation phase
   A8. Do not reopen from the old generic route.

現行実行順は `refactor (complete) -> hardening (complete) -> audit remediation
R0..A9`。完了済み work order は verifier regression が出た場合だけ再開する。
同時実行は禁止。work order 群は
`package.json`、`scripts/`、`src/features/terminal/` などを共有しうるため、
1つの work order/phase だけを選び、対象ファイルを明示して進める。

実装を始める前に `docs/specs/README.md` を読み、Work Unit を1つ選び、その WU が指定する spec 節と対象ファイルだけを開く。設計/doc routing のみの変更では、該当
Work Unit がないことを明示し、アプリ実装 WU に拡張しない。

## Work Rules

- current machine truth は verifier artifact と生成コマンドを優先する。古い docs の `S`, `A`, `95/100`, `96/100`, `legacy release-ready` は現在値ではない。
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
| Ctrl+Shift+H | split horizontal |
| Ctrl+Shift+V | split vertical |
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
