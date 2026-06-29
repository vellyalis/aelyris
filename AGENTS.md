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
- token-spending AI prompt smoke は explicit consent なしで実行しない。
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

