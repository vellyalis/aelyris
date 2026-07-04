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
  `pnpm verify:goal:safe` をローカルで再生成して現在値を確認する。
- Current machine truth refreshed 2026-07-04 JST:
  `pnpm verify:quality-score` = `94/100` (`329/351`), grade `A`,
  `releaseCandidateReady=false`; after the final-goal evidence-map refresh the
  projected score is `94/100` (`329/351`), still `releaseCandidateReady=false`.
  `pnpm verify:final-goal-audit` is `blocked-by-external-gates` with
  `implementationFixableCount=0`, `policyBlockedCount=0`, and
  `externalBlockedCount=8`; `pnpm verify:goal:safe` has the required proof
  registry at `28/28` and remains `blocked-by-external-gates`.

現在の安全な主張は narrower claim です: Rust/Tauri terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, merge substrate はあるが、
より大きな product claim は live durability / restart replay / native quality /
signing/updater / operator proof gates 待ちです。

## Read First

実装・レビュー・公開整理の入口はこの順です。

1. `README.md` - public overview.
2. `docs/README.md` - docs guide and historical/current split.
3. `docs/PUBLICATION_READINESS.md` - public readiness checklist.
4. `docs/requirements.md` - stable requirements and claim policy.
5. `docs/AGENT_WORKFLOWS.md` - agent/skill workflow routing.
6. `docs/specs/README.md` - active spec index.

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
と current artifacts に fallback する。

## Active Work Orders

完了または明示的に廃止されるまで、実装・レビュー・進捗監査・session clear handoff
を始める前に以下を毎回明示的に読む。該当しない作業でも、読んだうえで
対象外と判断する。

1. `refactor-instructions.md` - complete on this branch; re-check current
   machine truth only.
2. `hardening-instructions.md` - H1-H8 repo-owned completion audit is complete
   on this branch; remaining blockers are external/operator/upstream gates, not
   repo-owned implementation work.
3. `renderer-instructions.md` - Stage 1 GPU Renderer follow-up; only reopen
   when explicitly selected as the next work order.

実行順は `refactor -> hardening -> renderer`。完了済み work order は verifier
regression が出た場合だけ再開する。同時実行は禁止。3書は
`package.json`、`scripts/`、`src/features/terminal/` などを共有しうるため、
1つの work order/phase だけを選び、対象ファイルを明示して進める。

実装を始める前に `docs/specs/README.md` を読み、Work Unit を1つ選び、その WU が指定する spec 節と対象ファイルだけを開く。

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
  standing consent 済み。必要なら documented consent/provider env
  （例: `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`）を設定して実行してよい。
  provider/model/command/artifact を記録し、`.env*`, token files, secrets,
  signing material, secret-bearing transcripts は保存・commit しない。
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
| `pnpm verify:goal:safe` | non-token final safe gate |

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
